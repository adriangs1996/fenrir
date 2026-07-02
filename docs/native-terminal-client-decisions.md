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
- Agents, workflows, Neovim, terminal context capture, and future git/review
  tools must feel like first-class citizens inside the terminal shell.
- Agent CLIs (Claude Code, Codex, Cursor, OpenCode, and future providers) run
  as normal processes inside tmux panes with their own TUIs. Fenrir Native is a
  different interface to Fenrir, not a port of the Electron chat experience: it
  does not reproduce a native chat view. It integrates pane-hosted agents from
  the outside through provisioned hooks, skills, and MCP configuration, and it
  orchestrates the workspace around them (see D-037 through D-040).
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
  - The native client will embed `libGhostty` behind a Fenrir-owned viewport
    wrapper.
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
  - SwiftUI may render contained auxiliary islands only when AppKit remains the
    owner of shell focus, key routing, pane layout, and terminal embedding.

### D-006: Native host embedding boundary

- Status: accepted
- Decision: isolate `libGhostty` behind a thin internal `FenrirTerminalView`
  boundary owned by `TerminalViewport`.
- Final choice:
  - Modules outside `TerminalViewport` must not import raw Ghostty types.
  - Ghostty surface lifecycle, renderer input, IME, selection, clipboard,
    resize, search, scrollback integration, and diagnostics stay behind the
    wrapper.
  - Tests should be able to use fake renderer ports without loading Ghostty.
- Consequences:
  - Features that need renderer behavior must first be modeled as Fenrir
    viewport capabilities.
  - The rest of the app remains insulated from C/Ghostty/AppKit implementation
    details.

### D-007: Local server bootstrap model

- Status: accepted
- Decision: support both connecting to an existing local server and
  auto-bootstrapping a local server when no healthy local server is available.
- Final choice:
  - The behavior should be similar in spirit to the existing Electron app: local
    use should not require manually starting another process first.
  - Local server bootstrap/supervision belongs to `NativeHost` or a narrow
    native supervisor adapter, not to `ServerConnection`.
  - Remote profiles do not spawn local servers.
  - Servers not spawned by Fenrir Native are not killed or aggressively
    restarted by Fenrir Native.
- Consequences:
  - Native packaging must include or manage a compatible local server component.
  - Startup must include discovery, readiness probing, compatibility checks, and
    visible degraded states.

### D-008: Local transport boundary

- Status: accepted
- Decision: use a pragmatic split between local client control and Fenrir server
  RPC.
- Final choice:
  - `fenrir` CLI to native app control uses a local Unix domain socket.
  - Native app to local Fenrir server uses authenticated WebSocket/TCP
    initially.
  - Native app to remote Fenrir server uses authenticated WebSocket/TLS.
  - Unix socket transport for the server can be added later if it fits cleanly,
    but it does not block the native app.
- Consequences:
  - CLI control IPC is separate from Fenrir server RPC.
  - Terminal bytes never travel through local client-control IPC.
  - Localhost transport is never treated as implicit auth.

### D-009: Native client runtime implementation

- Status: accepted
- Decision: freeze a versioned runtime protocol/spec before implementing the
  live Swift `NativeRuntime`.
- Final choice:
  - Swift does not port the TypeScript runtime as the source of truth.
  - Swift implements request/response, stream envelopes, cursor/replay,
    gap/overflow, write acknowledgement, resize, attach/detach/reconnect,
    capability, error, and version semantics from the shared spec.
  - TypeScript and Swift clients should be comparable against the same
    behavioral contract during migration.
- Consequences:
  - Initial wiring waits for a stricter protocol document.
  - The server/client boundary becomes stable enough for native, web, Electron,
    CLI, remote, workflows, and future clients.

### D-010: Window and pane ownership model

- Status: accepted
- Decision:
  - `1 native window = 1 workspace`
  - `1 workspace runtime session = 1 tmux session`
  - in-app tabs map to `tmux windows`
  - visible splits map to `tmux panes`
