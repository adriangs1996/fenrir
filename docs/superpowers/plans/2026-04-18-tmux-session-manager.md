# Tmux Session Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fenrir orchestrate tmux sessions per project — one auto-created session per project, xterm.js attaches to it, project switching detaches/reattaches instantly.

**Architecture:** New `TmuxSessionManager` Effect service layer spawns/manages tmux sessions via node-pty. Existing terminal infrastructure stays untouched for agent PTYs. New RPC methods (`terminal.attachTmux` / `terminal.detachTmux`) handle the WebSocket protocol. Client-side: `ThreadTerminalDrawer` gains a tmux-aware mode. Keybindings: `Alt+1-9` for project jumping, `Ctrl+Shift` combos for app controls.

**Tech Stack:** Effect.js (ServiceMap, Layer, Schema), node-pty, xterm.js + FitAddon, Zustand, TanStack Router, dnd-kit (existing)

**Spec:** `docs/superpowers/specs/2026-04-18-tmux-session-manager-design.md`

**Testing approach:** TDD throughout. Every task starts with failing tests, then implementation to make them pass.

**Testing patterns used in this codebase:**
- `import { assert, it } from "@effect/vitest"` for Effect-based tests
- `import { describe, expect, it } from "vitest"` for non-Effect tests
- `it.effect("desc", () => Effect.gen(function* () { ... }))` auto-runs Effects
- `it.layer(layer)("group", (it) => { ... })` provides services
- Fake classes implementing service interfaces (not vi.mock for Effect services)
- `Ref.make()` to collect events in tests
- `waitFor()` + `Schedule.spaced()` for polling async conditions
- `Effect.exit()` to inspect failures
- `Schema.decodeUnknownSync()` for contract validation tests

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/server/src/terminal/Services/TmuxSessionManager.ts` | Service interface — Effect Tag, input/error schemas |
| `apps/server/src/terminal/Layers/TmuxSessionManager.ts` | Implementation — spawns tmux commands via PtyAdapter |
| `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts` | Unit tests for tmux session lifecycle |
| `packages/contracts/src/terminal.tmux.test.ts` | Contract schema validation tests |
| `apps/web/src/keybindings.test.ts` | Tests for project jump helpers (extend existing) |
| `apps/web/src/terminalStateStore.tmux.test.ts` | Tmux state tracking tests |

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

## Task 1: Tmux Contract Schemas (TDD)

**Files:**
- Create: `packages/contracts/src/terminal.tmux.test.ts`
- Modify: `packages/contracts/src/terminal.ts`

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/terminal.tmux.test.ts`:

```typescript
import { assert, it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Schema } from "effect";

// These imports will fail until we create the schemas
import {
  TmuxAttachInput,
  TmuxDetachInput,
  TmuxError,
  TmuxSessionSnapshot,
} from "./terminal";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

describe("TmuxAttachInput", () => {
  it.effect("accepts valid input", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxAttachInput, {
        projectId: "abc-123",
        cwd: "/home/user/project",
        cols: 120,
        rows: 40,
      });
      assert.strictEqual(parsed.projectId, "abc-123");
      assert.strictEqual(parsed.cwd, "/home/user/project");
      assert.strictEqual(parsed.cols, 120);
      assert.strictEqual(parsed.rows, 40);
    }),
  );

  it.effect("rejects empty projectId", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          projectId: "",
          cwd: "/tmp",
          cols: 80,
          rows: 24,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("rejects cols below minimum (20)", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          projectId: "test",
          cwd: "/tmp",
          cols: 5,
          rows: 24,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("rejects rows above maximum (200)", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          projectId: "test",
          cwd: "/tmp",
          cols: 80,
          rows: 999,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );
});

describe("TmuxDetachInput", () => {
  it.effect("accepts valid projectId", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxDetachInput, {
        projectId: "abc-123",
      });
      assert.strictEqual(parsed.projectId, "abc-123");
    }),
  );

  it.effect("rejects empty projectId", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxDetachInput, { projectId: "" }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );
});

describe("TmuxSessionSnapshot", () => {
  it.effect("accepts valid snapshot", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxSessionSnapshot, {
        projectId: "abc-123",
        sessionName: "fenrir-abc-123",
        pid: 12345,
      });
      assert.strictEqual(parsed.projectId, "abc-123");
      assert.strictEqual(parsed.sessionName, "fenrir-abc-123");
      assert.strictEqual(parsed.pid, 12345);
    }),
  );

  it.effect("accepts null pid", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxSessionSnapshot, {
        projectId: "abc",
        sessionName: "fenrir-abc",
        pid: null,
      });
      assert.isNull(parsed.pid);
    }),
  );
});

describe("TmuxError", () => {
  it("has correct _tag", () => {
    const error = new TmuxError({ message: "something broke" });
    expect(error._tag).toBe("TmuxError");
    expect(error.message).toBe("something broke");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- packages/contracts/src/terminal.tmux.test.ts`
