#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c release --arch arm64
swift build -c release --arch arm64 --product FilterUpdate
BIN="$(swift build -c release --arch arm64 --show-bin-path)"
APP="$ROOT/dist/MacOS Filter.app"
rm -rf "$APP"
VERSION="${FILTER_VERSION:-0.4.0}"
[[ "$VERSION" =~ ^0\.4\.[0-9]+$ ]]
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources/Extension"
cp "$BIN/FilterUpdate" "$APP/Contents/Helpers/"
cp extension/*.{js,html,css} extension/manifest.json "$APP/Contents/Resources/Extension"
cp -R extension/icons "$APP/Contents/Resources/Extension/"
python3 - "$APP/Contents/Resources/Extension/manifest.json" "$VERSION" <<'PYTHON'
import json,sys
from pathlib import Path
path = Path(sys.argv[1])
manifest = json.loads(path.read_text())
manifest["version"] = sys.argv[2]
path.write_text(json.dumps(manifest, indent=2))
PYTHON
cp "$BIN"/MacOSFilter "$APP/Contents/MacOS/MacOSFilter"
cp "$BIN"/FilterHost "$APP/Contents/MacOS/FilterHost"
chmod 755 "$APP/Contents/MacOS/MacOSFilter" "$APP/Contents/MacOS/FilterHost"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key><string>Filter.icns</string>
  <key>CFBundleExecutable</key><string>MacOSFilter</string>
  <key>CFBundleIdentifier</key><string>com.pmeir99.MacOS-Filter</string>
  <key>CFBundleName</key><string>MacOS Filter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
mkdir -p "$APP/Contents/Resources"
MODEL_DIR="$(mktemp -d)"
MODEL_DIR="$(cd "$MODEL_DIR" && pwd -P)"
trap 'rm -rf "$MODEL_DIR"' EXIT
ICONSET="$MODEL_DIR/Filter.iconset"
mkdir -p "$ICONSET"
sips -s format png artwork/filter.svg --out "$MODEL_DIR/icon.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$MODEL_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  pixels=$((size*2))
  sips -z "$pixels" "$pixels" "$MODEL_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Filter.icns"
curl --fail --location --retry 3 --silent --show-error 'https://raw.githubusercontent.com/dcandre/Core-ML-After-Dark/497c388569033f5b970755a4c90a0863e72785c5/Core%20ML%20After%20Dark/PhotoSelector/Nudity.mlmodel' -o "$MODEL_DIR/Nudity.mlmodel"
test "$(git hash-object "$MODEL_DIR/Nudity.mlmodel")" = fd69d0c03ef5458b4543b37630c48f60111562a9
xcrun coremlcompiler compile "$MODEL_DIR/Nudity.mlmodel" "$APP/Contents/Resources"
test -d "$APP/Contents/Resources/Nudity.mlmodelc"
bash scripts/build-policy-models.sh "$APP/Contents/Resources" "$MODEL_DIR"
plutil -lint "$APP/Contents/Info.plist"
# Ad-hoc signatures detect bundle corruption but do not notarize the app.
codesign --force --sign - --timestamp=none "$APP/Contents/Helpers/FilterUpdate"
codesign --force --sign - --timestamp=none "$APP/Contents/MacOS/FilterHost"
codesign --force --sign - --timestamp=none "$APP/Contents/MacOS/MacOSFilter"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
mkdir -p "$ROOT/dist"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/MacOS-Filter-macOS.zip"


# Reopen the shipped ZIP and run the classifier on generated pixels.
ditto -x -k "$ROOT/dist/MacOS-Filter-macOS.zip" "$MODEL_DIR/unpacked"
SHIPPED="$MODEL_DIR/unpacked/MacOS Filter.app"
codesign --verify --strict --deep "$SHIPPED"
"$SHIPPED/Contents/Helpers/FilterUpdate" --verify "$SHIPPED" "$VERSION"
"$SHIPPED/Contents/Helpers/FilterUpdate" --verify-archive "$ROOT/dist/MacOS-Filter-macOS.zip"
test -s "$SHIPPED/Contents/Resources/Extension/icons/filter-128.png"
test -s "$SHIPPED/Contents/Resources/Extension/options.html"
test -z "$(find "$SHIPPED" -iname 'Python.framework' -o -iname '*libpython*')"
codesign --verify --strict "$SHIPPED/Contents/Frameworks/libonnxruntime.1.20.1.dylib"
codesign --verify --strict "$SHIPPED/Contents/MacOS/PolicyWorker"
if otool -L "$SHIPPED/Contents/MacOS/PolicyWorker" "$SHIPPED/Contents/Frameworks/libonnxruntime.1.20.1.dylib" | grep -i python; then exit 1; fi
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
  bash scripts/test-update.sh "$SHIPPED" "$VERSION"
  # A pinned public portrait is CI input only. It is never shipped or fetched by the app.
  curl -fsSL --retry 3 'https://raw.githubusercontent.com/scikit-image/scikit-image/e8a42ba85aaf5fd9322ef9ca51bc21063b22fcae/skimage/data/astronaut.png' -o "$MODEL_DIR/portrait.png"
  test "$(git hash-object "$MODEL_DIR/portrait.png")" = 834cda0012478c5edc8d43bade96d315dedeaab4
  HOST="$SHIPPED/Contents/MacOS/FilterHost"
  if [[ "$(uname -m)" != arm64 ]]; then
    swift build --product FilterHost
    HOST="$(swift build --show-bin-path)/FilterHost"
  fi
  python3 scripts/test-settings-push.py "$HOST"
  python3 -m venv "$MODEL_DIR/qa"
  "$MODEL_DIR/qa/bin/pip" -q install Pillow
  "$MODEL_DIR/qa/bin/python" scripts/native-portrait.py "$HOST" "$MODEL_DIR/portrait.png"
fi
