---
depends_on:
  - neovim-01-contracts
  - neovim-02-server-msgpack-rpc
---

# Plan: Server NeovimManager Service

## Summary

Implement the NeovimManager Effect service that manages neovim process lifecycle per project: spawn, UI attach/detach, input forwarding, and event publishing.

## Motivation

Central orchestration service for neovim processes. One `nvim --embed` process per project, persistent across client reconnects. Mirrors `TmuxSessionManager` pattern but with msgpack-RPC instead of PTY output.

## Prerequisites

- `neovim-01-contracts` (schemas and error types)
- `neovim-02-server-msgpack-rpc` (MsgpackRpcFactory)

## Scope

- New file: `apps/server/src/neovim/Services/NeovimManager.ts`
- New file: `apps/server/src/neovim/Layers/NeovimManager.ts`
- New file: `apps/server/src/neovim/__tests__/NeovimManager.test.ts`
- Modify: `apps/server/src/server.ts` (add NeovimManagerLive to layer composition)

## Proposed Changes

### 1. Service Interface — `Services/NeovimManager.ts`

```typescript
import { Effect, ServiceMap } from "effect";
import {
  NeovimAttachError,
  NeovimCwdError,
  NeovimNotInstalledError,
  NeovimRpcError,
  NeovimSessionLookupError,
  NeovimSessionSnapshot,
  NeovimSpawnError,
  NeovimEvent,
} from "@fenrir/contracts";

export interface NeovimManagerShape {
  /**
   * Spawn nvim --embed for a project. No-op if already running.
   * Validates cwd exists, resolves nvim binary, spawns child process.
   */
  readonly spawn: (
    projectId: string,
    cwd: string,
  ) => Effect.Effect<
    NeovimSessionSnapshot,
    NeovimNotInstalledError | NeovimSpawnError | NeovimCwdError
  >;

  /**
   * Send nvim_ui_attach to running neovim process.
   * Options: { rgb: true, ext_linegrid: true, ext_multigrid: true }
   */
  readonly attachUi: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, NeovimAttachError | NeovimSessionLookupError>;

  /**
   * Send nvim_ui_detach. Keeps nvim process alive for reattach.
   */
  readonly detachUi: (
    projectId: string,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /**
   * Send nvim_ui_try_resize.
   */
  readonly resize: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /**
   * Send nvim_input (non-blocking notification).
   */
  readonly input: (
    projectId: string,
    keys: string,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /**
   * Send nvim_input_mouse.
   */
  readonly inputMouse: (
    projectId: string,
    button: string,
    action: string,
    modifier: string,
    grid: number,
    row: number,
    col: number,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /**
   * Execute nvim_command (e.g., "checktime" for file reload).
   */
  readonly command: (
    projectId: string,
    command: string,
  ) => Effect.Effect<void, NeovimSessionLookupError | NeovimRpcError>;

  /**
   * Kill nvim process for project. Clean up session.
   */
  readonly kill: (projectId: string) => Effect.Effect<void>;

  /**
   * Check if nvim process exists and is running.
   */
  readonly hasSession: (projectId: string) => Effect.Effect<boolean>;

  /**
   * Subscribe to lifecycle events (started/crashed/exited).
   * Returns unsubscribe function.
   */
  readonly subscribe: (
    listener: (event: NeovimEvent) => void,
  ) => Effect.Effect<() => void>;

  /**
   * Register handler for raw msgpack binary data from neovim stdout.
   * Used by WebSocket handler to pipe binary directly to client.
   * Handler receives projectId + raw bytes.
   * Returns unsubscribe function.
   */
  readonly onRawRedraw: (
    handler: (projectId: string, data: Uint8Array) => void,
  ) => Effect.Effect<() => void>;
}

export class NeovimManager extends ServiceMap.Service<
  NeovimManager,
  NeovimManagerShape
>()("t3/neovim/Services/NeovimManager") {}
```

### 2. Layer Implementation — `Layers/NeovimManager.ts`

**Internal session state**:

```typescript
interface NeovimSession {
  projectId: string;
  cwd: string;
  pid: number;
  process: ChildProcess;
  rpc: MsgpackRpcSessionShape;
  uiAttached: boolean;
  status: NeovimSessionStatus; // "spawning" | "running" | "exited" | "crashed"
  apiLevel: number | null;
  unsubscribeRawData: (() => void) | null;
  unsubscribeNotifications: (() => void) | null;
}

// Session map: projectId → NeovimSession
const sessions = new Map<string, NeovimSession>();
```

**Nvim binary resolution**:

```typescript
import { execFileSync } from "node:child_process";

function resolveNvimBinary(): string | null {
  // 1. Check $NVIM environment variable
  // 2. Try "which nvim" (POSIX) / "where nvim" (Windows)
  // 3. Check common paths: /usr/local/bin/nvim, /opt/homebrew/bin/nvim, /usr/bin/nvim
  // Return first valid path or null
  try {
    return execFileSync("which", ["nvim"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
```

**Spawn flow** (`spawn` method):

1. If session exists and running → return existing snapshot
2. If session exists but exited → clean up old, proceed
3. Validate cwd: `stat(cwd)` → exists and is directory
4. Resolve nvim binary → `NeovimNotInstalledError` if not found
5. Spawn child process:

   ```typescript
   import { spawn } from "node:child_process";

   const nvimProcess = spawn(nvimPath, ["--embed"], {
     cwd,
     stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr all piped
     env: { ...process.env },
   });
   ```

