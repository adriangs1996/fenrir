# Native Terminal Client Decisions

Status: active decision log for the native Fenrir terminal client.

This document is the source of truth for architectural decisions specific to
the native terminal client that will replace the current Electron terminal UI
over time. It records both accepted decisions and open items that still need a
formal call.

Related references:

- `docs/tmux-session-kernel-architecture.md`
- `docs/native-terminal-client-runtime-boundary.md`
- `docs/native-terminal-capability-map.md`
- `docs/native-terminal-client-module-map.md`

## Product Intent

The target product is not a generic desktop app that happens to embed terminal
views. It is a native terminal application, closer in spirit to Ghostty, but
with Fenrir-native workflow and agent surfaces built into the shell model.

Core product characteristics:

- The terminal is the primary experience, not a secondary tool view.
- `tmux` is the structural substrate for workspace, tab/window, and pane
  identity.
- Agents, workflows, remote processes, browser-lab surfaces, Neovim, and git
  review tools must feel like first-class citizens inside the terminal shell.
- The UI must represent tmux concepts cleanly rather than hide them behind a
  generic document-style desktop app model.
- The app should eventually be strong enough to replace the Electron terminal
  experience, not just complement it.

This product shape biases the implementation toward explicit native view and
window control rather than a primarily declarative UI toolkit.

## Accepted Decisions

### D-001: Native client language

- Status: accepted
- Decision: the native client will be implemented in `Swift`.
- Why:
  - The primary target is a serious native macOS terminal application.
  - The hard problems are platform integration, windowing, input, IME,
    clipboard, accessibility, lifecycle, signing, and distribution.
  - `Swift` is the shortest path to a correct native macOS application around
    `libGhostty`.
- Consequences:
  - The native client is not built around Node or Electron.
  - Any client-side runtime logic needed from the current TypeScript boundary
    will be reimplemented natively in Swift.

### D-002: Session kernel model

- Status: accepted
- Decision: `tmux` is the primary session kernel.
- Why:
  - We want real sessions, windows, panes, reconnect, restore, shell freedom,
    and strong Neovim interoperability.
  - Multiplexing should not be hand-rolled in the Fenrir client.
- Consequences:
  - Workspace/project maps to tmux session.
  - Fenrir tab/window maps to tmux window.
  - Fenrir pane maps to tmux pane.
  - Direct PTY and `node-pty` remain compatibility fallback only.

### D-003: Terminal rendering base

- Status: accepted
- Decision: the native client will use `libGhostty` as the terminal rendering
  base.
- Why:
  - We want a native terminal renderer, not a web terminal embedded in a shell.
  - The renderer must integrate cleanly with the tmux session kernel and native
    windowing stack.
- Consequences:
  - The native host will embed `libGhostty` directly.
  - Terminal viewport behavior will be owned by the native client, while tmux
    remains the session/process kernel.

### D-004: Server separation

- Status: accepted
- Decision: the Fenrir server remains a separate component from the native
  client.
- Why:
  - Remote connections and multiuser operation are non-negotiable.
  - The native client must be able to connect to either a local or remote
    Fenrir server.
- Consequences:
  - The client must support local bootstrap and remote attach.
  - Auth and actor/session binding remain explicit across transports.

### D-015: Uniform module architecture

- Status: accepted
- Decision: the native client must use a strictly uniform module structure with
  explicit contracts, hidden implementation details, and small atomic actions.
- Why:
  - The client is expected to grow across terminal rendering, workspace
    management, pane control, workflows, agent surfaces, git tooling, and local
    client control.
  - A uniform module shape makes new feature work mechanical once boundaries are
    known.
  - It improves fault isolation, makes unit tests cheap, and keeps integration
    tests narrow.
- Required rules:
  - Every module must expose a narrow public interface and hide internal
    implementation details.
  - Inter-module communication must happen through explicit contracts, not
    through internal types or shared mutable implementation state.
  - Actions should be as atomic as practical: one action, one intent, one clear
    effect boundary.
  - Each module must be testable in isolation with mocked dependencies.
  - End-to-end coverage should stay thin and validate integration paths rather
    than replace unit coverage.
- Standard module shape:
  - `MODULE.md`
    - purpose
    - public API
    - dependencies consumed
    - events emitted/consumed
    - filesystem layout
    - testing guidance
  - `Contracts/`
    - public DTOs, commands, queries, events, errors
  - `Services/`
    - public protocol interfaces consumed by other modules
  - `Layers/`
    - live implementations and dependency wiring
  - `Actions/`
    - small use-case operations with narrow inputs and outputs
  - `Models/`
    - internal state models that do not leak across module boundaries
  - `Views/` or `Components/`
    - UI surfaces, if the module owns any
  - `__tests__/`
    - isolated tests for contracts, actions, services, and integration seams
