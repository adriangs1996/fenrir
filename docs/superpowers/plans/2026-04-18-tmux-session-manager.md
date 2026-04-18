# Tmux Session Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make T3 Code orchestrate tmux sessions per project — one auto-created session per project, xterm.js attaches to it, project switching detaches/reattaches instantly.

**Architecture:** New `TmuxSessionManager` Effect service layer spawns/manages tmux sessions via node-pty. Existing terminal infrastructure stays untouched for agent PTYs. New RPC methods (`terminal.attachTmux` / `terminal.detachTmux`) handle the WebSocket protocol. Client-side: `ThreadTerminalDrawer` gains a tmux-aware mode. Keybindings: `Alt+1-9` for project jumping, `Ctrl+Shift` combos for app controls.

**Tech Stack:** Effect.js (ServiceMap, Layer, Schema), node-pty, xterm.js + FitAddon, Zustand, TanStack Router, dnd-kit (existing)

**Spec:** `docs/superpowers/specs/2026-04-18-tmux-session-manager-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/server/src/terminal/Services/TmuxSessionManager.ts` | Service interface — Effect Tag, input/error schemas |
| `apps/server/src/terminal/Layers/TmuxSessionManager.ts` | Implementation — spawns tmux commands via PtyAdapter |
| `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts` | Unit tests for tmux session lifecycle |

### Modified Files
| File | Change |
|------|--------|
| `packages/contracts/src/terminal.ts` | Add `TmuxAttachInput`, `TmuxDetachInput` schemas |
| `packages/contracts/src/rpc.ts` | Add `WS_METHODS.terminalAttachTmux` / `terminalDetachTmux`, RPC definitions, register in `WsRpcGroup` |
| `packages/contracts/src/keybindings.ts` | Add `PROJECT_JUMP_KEYBINDING_COMMANDS` array, add to `KeybindingCommand` union |
| `apps/server/src/keybindings.ts` | Add default `alt+1` through `alt+9` bindings for `project.jump.N` |
| `apps/server/src/terminal/Layers/Manager.ts` | Add `publishTmuxOutput` / `publishTmuxExit` methods using existing `publishEvent` pipeline |
| `apps/server/src/terminal/Services/Manager.ts` | Extend `TerminalManagerShape` with `publishTmuxOutput` / `publishTmuxExit` |
| `apps/server/src/server.ts` | Import and compose `TmuxSessionManagerLive` into layer graph |
| `apps/server/src/ws.ts` | Register new RPC handlers for tmux attach/detach |
| `apps/web/src/rpc/wsRpcClient.ts` | Add `tmux.attach` / `tmux.detach` to client interface |
| `apps/web/src/environmentApi.ts` | Expose tmux methods on `EnvironmentApi` |
| `apps/web/src/components/ThreadTerminalDrawer.tsx` | Tmux-aware terminal mode — attach on mount, detach on project switch |
| `apps/web/src/terminalStateStore.ts` | Track active tmux session per project |
| `apps/web/src/keybindings.ts` | Add `projectJumpCommandForIndex` / `projectJumpIndexFromCommand` helpers |
| `apps/web/src/routes/_chat.tsx` | Handle `project.jump.N` commands in global keydown |
| `apps/web/src/components/Sidebar.tsx` | Show project jump labels (Alt+N), wire project switching to tmux |

---

## Task 1: Tmux Contract Schemas

**Files:**
- Modify: `packages/contracts/src/terminal.ts`

- [ ] **Step 1: Add TmuxAttachInput and TmuxDetachInput schemas**

Open `packages/contracts/src/terminal.ts`. Add these schemas near the other terminal input schemas (after `TerminalCloseInput`):

Reuse the existing `TerminalColsSchema` and `TerminalRowsSchema` constants already defined at the top of this file (they use `Schema.isGreaterThanOrEqualTo` / `Schema.isLessThanOrEqualTo`):

```typescript
export const TmuxAttachInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
});
export type TmuxAttachInput = typeof TmuxAttachInput.Type;

export const TmuxDetachInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
});
export type TmuxDetachInput = typeof TmuxDetachInput.Type;
```

- [ ] **Step 2: Add TmuxError schema**

In the same file, add near the other error classes:

```typescript
export class TmuxError extends Schema.TaggedErrorClass<TmuxError>()(
  "TmuxError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
```

- [ ] **Step 3: Add TmuxSessionSnapshot schema**

