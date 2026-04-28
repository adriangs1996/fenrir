---
depends_on:
  - neovim-03a-manager-service
  - neovim-02b-msgpack-rpc-layer
---

# Plan 03b: NeovimManager Spawn + Lifecycle

## Goal

Begin Layer implementation of `NeovimManager`: session state map, binary resolution, `spawn`, `kill`, `hasSession`, lifecycle event fanout. Input/UI methods come in 03c.

## Scope

- New file: `apps/server/src/neovim/Layers/NeovimManager.ts` (partial — spawn/kill/state only)

## Steps

### Step 1. Imports + state types

Create `apps/server/src/neovim/Layers/NeovimManager.ts`:

```typescript
import { Effect, Layer } from "effect";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import {
  NeovimCwdError,
  NeovimNotInstalledError,
  NeovimSpawnError,
  NeovimSessionLookupError,
  type NeovimEvent,
  type NeovimSessionSnapshot,
  type NeovimSessionStatus,
} from "@fenrir/contracts";
import {
  MsgpackRpcFactory,
  type MsgpackRpcSessionShape,
} from "../Services/MsgpackRpc";
import { NeovimManager, type NeovimManagerShape } from "../Services/NeovimManager";

interface NeovimSession {
  projectId: string;
  cwd: string;
  pid: number;
  process: ChildProcess;
  rpc: MsgpackRpcSessionShape;
  uiAttached: boolean;
  status: NeovimSessionStatus;
  apiLevel: number | null;
  unsubscribeRawData: (() => void) | null;
  unsubscribeNotifications: (() => void) | null;
}
```

### Step 2. Binary resolution

```typescript
function resolveNvimBinary(): string | null {
  if (process.env.NVIM) return process.env.NVIM;
  try {
    return execFileSync("which", ["nvim"], { encoding: "utf8" }).trim() || null;
  } catch {
    // fall through to common paths
  }
  for (const p of ["/opt/homebrew/bin/nvim", "/usr/local/bin/nvim", "/usr/bin/nvim"]) {
    try {
      execFileSync(p, ["--version"], { stdio: "ignore" });
      return p;
    } catch {
      // continue
    }
  }
  return null;
}
```

### Step 3. Layer scaffold + state

