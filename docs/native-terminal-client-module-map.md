# Native Terminal Client Module Map

Status: canonical module map for the native Fenrir terminal client.

This document defines the intended module boundaries for the native client. It
exists to make feature work repeatable, enforce a uniform structure, and keep
fault isolation clear.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/tmux-session-kernel-architecture.md`
- `docs/native-terminal-client-runtime-boundary.md`

## Goals

- Every module has one clear responsibility.
- Every module has the same internal shape.
- Public contracts are explicit and narrow.
- Internal models do not leak across module boundaries.
- Most behavior is covered by unit tests close to the module.
- End-to-end tests stay few and validate integration seams only.

## Dependency Rules

- Modules depend only on public contracts of other modules.
- Modules never import another module's internal `Models`, `Layers`, or test
  helpers.
- The public interface a caller uses should normally be `Actions`/use cases.
- `Services` are dependency-inversion ports, not the default caller-facing API.
- `Actions` depend on `Services` contracts, never on concrete implementations.
- `Layers` are wiring details and must not be imported from outside the module.
- UI modules call `Actions` or public `Services`; they do not mutate another
  module's internals.
- High-volume terminal bytes never travel through generic client-control or
  workspace-index paths.

## Standard Module Shape

Every module should use the same structure:

```text
<Module>/
  MODULE.md
  index.swift
  Contracts/
  Services/
  Actions/
  Models/
  Layers/
  Views/        # or Components/ when the module owns UI
  __tests__/