```typescript
export const TmuxSessionSnapshot = Schema.Struct({
  projectId: Schema.NonEmptyString,
  sessionName: Schema.NonEmptyString,
  pid: Schema.NullOr(Schema.Number),
});
export type TmuxSessionSnapshot = typeof TmuxSessionSnapshot.Type;
```

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No new errors in `packages/contracts`

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/terminal.ts
git commit -m "feat(contracts): add tmux attach/detach schemas and TmuxError"
```

---

## Task 2: RPC Method Definitions

**Files:**
- Modify: `packages/contracts/src/rpc.ts`

- [ ] **Step 1: Add WS_METHODS entries**

In `packages/contracts/src/rpc.ts`, add to the `WS_METHODS` object inside the `// Terminal methods` section:

```typescript
  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",
  terminalAttachTmux: "terminal.attachTmux",    // ← NEW
  terminalDetachTmux: "terminal.detachTmux",    // ← NEW
```

- [ ] **Step 2: Add imports for new schemas**

Add `TmuxAttachInput`, `TmuxDetachInput`, `TmuxError`, `TmuxSessionSnapshot` to the imports from `"./terminal"`.

- [ ] **Step 3: Add Rpc.make definitions**

After the existing `WsTerminalCloseRpc`, add:

```typescript
export const WsTerminalAttachTmuxRpc = Rpc.make(WS_METHODS.terminalAttachTmux, {
  payload: TmuxAttachInput,
  success: TmuxSessionSnapshot,
  error: TmuxError,
});

export const WsTerminalDetachTmuxRpc = Rpc.make(WS_METHODS.terminalDetachTmux, {
  payload: TmuxDetachInput,
  error: TmuxError,
});
```

- [ ] **Step 4: Register in WsRpcGroup**

Add `WsTerminalAttachTmuxRpc` and `WsTerminalDetachTmuxRpc` to the `RpcGroup.make(...)` call — after `WsTerminalCloseRpc`:

```typescript
export const WsRpcGroup = RpcGroup.make(
  // ... existing entries ...
  WsTerminalCloseRpc,
  WsTerminalAttachTmuxRpc,     // ← NEW
  WsTerminalDetachTmuxRpc,     // ← NEW
  // ... rest ...
);
```

- [ ] **Step 5: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Type errors in `ws.ts` and `wsRpcClient.ts` because they don't implement the new RPC methods yet. That's expected — we'll fix them in later tasks.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/rpc.ts
git commit -m "feat(contracts): add terminal.attachTmux and terminal.detachTmux RPC definitions"
```

---

## Task 3: TmuxSessionManager Service Interface

**Files:**
- Create: `apps/server/src/terminal/Services/TmuxSessionManager.ts`

- [ ] **Step 1: Create the service interface**

Follow the exact `ServiceMap.Service` pattern from `apps/server/src/terminal/Services/PTY.ts`:

```typescript
import { Effect, ServiceMap } from "effect";
import type { TmuxSessionSnapshot } from "@t3tools/contracts";
import type { PtyProcess } from "./PTY";

export class TmuxNotFoundError extends Error {
  readonly _tag = "TmuxNotFoundError";
  constructor() {
    super("tmux binary not found on $PATH. Install tmux or ensure it is in your PATH.");
  }
}

