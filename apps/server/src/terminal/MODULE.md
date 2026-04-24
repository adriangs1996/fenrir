# Module: Terminal (Server)

> PTY-backed terminal session lifecycle management for thread-scoped terminals.

## Public API

### Services

#### `TerminalManager` (public — consumed by RPC handlers, orchestration)

| Method      | Input                | Output                    | Errors          | Description                                      |
| ----------- | -------------------- | ------------------------- | --------------- | ------------------------------------------------ |
| `open`      | `TerminalOpenInput`  | `TerminalSessionSnapshot` | `TerminalError` | Open or attach to terminal session for thread     |
| `write`     | `TerminalWriteInput` | `void`                    | `TerminalError` | Write input bytes to running terminal             |
| `resize`    | `TerminalResizeInput`| `void`                    | `TerminalError` | Resize PTY dimensions                             |
| `clear`     | `TerminalClearInput` | `void`                    | `TerminalError` | Clear terminal output history                     |
| `restart`   | `TerminalRestartInput`| `TerminalSessionSnapshot`| `TerminalError` | Restart terminal in place, reset history          |
| `close`     | `TerminalCloseInput` | `void`                    | `TerminalError` | Close terminal(s) for thread                      |
| `subscribe` | `(TerminalEvent => Effect<void>)` | `() => void`  | —               | Subscribe to terminal runtime events              |
| `publishTmuxOutput` | `(projectId, data)` | `void`           | —               | Publish tmux output as terminal event             |
| `publishTmuxExit`   | `(projectId, exitCode, signal)` | `void` | —             | Publish tmux exit as terminal event               |

#### `PtyAdapter` (public — also consumed by Metasploit)

| Method  | Input          | Output       | Errors          | Description                    |
| ------- | -------------- | ------------ | --------------- | ------------------------------ |
| `spawn` | `PtySpawnInput`| `PtyProcess` | `PtySpawnError` | Spawn PTY process for session  |

#### `TmuxSessionManager` (public — consumed by RPC handlers)

| Method           | Input                   | Output       | Errors                                 | Description                   |
| ---------------- | ----------------------- | ------------ | -------------------------------------- | ----------------------------- |
| `createSession`  | `projectId, cwd`        | `void`       | `TmuxSessionError \| TmuxNotFoundError`| Create new tmux session       |
| `attachSession`  | `projectId, cols, rows` | `PtyProcess` | `TmuxSessionError \| PtySpawnError`    | Attach to tmux session via PTY|
| `detachSession`  | `projectId`             | `void`       | `TmuxSessionError \| TmuxNotFoundError`| Detach from tmux session      |
| `killSession`    | `projectId`             | `void`       | `TmuxSessionError \| TmuxNotFoundError`| Kill tmux session             |
| `hasSession`     | `projectId`             | `boolean`    | —                                      | Check if session exists       |
| `isTmuxAvailable`| —                       | `boolean`    | —                                      | Check if tmux binary on PATH  |
| `writeToSession` | `projectId, data`       | `void`       | `TmuxSessionError`                     | Write data to tmux session    |
| `resizeSession`  | `projectId, cols, rows` | `void`       | `TmuxSessionError`                     | Resize tmux session           |

#### `TerminalHistoryManager` (internal — consumed by TerminalManager only)

| Method             | Input                              | Output   | Errors                 | Description                              |
| ------------------ | ---------------------------------- | -------- | ---------------------- | ---------------------------------------- |
| `read`             | `threadId, terminalId`             | `string` | `TerminalHistoryError` | Read and cap history from disk           |
| `persist`          | `threadId, terminalId, history`    | `void`   | —                      | Immediately persist history              |
| `queuePersist`     | `threadId, terminalId, history`    | `void`   | —                      | Debounced persist (40ms coalescing)      |
| `flushPersist`     | `threadId, terminalId`             | `void`   | —                      | Drain pending persist for session        |
| `delete`           | `threadId, terminalId`             | `void`   | —                      | Delete history file                      |
| `deleteAllForThread` | `threadId`                       | `void`   | —                      | Delete all history files for thread      |

#### `TerminalShellResolver` (internal — consumed by TerminalManager only)

| Method            | Input                                    | Output            | Errors | Description                           |
| ----------------- | ---------------------------------------- | ----------------- | ------ | ------------------------------------- |
| `resolve`         | —                                        | `ShellCandidate[]`| —      | Ordered shell candidates with fallback|
| `createSpawnEnv`  | `baseEnv, runtimeEnv?`                   | `ProcessEnv`      | —      | Filtered env for PTY spawn            |

#### `TerminalProcessLifecycle` (internal — consumed by TerminalManager only)

| Method                    | Input                              | Output    | Errors | Description                                   |
| ------------------------- | ---------------------------------- | --------- | ------ | --------------------------------------------- |
| `killProcess`             | `process, threadId, terminalId`    | `void`    | —      | SIGTERM → grace period → SIGKILL escalation   |
| `checkSubprocessActivity` | `terminalPid`                      | `boolean` | —      | Platform-specific subprocess detection        |

