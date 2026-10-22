#!/bin/sh
# Dev loop: copy web overlay files straight into the installed debug app, then reload its WebView.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ADB=${ADB:-$HOME/Android/Sdk/platform-tools/adb}
PKG=io.github.skibididobdob228.riffspotify
for f in "$@"; do
  "$ADB" shell "run-as $PKG sh -c 'cat > files/riff/$(basename "$f")'" < "$f"
  echo "pushed $(basename "$f")"
done
