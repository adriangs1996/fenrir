# Tmux Session Kernel Architecture

Status: final target architecture for the tmux session kernel transition.

This document defines the durable architecture Fenrir should converge on. It is
not an MVP design and it does not include the native libGhostty UI application.
The scope is server, contracts, websocket/client-runtime foundations, and the
compatibility path needed to keep the current web and Electron behavior working.

## Implemented Foundation Status

The tmux session kernel foundation now has concrete contracts, server services,
websocket wiring, client-runtime helpers, CLI/admin entry points, and focused
tests. The remaining work is product integration: switching the current web
tmux terminal UI from the compatibility `terminal.*Tmux` routes to the kernel
pane APIs and building a native libGhostty host against the runtime boundary.

Implemented foundation:

- `packages/contracts/src/terminalKernel.ts` defines workspace, window, pane,
  permission, process metadata, Neovim bootstrap, operational pane, pane stream,
  write acknowledgement, and kernel event schemas.
- `packages/contracts/src/rpc/terminalKernel.ts` exposes tmux kernel websocket
  RPCs, and `packages/contracts/src/rpc/planes.ts` classifies pane stream/write
  methods as explicit data-plane APIs.
- `apps/server/src/terminal/Services/TmuxWorkspaceService.ts` is the public
  server kernel boundary for workspace/window/pane lifecycle, Neovim bootstrap,
  operational pane metadata, permission checks, write acknowledgement, and stream
  subscription.
- `apps/server/src/terminal/Services/TmuxControlMode.ts` and
  `Layers/TmuxControlMode.ts` provide the tmux control-mode adapter and parsing
  boundary used for state/event synchronization.
- `apps/server/src/terminal/Services/TmuxPaneStreamService.ts` and
  `Layers/TmuxPaneStreamService.ts` own pane output sequence numbers, replay,
  backfill, overflow, and slow-client behavior.
- `apps/server/src/ws/routes/tmuxWorkspace.ts` exposes the kernel over
  authenticated websocket RPC without using web, Electron, native, or loopback
  transport as implicit authority.
- `apps/web/src/rpc/wsRpcClient.ts` exposes a `tmuxKernel` namespace alongside
  the existing compatibility `terminal` namespace.
- `packages/client-runtime/src/nativeTerminalClient.ts` provides the native
  terminal runtime boundary for connection configuration, explicit bearer actor
  identity, workspace attach/detach/reconnect, pane stream state/reconnect, write
  acknowledgements, and capability discovery.
- `fenrir tmux-kernel ...` and `apps/server/scripts/tmux-kernel-admin.ts`
  provide local/offline metadata inspection and live server admin entry points.

## Current Anchors

The current implementation already has three pieces that must remain compatible
during migration:

- `apps/server/src/terminal/Services/Backend.ts` is the public terminal backend
  boundary consumed by websocket routes. Today it delegates thread terminals to
  `TerminalManager` and tmux compatibility to `TmuxSessionManager`.
- `apps/server/src/terminal/Layers/TmuxSessionManager.ts` creates project tmux
  sessions and attaches to them through a PTY-backed `tmux attach-session`
  process. This is compatibility behavior, not the final kernel integration.
- `apps/server/src/ws/routes/terminal.ts` exposes existing `terminal.*` and
  `terminal.*Tmux` RPC methods as control-plane routes. The stream
  `subscribeTerminalEvents` currently carries terminal bytes for compatibility.

The current contracts are in `packages/contracts/src/terminal.ts` and
`packages/contracts/src/rpc/terminal.ts`. `packages/contracts/src/rpc/planes.ts`
already classifies `terminal.write`, `terminal.writeTmux`, and
`subscribeTerminalEvents` as `compat-data-stream`, which is the correct
migration signal: these methods are retained but are not the final high-volume
pane data plane.

The current web client renders terminals with xterm in
`apps/web/src/modules/terminal/components/ThreadTerminalDrawer.tsx`. It uses
`terminal.attachTmux/writeTmux/resizeTmux` when `mode === "tmux"` and regular
`terminal.open/write/resize` otherwise. `apps/web/src/modules/terminal/stores/terminalState.ts`
keeps a small compatibility event buffer; it must not become the final
backpressure or replay mechanism.

