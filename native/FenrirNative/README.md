# Fenrir Native Swift Client

This package is the additive Swift foundation for the native Fenrir terminal
client. It is built as a macOS terminal emulator first: opening the native app
creates an AppKit shell, uses tmux as the workspace/tab/pane kernel, and keeps
Fenrir workflow and agent surfaces around the terminal instead of replacing the
terminal with a chat UI.

The native client does not remove or replace the existing Electron, web, or
server runtime paths. The Fenrir server remains a separate component for local
and remote use.

## Build

```sh
cd native/FenrirNative
swift build
```

## Run The Native App

```sh
cd native/FenrirNative
swift run FenrirNativeApp
```

The executable opens the native AppKit application. The app behaves like a
terminal app rather than a document editor:

- local default mode opens the native app and connects to the configured local
  Fenrir server endpoint; native-managed server spawn/supervision is future
  distribution work
- existing-local mode attaches to a separately managed local server without
  killing or restarting it
- remote mode is explicit and connects to a named remote profile or endpoint
- one native workspace window maps to one Fenrir workspace
- the tab strip maps to tmux windows
- the pane grid maps to real tmux panes
- command palette, sidebar, settings, diagnostics, agent composer, and workflow
  detail are native auxiliary surfaces, not fake tmux panes

`libGhostty` stays behind `TerminalViewport` and `FenrirTerminalView`.
High-volume terminal bytes do not flow through CLI control, workspace index,
notifications, or generic product command paths.

## CLI Control

The `fenrir` CLI is the local control surface for the running native app. It
uses a Unix-domain socket for small product-control messages and never carries
terminal bytes.

Primary workspace commands:

- `fenrir open <workspace>`: asks the already-running native app to open or
  focus the workspace through the local control socket
- `fenrir attach <workspace>`: explicitly attach/reconnect, mainly for remote
  or advanced flows
- `fenrir focus <workspace>`: focus an already open local workspace window
- `fenrir list workspaces`: list local and server-backed workspace state
- `fenrir remove <workspace>`: remove/close the workspace from host-visible
  native state without documenting this as session termination
- destructive workspace/session actions route through authenticated server
  contracts

If the native app is not running, current CLI control reports `no-app-running`.
Launching the app and replaying a deferred command is a future client-control
capability.

Product commands can also present native surfaces such as the palette,
diagnostics, and workflow detail. Server/admin commands remain server/admin
commands; they are not aliases for native window behavior.

## Workspace UI

The workspace shell is AppKit-owned. SwiftUI is allowed only for contained
auxiliary islands.

- sidebar: operational workspace/activity surface for active, pinned, recent,
  remote/profile, degraded, workflow, agent, and notification state
- palette: `Cmd+P` opens the native palette, defaulting to workspaces; prefixes
  route to `@` actions, `$` files, `%` tabs/panes, `!` workflow/agent attention,
  and `?` help/keybindings
- tmux keybindings: imported from the effective server/runtime keymap where
  available; known bindings map to typed Fenrir actions and unknown command
  strings are not executed by the UI router
- Neovim: runs as a normal tmux pane process; native integration can focus
  panes and open file/range targets when bridge/runtime capabilities are
  available
- agents: terminal context capture is explicit and bounded from selection,
  visible viewport, or last N lines; agents do not write directly into user
  panes in the base native client
- workflows: execution stays on the Fenrir server; native lists, visualizes,
  controls, and focuses workflow runs or linked surfaces

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

For native implementation slices, also run:

```sh
cd native/FenrirNative
swift build
swift test
```

## No-Mock Native App Smoke E2E

The native app smoke e2e launches the real `FenrirNativeApp`, drives it through
the Unix control socket, and uses the real local Fenrir server/tmux RPC path for
pane projection and reconnect. It also verifies Cmd+P palette presentation,
real `tmux list-keys` import for navigation bindings, and agent composer context
capture from last lines and selection without writing agent output into panes.
It is disabled by default because it needs local services.

Required dependencies:

