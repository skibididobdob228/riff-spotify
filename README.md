# Riff Spotify for Android

Android build of [Riff Spotify](https://github.com/skibididobdob228/riff-spotify): the same Riff UI, server and Spotify
engine as on desktop, with Android stand-ins for the parts that only exist there.

| Desktop | Android |
| --- | --- |
| Electron window | `WebView` (`RiffWebView`, kept alive by `WebViewHolder` so music survives the activity) |
| Electron preload (`window.electronAPI`) | `web-overlay/android-shim.js` over the Java bridge (`RiffBridge`) and a small IPC endpoint in Node |
| Node.js server (`server.js`) | the same file on [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) 18 (`NodeRunner`, `cpp/native-lib.cpp`, `node-overlay/android-main.js`) |
| yt-dlp, ffmpeg binaries | [youtubedl-android](https://github.com/yausername/youtubedl-android) (Python, yt-dlp, QuickJS, ffmpeg) |
| Tray, media keys, MPRIS/SMTC | `PlaybackService`: foreground service, MediaSession, media notification |
| File dialogs | Android document picker, files copied into the app first |
| Downloads folder | app's Music folder, each download also copied to shared `Music/Riff` (`DownloadExporter`) |
| Discord Rich Presence, multiple windows, tray | not available |

nodejs-mobile has no ICU, so `unicode-classes.py` rewrites `\p{L}`/`\p{N}` in the server scripts at build time.

## Build

Needs JDK 17+, Gradle 9, Android SDK with platform 36, build-tools 36.1, NDK 27.3 and CMake 3.31.

```sh
./build-assets.sh                 # packs Riff (RIFF_SRC, default ~/Applications/riff/resources/app) into assets/riff.zip
gradle assembleRelease            # app/build/outputs/apk/release/app-{arm64-v8a,x86_64}-release.apk
```

Release signing reads `keystore.properties` (storeFile, storePassword, keyAlias, keyPassword) next to this file;
without it the release APKs are unsigned.

`./dev-run.sh` builds a debug APK, installs it on the connected device or emulator, starts it and forwards the
WebView's DevTools to `localhost:9336`. `./push-web.sh file...` copies changed overlay files into the installed
debug app without a rebuild.

`app/libnode/` holds nodejs-mobile v18.20.4's prebuilt `libnode.so` (arm64-v8a, x86_64) and headers.
