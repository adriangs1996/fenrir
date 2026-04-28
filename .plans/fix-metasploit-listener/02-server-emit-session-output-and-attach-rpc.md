---
depends_on:
  - 01-contracts
---

# Plan 02: Server — `emitSessionOutput` + Attach/Detach RPC Handlers

## Goal

Wire shell I/O end-to-end. Currently `MetasploitShellAdapter.attach()` is orphaned: never called, so `terminal.onData` in the web shell tab does nothing and `session.output` is never emitted. Fix by:

1. Extending `MetasploitServiceShape` with an internal `emitSessionOutput(sessionId, data)` method.
2. Adding `metasploitSessionAttach` / `metasploitSessionDetach` RPC handlers in `ws.ts` that wire `adapter.onData → service.emitSessionOutput → emitEvent("session.output")`.
3. Making attach idempotent (Q10 decision).
4. Updating `server.test.ts` mock so existing tests still typecheck.

## Scope

- Modify: `apps/server/src/metasploit/Services/MetasploitService.ts` — extend `MetasploitServiceShape`.
- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts` — implement `emitSessionOutput`.
- Modify: `apps/server/src/ws.ts` — add two RPC handlers, wire output bridging.
- Modify: `apps/server/src/server.test.ts` — extend the `MetasploitService` mock with stub `emitSessionOutput`.

## Steps

### Step 1. Extend the Service contract

In `apps/server/src/metasploit/Services/MetasploitService.ts`, add this method to `MetasploitServiceShape` (insert before the closing brace, after `subscribe`):

```typescript
  /**
   * @internal
   * Emit a `session.output` event on the internal PubSub.
   * Called only by the ws layer to bridge `MetasploitShellAdapter.onData`
   * callbacks into the event stream that web clients subscribe to.
   */
  readonly emitSessionOutput: (sessionId: string, data: string) => Effect.Effect<void>;
```

### Step 2. Implement `emitSessionOutput` in the Layer

In `apps/server/src/metasploit/Layers/MetasploitService.ts`, inside the returned object (after `subscribe`, before the closing `} satisfies MetasploitServiceShape;`), add:

```typescript
      emitSessionOutput: (sessionId, data) =>
        Effect.sync(() => {
          emitEvent({
            type: "session.output",
            sessionId,
            data,
            createdAt: new Date().toISOString(),
          });
        }),
```

### Step 3. Add `metasploitSessionAttach` + `metasploitSessionDetach` RPC handlers

In `apps/server/src/ws.ts`, locate the metasploit handler block (around L1192–1204) and insert these new handlers **after** `metasploitSessionClose` and **before** `subscribeMetasploitEvents` (around L1205):

```typescript
        [WS_METHODS.metasploitSessionAttach]: (input) =>
          observeRpcEffect(
            WS_METHODS.metasploitSessionAttach,
            Effect.gen(function* () {
              // Idempotent: if already attached, return existing handle.
              if (activeMsfShellProcesses.has(input.sessionId)) {
                return { sessionId: input.sessionId, attached: true };
              }

              const proc = yield* metasploitShellAdapter.attach(input.sessionId);

              // Bridge adapter.onData → service.emitSessionOutput → PubSub.
              proc.onData((data) => {
                Effect.runFork(metasploitService.emitSessionOutput(input.sessionId, data));
              });

              // Auto-cleanup on adapter exit (session closed in MSF).
              proc.onExit(() => {
                activeMsfShellProcesses.delete(input.sessionId);
              });

              activeMsfShellProcesses.set(input.sessionId, proc);
              return { sessionId: input.sessionId, attached: true };
            }),
            { "rpc.aggregate": "metasploit" },
          ),

        [WS_METHODS.metasploitSessionDetach]: (input) =>
          observeRpcEffect(
            WS_METHODS.metasploitSessionDetach,
            Effect.sync(() => {
              const proc = activeMsfShellProcesses.get(input.sessionId);
              if (proc) {
                proc.close(); // Stops the polling loop, removes callbacks.
                activeMsfShellProcesses.delete(input.sessionId);
              }
              // No-op if not attached. Doesn't kill the underlying MSF session.
            }),
            { "rpc.aggregate": "metasploit" },
          ),
```

> ⚠️ Detach intentionally does NOT call `metasploitService.sessionClose()` — only the bookkeeping/poller is torn down. The underlying msfrpcd session stays alive so a later browser session can re-attach.

### Step 4. Update `server.test.ts` mock

In `apps/server/src/server.test.ts`, find the `Layer.mock(MetasploitService)({...})` block (around L442–462) and add `emitSessionOutput` to the mock object **after** `subscribe`:

```typescript
          subscribe: () => Effect.succeed(() => {}),
          emitSessionOutput: () => Effect.void,
```

## Validation

```bash
bun typecheck
bun lint
bun fmt
```

Grep checks:

```bash
grep -n "metasploitSessionAttach\|metasploitSessionDetach" apps/server/src/ws.ts
# Expect: 2 handler blocks, each referenced via WS_METHODS.

grep -n "emitSessionOutput" apps/server/src/metasploit/Layers/MetasploitService.ts apps/server/src/metasploit/Services/MetasploitService.ts apps/server/src/server.test.ts
# Expect: 1 declaration in Services/, 1 impl in Layers/, 1 mock entry in server.test.ts, plus 1 invocation site in ws.ts.

grep -n "activeMsfShellProcesses" apps/server/src/ws.ts
# Expect: existing usages PLUS new set/delete in attach/detach handlers.
```

Manual sanity (no msfrpcd needed):

1. `bun run test apps/server/src/server.test.ts` — must still pass.
2. Start dev server (`bun --filter @fenrir/server dev`); open hack workspace; assert WS RPC schema accepts `metasploit.sessionAttach` / `metasploit.sessionDetach` without erroring on the protocol layer (server log should not show `Unknown method`).

## Done Criteria

- [ ] `MetasploitServiceShape.emitSessionOutput` declared with `@internal` JSDoc.
- [ ] Layer impl emits `session.output` event with correct `sessionId`/`data`/`createdAt`.
- [ ] `metasploitSessionAttach` handler is idempotent (returns `{ attached: true }` immediately if already present in `activeMsfShellProcesses`).
- [ ] `metasploitSessionAttach` wires `proc.onData` → `metasploitService.emitSessionOutput` and `proc.onExit` → map cleanup.
- [ ] `metasploitSessionDetach` calls `proc.close()` and deletes from map; no-op if absent.
- [ ] `server.test.ts` mock extended with stub `emitSessionOutput`.
- [ ] `bun typecheck` clean; `bun run test` green.