## Ownership Model

Tmux is the primary session kernel:

| Fenrir concept                     | Tmux concept                              | Owner                                        |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Workspace/project                  | tmux session                              | server session kernel                        |
| Fenrir tab/window                  | tmux window                               | server session kernel                        |
| Fenrir pane                        | tmux pane                                 | server session kernel                        |
| Terminal renderer                  | client viewport attached to a pane stream | client runtime/UI                            |
| Agent/workflow operational surface | tmux pane plus metadata                   | workflow/orchestration, via kernel contracts |
| Neovim editor surface              | real `nvim` process in a tmux pane        | session kernel bootstrap and registry        |

The server owns canonical session/window/pane metadata. Clients own viewport
state only: focus, layout presentation, terminal renderer lifecycle, font/theme,
and local scrollback. Clients must never infer ownership or permissions from
whether they are web, Electron, or future native clients.

Project/workspace identity remains the durable Fenrir identity. Tmux object
names are derived implementation keys and must be persisted as metadata, not
treated as user-visible or globally stable APIs.

## Public Contracts

Public contracts live in `packages/contracts/src`. The kernel contract is the
`terminalKernel` surface, separate from the compatibility `TerminalEvent`
stream.

Public contract categories:

- Kernel control plane: create/open workspace session, list sessions, create or
  close windows, split/close panes, focus pane, rename window, resize pane,
  spawn process in pane, launch Neovim, attach/detach client viewport.
- Kernel event stream: metadata-only session/window/pane lifecycle events,
  focus changes, process status changes, permission changes, and data-plane
  overflow notifications.
- Pane data plane: high-volume pane output/input contracts with explicit
  sequencing, replay/backfill, overflow, and slow-client semantics.
- Auth and permissions: explicit per-session/per-pane capabilities layered on
  top of existing auth session identity from `packages/contracts/src/auth.ts`.

Compatibility contracts that stay public but should be marked transitional:

- `TerminalOpenInput`, `TerminalWriteInput`, `TerminalResizeInput`,
  `TerminalCloseInput`, `TerminalEvent`, and `TerminalSessionSnapshot` in
  `packages/contracts/src/terminal.ts`.
- `TmuxAttachInput`, `TmuxDetachInput`, `TmuxWriteInput`, `TmuxResizeInput`,
  `TmuxSessionSnapshot`, and `TmuxError` in `packages/contracts/src/terminal.ts`.
- The RPCs in `packages/contracts/src/rpc/terminal.ts`.

These existing contracts preserve current web/Electron behavior. New clients
and new tmux-native features should use the kernel contracts.

## Server Internals

Server internals live under `apps/server/src/terminal` unless a new module
boundary is introduced with its own `MODULE.md`. The public server service
boundary for tmux kernel callers is:

- `TerminalBackend`: compatibility facade only. It keeps current RPCs working
  and delegates tmux-native operations to the kernel when available.
- `TmuxWorkspaceService`: public server service for workspace/session/window/pane
  lifecycle, metadata, Neovim bootstrap, operational surfaces, and permission
  enforcement. Pane data-plane subscriptions must enter through
  `TmuxWorkspaceService.subscribePaneStream` so actor permissions are checked.
- `TmuxControlModeAdapter`: tmux control-mode adapter boundary used by the
  kernel implementation.
- `TmuxPaneStreamService`: internal data-plane publisher with ring buffers and
  per-subscriber flow control. It is owned behind `TmuxWorkspaceService` and is
  not a permission-enforcing public API.
- Pane process metadata is currently stored in pane metadata and persisted with
  tmux workspace metadata. A separate durable process-registry store can be
  introduced later without changing public pane metadata contracts.

`TmuxSessionManager` in `apps/server/src/terminal/Services/TmuxSessionManager.ts`
remains a compatibility/admin helper. Its PTY attach path is useful for
fallbacks but is not the primary synchronization model.

`node-pty` and direct PTY remain compatibility fallbacks for environments where
tmux is unavailable or for legacy thread-scoped terminals. They must not own the
primary project session model once the kernel is enabled.

## Lifecycle

Workspace session lifecycle:

