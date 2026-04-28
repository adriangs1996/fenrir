---
depends_on:
  - 01-contracts
---

# Plan 03: Server — Cached `ensureStarted` + Auto-Start on `status()`/`subscribe`

## Goal

Fix three coupled bugs in one place because they all hinge on `ensureStarted`:

1. **Concurrency race** — `ensureStarted` short-circuits on `if (rpcClient)` but two concurrent callers during the 3s spawn-sleep both spawn msfrpcd. Wrap in a custom single-flight that caches success but allows retry on failure.
2. **`status()` doesn't auto-connect** — pre-existing listeners/sessions invisible because the UI never triggers a connection. Fix: `status()` yields `ensureStarted` (best-effort: swallow `MetasploitNotFoundError`).
3. **Subscribe doesn't auto-connect** — same root cause for the event subscription path. Fix: `subscribeMetasploitEvents` triggers `ensureStarted` before subscribing.
4. **`connected` only set once** — emit `connection.changed` events on transitions (false→true or true→false), plus a one-shot seed on every new subscribe so newly-connected clients learn current state.
5. **Disconnect detection** — RPC poll-failure threshold (3 consecutive failures) AND `msfrpcdProcess.onExit` flip `connected=false`, null `rpcClient`, invalidate the cached client.

## Scope

- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts`:
  - Replace `ensureStarted` with single-flight + success-only cache.
  - Update `status()` to auto-start (best-effort).
  - Update `subscribe()` to auto-start + seed `connection.changed`.
  - Add `lastEmittedConnected` tracking + `emitConnectionChanged` helper.
  - Add disconnect-detection in `startSessionPolling` failure branch.
  - Hook `msfrpcdProcess.onExit` → mark disconnected.
  - Fetch `core.version` after authenticate, store in service-scoped `msfVersion`.

## Steps

### Step 1. Add module-scope state for connection tracking

Inside the `Layer.effect` body, near the existing internal state (around L96–101), add:

```typescript
    let msfVersion: string | null = null;
    let lastEmittedConnected: boolean | null = null;
    let pollFailureCount = 0;
    let cachedClient: MsfrpcClient | null = null;
    let inFlightStart: Effect.Effect<MsfrpcClient, MetasploitNotFoundError | MetasploitConnectionError> | null = null;
    const POLL_FAILURE_THRESHOLD = 3;
```

> ⚠️ `cachedClient` mirrors `rpcClient` for clarity. The custom suspend below uses `cachedClient` to decide if a new spawn is needed; `rpcClient` is the live reference used by other methods (`ensureConnected`).

### Step 2. Add `emitConnectionChanged` helper

Insert after `emitEvent` (around L111):

```typescript
    /** Emit `connection.changed` only on transitions. */
    const emitConnectionChanged = (connected: boolean) => {
      if (lastEmittedConnected === connected) return;
      lastEmittedConnected = connected;
      emitEvent({
        type: "connection.changed",
        connected,
        version: connected ? (msfVersion ?? undefined) : undefined,
        createdAt: new Date().toISOString(),
      });
    };