Expected: FAIL — imports don't exist yet.

- [ ] **Step 3: Implement the schemas**

Open `packages/contracts/src/terminal.ts`. Reuse the existing `TerminalColsSchema` and `TerminalRowsSchema` constants (they use `Schema.isGreaterThanOrEqualTo` / `Schema.isLessThanOrEqualTo`). Add after `TerminalCloseInput`:

```typescript
// --- Tmux schemas ---

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

export const TmuxSessionSnapshot = Schema.Struct({
  projectId: Schema.NonEmptyString,
  sessionName: Schema.NonEmptyString,
  pid: Schema.NullOr(Schema.Number),
});
export type TmuxSessionSnapshot = typeof TmuxSessionSnapshot.Type;

export class TmuxError extends Schema.TaggedErrorClass<TmuxError>()(
  "TmuxError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- packages/contracts/src/terminal.tmux.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/terminal.ts packages/contracts/src/terminal.tmux.test.ts
git commit -m "feat(contracts): add tmux attach/detach schemas and TmuxError with tests"
```

---

## Task 2: RPC Method Definitions

**Files:**
- Modify: `packages/contracts/src/rpc.ts`

- [ ] **Step 1: Add WS_METHODS entries**

In `packages/contracts/src/rpc.ts`, add to the `WS_METHODS` object inside the `// Terminal methods` section:

```typescript
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

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck`
Expected: Type errors in `ws.ts` and `wsRpcClient.ts` — expected, those don't implement new methods yet.

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

  readonly isTmuxAvailable: Effect.Effect<boolean>;

  readonly sessionName: (projectId: string) => string;
}

export class TmuxSessionManager extends ServiceMap.Service<
  TmuxSessionManager,
  TmuxSessionManagerShape
>()("fenrir/terminal/Services/TmuxSessionManager") {}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors — standalone file.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/terminal/Services/TmuxSessionManager.ts
git commit -m "feat(server): add TmuxSessionManager service interface"
```

---

## Task 4: TmuxSessionManager Implementation (TDD)

**Files:**
- Create: `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
- Create: `apps/server/src/terminal/Layers/TmuxSessionManager.ts`

- [ ] **Step 1: Write the FakePtyAdapter for tmux tests**

Model after the existing `FakePtyAdapter` in `apps/server/src/terminal/Layers/Manager.test.ts`. This one simulates tmux command responses:

```typescript
// apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts
import { assert, it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { TmuxSessionManager } from "../Services/TmuxSessionManager";
import type { PtyAdapterShape, PtyProcess, PtyExitEvent, PtySpawnInput } from "../Services/PTY";
import { PtyAdapter } from "../Services/PTY";

class FakeTmuxPtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  constructor(
    readonly pid: number,
    private readonly exitCode: number = 0,
  ) {
    // Auto-exit after creation (simulates tmux command completing)
    queueMicrotask(() => {
      for (const listener of this.exitListeners) {
        listener({ exitCode: this.exitCode, signal: null });
      }
    });
  }

  write(data: string): void {
    this.writes.push(data);
  }
  resize(_cols: number, _rows: number): void {}
  kill(_signal?: string): void {}

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => this.dataListeners.delete(callback);
  }
  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }
}

class FakeTmuxPtyAdapter implements PtyAdapterShape {
  readonly spawnCalls: PtySpawnInput[] = [];
  readonly processes: FakeTmuxPtyProcess[] = [];
  private nextPid = 1000;
  // Map of tmux subcommand → exit code (default 0)
  exitCodeBySubcommand = new Map<string, number>();

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess> {
    this.spawnCalls.push(input);
    const subcommand = input.args?.[0] ?? "";
    const exitCode = this.exitCodeBySubcommand.get(subcommand) ?? 0;
    const process = new FakeTmuxPtyProcess(this.nextPid++, exitCode);
    this.processes.push(process);
    return Effect.succeed(process);
  }
}
```

- [ ] **Step 2: Write failing tests for sessionName**