export class TmuxSessionError extends Error {
  readonly _tag = "TmuxSessionError";
  constructor(
    readonly sessionName: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface TmuxSessionManagerShape {
  readonly createSession: (
    projectId: string,
    cwd: string,
  ) => Effect.Effect<void, TmuxSessionError>;

  readonly attachSession: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<PtyProcess, TmuxSessionError | TmuxNotFoundError>;

  readonly detachSession: (
    projectId: string,
  ) => Effect.Effect<void, TmuxSessionError>;

  readonly killSession: (
    projectId: string,
  ) => Effect.Effect<void, TmuxSessionError>;

  readonly hasSession: (
    projectId: string,
  ) => Effect.Effect<boolean>;

  readonly sessionName: (projectId: string) => string;
}

export class TmuxSessionManager extends ServiceMap.Service<
  TmuxSessionManager,
  TmuxSessionManagerShape
>()("t3/terminal/Services/TmuxSessionManager") {}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors — this is a standalone file.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/terminal/Services/TmuxSessionManager.ts
git commit -m "feat(server): add TmuxSessionManager service interface"
```

---

## Task 4: TmuxSessionManager Implementation Layer

**Files:**
- Create: `apps/server/src/terminal/Layers/TmuxSessionManager.ts`
- Create: `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`:

```typescript
import { describe, it, assert } from "vitest";
import { Effect, Layer } from "effect";
import { TmuxSessionManager } from "../Services/TmuxSessionManager";
import { TmuxSessionManagerLive } from "../Layers/TmuxSessionManager";
import { PtyAdapter } from "../Services/PTY";

// Minimal mock PtyAdapter for testing
const MockPtyAdapterLayer = Layer.succeed(PtyAdapter, {
  spawn: () =>
    Effect.succeed({
      pid: 12345,
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => () => {},
      onExit: () => () => {},
    }),
});

const TestLayer = TmuxSessionManagerLive.pipe(Layer.provide(MockPtyAdapterLayer));

describe("TmuxSessionManager", () => {
  it("sessionName returns prefixed name", async () => {
    await Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;
      const name = manager.sessionName("abc-123");
      assert.strictEqual(name, "t3-abc-123");
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);
  });

  it("sessionName sanitizes special characters", async () => {
    await Effect.gen(function* () {
      const manager = yield* TmuxSessionManager;
      // tmux session names cannot contain dots or colons
      const name = manager.sessionName("my.project:v2");
      assert.isFalse(name.includes("."));
      assert.isFalse(name.includes(":"));
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
Expected: FAIL — `TmuxSessionManagerLive` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/terminal/Layers/TmuxSessionManager.ts`:

```typescript
import { Effect, Layer } from "effect";
import {
  TmuxSessionManager,
  TmuxSessionManagerShape,
  TmuxSessionError,
  TmuxNotFoundError,
} from "../Services/TmuxSessionManager";
import { PtyAdapter, type PtyProcess } from "../Services/PTY";

const SESSION_PREFIX = "t3-";

function sanitizeSessionName(projectId: string): string {
  // tmux session names cannot contain dots or colons
  return `${SESSION_PREFIX}${projectId.replace(/[.:]/g, "-")}`;
}

function tmuxCommand(args: string[]): { shell: string; args: string[] } {
  return { shell: "tmux", args };
}

export const TmuxSessionManagerLive = Layer.effect(
  TmuxSessionManager,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;

    // Track active attached PTY processes per project
    const attachedProcesses = new Map<string, PtyProcess>();

    const execTmux = (
      args: string[],
      sessionName: string,
    ): Effect.Effect<PtyProcess, TmuxSessionError | TmuxNotFoundError> =>
      ptyAdapter
        .spawn({
          shell: "tmux",
          args,
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: process.env as NodeJS.ProcessEnv,
        })
        .pipe(
          Effect.mapError((err) => {
            if (
              err.message.includes("ENOENT") ||
              err.message.includes("not found")
            ) {
              return new TmuxNotFoundError();
            }
            return new TmuxSessionError(sessionName, err.message, err.cause);
          }),
        );

    return {
      sessionName: (projectId: string) => sanitizeSessionName(projectId),

      createSession: (projectId, cwd) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = yield* execTmux(
            ["new-session", "-d", "-s", name, "-c", cwd],
            name,
          );
          // new-session with -d returns immediately — wait for exit
          yield* Effect.async<void, TmuxSessionError>((resume) => {
            proc.onExit((event) => {
              if (event.exitCode === 0) {
                resume(Effect.void);
              } else {
                resume(
                  Effect.fail(
                    new TmuxSessionError(
                      name,
                      `tmux new-session exited with code ${event.exitCode}`,
                    ),
                  ),
                );
              }
            });
          });
        }),

      attachSession: (projectId, cols, rows) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);

          // Check if session exists, create if not
          const exists = yield* Effect.gen(function* () {
            const proc = yield* execTmux(["has-session", "-t", name], name);
            return yield* Effect.async<boolean>((resume) => {
              proc.onExit((event) => {
                resume(Effect.succeed(event.exitCode === 0));
              });
            });
          }).pipe(Effect.orElseSucceed(() => false));

          if (!exists) {
            return yield* Effect.fail(
              new TmuxSessionError(name, `Session ${name} does not exist`),
            );
          }

          // Spawn tmux attach — this keeps running as a PTY
          const attachProc = yield* ptyAdapter
            .spawn({
              shell: "tmux",
              args: ["attach-session", "-t", name],
              cwd: "/tmp",
              cols,
              rows,
              env: process.env as NodeJS.ProcessEnv,
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new TmuxSessionError(name, `Failed to attach: ${err.message}`, err.cause),
              ),
            );

          attachedProcesses.set(projectId, attachProc);
          return attachProc;
        }),

      detachSession: (projectId) =>
        Effect.sync(() => {
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            // Send detach key sequence to tmux (Ctrl-b d by default,
            // but safer to kill the attach process)
            proc.kill();
            attachedProcesses.delete(projectId);
          }
        }),

      killSession: (projectId) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          // Detach first if attached
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.kill();
            attachedProcesses.delete(projectId);
          }
          // Kill the tmux session
          const killProc = yield* execTmux(
            ["kill-session", "-t", name],
            name,
          );
          yield* Effect.async<void, TmuxSessionError>((resume) => {
            killProc.onExit((event) => {
              if (event.exitCode === 0) {
                resume(Effect.void);
              } else {
                resume(
                  Effect.fail(
                    new TmuxSessionError(
                      name,
                      `tmux kill-session exited with code ${event.exitCode}`,
                    ),
                  ),
                );
              }
            });
          });
        }),

      hasSession: (projectId) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = yield* execTmux(["has-session", "-t", name], name).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (!proc) return false;
          return yield* Effect.async<boolean>((resume) => {
            proc.onExit((event) => {
              resume(Effect.succeed(event.exitCode === 0));
            });
          });
        }),
    } satisfies TmuxSessionManagerShape;
  }),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
