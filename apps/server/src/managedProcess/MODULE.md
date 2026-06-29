# ManagedProcess Module

Long-running processes that run alongside Fenrir (dev servers, watchers, etc.). Unlike terminals, managed processes are tied to project definitions, survive server restarts (tmux mode), auto-restart on crash, and expose readiness probes.

## Two-Executor Model

At server startup, the manager checks if tmux is available:

| Mode     | Selection                  | Process lifetime         | Reconciliation                |
| -------- | -------------------------- | ------------------------ | ----------------------------- |
| `direct` | tmux unavailable (default) | Dies with Fenrir         | Stale records cleared         |
| `tmux`   | tmux available             | Survives Fenrir restarts | Re-attaches surviving windows |

The executor is selected once at boot and applies to all instances. Mixed modes are not supported.

## State Machine

```
    ┌──────────┐
    │  (none)  │
    └────┬─────┘
         │ start()
         ▼
    ┌──────────┐
    │ starting │──── spawn failure ───► crashed
    └────┬─────┘
         │ spawn ok
         ▼
    ┌──────────┐           ┌───────────┐
    │ running  │── stop()──► stopping  │
    └────┬─────┘           └─────┬─────┘
         │                       │
         │ exit(non-zero)        │ exit callback
         ▼                       ▼
    ┌──────────┐           ┌───────────┐
    │ crashed  │           │  stopped  │
    └────┬─────┘           └───────────┘
         │
         │ autoRestart (if policy set & attempts remaining)
         ▼
    ┌──────────┐
    │ starting │  ... (cycle)
    └──────────┘
```

- `idle` exists in the contract schema but is never set in-memory — instances are created in `starting`.
- `forceKill()` sends SIGKILL regardless of state (escape hatch). Status stays `stopping` until exit.
- `restart()` = stop + re-read definition + start. Uses current project definition, not the snapshot.

## Persisted State

Each project stores `{stateDir}/managed-process/{projectId}/instances.json`:

```ts
interface PersistedInstanceRecord {
  instanceId: string;
  processDefId: string;
  projectId: ProjectId;
  worktreePath: string | null;
  startedAt: string; // ISO
  definitionSnapshot: ManagedProcess;
  executor: "tmux" | "direct";
  tmuxWindow: string | null; // tmux nativeKey for re-attach
  pid: number | null;
}
```

Records are updated on start, state transitions, and exit. Direct-mode records are cleared on boot (processes are dead). Tmux-mode records are reconciled (re-attach or drop).

## File Layout

```
apps/server/src/managedProcess/
  Services/
    Executor.ts         # Plan 02: spawn/kill abstraction
    InstanceStore.ts    # Plan 02: JSON persistence
    LogBuffer.ts        # Plan 02: ring buffer + disk log
    Manager.ts          # Plan 05: service interface + lifecycle events
  Layers/
    DirectPtyExecutor.ts    # Plan 03: node-pty executor
    TmuxExecutor.ts         # Plan 04: tmux window executor
    InstanceStore.ts        # Plan 02: per-project JSON files
    LogBuffer.ts            # Plan 02: deque + disk append
    Manager.ts              # Plan 05: orchestrating layer
    Manager.test.ts         # Plan 05: unit tests with mock deps
  MODULE.md                 # This file
```

Future plans:

- Plan 06: `PortlessWrapper` (portless proxy wrapping) + `ReadinessProbeRunner`
- Plan 07: WS RPC handlers wiring manager methods to the WebSocket server

## Why Not Extend TerminalManager

| Concern        | TerminalManager                  | ManagedProcessManager                    |
| -------------- | -------------------------------- | ---------------------------------------- |
| Scope          | Per-thread terminal sessions     | Per-project/worktree process definitions |
| Lifecycle      | User opens/closes manually       | Declarative: auto-start, auto-restart    |
| Identity       | `(threadId, terminalId)` tuple   | `(processDefId, worktreePath)` key       |
| Persistence    | History in ring buffer           | Instance records for tmux reconciliation |
| Readiness      | N/A                              | Probes (portless-http, log-pattern)      |
| Output fan-out | Terminal events to single thread | Lifecycle events to orchestration domain |

The two managers share the PTY adapter and shell resolver but have fundamentally different lifecycles and state models. Merging them would create a god-object without meaningful code reuse.

## API Surface

Other modules consume `ManagedProcessManagerShape` exclusively — they never reach into runtime state. The `events` stream is the only mechanism for lifecycle fan-out to the orchestration domain channel.

## Client Neutrality

Managed process lifecycle, stdin, and log APIs are client-neutral WebSocket
contracts. Web, Electron, and future native terminal clients should all use the
same `managedProcess.*` RPC methods rather than Electron IPC or terminal-tab
identity.

- `start`, `stop`, `forceKill`, `restart`, and `list` operate on declarative
  process instances, not terminal UI sessions.
- `writeStdin` forwards the RPC string payload to the selected executor
  unchanged. Clients are responsible for chunking writes to the contract string
  length limit (`MANAGED_PROCESS_STDIN_MAX_CHARS` in `@fenrir/contracts`); this
  is not a byte-stream backpressure boundary.
- `subscribeLog` is the log data plane for managed processes. The stream sends
  exactly one `backfill` message followed by live `chunk` messages.
- `sequenceNumber` is monotonic per instance and should be used by clients for
  ordering or deduplication. UI render timing is not part of the contract.
- The backfill source is a bounded in-memory ring buffer (2 MiB and 10,000
  lines). Slow or disconnected clients should resubscribe and honor
  `truncated: true`; the server does not provide unbounded replay or per-client
  flow control.