### Events Emitted

| Event               | Schema                    | When                                  |
| ------------------- | ------------------------- | ------------------------------------- |
| `started`           | `TerminalStartedEvent`    | New session spawned                   |
| `output`            | `TerminalOutputEvent`     | PTY produces output data              |
| `exited`            | `TerminalExitedEvent`     | PTY process exits                     |
| `error`             | `TerminalErrorEvent`      | Spawn or runtime failure              |
| `cleared`           | `TerminalClearedEvent`    | History cleared                       |
| `restarted`         | `TerminalRestartedEvent`  | Session restarted                     |
| `activity`          | `TerminalActivityEvent`   | Subprocess activity state changed     |

### Contracts (from `@fenrir/contracts`)

- `TerminalOpenInput`, `TerminalWriteInput`, `TerminalResizeInput`, `TerminalClearInput`, `TerminalRestartInput`, `TerminalCloseInput` — RPC input schemas
- `TerminalSessionSnapshot` — Session state snapshot
- `TerminalSessionStatus` — `"starting" | "running" | "exited" | "error"`
- `TerminalEvent` — Union of all event types
- `TerminalCwdError`, `TerminalHistoryError`, `TerminalSessionLookupError`, `TerminalNotRunningError` — Error types
- `TmuxAttachInput`, `TmuxDetachInput`, `TmuxWriteInput`, `TmuxResizeInput`, `TmuxSessionSnapshot` — Tmux schemas

## Dependencies

### Services Consumed

| Service        | From Module         | Why                                      |
| -------------- | ------------------- | ---------------------------------------- |
| `PtyAdapter`   | `terminal/Services` | Spawn PTY processes                      |
| `ServerConfig` | `config`            | `terminalLogsDir` path                   |
| `FileSystem`   | `effect`            | Read/write history files                 |

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
    Manager.ts              # TerminalManager public service interface (STABLE)
    PTY.ts                  # PtyAdapter public service interface (STABLE)
    TmuxSessionManager.ts   # TmuxSessionManager public service interface (STABLE)
    HistoryManager.ts       # TerminalHistoryManager internal service (NEW)
    ShellResolver.ts        # TerminalShellResolver internal service (NEW)
    ProcessLifecycle.ts     # TerminalProcessLifecycle internal service (NEW)
  Layers/
    Manager.ts              # Orchestration layer — delegates to sub-services (~600 lines)
    HistoryManager.ts       # History persistence layer (NEW, ~300 lines)
    ShellResolver.ts        # Shell resolution layer (NEW, ~120 lines)
    ProcessLifecycle.ts     # Process kill/polling layer (NEW, ~250 lines)
    NodePTY.ts              # node-pty adapter (unchanged)
    BunPTY.ts               # Bun PTY adapter (unchanged)
    TmuxSessionManager.ts   # Tmux implementation (unchanged)
  __tests__/
    TmuxSessionManager.test.ts
    HistoryManager.test.ts       # NEW unit tests
    ShellResolver.test.ts        # NEW unit tests
    ProcessLifecycle.test.ts     # NEW unit tests
    Manager.test.ts              # Existing integration tests (keep)
    NodePTY.test.ts              # Existing (keep, move here)
```

## Integration Points

- **Upstream**: `ws.ts` RPC handlers (open/write/resize/clear/restart/close, tmux ops), `ProjectSetupScriptRunner` (open + write)
- **Downstream**: `PtyAdapter` (NodePTY or BunPTY), `ServerConfig`, `FileSystem`, `processRunner`, Metrics
- **Events**: Terminal events pushed to RPC subscribers via `ws.ts`, consumed by web client `terminalStateStore`
- **Shared consumer**: `MetasploitService` uses `PtyAdapter` directly (not TerminalManager)

## Working On This Module

### For implementers (working INSIDE this module):

- Layer implementations in `Layers/` — change freely without breaking consumers
- `Services/Manager.ts`, `Services/PTY.ts`, `Services/TmuxSessionManager.ts` are PUBLIC contracts — changes are BREAKING
- `Services/HistoryManager.ts`, `Services/ShellResolver.ts`, `Services/ProcessLifecycle.ts` are INTERNAL — change freely
- Tests: integration tests in `Manager.test.ts` cover public API; unit tests per sub-service cover internals
- ANSI sanitization lives in `@fenrir/shared/ansiSanitizer` — pure functions, test independently

### For consumers (working in OTHER modules):

- Import ONLY from `Services/Manager.ts`, `Services/PTY.ts`, `Services/TmuxSessionManager.ts`
- Never import from `Layers/` or internal services
- Handle all declared error types in `TerminalError` union
- Subscribe to events via `TerminalManager.subscribe()`, not by importing internals
