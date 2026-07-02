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
- The main tab strip represents tmux windows and the main pane grid represents
  tmux panes. Client-only UI must not appear as fake panes.
- Server-backed feature modules define their own service ports and implement
  live adapters over `ServerConnection`; feature actions do not build raw
  transport payloads directly.

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
  - specific actions for `open`, `attach`, `focus`, `list`, `switch`, `control`,
    and `remove`
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
  - Decide whether to open, switch, close, or reconnect a workspace experience.
  - Coordinate between local client state, windows, and server-backed runtime
    setup.
- Public surface:
  - `openWorkspace`
  - `switchWorkspace`
  - `closeWorkspaceExperience`
  - `reconnectWorkspaceExperience`
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
  - Act as the shell-level bridge between workspace keybindings, overlays,
    sidebar activity, and pane-grid focus.
- Public surface:
  - specific shell actions for creating, closing, focusing, sidebar toggling,
    switcher presentation, tab selection, and pane selection
- Allowed dependencies:
  - `PaneGrid`
  - `WorkspaceIndex`
  - `WorkspaceOverlays`
  - `WorkflowControl`
  - `AgentInteraction`
  - `Keybinding`
  - `Notifications`
- Must not know:
  - auth token storage
  - raw IPC server details
  - pane stream buffering internals
  - raw Ghostty types

Detailed design reference:

- `docs/native-terminal-client-workspace-shell-module.md`

### `WorkspaceOverlays`

- Responsibility:
  - Own workspace-scoped native overlay surfaces such as agent composer,
    conversations, diagnostics, help, and keybinding help.
  - Present, focus, close, restore, and optionally pin overlay surfaces.
  - Manage focus return targets so closing an overlay returns to the originating
    pane or shell surface.
  - Expose overlay focus targets to sidebar, palette, and activity surfaces.
- Public surface:
  - specific actions for presenting, focusing, closing, restoring, pinning, and
    listing overlay surfaces
  - focus-target contracts for shell/sidebar/palette integration
- Allowed dependencies:
  - `Keybinding`
  - `Notifications`
- Must not know:
  - terminal bytes
  - raw Ghostty types
  - tmux pane stream internals
  - raw server transport
  - AppKit window registry internals

`WorkspaceOverlays` provides tmux-like keyboard ergonomics for native surfaces
without making those surfaces part of the tmux pane grid.

### `AgentInteraction`

- Responsibility:
  - Own agent composer, terminal-context attachments, conversation transcripts,
    provider/agent selection, response streams, result actions, and promotion to
    workflows.
  - Package terminal context captured from `TerminalViewport` into bounded,
    structured agent prompts.
  - Keep conversations workspace-scoped rather than making chat the primary app
    navigation model.
- Public surface:
  - specific actions for opening a composer, attaching context, sending a
    prompt, streaming a response, continuing a conversation, listing active
    conversations, and promoting a conversation to workflow
  - terminal-context attachment contracts
  - conversation summary contracts for sidebar/palette/notifications
- Allowed dependencies:
  - `WorkspaceOverlays`
  - `Notifications`
  - feature-specific agent/conversation service ports whose live adapters use
    `ServerConnection`
- Must not know:
  - raw Ghostty types
  - terminal renderer internals
  - raw server transport payloads
  - workflow execution internals
  - tmux command strings

Agents do not write directly into user panes in the base native client.

### `WorkflowControl`

- Responsibility:
  - Own native workflow visualization and control for server-backed Fenrir
    workflows.
  - List workflow runs, open run detail, inspect steps/log metadata, answer
    awaiting input, cancel/retry/pause/resume when the server supports it, and
    focus linked pane or overlay surfaces.
  - Project workflow attention state to sidebar, palette, and notifications.
- Public surface:
  - specific actions for listing runs, opening run detail, controlling runs,
    answering input, focusing linked surfaces, and projecting workflow summaries
  - workflow summary/detail contracts for sidebar, overlays, and notifications
