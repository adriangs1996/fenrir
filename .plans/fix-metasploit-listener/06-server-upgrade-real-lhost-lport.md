---
depends_on:
  - 01-contracts
---

# Plan 06: Server — Real LHOST/LPORT for `sessionUpgrade`, Old-Session Cleanup, Orphan Reject

## Goal

Fix three bugs in `sessionUpgrade`:

- **Bug #2**: hardcodes `LHOST=127.0.0.1`, `LPORT="0"`, breaking the upgrade because msfrpcd needs a real reverse-handler endpoint to spawn meterpreter.
- **Bug #4**: emits `session.upgraded` for the new id but doesn't tell the store to drop the old shell session id, so UI ends up with two visible sessions.
- **Bug new (Q5b)**: orphan sessions (`listenerId === null`) silently call `session.shell_upgrade` with garbage LHOST/LPORT and quietly fail. Replace with explicit reject + emit `session.closed` so UI removes the unupgradeable orphan.

## Scope

- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts` — replace `sessionUpgrade` body.
- Modify: `apps/server/src/metasploit/Services/MetasploitService.ts` — widen the `sessionUpgrade` error channel.

## Steps

### Step 1. Widen the Service contract's error channel for `sessionUpgrade`

In `apps/server/src/metasploit/Services/MetasploitService.ts`, locate the `sessionUpgrade` declaration in `MetasploitServiceShape` (around L62–64). Update its return type:

```typescript
import type {
  // ... existing imports ...
  MetasploitListenerLookupError,
} from "@fenrir/contracts";

// ...

  /** Upgrade a raw shell session to Meterpreter */
  readonly sessionUpgrade: (
    sessionId: string,
  ) => Effect.Effect<MsfSessionSnapshot, MetasploitSessionError | MetasploitListenerLookupError>;
