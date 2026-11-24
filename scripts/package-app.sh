#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c release
APP="$ROOT/dist/MacOS Filter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/MacOSFilter "$APP/Contents/MacOS/MacOSFilter"
cp .build/release/FilterHost "$APP/Contents/MacOS/FilterHost"
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
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
mkdir -p "$ROOT/dist"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/MacOS-Filter-macOS.zip"
ditto -c -k "$ROOT/extension" "$ROOT/dist/MacOS-Filter-Chrome-Extension.zip"
