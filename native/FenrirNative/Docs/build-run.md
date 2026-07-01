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
