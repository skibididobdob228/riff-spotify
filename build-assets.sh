#!/bin/sh
# Packs Riff (UI + server) with the Android overlays into app/src/main/assets/riff.zip.
# RIFF_SRC: Riff's app folder (default: the modded desktop copy).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${RIFF_SRC:-$HOME/Applications/riff/resources/app}
STAGE=$HERE/build/riff-stage
rm -rf "$STAGE"
mkdir -p "$STAGE" "$HERE/app/src/main/assets"

# Everything except desktop-only bits; the server needs no npm packages, the UI ships its own copies
tar -C "$SRC" --exclude=./node_modules --exclude=./.git --exclude=./test --exclude=./bin \
    --exclude='./flake.*' --exclude='./*.md' --exclude=./.gitignore -cf - . | tar -C "$STAGE" -xf -
cp -r "$HERE/node-overlay/." "$STAGE/"
# nodejs-mobile has no ICU: spell out \p{L}/\p{N} for the server-side scripts (the WebView has ICU)
for f in "$STAGE"/*.js; do [ "$(basename "$f")" = app.js ] || python3 "$HERE/unicode-classes.py" "$f"; done
cp -r "$HERE/web-overlay/." "$STAGE/"

# The shim has to define window.electronAPI before any of Riff's scripts run
python3 - "$STAGE/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
tag = '  <script src="android-shim.js"></script>\n  <link rel="stylesheet" href="android.css">\n'
assert s.count('<title>Riff</title>\n') == 1
s = s.replace('<title>Riff</title>\n', '<title>Riff</title>\n' + tag, 1)
open(p, 'w', encoding='utf8').write(s)
PY

rm -f "$HERE/app/src/main/assets/riff.zip"
(cd "$STAGE" && 7z a -tzip -mx=7 "$HERE/app/src/main/assets/riff.zip" . > /dev/null)
du -sh "$STAGE" "$HERE/app/src/main/assets/riff.zip"