- Structural rules:
  - Consumers import only the module barrel/public surface, never internals.
  - `Contracts` may be shared; `Models` may not.
  - `Actions` depend on `Services` contracts, never on concrete `Layers`.
  - `Layers` may depend inward, but other modules must not depend on them
    directly.
  - If a module has UI, the UI must call `Actions` or public `Services`, not
    reach into internal storage or implementation details.
- Consequences:
  - Before implementing major native-client features, we should define the
    canonical module template once and reuse it everywhere.
  - Feature work should prefer adding a new action inside an existing module or
    a new module following the same structure, rather than ad hoc files.

### D-016: Canonical native-client module map

- Status: accepted
- Decision: the native client will follow the canonical module map defined in
  `docs/native-terminal-client-module-map.md`.
- Why:
  - The client needs stable ownership boundaries before implementation starts.
  - Workspace shell, runtime, control, server connection, and renderer concerns
    must not collapse into a single AppKit layer.
- Consequences:
  - New native-client implementation work should be assigned either to a
    canonical product module or to the outer application shell before code is
    written.
  - If a new concern does not fit the map cleanly, we should update the module
    map explicitly rather than add ad hoc structure.

## Open Decisions

### D-005: Native UI shell

- Status: accepted
- Decision: use `AppKit` for the primary native shell and allow `SwiftUI` only
  for secondary surfaces.
- Final choice:
  - `AppKit` owns the main terminal shell, windowing, pane layout, focus,
    key routing, resize behavior, and terminal embedding surfaces.
  - `SwiftUI` is allowed for settings, onboarding, account/auth, lightweight
    inspectors, and other non-terminal auxiliary UI.
- Why this matters:
  - It defines how much control we have over complex pane layout, first
    responder handling, key routing, resizing, and terminal integration.
  - It determines whether the app is built like a terminal emulator with
    product surfaces, or like a desktop product that embeds terminals.
- Rationale:
  - A tmux-native shell with pane splits, key routing, modal overlays, resize
    control, native terminal embedding, and strong focus semantics is a better
    fit for `AppKit` than for a SwiftUI-first shell.
  - The target product is a terminal emulator with Fenrir-native agent and
    workflow surfaces, not a generic desktop app that embeds terminal widgets.
  - `SwiftUI` remains useful, but it should not own the primary shell where
    input correctness, view coordination, and renderer integration are critical.
- Consequences:
  - The native client architecture should center around `NSWindow`,
    `NSViewController`, and `NSView` composition for the shell.
  - Any future SwiftUI usage must be additive and must not become the owner of
    pane layout or terminal focus behavior.

### D-006: Native host embedding boundary

- Status: open
- Decision to make: embed `libGhostty` directly everywhere vs isolate it behind
  a thin internal host abstraction such as `FenrirTerminalView`.
- Current recommendation:
  - Create a thin internal wrapper so the rest of the app does not depend on
    raw `libGhostty` embedding details.

### D-007: Local server bootstrap model

- Status: open
- Decision to make:
  - connect only to an existing local server,
  - always spawn a local server,
  - or support both.
- Current recommendation:
  - Support both, with automatic bootstrap when no local server is already
    running.

### D-008: Local transport boundary

- Status: open
- Decision to make: local client/server transport over Unix domain socket vs
  localhost TCP.
- Current recommendation:
  - Prefer Unix domain socket for local communication if it fits current server
    constraints cleanly; otherwise use localhost TCP with explicit auth/session
    binding.

### D-009: Native client runtime implementation

- Status: open
- Decision to make: port the current TypeScript runtime behavior directly to
  Swift vs first freeze a stricter protocol/runtime spec and implement Swift
  against it.
- Current recommendation:
  - Freeze the behavioral spec first, then implement the native runtime in
    Swift.

### D-010: Window and pane ownership model

- Status: accepted
- Decision:
  - `1 native window = 1 workspace`
  - `1 workspace = 1 tmux session`
  - in-app tabs map to `tmux windows`
  - visible splits map to `tmux panes`
- Final choice:
  - The main pane grid must represent real tmux panes, not a parallel
    client-only split model.
  - Native macOS window tabs are not the primary product model; Fenrir owns the
    workspace and tab presentation inside the app shell.
  - The client must support these workspace operations:
    - open or create workspace
    - attach existing workspace in a new window
    - switch to another workspace by focusing its existing window or opening a
      new window for it
    - close window without destroying the workspace session
    - explicitly terminate the workspace session
    - forget a workspace from local recents/favorites without deleting server
      state
  - Closing a window defaults to detaching that viewport only.
  - Destroying a workspace session is an explicit destructive action.
  - Removing a workspace entry from recents/favorites is distinct from killing
    the tmux session.
  - Workspace switching must be first-class in the UI and keyboard model:
    - a collapsible sidebar may show known workspaces and important workspace
      notifications when visible
    - the app must provide a quick-open style workspace switcher
    - keybindings for workspace switching are required because this operation is
      frequent and should follow tmux-friendly conventions where practical