- Allowed dependencies:
  - `WorkspaceOverlays`
  - `Notifications`
  - feature-specific workflow service ports whose live adapters use
    `ServerConnection`
  - `NativeRuntime` only through public focus/open linked pane actions when a
    workflow has a tmux pane surface
- Must not know:
  - raw Ghostty types
  - terminal byte stream internals
  - workflow execution engine internals
  - provider-specific agent internals

The Fenrir server executes workflows. `WorkflowControl` is only client-side
visualization, navigation, and control.

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
  - agent conversation transcripts
  - workflow execution state

The pane grid must not contain fake/client-only panes. If a surface appears in
the grid, it must be backed by a real tmux pane or server-kernel pane metadata.

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
  - specific actions for capturing bounded terminal context from selection,
    visible viewport, or last N rendered lines
- Allowed dependencies:
  - `NativeRuntime`
  - `Keybinding`
- Must not know:
  - workspace list semantics
  - window creation/focus policy
  - credential persistence
  - agent provider details
  - workflow execution state

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
  - Own keymap registration, dispatch, tmux keymap import, tmux prefix/key-table
    state, and user override resolution.
  - Import effective tmux keymaps from the runtime/server rather than parsing
    `.tmux.conf` manually.
  - Map known tmux bindings to typed Fenrir actions and report unsupported
    unknown bindings without executing arbitrary tmux command strings.
- Public surface:
  - keybinding registry
  - command dispatch mapping
  - resolved keymap queries
  - imported tmux key table contracts
  - prefix/key-table state-machine actions
- Allowed dependencies:
  - `Settings`
  - `NativeRuntime` service contracts for effective tmux keymap import
- Must not know:
  - terminal bytes
  - raw server transport
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
  - Store versioned local configuration only, not runtime state.
- Public surface:
  - typed settings store
  - read/update/reset actions
- Allowed dependencies:
  - local persistence adapters only
- Must not know:
  - server runtime state
  - terminal renderer implementation
  - AppKit window registry
  - bearer/session secrets
  - terminal scrollback
  - workflow execution state
  - agent transcript authority

Settings may store remote profile metadata, local server bootstrap preferences,
keybinding overrides, sidebar preferences, palette preferences, appearance,
notification preferences, and feature flags. Secrets belong to `AuthSession`.

### `Diagnostics`

- Responsibility:
  - Own native diagnostics and observability policy for the Swift terminal
    client.
  - Record metadata-only operational events for auth, server connection, tmux
    runtime, workflow, keybinding, terminal viewport, and native shell failures.
  - Build safe support-bundle projections.
- Public surface:
  - diagnostic event contracts
  - redaction policy contracts
  - support-bundle report DTOs
  - specific actions for recording events and building support reports
  - palette provider contracts for opening diagnostics surfaces
- Allowed dependencies:
  - `Settings`
  - `WorkspaceOverlays` for palette/overlay integration only
- Must not know:
  - raw terminal text by default
  - auth tokens
  - raw Ghostty types
  - workflow execution internals

Diagnostics may include stream ids, sequence ranges, gap/overflow events,
latency, error tags, pane/workspace ids, and byte counts. Terminal excerpts
require explicit opt-in and redaction policy.

### `NativeDistribution`

- Responsibility:
  - Own native startup-readiness and distribution checks for external tools,
    bundled server assets, and run modes.
  - Distinguish local default, existing local server, and explicit remote
    attach behavior.
- Public surface:
  - `AssessStartupReadiness`
  - startup mode and dependency contracts
  - `TmuxDependencyChecking` and `ServerAssetLocating` service ports
  - live service factories for PATH tmux and app-resource server discovery
- Allowed dependencies:
  - local process/tool discovery adapters
  - app bundle resource discovery adapters
- Must not know:
  - AppKit window internals
  - server auth secrets
  - pane stream state
  - terminal renderer internals

