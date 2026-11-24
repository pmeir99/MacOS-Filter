#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)"
APP="$ROOT/dist/MacOS Filter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN"/MacOSFilter "$APP/Contents/MacOS/MacOSFilter"
cp "$BIN"/FilterHost "$APP/Contents/MacOS/FilterHost"
chmod 755 "$APP/Contents/MacOS/MacOSFilter" "$APP/Contents/MacOS/FilterHost"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>MacOSFilter</string>
  <key>CFBundleIdentifier</key><string>com.pmeir99.MacOS-Filter</string>
  <key>CFBundleName</key><string>MacOS Filter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
mkdir -p "$APP/Contents/Resources"
MODEL_DIR="$(mktemp -d)"
trap 'rm -rf "$MODEL_DIR"' EXIT
curl --fail --location --retry 3 --silent --show-error 'https://raw.githubusercontent.com/dcandre/Core-ML-After-Dark/497c388569033f5b970755a4c90a0863e72785c5/Core%20ML%20After%20Dark/PhotoSelector/Nudity.mlmodel' -o "$MODEL_DIR/Nudity.mlmodel"
test "$(git hash-object "$MODEL_DIR/Nudity.mlmodel")" = fd69d0c03ef5458b4543b37630c48f60111562a9
xcrun coremlcompiler compile "$MODEL_DIR/Nudity.mlmodel" "$APP/Contents/Resources"
test -d "$APP/Contents/Resources/Nudity.mlmodelc"
plutil -lint "$APP/Contents/Info.plist"
# Ad-hoc signatures detect bundle corruption but do not notarize the app.
codesign --force --sign - --timestamp=none "$APP/Contents/MacOS/FilterHost"
codesign --force --sign - --timestamp=none "$APP/Contents/MacOS/MacOSFilter"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
mkdir -p "$ROOT/dist"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/MacOS-Filter-macOS.zip"
ditto -c -k "$ROOT/extension" "$ROOT/dist/MacOS-Filter-Chrome-Extension.zip"

# Reopen the shipped ZIP and run the classifier on generated pixels.
ditto -x -k "$ROOT/dist/MacOS-Filter-macOS.zip" "$MODEL_DIR/unpacked"
SHIPPED="$MODEL_DIR/unpacked/MacOS Filter.app"
codesign --verify --strict --deep "$SHIPPED"
cat > "$MODEL_DIR/smoke.swift" <<'SWIFT'
import Foundation
import Vision
import CoreML
import CoreGraphics
let config = MLModelConfiguration()
config.computeUnits = .all
let model = try MLModel(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]), configuration: config)
let request = VNCoreMLRequest(model: try VNCoreMLModel(for: model))
request.imageCropAndScaleOption = .scaleFill
let pixels = CGContext(data: nil, width: 224, height: 224, bitsPerComponent: 8, bytesPerRow: 896,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
pixels.setFillColor(gray: 0.6, alpha: 1)
pixels.fill(CGRect(x: 0, y: 0, width: 224, height: 224))
try VNImageRequestHandler(cgImage: pixels.makeImage()!, options: [:]).perform([request])
guard let scores = request.results as? [VNClassificationObservation],
      let risk = scores.first(where: { $0.identifier.uppercased() == "NSFW" }),
      risk.confidence.isFinite, (0...1).contains(risk.confidence)
else { fatalError("Packaged model did not produce a valid NSFW score") }
print("Packaged classifier inference passed")
SWIFT
swift "$MODEL_DIR/smoke.swift" "$SHIPPED/Contents/Resources/Nudity.mlmodelc"

if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  # A pinned public portrait is CI input only. It is never shipped or fetched by the app.
  curl -fsSL --retry 3 'https://raw.githubusercontent.com/scikit-image/scikit-image/e8a42ba85aaf5fd9322ef9ca51bc21063b22fcae/skimage/data/astronaut.png' -o "$MODEL_DIR/portrait.png"
  test "$(git hash-object "$MODEL_DIR/portrait.png")" = 834cda0012478c5edc8d43bade96d315dedeaab4
  HOST="$SHIPPED/Contents/MacOS/FilterHost"
  if [[ "$(uname -m)" != arm64 ]]; then
    swift build --product FilterHost
    HOST="$(swift build --show-bin-path)/FilterHost"
  fi
  python3 -m venv "$MODEL_DIR/qa"
  "$MODEL_DIR/qa/bin/pip" -q install Pillow
  "$MODEL_DIR/qa/bin/python" scripts/native-portrait.py "$HOST" "$MODEL_DIR/portrait.png"
fi