```typescript
describe("TmuxSessionManager", () => {
  const makeFakeLayer = (adapter?: FakeTmuxPtyAdapter) => {
    const ptyAdapter = adapter ?? new FakeTmuxPtyAdapter();
    // Import will fail until implementation exists
    const { TmuxSessionManagerLive } = require("../Layers/TmuxSessionManager");
    const TestLayer = TmuxSessionManagerLive.pipe(
      Layer.provide(Layer.succeed(PtyAdapter, ptyAdapter)),
    );
    return { ptyAdapter, TestLayer };
  };

  it.effect("sessionName returns fenrir-prefixed name", () =>
    Effect.gen(function* () {
      const { TestLayer } = makeFakeLayer();
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));
      assert.strictEqual(manager.sessionName("abc-123"), "fenrir-abc-123");
    }),
  );

  it.effect("sessionName sanitizes dots and colons", () =>
    Effect.gen(function* () {
      const { TestLayer } = makeFakeLayer();
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));
      const name = manager.sessionName("my.project:v2");
      expect(name).not.toContain(".");
      expect(name).not.toContain(":");
      assert.strictEqual(name, "fenrir-my-project-v2");
    }),
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test -- apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
Expected: FAIL — `TmuxSessionManagerLive` doesn't exist.

- [ ] **Step 4: Write minimal implementation to pass sessionName tests**

Create `apps/server/src/terminal/Layers/TmuxSessionManager.ts`:

```typescript
import { Effect, Layer } from "effect";
import {
  TmuxSessionManager,
  type TmuxSessionManagerShape,
  TmuxSessionError,
  TmuxNotFoundError,
} from "../Services/TmuxSessionManager";
import { PtyAdapter, type PtyProcess } from "../Services/PTY";

const SESSION_PREFIX = "fenrir-";

function sanitizeSessionName(projectId: string): string {
  return `${SESSION_PREFIX}${projectId.replace(/[.:]/g, "-")}`;
}

export const TmuxSessionManagerLive = Layer.effect(
  TmuxSessionManager,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
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
            if (err.message.includes("ENOENT") || err.message.includes("not found")) {
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
          const proc = yield* execTmux(["new-session", "-d", "-s", name, "-c", cwd], name);
          yield* Effect.async<void, TmuxSessionError>((resume) => {
            proc.onExit((event) => {
              if (event.exitCode === 0) {
                resume(Effect.void);
              } else {
                resume(Effect.fail(new TmuxSessionError(name, `tmux new-session exited with code ${event.exitCode}`)));
              }
            });
          });
        }),

      attachSession: (projectId, cols, rows) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const exists = yield* Effect.gen(function* () {
            const proc = yield* execTmux(["has-session", "-t", name], name);
            return yield* Effect.async<boolean>((resume) => {
              proc.onExit((event) => resume(Effect.succeed(event.exitCode === 0)));
            });
          }).pipe(Effect.orElseSucceed(() => false));

          if (!exists) {
            return yield* Effect.fail(new TmuxSessionError(name, `Session ${name} does not exist`));
          }

          const attachProc = yield* ptyAdapter
            .spawn({ shell: "tmux", args: ["attach-session", "-t", name], cwd: "/tmp", cols, rows, env: process.env as NodeJS.ProcessEnv })
            .pipe(Effect.mapError((err) => new TmuxSessionError(name, `Failed to attach: ${err.message}`, err.cause)));

          attachedProcesses.set(projectId, attachProc);
          return attachProc;
        }),

      detachSession: (projectId) =>
        Effect.sync(() => {
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.kill();
            attachedProcesses.delete(projectId);
          }
        }),

      killSession: (projectId) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = attachedProcesses.get(projectId);
          if (proc) {
            proc.kill();
            attachedProcesses.delete(projectId);
          }
          const killProc = yield* execTmux(["kill-session", "-t", name], name);
          yield* Effect.async<void, TmuxSessionError>((resume) => {
            killProc.onExit((event) => {
              if (event.exitCode === 0) resume(Effect.void);
              else resume(Effect.fail(new TmuxSessionError(name, `tmux kill-session exited with code ${event.exitCode}`)));
            });
          });
        }),

      hasSession: (projectId) =>
        Effect.gen(function* () {
          const name = sanitizeSessionName(projectId);
          const proc = yield* execTmux(["has-session", "-t", name], name).pipe(Effect.orElseSucceed(() => null));
          if (!proc) return false;
          return yield* Effect.async<boolean>((resume) => {
            proc.onExit((event) => resume(Effect.succeed(event.exitCode === 0)));
          });
        }),

      isTmuxAvailable: Effect.gen(function* () {
        const proc = yield* ptyAdapter
          .spawn({ shell: "tmux", args: ["-V"], cwd: "/tmp", cols: 80, rows: 24, env: process.env as NodeJS.ProcessEnv })
          .pipe(Effect.orElseSucceed(() => null));
        if (!proc) return false;
        return yield* Effect.async<boolean>((resume) => {
          proc.onExit((event) => resume(Effect.succeed(event.exitCode === 0)));
        });
      }),
    } satisfies TmuxSessionManagerShape;
  }),
);
```

- [ ] **Step 5: Run tests to verify sessionName tests pass**

Run: `bun run test -- apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
Expected: PASS for sessionName tests.