- Final choice:
  - The main pane grid must represent real tmux panes, not a parallel
    client-only split model.
  - The main tab strip must represent real tmux windows.
  - Client-only panels, overlays, command palettes, settings, and inspectors do
    not appear inside the pane grid.
  - Native macOS window tabs are not the primary product model; Fenrir owns the
    workspace and tab presentation inside the app shell.
  - For the local product experience, a workspace has one primary native window.
  - Multiple local windows attached to the same workspace are an advanced
    explicit mode, not normal product flow.
  - The client must support these workspace operations:
    - open or create workspace
    - switch to another workspace by focusing its existing window or opening it
      if not visible
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
  - Tmux tabs and panes should solve workspace-internal layout. AppKit windows
    should not become a second layout system above tmux.
  - Workspace switching is frequent enough that it cannot depend on a single UI
    affordance. Sidebar, commands, and keybindings should all exist.
- Consequences:
  - Workspace UX must distinguish viewport lifecycle from session lifecycle.
  - The client needs a workspace index model for sidebar, command-list, and
    switcher surfaces.
  - The CLI and native client control surfaces should eventually align around
    the same workspace operations.
  - Workspace metadata shown in the sidebar/switcher follows the operational
    sidebar model: active, pinned, recent, profile grouping, degraded state, and
    attention signals.

### D-011: Resize authority

- Status: accepted
- Decision: tmux runtime sessions are actor-scoped by default, and resize
  authority is resolved only among attachments for the same actor/session.
- Final choice:
  - Workspace runtime identity includes server profile, tenant/org, actor/user,
    and project/workspace.
  - Two different users connected to the same Fenrir server do not share tmux
    sessions, tabs, panes, or processes by default.
  - Shared sessions are a future explicit feature with their own
    `sharedSessionId`, permissions, resize policy, and write policy.
  - Within one actor's runtime session, the focused visible viewport is the
    resize authority.
  - Background, minimized, hidden, and passive observers do not send competing
    resize commands.
  - Resize commands should carry viewport/layout epoch information so the server
    can reject stale races.
- Consequences:
  - Multiuser ambiguity is removed from the default tmux model.
  - Native, Electron/web, and remote clients for the same user still need
    deterministic resize conflict handling.

### D-012: Scrollback ownership

- Status: accepted
- Decision: durable replay belongs to tmux plus the server pane-stream contract;
  Ghostty/local viewport scrollback is cache/UX only.
- Final choice:
  - `NativeRuntime` tracks `seq`, cursor, gap, overflow, and stream close state.
  - Reconnect requests backfill from the last valid cursor when available.
  - If no valid cursor exists, the client subscribes from `latest`.
  - Renderer-local scrollback may be lost when a viewport is destroyed without
    corrupting runtime state.
  - Long-term durable terminal history, if needed later, must be a separate
    server/product contract.
- Consequences:
  - The client must surface `gap` and `overflow` explicitly.
  - Local settings must not store terminal scrollback.

### D-013: Neovim integration model

- Status: accepted
- Decision: Neovim runs as a real tmux pane process, but native Fenrir
  integration is part of the base design.
- Final choice:
  - Fenrir creates, focuses, and reconnects Neovim panes through the tmux
    runtime.
  - Neovim launch is bootstrapped with workspace, server, tab, pane, actor, and
    optional `nvim --listen` metadata.
  - A bridge/plugin or `nvim --listen` integration should provide file, cursor,
    selection, diagnostics, and controlled command context where available.
  - If the bridge fails, the pane degrades to normal terminal Neovim without
    breaking the session.
- Consequences:
  - Neovim is not a native embedded widget.
  - The nominal product experience should still feel native: files can be
    opened from palette/sidebar/agent/workflow surfaces into Neovim, and editor
    context can be exposed to agents when available.

### D-014: CLI as native client control surface

- Status: accepted
- Decision: the `fenrir` CLI is the unified control surface for product-level
  native app commands and server/admin commands, with strict routing rules.
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
  - If no client is reachable, the current implementation reports
    `no-app-running`. Launching the native app and passing an initial deferred
    command is future client-control work.
  - The local control channel should be separate from Fenrir server RPC and
    separate from tmux-kernel admin commands.
  - The IPC listener/adapter belongs to the outer application shell
    (`NativeHost`), while the product command actions belong to the
    `ClientControl` module.
