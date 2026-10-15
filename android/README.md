# Neth Speakers — Android app

The whole simulator is a web app; this folder wraps the production web build
into a fully **offline** Android APK. No Gradle, no Android Studio — the host
activity is one hand-rolled `WebView` plus a small build script that drives
`aapt2 / javac / d8 / zipalign / apksigner` directly.

## How it works

- `build-apk.sh` first builds the web bundle with a **relative base**
  (`vite build --base=./`) and stages `dist → android/build/apk/assets`.
- `MainActivity.java` loads `https://appassets.androidplatform.net/index.html`
  (the reserved WebViewAssetLoader domain) and intercepts every request,
  streaming the matching file out of the APK's `assets/`. Because the page is
  served from an https origin, secure-context features (ES module chunks,
  **AudioWorklet** `speaker-worklet.js`, IndexedDB) behave exactly like the
  hosted site.
- No `INTERNET` permission: the app never touches the network.

## Requirements

- JDK 17+ (`java`, `javac`, `keytool` on PATH)
- Android build-tools (aapt2/d8/zipalign/apksigner) and one platform
  `android.jar`, laid out as:

  ```
  $ANDROID_SDK_ROOT/build-tools/34.0.0/{aapt2,d8,zipalign,apksigner}
  $ANDROID_SDK_ROOT/platforms/android-33/android.jar
  ```

  (`build-tools_r34-linux.zip` + `platform-33_r02.zip` from
  `dl.google.com/android/repository` work as-is; unzip and rename.
  Use an API ≤ 34 platform jar — build-tools 34's aapt2 rejects the
  API-35 framework resource table.)

## Build

```bash
./android/build-apk.sh                       # → android/build/NethSpeakers-1.0.0.apk
VERSION_CODE=2 VERSION_NAME=1.1.0 ./android/build-apk.sh
```

`npm install` runs automatically if `node_modules` is missing.

## Release checklist

1. Bump `VERSION_CODE` (monotonic integer) and `VERSION_NAME`.
2. Build, then verify: `apksigner verify --verbose android/build/*.apk`,
   `aapt2 dump badging android/build/*.apk`.
3. Attach the APK to a GitHub Release
   (`uploads.github.com/.../releases/<id>/assets?name=NethSpeakers-<ver>.apk`).

## Signing

`app/neth-release.keystore` (alias `neth`, store/key password `nethspeakers`)
is committed on purpose so future updates stay installable over old versions
without losing user data. Keep it — changing signing keys forces users to
uninstall (losing saved projects).

Certificate SHA-256:
`70:A3:51:3A:CD:3F:EF:37:7C:4B:CF:EE:88:52:1F:E5:75:BF:ED:E8:73:91:36:D4:D6:55:CC:46:A4:0E:16:D4`

## Layout

```
android/
  build-apk.sh                      one-shot build script
  app/
    AndroidManifest.xml             package com.nethspeakers.app, minSdk 24, targetSdk 34
    neth-release.keystore           signing key (committed, see above)
    src/com/nethspeakers/app/MainActivity.java   WebView host + local-asset interceptor
    res/                            launcher icons (legacy PNG + adaptive), theme, strings
  build/                            output (gitignored)
```
