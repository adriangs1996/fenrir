# Module: Terminal (Server)

> Terminal compatibility services plus the server-owned tmux session kernel.

The terminal module owns both legacy PTY/thread terminal behavior and the tmux
session kernel foundation. The kernel maps project/workspace to tmux session,
Fenrir tab/window to tmux window, and Fenrir pane to tmux pane. Pane bytes belong
to the explicit pane data plane (`TmuxPaneStreamService` and
`tmux.pane.subscribeStream`), not generic orchestration or workflow event paths.

## Public API

### Services

#### `TerminalBackend` (public — consumed by RPC handlers)

Narrow backend boundary for terminal implementations. The current live backend
delegates thread terminals to `TerminalManager` and tmux compatibility to
`TmuxSessionManager`.

| Method       | Input                 | Output                    | Errors          | Description                                  |
| ------------ | --------------------- | ------------------------- | --------------- | -------------------------------------------- |
| `open`       | `TerminalOpenInput`   | `TerminalSessionSnapshot` | `TerminalError` | Open or attach to thread terminal session    |
| `write`      | `TerminalWriteInput`  | `void`                    | `TerminalError` | Write input bytes to thread terminal session |
| `resize`     | `TerminalResizeInput` | `void`                    | `TerminalError` | Resize thread terminal backend               |
| `close`      | `TerminalCloseInput`  | `void`                    | `TerminalError` | Close thread terminal session(s)             |
| `attachTmux` | `TmuxAttachInput`     | `TmuxSessionSnapshot`     | `TmuxError`     | Attach/create project tmux session           |
| `detachTmux` | `TmuxDetachInput`     | `void`                    | `TmuxError`     | Detach active project tmux session           |
| `writeTmux`  | `TmuxWriteInput`      | `void`                    | `TmuxError`     | Write input bytes to project tmux session    |
| `resizeTmux` | `TmuxResizeInput`     | `void`                    | `TmuxError`     | Resize project tmux session                  |

#### `TerminalManager` (public — consumed by RPC handlers, orchestration)

| Method              | Input                             | Output                    | Errors          | Description                                   |
| ------------------- | --------------------------------- | ------------------------- | --------------- | --------------------------------------------- |
| `open`              | `TerminalOpenInput`               | `TerminalSessionSnapshot` | `TerminalError` | Open or attach to terminal session for thread |
| `write`             | `TerminalWriteInput`              | `void`                    | `TerminalError` | Write input bytes to running terminal         |
| `resize`            | `TerminalResizeInput`             | `void`                    | `TerminalError` | Resize PTY dimensions                         |
| `clear`             | `TerminalClearInput`              | `void`                    | `TerminalError` | Clear terminal output history                 |
| `restart`           | `TerminalRestartInput`            | `TerminalSessionSnapshot` | `TerminalError` | Restart terminal in place, reset history      |
| `close`             | `TerminalCloseInput`              | `void`                    | `TerminalError` | Close terminal(s) for thread                  |
| `subscribe`         | `(TerminalEvent => Effect<void>)` | `() => void`              | —               | Subscribe to terminal runtime events          |
| `publishTmuxOutput` | `(projectId, data)`               | `void`                    | —               | Publish tmux output as terminal event         |
| `publishTmuxExit`   | `(projectId, exitCode, signal)`   | `void`                    | —               | Publish tmux exit as terminal event           |

#### `PtyAdapter` (public — also consumed by Metasploit)

| Method  | Input           | Output       | Errors          | Description                   |
| ------- | --------------- | ------------ | --------------- | ----------------------------- |
| `spawn` | `PtySpawnInput` | `PtyProcess` | `PtySpawnError` | Spawn PTY process for session |

#### `TmuxSessionManager` (public — consumed by RPC handlers)

| Method            | Input                   | Output       | Errors                                  | Description                    |
| ----------------- | ----------------------- | ------------ | --------------------------------------- | ------------------------------ |
| `createSession`   | `projectId, cwd`        | `void`       | `TmuxSessionError \| TmuxNotFoundError` | Create new tmux session        |
| `attachSession`   | `projectId, cols, rows` | `PtyProcess` | `TmuxSessionError \| PtySpawnError`     | Attach to tmux session via PTY |
| `detachSession`   | `projectId`             | `void`       | `TmuxSessionError \| TmuxNotFoundError` | Detach from tmux session       |
| `killSession`     | `projectId`             | `void`       | `TmuxSessionError \| TmuxNotFoundError` | Kill tmux session              |
| `hasSession`      | `projectId`             | `boolean`    | —                                       | Check if session exists        |
| `isTmuxAvailable` | —                       | `boolean`    | —                                       | Check if tmux binary on PATH   |
| `writeToSession`  | `projectId, data`       | `void`       | `TmuxSessionError`                      | Write data to tmux session     |
| `resizeSession`   | `projectId, cols, rows` | `void`       | `TmuxSessionError`                      | Resize tmux session            |