```

Expected contents:

- `MODULE.md`: purpose, public API, dependencies, emitted events, testing notes
- `Contracts/`: public commands, queries, DTOs, events, errors
- `Services/`: dependency-inversion ports consumed by actions or exposed for
  composition boundaries when necessary
- `Actions/`: atomic use cases with one intent each
- `Models/`: internal state types that never leak across modules
- `Layers/`: live implementations, adapters, composition wiring
- `Views/` or `Components/`: AppKit/SwiftUI views owned by the module
- `__tests__/`: unit tests first, focused integration tests second

## Architecture Shape

The native client should not treat every top-level concern as a business
module. There are two different things here:

- product modules
  - vertical business or product contexts with stable public contracts
- application shell
  - the outer composition layer that wires modules together and hosts delivery
    mechanisms such as AppKit and CLI entrypoints

`NativeHost` belongs to the application shell, not to the canonical set of
product modules.

## Application Shell

### `NativeHost` (application shell, not a product module)

- Responsibility:
  - Own the application lifecycle and top-level AppKit composition.
  - Create and destroy native windows.
  - Route launch intents into the rest of the client.
  - Act as the composition root for module wiring.
  - Expose delivery adapters such as the local IPC listener for product
    commands.
- Public surface:
  - app lifecycle service
  - window registry service
  - launch-intent router
- Allowed dependencies:
  - all public module contracts needed for composition
- Must not own:
  - business rules for workspace lifecycle
  - runtime stream semantics
  - server transport decisions
  - renderer-specific state transitions

This is the outer application layer in Clean Architecture terms. It is closer
to a composition root plus delivery shell than to a business module. It may
look superficially similar to controllers in frameworks like Rails, but the
important constraint is that it should orchestrate and compose, not contain the
core use-case logic.

## Canonical Product Modules

### `ClientControl`

- Responsibility:
  - Define and execute product use cases initiated through local client-control
    commands.
  - Validate typed action inputs and call the downstream product ports needed by
    each action.
- Public surface:
  - typed command contracts
  - specific actions for `open`, `attach`, `focus`, `list`, and `terminate`
- Allowed dependencies:
  - `WorkspaceCoordinator`
  - `WorkspaceIndex`
- Must not know:
  - IPC socket/server lifecycle
  - AppKit window internals
  - tmux pane bytes
  - credential storage internals

Detailed design reference:

- `docs/native-terminal-client-client-control-module.md`

### `WorkspaceCoordinator`

- Responsibility:
  - Orchestrate workspace-level product actions.
  - Decide whether to open, focus, attach, terminate, or forget a workspace.
  - Coordinate between local client state, windows, and server-backed runtime
    setup.
- Public surface:
  - `openWorkspace`
  - `attachWorkspace`
  - `focusWorkspace`
  - `terminateWorkspace`
  - `forgetWorkspace`
- Allowed dependencies:
  - `WorkspaceIndex`
  - `ServerConnection`
  - `NativeRuntime`
  - `NativeHost` contracts only
- Must not know:
  - concrete `NSView` layout
  - `libGhostty` details
  - keybinding implementation details

Detailed design reference:

- `docs/native-terminal-client-workspace-coordinator-module.md`

### `WorkspaceIndex`

- Responsibility:
  - Track known workspaces, recents, favorites, and local open-state summary.
  - Feed the sidebar, switcher, and CLI listing surface.
- Public surface:
  - specific actions for workspace list queries
  - specific actions for recent/favorite mutations
  - specific actions for open-state summary updates
- Allowed dependencies:
  - `Settings`
  - `ServerConnection`
- Must not know:
  - pane layout
  - terminal renderer state
  - AppKit window objects

Detailed design reference:

- `docs/native-terminal-client-workspace-index-module.md`

### `WorkspaceShell`

- Responsibility:
  - Own one workspace window and its high-level shell UI.
  - Coordinate sidebar, tab strip, switcher invocation, and pane-grid hosting.
- Public surface:
  - specific shell actions for creating, closing, focusing, sidebar toggling,
    switcher presentation, tab selection, and pane selection
- Allowed dependencies:
  - `PaneGrid`
  - `WorkspaceIndex`
  - `Keybinding`
  - `Notifications`
- Must not know:
  - auth token storage
  - raw IPC server details
  - pane stream buffering internals

Detailed design reference:

- `docs/native-terminal-client-workspace-shell-module.md`

### `PaneGrid`

- Responsibility:
  - Render the visible split hierarchy for the active tmux window.
  - Route focus and resize actions between shell UI and pane viewports.
- Public surface:
  - specific actions for grid creation, disposal, layout application, pane
    focus, directional focus, split resize, and zoom
- Allowed dependencies:
  - `TerminalViewport`
  - `Keybinding`
- Must not know:
  - workspace recents/favorites
  - auth/session issuance
  - local CLI control channel

Detailed design reference:

- `docs/native-terminal-client-pane-grid-module.md`

### `TerminalViewport`

- Responsibility:
  - Own a single terminal viewport bound to a tmux pane.
  - Translate input, selection, resize, scroll, and renderer lifecycle into
    runtime operations.
- Public surface:
  - specific actions for viewport creation, disposal, focus, output
    application, input, resize, copy, paste, and selection clearing
- Allowed dependencies:
  - `NativeRuntime`
  - `Keybinding`
- Must not know:
  - workspace list semantics
  - window creation/focus policy
  - credential persistence

Detailed design reference:

- `docs/native-terminal-client-terminal-viewport-module.md`

### `NativeRuntime`

- Responsibility:
  - Implement the native client runtime boundary in Swift.
  - Own attach/detach/reconnect, pane stream state, replay handling, and write
    acknowledgements.
- Public surface:
  - specific actions for capability discovery, workspace attach/detach/reconnect,
    pane attach, stream reconnect, pane input, pane resize, and pane close
- Allowed dependencies:
  - `ServerConnection`
  - terminal kernel contracts
- Must not know:
  - AppKit views
  - sidebar or shell presentation
  - local single-instance control server

Detailed design reference:

- `docs/native-terminal-client-native-runtime-module.md`

### `ServerConnection`

- Responsibility:
  - Own authenticated communication with the Fenrir server.
  - Resolve local or remote server endpoints.
  - Manage transport session lifecycle, heartbeat, reconnect, request timeout,
    and stream handles.
  - Translate low-level transport failures into stable client errors.
- Public surface:
  - specific actions for endpoint resolution, session open/close/refresh,
    reconnect, capability query, typed requests, typed streams, and connection
    health
- Allowed dependencies:
  - `AuthSession`
  - `Settings`
- Must not know:
  - pane layout
  - terminal renderer internals
  - workspace switcher UI
  - local server process supervision

Detailed design reference:

- `docs/native-terminal-client-server-connection-module.md`

### `AuthSession`

- Responsibility:
  - Own native client auth session state.
  - Own secure credential persistence, local/remote pairing bootstrap,
    bearer-session lookup/refresh, WebSocket token issuance, explicit actor
    construction, and session revocation.
- Public surface:
  - specific actions for auth policy discovery, local bootstrap, remote pairing,
    session load/refresh, WebSocket token issuance, actor construction, session
    listing/revocation, and local credential clearing
- Allowed dependencies:
  - system keychain and secure storage adapters
  - narrow auth HTTP endpoint adapters
- Must not know:
  - pane state
  - workspace window state
  - terminal stream behavior
  - server transport session lifecycle

Detailed design reference:

- `docs/native-terminal-client-auth-session-module.md`

### `Keybinding`

- Responsibility:
  - Own keymap registration, dispatch, tmux-friendly defaults, and user
    override resolution.
- Public surface:
  - keybinding registry
  - command dispatch mapping
  - resolved keymap queries
- Allowed dependencies:
  - `Settings`
- Must not know:
  - terminal bytes
  - server transport
  - workspace persistence internals

### `Notifications`

- Responsibility:
  - Own user-facing notifications, badges, and non-terminal alerts.
- Public surface:
  - notification publishing
  - workspace-scoped notification state
- Allowed dependencies:
  - none beyond system notification adapters and `Settings` if needed
- Must not know:
  - pane stream transport
  - CLI control channel

### `Settings`

- Responsibility:
  - Own local persisted user preferences and client configuration.
- Public surface:
  - typed settings store
  - read/update/reset actions
- Allowed dependencies:
  - local persistence adapters only
- Must not know:
  - server runtime state
  - terminal renderer implementation
  - AppKit window registry

## Initial Dependency Graph

The intended high-level direction is:

```text
Settings ─────┐
              ├─> Keybinding
              ├─> WorkspaceIndex
              └─> ServerConnection