Expected: PASS — both `sessionName` tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/terminal/Layers/TmuxSessionManager.ts apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts
git commit -m "feat(server): implement TmuxSessionManager layer with tests"
```

---

## Task 5: Wire TmuxSessionManager into Server Layer Graph

**Files:**
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Import TmuxSessionManagerLive**

Add import near the other terminal layer imports:

```typescript
import { TmuxSessionManagerLive } from "./terminal/Layers/TmuxSessionManager";
```

- [ ] **Step 2: Compose into TerminalLayerLive**

Find where `TerminalManagerLive` is composed (look for `TerminalLayerLive` or the `TerminalManagerLive` import). Add `TmuxSessionManagerLive` alongside it. The pattern follows the existing layer composition:

```typescript
// If TerminalLayerLive is already a variable:
const TerminalLayerLive = TerminalManagerLive.pipe(
  Layer.provide(PtyAdapterLive),
);

// Becomes:
const TerminalLayerLive = Layer.mergeAll(
  TerminalManagerLive,
  TmuxSessionManagerLive,
).pipe(
  Layer.provide(PtyAdapterLive),
);
```

If the composition is different, follow the existing pattern — the key point is `TmuxSessionManagerLive` needs `PtyAdapter` in scope (it depends on it).

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Should pass — `TmuxSessionManager` service is now available in the runtime.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/server.ts
git commit -m "feat(server): compose TmuxSessionManager into server layer graph"
```

---

## Task 6: RPC Handlers for Tmux Attach/Detach

**Files:**
- Modify: `apps/server/src/ws.ts`

- [ ] **Step 1: Import TmuxSessionManager**

Add to imports:

```typescript
import { TmuxSessionManager } from "./terminal/Services/TmuxSessionManager";
```

- [ ] **Step 2: Yield the service in makeWsRpcLayer**

Inside the `Effect.gen(function* () { ... })` block of `makeWsRpcLayer`, add:

```typescript
const tmuxSessionManager = yield* TmuxSessionManager;
```

- [ ] **Step 3: Add RPC handlers**

Inside the `WsRpcGroup.of({ ... })` return object, add handlers for the new methods. Follow the existing `observeRpcEffect` pattern:

```typescript
[WS_METHODS.terminalAttachTmux]: (input) =>
  observeRpcEffect(
    WS_METHODS.terminalAttachTmux,
    Effect.gen(function* () {
      // Ensure session exists
      const exists = yield* tmuxSessionManager.hasSession(input.projectId);
      if (!exists) {
        yield* tmuxSessionManager.createSession(input.projectId, input.cwd);
      }
      // Attach — returns a PtyProcess whose data flows to the terminal
      const ptyProcess = yield* tmuxSessionManager.attachSession(
        input.projectId,
        input.cols,
        input.rows,
      );
      // Wire up the PTY process to stream terminal events
      // (reuse the existing terminal event publishing infrastructure)
      return {
        projectId: input.projectId,
        sessionName: tmuxSessionManager.sessionName(input.projectId),
        pid: ptyProcess.pid,
      };
    }).pipe(
      Effect.mapError((err) =>
        new TmuxError({ message: err.message ?? "Tmux operation failed" }),
      ),
    ),
    { "rpc.aggregate": "terminal" },
  ),

[WS_METHODS.terminalDetachTmux]: (input) =>
  observeRpcEffect(
    WS_METHODS.terminalDetachTmux,
    tmuxSessionManager.detachSession(input.projectId).pipe(
      Effect.mapError((err) =>
        new TmuxError({ message: err.message ?? "Tmux detach failed" }),
      ),
    ),
    { "rpc.aggregate": "terminal" },
  ),
```