- Proposed command surface:
  - `fenrir open <workspace>`: open the workspace, focusing an existing window
    if it is already open locally
  - `fenrir attach <workspace>`: attach to the workspace runtime when needed for
    remote/reconnect/advanced flows; locally it should not create duplicate
    windows by default
  - `fenrir focus <workspace>`: focus the existing local workspace window,
    failing if it is not open locally
  - `fenrir list workspaces`: list locally known workspaces and indicate whether
    they are open, attachable, or only known from recents/favorites
  - `fenrir remove <workspace>`: remove or close the host-visible workspace
    entry without documenting it as tmux session termination
  - Future destructive session termination must be routed through the
    authenticated server/session-kernel layer, not through raw local client state
    alone.
  - `fenrir nvim <path>` and file-oriented commands may route to the native app
    and then to the Neovim integration when available.
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

### D-017: Product state architecture

- Status: accepted
- Decision: do not adopt TCA as the native client's primary architecture.
- Final choice:
  - Fenrir Native keeps the module architecture defined in this document:
    `Actions`, `Services`, `Contracts`, `Layers`, `Models`, and `Views`.
  - AppKit controllers/views call typed actions and services, not a global
    reducer.
  - Supacode is a reference for boundaries, command/event streams, sidebar
    projections, and terminal managers, not for adopting TCA wholesale.
- Consequences:
  - The codebase avoids having two competing architectures.
  - Reducer-style local view state may exist inside isolated UI components, but
    not as the product architecture.

### D-018: Workspace identity model

- Status: accepted
- Decision: separate `Project`, `Workspace`, and `Runtime Session`.
- Final choice:
  - `Project` is the durable repo/folder/product concept.
  - `Workspace` is the visible, searchable, pinnable, listable product entry.
  - `Runtime Session` is the concrete tmux session for
    `server/profile + tenant/org + actor/user + project/workspace`.
  - Tmux object names are implementation keys, not public APIs.
- Consequences:
  - Two users can open the same project and get separate runtime sessions by
    default.
  - `fenrir open .` resolves path to project/workspace, then to the runtime
    session for the current actor/profile.

### D-019: Operational panes and fake panes

- Status: accepted
- Decision: the main pane grid only contains entities backed by tmux/server
  kernel panes.
- Final choice:
  - Main tab strip equals tmux windows.
  - Main pane grid equals tmux panes.
  - Client-only UI must live in sidebar, overlay, inspector, popover, settings,
    or other auxiliary surfaces.
  - If agents, workflows, Neovim, logs, or future tools appear in the grid, they
    must be represented by real tmux panes plus explicit metadata.
- Consequences:
  - Fenrir does not create a parallel client-only layout system.
  - Settings, command palette, agent composer, conversations, and diagnostics do
    not become fake panes.

### D-020: Workflow and agent identity

- Status: accepted
- Decision: workflow and agent identity live in server contracts; tmux panes are
  optional operational surfaces linked by metadata.
- Final choice:
  - A workflow is not identified by a pane.
  - A pane may show logs, process output, or interaction for a workflow/agent.
  - Sidebar, palette, notifications, and overlays read workflow/agent state from
    server contracts, not terminal scraping.
  - Workflows can have zero, one, or multiple linked surfaces.
- Consequences:
  - Workflow state remains correct if a terminal viewport is recreated.
  - Terminal bytes are not the workflow database.

### D-021: Terminal context for agents

- Status: accepted, amended by D-037/D-040
- Decision: terminal context capture is a first-class, explicit, bounded user
  action.
- Final choice:
  - Initial sources are terminal selection, visible viewport, and last N lines.
  - Keybindings trigger context capture and open an agent composer modal.
  - The composer lets the user edit the prompt/context before sending.
  - Context includes provenance metadata such as workspace, tab, pane, source
    type, and sequence range where available.
  - Shell integration and command/output block detection are not required for
    the base design.
  - No automatic redaction/preprocessing is required for the base design.
- Consequences:
  - Terminal context can be sent to agents without giving agents arbitrary pane
    write access.
  - Composer output is delivered into a pane-hosted agent CLI session per
    D-040. The receiving agent CLI owns the conversation transcript; the native
    client does not maintain a parallel transcript store, and sent context is
    never treated as technical logs or telemetry.

### D-022: Agent write authority

- Status: accepted, clarified by D-040
- Decision: agents do not write directly into user panes for the base native
  client.