1. Resolve project/workspace identity and cwd from the existing project model.
2. Check explicit permission for the authenticated session.
3. Ensure the tmux session exists using a deterministic internal name derived
   with the existing helpers in `apps/server/src/terminal/tmuxRuntime.ts`.
4. Start or attach one control-mode client for that tmux session.
5. Reconcile tmux state into server metadata.
6. Publish metadata snapshots on the kernel event stream.
7. Keep pane bytes on the pane data plane only.

Window lifecycle:

- A Fenrir tab/window maps to one tmux window.
- Window metadata includes Fenrir window id, tmux window id/index/name,
  workspace id, cwd, creation source, active pane id, lifecycle status, and
  last observed tmux revision.
- Closing a Fenrir window should close the tmux window only when the caller has
  explicit permission and the close mode is destructive. Detaching a viewport is
  not the same as closing a window.

Pane lifecycle:

- A Fenrir pane maps to one tmux pane.
- Pane metadata includes Fenrir pane id, tmux pane id, workspace id, window id,
  cwd, dimensions, process kind, process registry id, status, exit code/signal,
  title, and timestamps.
- Pane creation uses tmux control-mode commands where feasible. Command helpers
  may exist only for bootstrap/admin fallback.
- Pane resize is a viewport/control operation, not a byte-stream event.

Server restart lifecycle:

- On startup, the kernel enumerates existing Fenrir-owned tmux sessions and
  reconciles sessions/windows/panes before accepting pane data subscriptions.
- Persisted metadata is used to recover Fenrir ids and ownership; tmux state is
  treated as the source of truth for live process existence.
- Unknown Fenrir-owned tmux objects are imported into a quarantined/recovered
  state until they are reconciled with project metadata or cleaned up.

## Metadata and Persistence

Persist durable metadata in the server persistence layer, not in client local
storage and not only in tmux names. The metadata store should contain:

- workspace/session records: project id, session id, tmux session name, cwd,
  owner metadata, created/updated timestamps, lifecycle status.
- window records: Fenrir window id, tmux window id/index, display name, cwd,
  active pane, ordering, lifecycle status.
- pane records: Fenrir pane id, tmux pane id, window id, cwd, dimensions,
  process registry id, process kind, lifecycle status, exit details.
- process registry records: command, argv, env bootstrap references, started
  by, workflow/agent linkage, Neovim bootstrap metadata, managed-process
  linkage where applicable.
- stream checkpoints: per-pane ring-buffer low/high sequence bounds and
  overflow counters. These can be volatile if the ring buffer is memory-only,
  but the semantics must be public.

Terminal history files owned by `TerminalHistoryManager` are legacy
thread-terminal persistence. They are not the final pane replay mechanism.

## Control Mode Target Behavior

The final kernel uses tmux control mode as the primary integration:

- One managed control-mode connection per live tmux session, supervised with
  Effect scopes/fibers.
- Parse `%window-add`, `%window-close`, `%window-renamed`, `%pane-mode-changed`,
  `%output`, `%extended-output`, `%layout-change`, `%session-changed`,
  `%exit`, and related notifications into typed internal events.
- Use tmux commands over the control-mode connection for window/pane creation,
  resize, selection, process sends, and lifecycle operations.
- Bootstrap/admin helpers may use `tmux` command execution for availability
  checks, first session creation, kill-session fallback, and recovery from a
  broken control-mode connection.
- Command helpers must be wrapped in bounded timeouts. The current
  `DEFAULT_TMUX_COMMAND_TIMEOUT_MS` in `apps/server/src/terminal/tmuxRuntime.ts`
  is the right pattern.

Control-mode parsing must be tested as pure parsing logic. Runtime lifecycle
tests should cover reconnect, duplicate event suppression, malformed records,
and session loss.

## Pane Data Plane

Pane bytes must stay out of generic orchestration/RPC hot paths. The final pane
data plane is an explicit contract separate from `subscribeTerminalEvents`.

Required semantics:

- Sequence numbers are per pane and monotonically increasing.
- Every output chunk has `{ paneId, streamId, seq, bytes/text, emittedAt }`.
- Subscription input includes `paneId`, optional `afterSeq`, desired backfill
  mode, and client receive limits.
- A subscriber first receives either a backfill range or a gap/overflow marker,
  then live chunks.
