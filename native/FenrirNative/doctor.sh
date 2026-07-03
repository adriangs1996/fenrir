#!/usr/bin/env bash
set -euo pipefail

FAILURES=0
WARNINGS=0

log() {
  printf 'fenrir-native-doctor: %s\n' "$*" >&2
}

pass() {
  log "PASS $*"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  log "WARN $*"
}

fail() {
  FAILURES=$((FAILURES + 1))
  log "FAIL $*"
}

resolve_script_dir() {
  local source_path
  source_path="${BASH_SOURCE[0]}"
  cd "$(dirname "$source_path")" >/dev/null 2>&1 && pwd
}

version_at_least() {
  local actual="$1"
  local minimum="$2"
  local actual_major actual_minor minimum_major minimum_minor
  actual_major="${actual%%.*}"
  actual_minor="${actual#*.}"
  actual_minor="${actual_minor%%[^0-9]*}"
  minimum_major="${minimum%%.*}"
  minimum_minor="${minimum#*.}"
  minimum_minor="${minimum_minor%%[^0-9]*}"

  [[ -n "$actual_major" ]] || actual_major=0
  [[ -n "$actual_minor" ]] || actual_minor=0
  [[ -n "$minimum_major" ]] || minimum_major=0
  [[ -n "$minimum_minor" ]] || minimum_minor=0

  if ((actual_major > minimum_major)); then
    return 0
  fi
  if ((actual_major == minimum_major && actual_minor >= minimum_minor)); then
    return 0
  fi
  return 1
}

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    pass "$name is available at $(command -v "$name")"
  else
    fail "$name is required on PATH"
  fi
}

check_executable_file() {
  local label="$1"
  local path="$2"
  if [[ -z "$path" ]]; then
    fail "$label path is required"
  elif [[ ! -e "$path" ]]; then
    fail "$label does not exist: $path"
  elif [[ ! -x "$path" ]]; then
    fail "$label is not executable: $path"
  else
    pass "$label is executable: $path"
  fi
}

check_existing_path() {
  local label="$1"
  local path="$2"
  if [[ -z "$path" ]]; then
    fail "$label path is required"
  elif [[ ! -e "$path" ]]; then
    fail "$label does not exist: $path"
  else
    pass "$label exists: $path"
  fi
}

SCRIPT_DIR="$(resolve_script_dir)"
PACKAGE_ROOT="${PACKAGE_ROOT:-$SCRIPT_DIR}"
MODE="${MODE:-local-smoke}"
MINIMUM_TMUX_VERSION="${MINIMUM_TMUX_VERSION:-3.2}"
SERVER_ASSET="${SERVER_ASSET:-}"
TERMINAL_RENDERER_ARTIFACT="${TERMINAL_RENDERER_ARTIFACT:-}"
TERMINAL_RENDERER_RESOURCES="${TERMINAL_RENDERER_RESOURCES:-}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
REQUIRE_SIGNING="${REQUIRE_SIGNING:-0}"

case "$MODE" in
  local-smoke|release)
    ;;
  *)
    fail "MODE must be local-smoke or release, got '$MODE'"
    ;;
esac

if [[ ! -f "$PACKAGE_ROOT/Package.swift" ]]; then
  fail "PACKAGE_ROOT must point at native/FenrirNative: $PACKAGE_ROOT"
else
  pass "PACKAGE_ROOT points at a Swift package: $PACKAGE_ROOT"
fi

check_command swift
check_command plutil

if command -v tmux >/dev/null 2>&1; then
  tmux_version="$(tmux -V | awk '{print $2}')"
  if version_at_least "$tmux_version" "$MINIMUM_TMUX_VERSION"; then
    pass "tmux $tmux_version satisfies >= $MINIMUM_TMUX_VERSION"
  else
    fail "tmux $tmux_version is older than required $MINIMUM_TMUX_VERSION"
  fi
else
  fail "tmux $MINIMUM_TMUX_VERSION or newer is required for local terminal workspaces"
fi

if [[ "$MODE" == "release" ]]; then
  check_executable_file SERVER_ASSET "$SERVER_ASSET"
  check_executable_file TERMINAL_RENDERER_ARTIFACT "$TERMINAL_RENDERER_ARTIFACT"
  check_existing_path TERMINAL_RENDERER_RESOURCES "$TERMINAL_RENDERER_RESOURCES"
  if [[ -n "$CODESIGN_IDENTITY" ]]; then
    check_command codesign
    pass "CODESIGN_IDENTITY is set"
  elif [[ "$REQUIRE_SIGNING" == "1" ]]; then
    fail "CODESIGN_IDENTITY is required when REQUIRE_SIGNING=1"
  else
    warn "CODESIGN_IDENTITY is unset; package-app.sh can create unsigned bundles, but they are not release artifacts"
  fi
else
  if [[ -n "$TERMINAL_RENDERER_ARTIFACT" ]]; then
    check_executable_file TERMINAL_RENDERER_ARTIFACT "$TERMINAL_RENDERER_ARTIFACT"
  elif [[ "${FENRIR_NATIVE_ALLOW_BOOTSTRAP_TERMINAL:-0}" == "1" ]]; then
    warn "native terminal renderer artifact is absent; explicit bootstrap renderer fallback is enabled for local smoke"
  else
    fail "local smoke needs TERMINAL_RENDERER_ARTIFACT or FENRIR_NATIVE_ALLOW_BOOTSTRAP_TERMINAL=1"
  fi

  if [[ -n "$SERVER_ASSET" ]]; then
    check_executable_file SERVER_ASSET "$SERVER_ASSET"
  else
    warn "SERVER_ASSET is unset; local smoke must attach to an existing local server or use runtime bootstrap outside release packaging"
  fi
fi

if ((FAILURES > 0)); then
  log "doctor completed with $FAILURES failure(s) and $WARNINGS warning(s)"
  exit 1
fi

log "doctor completed with 0 failures and $WARNINGS warning(s)"