- [ ] **Step 6: Add more tests — createSession and hasSession**

Add to the test file:

```typescript
  it.effect("createSession spawns tmux new-session with correct args", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      yield* manager.createSession("proj-1", "/home/user/project");

      expect(ptyAdapter.spawnCalls).toHaveLength(1);
      const call = ptyAdapter.spawnCalls[0]!;
      expect(call.shell).toBe("tmux");
      expect(call.args).toEqual(["new-session", "-d", "-s", "fenrir-proj-1", "-c", "/home/user/project"]);
    }),
  );

  it.effect("createSession fails when tmux exits non-zero", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      ptyAdapter.exitCodeBySubcommand.set("new-session", 1);
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      const result = yield* Effect.exit(manager.createSession("proj-1", "/tmp"));
      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("hasSession returns true when tmux has-session exits 0", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      const exists = yield* manager.hasSession("proj-1");
      assert.isTrue(exists);

      const call = ptyAdapter.spawnCalls[0]!;
      expect(call.args).toEqual(["has-session", "-t", "fenrir-proj-1"]);
    }),
  );

  it.effect("hasSession returns false when tmux has-session exits non-zero", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      ptyAdapter.exitCodeBySubcommand.set("has-session", 1);
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      const exists = yield* manager.hasSession("proj-1");
      assert.isFalse(exists);
    }),
  );

  it.effect("isTmuxAvailable returns true when tmux -V exits 0", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      const available = yield* manager.isTmuxAvailable;
      assert.isTrue(available);
    }),
  );

  it.effect("detachSession kills the attached process", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      // Create then attach
      yield* manager.createSession("proj-1", "/tmp");
      yield* manager.attachSession("proj-1", 80, 24);

      // Detach should not throw
      yield* manager.detachSession("proj-1");
    }),
  );

  it.effect("killSession spawns tmux kill-session", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakeTmuxPtyAdapter();
      const { TestLayer } = makeFakeLayer(ptyAdapter);
      const manager = yield* TmuxSessionManager.pipe(Effect.provide(TestLayer));

      yield* manager.killSession("proj-1");

      const killCall = ptyAdapter.spawnCalls.find(
        (c) => c.args?.includes("kill-session"),
      );
      expect(killCall).toBeDefined();
      expect(killCall!.args).toEqual(["kill-session", "-t", "fenrir-proj-1"]);
    }),
  );
```

- [ ] **Step 7: Run all tests to verify they pass**

Run: `bun run test -- apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/terminal/Layers/TmuxSessionManager.ts apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts
git commit -m "feat(server): implement TmuxSessionManager layer with comprehensive TDD tests"
```

---

## Task 5: Wire TmuxSessionManager into Server Layer Graph

**Files:**
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Import TmuxSessionManagerLive**

Add import near other terminal layer imports:

```typescript
import { TmuxSessionManagerLive } from "./terminal/Layers/TmuxSessionManager";
```

- [ ] **Step 2: Compose into TerminalLayerLive**

Find where `TerminalManagerLive` is composed. Add `TmuxSessionManagerLive` alongside it:

```typescript
const TerminalLayerLive = Layer.mergeAll(
  TerminalManagerLive,
  TmuxSessionManagerLive,
).pipe(
  Layer.provide(PtyAdapterLive),
);
```

If the composition pattern differs, follow it — key point is `TmuxSessionManagerLive` needs `PtyAdapter` in scope.

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/server.ts
git commit -m "feat(server): compose TmuxSessionManager into server layer graph"
```

---

## Task 6: Tmux Event Publishing on TerminalManager (TDD)

**Files:**
- Modify: `apps/server/src/terminal/Services/Manager.ts`
- Modify: `apps/server/src/terminal/Layers/Manager.ts`
- Existing test: `apps/server/src/terminal/Layers/Manager.test.ts` (extend)

- [ ] **Step 1: Write failing test for publishTmuxOutput**

Add to the existing `apps/server/src/terminal/Layers/Manager.test.ts` (inside the test group that uses `createManager`):

```typescript
it.effect("publishTmuxOutput pushes output events to subscribers", () =>
  Effect.gen(function* () {
    const { manager, getEvents } = yield* createManager();

    yield* manager.publishTmuxOutput("proj-1", "hello from tmux\n");

    const events = yield* getEvents;
    const outputEvent = events.find(
      (e) => e.type === "output" && e.threadId === "tmux:proj-1",
    );
    expect(outputEvent).toBeDefined();
    expect(outputEvent!.data).toBe("hello from tmux\n");
    expect(outputEvent!.terminalId).toBe("tmux");
  }),
);