- The server keeps a bounded per-pane ring buffer. The buffer exposes
  `lowSeq`, `highSeq`, and `droppedCount`.
- If `afterSeq < lowSeq`, the server emits an overflow/gap event with the
  available range and resumes from `lowSeq` unless the client requested
  fail-on-gap.
- If the client is slow, the subscriber queue is bounded. Overflow is reported
  with a data-plane overflow event and the subscription either fast-forwards or
  closes according to the requested policy.
- Input writes are bounded and acknowledged on the control plane or data plane
  with an accepted/rejected result. They must not be fire-and-forget for remote
  multi-client scenarios.
- Metadata events may reference stream sequence ranges, but they must not carry
  bulk terminal bytes.

The existing `apps/web/src/modules/terminal/stores/terminalState.ts` event
buffer is only a UI compatibility buffer. It is not sufficient for reconnect,
multi-client replay, or slow-client semantics.

## Auth and Permissions

Auth remains host-neutral. Use the session identity and roles from
`packages/contracts/src/auth.ts`; do not infer authority from web, Electron,
native, loopback, or terminal transport.

Kernel permissions must be explicit:

- workspace/session read: list and inspect session/window/pane metadata.
- pane read: subscribe to pane output/backfill.
- pane write: send input to a pane.
- pane control: resize, focus, split, close, rename, clear, interrupt.
- process spawn: create shell/process panes.
- Neovim launch: create or attach to an editor pane with bootstrap context.
- destructive session control: kill session/window/pane or force close.
- owner/admin: grant/revoke per-workspace or per-pane permissions.

For single-user local mode, the server may grant broad permissions to the
paired owner session, but the grant must still be represented explicitly in the
auth/access model. Future multiuser behavior should be a contract extension,
not a transport special case.

All data-plane subscription and input endpoints must check permissions at
subscription/start and again for each mutating operation. Permission revocation
must close or downgrade active subscriptions.

## Neovim Bootstrap

Neovim is a real process in a tmux pane, not an Electron widget.

Launch flow:

1. Caller requests a Neovim pane for a workspace/window with cwd, target files,
   optional line/column, and bootstrap profile.
2. Kernel checks `Neovim launch` and `process spawn` permissions.
3. Kernel creates or reuses a tmux pane through the `tmux.neovimPane.create`
   or `tmux.neovimPane.reconnect` websocket control-plane methods, backed by
   `TmuxWorkspaceService` `createNeovimPane` / `reconnectNeovimPane`, and
   starts `nvim` with bootstrap environment variables pointing to Fenrir context:
   `FENRIR_WORKSPACE_ID`, `FENRIR_WINDOW_ID`,
   `FENRIR_NEOVIM_BOOTSTRAP_ID`, and `FENRIR_NEOVIM_PROFILE_ID`.
4. Pane metadata records process kind `neovim`, command details, bootstrap
   context, owning workspace/window/pane, profile, files, cursor target, launch
   source, and bootstrap env keys. The runtime pane map is the first process
   registry implementation and is persisted with tmux workspace metadata.
5. Client renders the pane through the same pane data plane as any other
   terminal process.

Native terminal clients should not launch an embedded Neovim widget. They
request or reconnect a Neovim pane from the server with `TmuxNeovimPaneInput`,
attach to the returned pane's `stream` descriptor with
`tmux.pane.subscribeStream`, and send keystrokes with `tmux.pane.write`.
Reconnect first focuses a registered running Neovim pane with the same
bootstrap id; if it is missing or closed, the server creates a replacement pane
using the same bootstrap context.

`@fenrir/client-runtime` exposes small bootstrap helpers for this path:
`createNeovimPaneBootstrapInput` applies native-client defaults for
`tmux.neovimPane.create` / `tmux.neovimPane.reconnect`,
`findRunningNeovimPane` checks returned snapshots for a matching registered
Neovim process pane, and `createPaneStreamSubscribeInput` builds a pane stream
subscription with explicit backfill and slow-client policy defaults. These
helpers do not perform auth or infer permissions from transport; callers still
send the authenticated `TmuxActor` and the server enforces all grants.

