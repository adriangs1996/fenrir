---
depends_on:
  - 01-contracts
  - 10-web-upgrade-button-and-store-events
---

# Plan 11: Web — `useMetasploitSync` Subscribe-Before-List + `connection.changed` Handling

## Goal

Two related fixes in `useMetasploitSync.ts`:

- **Race fix**: currently `status()` + `listListeners()` + `listSessions()` + `onEvent` subscribe all fire in parallel. Events that arrive between subscribe-acked and the list-results returning could be lost. Fix: subscribe FIRST, then fetch state. Store upserts are id-keyed and idempotent (verified in plan 10), so dup events from the race window self-correct.
- **`connection.changed` handling**: explicit handler for the new event type. Already covered in store via plan 10's `applyEvent` switch — but this hook used to call `setConnected` directly from the `status()` resolution AND not handle the event type. Now the path is: `applyEvent(event)` → store handles `connection.changed` → `setConnected`. The hook no longer needs the explicit `setConnected` from `status()`, but we keep both for belt-and-suspenders (Q16c decision).
- **Cancellation**: protect against in-flight promises completing after unmount, which would call `setConnected`/`upsertListener`/`upsertSession` on a stale closure.

## Scope

- Modify: `apps/web/src/components/hack/useMetasploitSync.ts` — reorder calls, add `cancelled` flag, ensure event flows to store.

## Steps

### Step 1. Replace the existing hook body

Replace the entire `useEffect` body in `apps/web/src/components/hack/useMetasploitSync.ts` (around L13–43) with:

```typescript
  useEffect(() => {
    if (!rpcClient) return;
    let cancelled = false;

    // 1. Subscribe FIRST so we don't drop events fired between list-call ack and list-result.
    const unsubscribe = rpcClient.metasploit.onEvent((event) => {
      if (cancelled) return;
      applyEvent(event); // store handles `connection.changed` via plan 10.
      if (event.type === "session.output") {
        appendOutput(event.sessionId, event.data);
      }
    });

    // 2. Fetch initial state (after subscribe is wired).
    //    `status()` also triggers server-side `ensureStarted` (plan 03).
    rpcClient.metasploit.status().then(
      (status) => {
        if (!cancelled) setConnected(status.connected);
      },
      () => {
        if (!cancelled) setConnected(false);
      },
    );

    rpcClient.metasploit.listListeners().then(
      (listeners) => {
        if (cancelled) return;
        listeners.forEach(upsertListener);
      },
      () => {},
    );

    rpcClient.metasploit.listSessions().then(
      (sessions) => {
        if (cancelled) return;
        sessions.forEach(upsertSession);
      },
      () => {},
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rpcClient, applyEvent, setConnected, upsertListener, upsertSession, appendOutput]);
```

### Step 2. Verify dependency array

`applyEvent` reference comes from the store hook above and is stable across renders (Zustand action). Dependency array unchanged from existing code, but verify ordering matches the destructured selectors at the top of the file.

### Step 3. No new imports needed

The hook already imports `useMetasploitStore`, `useMetasploitSessionTerminalStore`, and types from `@fenrir/contracts` indirectly via `WsRpcClient`. Plan 10 added the `connection.changed` case to the store's `applyEvent`, which is what the hook calls. No new imports required here.

> ⚠️ Do NOT add a special-cased `connection.changed` branch in the hook. Per Q15c, the store handles it. Adding it twice would double-apply (harmless but wasteful) — rely on the store path.

## Validation

```bash
bun typecheck
bun lint
bun fmt
```

Grep checks:

```bash
grep -n "cancelled" apps/web/src/components/hack/useMetasploitSync.ts
# Expect: at least 4 references (declaration, in onEvent guard, in 3 .then handlers, in cleanup).

grep -n "onEvent\|listListeners\|listSessions\|status()" apps/web/src/components/hack/useMetasploitSync.ts
# Expect: onEvent block appears BEFORE the three list/status calls in source order.
```

Visual check:

```bash
bun --bun cat apps/web/src/components/hack/useMetasploitSync.ts | head -50
```

Confirm `rpcClient.metasploit.onEvent(...)` appears before `rpcClient.metasploit.status()`/`listListeners()`/`listSessions()`.

## Done Criteria

- [ ] `useMetasploitSync` subscribes via `onEvent` BEFORE issuing `status()`/`listListeners()`/`listSessions()`.
- [ ] All three async calls + the event listener guard against `cancelled` closure flag.
- [ ] Cleanup function sets `cancelled = true` and unsubscribes.
- [ ] No special-case branch for `connection.changed` in the hook itself; it flows through `applyEvent` → store.
- [ ] `bun typecheck` clean.