- Final choice:
  - Agents may receive terminal context and respond with suggestions, patches,
    commands, or workflow proposals.
  - Agents do not call `tmux.pane.write` against interactive user panes.
  - Dispatching a user-authored prompt into an agent-owned pane (D-040) is user
    input delivered on the user's behalf, not agent write authority, and is not
    restricted by this decision.
  - Future autonomous agent writes require explicit server-side capabilities and
    a separate decision.
- Consequences:
  - The base security and UX model is simpler.
  - User shells are not mutated by agents without a future explicit permission
    model.

### D-023: Workspace overlay surfaces

- Status: accepted
- Decision: introduce workspace-scoped native overlay surfaces for composer,
  conversations, results, diagnostics, help, and similar UI.
- Final choice:
  - Overlays are not tmux panes and do not appear in the pane grid.
  - Overlays are navigable with tmux-like ergonomics: predictable focus,
    keybindings, close/escape returning to the origin pane, sidebar/palette
    focus targets, and restore/pin behavior where appropriate.
  - `WorkspaceOverlays` owns presentation and focus lifecycle.
- Consequences:
  - Native agent/chat/help surfaces can feel integrated without corrupting tmux
    layout ownership.

### D-024: Agent interaction module

- Status: accepted, amended by D-037/D-040
- Decision: create an `AgentInteraction` module separate from workflows,
  overlays, and notifications.
- Final choice:
  - `AgentInteraction` owns composer inputs, terminal context attachments,
    prompt dispatch to pane-hosted agent CLIs, and promotion to workflow.
  - Conversation transcripts, response rendering, model/provider pickers,
    approval prompts, and plan review are owned by the agent CLI running in its
    pane. The native client does not reproduce them; earlier references to
    native conversation transcripts and response streams are superseded.
  - Agent provisioning (hooks/skills/MCP) and presence ingestion belong to
    `AgentIntegration` (D-038/D-039), not to `AgentInteraction`.
  - `WorkspaceOverlays` presents/focuses the composer surface.
  - `WorkflowControl` owns durable workflow runs.
  - `Notifications` owns badges and alerts.

### D-025: Workflow control module

- Status: accepted
- Decision: create a native `WorkflowControl` module for workflow visualization
  and control.
- Final choice:
  - Fenrir server executes workflows.
  - Native client lists, opens, visualizes, navigates, and controls workflow
    runs through server contracts.
  - Supported controls include answer awaiting input, cancel, retry,
    pause/resume when the server supports them, and focus linked pane/overlay.
  - Workflow logs are shown in a linked pane when a step has one, or in native
    overlay surfaces for structured server logs.

### D-026: Server-backed feature service ports

- Status: accepted
- Decision: server-backed feature modules define their own service ports and
  live adapters over `ServerConnection`.
- Final choice:
  - Feature actions do not build raw RPC payloads directly.
  - `ServerConnection` remains transport/session/health infrastructure, not a
    business API.
  - `AgentInteraction`, `WorkflowControl`, and future server-backed features use
    module-specific service contracts.

### D-027: Sidebar information architecture

- Status: accepted, amended by D-041 (workspace tree)
- Decision: use a collapsible Supacode-inspired operational sidebar adapted to
  Fenrir workspaces and activity.
- Final choice:
  - The sidebar has global workspace sections such as attention, workspaces,
    recent, remote/profile grouping, and degraded states.
  - Workspace rows form a tree (D-041): each workspace expands into agent
    sessions, integrated apps, and dev servers running in it.
  - The sidebar does not replicate the entire tmux layout.
  - Sidebar projections should be cached and row-level to avoid high-frequency
    event invalidation.

### D-028: Tmux keymap integration

- Status: accepted
- Decision: import the effective tmux keymap from the runtime/server and map
  known tmux bindings to Fenrir actions.
- Final choice:
  - Do not parse `.tmux.conf` manually.
  - Import effective prefix, prefix2, root table, prefix table, and relevant
    custom key tables.
  - Implement a real prefix/key-table state machine, including repeat windows
    where tmux exposes them.
  - Map known commands such as select-window, next/previous-window,
    select-pane, split-window, resize-pane, kill-pane/window, new-window,
    rename-window, choose-tree, and display-menu to typed Fenrir actions where
    supported.
  - Unknown bindings produce discrete unsupported feedback; command-string
    passthrough is only allowed through explicit server-side allowlists.
  - Input not captured by Fenrir falls through to the terminal.