AuthSession ─────> ServerConnection ─────> NativeRuntime ─────> TerminalViewport ─────> PaneGrid ─────> WorkspaceShell

WorkspaceIndex ───────────────┐
                              ├─> WorkspaceCoordinator
NativeRuntime ────────────────┤
ServerConnection ─────────────┤
WorkspaceShell contracts ─────┘

WorkspaceCoordinator <──── ClientControl

NativeHost/application shell ── composes ──> ClientControl, WorkspaceCoordinator, WorkspaceShell, AuthSession, Settings, Notifications
```

`NativeHost` is the composition root, not a dumping ground for business logic.

## Traceability Rule

Feature execution should be easy to trace because each path follows the same
shape:

```text
entrypoint -> module action -> service contract -> layer/adapter -> state/result -> view model -> UI
```

Examples:

- CLI product command:
  - `fenrir open <workspace>` -> `NativeHost` IPC adapter -> `ClientControl`
    action -> `WorkspaceCoordinator` action -> `ServerConnection` /
    `NativeRuntime` services -> `WorkspaceShell` update
- Window/UI command:
  - keybinding -> `WorkspaceShell` action -> `WorkspaceCoordinator` or
    `PaneGrid` action -> downstream service contracts
- Pane input:
  - AppKit event -> `TerminalViewport` action -> `NativeRuntime` service ->
    `ServerConnection`

The application shell may start these flows, but it should not be where the
feature logic lives.

## Testing Strategy

Per-module expectations:

- `Contracts/`: schema and serialization tests
- `Actions/`: unit tests with mocked `Services`
- `Services/`: protocol conformance tests only where useful
- `Layers/`: thin adapter tests around system/transport boundaries
- `Views/` or `Components/`: focused interaction tests, not full-system tests

Expected end-to-end coverage stays small. The first e2e paths should be:

- `fenrir open <workspace>` launches or focuses the native client correctly
- opening a workspace attaches the correct tmux-backed session and renders panes
- switching workspace updates the shell without corrupting pane focus
- pane stream reconnect resumes correctly after server reconnect
- destructive workspace termination is explicit and routed through the server

## Scope Notes

- Operational pane presentation for agents, workflows, browser-lab, and remote
  processes can initially live in `WorkspaceShell` and `PaneGrid`.
- If that surface becomes large, extract a dedicated module later rather than
  leaking product-specific logic into `TerminalViewport` or `NativeRuntime`.
- The concrete `libGhostty` embedding wrapper remains subject to `D-006`. Until
  that decision is closed, keep that detail internal to `TerminalViewport`.