#### `TmuxControlModeAdapter` (public — consumed by tmux kernel services)

Owns one `tmux -C` control-mode client process per connection and emits typed
control-mode events. This is the target integration boundary for synchronized
tmux workspace/window/pane state. Command helpers remain bootstrap/admin
fallback only.

| Method         | Input                         | Output                      | Errors                 | Description                                       |
| -------------- | ----------------------------- | --------------------------- | ---------------------- | ------------------------------------------------- |
| `connect`      | `TmuxControlModeConnectInput` | `TmuxControlModeConnection` | `TmuxControlModeError` | Spawn `tmux -C` attach/new-session control client |
| `adminCommand` | `args, { timeoutMs? }`        | `string`                    | `TmuxControlModeError` | Bounded tmux command fallback for bootstrap/admin |

`TmuxControlModeConnection` exposes `command`, `restart`, `stop`, `status`,
`pid`, and `subscribe`. Pane output is parsed into typed adapter events for the
pane data plane; it must not be forwarded through orchestration streams.

#### `TmuxWorkspaceService` (public — server-owned tmux session kernel)

Owns the Fenrir workspace/window/pane model backed by tmux sessions/windows/panes.
This service is the durable server boundary for the tmux kernel and preserves the
legacy web/Electron tmux routes by living alongside `TmuxSessionManager`.

| Method                        | Input                            | Output                            | Errors            | Description                                       |
| ----------------------------- | -------------------------------- | --------------------------------- | ----------------- | ------------------------------------------------- |
| `listWorkspaces`              | `TmuxWorkspaceListInput`         | `TmuxWorkspaceListResult`         | `TmuxKernelError` | List server-known tmux workspaces                 |
| `ensureWorkspace`             | `TmuxWorkspaceEnsureInput`       | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Create/attach control-mode workspace kernel       |
| `reconnectWorkspace`          | `TmuxWorkspaceGetSnapshotInput`  | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Restart control-mode client and reconcile         |
| `getSnapshot`                 | `TmuxWorkspaceGetSnapshotInput`  | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Read current server snapshot                      |
| `createWindow`                | `TmuxWindowCreateInput`          | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Create tmux window and reconcile IDs              |
| `renameWindow`                | `TmuxWindowRenameInput`          | `TmuxWindow`                      | `TmuxKernelError` | Rename tmux window                                |
| `focusWindow`                 | `TmuxWindowFocusInput`           | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Select active tmux window                         |
| `closeWindow`                 | `TmuxWindowCloseInput`           | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Detach/kill Fenrir window                         |
| `createPane`                  | `TmuxPaneCreateInput`            | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Split tmux pane with kind-specific metadata       |
| `attachPaneMetadata`          | `TmuxPaneAttachMetadataInput`    | `TmuxPane`                        | `TmuxKernelError` | Attach operational metadata to existing pane      |
| `listOperationalPaneStatuses` | `TmuxOperationalPaneStatusInput` | `TmuxOperationalPaneStatusResult` | `TmuxKernelError` | Report agent/workflow/process surface pane status |
| `focusPane`                   | `TmuxPaneFocusInput`             | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Select active tmux pane                           |
| `resizePane`                  | `TmuxPaneResizeInput`            | `TmuxPane`                        | `TmuxKernelError` | Resize tmux pane and update metadata              |
| `zoomPane`                    | `TmuxPaneZoomInput`              | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Toggle pane zoom (`resize-pane -Z`)               |
| `closePane`                   | `TmuxPaneCloseInput`             | `TmuxWorkspaceSnapshot`           | `TmuxKernelError` | Detach/terminate/kill Fenrir pane                 |
| `writePane`                   | `TmuxPaneWriteInput`             | `TmuxPaneWriteResult`             | `TmuxKernelError` | Bounded pane input with accepted/rejected ack     |
| `subscribePaneStream`         | `TmuxPaneStreamSubscribeInput`   | `TmuxPaneStreamEvent`             | `TmuxKernelError` | Explicit pane data-plane stream with replay       |
| `subscribe`                   | `workspaceId, listener`          | `() => void`                      | `TmuxKernelError` | Typed kernel events without pane byte data        |
| `sessionNameForProject`       | `ProjectId`                      | `string`                          | —                 | Stable project → tmux session mapping             |