- Consequences:
  - User tmux navigation muscle memory becomes native UI navigation.
  - Fenrir does not execute arbitrary tmux command strings from the UI router.

### D-029: Command palette semantics

- Status: accepted
- Decision: `Cmd+P` opens a native universal palette, defaulting to workspace
  switching.
- Final choice:
  - The palette is a native modal/overlay, not a tmux pane.
  - Default search domain is workspaces.
  - Prefixes change domain:
    - no prefix: workspaces
    - `@`: actions
    - `$`: files
    - `%`: tabs/panes
    - `!`: workflows/agents requiring attention
    - `?`: help/keybindings
  - Results always dispatch typed actions, not free shell strings.
  - File search is server/workspace-owned and opens through Neovim integration
    where available.

### D-030: Settings scope

- Status: accepted
- Decision: `Settings` is a local versioned configuration store, not a runtime
  state store.
- Includes:
  - remote profile metadata without secrets
  - local server bootstrap preference
  - keybinding overrides
  - sidebar, palette, appearance, notification, and feature flag preferences
- Excludes:
  - bearer/session secrets, which belong to `AuthSession`/Keychain
  - live connection health, which belongs to `ServerConnection`
  - live runtime state, which belongs to `NativeRuntime`
  - terminal scrollback
  - workflow execution state
  - agent conversation authority, which belongs to `AgentInteraction` and server
    transcript policy.

### D-031: Diagnostics privacy

- Status: accepted
- Decision: diagnostics do not include terminal text by default.
- Final choice:
  - Diagnostics may include stream ids, seq ranges, gap/overflow events,
    reconnect attempts, latencies, error tags, pane/workspace ids, and byte
    counts.
  - Diagnostics and crash reports do not include auth tokens or terminal
    contents by default.
  - Bug-report exports with terminal excerpts require explicit opt-in.

### D-032: Remote profile auth UX

- Status: accepted
- Decision: remote profiles live in `Settings`, while secrets live in
  `AuthSession`/Keychain.
- Final choice:
  - Profiles include name, server URL, non-secret metadata, default tenant/org
    when needed, and trust/TLS metadata where needed.
  - Sidebar may group workspaces by profile.
  - CLI supports targeting profiles, for example with `--remote <profile>`.
  - Expired or revoked profiles degrade visible workspaces and request reauth.

### D-033: Browser-lab scope

- Status: accepted
- Decision: browser-lab is not part of the base Swift native roadmap.
- Final choice:
  - Browser-lab remains an existing Electron/web capability until it is
    separately redesigned for native.
  - No native browser-lab surface blocks the terminal emulator architecture.

### D-034: Managed and remote process scope

- Status: accepted
- Decision: dedicated managed-process and remote-process native surfaces are
  outside the base roadmap.
- Final choice:
  - If such processes already appear as tmux panes with metadata, the native app
    can render them as normal panes.
  - Dedicated native UI can be reintroduced later as separate server-backed
    features.

### D-035: Distribution and dependency management

- Status: accepted
- Decision: Fenrir Native should distribute or manage the local Fenrir server
  and verify tmux as a managed dependency.
- Final choice:
  - Opening the installed app should work locally without manually starting the
    server.
  - The app may bundle the server or manage it as a helper/component, while
    allowing explicit external overrides.
  - The CLI is installed or exposed from the app.
  - `libGhostty` resources are bundled.
  - Neovim is discovered/configured, not bundled.
  - The local server verifies tmux availability/version, uses compatible system
    tmux when present, and offers a managed fallback or install guidance when
    missing.
  - Remote servers manage their own tmux dependency.

### D-036: Git and review native scope

- Status: accepted
- Decision: a lazygit-native or hunks-native rewrite is not part of the base
  Swift native terminal client.
- Final choice:
  - `lazygit`, `hunks`, and similar terminal tools can run as normal tmux pane
    processes.
  - Future native git/review surfaces require explicit server-backed contracts
    and a separate module-boundary decision.
  - Future native git/review surfaces must live in overlays/side surfaces or be
    backed by real tmux/server-kernel panes with metadata.
  - Git/review state must not be inferred from generic terminal scraping.
