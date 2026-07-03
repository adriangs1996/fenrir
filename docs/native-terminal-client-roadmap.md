# Native Terminal Client Roadmap

Status: execution roadmap for the native Fenrir terminal client.

This roadmap converts the current product vision, the Swift module scaffold,
and the Supacode reference study into a complete implementation plan. It is
not an MVP plan. The target is the final robust architecture: a native macOS
terminal emulator for agentic development, backed by Fenrir server and tmux.

Related references:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`
- `docs/native-terminal-client-runtime-boundary.md`
- `docs/tmux-session-kernel-architecture.md`
- `docs/native-terminal-ui-shell.html` (D-041 shell visual contract, interactive)
- `native/FenrirNative/README.md`
- `references/supacode`

Note: the requested reference path was `references/supabase`, but the repository
contains `references/supacode`. This roadmap uses `references/supacode` as the
app reference.

## Target Product

Fenrir Native is a terminal emulator first. It should open like Ghostty, but the
native shell is built around Fenrir concepts:

- one native window represents one workspace
- one actor-scoped workspace runtime represents one tmux session
- app tabs represent tmux windows
- visible panes represent tmux panes
- agents, workflows, Neovim, terminal context capture, and future git/review
  surfaces are first-class developer workflows around that terminal shell
- tmux runtime sessions are namespaced by actor/user by default

Fenrir Native is a different interface to Fenrir, not a port of the Electron
chat experience (D-037). There is no native chat view: agent CLIs (Claude Code,
Codex, Cursor, OpenCode, and future providers) run as normal processes in tmux
panes with their own TUIs. Fenrir integrates them from the outside — it
provisions hooks, skills, and MCP configuration into each agent (D-039), reads
agent presence from hook-emitted OSC signals (D-038), and captures terminal
context into a native composer that submits through authenticated server
orchestration without writing into panes in the base client (D-040). The native
client is a terminal that knows how to manage and talk to the specific
applications developers run inside it: agents, Neovim, gh-dash, hunks, lazygit.

The server remains separate and non-negotiable. The native app connects to a
local or remote Fenrir server, and all multiuser, remote, auth, runtime, tmux,
and workflow semantics must continue to be server-owned.

## Architecture Direction

The implementation should keep the existing module architecture and avoid
copying Supacode's architecture wholesale.

Supacode patterns to reuse:

- isolate the terminal runtime behind a command/event boundary
- keep heavy terminal state outside product reducer/state systems
- route terminal keybindings through the terminal runtime first
- persist layout and agent/process activity snapshots
- treat the sidebar as an operational surface, not just navigation
- expose a CLI/local-control channel for driving the running app
- aggressively test terminal models, sidebar projections, and lifecycle seams
- use Supacode's sidebar and command-palette ideas as product inspiration:
  cached projections, active/pinned sections, badges, hotkey slots, recency, and
  mixed entity/action search
- provision per-agent hooks/skills through ownership-marked, idempotent
  settings installers, one adapter per agent CLI
- read agent presence and notifications from hook-emitted OSC sequences on the
  agent's own terminal stream, which also works over SSH

Supacode patterns to adapt:

- use AppKit as Fenrir's primary shell owner instead of a SwiftUI-first shell
- copy the boundary idea, not necessarily TCA itself
- use Fenrir server contracts instead of local-only worktree scripts as the
  source of truth
- use server-authenticated workflow and tmux metadata for server-executed
  workflows (D-020); for pane-hosted agent CLIs, hook-emitted OSC presence is
  the primary state channel (D-038) since the server does not mediate those
  sessions
- keep `libGhostty` internal to `TerminalViewport` through a Fenrir wrapper
- import tmux's effective keymap from the runtime/server instead of treating
  tmux shortcuts as static defaults
- keep native overlays outside the tmux pane grid while making them navigable
  with tmux-like ergonomics

## Current State

The Swift package now defines the canonical native product modules with
`MODULE.md`, `index.swift`, `Contracts`, `Services`, `Actions`, `Models`,
`Layers`, `Views`, and `__tests__` structure. Public use should go through
module namespaces, contracts, services, and specific actions.

- `AuthSession`
- `ServerConnection`
- `NativeRuntime`
- `TerminalViewport`
- `PaneGrid`
- `WorkspaceIndex`
- `WorkspaceShell`
- `WorkspaceCoordinator`
- `ClientControl`
- `WorkspaceOverlays`
- `AgentInteraction`
- `WorkflowControl`
- `Settings`
- `Keybinding`
- `Notifications`
- `Diagnostics`
- `NativeDistribution`
- `NeovimBridge`

The current executable `FenrirNativeApp` is an AppKit native shell with a typed
`NativeHostControlController`, workspace window registry, local CLI control
socket, palette/diagnostics/workflow command paths, and server-event projection
hooks. It is still an incremental native client: several live production
adapters remain incomplete or unavailable by default.

Current implementation state:

- AppKit shell, local CLI control socket, workspace window registry, palette,
  diagnostics, workflow panel, agent composer, and pane-grid host are wired.
- Native app-to-server RPC defaults to authenticated WebSocket transport, with
  HTTP compatibility transport retained as an explicit fallback.
- Local server preparation can discover an existing server or spawn a bundled
  server under NativeHost supervision; ownership is tracked so Fenrir only
  shuts down processes it launched.
- Keychain-backed auth secure storage exists for bearer material; bootstrap
  credential exchange and WebSocket token issuance are implemented in the live
  transport path.
- NativeRuntime has a server tmux adapter for workspace snapshot, ensure,
  focus, resize, pane write contracts, stream subscribe, and stream envelope
  mapping.
- TerminalViewport owns the FenrirTerminalView boundary, stream ingestion,
  reserved OSC stripping/forwarding, renderer backpressure batching, and context
  capture contracts. The production libGhostty backend artifact remains a
  distribution/runtime dependency; tests use fake renderer ports. Startup
  readiness now treats a missing renderer artifact as a blocking diagnostic by
  default; the AppKit bootstrap text renderer is explicitly degraded and only
  opt-in for local smoke work with `FENRIR_NATIVE_ALLOW_BOOTSTRAP_TERMINAL=1`.
- PaneGrid and WorkspaceShell have AppKit host surfaces with tmux window/tab and
  pane projection, focus, resize, palette, sidebar, overlays, and theme tokens.
- WorkflowControl lists, opens timelines, controls server-owned workflow runs
  where supported, subscribes to live workflow events, and projects workflow
  notifications.
- AgentIntegration detects supported CLIs on PATH, ingests reserved OSC
  presence, and now includes managed live provisioners behind installer/MCP
  ports. The legacy managed provisioner performs Fenrir-owned hook/skill block
  edits and JSON MCP updates; the provider-structured provisioner targets the
  real Claude Code, Codex, Cursor, and OpenCode config surfaces, including JSON
  hooks, owned skills/plugins, JSON MCP, and Codex TOML MCP. Both paths are
  idempotent, backup-backed, and conflict-refusing. NativeHost and the
  `fenrir agent-integration status|repair|remove` CLI now expose explicit
  status, repair, and clean removal operations over the local native control
  socket. First-run degraded-state presentation, the sidebar attention entry,
  and the command-palette repair surface are wired; a dedicated settings
  preferences page for agent integrations remains the next integration layer.
- AgentInteraction supports bounded context capture and native composer flow;
  base submission dispatches server orchestration commands and intentionally
  avoids writing into tmux panes.
- Remaining large product gaps are the production libGhostty backend/artifact
  and packaging artifact path, a dedicated agent-integration settings
  preferences page, signing/notarization/updater, crash reporting, and broader
  performance/failure-injection hardening.

Implemented documentation should distinguish this scaffolded/partially wired
state from final target behavior. Roadmap workstreams below remain the target
architecture unless explicitly marked complete by later implementation notes.

## Resolved Architecture Decisions

These decisions have been accepted and are recorded in
`docs/native-terminal-client-decisions.md`.

### D-006: Terminal Embedding Boundary

Decision: create `FenrirTerminalView` as a thin internal wrapper around
`libGhostty`.

Required outcomes:

- AppKit views outside `TerminalViewport` never import raw Ghostty types.
- `TerminalViewport` owns the Ghostty bridge, surface lifecycle, renderer input,
  selection, clipboard, resize, search, and scrollback interactions.
- Tests can use fake renderer ports without loading `libGhostty`.

### D-007: Local Server Bootstrap

Decision: support both connecting to an existing local server and spawning one
when no healthy local server is available.

Required outcomes:

- local bootstrap belongs to the application shell or a narrow native adapter,
  not to `ServerConnection`
- `ServerConnection` receives resolved endpoints, sessions, and transport
  adapters
- the user can explicitly select local or remote server profiles

### D-008: Local Transport Boundary

Decision: use Unix domain socket for local CLI-to-native-app control, and use
authenticated WebSocket/TCP for native-app-to-local-server communication
initially.

Required outcomes:

- CLI control IPC is separate from Fenrir server RPC
- terminal bytes never travel through CLI control IPC
- all local transports still bind to explicit auth/session identity
- Unix socket support for server RPC is a future optimization, not a base
  blocker

### D-009: Native Runtime Spec

Decision: freeze the runtime protocol before porting behavior to Swift.

Required outcomes:

- Swift DTOs match the server runtime protocol exactly
- stream cursor, replay, gap, overflow, close, write ack, resize, and capability
  semantics are documented and tested
- the TypeScript client runtime and Swift runtime can be compared against the
  same behavioral spec during migration

### D-011: Resize Authority

Decision: tmux runtime sessions are actor-scoped by default, and resize
authority is resolved only among attachments for the same actor/session.

Required outcomes:

- runtime identity includes server/profile, tenant/org, actor/user, and
  project/workspace
- different users do not share tmux sessions, panes, tabs, or processes by
  default
- shared sessions are a future explicit feature with their own permissions,
  resize policy, and write policy
- only the focused visible viewport sends authoritative resize updates
- passive clients can observe without fighting size
- split drag, zoom, restore, and reconnect have deterministic resize behavior

### D-012: Scrollback Ownership

Decision: durable replay belongs to tmux plus the server pane-stream contract;
renderer-local scrollback is a viewport concern only.

Required outcomes:

- reconnect/backfill never depends on local renderer scrollback
- local scrollback can be cleared or recreated without corrupting stream state
- gap/overflow is surfaced explicitly to the user

### D-013: Neovim Integration

Decision: Neovim runs as a real tmux pane process, but native Fenrir
integration is part of the base design.

Required outcomes:

- no embedded Neovim widget is required for the base architecture
- Neovim panes get metadata, environment bootstrap, and bridge/RPC discovery
  where available
- native UI can create, focus, reconnect, and open file/range targets in Neovim
- bridge failure degrades to normal terminal Neovim, not a broken session

### D-014: CLI Control Surface

Decision: the `fenrir` CLI controls the running native app for product commands
and continues to own server/admin commands where appropriate.

Required outcomes:

- `fenrir open <workspace>` opens or focuses a workspace when the native app is
  already running; launch/deferred-command behavior is future work
- `fenrir attach <workspace>` is available for remote/reconnect/advanced
  attachment flows, but local product flow prefers one window per workspace
- `fenrir focus <workspace>` focuses an already open local workspace
- `fenrir list workspaces` reports local and server-backed workspace state
- `fenrir remove <workspace>` removes or closes host-visible native workspace
  state without being documented as session termination
- destructive commands route through authenticated server contracts

### Product State Architecture

Decision: Fenrir Native does not adopt TCA as its primary architecture.

Required outcomes:

- canonical modules remain the product architecture
- AppKit controllers/views call typed actions and services
- Supacode influences boundaries, sidebar projections, terminal managers, and
  command/event patterns, not the framework choice

### Pane Grid Ownership

Decision: the main tab strip is tmux windows and the main pane grid is tmux
panes.

Required outcomes:

- no fake/client-only panes in the pane grid
- client-only surfaces live in overlays, sidebar, inspectors, popovers, or
  settings
- operational surfaces in the grid must be backed by real tmux/server-kernel
  panes plus metadata

### Terminal Context And Agent Interaction

Decision: sending terminal context to an agent is explicit, bounded, and
composer-driven; base delivery targets authenticated server orchestration,
not pane writes.

Required outcomes:

- capture sources are terminal selection, visible viewport, and last N lines
- keybindings trigger context capture and open a native composer overlay
- the user can edit prompt/context before sending
- context carries workspace/tab/pane/source/sequence metadata where available
- agents do not write directly into user panes in the base native client;
  base composer submission is server-orchestrated and does not write into panes
  (D-040)
- the receiving agent CLI owns the conversation transcript; sent context is
  never treated as logs or telemetry, and the native client keeps no parallel
  transcript store

### D-037/D-038/D-039/D-040: Agent CLI Integration Model

Decision: agents run as normal CLI processes in tmux panes; there is no native
chat view. Fenrir provisions hooks, skills, and MCP configuration into each
supported agent CLI behind a common integration contract, reads presence from
hook-emitted OSC sequences, and dispatches composer prompts into agent panes.

Required outcomes:

- no native transcript store, response renderer, provider/model picker, or
  approval panel in the base client; those live in the agent's own TUI
- per-agent installer adapters (Claude Code, Codex, Cursor, OpenCode initially)
  with ownership markers, idempotent reapply, version stamping, and clean
  uninstall
- a reserved OSC sequence carries metadata-only presence (started, busy,
  awaiting input/approval, completed, failed, ended); `TerminalViewport`
  strips/forwards it, `AgentIntegration` parses it
- presence feeds sidebar attention, palette `!` domain, and notifications; it
  is never an authorization signal
- base prompt submission dispatches an authenticated server orchestration
  command and intentionally avoids tmux pane writes; pane-targeted prompt
  dispatch is a future explicit decision if reaccepted
- unprovisioned agent CLIs keep working as plain terminal panes

### Workspace Overlays

Decision: composer, conversations, results, diagnostics, help, and similar
surfaces live in `WorkspaceOverlays`.

Required outcomes:

- overlays are native workspace-scoped surfaces, not tmux panes
- overlays have tmux-like navigation and focus behavior
- close/escape returns focus to the originating pane or shell focus target
- overlays can appear in sidebar activity and palette results

### Tmux Keymap And Palette

Decision: import the effective tmux keymap from the runtime/server and map
known bindings to Fenrir actions.

Required outcomes:

- do not parse `.tmux.conf` manually
- support root, prefix, prefix2, and relevant custom key tables
- unknown tmux bindings report unsupported instead of executing arbitrary
  command strings
- `Cmd+P` opens the native palette, defaulting to workspace switcher
- palette prefixes are domain selectors: default workspaces, `@` actions, `$`
  files, `%` tabs/panes, `!` workflows/agents requiring attention, and `?`
  help/keybindings

### Scope Guardrails

Decision: browser-lab and dedicated managed/remote process native surfaces are
outside the base Swift roadmap.

Required outcomes:

- browser-lab remains an Electron/web capability until separately redesigned
- managed/remote processes can appear as normal tmux panes if the server already
  exposes them that way, but no dedicated native surface blocks the base client
- workflows remain in scope; their execution is server-owned and native owns
  visualization/control only

## Workstream 1: Native Build And Packaging Foundation

Goal: make the native app buildable, repeatable, and ready for a Ghostty-backed
runtime without destabilizing the repository.

Deliverables:

- decide whether the native package remains SwiftPM-only or gains Xcode/Tuist
  generation for app packaging
- add a deterministic `libGhostty` build path or binary artifact strategy
- add native build scripts for build, run, test, lint, format, and doctor checks
- pin Swift, Xcode, Zig, and Ghostty build prerequisites if Ghostty is built
  from source
- document local development setup for native app work
- ensure repository gates still run from the root with `bun fmt`, `bun lint`,
  and `bun typecheck`

Validation:

- clean checkout can build the Swift package
- clean checkout can build or fetch the Ghostty artifact
- CI or local scripts fail clearly when required tool versions are missing
- native tests run without launching the GUI

Dependencies:

- D-006 terminal embedding boundary

## Workstream 2: Missing Core Modules

Goal: materialize the module map completely before complex UI work starts.

Deliverables:

- create `Settings` target/module with the canonical structure
- create `Keybinding` target/module with the canonical structure
- create `Notifications` target/module with the canonical structure
- create `WorkspaceOverlays` target/module with the canonical structure
- create `AgentInteraction` target/module with the canonical structure
- create `WorkflowControl` target/module with the canonical structure
- add `MODULE.md`, `index.swift`, `Contracts`, `Services`, `Actions`,
  `Models`, `Layers`, `Views`, and `__tests__` for each module
- expose only actions and narrow service ports through public module barrels
- update `Package.swift` dependencies and tests

Validation:

- each new module has isolated unit tests for public contracts and actions
- no module imports another module's internal `Models` or `Layers`
- `WorkspaceShell`, `PaneGrid`, `TerminalViewport`, `WorkspaceIndex`, and
  `ServerConnection` depend on these modules through public contracts only
- server-backed feature actions use feature service ports with live adapters over
  `ServerConnection`, not raw transport calls

Dependencies:

- existing canonical module map

## Workstream 3: NativeHost Application Shell

Goal: replace the placeholder AppKit shell with a real application composition
root while keeping business logic inside product modules.

Deliverables:

- app delegate with launch, reopen, terminate, and deferred-command handling
- single logical native-client instance for local control commands
- window registry keyed by workspace attachment
- workspace window creation, focus, close, detach, and restore orchestration
- explicit startup sequence for settings, auth, server endpoint resolution,
  local server bootstrap, runtime, and shell creation
- termination sequence that persists layout, workspace index state, and
  process/activity snapshots
- crash-safe handling for commands received before the product graph is ready

Validation:

- opening the app creates the application shell without attaching a workspace
  accidentally
- deferred CLI/open commands execute after composition completes
- closing a window detaches the viewport and does not terminate the tmux session
- app relaunch restores safe local state without duplicating windows

Dependencies:

- Workstream 2
- D-007 local server bootstrap
- D-014 CLI control surface

## Workstream 4: CLI And Local Client Control

Goal: make the `fenrir` CLI a first-class control surface for the native app.

Deliverables:

- local Unix socket control server in `NativeHost`
- CLI client capable of discovering the running app instance
- fallback launch path when the app is not running
- typed request/response protocol for `open`, `attach`, `focus`, `switch`,
  `list`, `remove`, `control`, and future destructive server-routed commands
- bounded payload sizes, read/write timeouts, stale socket cleanup, and
  protocol versioning
- mapping from CLI commands to existing `ClientControl` actions
- user-facing error taxonomy for app unavailable, auth required, workspace not
  found, server unavailable, and destructive confirmation required

Validation:

- `fenrir open <workspace>` focuses an existing window when possible
- `fenrir attach <workspace>` supports explicit attach/reconnect behavior but
  does not create duplicate local windows by default
- `fenrir focus <workspace>` fails clearly when no local window exists
- `fenrir list workspaces` reports visible, attachable, favorite, recent, and
  server-known workspaces
- malformed IPC payloads cannot crash the app

Dependencies:

- Workstream 3
- `ClientControl`
- `WorkspaceCoordinator`
- `WorkspaceIndex`

## Workstream 5: Settings, Profiles, And Persistence

Goal: persist the local product model needed by sidebar, switcher, remote
profiles, keybindings, notifications, and app relaunch.

Deliverables:

- typed settings store with versioned schema and migrations
- local workspace catalog persistence
- remote server profiles
- local server preference and bootstrap policy
- keybinding profile persistence
- sidebar visibility, pinned workspaces, recent workspaces, archived/hidden
  workspaces, and notification summaries
- layout snapshot persistence for windows, tabs, panes, focus, and zoom state
- safe incremental writes with debounce and atomic replace
- no bearer/session secrets, terminal scrollback, live runtime health, workflow
  execution state, or raw agent transcript authority in Settings

Validation:

- corrupt settings files fail closed and preserve a recoverable backup
- multiple writes cannot clobber newer state
- relaunch restores sidebar and workspace summaries without opening stale
  terminal streams
- tests cover migration from every supported schema version

Dependencies:

- Workstream 2

## Workstream 6: AuthSession Live Layer

Goal: implement secure native auth for local and remote Fenrir servers.

Deliverables:

- Keychain storage for opaque bearer/session material
- local server auth bootstrap
- remote pairing flow
- session load, refresh, revoke, and clear live adapters
- WebSocket token issuance
- explicit actor construction for runtime calls
- auth policy discovery per endpoint/profile
- surfacing for expired, revoked, insufficient-scope, and pairing-required
  states

Validation:

- bearer material never appears in logs, UI snapshots, or public DTO
  descriptions
- refresh failure downgrades the connection without corrupting workspace state
- revocation closes or downgrades active server streams
- tests cover session/profile mismatch and token expiry boundaries

Dependencies:

- Workstream 5
- `AuthSession` contracts

## Workstream 7: ServerConnection Live Transport

Goal: create the native authenticated WebSocket/request/stream adapter.

Deliverables:

- endpoint resolver for local, remote, and named profiles
- WebSocket transport adapter with request/response and typed streams
- heartbeat, liveness, reconnect, and backoff policy
- request timeout and cancellation semantics
- stream subscription lifecycle with server-side close propagation
- health summaries for UI and diagnostics
- stable error tags for auth, transport, protocol, timeout, server unavailable,
  and reconnect exhausted states
- optional local Unix socket or localhost transport adapter for local server
  communication where supported

Validation:

- reconnect does not duplicate active streams or commit stale session state
- request timeout does not poison the transport session
- heartbeat failure triggers reconnect and UI health updates
- integration harness can simulate disconnect, delayed response, malformed
  frame, and server restart

Dependencies:

- Workstream 6
- D-008 local transport boundary

## Workstream 8: Local Server Bootstrap And Supervision

Goal: make local Fenrir server usage feel native while preserving server/client
separation.

Deliverables:

- local server discovery
- spawn supervisor for the bundled or configured server command
- readiness probe and health check
- stdout/stderr log capture with rotation or bounded retention
- crash/restart policy with user-visible degraded states
- version/capability check between native client and server
- explicit stop/restart controls where appropriate

Validation:

- app connects to an already-running local server
- app can spawn a local server when none is running
- server crash is surfaced and reconnection is attempted predictably
- app quit does not kill user-owned servers unless Fenrir spawned and owns the
  process by policy

Dependencies:

- Workstream 7
- D-007 local server bootstrap

## Workstream 9: NativeRuntime Tmux Adapter

Goal: wire the Swift native runtime to the Fenrir server tmux kernel contracts.

Deliverables:

- capability discovery
- actor-scoped workspace attach, detach, reconnect, terminate, and forget flows
- tmux window list and active window projection
- tmux pane layout snapshot projection
- pane stream subscribe, replay, reconnect, gap, overflow, and close handling
- pane input with write acknowledgements
- pane resize with explicit authority policy
- pane close, split, focus, select tab/window, rename tab/window, and zoom
  actions
- runtime health events for shell and diagnostics

Validation:

- attach returns a stable workspace runtime identity
- default runtime identity is scoped by server/profile, tenant/org, actor/user,
  and project/workspace
- stream reconnect resumes from `afterSeq` or explicitly reports gap/overflow
- write acknowledgement ordering is deterministic
- resize under focus changes does not oscillate
- closing a viewport detaches without killing the tmux pane unless explicitly
  requested

Dependencies:

- Workstream 7
- D-009 native runtime spec
- D-011 resize authority
- D-012 scrollback ownership

## Workstream 10: TerminalViewport And libGhostty

Goal: render one tmux pane as a native terminal viewport through `libGhostty`.

Deliverables:

- `FenrirTerminalView` AppKit wrapper
- Ghostty runtime initialization and resource loading
- terminal surface lifecycle, create, attach, detach, dispose
- input routing, IME, secure input, key equivalents, and modifier handling
- clipboard, selection, context menu, paste protection, and bracketed paste
- resize, font, theme, color scheme, cursor, search, and scrollback behavior
- renderer-local scrollback separated from durable stream replay
- bounded terminal context capture from selection, visible viewport, and last N
  rendered lines
- stream chunk application from `NativeRuntime`
- visible gap/overflow/degraded indicators
- fake renderer ports for tests

Validation:

- high-volume output does not freeze the main app
- terminal focus, IME, copy, paste, resize, and selection work in AppKit
- unhandled keybindings fall through to terminal behavior correctly
- renderer can be destroyed/recreated without corrupting runtime stream state
- tests cover viewport actions without loading Ghostty
- context capture does not expose raw Ghostty internals outside
  `TerminalViewport`

Dependencies:

- Workstream 1
- Workstream 9
- D-006 terminal embedding boundary
- D-012 scrollback ownership

## Workstream 11: PaneGrid

Goal: present the tmux pane layout as the native split grid.

Deliverables:

- AppKit split tree representation of tmux panes
- creation and disposal of `TerminalViewport` hosts
- focus tracking and directional movement
- split resize with drag and keyboard commands
- zoom/unzoom behavior
- pane close/split/select actions routed to `NativeRuntime`
- support for terminal, Neovim, workflow-linked, and agent-linked pane metadata
  when those surfaces are backed by real tmux panes
- empty/degraded pane placeholders
- no fake/client-only panes inside the pane grid

Validation:

- applying a tmux layout snapshot creates exactly the expected viewport hosts
- removing panes disposes viewports and stream subscriptions
- drag resize emits deterministic runtime resize requests
- focus remains stable across layout refreshes and reconnect
- client-only overlays never appear as pane-grid children

Dependencies:

- Workstream 10
- D-011 resize authority

## Workstream 12: WorkspaceShell

Goal: build the complete workspace window shell around the pane grid.

Deliverables:

- workspace window controller and content view controller
- collapsible operational sidebar
- workspace switcher / universal command palette
- tab strip mapped to tmux windows
- toolbar/status surfaces for server health, workflow activity, notifications,
  and active process metadata
- menu and command integration through focused actions
- keybinding dispatch that respects terminal/tmux conventions
- orchestration of `WorkspaceOverlays`, `AgentInteraction`, and
  `WorkflowControl` entrypoints without owning their feature logic
- shell actions for create, close, focus, toggle sidebar, show switcher, select
  tab, select pane, and expose diagnostics
- degraded states for disconnected server, auth required, stream gap, overflow,
  and missing workspace

Validation:

- sidebar, switcher, keybindings, and CLI all route through the same product
  actions
- tab selection maps to tmux window selection
- client-only overlays remain outside the pane grid
- shell never owns raw terminal bytes
- reconnect and auth degradation are visible without losing local layout

Dependencies:

- Workstream 3
- Workstream 5
- Workstream 9
- Workstream 11

## Workstream 13: WorkspaceIndex And Operational Sidebar

Goal: make the sidebar a high-signal command surface for developer work.

Deliverables:

- cached sidebar projection for active, pinned, recent, remote, missing, and
  archived workspaces
- workspace tree per D-041: each workspace expands into agent sessions (hook
  presence), integrated apps (Neovim, gh-dash, hunks via `AgentIntegration`
  detection adapters), and dev servers (managed-process metadata rows); active
  workspace auto-expands, collapsed workspaces roll attention into badges
- Supacode-inspired attention section, hotkey slots, and row-level projections
- themed rendering through the shared design-token contract (D-041); no
  hardcoded colors
- notification badges for workspace, pane, agent, workflow, future git/PR, and
  server-health signals
- fast search/list model shared with the switcher and CLI list output
- favorites, recents, hidden/archived, and visible workspace persistence
- row-level state to avoid invalidating the entire sidebar on frequent events
- remote profile grouping
- failure summaries for unreachable server/workspace states

Validation:

- high-frequency agent/workflow updates do not re-render the full sidebar
- switcher results and CLI list output match the same workspace index state
- notifications can focus the exact workspace/tab/pane when still available
- stale remote/server entries fail visibly and recover when reachable

Dependencies:

- Workstream 5
- Workstream 12

## Workstream 14: Keybinding System

Goal: make keyboard control native, terminal-safe, and aligned with the user's
effective tmux configuration.

Deliverables:

- import effective tmux keymap from the runtime/server; do not parse `.tmux.conf`
  manually
- prefix/key-table state machine for root, prefix, prefix2, repeatable bindings,
  and relevant custom tables
- mapping from known tmux commands to typed Fenrir actions
- discrete unsupported feedback for unknown bindings
- explicit server-side allowlist for any future passthrough behavior
- conflict resolution between app shortcuts, terminal shortcuts, tmux prefix
  behavior, and macOS menu shortcuts
- user overrides stored in `Settings`
- keybinding registry with command identifiers
- dispatch targets for app, workspace shell, pane grid, terminal viewport, and
  Ghostty runtime actions
- `Cmd+P` reserved by default for Fenrir native palette
- visible shortcut hints in palette/menus using imported tmux bindings when
  available
- tests for key conflict and dispatch precedence

Validation:

- terminal-bound keys go to the terminal before app fallbacks
- tmux navigation bindings such as prefix + number and pane-direction bindings
  map to Fenrir/tmux actions where supported
- unsupported tmux bindings do not execute arbitrary command strings
- app commands work from menus, palette, and keybindings through the same
  action path
- user overrides are validated before being persisted
- pane navigation does not break shell input or Neovim input

Dependencies:

- Workstream 2
- Workstream 10
- Workstream 12

## Workstream 15: Notifications And Activity Model

Goal: represent actionable work without reducing everything to chat messages.

Deliverables:

- notification model scoped by workspace, tab, pane, process, workflow, and
  agent where applicable
- read/unread, priority, timestamp, source, and focus target
- integration with sidebar badges, toolbar popovers, command palette, and macOS
  notifications
- activity summaries for busy, idle, awaiting input, failed, completed, and
  disconnected states
- bounded event coalescing to prevent UI floods

Validation:

- notification can focus the exact live pane or explain why it cannot
- agent/workflow noise is coalesced without losing final state
- notifications survive relaunch when still relevant
- no high-volume terminal bytes enter the notification module

Dependencies:

- Workstream 2
- Workstream 13

## Workstream 16: WorkspaceOverlays, AgentInteraction, And WorkflowControl

Goal: make pane-hosted agents and Fenrir workflows first-class terminal-native
citizens without turning overlays into fake tmux panes and without rebuilding a
chat view (D-037).

Deliverables:

- `WorkspaceOverlays` module for composer, results, diagnostics, help, focus
  return targets, pin/restore, and tmux-like overlay navigation
- `AgentInteraction` module for composer input, terminal context attachments,
  server-orchestrated prompt submission per amended D-040, and promotion to
  workflow where supported
- terminal context composer triggered from selection, visible viewport, or last
  N lines
- base submission targeting: authenticated server orchestration command; no
  client-synthesized pane input or ambiguous pane write target in the base
  client
- no native transcript store, response stream renderer, provider/model picker,
  or approval panel; the agent's own TUI owns those surfaces in its pane
- no agent writes to user panes in the base client; base composer submission is
  server-orchestrated and does not write into panes (per amended D-022/D-040)
- `WorkflowControl` module for server-backed workflow list, run detail, step
  detail, structured logs, status, awaiting input, cancel, retry, and
  pause/resume where supported
- workflow notifications, attention items, and focus targets
- ability to open/focus workflow overlays or linked workflow panes from sidebar,
  palette, CLI, and shell commands
- separation between workflow state and terminal byte streams

Validation:

- workflow state remains correct after terminal viewport recreation
- prompt submission is accepted exactly once by the server orchestration path,
  or fails visibly; reconnect does not double-send
- sent terminal context is delivered to the server command payload and is not
  persisted as diagnostics or telemetry
- workflow logs can be tailed without using generic terminal byte paths unless
  intentionally attached to a pane
- cancelling/retrying workflows routes through authenticated server actions
- sidebar/switcher can prioritize awaiting-input agent panes
- overlay close restores focus to the originating pane/shell target

Dependencies:

- Workstream 9
- Workstream 12
- Workstream 15
- Workstream 24 for agent pane detection and presence

## Workstream 17: Neovim Integration

Goal: make Neovim a first-class tmux pane process with native Fenrir
integration from the base design.

Deliverables:

- action to create/focus/reconnect a Neovim pane for a workspace
- environment bootstrap for workspace, server endpoint, pane id, tab id, and
  Fenrir metadata
- Neovim bridge or `nvim --listen` discovery via configured socket
- open file/range actions from palette, sidebar, agent result, workflow, and
  future git/review surfaces
- pane metadata for editor state, file, branch, diagnostics, or current task
  when available
- keybinding compatibility with tmux and Neovim navigation plugins
- shell commands to send focus/navigation intents without stealing normal
  Neovim input

Validation:

- Neovim runs as a normal process inside tmux
- killing/restarting the native app does not kill the Neovim session
- bridge/RPC failure degrades to normal terminal Neovim
- keybindings do not conflict with common Neovim/tmux workflows

Dependencies:

- Workstream 9
- Workstream 10
- D-013 Neovim integration

## Workstream 18: Git And Review Surfaces

Goal: keep future repository state, diffs, hunks, staging, and PR review
compatible with the native architecture without blocking the base terminal.

Deliverables:

- defer a dedicated native git/review module until the base terminal, Neovim,
  agents, workflows, sidebar, palette, and overlays are solid
- document that `lazygit` and `hunks` can run as normal tools in tmux panes
  without special integration
- future native git/review work must use explicit server-backed contracts
  rather than terminal scraping
- future native git/review surfaces must live in overlays/side surfaces or be
  backed by real tmux/server-kernel panes
- future file-opening actions route through the Neovim integration

Validation:

- git state comes from explicit contracts, not terminal scraping
- lack of lazygit/hunks integration does not block agent terminal-context flows
- future native review UI and terminal-hosted tools do not duplicate workspace
  identity

Dependencies:

- Workstream 12
- Workstream 13
- server git/review contracts

## Workstream 19: Base Scope Guardrails

Goal: keep the base native terminal roadmap focused and avoid pulling in
Electron-bound or non-terminal features prematurely.

Deliverables:

- keep browser-lab out of the base Swift roadmap
- keep dedicated managed-process and remote-process native surfaces out of the
  base Swift roadmap
- allow existing server metadata for such processes to render as normal tmux
  panes if they already appear through the tmux kernel
- require separate decision documents before adding dedicated browser-lab,
  managed-process, or remote-process native modules
- keep workflows in scope as server-executed, client-visualized/control
  features

Validation:

- base native implementation can proceed without browser-lab parity
- no fake panes are introduced to represent out-of-scope surfaces
- future reintroduction of these capabilities updates decisions, module map, and
  roadmap first

Dependencies:

- `docs/native-terminal-client-decisions.md`
- `docs/native-terminal-client-module-map.md`

## Workstream 20: Observability, Diagnostics, And Reliability

Goal: make failures visible, diagnosable, and recoverable under real load.

Deliverables:

- native logging facade with subsystem/category taxonomy
- structured diagnostics for auth, server connection, runtime streams,
  renderer, workspace lifecycle, local server bootstrap, and IPC
- user-facing diagnostics panel
- bounded event buffers for recent transport/runtime events
- diagnostics metadata without terminal text by default
- metrics for stream throughput, dropped/coalesced events, reconnect attempts,
  renderer frame pressure, and sidebar update rate
- crash reporting and privacy review
- failure injection harness for disconnects, server restarts, stream gaps,
  malformed frames, slow consumers, and renderer recreation

Validation:

- a local-only server refresh/reconnect problem can be diagnosed from native
  logs and health summaries
- high-output panes do not starve product UI
- reconnect loops are bounded and visible
- diagnostics never expose bearer tokens or sensitive terminal content by
  default
- terminal excerpts in bug reports require explicit opt-in

Dependencies:

- Workstream 7
- Workstream 9
- Workstream 10
- Workstream 12

## Workstream 21: Performance Hardening

Goal: keep terminal streaming and shell interactions predictable under load.

Deliverables:

- explicit backpressure policy from server stream to native runtime to renderer
- chunk coalescing where safe
- bounded UI event fanout for agent/workflow/sidebar updates
- row-level sidebar projection caching
- pane-grid diffing to avoid unnecessary viewport churn
- renderer lifecycle profiling
- memory and CPU budgets for high-output panes and many attached workspaces
- benchmarks for stream apply, reconnect replay, sidebar projection, and layout
  reconciliation

Validation:

- sustained high-volume pane output remains interactive
- multi-pane output does not cause workspace switch latency spikes
- sidebar updates stay bounded during frequent workflow/agent events
- reconnect replay does not block window input

Dependencies:

- Workstream 9
- Workstream 10
- Workstream 13
- Workstream 16

## Workstream 22: Testing Strategy

Goal: keep the architecture mechanically extensible and safe to refactor.

Deliverables:

- module contract tests for every public DTO and error tag
- action unit tests with mocked services for every module
- adapter tests for WebSocket, local IPC, Keychain, settings persistence, and
  Ghostty wrapper seams
- model tests for pane layout, sidebar projection, terminal stream cursors,
  keybinding resolution, and notification coalescing
- integration tests for local server bootstrap, attach, stream reconnect,
  window close/detach, and CLI open/focus
- small e2e set for real user flows
- no reliance on full e2e coverage for module correctness

Required e2e flows:

- `fenrir open <workspace>` opens or focuses a workspace through a running
  native app
- opening a workspace attaches the correct tmux session
- terminal pane renders output and accepts input
- pane stream reconnect resumes or reports gap/overflow
- workspace switch preserves focus and visible layout
- close window detaches without killing the session
- future explicit destructive session termination kills the workspace session
  through the server
- workflow awaiting input is visible in sidebar and focusable

Validation:

- tests can run without a GUI where possible
- GUI tests are isolated and deterministic
- root repository gates pass: `bun fmt`, `bun lint`, `bun typecheck`
- Swift package tests pass for native modules

Dependencies:

- all implementation workstreams

## Workstream 23: Distribution And Migration

Goal: ship the native app as a serious desktop terminal application and migrate
from Electron safely.

Deliverables:

- app bundle packaging through `native/FenrirNative/package-app.sh`
- startup distribution readiness wired into NativeHost bootstrap diagnostics and snapshots
- signing and notarization
- updater strategy
- bundled or discovered CLI installation
- bundled Ghostty resources and terminfo
- bundled or managed Fenrir server strategy
- local server discovery, compatibility validation, and managed override support
- tmux dependency verification, compatible system tmux discovery, and managed
  fallback or install guidance when tmux is missing/incompatible
- Neovim discovery/configuration without bundling Neovim
- migration from existing Electron/client settings where applicable
- compatibility matrix for native app, server, tmux kernel, and CLI versions
- feature flag strategy during Electron replacement
- rollback strategy for server/protocol incompatibility

Validation:

- local app bundle script creates a valid unsigned development bundle
- signed app opens without development environment
- CLI can find and control the installed app
- local server bootstrap works after install
- local tmux dependency failure produces a clear degraded state and remediation
- incompatible server/native versions fail with actionable messages
- Electron and native clients can coexist during migration without corrupting
  workspace state

Dependencies:

- Workstream 1
- Workstream 8
- Workstream 20

## Workstream 24: Agent CLI Integration

Goal: make external agent CLIs first-class citizens of the terminal through
provisioned hooks, skills, MCP configuration, and presence — the core
differentiator of the native product (D-037, D-038, D-039, D-040).

Deliverables:

- `AgentIntegration` module with the canonical structure, added to the module
  map, owning integration contracts: agent CLI detection, integration status,
  hook/skill install/update/remove, and MCP provisioning
- common managed provisioner core for hook/skill blocks and MCP JSON entries is implemented behind the installer/MCP ports
- provider-real target mapping per supported agent CLI (Claude Code, Codex,
  Cursor, OpenCode initially) behind the common contract is implemented through
  `ProviderAgentInstallTargetResolver`; provider-specific structured writes are
  implemented through `ProviderStructuredAgentIntegrationProvisioner`
- ownership-marked, idempotent, version-stamped, cleanly uninstallable config
  edits; user-owned content outside markers is never rewritten; atomic writes
  with backup on conflict
- hook content that emits Fenrir's reserved OSC presence sequence with
  metadata-only payloads: session started, busy, awaiting input/approval, turn
  completed, failed, session ended, plus workspace/pane provenance
- skill content that teaches agents to drive the `fenrir` CLI control surface
  and to use Fenrir MCP tools
- MCP provisioning sourced from the server's MCP configuration contracts per
  workspace/project, translated into each agent's config format
- presence pipeline: `TerminalViewport` strips/forwards the reserved OSC
  sequence; `AgentIntegration` parses and validates it into typed presence
  contracts consumed by `WorkspaceIndex`, `Notifications`, and the palette `!`
  domain
- agent pane metadata (which agent, integration version, presence state) for
  sidebar rows, palette results, and dispatch targeting in Workstream 16
- CLI status, repair, and clean remove operations are exposed as
  `fenrir agent-integration status|repair|remove` through NativeHost
  diagnostics over the local control socket; first-run integration prompt,
  sidebar attention, and palette repair actions are wired so missing or outdated
  integrations are visible degraded states with one-action fixes. A dedicated
  settings preferences page remains required for persistent agent integration
  management.
- optional supplemental reporting from hooks to an authenticated server
  endpoint, with no base-client feature depending on it

Validation:

- installing an integration twice produces no diff; uninstalling restores the
  agent config to its pre-Fenrir state modulo user edits
- user-authored content in agent config files survives install/update/remove
- presence from a pane-hosted agent updates sidebar/notifications within a
  bounded delay, with no terminal byte scraping outside the reserved OSC
  channel
- an agent running over SSH in a remote workspace still reports presence
- malformed presence payloads are dropped with a diagnostics event and never
  reach render output or crash parsing
- presence never triggers pane writes or privileged actions
- unprovisioned agent CLIs work as plain terminal panes with no degraded
  terminal behavior

Dependencies:

- Workstream 9
- Workstream 10
- Workstream 13
- Workstream 15
- D-037 agent execution model
- D-038 agent presence channel
- D-039 agent integration provisioning
- D-040 prompt dispatch

## Execution Order

The implementation should be done in release-grade passes. Each pass must leave
the architecture stronger than it found it and must include tests at the module
boundary it touches.

1. Close blocking decisions and update decision docs.
2. Finish missing core modules: `Settings`, `Keybinding`, `Notifications`.
3. Establish native build, Ghostty artifact strategy, and local dev tooling.
4. Implement `NativeHost` composition, window registry, and lifecycle.
5. Implement CLI/local control IPC and route it through `ClientControl`.
6. Implement settings/profile persistence.
7. Implement live auth, server connection, and local server bootstrap.
8. Wire `NativeRuntime` to tmux server contracts.
9. Embed `libGhostty` behind `FenrirTerminalView`.
10. Build `PaneGrid` and `WorkspaceShell`.
11. Build operational sidebar, universal palette, notifications, and tmux
    keymap import.
12. Build `AgentIntegration`: per-agent hook/skill/MCP provisioning and the
    OSC presence pipeline into sidebar, palette, and notifications.
13. Build `WorkspaceOverlays`, `AgentInteraction`, terminal-context composer
    with server-orchestrated prompt submission, and `WorkflowControl`.
14. Add native-feeling Neovim integration.
15. Keep git/review, browser-lab, managed-process, and remote-process native
    surfaces behind explicit future decisions.
16. Harden observability, performance, testing, packaging, server management,
    tmux dependency handling, and migration.

## Completion Criteria

The native terminal client is architecturally complete when:

- the app launches like a native terminal emulator
- local and remote Fenrir servers are supported
- `fenrir` CLI can open, attach, focus, list, and remove workspaces through the
  native app and server contracts
- one local product window maps to one workspace, and the workspace runtime maps
  to an actor-scoped tmux session
- tabs and panes map to tmux windows and panes
- pane streams reconnect predictably with gap/overflow reporting
- `libGhostty` rendering is contained behind `TerminalViewport`
- AppKit owns focus, key routing, pane layout, and terminal embedding
- no fake/client-only panes appear in the pane grid
- effective tmux keybindings can navigate tabs/panes through native Fenrir
  actions where supported
- `Cmd+P` opens the native palette with workspace default and domain prefixes
- workflows, agents, terminal-context composer, overlays, and Neovim are
  accessible from sidebar, palette, keybindings, and CLI where appropriate
- workflow execution remains server-owned and native owns visualization/control
- supported agent CLIs can be provisioned with Fenrir hooks, skills, and MCP
  configuration through one-action install/repair, and unprovisioned agents
  still work as plain panes
- pane-hosted agent presence (busy, awaiting input, completed, failed) is
  visible in sidebar, palette `!` domain, and notifications, and can focus the
  exact pane
- the composer loop works end to end: capture terminal context, edit the
  prompt, submit to server orchestration exactly once, and keep pane contents
  unchanged by composer open/submit in the base native client
- there is no native chat view, transcript store, or approval panel; agent TUIs
  own those surfaces in their panes
- agents do not write directly into user panes in the base client; composer
  submission is server-orchestrated and does not write into panes
- browser-lab and dedicated managed/remote process native surfaces are not base
  completion criteria
- module boundaries remain uniform and actions stay atomic
- high-volume terminal bytes never travel through generic product-control,
  workspace-index, notification, or CLI paths
- root gates and native tests pass
