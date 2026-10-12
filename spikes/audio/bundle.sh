#!/usr/bin/env bash
# Wrap spike-audio in a signed .app bundle.
#
# Why: macOS 14.4+ CoreAudio process taps require audio-capture authorization.
# A bare CLI binary cannot request it — every tap variant we tried returned
# zeroed buffers with no error (see ../reports/audio.md). A bundle with an
# Info.plist usage description and a signature can prompt for TCC and receive
# real audio.
#
# Ad-hoc signing (-s -) is used deliberately: it needs no Apple Developer
# account and is sufficient for a local entitlement test. A distributed build
# would need a real Developer ID.
set -euo pipefail
cd "$(dirname "$0")"

APP="SpikeAudio.app"
BIN="spike-audio"

swift build -c release
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp ".build/release/$BIN" "$APP/Contents/MacOS/$BIN"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>$BIN</string>
  <key>CFBundleIdentifier</key><string>dev.nova.spike.audio</string>
  <key>CFBundleName</key><string>SpikeAudio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>14.4</string>
  <!-- TCC prompts read these. Without them the OS denies silently. -->
  <key>NSMicrophoneUsageDescription</key>
  <string>Nova spike measures meeting audio capture quality.</string>
  <key>NSAudioCaptureUsageDescription</key>
  <string>Nova spike measures system-audio capture via a CoreAudio process tap.</string>
  <!-- Menu-bar style: no Dock icon. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > /tmp/spike-audio.entitlements <<ENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key><true/>
</dict>
</plist>
ENT

codesign --force --sign - \
  --entitlements /tmp/spike-audio.entitlements \
  --options runtime \
  "$APP" 2>&1 | sed 's/^/  /' || true

echo "built $APP"
codesign -d --entitlements - "$APP" 2>&1 | sed 's/^/  /' || true
echo
echo "run it with:"
echo "  ./$APP/Contents/MacOS/$BIN"
echo
echo "artifacts land in \$PWD/artifacts — run from this directory."