**Important:** You'll need to import `TmuxError` from `@t3tools/contracts` at the top.

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Should pass — RPC group now implements all required methods.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws.ts
git commit -m "feat(server): add RPC handlers for terminal.attachTmux and terminal.detachTmux"
```

---

## Task 7: Client RPC Wiring

**Files:**
- Modify: `apps/web/src/rpc/wsRpcClient.ts`
- Modify: `apps/web/src/environmentApi.ts`

- [ ] **Step 1: Add tmux methods to WsRpcClient interface**

In `apps/web/src/rpc/wsRpcClient.ts`, add to the `WsRpcClient` interface inside `terminal`:

```typescript
readonly terminal: {
  // ... existing methods ...
  readonly attachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalAttachTmux>;
  readonly detachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalDetachTmux>;
};
```

- [ ] **Step 2: Add implementations in createWsRpcClient**

In the `terminal` object of `createWsRpcClient`:

```typescript
terminal: {
  // ... existing ...
  attachTmux: (input) => transport.request((client) => client[WS_METHODS.terminalAttachTmux](input)),
  detachTmux: (input) => transport.request((client) => client[WS_METHODS.terminalDetachTmux](input)),
},
```

- [ ] **Step 3: Expose in environmentApi**

In `apps/web/src/environmentApi.ts`, add to the `terminal` section of `createEnvironmentApi`:

```typescript
terminal: {
  // ... existing ...
  attachTmux: (input) => rpcClient.terminal.attachTmux(input as never),
  detachTmux: (input) => rpcClient.terminal.detachTmux(input as never),
},
```

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/rpc/wsRpcClient.ts apps/web/src/environmentApi.ts
git commit -m "feat(web): wire tmux attach/detach RPC methods to client"
```

---

## Task 8: Terminal State Store — Tmux Tracking

**Files:**
- Modify: `apps/web/src/terminalStateStore.ts`

- [ ] **Step 1: Add tmux state to the store**

Add a new state field to track active tmux sessions. Find the store interface and add:

```typescript
// In the state interface
activeTmuxProjectId: string | null;

// In the store actions
setActiveTmuxProject: (projectId: string | null) => void;
```

- [ ] **Step 2: Initialize in create()**

In the `create<TerminalStateStoreState>()` initializer, add:

```typescript
activeTmuxProjectId: null,

setActiveTmuxProject: (projectId) =>
  set({ activeTmuxProjectId: projectId }),
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/terminalStateStore.ts
git commit -m "feat(web): add tmux project tracking to terminal state store"
```

---

## Task 9: ThreadTerminalDrawer — Tmux Mode

**Files:**
- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

This is the most involved UI change. The terminal drawer needs to support two modes:
1. **Existing mode** — isolated PTY per thread (for agent terminals)
2. **Tmux mode** — attaches to project's tmux session

- [ ] **Step 1: Add tmux attach/detach logic**

In the `TerminalViewport` component (or the main terminal setup effect), add a new code path. The key integration point is the `openTerminal` function (around line 622). Add a parallel function:

```typescript
const openTmuxTerminal = async () => {
  try {
    const activeTerminal = terminalRef.current;
    const activeFitAddon = fitAddonRef.current;
    if (!activeTerminal || !activeFitAddon) return;

    activeFitAddon.fit();

    const snapshot = await api.terminal.attachTmux({
      projectId,
      cwd,
      cols: activeTerminal.cols,
      rows: activeTerminal.rows,
    });

    if (disposed) return;
    terminalHydratedRef.current = true;

    // Store active tmux project
    useTerminalStateStore.getState().setActiveTmuxProject(projectId);

    if (autoFocus) {
      window.requestAnimationFrame(() => {
        activeTerminal.focus();
      });
    }
  } catch (err) {
    if (disposed) return;
    writeSystemMessage(
      terminalRef.current!,
      err instanceof Error ? err.message : "Failed to attach tmux session",
    );
  }
};
```

- [ ] **Step 2: Add detach on unmount/project switch**

In the cleanup function of the terminal effect, add tmux detach:

```typescript
return () => {
  disposed = true;
  const currentTmuxProject = useTerminalStateStore.getState().activeTmuxProjectId;
  if (currentTmuxProject) {
    void api.terminal.detachTmux({ projectId: currentTmuxProject }).catch(() => {});
    useTerminalStateStore.getState().setActiveTmuxProject(null);
  }
};
```

- [ ] **Step 3: Add tmux mode detection**

The drawer needs to know when to use tmux mode vs regular mode. Add a prop or derive from context:

```typescript
// Tmux mode: used for the main workspace terminal
// Regular mode: used for agent terminals within threads
const isTmuxMode = /* determine based on terminal context — e.g., isWorkspaceTerminal prop */;
```

The simplest approach: add a `mode: "tmux" | "pty"` prop to `TerminalViewport`. The parent component passes `"tmux"` for the main workspace terminal and `"pty"` for agent terminals.

- [ ] **Step 4: Wire tmux data streaming**

The tmux PTY output must flow through the existing `TerminalEvent` subscription pipeline so the client-side event processing works unchanged.