- Rationale:
  - This keeps Fenrir's visible shell aligned with the real tmux kernel model,
    avoiding dual ownership of tabs, panes, focus, resize, and restore.
  - Treating workspaces as window-scoped keeps the product mental model clean:
    one project/session context per main window.
  - Workspace switching is frequent enough that it cannot depend on a single UI
    affordance. Sidebar, commands, and keybindings should all exist.
- Consequences:
  - Workspace UX must distinguish viewport lifecycle from session lifecycle.
  - The client needs a workspace index model for sidebar, command-list, and
    switcher surfaces.
  - The CLI and native client control surfaces should eventually align around
    the same workspace operations.
  - Workspace metadata shown in the sidebar/switcher is intentionally left open
    for a later decision.

### D-011: Resize authority

- Status: open
- Decision to make: who owns authoritative `cols/rows` under focus changes,
  split drag, multiple attached clients, zoom, and restore.
- Current recommendation:
  - The active visible viewport should be the authority for pane size, with
    explicit policy for passive observers and multi-attach cases.

### D-012: Scrollback ownership

- Status: open
- Decision to make how scrollback is divided across tmux, `libGhostty`, and
  client-local state.
- Current recommendation:
  - Treat tmux plus the pane stream replay contract as the durable source for
    reconnect/backfill semantics.
  - Keep renderer-local scrollback strictly a viewport concern, not the durable
    replay contract.

### D-013: Neovim integration model

- Status: open
- Decision to make: terminal-only Neovim integration vs terminal-first plus
  optional Fenrir/Neovim bridge.
- Current recommendation:
  - Neovim runs as a real tmux pane process first.
  - Any deeper integration should be optional and layered on top later.

### D-014: CLI as native client control surface

- Status: open
- Decision to make: whether the `fenrir` CLI should be able to control what the
  running native client opens and focuses, or whether it should stay limited to
  server/admin actions.
- Current recommendation:
  - The `fenrir` CLI should be the control surface for both server operations
    and native client operations.
  - Commands such as `fenrir open <workspace>`, `fenrir attach <workspace>`,
    `fenrir list workspaces`, and `fenrir focus <workspace>` should target the
    running native client when one exists.
  - If no native client is running, `fenrir open <workspace>` should launch the
    client and open or attach the requested workspace.
  - The CLI must not manipulate terminal bytes directly; it should use a local
    client control channel plus the authenticated Fenrir server contracts.
- Why this matters:
  - It defines whether Fenrir behaves like a real terminal application that can
    be driven from the shell, or like an isolated GUI with a separate admin
    CLI.
  - It also determines the need for a local single-instance client control
    channel.
- Proposed native-client control model:
  - The native app should behave as a single logical client instance for local
    control operations.
  - The `fenrir` CLI should first try to contact the running local client over
    a dedicated local control channel.
  - If no client is reachable, the CLI should launch the native app and pass an
    initial command payload for deferred execution on startup.
  - The local control channel should be separate from Fenrir server RPC and
    separate from tmux-kernel admin commands.
  - The IPC listener/adapter belongs to the outer application shell
    (`NativeHost`), while the product command actions belong to the
    `ClientControl` module.
- Proposed command surface:
  - `fenrir open <workspace>`: open the workspace, focusing an existing window
    if it is already attached locally unless `--new-window` is requested
  - `fenrir attach <workspace>`: attach the workspace in a new window even if it
    is already open elsewhere
  - `fenrir focus <workspace>`: focus the existing local workspace window,
    failing if it is not open locally
  - `fenrir list workspaces`: list locally known workspaces and indicate whether
    they are open, attachable, or only known from recents/favorites
  - `fenrir terminate <workspace>`: explicit destructive action routed through
    the authenticated server/session-kernel layer, not through raw local client
    state alone
- Proposed routing rules:
  - Product commands target the local native client first.
  - The native client then talks to the Fenrir server and tmux kernel as
    needed.
  - Admin commands such as `fenrir tmux-kernel ...` remain server/admin tools
    and are not aliases for product-window behavior.
- Proposed transport direction:
  - Prefer a local single-instance control channel based on a Unix domain
    socket or equivalent process-local IPC primitive.
  - Do not use this channel for terminal bytes or high-volume pane streams.
  - Use it only for small product-control messages such as open, focus, attach,
    list, and activate window.

## Decision Order

Recommended order for the next discussions:

1. D-005 `AppKit` only vs `AppKit + SwiftUI`
2. D-010 window/tab/pane ownership model
3. D-011 resize authority
4. D-012 scrollback ownership
5. D-007 local server bootstrap model
6. D-008 local transport boundary
7. D-009 native runtime implementation strategy
8. D-006 `libGhostty` embedding wrapper boundary
9. D-013 Neovim integration depth

## Decision Rules

When a decision is accepted, update this document with:

- status
- final choice
- rationale
- consequences for packaging, runtime behavior, and migration

Do not record temporary implementation shortcuts here as architecture decisions.
