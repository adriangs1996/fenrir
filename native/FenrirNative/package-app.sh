#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'fenrir-native-package: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'fenrir-native-package: %s\n' "$*" >&2
}

resolve_script_dir() {
  local source_path
  source_path="${BASH_SOURCE[0]}"
  cd "$(dirname "$source_path")" >/dev/null 2>&1 && pwd
}

copy_optional_resource() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local mode="$4"

  if [[ -z "$src" ]]; then
    return 0
  fi

  if [[ ! -e "$src" ]]; then
    fail "$label does not exist: $src"
  fi

  rm -rf "$dest"
  if [[ -d "$src" ]]; then
    cp -R "$src" "$dest"
  else
    cp "$src" "$dest"
  fi

  if [[ "$mode" == "executable" && -f "$dest" ]]; then
    chmod 755 "$dest"
  fi
}

write_info_plist() {
  local plist_path="$1"
  cat >"$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>FenrirNativeApp</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_NUMBER</string>
  <key>FenrirTerminalRendererVersion</key>
  <string>$TERMINAL_RENDERER_VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MINIMUM_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
</dict>
</plist>
PLIST
}

SCRIPT_DIR="$(resolve_script_dir)"
PACKAGE_ROOT="${PACKAGE_ROOT:-$SCRIPT_DIR}"
CONFIGURATION="${CONFIGURATION:-release}"
APP_NAME="${APP_NAME:-Fenrir Native}"
BUNDLE_ID="${BUNDLE_ID:-dev.fenrir.native}"
VERSION="${VERSION:-0.1.0}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
MINIMUM_SYSTEM_VERSION="${MINIMUM_SYSTEM_VERSION:-14.0}"
OUT_DIR="${OUT_DIR:-$PACKAGE_ROOT/.build/package}"
SERVER_ASSET="${SERVER_ASSET:-}"
TERMINAL_RENDERER_ARTIFACT="${TERMINAL_RENDERER_ARTIFACT:-}"
TERMINAL_RENDERER_RESOURCES="${TERMINAL_RENDERER_RESOURCES:-}"
TERMINAL_RENDERER_VERSION="${TERMINAL_RENDERER_VERSION:-unknown}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
CODESIGN_ENTITLEMENTS="${CODESIGN_ENTITLEMENTS:-}"
CLEAN="${CLEAN:-1}"
SKIP_SWIFT_BUILD="${SKIP_SWIFT_BUILD:-0}"

case "$CONFIGURATION" in
  debug|release)
    ;;
  *)
    fail "CONFIGURATION must be 'debug' or 'release', got '$CONFIGURATION'"
    ;;
esac

if [[ ! -f "$PACKAGE_ROOT/Package.swift" ]]; then
  fail "PACKAGE_ROOT must point at native/FenrirNative: $PACKAGE_ROOT"
fi

command -v swift >/dev/null 2>&1 || fail "swift is required on PATH"
command -v plutil >/dev/null 2>&1 || fail "plutil is required on PATH"

if [[ "$SKIP_SWIFT_BUILD" != "1" ]]; then
  log "building FenrirNativeApp ($CONFIGURATION)"
  (cd "$PACKAGE_ROOT" && swift build -c "$CONFIGURATION" --product FenrirNativeApp)
fi

BIN_DIR="$(cd "$PACKAGE_ROOT" && swift build -c "$CONFIGURATION" --show-bin-path)"
APP_EXECUTABLE="$BIN_DIR/FenrirNativeApp"
if [[ ! -x "$APP_EXECUTABLE" ]]; then
  fail "FenrirNativeApp executable was not found after build: $APP_EXECUTABLE"
fi

APP_BUNDLE="$OUT_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

if [[ "$CLEAN" == "1" ]]; then
  rm -rf "$APP_BUNDLE"
fi
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$APP_EXECUTABLE" "$MACOS_DIR/FenrirNativeApp"
chmod 755 "$MACOS_DIR/FenrirNativeApp"
copy_optional_resource "$SERVER_ASSET" "$RESOURCES_DIR/fenrir-server" SERVER_ASSET executable
copy_optional_resource "$TERMINAL_RENDERER_ARTIFACT" "$RESOURCES_DIR/FenrirTerminalRenderer" TERMINAL_RENDERER_ARTIFACT executable
copy_optional_resource "$TERMINAL_RENDERER_RESOURCES" "$RESOURCES_DIR/FenrirTerminalResources" TERMINAL_RENDERER_RESOURCES data
write_info_plist "$CONTENTS_DIR/Info.plist"
printf 'APPL????' >"$CONTENTS_DIR/PkgInfo"
plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null

if [[ -n "$SERVER_ASSET" && ! -x "$RESOURCES_DIR/fenrir-server" ]]; then
  fail "bundled fenrir-server is not executable"
fi
if [[ -n "$TERMINAL_RENDERER_ARTIFACT" && ! -x "$RESOURCES_DIR/FenrirTerminalRenderer" ]]; then
  fail "bundled FenrirTerminalRenderer is not executable"
fi

if [[ -n "$CODESIGN_IDENTITY" ]]; then
  command -v codesign >/dev/null 2>&1 || fail "codesign is required when CODESIGN_IDENTITY is set"
  codesign_args=(--force --options runtime --sign "$CODESIGN_IDENTITY")
  if [[ -n "$CODESIGN_ENTITLEMENTS" ]]; then
    [[ -f "$CODESIGN_ENTITLEMENTS" ]] || fail "CODESIGN_ENTITLEMENTS does not exist: $CODESIGN_ENTITLEMENTS"
    codesign_args+=(--entitlements "$CODESIGN_ENTITLEMENTS")
  fi
  codesign "${codesign_args[@]}" "$APP_BUNDLE"
else
  log "created unsigned app bundle; set CODESIGN_IDENTITY for local signing"
fi

log "app bundle ready: $APP_BUNDLE"
printf '%s\n' "$APP_BUNDLE"
