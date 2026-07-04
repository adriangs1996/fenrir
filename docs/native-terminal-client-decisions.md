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
- `docs/native-terminal-reference-alignment.md` (cmux/Supacode copy map behind
  D-042 through D-045)

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
  - cmux is the primary reference for native terminal product/runtime shape:
    AppKit terminal-first UX, libGhostty-backed panes, local control, browser,
    SSH/remote terminal behavior, notifications, restore, and agent hook
    ergonomics.
  - Supacode remains a secondary reference for boundaries, command/event
    streams, sidebar projections, and terminal managers, not for adopting TCA
    wholesale.
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
  - Terminal context can be sent to server-orchestrated agent/workflow commands
    without giving agents arbitrary pane write access.
  - Composer output is submitted through the authenticated server orchestration
    path per D-040. The native client does not maintain a parallel transcript
    store, and sent context is never treated as technical logs or telemetry.

### D-022: Agent write authority

- Status: accepted, clarified by D-040
- Decision: agents do not write directly into user panes for the base native
  client.
- Final choice:
  - Agents may receive terminal context and respond with suggestions, patches,
    commands, or workflow proposals.
  - Agents do not call `tmux.pane.write` against interactive user panes.
  - Submitting a user-authored prompt through the server orchestration path
    (D-040) is not pane write authority and must not mutate terminal pane
    contents in the base native client.
  - Future client-synthesized pane input or autonomous agent writes require
    explicit server-side capabilities and a separate decision.
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
    server-orchestrated prompt submission, and promotion to workflow where
    supported.
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
- Decision: use a collapsible cmux-inspired operational sidebar adapted to
  Fenrir workspaces and activity, with Supacode-style projection discipline
  where it improves performance and modularity.
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
  - Implementation note: `native/FenrirNative/package-app.sh` is the accepted SwiftPM app-bundle path for local bundle assembly. It copies optional server and terminal-renderer resources into the app bundle and supports codesigning when release credentials are available.

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

- Status: accepted, amended by D-042 (approval feed)
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
  - This matches the cmux product model, which Fenrir Native follows in spirit:
    the terminal orchestrates agents, it does not host their conversations.
    Supacode remains useful as a secondary workflow reference for the same
    product direction.
- Final choice:
  - Agent CLIs are launched, focused, and managed as real tmux pane processes
    with pane metadata, exactly like Neovim under D-013.
  - The native client integrates agents from the outside: provisioned hooks and
    skills (D-039), presence signals (D-038), server-orchestrated composer
    submission (D-040), and Fenrir MCP tooling.
  - Server-mediated provider sessions (Codex app-server, ACP, Agent SDK) remain
    a server capability used by the Electron/web clients and workflows; the base
    native client does not depend on them for its agent experience.
  - Approval and awaiting-input interactions happen inside the agent's own TUI
    in its pane; the native client's job is to detect those states (D-038) and
    get the user to the right pane fast.
- Consequences:
  - `AgentInteraction` shrinks to composer, context capture,
    server-orchestrated prompt submission, and promotion to workflow (amended
    D-024).
  - No native transcript store, response stream renderer, provider/model
    picker, or approval panel is part of the base native client.
  - Sidebar, palette, and notifications treat "agent in a pane" as a
    first-class entity via presence metadata rather than conversation state.
  - The provider-agnostic rule from the repository root still applies: every
    per-agent behavior must sit behind a common integration contract.

### D-038: Agent presence channel

- Status: accepted, amended by D-043 (generic notification ingestion)
- Decision: agent presence is emitted by provisioned hooks as OSC sequences on
  the agent's own terminal stream, parsed by the native client; server-side
  ingestion is a supplemental channel, not the primary one.
- Why:
  - With agents running as pane processes (D-037), there is no server-mediated
    provider session to read state from. The pane's own byte stream is the one
    channel that always exists, works over SSH in remote workspaces, and needs
    no extra transport or auth.
  - The cmux and Supacode references both validate this design: hooks emit
    presence and notifications as OSC to the terminal precisely because a local
    socket cannot be reached from remote shells.
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

Implementation note: provider-real target mapping now lives in `ProviderAgentInstallTargetResolver`. It records the real Claude Code, Codex, Cursor, and OpenCode config surfaces and explicitly marks shared JSON/TOML/plugin files as provider-renderer work so the generic managed-block provisioner cannot corrupt structured config.