6. Create `MsgpackRpcSession` from `nvimProcess.stdin` + `nvimProcess.stdout`
7. Wire up raw data handler: `rpc.onRawData(data => publishRawRedraw(projectId, data))`
8. Wire up process exit handler:

   ```typescript
   nvimProcess.on("exit", (code, signal) => {
     session.status = code === 0 ? "exited" : "crashed";
     publishEvent(
       code === 0
         ? { type: "neovim:exited", projectId, exitCode: code }
         : { type: "neovim:crashed", projectId, exitCode: code, signal },
     );
   });
   ```

9. Wire up stderr: `nvimProcess.stderr.on("data", chunk => console.warn("[nvim stderr]", chunk.toString()))`
10. Query API info: `rpc.request("nvim_get_api_info", [])` → extract channel_id and api_level
11. Store session in map
12. Publish `{ type: "neovim:started", projectId, pid }`
13. Return snapshot

**AttachUi flow**:

1. Look up session → `NeovimSessionLookupError` if not found
2. If `session.uiAttached` → `NeovimAttachError` ("UI already attached")
3. Call `rpc.request("nvim_ui_attach", [cols, rows, { rgb: true, ext_linegrid: true, ext_multigrid: true }])`
4. Set `session.uiAttached = true`

**DetachUi flow**:

1. Look up session
2. If not `uiAttached` → no-op
3. Call `rpc.request("nvim_ui_detach", [])`
4. Set `session.uiAttached = false`

**Input flow** (non-blocking):

1. Look up session
2. Call `rpc.notify("nvim_input", [keys])` — notification, not request

**InputMouse flow**:

1. Look up session
2. Call `rpc.notify("nvim_input_mouse", [button, action, modifier, grid, row, col])`

**Command flow**:

1. Look up session
2. Call `rpc.request("nvim_command", [command])` — request (await response for error handling)

**Kill flow**:

1. Look up session → if not found, no-op
2. If `uiAttached` → detachUi first
3. Close rpc session: `rpc.close()`
4. Send SIGTERM to process
5. Wait 2s grace period
6. If still alive → SIGKILL
7. Remove from sessions map

**Resize flow**:

1. Look up session
2. Call `rpc.notify("nvim_ui_try_resize", [cols, rows])` — notification

**Event fanout** (same pattern as TerminalManager):

```typescript
const lifecycleListeners = new Set<(event: NeovimEvent) => void>();
const rawRedrawListeners = new Set<
  (projectId: string, data: Uint8Array) => void
>();

const publishEvent = (event: NeovimEvent) => {
  for (const listener of lifecycleListeners) {
    listener(event);
  }
};

const publishRawRedraw = (projectId: string, data: Uint8Array) => {
  for (const listener of rawRedrawListeners) {
    listener(projectId, data);
  }
};
```

### 3. Layer Composition — modify `server.ts`

```typescript
// In server.ts, after TerminalLayerLive:
import { NeovimManagerLive } from "./neovim/Layers/NeovimManager";
import { MsgpackRpcFactoryLive } from "./neovim/Layers/MsgpackRpc";

const NeovimLayerLive = NeovimManagerLive.pipe(
  Layer.provide(MsgpackRpcFactoryLive),
);

// Add to main layer composition:
const ApplicationLayerLive = Layer.mergeAll(
  // ... existing layers ...
  TerminalLayerLive,
  NeovimLayerLive, // ← ADD
);
```

### 4. Tests — `__tests__/NeovimManager.test.ts`

**Note**: Tests require nvim installed. Skip gracefully if not available.

```typescript
const nvimAvailable = (() => {
  try {
    execFileSync("which", ["nvim"]);
    return true;
  } catch {
    return false;
  }
})();

const describeWithNvim = nvimAvailable ? describe : describe.skip;
```

Test cases:

1. **spawn**: Creates session, returns snapshot with pid and status "running"
2. **spawn idempotent**: Second spawn for same project returns same session
3. **spawn bad cwd**: Returns NeovimCwdError
4. **attachUi**: After spawn, UI attaches without error
5. **attachUi without spawn**: Returns NeovimSessionLookupError
6. **attachUi twice**: Returns NeovimAttachError
7. **input**: Sends keys, no error (verify via nvim_get_current_line if needed)
8. **command**: `checktime` succeeds without error
9. **resize**: Changes grid dimensions without error
10. **kill**: Process exits, session removed, subsequent operations fail with lookup error
11. **crash handling**: Kill nvim with SIGKILL, verify "crashed" event published
12. **detachUi + reattachUi**: Detach keeps process alive, can reattach

## Risks

- Neovim version differences: `nvim_ui_attach` options changed across versions. Mitigation: query api_level and adapt.
- Child process zombies if server crashes. Mitigation: register process.on("exit") handler to kill all sessions.

## Validation

- `bun test apps/server/src/neovim/`
- `bun typecheck`
- Manual: spawn nvim, attach UI, send "ihello<Esc>", verify buffer content via `nvim_get_current_line`

## Done Criteria

- NeovimManager service spawns/manages nvim processes per project
- UI attach/detach works, process persists across detach
- Raw binary passthrough works (onRawRedraw receives stdout bytes)
- Lifecycle events published (started/crashed/exited)
- Kill performs graceful shutdown with SIGTERM → SIGKILL escalation
- All tests pass