`TmuxWorkspaceService` uses `TmuxControlModeAdapter` for the live control client
and lifecycle/event synchronization. `%window-pane-changed` /
`%session-window-changed` notifications (focus moved by vim-tmux-navigator,
scripts, or another client) are applied directly to the cached
active-pane/active-window mappings and published as a `workspace.snapshot`
event, so subscribed clients mirror tmux focus without a reconcile round trip. Bounded tmux admin commands are retained for
bootstrap and reconciliation operations that require authoritative tmux IDs
(`list-panes`, `new-window -P`, `split-window -P`, `select-*`, `resize-pane`,
`kill-*`). Pane output events are appended into `TmuxPaneStreamService`; kernel
events only publish stream descriptors and lifecycle overflow metadata, never
pane bytes. Workspace/window/pane metadata is persisted at
`{stateDir}/tmux-workspaces/metadata.json` and restored as detached state before
the next control-mode reconnect validates the tmux session marker and reconciles
live tmux IDs.

#### `TmuxPaneStreamService` (internal — pane data plane foundation)

Owns append-only bounded buffers per pane and per-subscriber bounded queues. It
is intentionally separate from orchestration/RPC event paths so high-volume pane
bytes have explicit sequencing, backfill, overflow, and slow-client behavior.

| Method       | Input                          | Output                       | Errors            | Description                                   |
| ------------ | ------------------------------ | ---------------------------- | ----------------- | --------------------------------------------- |
| `ensurePane` | `TmuxPaneStreamDescriptor`     | `TmuxPaneStreamDescriptor`   | —                 | Register stream state and normalize restore   |
| `append`     | `paneId, data`                 | descriptor + overflow result | `TmuxKernelError` | Append chunk with monotonic sequence          |
| `closePane`  | `paneId, reason`               | `void`                       | —                 | Close subscribers with protocol closed event  |
| `subscribe`  | `TmuxPaneStreamSubscribeInput` | `TmuxPaneStreamEvent stream` | `TmuxKernelError` | Backfill from sequence or follow latest bytes |

Buffers keep the latest bounded replay window in memory. If requested backfill
starts before the retained window, subscribers receive `gap` before resumed
chunks. On server restart, descriptors retain high-water marks but replay chunks
are not durable, so subscriptions receive a `server-restart` gap rather than
stale bytes. Slow subscribers use explicit policy: `fast-forward` clears their
queue and emits `overflow` + `gap`; `close` emits `overflow` + `closed` and ends
the queue.

Every gap leaves the affected subscriber's emulator missing a byte range —
usually mid-escape-sequence — so gaps must always be followed by a repaint.
Two mechanisms provide it: `setSubscriberGapHandler` (registered by
`TmuxWorkspaceService`) fires on live fast-forward drops, and
`subscribePaneStream` detects gap-producing resubscriptions itself. Both funnel
into a debounced recovery reseed that appends clear + `capture-pane -e` screen +
cursor position as a live chunk, so every subscriber converges back to tmux's
ground truth.

Consecutive `%output` events for the same pane parsed from a single control-mode
PTY read are coalesced (bounded well under the per-chunk byte cap) before they
reach `append`, so a TUI redraw burst costs a handful of appends/websocket
frames instead of hundreds.

#### `TerminalHistoryManager` (internal — consumed by TerminalManager only)

| Method               | Input                           | Output   | Errors                 | Description                         |
| -------------------- | ------------------------------- | -------- | ---------------------- | ----------------------------------- |
| `read`               | `threadId, terminalId`          | `string` | `TerminalHistoryError` | Read and cap history from disk      |
| `persist`            | `threadId, terminalId, history` | `void`   | —                      | Immediately persist history         |
| `queuePersist`       | `threadId, terminalId, history` | `void`   | —                      | Debounced persist (40ms coalescing) |
| `flushPersist`       | `threadId, terminalId`          | `void`   | —                      | Drain pending persist for session   |
| `delete`             | `threadId, terminalId`          | `void`   | —                      | Delete history file                 |
| `deleteAllForThread` | `threadId`                      | `void`   | —                      | Delete all history files for thread |