- Consequences:
  - Lack of a native lazygit/hunks rewrite does not block the base terminal
    emulator.
  - Agent terminal-context capture, workflows, Neovim integration, sidebar, and
    palette can proceed without native git/review parity.

### D-037: Agent execution model

- Status: accepted
- Decision: in Fenrir Native, agents run as normal CLI processes inside tmux
  panes, and the native client does not implement a chat view.
- Why:
  - Fenrir Native is a different interface to Fenrir, not a migration of the
    Electron desktop app. The Electron app mediates provider sessions through
    the server and renders a chat experience; the native client instead treats
    the user's preferred agent CLI (Claude Code, Codex, Cursor, OpenCode, and
    future providers) as the agent experience.
  - Each agent CLI already ships its own TUI for transcripts, approvals, plan
    review, model selection, and context management. Reproducing that natively
    duplicates the hardest UI surface for no product gain.
  - This matches the Supacode reference model, which Fenrir Native follows in
    spirit: the terminal orchestrates agents, it does not host their
    conversations.
- Final choice:
  - Agent CLIs are launched, focused, and managed as real tmux pane processes
    with pane metadata, exactly like Neovim under D-013.
  - The native client integrates agents from the outside: provisioned hooks and
    skills (D-039), presence signals (D-038), prompt dispatch (D-040), and
    Fenrir MCP tooling.
  - Server-mediated provider sessions (Codex app-server, ACP, Agent SDK) remain
    a server capability used by the Electron/web clients and workflows; the base
    native client does not depend on them for its agent experience.
  - Approval and awaiting-input interactions happen inside the agent's own TUI
    in its pane; the native client's job is to detect those states (D-038) and
    get the user to the right pane fast.
- Consequences:
  - `AgentInteraction` shrinks to composer, context capture, prompt dispatch,
    and promotion to workflow (amended D-024).
  - No native transcript store, response stream renderer, provider/model
    picker, or approval panel is part of the base native client.
  - Sidebar, palette, and notifications treat "agent in a pane" as a
    first-class entity via presence metadata rather than conversation state.
  - The provider-agnostic rule from the repository root still applies: every
    per-agent behavior must sit behind a common integration contract.

### D-038: Agent presence channel

- Status: accepted
- Decision: agent presence is emitted by provisioned hooks as OSC sequences on
  the agent's own terminal stream, parsed by the native client; server-side
  ingestion is a supplemental channel, not the primary one.
- Why:
  - With agents running as pane processes (D-037), there is no server-mediated
    provider session to read state from. The pane's own byte stream is the one
    channel that always exists, works over SSH in remote workspaces, and needs
    no extra transport or auth.
  - The Supacode reference validates this design: hooks emit presence and
    notifications as OSC to the terminal precisely because a local socket
    cannot be reached from remote shells.
  - This supersedes the earlier bias toward "server-authenticated metadata
    instead of OSC" for pane-hosted agent state. That bias remains correct for
    workflows (D-020), which are server-executed; it is inverted for agents the
    server does not mediate.
- Final choice:
  - Fenrir reserves a dedicated OSC sequence number for agent presence and
    notification payloads emitted by provisioned hooks.
  - `TerminalViewport` detects and strips the reserved OSC sequences from
    render input and forwards them as typed events; parsing/validation into
    presence contracts belongs to `AgentIntegration`.
  - Presence states include at minimum: session started, busy/working, awaiting
    user input or approval, turn completed, failed, and session ended, plus
    workspace/pane provenance.
  - Presence payloads are metadata only: no prompt text, no terminal content,
    no transcript fragments.
  - Hooks may additionally report to an authenticated Fenrir server endpoint
    where configured (for example for future headless or dashboard use), but no
    base-client feature may depend on that channel.
  - Presence derived from OSC is advisory UI state: it drives badges, palette
    attention, notifications, and focus targets. It is never used as an
    authorization signal and never triggers writes into panes.
  - Unknown or malformed presence payloads are dropped with a diagnostics
    event; they must not crash parsing or leak into render output.