Implementation note: the native foundation now includes two live provisioning paths. `ManagedAgentIntegrationProvisioner` keeps the legacy Fenrir-owned text-block/JSON core for safe internal config surfaces, while `ProviderStructuredAgentIntegrationProvisioner` writes the real provider surfaces for Claude Code, Codex, Cursor, and OpenCode: structured JSON hooks, owned skills/plugins, JSON MCP, and Codex TOML MCP. The provider path is idempotent, backup-backed, cleanly removable, and conflict-refusing. NativeHost now exposes explicit status, repair, and remove operations through the diagnostics product command, and `fenrir agent-integration status|repair|remove` reaches those operations over the local native control socket. First-run, palette, and settings UI repair/install surfaces remain separate integration work.

- Status: accepted, extended by D-044 (agent session resume)
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
  - cmux is the primary reference for agent hook and resume ergonomics, while
    Supacode remains the reference for per-agent settings installers with
    ownership-marked, idempotent edits; Fenrir adopts the shared shape behind
    its own provider-neutral contracts.
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

### D-040: Prompt dispatch policy

- Status: accepted, amended
- Decision: the base native client captures terminal context and opens a native
  composer, but it does not write prompts into user or agent tmux panes yet.
  Submitting a composer dispatches a server-owned orchestration command through
  authenticated Fenrir server contracts, matching the pragmatic behavior used
  by the existing desktop app.
- Why:
  - The latest product decision is to avoid pane writes for now. Pane-hosted
    agent CLIs remain first-class terminal processes, but Fenrir Native should
    not synthesize stdin into those panes until the exact targeting, ack, and
    recovery semantics are explicitly reaccepted.
  - This keeps the context loop useful immediately: capture selection,
    viewport, or last N lines; edit the prompt; submit through the server;
    keep terminal panes untouched by the act of opening or submitting the
    composer.
  - Server-owned orchestration keeps workflow and agent command execution under
    the same authenticated server boundary already used by Electron/Desktop.
- Final choice:
  - Context capture sources are selection, visible viewport, and last N lines.
  - Opening the composer never mutates pane contents.
  - Submitting the composer sends an authenticated server orchestration command
    and records a prompt acceptance result; it does not call the tmux pane-write
    runtime path.
  - Agent-initiated writes and client-synthesized pane input remain out of scope
    for the base native client.
  - Pane-targeted prompt dispatch may be reconsidered later as a separate
    decision and implementation pass; it must provide explicit target selection,
    exactly-once delivery, focus behavior, bracketed-paste/write-ack semantics,
    tests, and a rollback story before replacing the server-orchestrated path.
- Consequences:
  - `AgentInteraction`'s submission port remains a product-level prompt
    submission boundary, not a pane-write boundary.
  - `AgentIntegration` presence is advisory metadata only and must not
    authorize or trigger writes.
  - The composer keybinding loop for the base client is: capture → edit → submit
    to server orchestration → reflect resulting workflow/agent state through
    workflow, notification, and presence surfaces when available.

### D-041: Shell visual contract

- Status: accepted, amended by D-045 (titlebar controls and row metadata)
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

### D-042: Agent approval feed

- Status: accepted, post-base milestone (amends D-037)
- Decision: after the base client ships, Fenrir Native adds a native approval
  feed — hook-fed approval/question cards in a workspace overlay and in
  notification banner actions — while keeping the no-chat-view stance intact.
- Why:
  - cmux, the primary reference, treats inline approvals ("Feed") as core to
    running many agents in parallel: permission requests, plan-exit reviews,
    and agent questions surface as actionable cards with a bounded soft wait
    and automatic fallback to the agent's own TUI. The agent never blocks on
    the native UI.
  - D-037's original consequence ("no approval panel") conflated approvals
    with conversation hosting. Approvals are discrete, structured decisions;
    they do not require a transcript store, response renderer, or model
    picker. The no-chat-view rule is unaffected — the primary reference
    itself ships no chat view on macOS.
  - Fenrir's topology makes this cleaner than the reference: hooks run next
    to the pane process, which is next to the Fenrir server, so the reply
    channel is a server-local endpoint plus existing authenticated WS
    contracts to clients. Remote workspaces work without any client-reachable
    socket, which the reference cannot do.