Existing desktop Neovim theme/runtime files under `apps/desktop/src/neovim`
can remain bootstrap assets, but the editor process lifecycle belongs to the
session kernel.

## Agent and Workflow Pane Semantics

Agents and workflows may use panes as operational surfaces, but provider-neutral
workflow contracts remain the authority for workflow state. A pane is an
attachment or operational surface, not the workflow identity.

Rules:

- Workflow run/thread ids stay in orchestration/workflow contracts.
- A workflow-owned pane records linkage metadata in the process registry.
- Agent, workflow, managed-process, remote-process, and browser-lab panes attach
  metadata through `tmux.pane.attachMetadata` or at pane creation time. Status is
  exposed through `tmux.operationalPanes.statuses`, which returns pane lifecycle
  state and stream descriptors without terminal bytes.
- Provider runtimes should not receive terminal bytes through generic
  orchestration event streams.
- Agents may send input to panes only through explicit pane-write capabilities.
- Pane lifecycle failures can emit workflow-relevant events, but workflow
  state transitions remain in the existing orchestration/workflow modules.
- Remote host and Browser Lab surfaces may reference host/connection/run,
  profile, tab, and origin metadata, but command output, browser pixels, and
  terminal bytes stay on their explicit data/control planes.

Managed processes already have a tmux-aware executor under
`apps/server/src/managedProcess`. The kernel should eventually share tmux
session/window/pane primitives with managed processes instead of maintaining a
separate tmux model, but existing `managedProcess.*` contracts remain stable.

## Reconnect and Multi-Client Behavior

Multiple clients may attach viewports to the same pane concurrently.

Required behavior:

- Attaching a viewport never steals another viewport.
- Focus is client-local unless explicitly promoted to shared tmux focus.
- Pane input from multiple clients is serialized by the server in arrival order
  after permission checks.
- Resizes are tracked per viewport. The kernel computes a tmux pane size policy
  explicitly, for example active-controller wins or max visible dimensions.
- Reconnect uses `afterSeq` backfill. Clients do not rely on localStorage or the
  compatibility terminal event buffer for correctness.
- Server restart reconciles tmux state, publishes fresh metadata snapshots, and
  lets clients resubscribe with sequence negotiation.
- If replay is unavailable, clients receive a gap/overflow event and must render
  an explicit discontinuity before live output resumes.

Current behavior in `ThreadTerminalDrawer.tsx` kills prior tmux attach clients
to avoid duplicate output forwarding. That behavior is a compatibility artifact
from PTY attach mode and must disappear when control mode owns output fan-out.

## Migration Plan

Completed foundation slices:

1. Kernel contracts in `packages/contracts/src` for session/window/pane metadata,
   control-plane operations, pane stream events, write acknowledgements, and
   explicit permission vocabulary.
2. Control-mode parser/adapter tests under `apps/server/src/terminal`.
3. `TmuxWorkspaceService` server service with metadata reconciliation and
   persisted workspace metadata restore.
4. `TmuxPaneStreamService` with sequence/backfill/overflow/slow-client tests.
5. Websocket routes for kernel metadata and pane data-plane subscriptions, with
   RPC plane classification for bulk pane streams.
6. Neovim pane bootstrap/reconnect as a real tmux pane process with context
   metadata.
7. Operational pane metadata for agents, workflows, managed processes, remote
   processes, browser lab surfaces, and custom panes without changing provider
   or workflow contracts.
8. CLI/admin commands for metadata inspection and live reconnect/remote target
   administration.
9. Native terminal client-runtime boundary for attach, stream replay, write
   acknowledgements, reconnect state, and capability discovery.

Remaining product/runtime work:

1. Switch web tmux mode from `attachTmux/writeTmux/resizeTmux` to kernel pane
   APIs. Keep fallback to `terminal.open/write/resize` when tmux is unavailable.
2. Adapt Electron runtime surfaces to the same client-runtime boundary while
   preserving current desktop behavior.
3. Build the native libGhostty UI application against
   `@fenrir/client-runtime`; this workflow intentionally does not implement it.
4. Retire PTY `tmux attach-session` output forwarding once all tmux UI paths use
   control mode and pane data-plane subscriptions.