- Consequences:
  - The palette `!` domain, sidebar attention badges, and agent notifications
    are fed from hook presence rather than server conversation state.
  - Terminal byte scraping stays forbidden; the reserved OSC channel is the
    single sanctioned in-band signal.
  - Diagnostics can count/inspect presence event metadata under D-031 rules.

### D-039: Agent integration provisioning

- Status: accepted
- Decision: Fenrir installs and manages per-agent hooks, skills, and MCP
  configuration behind a common integration contract, with explicit ownership
  markers and reversible edits.
- Why:
  - The product value of D-037 depends on agents actually emitting presence,
    knowing how to drive the `fenrir` CLI, and having Fenrir MCP tools
    available. None of that happens without provisioning.
  - Each agent CLI has its own config surface (`.claude`, `.codex`, Cursor and
    OpenCode config dirs, hook schemas, skill/plugin formats). This is exactly
    the provider-interface problem the repository root already mandates a
    common contract for.
  - The Supacode reference implements this as per-agent settings installers
    with ownership-marked, idempotent edits; Fenrir adopts the same shape.
- Final choice:
  - A native `AgentIntegration` module owns integration contracts: detect
    installed agent CLIs, report integration status, install/update/remove
    hooks and skills, and provision MCP server entries.
  - Every supported agent gets an adapter implementing the same contract;
    agent-specific formats never leak outside the adapter.
  - Initial adapter targets are Claude Code, Codex, Cursor, and OpenCode;
    additional agents are new adapters, not new code paths.
  - All written config carries Fenrir ownership markers, is idempotent to
    reapply, is version-stamped for upgrade detection, and uninstalls cleanly.
    User-owned content outside the markers is never rewritten.
  - MCP provisioning reuses the server's MCP configuration contracts as the
    source of truth for which Fenrir MCP servers exist per workspace/project;
    the adapter only translates them into the agent's config format.
  - Skills/hooks content teaches agents to: emit presence per D-038, use the
    `fenrir` CLI control surface (D-014) for workspace/pane/file actions, and
    reach Fenrir MCP tools.
  - Provisioning is explicit and user-visible: a first-run integration prompt
    plus on-demand repair/upgrade actions from palette/settings. Outdated or
    missing integration is a visible degraded state with a one-action fix, not
    a silent failure.
  - Unprovisioned agent CLIs keep working as plain terminal panes; integration
    is additive, never required.
- Consequences:
  - `AgentIntegration` joins the canonical module map, and the module map
    document is the authority for its boundaries.
  - Agent config directories become a managed surface with the same care as
    settings persistence (atomic writes, backups on schema conflicts).
  - Supporting a new agent CLI is mechanical: one adapter, one skill/hook
    content pack, zero changes to presence, composer, or sidebar code.

### D-040: Prompt dispatch into agent panes

- Status: accepted
- Decision: invoking an agent with a prompt means delivering user-authored text
  into an agent CLI pane: either spawning a new agent pane launched with the
  prompt, or writing into an existing agent pane's input.
- Why:
  - Under D-037 there is no server conversation to submit prompts to from the
    base native client. The agent's stdin/TUI is the interface.
  - This keeps the composer flow from D-021 (capture context, edit prompt,
    send) while retargeting delivery from server provider sessions to panes.
- Final choice:
  - Dispatch targets are explicit: the user picks an existing agent pane or a
    new agent pane (agent choice honoring D-039 detection); Fenrir may default
    to the workspace's most recent agent pane but never dispatches to an
    ambiguous target.
  - New-pane dispatch launches the agent CLI through the tmux runtime with the
    prompt as launch input where the CLI supports it.
  - Existing-pane dispatch writes through the authenticated runtime pane-write
    path using bracketed paste, as a single atomic write; Fenrir does not
    auto-submit if the target agent's input model makes submission ambiguous.
  - Dispatch is idempotent under reconnect: a prompt is delivered exactly once
    or fails visibly; write acknowledgements from the runtime protocol are the
    confirmation signal.
  - Focus follows dispatch by default: sending a prompt focuses the target
    pane, honoring D-023 focus-return semantics for the composer overlay.
  - This is user input on the user's behalf (see amended D-022); autonomous
    agent-initiated writes remain out of scope.
