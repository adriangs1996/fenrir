---
depends_on:
  - 01-contracts
  - 03-server-ensure-started-cached-and-auto-start
---

# Plan 04: Server — Job Polling + Listener Status FSM

## Goal

Listener stays stuck on `waiting` forever because nothing polls msfrpcd's `job.list` to verify the multi/handler job is running. Add a separate poll fiber (alongside the session poll) that:

- Polls `job.list` every 2 seconds.
- Flips listener status: `waiting → active` (job appears) and `active → stopped` (job missing for 2 consecutive polls — debounce against transient blips).
- Emits `listener.updated` events on status transitions only (not every poll tick).
- Survives the disconnect path: stops cleanly when the session poll detects sustained RPC failures.

## Scope

- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts` — add `startJobPolling`, `stopJobPolling`, integrate into `ensureStartedRaw` + `stop()` lifecycle. Update polling teardown.

## Background

Existing state types (already declared, no change needed):

```typescript
interface ListenerState {
  snapshot: ListenerSnapshot;
  jobId: string | null;
}

const listeners = new Map<string, ListenerState>();
```

Existing `LISTENER_STATUS` (in `packages/contracts/src/metasploit.ts`): `"starting" | "waiting" | "active" | "stopped" | "error"`.

FSM driven by job-poll:

```
waiting → (job appears) → active
active  → (job missing, 1st miss) → active (no transition; debounce)
active  → (job missing, 2nd consecutive miss) → stopped
stopped → (job reappears, e.g. user restarted job from msfconsole) → active
```

`error` is set only at create time (existing behavior, untouched).
`starting` exits to `waiting` on create-RPC ack (existing behavior, untouched).

## Steps

### Step 1. Add module-scope state for job polling

In `apps/server/src/metasploit/Layers/MetasploitService.ts`, near the existing internal state (around L96–101), add:

```typescript
    let jobPollingFiber: { interrupt: () => void } | null = null;
    /** Per-listener consecutive-miss counter for debounce. */
    const listenerMissCount = new Map<string, number>();
    const JOB_POLL_INTERVAL = "2 seconds";
    const JOB_MISS_THRESHOLD = 2;
```

### Step 2. Add `startJobPolling` and `stopJobPolling`

Insert **after** `stopSessionPolling` (around L234), before the `return { ... } satisfies MetasploitServiceShape`:

```typescript
    const startJobPolling = () => {
      if (jobPollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = ensureConnected();
        const result = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        });

        if (result == null) return; // RPC failure — session poll handles disconnect.
        if (typeof result !== "object") return;

        // job.list returns: { "<jobId>": "<info string>", ... }
        const activeJobIds = new Set<string>(Object.keys(result as Record<string, unknown>));

        for (const [listenerId, state] of listeners) {
          if (!state.jobId) continue;

          const isActive = activeJobIds.has(state.jobId);
          const prevStatus = state.snapshot.status;
          let nextStatus: typeof prevStatus = prevStatus;

          if (isActive) {
            listenerMissCount.delete(listenerId);
            if (prevStatus === "waiting" || prevStatus === "stopped") {
              nextStatus = "active";
            }
          } else {
            // Job missing — debounce.
            if (prevStatus === "active") {
              const misses = (listenerMissCount.get(listenerId) ?? 0) + 1;
              if (misses >= JOB_MISS_THRESHOLD) {
                nextStatus = "stopped";
                listenerMissCount.delete(listenerId);
              } else {
                listenerMissCount.set(listenerId, misses);
              }
            } else if (prevStatus === "waiting") {
              // Listener never went active — leave as waiting unless user explicitly stops.
              // (Don't auto-flip to stopped from waiting — that path is the explicit `stopListener` RPC.)
            }
          }

          if (nextStatus !== prevStatus) {
            const updatedSnapshot: ListenerSnapshot = { ...state.snapshot, status: nextStatus };
            listeners.set(listenerId, { ...state, snapshot: updatedSnapshot });
            emitEvent({
              type: "listener.updated",
              snapshot: updatedSnapshot,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }).pipe(Effect.orElseSucceed(() => undefined));

      const fiber = runFork(pollEffect.pipe(Effect.repeat(Schedule.spaced(JOB_POLL_INTERVAL))));
      jobPollingFiber = {
        interrupt: () => runFork(Fiber.interrupt(fiber)),
      };
    };

    const stopJobPolling = () => {
      if (jobPollingFiber) {
        jobPollingFiber.interrupt();
        jobPollingFiber = null;
      }
      listenerMissCount.clear();
    };
```

> ⚠️ The `prevStatus === "waiting"` branch when job is missing intentionally does NOTHING — a never-yet-active listener stays `waiting`. Otherwise the FSM would race against listener creation (job hasn't been registered with msfrpcd yet on the first poll tick).

### Step 3. Wire start/stop into the lifecycle

In `ensureStartedRaw` (the body added in plan 03 Step 3), find the line `startSessionPolling();` near the end and add **immediately after**:

```typescript
      startJobPolling();
```

In the `stop()` method (around L260–282 in plan 03's updated version), add **after** `stopSessionPolling();`:

```typescript
          stopJobPolling();
```

In the disconnect branches (plan 03 Step 6 — `pollFailureCount >= POLL_FAILURE_THRESHOLD` path AND the `proc.onExit` handler), ensure `stopJobPolling();` is called.

In `proc.onExit` (plan 03 Step 3 raw start body), add `stopJobPolling();` BEFORE `stopSessionPolling();`. The disconnect path becomes:

```typescript
      proc.onExit(() => {
        rpcClient?.dispose();
        rpcClient = null;
        cachedClient = null;
        msfrpcdProcess = null;
        msfVersion = null;
        stopJobPolling();      // NEW
        stopSessionPolling();  // existing implicit; if not called, the next tick will throw on null client
        emitConnectionChanged(false);
        listeners.clear();
        knownSessions.clear();
      });
```

In the `pollFailureCount >= POLL_FAILURE_THRESHOLD` branch (inside `startSessionPolling` body, plan 03 Step 6), also call `stopJobPolling();` alongside `stopSessionPolling();`.

> ⚠️ Order matters: stop polling BEFORE clearing maps. Otherwise an in-flight tick may emit events for cleared listeners.

## Validation

```bash
bun typecheck
bun lint
bun fmt
bun run test apps/server/src/server.test.ts
```

Grep checks:

```bash
grep -n "startJobPolling\|stopJobPolling\|jobPollingFiber\|listenerMissCount" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: state declarations + helper definitions + at least 3 invocations (start in ensureStartedRaw, stop in stop(), stop in disconnect branches).

grep -n "listener.updated" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 emit site inside startJobPolling.

grep -c "JOB_POLL_INTERVAL\|JOB_MISS_THRESHOLD" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: at least 2 each (declaration + use).
```

## Done Criteria

- [ ] `startJobPolling` polls `job.list` every 2s on a separate fiber from session polling.
- [ ] FSM transitions: `waiting → active` on first sighting; `active → stopped` after 2 consecutive misses; `stopped → active` if job reappears; `waiting` stays `waiting` while job missing (no premature flip to stopped).
- [ ] `listener.updated` emitted ONLY on status transition (`nextStatus !== prevStatus`), not every poll.
- [ ] `listenerMissCount` tracks per-listener consecutive misses; cleared on hit, on transition, and on `stop()`.
- [ ] `startJobPolling` invoked from `ensureStartedRaw` after `startSessionPolling()`.
- [ ] `stopJobPolling` invoked from `stop()`, `proc.onExit`, and the poll-failure disconnect branch.
- [ ] `bun typecheck` clean; `bun run test` green.
