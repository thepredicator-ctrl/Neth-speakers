#!/usr/bin/env bash
# Build NethSpeakers-<version>.apk — no Gradle / Android Studio required.
#
# Toolchain expected under $ANDROID_SDK_ROOT (default /home/z/my-project/android-tools):
#   build-tools/<BT_API>/   aapt2, d8, zipalign, apksigner
#   platforms/<PLAT>/android.jar
#
# Usage:
#   ANDROID_SDK_ROOT=... VERSION_CODE=1 VERSION_NAME=1.0.0 ./android/build-apk.sh [out.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # Neth-speakers/
APP="$ROOT/android/app"
BUILD="$ROOT/android/build"
SDK="${ANDROID_SDK_ROOT:-/home/z/my-project/android-tools}"

BT="${BT:-$SDK/build-tools/${BT_API:-34.0.0}}"
PLATFORM_JAR="${PLATFORM_JAR:-$SDK/platforms/${PLAT:-android-33}/android.jar}"

VC="${VERSION_CODE:-1}"
VN="${VERSION_NAME:-1.0.0}"
OUT_APK="${1:-$BUILD/NethSpeakers-$VN.apk}"
KS_PASS="${KS_PASS:-nethspeakers}"

[ -x "$BT/aapt2" ] || { echo "aapt2 not found at $BT (set ANDROID_SDK_ROOT/BT/BT_API)" >&2; exit 1; }
[ -f "$PLATFORM_JAR" ] || { echo "android.jar not found at $PLATFORM_JAR (set ANDROID_SDK_ROOT/PLAT)" >&2; exit 1; }
command -v java >/dev/null || { echo "JDK required (java not on PATH)" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip required" >&2; exit 1; }

rm -rf "$BUILD"
mkdir -p "$BUILD/obj" "$BUILD/dex" "$BUILD/apk/assets" "$BUILD/web"

echo "==> [1/6] Web bundle (vite, relative base)"
(
  cd "$ROOT"
  [ -d node_modules ] || npm install --no-audit --no-fund
  npx vite build --base=./ --outDir android/build/web --emptyOutDir
)

echo "==> [2/6] Stage web assets into the APK"
cp -r "$BUILD/web/." "$BUILD/apk/assets/"

echo "==> [3/6] Compile host (javac|ecj + d8)"
OBJ="$APP/src/com/nethspeakers/app/MainActivity.java"
if command -v javac >/dev/null 2>&1; then
  javac -source 1.8 -target 1.8 -nowarn -Xlint:none \
    -bootclasspath "$PLATFORM_JAR" \
    -d "$BUILD/obj" "$OBJ"
else
  # JRE-only hosts: Eclipse batch compiler produces the same .class files.
  ECJ="${ECJ_JAR:-$SDK/ecj.jar}"
  [ -f "$ECJ" ] || { echo "ecj.jar not found at $ECJ (set ECJ_JAR)" >&2; exit 1; }
  java -jar "$ECJ" -source 1.8 -target 1.8 -nowarn \
    -cp "$PLATFORM_JAR" -d "$BUILD/obj" "$OBJ"
fi
"$BT/d8" --release --min-api 24 --lib "$PLATFORM_JAR" \
  --output "$BUILD/dex" \
  "$BUILD"/obj/com/nethspeakers/app/*.class

echo "==> [4/6] Package resources + assets (aapt2)"
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/res.zip"
"$BT/aapt2" link -o "$BUILD/base.apk" \
  -I "$PLATFORM_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  "$BUILD/res.zip" \
  -A "$BUILD/apk/assets" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VC" --version-name "$VN"

echo "==> [5/6] Add classes.dex"
( cd "$BUILD/dex" && zip -q "$BUILD/base.apk" classes.dex )

echo "==> [6/6] Align + sign"
"$BT/zipalign" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"
"$BT/apksigner" sign \
  --ks "$APP/neth-release.keystore" --ks-pass "pass:$KS_PASS" \
  --ks-key-alias neth --key-pass "pass:$KS_PASS" \
  --out "$OUT_APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify "$OUT_APK"

echo
echo "APK: $OUT_APK"
sha256sum "$OUT_APK"