#### `TerminalShellResolver` (internal — consumed by TerminalManager only)

| Method           | Input                  | Output             | Errors | Description                            |
| ---------------- | ---------------------- | ------------------ | ------ | -------------------------------------- |
| `resolve`        | —                      | `ShellCandidate[]` | —      | Ordered shell candidates with fallback |
| `createSpawnEnv` | `baseEnv, runtimeEnv?` | `ProcessEnv`       | —      | Filtered env for PTY spawn             |

#### `TerminalProcessLifecycle` (internal — consumed by TerminalManager only)

| Method                    | Input                           | Output    | Errors | Description                                 |
| ------------------------- | ------------------------------- | --------- | ------ | ------------------------------------------- |
| `killProcess`             | `process, threadId, terminalId` | `void`    | —      | SIGTERM → grace period → SIGKILL escalation |
| `checkSubprocessActivity` | `terminalPid`                   | `boolean` | —      | Platform-specific subprocess detection      |

### Events Emitted

| Event       | Schema                   | When                              |
| ----------- | ------------------------ | --------------------------------- |
| `started`   | `TerminalStartedEvent`   | New session spawned               |
| `output`    | `TerminalOutputEvent`    | PTY produces output data          |
| `exited`    | `TerminalExitedEvent`    | PTY process exits                 |
| `error`     | `TerminalErrorEvent`     | Spawn or runtime failure          |
| `cleared`   | `TerminalClearedEvent`   | History cleared                   |
| `restarted` | `TerminalRestartedEvent` | Session restarted                 |
| `activity`  | `TerminalActivityEvent`  | Subprocess activity state changed |

### Contracts (from `@fenrir/contracts`)

- `TerminalOpenInput`, `TerminalWriteInput`, `TerminalResizeInput`, `TerminalClearInput`, `TerminalRestartInput`, `TerminalCloseInput` — RPC input schemas
- `TerminalSessionSnapshot` — Session state snapshot
- `TerminalSessionStatus` — `"starting" | "running" | "exited" | "error"`
- `TerminalEvent` — Union of all event types
- `TerminalCwdError`, `TerminalHistoryError`, `TerminalSessionLookupError`, `TerminalNotRunningError` — Error types
- `TmuxAttachInput`, `TmuxDetachInput`, `TmuxWriteInput`, `TmuxResizeInput`, `TmuxSessionSnapshot` — Tmux schemas

## Dependencies

### Services Consumed

| Service        | From Module         | Why                                 |
| -------------- | ------------------- | ----------------------------------- |
| `PtyAdapter`   | `terminal/Services` | Spawn PTY processes                 |
| `ServerConfig` | `config`            | `terminalLogsDir`, `stateDir` paths |
| `FileSystem`   | `effect`            | Read/write history files            |

### Packages

- `@fenrir/contracts` — All terminal schemas and error types
- `@fenrir/shared/KeyedCoalescingWorker` — Debounced history persistence
- `@fenrir/shared/ansiSanitizer` — ANSI escape sequence sanitization (NEW)
- `effect` — Effect, Layer, Fiber, Semaphore, SynchronizedRef, Scope, FileSystem

### External

- `node-pty` (npm) — Node.js PTY implementation
- `processRunner` — Subprocess activity detection (pgrep/ps/powershell)

## Error Taxonomy

| Error                        | Tag                          | Recovery                                              |
| ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| `TerminalCwdError`           | `TerminalCwdError`           | Validate cwd exists before open/restart               |
| `TerminalHistoryError`       | `TerminalHistoryError`       | Log warning, proceed with empty history               |
| `TerminalSessionLookupError` | `TerminalSessionLookupError` | Return 404-equivalent to client                       |
| `TerminalNotRunningError`    | `TerminalNotRunningError`    | Silently ignore writes to exited sessions             |
| `PtySpawnError`              | `PtySpawnError`              | Try next shell candidate, publish error event on fail |
| `TmuxNotFoundError`          | `TmuxNotFoundError`          | Report to client, tmux not installed                  |
| `TmuxSessionError`           | `TmuxSessionError`           | Report to client with session context                 |

## Filesystem Layout

