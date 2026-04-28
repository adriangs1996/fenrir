---
depends_on:
  - 04-server-job-polling-listener-status
  - 05-server-session-listener-association
---

# Plan 07: Server — Hydrate Listeners + Sessions on Connect

## Goal

Bug #5 (second half): when fenrir starts and msfrpcd already has running multi/handler jobs and live sessions (e.g. user was using msfconsole, or a previous fenrir process left listeners running), they're invisible in the UI because the server never queries existing state. Add a `hydrateState` Effect that runs once after authentication completes (inside `ensureStartedRaw`) to:

- Call `job.list`, then `job.info(jobId)` per multi/handler job to reconstruct listener metadata (payload, LHOST, LPORT) → populate `listeners` map with fresh server-generated UUIDs.
- Call `session.list` to populate `knownSessions`, using the `findListenerForSession` helper from plan 05 to associate each pre-existing session with its hydrated listener.
- Emit `listener.created` events for each hydrated listener and `session.opened` events for each hydrated session, so subscribers (web UI) get the full state via the same channel they already handle.
- Be best-effort: hydration RPC failure does NOT fail `ensureStarted`; an empty hydration is acceptable initial state.

## Scope

- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts`:
  - Add `hydrateState` helper (Effect).
  - Call it from `ensureStartedRaw` after auth + version fetch, before fibers start.
  - Ensure listeners/sessions maps are clear at the start of hydration (per Q8e — fresh msfrpcd has fresh state, in-memory state is stale).

## Background — `job.list` shape

`job.list` returns `{ "<jobId>": "<info string>", ... }`. To get datastore (PAYLOAD/LHOST/LPORT), call `job.info(jobId)` which returns:

```
{
  jid: <number>,
  name: "Exploit: multi/handler",
  start_time: <unix>,
  datastore: {
    PAYLOAD: "linux/x86/meterpreter/reverse_tcp",
    LHOST: "0.0.0.0",
    LPORT: 4444,
    ...
  }
}
```

We only hydrate jobs whose `name` starts with `Exploit: multi/handler` — other jobs are active exploits, not our concern.

## Steps

### Step 1. Add `hydrateState` helper

In `apps/server/src/metasploit/Layers/MetasploitService.ts`, insert **after** the helpers (after `emitConnectionChanged` from plan 03 Step 2, before `ensureStartedRaw`):

```typescript
    /**
     * One-shot rehydration of `listeners` and `knownSessions` from msfrpcd's
     * live state. Best-effort: any RPC failure short-circuits silently; an
     * empty rehydration is an acceptable initial state.
     *
     * Must be called with `rpcClient` set (i.e. inside `ensureStartedRaw`
     * after authentication succeeds, before polling fibers start).
     */
    const hydrateState = (client: MsfrpcClient) =>
      Effect.gen(function* () {
        // Wipe stale in-memory state — fresh msfrpcd has fresh truth.
        listeners.clear();
        knownSessions.clear();
        listenerMissCount.clear();

        // ── Hydrate listeners from job.list + job.info ──────────────
        const jobsResult = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (jobsResult && typeof jobsResult === "object") {
          for (const [jobIdRaw, infoRaw] of Object.entries(jobsResult as Record<string, unknown>)) {
            const jobId = String(jobIdRaw);
            const infoString = typeof infoRaw === "string" ? infoRaw : "";
            if (!infoString.includes("multi/handler")) continue;

            // Per-job structured info call.
            const detail = yield* Effect.tryPromise({
              try: () => client.call("job.info", [jobId]),
              catch: () => null,
            }).pipe(Effect.orElseSucceed(() => null));

            if (!detail || typeof detail !== "object") continue;

            const datastore = (detail as { datastore?: Record<string, unknown> }).datastore ?? {};
            const payload = String(datastore.PAYLOAD ?? "");
            const lhost = String(datastore.LHOST ?? "0.0.0.0");
            const lportRaw = datastore.LPORT;
            const lport = typeof lportRaw === "number"
              ? lportRaw
              : typeof lportRaw === "string"
                ? Number.parseInt(lportRaw, 10)
                : NaN;

            if (!payload || !Number.isFinite(lport)) continue;

            const listenerId = crypto.randomUUID();
            const snapshot: ListenerSnapshot = {
              listenerId,
              name: `hydrated:${payload}@${lhost}:${lport}`,
              payload: payload as ListenerSnapshot["payload"],
              lhost,
              lport,
              status: "active", // job exists, so active by definition
              jobId,
              createdAt: new Date().toISOString(),
            };

            listeners.set(listenerId, { snapshot, jobId });
            emitEvent({
              type: "listener.created",
              snapshot,
              createdAt: new Date().toISOString(),
            });
          }
        }

        // ── Hydrate sessions from session.list ──────────────────────
        const sessionsResult = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (sessionsResult && typeof sessionsResult === "object") {
          for (const [sessionId, sessionData] of Object.entries(
            sessionsResult as Record<string, any>,
          )) {
            const matchedListenerId = findListenerForSession(
              sessionData as { via_exploit?: unknown; tunnel_local?: unknown },
              listeners,
            );

            const snapshot: MsfSessionSnapshot = {
              sessionId,
              type: (sessionData as any).type === "meterpreter" ? "meterpreter" : "shell",
              info: String((sessionData as any).info ?? ""),
              targetHost: String((sessionData as any).session_host ?? "unknown"),
              platform: String((sessionData as any).platform ?? "unknown"),
              via: String((sessionData as any).via_exploit ?? ""),
              listenerId: matchedListenerId,
              openedAt: new Date().toISOString(),
            };

            knownSessions.set(sessionId, snapshot);
            emitEvent({
              type: "session.opened",
              snapshot,
              createdAt: new Date().toISOString(),
            });
          }
        }
      });
