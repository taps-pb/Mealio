#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" || ! -f "$SDK/platforms/android-35/android.jar" || ! -x "$SDK/build-tools/35.0.0/aapt2" ]]; then
  echo 'Set ANDROID_HOME to an SDK containing platform 35 and build-tools 35.0.0.' >&2
  exit 1
fi
if [[ -z "${MEALIO_KEYSTORE:-}" || -z "${MEALIO_STOREPASS_FILE:-}" || ! -f "$MEALIO_KEYSTORE" || ! -f "$MEALIO_STOREPASS_FILE" ]]; then
  echo 'Set MEALIO_KEYSTORE and MEALIO_STOREPASS_FILE to private files outside Git.' >&2
  exit 1
fi

TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
BUILD="$(mktemp -d "$ROOT/build.XXXXXXXX")"
mkdir -p "$BUILD/generated" "$BUILD/classes" "$BUILD/dex"

"$TOOLS/aapt2" compile --dir "$ROOT/res" -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -o "$BUILD/unaligned.apk" -I "$PLATFORM" \
  --manifest "$ROOT/AndroidManifest.xml" --java "$BUILD/generated" \
  -R "$BUILD/resources.zip" --auto-add-overlay

javac -source 11 -target 11 -classpath "$PLATFORM" -d "$BUILD/classes" \
  "$BUILD/generated/app/mealio/personal/R.java" \
  "$ROOT/src/app/mealio/personal/MainActivity.java"

classes=()
while IFS= read -r -d '' file; do classes+=("$file"); done < <(find "$BUILD/classes" -name '*.class' -print0)
"$TOOLS/d8" --release --min-api 26 --lib "$PLATFORM" --output "$BUILD/dex" "${classes[@]}"
zip -q -j "$BUILD/unaligned.apk" "$BUILD/dex/classes.dex"
"$TOOLS/zipalign" -f -p 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk"

OUTPUT_APK="${OUTPUT_APK:-$ROOT/../../worktree/Mealio-Android-v2.apk}"
mkdir -p "$(dirname "$OUTPUT_APK")"
"$TOOLS/apksigner" sign --ks "$MEALIO_KEYSTORE" --ks-key-alias mealio \
  --ks-pass "file:$MEALIO_STOREPASS_FILE" \
  --out "$OUTPUT_APK" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$OUTPUT_APK" >/dev/null
echo "Signed and verified APK: $OUTPUT_APK"