- Consequences:
  - `AgentInteraction`'s submission port targets pane dispatch through runtime
    contracts instead of a server prompt API.
  - The composer keybinding loop (capture → edit → send → agent works → hook
    presence signals completion → notification focuses pane) is the core
    agentic UX of the native client.

### D-041: Shell visual contract

- Status: accepted
- Decision: the shell follows the "operations deck" direction with quiet tmux
  tabs, a collapsible workspace-tree sidebar, and themes shared with Fenrir
  Desktop's theme registry. Reference mockup:
  `docs/native-terminal-ui-shell.html` (interactive; themes, sidebar, palette,
  and composer states toggleable).
- Final choice:
  - Base direction is the operations deck: persistent-by-default chrome that
    pays rent — pane headers with process/pane-id/integration-status/presence
    chip, and a status bar carrying stream health (ws latency, pane count,
    attention echo).
  - Tabs are the quiet style: bare text in the titlebar representing tmux
    windows (D-010), active tab underlined in the theme accent, one pulsing
    dot per tab rolling up pane presence. No favicons, no close buttons.
  - The sidebar is visible by default and collapsible to zero chrome; when
    collapsed, attention remains reachable through the titlebar attention
    indicator and the palette `!` domain.
  - Sidebar rows form a workspace tree:
    - workspace row: name, branch, hotkey slot, rolled-up badges (agents
      needing attention, running workflows) when collapsed
    - `agents` group: pane-hosted agent sessions with presence state and pane
      target, sourced from hook presence (D-038)
    - `apps` group: integration-detected supported apps (Neovim, gh-dash,
      hunks, and future adapters) with app-specific metadata (current file,
      PR count, changed files), sourced from pane process/metadata detection
      (D-019, D-039); unrecognized processes do not appear
    - `dev servers` group: managed-process metadata rows (status, port,
      latency) over existing WS contracts; passive rows per D-034 — row
      actions focus a linked pane or tail logs into one, and no dedicated
      native surface is implied
  - Tree state: the active workspace auto-expands; others collapse to badge
    roll-ups. All tree projections are row-level cached (D-027).
  - Attention outranks navigation: an attention section pins above the tree
    with jump hotkeys, mirrored by the palette `!` domain.
  - Theming: the native client consumes the same theme registry/ids as Fenrir
    Desktop (`apps/web/src/lib/theme.ts` — fenrir dark, pierre dark,
    catppuccin mocha, rose pine, kanagawa, tokyonight moon, nord, …) mapped to
    a native design-token set. One token set drives chrome, tree, presence,
    ANSI, and overlays; no surface may hardcode a color. Theme selection is a
    `Settings` preference and applies to the shell and the Ghostty viewport
    palette together.
  - Presence coding is chromatic with four semantic slots — attention,
    healthy, failed, workflow — that each theme maps to its own palette.
  - Overlays (palette, composer) are elevated cards themed by the same tokens.
- Consequences:
  - `WorkspaceIndex` projections gain tree children (agents/apps/dev servers)
    with per-row cache keys; `WorkspaceShell` owns tab/titlebar rendering.
  - `AgentIntegration` app-detection adapters decide what qualifies as a
    supported app row; adding an app is one adapter, not new sidebar code.
  - A shared theme-token contract must be defined once (native `Settings` +
    theme mapping) before shell surfaces multiply.
  - Open micro-questions tracked in the mockup's contract notes: idle app rows
    visibility, dev-server start/stop as row action vs palette-only.

## Decision Order

The major native-client architecture decisions in this document are currently
accepted. New decisions should be added here before changing module boundaries
or implementation ownership.

Deferred areas that need separate future decisions:

1. Future native git/review depth beyond terminal-hosted tools.
2. Future shared multiuser tmux sessions.
3. Future browser-lab native equivalent.
4. Future dedicated managed/remote process native surfaces.
5. Future autonomous agent write capabilities into tmux panes (user-initiated
   prompt dispatch is covered by D-040).
6. Future server-side presence ingestion features beyond the supplemental
   channel reserved in D-038.

## Decision Rules

When a decision is accepted, update this document with:

- status
- final choice
- rationale
- consequences for packaging, runtime behavior, and migration

Do not record temporary implementation shortcuts here as architecture decisions.