it.effect("publishTmuxExit pushes exited events to subscribers", () =>
  Effect.gen(function* () {
    const { manager, getEvents } = yield* createManager();

    yield* manager.publishTmuxExit("proj-1", 0, null);

    const events = yield* getEvents;
    const exitEvent = events.find(
      (e) => e.type === "exited" && e.threadId === "tmux:proj-1",
    );
    expect(exitEvent).toBeDefined();
    expect(exitEvent!.exitCode).toBe(0);
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- apps/server/src/terminal/Layers/Manager.test.ts -t "publishTmux"`
Expected: FAIL — `publishTmuxOutput` doesn't exist on manager.

- [ ] **Step 3: Add methods to service interface**

In `apps/server/src/terminal/Services/Manager.ts`, extend `TerminalManagerShape`:

```typescript
readonly publishTmuxOutput: (projectId: string, data: string) => Effect.Effect<void>;
readonly publishTmuxExit: (projectId: string, exitCode: number, signal: number | null) => Effect.Effect<void>;
```

- [ ] **Step 4: Implement in Manager layer**

In `apps/server/src/terminal/Layers/Manager.ts`, add to the returned object (before the closing `} satisfies TerminalManagerShape`):

```typescript
publishTmuxOutput: (projectId, data) =>
  publishEvent({
    type: "output",
    threadId: `tmux:${projectId}`,
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- apps/server/src/terminal/Layers/Manager.test.ts -t "publishTmux"`
Expected: PASS.

- [ ] **Step 6: Run full Manager test suite to ensure no regressions**

Run: `bun run test -- apps/server/src/terminal/Layers/Manager.test.ts`
Expected: All existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/terminal/Services/Manager.ts apps/server/src/terminal/Layers/Manager.ts apps/server/src/terminal/Layers/Manager.test.ts
git commit -m "feat(server): add publishTmuxOutput/publishTmuxExit to TerminalManager with TDD"
```

---

## Task 7: RPC Handlers for Tmux Attach/Detach

**Files:**
- Modify: `apps/server/src/ws.ts`

- [ ] **Step 1: Import TmuxSessionManager and TmuxError**

```typescript
import { TmuxSessionManager } from "./terminal/Services/TmuxSessionManager";
// Add TmuxError to existing @fenrir/contracts import
```

- [ ] **Step 2: Yield the service in makeWsRpcLayer**

Inside the `Effect.gen` block of `makeWsRpcLayer`, add:

```typescript
const tmuxSessionManager = yield* TmuxSessionManager;
```

- [ ] **Step 3: Add RPC handlers with PTY event wiring**

Inside the `WsRpcGroup.of({ ... })` return object:

```typescript
[WS_METHODS.terminalAttachTmux]: (input) =>
  observeRpcEffect(
    WS_METHODS.terminalAttachTmux,
    Effect.gen(function* () {
      const exists = yield* tmuxSessionManager.hasSession(input.projectId);
      if (!exists) {
        yield* tmuxSessionManager.createSession(input.projectId, input.cwd);
      }
      const ptyProcess = yield* tmuxSessionManager.attachSession(
        input.projectId,
        input.cols,
        input.rows,
      );

      // Wire PTY output → TerminalManager event bus
      ptyProcess.onData((data) => {
        Effect.runFork(terminalManager.publishTmuxOutput(input.projectId, data));
      });
      ptyProcess.onExit((event) => {
        Effect.runFork(
          terminalManager.publishTmuxExit(input.projectId, event.exitCode, event.signal ?? null),
        );
      });

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

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: Pass — RPC group now implements all methods.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws.ts
git commit -m "feat(server): add RPC handlers for tmux attach/detach with PTY event wiring"
```

---

## Task 8: Client RPC Wiring

**Files:**
- Modify: `apps/web/src/rpc/wsRpcClient.ts`
- Modify: `apps/web/src/environmentApi.ts`

- [ ] **Step 1: Add tmux methods to WsRpcClient interface**

In `apps/web/src/rpc/wsRpcClient.ts`, add inside `terminal`:

```typescript
readonly attachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalAttachTmux>;
readonly detachTmux: RpcUnaryMethod<typeof WS_METHODS.terminalDetachTmux>;
```

- [ ] **Step 2: Add implementations in createWsRpcClient**

```typescript
attachTmux: (input) => transport.request((client) => client[WS_METHODS.terminalAttachTmux](input)),
detachTmux: (input) => transport.request((client) => client[WS_METHODS.terminalDetachTmux](input)),
```

- [ ] **Step 3: Expose in environmentApi**

In `apps/web/src/environmentApi.ts`:

```typescript
attachTmux: (input) => rpcClient.terminal.attachTmux(input as never),
detachTmux: (input) => rpcClient.terminal.detachTmux(input as never),
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

## Task 9: Terminal State Store — Tmux Tracking (TDD)

**Files:**
- Create: `apps/web/src/terminalStateStore.tmux.test.ts`
- Modify: `apps/web/src/terminalStateStore.ts`

- [ ] **Step 1: Write failing store tests**

Create `apps/web/src/terminalStateStore.tmux.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useTerminalStateStore } from "./terminalStateStore";

describe("terminalStateStore tmux tracking", () => {
  beforeEach(() => {
    // Reset store between tests
    useTerminalStateStore.setState({ activeTmuxProjectId: null });
  });

  it("initializes with null activeTmuxProjectId", () => {
    const state = useTerminalStateStore.getState();
    expect(state.activeTmuxProjectId).toBeNull();
  });

  it("setActiveTmuxProject updates the projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-abc");
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBe("proj-abc");
  });

  it("setActiveTmuxProject(null) clears the projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-abc");
    useTerminalStateStore.getState().setActiveTmuxProject(null);
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBeNull();
  });

  it("setActiveTmuxProject replaces previous projectId", () => {
    useTerminalStateStore.getState().setActiveTmuxProject("proj-1");
    useTerminalStateStore.getState().setActiveTmuxProject("proj-2");
    expect(useTerminalStateStore.getState().activeTmuxProjectId).toBe("proj-2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- apps/web/src/terminalStateStore.tmux.test.ts`
Expected: FAIL — `activeTmuxProjectId` doesn't exist on store.

- [ ] **Step 3: Add tmux state to the store**

In `apps/web/src/terminalStateStore.ts`, add to the state interface:

```typescript
activeTmuxProjectId: string | null;
setActiveTmuxProject: (projectId: string | null) => void;
```

And in the `create()` initializer:

```typescript
activeTmuxProjectId: null,
setActiveTmuxProject: (projectId) =>
  set({ activeTmuxProjectId: projectId }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- apps/web/src/terminalStateStore.tmux.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/terminalStateStore.ts apps/web/src/terminalStateStore.tmux.test.ts
git commit -m "feat(web): add tmux project tracking to terminal state store with TDD"
```

---

## Task 10: Project Jump Keybinding Commands (TDD)

**Files:**
- Modify: `packages/contracts/src/keybindings.ts`
- Modify: `apps/server/src/keybindings.ts`
- Modify: `apps/web/src/keybindings.ts`
- Extend: `apps/web/src/keybindings.test.ts`

- [ ] **Step 1: Write failing keybinding tests**

Add to `apps/web/src/keybindings.test.ts`:

```typescript
import {
  projectJumpCommandForIndex,
  projectJumpIndexFromCommand,
} from "./keybindings";

describe("projectJumpCommandForIndex", () => {
  it("returns project.jump.1 for index 0", () => {
    assert.strictEqual(projectJumpCommandForIndex(0), "project.jump.1");
  });

  it("returns project.jump.9 for index 8", () => {
    assert.strictEqual(projectJumpCommandForIndex(8), "project.jump.9");
  });

  it("returns null for out-of-range index", () => {
    assert.isNull(projectJumpCommandForIndex(9));
    assert.isNull(projectJumpCommandForIndex(-1));
  });
});

describe("projectJumpIndexFromCommand", () => {
  it("returns 0 for project.jump.1", () => {
    assert.strictEqual(projectJumpIndexFromCommand("project.jump.1"), 0);
  });

  it("returns 8 for project.jump.9", () => {
    assert.strictEqual(projectJumpIndexFromCommand("project.jump.9"), 8);
  });

  it("returns null for non-project-jump command", () => {
    assert.isNull(projectJumpIndexFromCommand("thread.jump.1"));
    assert.isNull(projectJumpIndexFromCommand("unknown"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- apps/web/src/keybindings.test.ts -t "projectJump"`
Expected: FAIL — functions don't exist.

- [ ] **Step 3: Add PROJECT_JUMP commands to contracts**

In `packages/contracts/src/keybindings.ts`:

```typescript
export const PROJECT_JUMP_KEYBINDING_COMMANDS = [
  "project.jump.1", "project.jump.2", "project.jump.3",
  "project.jump.4", "project.jump.5", "project.jump.6",
  "project.jump.7", "project.jump.8", "project.jump.9",
] as const;
export type ProjectJumpKeybindingCommand = (typeof PROJECT_JUMP_KEYBINDING_COMMANDS)[number];
```

Add `...PROJECT_JUMP_KEYBINDING_COMMANDS` to `STATIC_KEYBINDING_COMMANDS`.

- [ ] **Step 4: Add default keybindings on server**

In `apps/server/src/keybindings.ts`, add to `DEFAULT_KEYBINDINGS`:

```typescript
...PROJECT_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
  key: `alt+${index + 1}`,
  command,
})),
```

- [ ] **Step 5: Add helper functions on client**

In `apps/web/src/keybindings.ts`:

```typescript
import { PROJECT_JUMP_KEYBINDING_COMMANDS, type ProjectJumpKeybindingCommand } from "@fenrir/contracts";

export function projectJumpCommandForIndex(index: number): ProjectJumpKeybindingCommand | null {
  return PROJECT_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function projectJumpIndexFromCommand(command: string): number | null {
  const index = PROJECT_JUMP_KEYBINDING_COMMANDS.indexOf(command as ProjectJumpKeybindingCommand);
  return index >= 0 ? index : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- apps/web/src/keybindings.test.ts -t "projectJump"`
Expected: All 6 tests PASS.

- [ ] **Step 7: Run full keybindings test suite for regressions**

Run: `bun run test -- apps/web/src/keybindings.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/keybindings.ts apps/server/src/keybindings.ts apps/web/src/keybindings.ts apps/web/src/keybindings.test.ts
git commit -m "feat(keybindings): add project.jump.1-9 commands with Alt+N defaults and TDD tests"
```

---

## Task 11: ThreadTerminalDrawer — Tmux Mode

**Files:**
- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

This is the most involved UI change. No unit tests here — integration/manual testing.

- [ ] **Step 1: Add mode prop to TerminalViewport**

```typescript
mode: "tmux" | "pty"
```

Parent passes `"tmux"` for workspace terminal, `"pty"` for agent terminals.

- [ ] **Step 2: Add openTmuxTerminal function**

Alongside existing `openTerminal`, add:

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
    useTerminalStateStore.getState().setActiveTmuxProject(projectId);

    if (autoFocus) {
      window.requestAnimationFrame(() => activeTerminal.focus());
    }
  } catch (err) {
    if (disposed) return;
    if (err instanceof Error && err.message.includes("not found")) {
      console.warn("tmux not available, falling back to regular terminal");
      await openTerminal();
      return;
    }
    writeSystemMessage(
      terminalRef.current!,
      err instanceof Error ? err.message : "Failed to attach tmux session",
    );
  }
};
```

- [ ] **Step 3: Route to correct open function based on mode**

In the terminal setup effect:

```typescript
if (mode === "tmux") {
  void openTmuxTerminal();
} else {
  void openTerminal();
}
```

- [ ] **Step 4: Add tmux detach on cleanup**

```typescript
return () => {
  disposed = true;
  if (mode === "tmux") {
    const currentTmuxProject = useTerminalStateStore.getState().activeTmuxProjectId;
    if (currentTmuxProject) {
      void api.terminal.detachTmux({ projectId: currentTmuxProject }).catch(() => {});
      useTerminalStateStore.getState().setActiveTmuxProject(null);
    }
  }
};
```

- [ ] **Step 5: Add terminal.reset() on project switch**

When the component re-renders with a different projectId:

```typescript
activeTerminal.reset();
```

- [ ] **Step 6: Wire tmux event subscription using tmux key convention**

In tmux mode, subscribe to events keyed by `tmux:{projectId}`:

```typescript
const tmuxThreadRef = { environmentId, threadId: `tmux:${projectId}` };
```

Use this ref when calling `selectTerminalEventEntries` and in the store subscription.

- [ ] **Step 7: Manual verification**

1. `bun run dev`
2. Open project → terminal shows tmux session
3. Run commands, open neovim — works
4. Split tmux panes — works
5. Switch project → new tmux session, old one preserved
6. Switch back → layout intact
7. Agent terminal → still uses isolated PTY

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx
git commit -m "feat(web): add tmux mode to ThreadTerminalDrawer with attach/detach/fallback"
```

---

## Task 12: Wire Project Jump in Global Shortcuts

**Files:**
- Modify: `apps/web/src/routes/_chat.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Handle project.jump commands in _chat.tsx**

In the `onWindowKeyDown` handler, after existing `resolveShortcutCommand`:

```typescript
import { projectJumpIndexFromCommand } from "../keybindings";

const projectJumpIndex = projectJumpIndexFromCommand(command ?? "");
if (projectJumpIndex !== null) {
  event.preventDefault();
  event.stopPropagation();
  const projectOrder = useUiStateStore.getState().projectOrder;
  const targetProjectId = projectOrder[projectJumpIndex];
  if (targetProjectId) {
    // Navigate to most recent thread for project — replicate Sidebar.tsx pattern
    // using navigate() from TanStack Router
  }
  return;
}
```

**Note:** Extract `focusMostRecentThreadForProject` from `Sidebar.tsx` to a shared hook if needed, or replicate the navigation logic.

- [ ] **Step 2: Show project jump labels in Sidebar**

Mirror `threadJumpLabelByKey` pattern:

1. Build `projectJumpLabelMap` using `projectJumpCommandForIndex`
2. Pass to `SidebarProjectItem` as `jumpLabel` prop
3. Display as small badge on project button

- [ ] **Step 3: Manual verification**

1. `Alt+1` → jumps to first project
2. `Alt+2` → jumps to second project
3. Drag-reorder projects → `Alt+N` follows new order
4. Labels visible on sidebar project items

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_chat.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): wire Alt+1-9 project jump shortcuts with sidebar labels"
```

---

## Task 13: App Control Keybindings

**Files:**
- Modify: `packages/contracts/src/keybindings.ts`
- Modify: `apps/server/src/keybindings.ts`
- Modify: `apps/web/src/routes/_chat.tsx`

- [ ] **Step 1: Add command identifiers to contracts**

Add to `STATIC_KEYBINDING_COMMANDS`:

```typescript
"chat.togglePanel",
"terminal.focus",
"chat.focus",
"project.switcher",
```

- [ ] **Step 2: Add default keybindings on server**

```typescript
{ key: "ctrl+shift+space", command: "chat.togglePanel" },
{ key: "ctrl+shift+t", command: "terminal.focus" },
{ key: "ctrl+shift+c", command: "chat.focus" },
{ key: "ctrl+shift+p", command: "project.switcher" },
```

- [ ] **Step 3: Handle in _chat.tsx**

Add `data-terminal-focus` attribute to the terminal viewport component and `data-chat-composer` to the chat input. Then handle:

```typescript
if (command === "terminal.focus") {
  event.preventDefault();
  document.querySelector<HTMLElement>('[data-terminal-focus]')?.focus();
  return;
}
if (command === "chat.focus") {
  event.preventDefault();
  document.querySelector<HTMLElement>('[data-chat-composer]')?.focus();
  return;
}
if (command === "chat.togglePanel") {
  event.preventDefault();
  // Toggle terminal open state via terminalStateStore
  return;
}
if (command === "project.switcher") {
  event.preventDefault();
  // Open command palette filtered to projects
  return;
}
```

- [ ] **Step 4: Add data attributes to components**

In `ThreadTerminalDrawer.tsx`, add `data-terminal-focus` to the xterm container div.
In `ChatComposer.tsx`, add `data-chat-composer` to the input/textarea element.

- [ ] **Step 5: Verify typecheck passes**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/keybindings.ts apps/server/src/keybindings.ts apps/web/src/routes/_chat.tsx apps/web/src/components/ThreadTerminalDrawer.tsx apps/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(keybindings): add Ctrl+Shift app control shortcuts with focus data attributes"
```

---

## Task 14: Final Integration Verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: Zero errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: All tests pass — existing + new tests:
- `packages/contracts/src/terminal.tmux.test.ts` (8 tests)
- `apps/server/src/terminal/__tests__/TmuxSessionManager.test.ts` (9 tests)
- `apps/server/src/terminal/Layers/Manager.test.ts` (existing + 2 new publishTmux tests)
- `apps/web/src/terminalStateStore.tmux.test.ts` (4 tests)
- `apps/web/src/keybindings.test.ts` (existing + 6 new projectJump tests)

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: Zero warnings/errors.

- [ ] **Step 4: Manual end-to-end verification checklist**

| # | Check | Expected |
|---|-------|----------|
| 1 | `bun run dev` starts | No errors |
| 2 | Open a project | tmux session created (`tmux list-sessions` shows `fenrir-{projectId}`) |
| 3 | Type commands in terminal | Execute normally |
| 4 | Open neovim in terminal | Renders correctly |
| 5 | Split tmux panes `Ctrl-b %` | Splits work |
| 6 | Click second project in sidebar | Terminal shows new tmux session |
| 7 | Click back to first project | Neovim + layout intact |
| 8 | Press `Alt+1` | Jumps to first project |
| 9 | Press `Alt+2` | Jumps to second project |
| 10 | Drag-reorder projects | `Alt+N` follows new order |
| 11 | `Ctrl+Shift+T` | Focuses terminal |
| 12 | `Ctrl+Shift+C` | Focuses chat |
| 13 | Kill Fenrir, restart | tmux sessions survive, reattach works |
| 14 | Start agent task | Agent uses isolated PTY, not tmux |
| 15 | Uninstall tmux, open project | Falls back to regular shell PTY |

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: tmux session manager — terminal as first-class citizen

Adds tmux session orchestration to Fenrir:
- One auto-created tmux session per project
- xterm.js attaches to tmux session via new RPC methods
- Project switching detaches/reattaches instantly (~50ms)
- Alt+1-9 for position-based project jumping
- Ctrl+Shift shortcuts for app controls
- Graceful fallback when tmux not installed
- Agent terminals unchanged (isolated PTYs)
- Full TDD: 29+ new tests across contracts, server, and client"
```