```

### Step 3. Replace `ensureStarted` with single-flight + success-only cache

Delete the existing `const ensureStarted = Effect.gen(function* () { ... });` block (L122–169).

Replace with:

```typescript
    /** Raw start: spawn msfrpcd, authenticate, fetch version. NOT cached. */
    const ensureStartedRaw = Effect.gen(function* () {
      // Spawn msfrpcd
      const proc = yield* ptyAdapter
        .spawn({
          shell: "msfrpcd",
          args: ["-P", MSFRPC_PASSWORD, "-S", "-a", MSFRPC_HOST, "-p", String(MSFRPC_PORT)],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: process.env as NodeJS.ProcessEnv,
        })
        .pipe(
          Effect.mapError((err) => {
            if (err.message.includes("ENOENT") || err.message.includes("not found")) {
              return MetasploitNotFoundError.default();
            }
            return new MetasploitConnectionError({
              message: `Failed to spawn msfrpcd: ${err.message}`,
              cause: err,
            });
          }),
        );

      msfrpcdProcess = proc;

      // Hook process exit → mark disconnected.
      proc.onExit(() => {
        rpcClient?.dispose();
        rpcClient = null;
        cachedClient = null;
        msfrpcdProcess = null;
        msfVersion = null;
        emitConnectionChanged(false);
        // Clear in-memory listener/session maps — fresh msfrpcd will have fresh state.
        listeners.clear();
        knownSessions.clear();
      });

      yield* Effect.sleep("3 seconds");

      const client = createMsfrpcClient(MSFRPC_HOST, MSFRPC_PORT, MSFRPC_PASSWORD);

      yield* Effect.retry(
        Effect.tryPromise({
          try: () => client.authenticate(),
          catch: (error) =>
            new MetasploitConnectionError({
              message: `MSFRPC authentication failed: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        }),
        Schedule.recurs(5).pipe(Schedule.addDelay(() => Effect.succeed(Duration.seconds(2)))),
      );

      // Best-effort: fetch core.version.
      const versionResult = yield* Effect.tryPromise({
        try: () => client.call("core.version"),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      if (versionResult && typeof versionResult === "object") {
        msfVersion = String((versionResult as { version?: unknown }).version ?? "unknown");
      }

      rpcClient = client;
      cachedClient = client;
      pollFailureCount = 0;
      startSessionPolling();
      emitConnectionChanged(true);
      return client;
    });

    /**
     * Single-flight wrapper: concurrent callers share one in-flight Effect.
     * Caches success forever (until disconnect invalidates `cachedClient`).
     * On failure, the cached entry is cleared so the next caller retries.
     */
    const ensureStarted = Effect.suspend(() => {
      if (cachedClient) return Effect.succeed(cachedClient);
      if (inFlightStart) return inFlightStart;
      inFlightStart = ensureStartedRaw.pipe(
        Effect.tap((client) =>
          Effect.sync(() => {
            cachedClient = client;
          }),
        ),
        Effect.tapErrorCause(() =>
          Effect.sync(() => {
            cachedClient = null;
            inFlightStart = null;
            emitConnectionChanged(false);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            inFlightStart = null;
          }),
        ),
      );
      return inFlightStart;
    });
```

### Step 4. Update `status()` to auto-start (best-effort)

Replace the existing `status: () => Effect.try({...})` block (around L284–300) with:

```typescript
      status: () =>
        Effect.gen(function* () {
          // Auto-start: best-effort, swallow not-found / connection errors so status
          // can be queried even when msfrpcd is unavailable (UI shows "Disconnected").
          yield* ensureStarted.pipe(Effect.orElseSucceed(() => null));

          const snapshot: MetasploitStatusSnapshot = {
            connected: rpcClient !== null,
            version: msfVersion,
            listenersCount: listeners.size,
            sessionsCount: knownSessions.size,
          };
          return snapshot;
        }),
```

### Step 5. Update `subscribe()` to auto-start + seed event

Replace the existing `subscribe: (listener) => Effect.sync(() => {...})` block (around L568–574) with:

```typescript
      subscribe: (listener: (event: MetasploitEvent) => void) =>
        Effect.gen(function* () {
          // Auto-start (best-effort) so subscribers see live data even on first connect.
          yield* ensureStarted.pipe(Effect.orElseSucceed(() => null));

          eventSubscribers.add(listener);

          // Seed: deliver current connection state to the new subscriber as a one-shot.
          // Bypasses transitions-only filter for this subscriber only.
          try {
            listener({
              type: "connection.changed",
              connected: rpcClient !== null,
              version: msfVersion ?? undefined,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // Ignore subscriber errors during seed.
          }

          return () => {
            eventSubscribers.delete(listener);
          };
        }),
```

### Step 6. Add disconnect detection in `startSessionPolling`

Find the existing poll body (around L171–227). Replace the `result == null` short-circuit and the catch fall-through with a counter:

In the poll Effect body, replace:

```typescript
        if (result == null) return; // Polling failure — retry next interval
```

with:

```typescript
        if (result == null) {
          pollFailureCount += 1;
          if (pollFailureCount >= POLL_FAILURE_THRESHOLD) {
            // Sustained RPC failure → declare disconnected.
            rpcClient?.dispose();
            rpcClient = null;
            cachedClient = null;
            msfVersion = null;
            emitConnectionChanged(false);
            stopSessionPolling();
            listeners.clear();
            knownSessions.clear();
          }
          return;
        }
        pollFailureCount = 0; // reset on success
```

### Step 7. Update the `start()` method on the Service

The existing `start: () => Effect.asVoid(ensureStarted)` (around L258) keeps working — `ensureStarted` is now the cached version. No change needed, but verify the line still compiles after Step 3.

### Step 8. Update `stop()` to clear new state

Find the `stop: () => Effect.sync(() => {...})` block (around L260–282). Add to the body, after `listeners.clear(); knownSessions.clear();`:

```typescript
          msfVersion = null;
          cachedClient = null;
          inFlightStart = null;
          lastEmittedConnected = null;
          pollFailureCount = 0;
          emitConnectionChanged(false);
```

> ⚠️ Place `emitConnectionChanged(false)` AFTER `lastEmittedConnected = null` so the transition is recognized (null → false emits).

## Validation

```bash
bun typecheck
bun lint
bun fmt
bun run test apps/server/src/server.test.ts
```

Grep checks:

```bash
grep -n "Effect.cached" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: ZERO matches (we use custom suspend, not Effect.cached, to avoid caching failures).

grep -n "ensureStartedRaw\|inFlightStart\|cachedClient\|lastEmittedConnected\|pollFailureCount" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: declarations + usages of each.

grep -n "emitConnectionChanged" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 helper definition + at least 4 call sites (raw start success, proc.onExit, poll-fail, stop).
```

## Done Criteria

- [ ] `cachedClient`, `inFlightStart`, `lastEmittedConnected`, `pollFailureCount`, `msfVersion` declared at Layer scope.
- [ ] `ensureStartedRaw` performs spawn + auth + version fetch. `ensureStarted` wraps it with success-only single-flight.
- [ ] Concurrent callers of `ensureStarted` share a single in-flight Effect (no double-spawn).
- [ ] On failure, `cachedClient` cleared; next caller re-attempts.
- [ ] `proc.onExit` clears `rpcClient`/`cachedClient`/`msfrpcdProcess`, emits `connection.changed { connected: false }`, clears listeners/sessions.
- [ ] `status()` calls `ensureStarted` (best-effort) before returning snapshot.
- [ ] `subscribe()` calls `ensureStarted` (best-effort), then seeds the new subscriber with a one-shot `connection.changed` event reflecting current state.
- [ ] `emitConnectionChanged` is transitions-only (compares against `lastEmittedConnected`).
- [ ] `startSessionPolling` increments `pollFailureCount` on RPC failure; flips to disconnected after 3 consecutive misses.
- [ ] `stop()` clears all new state and emits `connection.changed { connected: false }`.
- [ ] `bun typecheck` clean. Existing `server.test.ts` still green.