- macOS with a window server available.
- `tmux` 3.2 or newer on `PATH`.
- A local Fenrir server reachable at `127.0.0.1:31337`.
- One bootstrap credential in `FENRIR_NATIVE_BOOTSTRAP_TOKEN`,
  `FENRIR_DESKTOP_BOOTSTRAP_TOKEN`, or `FENRIR_BOOTSTRAP_TOKEN`.

Run it with:

```sh
cd native/FenrirNative
swift build
FENRIR_NATIVE_E2E_SMOKE=1 FENRIR_NATIVE_BOOTSTRAP_TOKEN="$TOKEN" swift test \
  --filter NativeAppSmokeE2ETests
```

Without `FENRIR_NATIVE_E2E_SMOKE=1`, Swift Testing reports the test as disabled.
When explicitly enabled, missing dependencies fail with the concrete missing
prerequisite instead of falling back to mocks.

Workflow timeline observation needs an existing local-server workflow run:

```sh
cd native/FenrirNative
swift build
FENRIR_NATIVE_E2E_WORKFLOW=1 \
FENRIR_NATIVE_BOOTSTRAP_TOKEN="$TOKEN" \
FENRIR_NATIVE_E2E_WORKFLOW_RUN_ID="$RUN_ID" \
swift test --filter NativeAppSmokeE2ETests/nativeAppWorkflowTimelineSmoke
```

Without `FENRIR_NATIVE_E2E_WORKFLOW=1`, Swift Testing reports the workflow
timeline e2e as disabled with the required environment reason.

The CLI-to-native workspace e2e launches the real native app and drives
`fenrir` CLI workspace commands through the local socket. It verifies open,
list, switch, attach, and remove through host-visible workspace state.

```sh
cd apps/server
FENRIR_NATIVE_CLI_E2E=1 bun run test -- cli.test.ts
```

The default server test suite still covers no-app-running and stale-socket CLI
failures without launching the native app.

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
    Settings/
    Keybinding/
    Notifications/
    WorkspaceOverlays/
    AgentInteraction/
    WorkflowControl/
    Diagnostics/
    NativeDistribution/
    NeovimBridge/
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

Product modules expose specific actions and explicit contracts. Do not add a
generic handle-command action when a typed action should exist.

## Distribution Readiness

Fenrir Native keeps the Fenrir server as a separate component. The startup
readiness model distinguishes three modes:

- Local default: the current app connects to the configured local server
  endpoint. Packaged native-managed local server spawn/supervision is future
  distribution work.
- Existing local server: the app verifies local `tmux` for local workspace
  behavior, then attaches to a server managed outside the native app. The
  bundled server asset is not required and must not be killed or restarted by
  the native app.
- Remote attach: the app connects to an explicit remote profile. Local `tmux`
  and local server assets are not required because the remote server owns the
  tmux kernel.

`tmux` is the workspace, tab, and pane kernel for local modes. Startup
readiness reports surface missing or unsupported `tmux` versions as actionable
diagnostics. The default minimum version is `3.2`.

Neovim is not bundled. Neovim panes are regular tmux processes created through
server/runtime capabilities when available; users who need Neovim workflows
must install Neovim separately.

Packaged app resources should include the local Fenrir server binary as
`fenrir-server` and mark it executable. Entitlements/signing should allow the
native app to execute its bundled server helper and establish outbound network
connections for local WebSocket and remote WebSocket/TLS transports. Local CLI
control uses a Unix-domain socket separate from server RPC and never carries
terminal bytes.

## Non-Goals For The Base Native Client

- Browser lab remains an Electron/web capability until separately redesigned.
- Dedicated managed-process and remote-process native surfaces are out of scope;
  if the server exposes them as tmux panes with metadata, the native app renders
  them as normal panes.
- A lazygit-native or hunks-native rewrite is not part of the base terminal
  client. `lazygit`, `hunks`, and similar tools can run as normal tmux pane
  processes.
- Agents do not write directly into user panes without a future explicit
  permission and server capability model.
