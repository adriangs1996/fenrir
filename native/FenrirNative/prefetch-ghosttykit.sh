#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'fenrir-native-ghosttykit: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'fenrir-native-ghosttykit: %s\n' "$*" >&2
}

resolve_script_dir() {
  local source_path
  source_path="${BASH_SOURCE[0]}"
  cd "$(dirname "$source_path")" >/dev/null 2>&1 && pwd
}

SCRIPT_DIR="$(resolve_script_dir)"
PACKAGE_ROOT="${PACKAGE_ROOT:-$SCRIPT_DIR}"
GHOSTTYKIT_VERSION="${GHOSTTYKIT_VERSION:-1.2.8}"
GHOSTTYKIT_URL="${GHOSTTYKIT_URL:-https://github.com/Lakr233/libghostty-spm/releases/download/storage.${GHOSTTYKIT_VERSION}/GhosttyKit.xcframework.zip}"
GHOSTTYKIT_CHECKSUM="${GHOSTTYKIT_CHECKSUM:-eab8ecf086806acd6c0cfa198635c70e8b711c3a4d449bb0eb79b717b3960e24}"
GHOSTTYKIT_ARTIFACT="${GHOSTTYKIT_ARTIFACT:-$PACKAGE_ROOT/.build/ghostty/GhosttyKit.xcframework.zip}"

command -v curl >/dev/null 2>&1 || fail "curl is required on PATH"
command -v swift >/dev/null 2>&1 || fail "swift is required on PATH"

mkdir -p "$(dirname "$GHOSTTYKIT_ARTIFACT")"

if [[ -f "$GHOSTTYKIT_ARTIFACT" ]]; then
  actual="$(swift package compute-checksum "$GHOSTTYKIT_ARTIFACT")"
  if [[ "$actual" == "$GHOSTTYKIT_CHECKSUM" ]]; then
    log "GhosttyKit $GHOSTTYKIT_VERSION already present"
    printf '%s\n' "$GHOSTTYKIT_ARTIFACT"
    exit 0
  fi
  log "removing GhosttyKit artifact with checksum $actual"
  rm -f "$GHOSTTYKIT_ARTIFACT"
fi

tmp="${GHOSTTYKIT_ARTIFACT}.tmp.zip"
rm -f "$tmp"
log "downloading GhosttyKit $GHOSTTYKIT_VERSION"
curl -L --fail --progress-bar "$GHOSTTYKIT_URL" -o "$tmp"

actual="$(swift package compute-checksum "$tmp")"
if [[ "$actual" != "$GHOSTTYKIT_CHECKSUM" ]]; then
  rm -f "$tmp"
  fail "GhosttyKit checksum mismatch: expected $GHOSTTYKIT_CHECKSUM got $actual"
fi

mv "$tmp" "$GHOSTTYKIT_ARTIFACT"
log "GhosttyKit artifact ready: $GHOSTTYKIT_ARTIFACT"
printf '%s\n' "$GHOSTTYKIT_ARTIFACT"