**How the existing event pipeline works** (in `apps/server/src/terminal/Layers/Manager.ts`):
- `terminalEventListeners` is a `Set<(event: TerminalEvent) => Effect.Effect<void>>` (line ~687)
- `publishEvent(event)` iterates the set and calls each listener (line ~691)
- `subscribe(listener)` adds a callback to the set, returns unsubscribe function (line ~1852)
- In `ws.ts`, the `subscribeTerminalEvents` RPC handler creates a `Stream.callback` that calls `terminalManager.subscribe()` to pipe events into the WebSocket stream

**Approach: Wire tmux PTY events through the same `publishEvent` pipeline.**

The RPC handler in `ws.ts` for `terminalAttachTmux` (Task 6) must wire the PtyProcess output into the event bus. Since `publishEvent` is internal to `Manager.ts`, the cleanest approach is to add tmux event publishing methods directly to `TerminalManager`.

In `apps/server/src/terminal/Services/Manager.ts`, extend `TerminalManagerShape` with:

```typescript
readonly publishTmuxOutput: (projectId: string, data: string) => Effect.Effect<void>;
readonly publishTmuxExit: (projectId: string, exitCode: number, signal: number | null) => Effect.Effect<void>;
```

In `apps/server/src/terminal/Layers/Manager.ts`, implement them using the existing `publishEvent`:

```typescript
publishTmuxOutput: (projectId, data) =>
  publishEvent({
    type: "output",
    threadId: `tmux:${projectId}`,  // Convention: tmux sessions use "tmux:" prefix as threadId
    terminalId: "tmux",
    data,
  }),

publishTmuxExit: (projectId, exitCode, signal) =>
  publishEvent({
    type: "exited",
    threadId: `tmux:${projectId}`,
    terminalId: "tmux",
    exitCode,
    exitSignal: signal,
  }),
```

Then in `ws.ts`, the `terminalAttachTmux` handler wires the PTY callbacks:

```typescript
const ptyProcess = yield* tmuxSessionManager.attachSession(input.projectId, input.cols, input.rows);

// Wire PTY output → event bus
ptyProcess.onData((data) => {
  Effect.runFork(terminalManager.publishTmuxOutput(input.projectId, data));
});
ptyProcess.onExit((event) => {
  Effect.runFork(terminalManager.publishTmuxExit(input.projectId, event.exitCode, event.signal));
});
```

**Client-side ID mapping:** On the client, tmux terminal events are keyed by `threadId: "tmux:{projectId}"` and `terminalId: "tmux"`. The `ThreadTerminalDrawer` in tmux mode must subscribe to events matching this convention rather than the regular thread-based keys. In the store subscription (Step 3 of this task), filter events by this key pattern:

```typescript
const tmuxThreadRef = { environmentId, threadId: `tmux:${projectId}` };
```

This way all existing event buffering, sliding window, and xterm.js write logic works unchanged — just with different key values.

- [ ] **Step 5: Handle terminal.reset() on project switch**

When switching projects, before attaching the new tmux session, call:

```typescript
activeTerminal.reset();
```

This clears the xterm.js buffer so stale output from the previous session isn't visible.

- [ ] **Step 6: Verify the full flow manually**

1. Start T3 Code: `bun run dev`
2. Open a project
3. Terminal drawer should show tmux session (verify with `tmux list-sessions` in another terminal)
4. Type commands in the terminal — they should work as if in tmux
5. Switch to another project — terminal should show that project's tmux session
6. Switch back — first project's tmux session should be exactly as you left it

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx
git commit -m "feat(web): add tmux mode to ThreadTerminalDrawer with attach/detach lifecycle"
```

---

## Task 10: Project Jump Keybinding Commands

**Files:**
- Modify: `packages/contracts/src/keybindings.ts`
- Modify: `apps/server/src/keybindings.ts`
- Modify: `apps/web/src/keybindings.ts`

- [ ] **Step 1: Add PROJECT_JUMP commands to contracts**

In `packages/contracts/src/keybindings.ts`, add after the `THREAD_JUMP_KEYBINDING_COMMANDS`:

```typescript
export const PROJECT_JUMP_KEYBINDING_COMMANDS = [
  "project.jump.1",
  "project.jump.2",
  "project.jump.3",
  "project.jump.4",
  "project.jump.5",
  "project.jump.6",
  "project.jump.7",
  "project.jump.8",
  "project.jump.9",
] as const;
export type ProjectJumpKeybindingCommand = (typeof PROJECT_JUMP_KEYBINDING_COMMANDS)[number];
```

- [ ] **Step 2: Add to STATIC_KEYBINDING_COMMANDS**

In the same file, add `...PROJECT_JUMP_KEYBINDING_COMMANDS` to the `STATIC_KEYBINDING_COMMANDS` array:

```typescript
const STATIC_KEYBINDING_COMMANDS = [
  "terminal.toggle",
  "terminal.split",
  "terminal.new",
  "terminal.close",
  "diff.toggle",
  "chat.new",
  "chat.newLocal",
  "editor.openFavorite",
  ...THREAD_KEYBINDING_COMMANDS,
  ...PROJECT_JUMP_KEYBINDING_COMMANDS,  // ← NEW
] as const;
```

- [ ] **Step 3: Add default keybindings on server**

In `apps/server/src/keybindings.ts`, add to `DEFAULT_KEYBINDINGS` array:

```typescript
...PROJECT_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
  key: `alt+${index + 1}`,
  command,
})),
```

Import `PROJECT_JUMP_KEYBINDING_COMMANDS` from `@t3tools/contracts`.

- [ ] **Step 4: Add helper functions on client**

In `apps/web/src/keybindings.ts`, add (mirroring the existing `threadJumpCommandForIndex` / `threadJumpIndexFromCommand`):

```typescript
import { PROJECT_JUMP_KEYBINDING_COMMANDS, type ProjectJumpKeybindingCommand } from "@t3tools/contracts";

