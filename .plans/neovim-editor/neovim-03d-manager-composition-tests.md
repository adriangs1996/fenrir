---
depends_on:
  - neovim-03c-manager-ui-input
---

# Plan 03d: NeovimManager Layer Composition + Tests

## Goal

Wire `NeovimManagerLive` into the server's layer graph and add an integration test suite (skipped if nvim missing).

## Scope

- Modify: `apps/server/src/server.ts` (add NeovimLayerLive)
- New file: `apps/server/src/neovim/__tests__/NeovimManager.test.ts`

## Steps

### Step 1. Layer composition

Open `apps/server/src/server.ts`. Locate the existing terminal layer composition (`TerminalLayerLive` or equivalent). Add:

```typescript
import { NeovimManagerLive } from "./neovim/Layers/NeovimManager";
import { MsgpackRpcFactoryLive } from "./neovim/Layers/MsgpackRpc";

const NeovimLayerLive = NeovimManagerLive.pipe(
  Layer.provide(MsgpackRpcFactoryLive),
);
```

Append `NeovimLayerLive` to the main `Layer.mergeAll(...)` (or pipeline) where `TerminalLayerLive` is currently merged. Match the existing style in the file.

### Step 2. Tests file scaffold

Create `apps/server/src/neovim/__tests__/NeovimManager.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NeovimManager } from "../Services/NeovimManager";
import { NeovimManagerLive } from "../Layers/NeovimManager";
import { MsgpackRpcFactoryLive } from "../Layers/MsgpackRpc";

const nvimAvailable = (() => {
  try {
    execFileSync("which", ["nvim"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const TestLayer = NeovimManagerLive.pipe(Layer.provide(MsgpackRpcFactoryLive));

const describeWithNvim = nvimAvailable ? describe : describe.skip;

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "fenrir-nvim-test-"));
}
```

### Step 3. Test cases

Implement these (use `Effect.runPromise` with `TestLayer`):

```typescript
describeWithNvim("NeovimManager", () => {
  it("spawn: creates session with running status and pid", async () => {
    const cwd = tmpProject();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const mgr = yield* NeovimManager;
        const snap = yield* mgr.spawn("test-spawn", cwd);
        yield* mgr.kill("test-spawn");
        return snap;
      }).pipe(Effect.scoped, Effect.provide(TestLayer)),
    );
    expect(result.status).toBe("running");
    expect(result.pid).toBeGreaterThan(0);
  });

  it("spawn idempotent: second spawn returns same pid", async () => { /* ... */ });

  it("spawn rejects bad cwd with NeovimCwdError", async () => { /* ... */ });

  it("attachUi succeeds after spawn", async () => { /* ... */ });

  it("attachUi without spawn returns NeovimSessionLookupError", async () => { /* ... */ });

  it("attachUi twice returns NeovimAttachError", async () => { /* ... */ });

  it("input: sends keys without error", async () => { /* ... */ });

  it("command: checktime succeeds", async () => { /* ... */ });

  it("resize: changes grid dimensions without error", async () => { /* ... */ });

  it("kill: subsequent operations fail with lookup error", async () => { /* ... */ });

  it("crash: SIGKILL publishes crashed event", async () => {
    // spawn, subscribe, send SIGKILL via process.kill, await event
  });

  it("detach + reattach: process persists", async () => { /* ... */ });
});
```

### Step 4. Each test must

- Use a fresh `projectId` (e.g., `crypto.randomUUID()`).
- Always call `mgr.kill(projectId)` in cleanup (or use `Effect.scoped` with finalizer).
- Use `Effect.either` to inspect failures, e.g.:

```typescript
const result = await Effect.runPromise(
  Effect.either(mgr.spawn("p1", "/nonexistent")).pipe(Effect.provide(TestLayer)),
);
expect(result._tag).toBe("Left");
if (result._tag === "Left") {
  expect(result.left._tag).toBe("NeovimCwdError");
}
```

### Step 5. Manual smoke

Run a manual end-to-end check after tests:
1. Spawn nvim
2. Attach UI 80x24
3. Send `ihello<Esc>`
4. Call `nvim_get_current_line` via `command` extension or RPC fixture
5. Expect `"hello"`

## Validation

- `bun typecheck`
- `bun run test apps/server/src/neovim/__tests__/NeovimManager.test.ts`
- All 12 test cases pass when nvim installed; suite skips cleanly otherwise

## Done Criteria

- `NeovimLayerLive` registered in server layer composition
- Test suite compiles and runs
- Tests skip gracefully when nvim unavailable
- Crash event published correctly on SIGKILL
- Cleanup: zero leaked nvim processes after test run (`pgrep nvim` shows none)