5. Decide and implement multi-viewport resize policy for shared panes.
6. Promote pane process metadata to a separate durable registry if operational
   history needs to outlive tmux workspace metadata.

Each slice that changes code must include focused tests for touched public
contracts, parser behavior, lifecycle reconciliation, auth/permission checks,
and stream semantics. Per repository policy, `bun fmt`, `bun lint`, and
`bun typecheck` must pass before the slice is considered complete.

## CLI/Admin Entry Points

Local administration for this kernel is exposed through `fenrir tmux-kernel ...`
and the development wrapper `apps/server/scripts/tmux-kernel-admin.ts`. See
`docs/tmux-kernel-admin-cli.md` for command behavior, explicit actor flags,
metadata storage inspection, remote target listing, and local/remote execution
rules.

## Compatibility Rules

- Current web and Electron terminal behavior must continue working throughout
  the transition.
- Existing `terminal.open/write/resize/close` remains the compatibility path
  for direct PTY terminals.
- Existing `terminal.attachTmux/writeTmux/resizeTmux/detachTmux` remains the
  compatibility path for current tmux mode until the client switches.
- `node-pty`/direct PTY fallback remains available when tmux is unavailable.
- No generic orchestration, workflow, or auth stream may start carrying pane
  bytes as a shortcut.
- No native libGhostty UI application is implemented in this workflow.
- The Fenrir server remains TypeScript/Effect; do not rewrite it in another
  language.

## File Boundary Summary

Public contracts:

- `packages/contracts/src/terminal.ts`: legacy terminal and transitional tmux
  compatibility contracts.
- `packages/contracts/src/rpc/terminal.ts`: legacy/compatibility terminal RPCs.
- `packages/contracts/src/rpc/planes.ts`: websocket plane classification;
  pane stream/write methods are classified explicitly.
- `packages/contracts/src/terminalKernel.ts`: session/window/pane, permissions,
  metadata event, operational pane, Neovim, write acknowledgement, and data-plane
  schemas.
- `packages/contracts/src/rpc/terminalKernel.ts`: websocket RPC definitions for
  kernel control plane and pane data-plane subscriptions.

Public server services:

- `apps/server/src/terminal/Services/Backend.ts`: compatibility facade.
- `apps/server/src/terminal/Services/TmuxWorkspaceService.ts`: kernel
  lifecycle/control boundary and the permission-enforcing pane stream entry
  point.
- `apps/server/src/terminal/Services/TmuxControlMode.ts`: tmux control-mode
  adapter boundary.

Server internals:

- `apps/server/src/terminal/Layers/TmuxSessionManager.ts`: compatibility/admin
  tmux helper.
- `apps/server/src/terminal/Layers/TmuxControlMode.ts`: control-mode runtime.
- `apps/server/src/terminal/Layers/TmuxWorkspaceService.ts`: workspace/window/
  pane state, reconciliation, persistence, and permission enforcement.
- `apps/server/src/terminal/Services/TmuxPaneStreamService.ts`: internal pane
  data-plane stream service used behind `TmuxWorkspaceService`.
- `apps/server/src/terminal/Layers/TmuxPaneStreamService.ts`: pane stream
  sequencing/backfill/overflow.

Client compatibility:

- `apps/web/src/modules/terminal/components/ThreadTerminalDrawer.tsx`: current
  xterm renderer and compatibility tmux branch.
- `apps/web/src/modules/terminal/stores/terminalState.ts`: UI state and
  compatibility event buffer, not final stream replay.
- `packages/client-runtime/src`: native/web-compatible kernel client helpers and
  runtime boundary.

## Operational Risks

- Tmux availability and version differences can affect control-mode event
  behavior. Admin command fallbacks must remain bounded and observable.
- Pane replay buffers are memory-bounded. After server restart, clients may get
  a `server-restart` gap rather than historical bytes.
- Slow clients can drop stream data by policy. Native and web renderers must
  surface gaps instead of silently joining discontinuous output.
- Multi-client pane writes are serialized by the server, but user-facing
  coordination remains a product/UI concern.
- Current web/Electron tmux UI still uses compatibility attach routes until the
  product migration is completed.
- The native libGhostty host still needs UI lifecycle, renderer integration,
  keystroke mapping, resize policy, local scrollback presentation, and packaging.