Local default mode verifies local tmux and locates a bundled or configured
Fenrir server asset. Existing-local mode verifies local tmux but does not
require a bundled server asset. Remote attach mode does not require local tmux
or a local server binary because the remote server owns the tmux kernel.

### `NeovimBridge`

- Responsibility:
  - Own native client actions for Neovim panes that run as real tmux
    processes.
  - Coordinate runtime pane focus, optional Neovim bridge calls, active buffer
    discovery, and palette file-open routing.
- Public surface:
  - `OpenFileInNeovim`
  - `FocusNeovimPane`
  - `DetectActiveNeovimState`
  - palette file provider and action executor helpers
- Allowed dependencies:
  - `NativeRuntime` public contracts and service ports
  - `WorkspaceOverlays` palette contracts for optional palette integration
- Must not know:
  - raw tmux command strings
  - raw Ghostty types
  - AppKit window internals
  - agent or workflow execution internals

Neovim is not embedded and is not bundled. If the bridge or `nvim --listen`
integration is unavailable, Neovim remains a normal terminal process inside a
tmux pane.

## Initial Dependency Graph

The intended high-level direction is:

```text
Settings ─────┐
              ├─> Keybinding
              ├─> WorkspaceIndex
              └─> ServerConnection

AuthSession ─────> ServerConnection ─────> NativeRuntime ─────> TerminalViewport ─────> PaneGrid ─────> WorkspaceShell
                                      │              │
                                      │              └────> Keybinding
                                      │
                                      └────> feature service adapters

WorkspaceIndex ───────────────┐
                              ├─> WorkspaceCoordinator
NativeRuntime ────────────────┤
ServerConnection ─────────────┤
WorkspaceShell contracts ─────┘

WorkspaceCoordinator <──── ClientControl

TerminalViewport ─────> AgentInteraction ─────> WorkspaceOverlays
WorkflowControl ───────────────────────────────> WorkspaceOverlays

WorkspaceShell ─────> PaneGrid, WorkspaceOverlays, AgentInteraction,
                      WorkflowControl, WorkspaceIndex, Keybinding,
                      Notifications

NativeHost/application shell ── composes ──> ClientControl,
                                             WorkspaceCoordinator,
                                             WorkspaceShell, AuthSession,
                                             Settings, Notifications,
                                             AgentInteraction, WorkflowControl,
                                             Diagnostics, NativeDistribution,
                                             NeovimBridge

Diagnostics ─────> Settings, WorkspaceOverlays
NativeDistribution ─────> local tool/resource discovery adapters
NeovimBridge ─────> NativeRuntime, WorkspaceOverlays
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
- Send terminal context to agent:
  - keybinding -> `WorkspaceShell` action -> `TerminalViewport` context capture
    action -> `AgentInteraction` composer action -> `WorkspaceOverlays`
    presentation action
- Workflow attention item:
  - sidebar or palette result -> `WorkflowControl` action -> linked
    `WorkspaceOverlays` or `NativeRuntime` focus action

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

- `fenrir open <workspace>` opens or focuses a workspace through the running
  native client's local control socket
- opening a workspace attaches the correct tmux-backed session and renders panes
- switching workspace updates the shell without corrupting pane focus
- pane stream reconnect resumes correctly after server reconnect
- destructive workspace termination is explicit and routed through the server
- terminal context composer opens from selection, viewport, or last N lines
- workflow awaiting input opens the correct overlay or linked pane

## Scope Notes

- Agent conversations belong to `AgentInteraction`, not `WorkflowControl`,
  `Notifications`, `PaneGrid`, or `TerminalViewport`.
- Workflow visualization/control belongs to `WorkflowControl`; workflow
  execution remains server-owned.
- Native overlays belong to `WorkspaceOverlays` and stay outside the tmux pane
  grid.
- Browser-lab and dedicated managed/remote process native surfaces are outside
  the base native roadmap. If they are reintroduced later, update this module
  map before implementation.
- The concrete `libGhostty` embedding wrapper is internal to
  `TerminalViewport`.