```typescript
export const NeovimManagerLive = Layer.scoped(
  NeovimManager,
  Effect.gen(function* () {
    const factory = yield* MsgpackRpcFactory;

    const sessions = new Map<string, NeovimSession>();
    const lifecycleListeners = new Set<(event: NeovimEvent) => void>();
    const rawRedrawListeners = new Set<
      (projectId: string, data: Uint8Array) => void
    >();

    const publishEvent = (event: NeovimEvent) => {
      for (const l of lifecycleListeners) l(event);
    };
    // Internal fanout helper. NOT part of the public NeovimManagerShape.
    // Public registration method is `onRawRedraw` (returned below; declared
    // on NeovimManagerShape in 03a). Consumers like 04c call
    // `neovimManager.onRawRedraw(handler)` — they never see `publishRaw`.
    const publishRaw = (projectId: string, data: Uint8Array) => {
      for (const l of rawRedrawListeners) l(projectId, data);
    };

    // ── spawn ──
    const spawnSession = (projectId: string, cwd: string) =>
      Effect.gen(function* () {
        // Idempotent: existing running session → return snapshot
        const existing = sessions.get(projectId);
        if (existing && existing.status === "running") {
          return {
            projectId,
            pid: existing.pid,
            status: existing.status,
            apiLevel: existing.apiLevel ?? undefined,
          } satisfies NeovimSessionSnapshot;
        }
        if (existing) sessions.delete(projectId);

        // Validate cwd
        const cwdStat = yield* Effect.tryPromise({
          try: () => stat(cwd),
          catch: (cause) =>
            new NeovimCwdError({ cwd, reason: "statFailed", cause }),
        });
        if (!cwdStat.isDirectory()) {
          return yield* Effect.fail(
            new NeovimCwdError({ cwd, reason: "notDirectory" }),
          );
        }

        // Resolve binary
        const nvimPath = resolveNvimBinary();
        if (!nvimPath) {
          return yield* Effect.fail(new NeovimNotInstalledError({}));
        }

        // Spawn
        const child = yield* Effect.try({
          try: () =>
            spawn(nvimPath, ["--embed"], {
              cwd,
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env },
            }),
          catch: (cause) =>
            new NeovimSpawnError({
              projectId,
              reason: "spawn syscall failed",
              cause,
            }),
        });

        if (!child.pid || !child.stdin || !child.stdout || !child.stderr) {
          child.kill("SIGKILL");
          return yield* Effect.fail(
            new NeovimSpawnError({
              projectId,
              reason: "child process missing pid or stdio",
            }),
          );
        }

        const rpc = yield* factory.create(child.stdin, child.stdout);

        const session: NeovimSession = {
          projectId,
          cwd,
          pid: child.pid,
          process: child,
          rpc,
          uiAttached: false,
          status: "running",
          apiLevel: null,
          unsubscribeRawData: rpc.onRawData((data) => publishRaw(projectId, data)),
          unsubscribeNotifications: null,
        };
        sessions.set(projectId, session);

        // stderr passthrough
        child.stderr.on("data", (chunk: Buffer) => {
          console.warn(`[nvim ${projectId}]`, chunk.toString());
        });

        // exit handler
        child.on("exit", (code, signal) => {
          const final: NeovimSessionStatus = code === 0 ? "exited" : "crashed";
          session.status = final;
          publishEvent(
            final === "exited"
              ? {
                  type: "neovim:exited",
                  projectId,
                  exitCode: code ?? 0,
                  createdAt: new Date().toISOString(),
                }
              : {
                  type: "neovim:crashed",
                  projectId,
                  exitCode: code,
                  signal,
                  createdAt: new Date().toISOString(),
                },
          );
          session.unsubscribeRawData?.();
          session.unsubscribeNotifications?.();
          sessions.delete(projectId);
        });

        // Query api_level (best-effort)
        const apiInfo = yield* Effect.tryPromise({
          try: () => Effect.runPromise(rpc.request("nvim_get_api_info", []) as any),
          catch: () => null as any,
        }).pipe(Effect.orElse(() => Effect.succeed(null)));
        if (Array.isArray(apiInfo) && apiInfo.length === 2) {
          const meta = apiInfo[1] as { version?: { api_level?: number } };
          session.apiLevel = meta?.version?.api_level ?? null;
        }

        publishEvent({
          type: "neovim:started",
          projectId,
          pid: child.pid,
          createdAt: new Date().toISOString(),
        });

        return {
          projectId,
          pid: session.pid,
          status: session.status,
          apiLevel: session.apiLevel ?? undefined,
        } satisfies NeovimSessionSnapshot;
      });

    // ── kill ──
    const killSession = (projectId: string) =>
      Effect.gen(function* () {
        const session = sessions.get(projectId);
        if (!session) return;
        if (session.uiAttached) {
          yield* Effect.ignoreLogged(
            session.rpc.request("nvim_ui_detach", []) as any,
          );
          session.uiAttached = false;
        }
        yield* session.rpc.close();
        try {
          session.process.kill("SIGTERM");
        } catch {
          // ignore
        }
        // 2s grace then SIGKILL if still alive
        yield* Effect.sleep("2 seconds");
        if (!session.process.killed) {
          try {
            session.process.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        sessions.delete(projectId);
      });

    const hasSession = (projectId: string): Effect.Effect<boolean> =>
      Effect.sync(() => sessions.get(projectId)?.status === "running");

    const subscribe = (listener: (event: NeovimEvent) => void) =>
      Effect.sync(() => {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      });

    const onRawRedraw = (
      handler: (projectId: string, data: Uint8Array) => void,
    ) =>
      Effect.sync(() => {
        rawRedrawListeners.add(handler);
        return () => rawRedrawListeners.delete(handler);
      });

    // PARTIAL service — complete in 03c. Export refs for 03c via module-scoped vars
    // OR (preferred) co-locate 03c additions in this same file.
    return {
      // 03c will add: attachUi, detachUi, resize, input, inputMouse, command
      spawn: spawnSession,
      kill: killSession,
      hasSession,
      subscribe,
      onRawRedraw,
    } as unknown as NeovimManagerShape;
  }),
);
```

### Step 4. Note for 03c

The returned object is intentionally incomplete here. 03c appends `attachUi/detachUi/resize/input/inputMouse/command` inside the same `Effect.gen` block. Sub-plan 03c will edit this same file — keep all closures (sessions map, publishEvent, etc.) accessible.

## Validation

- `bun typecheck` — partial impl will fail final type assertion until 03c lands; the `as unknown as NeovimManagerShape` cast is a deliberate placeholder. Note this in PR description.

## Done Criteria

- File created with `sessions` map, listener sets, `publishEvent`, `publishRaw`
- `spawn` validates cwd, resolves binary, forks child, wires stderr/exit/raw passthrough, queries api_level, publishes started event
- `kill` detaches UI, SIGTERM → SIGKILL escalation
- `hasSession`, `subscribe`, `onRawRedraw` implemented
- TODO marker noting 03c finishes the service
