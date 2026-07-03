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
- `TERMINAL_RENDERER_ARTIFACT=/path/to/FenrirTerminalRenderer` bundles the renderer artifact consumed by distribution readiness.
- `TERMINAL_RENDERER_RESOURCES=/path/to/resources` bundles renderer resources as `Contents/Resources/FenrirTerminalResources`.
- `CODESIGN_IDENTITY=...` signs the app bundle with hardened runtime; `CODESIGN_ENTITLEMENTS=...` adds entitlements when needed.

The script validates `Info.plist`, executable resource permissions, and prints the bundle path. Notarization and update-feed publication remain release-pipeline concerns because they require Apple credentials and distribution-channel configuration.
