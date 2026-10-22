#!/bin/sh
# Dev loop: pack assets, build the debug APK, install it on the running emulator/phone, start it,
# and forward its WebView DevTools to localhost:9336.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ADB=${ADB:-$HOME/Android/Sdk/platform-tools/adb}
PKG=io.github.skibididobdob228.riffspotify
"$HERE/build-assets.sh" > /dev/null
(cd "$HERE" && gradle -q assembleDebug 2>&1 | grep -E "error:|FAILED|What went wrong" -A4 || true)
ABI=$("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')
"$ADB" install -r "$HERE/app/build/outputs/apk/debug/app-$ABI-debug.apk" | tail -1
"$ADB" shell am force-stop $PKG
"$ADB" logcat -c
"$ADB" shell am start -n $PKG/.MainActivity > /dev/null
for i in $(seq 1 60); do
  PID=$("$ADB" shell pidof $PKG | tr -d '\r')
  [ -n "$PID" ] && "$ADB" shell cat /proc/net/unix | grep -q "webview_devtools_remote_$PID" && break
  sleep 1
done
"$ADB" forward tcp:9336 localabstract:webview_devtools_remote_$PID > /dev/null
echo "running, pid $PID, devtools on 9336"