```
apps/server/src/terminal/
  MODULE.md
  Services/
    Backend.ts              # TerminalBackend public backend boundary (STABLE)
    Manager.ts              # TerminalManager public service interface (STABLE)
    PTY.ts                  # PtyAdapter public service interface (STABLE)
    TmuxSessionManager.ts   # TmuxSessionManager public service interface (STABLE)
    TmuxControlMode.ts      # tmux -C adapter public service interface (NEW)
    TmuxWorkspaceService.ts # tmux workspace/window/pane kernel service (NEW)
    HistoryManager.ts       # TerminalHistoryManager internal service (NEW)
    ShellResolver.ts        # TerminalShellResolver internal service (NEW)
    ProcessLifecycle.ts     # TerminalProcessLifecycle internal service (NEW)
  Layers/
    Backend.ts              # Compatibility backend: TerminalManager + tmux adapter
    Manager.ts              # Orchestration layer — delegates to sub-services (~600 lines)
    HistoryManager.ts       # History persistence layer (NEW, ~300 lines)
    ShellResolver.ts        # Shell resolution layer (NEW, ~120 lines)
    ProcessLifecycle.ts     # Process kill/polling layer (NEW, ~250 lines)
    NodePTY.ts              # node-pty adapter (unchanged)
    BunPTY.ts               # Bun PTY adapter (unchanged)
    TmuxSessionManager.ts   # Tmux implementation (unchanged)
    TmuxControlMode.ts      # tmux -C adapter + parser (NEW)
    TmuxWorkspaceService.ts # server-owned tmux session kernel (NEW)
    TmuxPaneStreamService.ts # pane data-plane buffers and stream protocol (NEW)
  __tests__/
    TmuxSessionManager.test.ts
    TmuxControlMode.test.ts      # NEW parser and adapter boundary tests
    TmuxWorkspaceService.test.ts # NEW workspace lifecycle/reconcile tests
    TmuxPaneStreamService.test.ts # NEW stream replay/overflow tests
    HistoryManager.test.ts       # NEW unit tests
    ShellResolver.test.ts        # NEW unit tests
    ProcessLifecycle.test.ts     # NEW unit tests
    Manager.test.ts              # Existing integration tests (keep)
    NodePTY.test.ts              # Existing (keep, move here)
```

## Integration Points

- **Upstream**: `ws.ts` RPC handlers (`TerminalBackend` for open/write/resize/close and tmux ops; `TerminalManager` for clear/restart/events), `ProjectSetupScriptRunner` (open + write)
- **Downstream**: `PtyAdapter` (NodePTY or BunPTY), `ServerConfig`, `FileSystem`, `processRunner`, Metrics
- **Events**: Terminal events pushed to RPC subscribers via `ws.ts`, consumed by web client `terminalStateStore`
- **Shared consumer**: `MetasploitService` uses `PtyAdapter` directly (not TerminalManager)

## Working On This Module

### For implementers (working INSIDE this module):

- Layer implementations in `Layers/` — change freely without breaking consumers
- `Services/Manager.ts`, `Services/PTY.ts`, `Services/TmuxSessionManager.ts` are PUBLIC contracts — changes are BREAKING
- `Services/TmuxWorkspaceService.ts` is the public tmux kernel boundary for
  workspace/window/pane lifecycle, Neovim panes, operational pane metadata,
  permissions, write acknowledgements, and stream subscriptions
- `Services/TmuxPaneStreamService.ts` owns pane byte sequencing/backfill/
  overflow/slow-client behavior; do not route pane bytes through
  `TerminalManager.subscribe`, workflow streams, or orchestration snapshots
- `Services/HistoryManager.ts`, `Services/ShellResolver.ts`, `Services/ProcessLifecycle.ts` are INTERNAL — change freely
- Tests: integration tests in `Manager.test.ts` cover public API; unit tests per sub-service cover internals
- ANSI sanitization lives in `@fenrir/shared/ansiSanitizer` — pure functions, test independently

### For consumers (working in OTHER modules):

- Import ONLY from public service boundaries:
  `Services/Backend.ts`, `Services/Manager.ts`, `Services/PTY.ts`,
  `Services/TmuxSessionManager.ts`, and `Services/TmuxWorkspaceService.ts`
- Never import from `Layers/` or internal services
- Handle all declared error types in `TerminalError` union
- Subscribe to events via `TerminalManager.subscribe()`, not by importing internals
- For tmux kernel panes, subscribe through `TmuxWorkspaceService.subscribe` for
  metadata lifecycle events and `TmuxWorkspaceService.subscribePaneStream` for
  pane bytes. Metadata events must not include terminal output.