- Final choice:
  - Provisioned hooks (D-039) gain a feed component that reports approval
    requests (permission request, plan-exit review, agent question) to the
    Fenrir server through a server-local hook endpoint, then parks with a
    bounded soft wait (target ≤120s) for a decision.
  - On timeout, missing client, or unsupported request kind, the hook replies
    neutrally and the interaction falls back to the agent's own TUI in its
    pane. The feed is an accelerator, never a gate.
  - The server relays requests to connected clients over a WS event stream
    and accepts exactly one decision per request id over RPC; late or
    duplicate decisions are rejected.
  - The native client renders cards in a workspace overlay (D-023 surface)
    and as macOS notification actions. Approval cards and D-038 presence stay
    distinct channels, and approvals never travel over OSC — it is one-way
    and byte-capped.
  - Card payloads carry the structured request the hook provides (tool/action
    summary, options); they must not include broader terminal content, and
    diagnostics record metadata only per D-031.
  - Decisions dispatch through typed actions with the same authority rules as
    D-040: the client never writes decision keystrokes into panes; the hook
    applies the decision inside the agent's own process.
- Consequences:
  - D-037's consequence list is narrowed: still no native transcript store,
    response stream renderer, or provider/model picker; the approval feed is
    allowed as a post-base milestone.
  - New server contract: approval feed relay (hook endpoint, WS event, decide
    RPC) with per-workspace/actor scoping.
  - `AgentIntegration` adapters gain per-agent feed hook definitions; agents
    without hook support simply never produce cards.
  - `WorkspaceOverlays` gains a feed overlay; `Notifications` gains
    actionable banner categories.

### D-043: Generic terminal notification ingestion

- Status: accepted (amends D-038)
- Decision: `TerminalViewport` parses the standard terminal notification
  sequences — OSC 9, OSC 99, and OSC 777;notify — from any pane process and
  forwards them as typed notification events; the reserved Fenrir OSC channel
  remains the only structured presence source.
- Why:
  - The primary reference honors the standard sequences, which lets any CLI
    (builds, tests, long jobs) notify without Fenrir-specific provisioning.
  - D-038's reserved channel exists for structured agent presence; it was
    never meant to make ordinary `printf`-style notifications impossible.
- Final choice:
  - The viewport detects and strips OSC 9 / OSC 99 / OSC 777;notify at the
    same render-input boundary as the reserved sequence and emits typed
    notification events (title, body, workspace/pane provenance).
  - Payloads are sanitized: control characters removed, length-capped, and
    bounded well under libghostty's OSC ceiling; malformed payloads are
    dropped with a diagnostics count.
  - Generic notifications are advisory UI signals only: they feed the
    notifications model, banners, badges, and attention ordering. They are
    never authorization signals, never presence state, and never trigger pane
    writes.
  - Notification title/body are user-visible content and may appear in
    banners and the notifications panel, but are excluded from diagnostics
    exports by default per D-031.
- Consequences:
  - Banners and the notifications panel work with zero provisioning.
  - Agent presence semantics stay exclusively on the reserved channel; a
    generic OSC 9 from an agent shows a notification but never flips presence
    state.
  - `TerminalViewport` gains one parser and one typed event; `Notifications`
    owns routing and coalescing.

### D-044: Agent session resume

- Status: accepted (extends D-039)
- Decision: provisioned hooks record agent-native session identifiers as pane
  metadata through the server, and Fenrir can relaunch a dead agent by
  spawning a fresh pane process running that agent's documented resume
  command.
- Why:
  - cmux is the named primary reference for resume ergonomics (D-039): hooks
    record session ids and relaunch replays each agent's native resume
    command (`claude --resume <id>`, `codex resume <id>`, ...).
  - Fenrir's scope is narrower than the reference's: tmux keeps pane
    processes alive across client restarts (D-002/D-012), so resume only
    matters after real process death — server host restart, agent crash, or
    a future hibernation-style feature — not after app relaunch.
- Final choice:
  - Hook session-start events carry agent id and agent-native session id as
    presence metadata (D-038 rules: metadata only, no prompt text); the
    client attaches them to the pane record via the existing pane-metadata
    contract, so resumability survives client restarts server-side.
  - Resume commands come exclusively from a per-adapter descriptor table in
    `AgentIntegration`; hook payloads and pane content never supply command
    strings. Session ids are validated against a strict allowlisted charset
    before interpolation, since they originate in-band.
  - User-defined resume commands are a Settings feature gated on explicit
    approval bound to workspace + agent, following the reference's
    signed-approval shape; secrets are never stored in the command record.
  - Resume is user-initiated by default (sidebar row action, palette, and
    dead-pane affordance). Auto-resume on workspace projection is an opt-in
    setting and only fires for panes whose recorded process died.
  - A resumed agent is a new tmux pane process with fresh pane identity; the
    old pane's metadata records the succession for sidebar/palette history.