export function projectJumpCommandForIndex(index: number): ProjectJumpKeybindingCommand | null {
  return PROJECT_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function projectJumpIndexFromCommand(command: string): number | null {
  const index = PROJECT_JUMP_KEYBINDING_COMMANDS.indexOf(command as ProjectJumpKeybindingCommand);
  return index >= 0 ? index : null;
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/keybindings.ts apps/server/src/keybindings.ts apps/web/src/keybindings.ts
git commit -m "feat(keybindings): add project.jump.1-9 commands with Alt+N defaults"
```

---

## Task 11: Wire Project Jump in Global Shortcuts

**Files:**
- Modify: `apps/web/src/routes/_chat.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Handle project.jump commands in _chat.tsx**

In `apps/web/src/routes/_chat.tsx`, inside the `onWindowKeyDown` handler (after the existing `resolveShortcutCommand` call), add:

```typescript
import { projectJumpIndexFromCommand } from "../keybindings";

// After the existing command handling:
const projectJumpIndex = projectJumpIndexFromCommand(command ?? "");
if (projectJumpIndex !== null) {
  event.preventDefault();
  event.stopPropagation();
  // Access ordered projects from uiStateStore and navigate
  const projectOrder = useUiStateStore.getState().projectOrder;
  const targetProjectId = projectOrder[projectJumpIndex];
  if (targetProjectId) {
    // Trigger project switch — reuse the same mechanism as sidebar click
    focusMostRecentThreadForProject(targetProjectId);
  }
  return;
}
```

**Note:** `focusMostRecentThreadForProject` is defined in `Sidebar.tsx`. You may need to extract it to a shared hook or store action so `_chat.tsx` can call it. Check how the existing project click handler works and share that logic.

The simplest approach: look at how `Sidebar.tsx` navigates on project click — it calls `navigate()` from TanStack Router with the most recent thread. You can replicate this in `_chat.tsx` using the same store selectors.

- [ ] **Step 2: Show project jump labels in Sidebar**

In `apps/web/src/components/Sidebar.tsx`, mirror the existing `threadJumpLabelByKey` pattern to show `Alt+1` through `Alt+9` on project items:

1. Build a `projectJumpLabelMap` similar to `buildThreadJumpLabelMap`
2. Pass labels to `SidebarProjectItem`
3. Display the label in the project button (small badge, similar to thread jump labels)

Follow the exact same pattern as `threadJumpLabelByKey` — look at lines ~182-210 for the thread version and replicate for projects.

- [ ] **Step 3: Verify manually**

1. Start T3 Code: `bun run dev`
2. Open sidebar with multiple projects
3. Press `Alt+1` — should jump to first project
4. Press `Alt+2` — should jump to second project
5. Reorder projects via drag-and-drop, verify `Alt+N` follows new order
6. Project jump labels should be visible on project items

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_chat.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): wire Alt+1-9 project jump shortcuts with sidebar labels"
```

---

## Task 12: App Control Keybindings

**Files:**
- Modify: `packages/contracts/src/keybindings.ts`
- Modify: `apps/server/src/keybindings.ts`
- Modify: `apps/web/src/routes/_chat.tsx`

- [ ] **Step 1: Add new command identifiers**

In `packages/contracts/src/keybindings.ts`, add to `STATIC_KEYBINDING_COMMANDS`:

```typescript
"chat.togglePanel",
"terminal.focus",
"chat.focus",
"project.switcher",
```

- [ ] **Step 2: Add default keybindings**

In `apps/server/src/keybindings.ts`, add to `DEFAULT_KEYBINDINGS`:

```typescript
{ key: "ctrl+shift+space", command: "chat.togglePanel" },
{ key: "ctrl+shift+t", command: "terminal.focus" },
{ key: "ctrl+shift+c", command: "chat.focus" },
{ key: "ctrl+shift+p", command: "project.switcher" },
```

- [ ] **Step 3: Handle in _chat.tsx**

Add handlers for the new commands in the global keydown handler:

```typescript
if (command === "terminal.focus") {
  event.preventDefault();
  // Focus the terminal element
  document.querySelector<HTMLElement>('[data-terminal-focus]')?.focus();
  return;
}

if (command === "chat.focus") {
  event.preventDefault();
  // Focus the chat composer
  document.querySelector<HTMLElement>('[data-chat-composer]')?.focus();
  return;
}

if (command === "chat.togglePanel") {
  event.preventDefault();
  // Toggle terminal drawer visibility
  // Use the existing terminal state store toggle
  return;
}

if (command === "project.switcher") {
  event.preventDefault();
  // Open command palette filtered to projects
  // This depends on the existing command palette implementation
  return;
}
```

**Note:** The exact DOM selectors and focus mechanisms depend on what `data-*` attributes exist. Check the actual terminal and chat components for focusable refs.

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/keybindings.ts apps/server/src/keybindings.ts apps/web/src/routes/_chat.tsx
git commit -m "feat(keybindings): add Ctrl+Shift app control shortcuts"
```

---

## Task 13: Tmux Fallback — No tmux Binary

**Files:**
- Modify: `apps/server/src/terminal/Layers/TmuxSessionManager.ts`
- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

- [ ] **Step 1: Add tmux availability check**

In `TmuxSessionManager.ts`, add a method to check if tmux exists:

```typescript
// Add to TmuxSessionManagerShape interface (Services file)
readonly isTmuxAvailable: Effect.Effect<boolean>;
```

Implementation:

```typescript
isTmuxAvailable: Effect.gen(function* () {
  const proc = yield* ptyAdapter
    .spawn({
      shell: "tmux",
      args: ["-V"],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      env: process.env as NodeJS.ProcessEnv,
    })
    .pipe(Effect.orElseSucceed(() => null));
  if (!proc) return false;
  return yield* Effect.async<boolean>((resume) => {
    proc.onExit((event) => {
      resume(Effect.succeed(event.exitCode === 0));
    });
  });
}),
```

- [ ] **Step 2: Handle fallback on client**

In `ThreadTerminalDrawer.tsx`, when `attachTmux` fails with a TmuxError that indicates tmux is not found, fall back to the regular `openTerminal` function:

```typescript
try {
  await openTmuxTerminal();
} catch (err) {
  if (err instanceof Error && err.message.includes("not found")) {
    console.warn("tmux not available, falling back to regular terminal");
    await openTerminal();
  } else {
    throw err;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/terminal/Services/TmuxSessionManager.ts apps/server/src/terminal/Layers/TmuxSessionManager.ts apps/web/src/components/ThreadTerminalDrawer.tsx
git commit -m "feat: add tmux availability check with graceful fallback to regular PTY"
```

---

## Task 14: Final Integration Test

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: Zero errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests pass (existing + new TmuxSessionManager tests).

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: Zero warnings/errors.

- [ ] **Step 4: Manual end-to-end verification**

Checklist:
1. `bun run dev` starts without errors
2. Open T3 Code in browser
3. Create/open a project → tmux session created (`tmux list-sessions` shows `t3-{projectId}`)
4. Terminal shows live tmux session — type commands, verify they execute
5. Open neovim in the terminal — verify it renders correctly
6. Split tmux panes with `Ctrl-b %` — verify splits work
7. Switch to second project via sidebar click → terminal shows new tmux session
8. Switch back to first project → neovim and tmux layout intact
9. Press `Alt+1` / `Alt+2` → project switching works
10. `Ctrl+Shift+T` → focuses terminal
11. `Ctrl+Shift+C` → focuses chat
12. Kill T3 Code, restart → tmux sessions still running, reattach works
13. Agent terminal (start an agent task) → uses isolated PTY, not tmux

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: tmux session manager — terminal as first-class citizen

Adds tmux session orchestration to T3 Code:
- One auto-created tmux session per project
- xterm.js attaches to tmux session
- Project switching detaches/reattaches instantly (~50ms)
- Alt+1-9 for position-based project jumping
- Ctrl+Shift shortcuts for app controls
- Graceful fallback when tmux not installed
- Agent terminals unchanged (isolated PTYs)"
```
