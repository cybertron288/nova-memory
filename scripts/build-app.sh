#!/usr/bin/env bash
# Builds build/Nova.app from this checkout and signs it for this Mac
# (stage 1 of the app bundle; see docs/install.md).
#
#   scripts/build-app.sh         build, assemble, sign, verify
#   scripts/build-app.sh --run   ...then quit the running Nova and open this one
#
# The daemon is not in the bundle: the shell runs it from daemon/ with Bun, so
# a daemon change needs only a daemon restart, never this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Nova.app"
IDENTITY="${NOVA_SIGN_IDENTITY:-Nova Dev}"

RUN=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    *) echo "usage: $0 [--run]" >&2; exit 2 ;;
  esac
done

"$ROOT/scripts/ensure-signing-cert.sh" "$IDENTITY"

swift build --package-path "$ROOT/capture" -c release
swift build --package-path "$ROOT/shell" -c release
CAPTURE_BIN="$(swift build --package-path "$ROOT/capture" -c release --show-bin-path)/nova-capture"
SHELL_BIN="$(swift build --package-path "$ROOT/shell" -c release --show-bin-path)/NovaShell"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$SHELL_BIN" "$APP/Contents/MacOS/NovaShell"
cp "$CAPTURE_BIN" "$APP/Contents/MacOS/nova-capture"
VERSION="$(git -C "$ROOT" describe --tags --always --dirty)"
sed "s/__VERSION__/$VERSION/g" "$ROOT/shell/Resources/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Inside-out: the nested binary first, then the bundle that seals it.
codesign --force --timestamp=none --sign "$IDENTITY" \
  --identifier io.github.cybertron288.nova.capture "$APP/Contents/MacOS/nova-capture"
codesign --force --timestamp=none --sign "$IDENTITY" "$APP"
# A bad signature must fail here, not later as a silently lost grant.
codesign --verify --strict --verbose=2 "$APP"

echo "built $APP ($VERSION, signed by \"$IDENTITY\")"

if (( RUN )); then
  # -x matches the process name exactly. -f would also match an editor with
  # shell/Sources/NovaShell/... open.
  if pgrep -x NovaShell >/dev/null; then
    pkill -TERM -x NovaShell || true
    # The shell waits up to 3 s for the daemon before it exits itself.
    for _ in $(seq 50); do
      pgrep -x NovaShell >/dev/null || break
      sleep 0.1
    done
    if pgrep -x NovaShell >/dev/null; then
      echo "the running Nova did not quit within 5 s; not starting a second one" >&2
      exit 1
    fi
  fi
  # Through LaunchServices, so Nova.app — not this terminal — is the process
  # macOS charges the Accessibility grant to.
  open "$APP"
fi
