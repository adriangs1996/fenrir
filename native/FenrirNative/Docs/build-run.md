# Build And Run Notes

The native Swift client is intentionally separate from the existing Bun,
Electron, web, and server workspaces.

## Local Checks

```sh
cd native/FenrirNative
swift build
swift test
swift run FenrirNativeApp
```

When launched from this monorepo, `swift run FenrirNativeApp` does not require a
pre-bundled `SERVER_ASSET`. If no server is already listening on
`127.0.0.1:31337`, the native supervisor starts `apps/server/src/bin.ts` through
`bun`, passes a desktop bootstrap credential to the server, and waits for the
real health endpoint before opening the workspace.

## Repository Gates

From the repository root:

```sh
bun fmt
bun lint
bun typecheck
```

Do not run `bun test`. If Vitest coverage is required for a TypeScript slice,
run `bun run test`.

## Architecture Guardrails

- `NativeHost` is represented by the executable shell and remains the
  composition/delivery boundary.
- Product modules expose specific actions and service ports.
- Raw AppKit objects, renderer handles, auth secrets, server sockets, and pane
  byte buffers do not appear in public DTOs.
- `tmux` workspace/window/pane ownership remains server/kernel-owned.
- `libGhostty` will enter only behind the `TerminalViewport` renderer ports.

## Package The Native App

Before packaging or running a local smoke session, run the native doctor:

```sh
cd native/FenrirNative
MODE=local-smoke bash doctor.sh
```

For release preflight:

```sh
MODE=release \
SERVER_ASSET=/path/to/fenrir-server \
bash doctor.sh
```

`package-app.sh` creates a deterministic macOS `.app` bundle from the SwiftPM
product without requiring Xcode project generation:

```sh
cd native/FenrirNative
bash package-app.sh
```

Useful environment overrides:

- `CONFIGURATION=debug|release` selects the SwiftPM build configuration.
- `OUT_DIR=/path/to/output` chooses where the `.app` bundle is written.
- `SERVER_ASSET=/path/to/fenrir-server` bundles an executable server helper as `Contents/Resources/fenrir-server`.
- `GHOSTTY_TERMINAL_VERSION=...` records the vendored GhosttyTerminal/libghostty runtime version in `Info.plist`.
- `REQUIRE_RELEASE_ASSETS=0|1` overrides the default release gate. Release packaging requires `SERVER_ASSET`; `prefetch-ghosttykit.sh` fetches and checksum-verifies the GhosttyKit binary target before every package build.
- `CODESIGN_IDENTITY=...` signs the app bundle with hardened runtime; `CODESIGN_ENTITLEMENTS=...` adds entitlements when needed.

The script validates `Info.plist`, executable resource permissions, required release assets, and prints the bundle path. Notarization and update-feed publication remain release-pipeline concerns because they require Apple credentials and distribution-channel configuration.
