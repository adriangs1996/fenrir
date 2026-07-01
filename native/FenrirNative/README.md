# Fenrir Native Swift Client

This package is the additive Swift foundation for the native Fenrir terminal
client. It does not remove or replace the existing Electron, web, or server
runtime paths.

## Build

```sh
cd native/FenrirNative
swift build
```

## Run The AppKit Shell

```sh
cd native/FenrirNative
swift run FenrirNativeApp
```

The current executable is an AppKit composition shell placeholder. It owns app
startup and window delivery only; renderer, workspace, server, and tmux
integration remain behind product module contracts.

## Test

```sh
cd native/FenrirNative
swift test
```

Repository-wide gates still apply before a task is complete:

```sh
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` for Vitest when TypeScript tests are
needed.

## Layout

```text
Sources/FenrirNativeFoundation/
  Shared/
  Modules/
    AuthSession/
    ServerConnection/
    NativeRuntime/
    TerminalViewport/
    PaneGrid/
    WorkspaceIndex/
    WorkspaceShell/
    WorkspaceCoordinator/
    ClientControl/
Sources/FenrirNativeApp/
Tests/FenrirNativeFoundationTests/
```

Each product module follows the native client convention:

```text
MODULE.md
index.swift
Contracts/
Services/
Actions/
Models/
Layers/
Views/
__tests__/
```

Consumers should use the public module namespace and contracts. Concrete
`Layers` are implementation details and should not become cross-module API.
