#!/usr/bin/env bash
# Installs the APK on the running emulator, opens it and checks the app is alive and showing its web view.
set -euo pipefail
APK="$1"
PKG=com.techtool4u.kidpool

adb wait-for-device
adb install -r -g "$APK"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 15

adb exec-out screencap -p > smoke-today.png
adb logcat -d > logcat.txt || true

if ! adb shell pidof "$PKG" >/dev/null; then
  echo "App is not running after launch."; exit 1
fi
if grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" logcat.txt; then
  echo "App crashed."; exit 1
fi
if grep -E "Uncaught (TypeError|ReferenceError|SyntaxError)" logcat.txt; then
  echo "JavaScript error during start."; exit 1
fi

# Back should not crash the app.
adb shell input keyevent KEYCODE_BACK
sleep 2
adb logcat -d | grep -q "FATAL EXCEPTION" && { echo "Crash after Back."; exit 1; }
echo "Smoke test passed."