```

### Step 2. Update Layer imports

In `apps/server/src/metasploit/Layers/MetasploitService.ts`, extend the existing `@fenrir/contracts` import to include `MetasploitListenerLookupError`:

```typescript
import {
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitListenerLookupError, // NEW
  MetasploitNotFoundError,
  MetasploitSessionError,
  type CreateListenerInput,
  type ListenerSnapshot,
  type MetasploitEvent,
  type MetasploitStatusSnapshot,
  type MsfSessionSnapshot,
} from "@fenrir/contracts";
```

### Step 3. Replace the `sessionUpgrade` Layer impl

Find the existing `sessionUpgrade: (sessionId: string) => Effect.gen(...)` block (around L454–538). Replace with:

```typescript
      sessionUpgrade: (sessionId: string) =>
        Effect.gen(function* () {
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          if (session.type === "meterpreter") {
            return session; // Already upgraded.
          }

          // ── Listener lookup — strict (Q5/Q5b) ────────────────────────
          if (!session.listenerId) {
            // Orphan session — can't upgrade. Drop it from UI so the user
            // gets clear feedback (button disappears with the session).
            knownSessions.delete(sessionId);
            emitEvent({
              type: "session.closed",
              sessionId,
              createdAt: new Date().toISOString(),
            });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              message: `Session ${sessionId} has no associated listener; cannot upgrade orphan session.`,
            });
          }

          const listenerState = listeners.get(session.listenerId);
          if (!listenerState) {
            // listenerId set but listener removed (e.g. stopped). Drop session same as orphan.
            knownSessions.delete(sessionId);
            emitEvent({
              type: "session.closed",
              sessionId,
              createdAt: new Date().toISOString(),
            });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              listenerId: session.listenerId,
              message: `Listener ${session.listenerId} for session ${sessionId} not found.`,
            });
          }

          const lhost = listenerState.snapshot.lhost;
          const lport = String(listenerState.snapshot.lport);

          // ── Trigger upgrade ──────────────────────────────────────────
          yield* Effect.tryPromise({
            try: () => client.call("session.shell_upgrade", [sessionId, lhost, lport]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to upgrade session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // ── Wait for upgrade to complete ─────────────────────────────
          yield* Effect.sleep("5 seconds");

          // ── Verify by re-listing sessions ────────────────────────────
          const result = yield* Effect.tryPromise({
            try: () => client.call("session.list"),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to verify upgrade: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // Find the new meterpreter session.
          const sessionsMap = result as Record<string, any> | null;
          if (sessionsMap) {
            for (const [id, data] of Object.entries(sessionsMap)) {
              if (
                (data as any).type === "meterpreter" &&
                (data as any).session_host === session.targetHost
              ) {
                const upgraded: MsfSessionSnapshot = {
                  sessionId: id,
                  type: "meterpreter",
                  info: String((data as any).info ?? ""),
                  targetHost: session.targetHost,
                  platform: String((data as any).platform ?? session.platform),
                  via: String((data as any).via_exploit ?? session.via),
                  listenerId: session.listenerId,
                  openedAt: session.openedAt,
                };
                knownSessions.set(id, upgraded);

                // Emit session.closed for the OLD id BEFORE session.upgraded.
                // Backstop: store also handles previousSessionId on the upgraded event.
                if (id !== sessionId) {
                  knownSessions.delete(sessionId);
                  emitEvent({
                    type: "session.closed",
                    sessionId,
                    createdAt: new Date().toISOString(),
                  });
                }

                emitEvent({
                  type: "session.upgraded",
                  previousSessionId: id !== sessionId ? sessionId : undefined,
                  snapshot: upgraded,
                  createdAt: new Date().toISOString(),
                });

                return upgraded;
              }
            }
          }

          return yield* new MetasploitSessionError({
            sessionId,
            message: "Session upgrade did not produce a meterpreter session",
          });
        }),
```

> ⚠️ Order is critical: emit `session.closed` for the old id FIRST, then `session.upgraded` with `previousSessionId`. The store has both an explicit close handler AND a defensive backstop on `session.upgraded` (plan 10), so either path alone is sufficient — but server emits both for belt-and-suspenders.

### Step 4. Verify imports

Confirm `MetasploitListenerLookupError` is imported in both:
- `apps/server/src/metasploit/Services/MetasploitService.ts` (Step 1 import block)
- `apps/server/src/metasploit/Layers/MetasploitService.ts` (Step 2 import block)

## Validation

```bash
bun typecheck
bun lint
bun fmt
bun run test apps/server/src/server.test.ts
```

Grep checks:

```bash
grep -n "MSFRPC_HOST\|\"127.0.0.1\"" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: ZERO references to MSFRPC_HOST inside the sessionUpgrade body (was the bug).
# MSFRPC_HOST should still appear elsewhere (spawn args, createMsfrpcClient call).

grep -n "session.shell_upgrade" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 call site, with listener-derived lhost/lport (NOT MSFRPC_HOST/"0").

grep -n "MetasploitListenerLookupError" apps/server/src/metasploit/Layers/MetasploitService.ts apps/server/src/metasploit/Services/MetasploitService.ts
# Expect: 2 throw sites in Layer (orphan session, listener gone), 1 type ref in Services.

grep -n "previousSessionId" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 emit site inside session.upgraded event payload.
```

## Done Criteria

- [ ] `sessionUpgrade` looks up listener by `session.listenerId` and uses real `lhost`/`lport` from that listener.
- [ ] Orphan session (no `listenerId`) → `MetasploitListenerLookupError` thrown AND `session.closed` emitted for the orphan id.
- [ ] Vanished listener (id set but listener missing from map) → same orphan-treatment behavior.
- [ ] On successful upgrade with new id ≠ old id: emits `session.closed { sessionId: oldId }` BEFORE `session.upgraded { previousSessionId: oldId, snapshot: newSnapshot }`.
- [ ] Service contract widened to declare `MetasploitListenerLookupError` in the upgrade error channel.
- [ ] No remaining hardcoded `MSFRPC_HOST` / `"0"` in the upgrade RPC arguments.
- [ ] `bun typecheck` clean; `bun run test` green.
