#!/usr/bin/env bash

# ================================
# This script is used to sign an unsigned F-Droid APK file with the local debug keystore (on MacOS) for testing purposes.
# ================================
# Flow:
# 1. First do the run.sh / build.sh flow to build the F-Droid APK file on a (Linux) machine with enough memory and CPU power.
# 2. Extract the unsigned APK file from the local (bind-mounted) outputs directory
# 3. Then use this script to sign the APK file with the local debug keystore (on MacOS).
#
# ================================

set -euo pipefail

# --- Colors ---
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

info()    { echo -e "${CYAN}[INFO]${RESET} $1"; }
ok()      { echo -e "${GREEN}[OK]${RESET} $1"; }
error()   { echo -e "${RED}[ERROR]${RESET} $1"; }

echo -e "${YELLOW}=== APK Debug Signer (macOS) ===${RESET}"

# --- Unsigned APK: from argument or prompt ---
if [[ -n "${1:-}" ]]; then
  APK_IN="$1"
else
  read -rp "Enter unsigned APK filename (example: app-release-unsigned.apk): " APK_IN
fi

if [[ ! -f "$APK_IN" ]]; then
  error "File not found: $APK_IN"
  exit 1
fi

info "Input APK: $APK_IN"

# --- Detect SDK and build-tools ---
SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
BT_DIR="$SDK_ROOT/build-tools"

if [[ ! -d "$BT_DIR" ]]; then
  error "build-tools not found in: $BT_DIR"
  exit 1
fi

info "Scanning build-tools..."

LATEST_BT="$(ls "$BT_DIR" | sort -V | tail -n 1)"

if [[ -z "$LATEST_BT" ]]; then
  error "No build-tools found."
  exit 1
fi

info "Using build-tools version: ${YELLOW}${LATEST_BT}${RESET}"

ZIPALIGN="$BT_DIR/$LATEST_BT/zipalign"
APKSIGNER="$BT_DIR/$LATEST_BT/apksigner"

[[ -x "$ZIPALIGN" ]]  || { error "zipalign missing: $ZIPALIGN"; exit 1; }
[[ -x "$APKSIGNER" ]] || { error "apksigner missing: $APKSIGNER"; exit 1; }

# --- Filenames ---
APK_ALIGNED="${APK_IN%.apk}-aligned-temp.apk"
APK_SIGNED="${APK_IN%.apk}-signed.apk"

info "Temporary aligned APK: $APK_ALIGNED"
info "Final signed APK:      $APK_SIGNED"

# --- Debug keystore ---
DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
DEBUG_ALIAS="androiddebugkey"
DEBUG_PASS="android"

[[ -f "$DEBUG_KEYSTORE" ]] || {
  error "Debug keystore missing: $DEBUG_KEYSTORE"
  exit 1
}

info "Using debug keystore: $DEBUG_KEYSTORE"

# --- Step 1: zipalign ---
echo -e "${YELLOW}=== Step 1: zipalign ===${RESET}"
echo -e "[CMD] \"$ZIPALIGN\" -p -f 4 \"$APK_IN\" \"$APK_ALIGNED\""

"$ZIPALIGN" -p -f 4 "$APK_IN" "$APK_ALIGNED"
ok "zipalign complete"

# --- Step 2: sign ---
echo -e "${YELLOW}=== Step 2: apksigner ===${RESET}"
echo -e "[CMD] \"$APKSIGNER\" sign --ks \"$DEBUG_KEYSTORE\" --out \"$APK_SIGNED\" \"$APK_ALIGNED\""

"$APKSIGNER" sign \
  --ks "$DEBUG_KEYSTORE" \
  --ks-key-alias "$DEBUG_ALIAS" \
  --ks-pass "pass:$DEBUG_PASS" \
  --key-pass "pass:$DEBUG_PASS" \
  --out "$APK_SIGNED" \
  "$APK_ALIGNED"

ok "Signing complete"

# --- Step 3: verify ---
echo -e "${YELLOW}=== Step 3: Verify ===${RESET}"

"$APKSIGNER" verify --verbose "$APK_SIGNED"
ok "APK verified"

# --- Step 4: Cleanup ---
echo -e "${YELLOW}=== Cleanup ===${RESET}"

if [[ -f "$APK_ALIGNED" ]]; then
  rm -f "$APK_ALIGNED"
  ok "Removed temporary file: $APK_ALIGNED"
fi

ok "Cleanup complete"

echo -e "${GREEN}=== DONE ===${RESET}"
echo -e "Signed APK created → ${YELLOW}$APK_SIGNED${RESET}"
echo -e "Install with:"
echo -e "  ${CYAN}adb install -r \"$APK_SIGNED\"${RESET}"