- Consequences:
  - `AgentIntegration` adapters gain a resume descriptor per agent; agents
    without one simply show a dead pane.
  - No scrollback snapshotting is introduced; terminal history stays governed
    by D-012.
  - The dead-pane affordance and succession metadata are new `PaneGrid` /
    `WorkspaceIndex` surface work.

### D-045: Titlebar productivity controls and workspace row metadata

- Status: accepted (amends D-041; refines D-027)
- Decision: the operations-deck titlebar gains three controls — a run-script
  split button, an open-in-editor split button, and a notifications button —
  and workspace rows gain branch/PR/ports/latest-notification metadata with
  cmux-style attention treatment (pane rings, row lighting, jump to latest
  unread).
- Why:
  - D-041's own rule is that persistent chrome must pay rent. These controls
    each carry live state (running script, unread count, resolved editor) and
    remove a palette round-trip from high-frequency actions.
  - The Supacode reference supplies the proven surfaces: a `ScriptDefinition`
    model (run/test/lint/format/custom; repo scripts merged over global with
    repo precedence and forged-kind protection) behind a run/stop split
    button, and an open-in-editor split button over a catalogue of editor /
    terminal / git-client / Finder / `$EDITOR` targets with per-repo and
    global defaults.
  - The cmux reference supplies the row metadata (git branch, linked PR
    status/number, working directory, listening ports, latest notification
    line) and the attention loop that makes many parallel workspaces
    glanceable.
- Final choice:
  - Run scripts: script definitions live in `Settings` (repository and global
    scopes); the split button's primary action runs the primary run-kind
    script or stops it while running; the dropdown lists remaining scripts
    plus manage entries. Scripts execute as real tmux panes with
    managed-process metadata (D-019/D-034) — never app-local child processes
    — which also populates the D-041 sidebar `dev servers`/`apps` groups and
    keeps script output attachable, streamable, and server-owned.
  - Open in editor: a target catalogue modeled on the reference (editors,
    terminals, git clients, Finder, `$EDITOR`), resolved against installed
    apps; the split button opens the workspace path with the persisted
    default (global, overridable per repository); the dropdown picks and
    persists another. Pure client feature over workspace identity; no server
    contract.
  - Notifications button: opens the notifications panel overlay (D-042/D-043
    feed it); badge shows unread count; ⌘-style jump-to-latest-unread gets a
    default keybinding and palette action.
  - Row metadata: branch stays as specified; listening ports come from the
    existing localServers discovery contracts; the latest notification line
    comes from the notifications model; PR status/number requires a new
    server-side git/PR probe contract and ships only when that contract
    exists — the client never shells out to `gh` or scrapes panes.
  - Attention treatment: panes with awaiting-input presence get a themed ring
    (attention slot of the D-041 token set); sidebar rows light up and sort
    into the attention section; all of it remains driven by D-038/D-043
    events.
  - The visual contract file `docs/native-terminal-ui-shell.html` must be
    revised to show the three titlebar controls, row metadata, and ring
    treatment before shell implementation starts; the mockup remains the
    review reference (D-041 discipline).
- Consequences:
  - `WorkspaceShell` owns the new titlebar controls; `Settings` gains script
    and editor-target models with the reference's migration/backup
    discipline.
  - New server contract needed for PR probes; ports and notifications reuse
    existing contracts.
  - `Keybinding` and the palette gain run/stop-script, open-in-editor,
    notifications-panel, and jump-to-unread actions (palette parity so the
    controls stay optional chrome).
  - The D-041 open micro-question "dev-server start/stop as row action vs
    palette-only" is resolved: start/stop is also a titlebar/palette action
    through the run-script model.

## Decision Order

The major native-client architecture decisions in this document are currently
accepted. New decisions should be added here before changing module boundaries
or implementation ownership.

Deferred areas that need separate future decisions:

1. Future native git/review depth beyond terminal-hosted tools.
2. Future shared multiuser tmux sessions.
3. Future browser-lab native equivalent.
4. Future dedicated managed/remote process native surfaces.
5. Future client-synthesized or autonomous agent write capabilities into tmux
   panes; D-040 keeps base composer submission on the server orchestration path.
6. Future server-side presence ingestion features beyond the supplemental
   channel reserved in D-038.

## Decision Rules

When a decision is accepted, update this document with:

- status
- final choice
- rationale
- consequences for packaging, runtime behavior, and migration

Do not record temporary implementation shortcuts here as architecture decisions.