```

> ⚠️ The `payload as ListenerSnapshot["payload"]` cast is intentional: hydration accepts any payload string from msfrpcd, even if it's not in our `PayloadType` literal union. The snapshot schema validates only at the contract boundary (web RPC calls); in-memory we accept the runtime value. If TypeScript complains, change `payload` field on `ListenerSnapshot` to `Schema.String.check(...)` in plan 01 instead — but that's a contract change with broader impact, so prefer the cast.

### Step 2. Call `hydrateState` from `ensureStartedRaw`

In `ensureStartedRaw` (plan 03 Step 3), after the `core.version` fetch and AFTER `rpcClient = client; cachedClient = client; pollFailureCount = 0;`, but BEFORE `startSessionPolling()` and `startJobPolling()`, insert:

```typescript
      // Hydrate from msfrpcd live state (best-effort).
      yield* hydrateState(client).pipe(Effect.orElseSucceed(() => undefined));
```

> ⚠️ Hydrate BEFORE starting polling fibers. Otherwise the first `session.list` poll tick would trigger `session.opened` events for state hydrate is also about to emit → duplicate emissions (store dedups via upsert, but extra events waste bandwidth).

> ⚠️ Hydrate AFTER setting `rpcClient = client` because `ensureConnected()` (used internally) checks `rpcClient !== null`. Polling fibers haven't started yet, so no race.

### Step 3. Confirm map-clear contract

`hydrateState` clears the maps unconditionally at its top. This is correct for both scenarios:
- First connect: maps already empty, clear is a no-op.
- Reconnect (after disconnect): maps may still hold stale entries even after the `proc.onExit` hook cleared them (race with poller). Hydration's clear is the authoritative reset.

Verify in plan 03's `proc.onExit` hook that `listeners.clear()` and `knownSessions.clear()` are present. They are (per plan 03 Step 3) — leave them. Defense-in-depth.

## Validation

```bash
bun typecheck
bun lint
bun fmt
bun run test apps/server/src/server.test.ts
```

Grep checks:

```bash
grep -n "hydrateState" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 declaration + 1 call from ensureStartedRaw.

grep -n "job.info" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 RPC call inside hydrateState.

grep -n "multi/handler" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 filter inside hydrateState.
```

## Done Criteria

- [ ] `hydrateState` defined as an Effect taking the authenticated client.
- [ ] Hydration clears `listeners`/`knownSessions`/`listenerMissCount` at the top.
- [ ] Hydration calls `job.list`, filters multi/handler jobs, calls `job.info` per job, builds `ListenerSnapshot` with fresh UUID, status=`"active"`, populated jobId.
- [ ] Hydrated listeners emit `listener.created` events.
- [ ] Hydration calls `session.list`, runs `findListenerForSession` for each session, emits `session.opened` events.
- [ ] Hydration is best-effort: each RPC call wrapped in `Effect.orElseSucceed(() => null)`.
- [ ] `ensureStartedRaw` calls `hydrateState` AFTER auth + version fetch, BEFORE starting poll fibers.
- [ ] `bun typecheck` clean; `bun run test` green.
