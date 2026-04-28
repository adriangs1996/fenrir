---
depends_on:
  - 01-contracts
---

# Plan 10: Web — Upgrade Button + Store Cases for New Events

## Goal

Two related web fixes:

- **Bug #3**: "Upgrade to Meterpreter" button in `TargetWorkspace.tsx` has no `onClick`. Wire it to `rpcClient.metasploit.sessionUpgrade` with local pending state. Disable for non-upgradeable sessions (orphan or already-meterpreter).
- **Bug #4 (web side)**: Store doesn't handle the new event types. Add `applyEvent` cases for `listener.updated` (upsert), `connection.changed` (call `setConnected`), and a defensive backstop on `session.upgraded` that drops the previous session id when the upgraded snapshot's id differs.

## Scope

- Modify: `apps/web/src/metasploitStore.ts` — add 3 event cases.
- Modify: `apps/web/src/components/hack/TargetWorkspace.tsx` — wire upgrade `onClick` + pending/disabled state.

## Steps

### Step 1. Update `metasploitStore.ts`

In `apps/web/src/metasploitStore.ts`, locate the `applyEvent` switch (around L49–90). Make these changes:

#### 1a. Replace the existing `session.upgraded` case (L80–86) with a defensive version

Before:
```typescript
        case "session.upgraded":
          return {
            sessions: {
              ...state.sessions,
              [event.snapshot.sessionId]: event.snapshot,
            },
          };
```

After:
```typescript
        case "session.upgraded": {
          const newSnapshot = event.snapshot;
          // Defensive backstop: server emits session.closed for the old id, but if
          // we somehow miss that event, drop it here when the upgraded id differs.
          const remaining =
            event.previousSessionId && event.previousSessionId !== newSnapshot.sessionId
              ? Object.fromEntries(
                  Object.entries(state.sessions).filter(([id]) => id !== event.previousSessionId),
                )
              : state.sessions;
          return {
            sessions: {
              ...remaining,
              [newSnapshot.sessionId]: newSnapshot,
            },
            activeSessionId:
              event.previousSessionId && state.activeSessionId === event.previousSessionId
                ? newSnapshot.sessionId
                : state.activeSessionId,
          };
        }
```

> ⚠️ Active session re-mapping: if the user had the old shell session selected, switch the active session to the new meterpreter id so the workspace doesn't blank out.

#### 1b. Add the `listener.updated` case

Insert in the switch, AFTER `case "listener.stopped"`:

```typescript
        case "listener.updated":
          return {
            listeners: {
              ...state.listeners,
              [event.snapshot.listenerId]: event.snapshot,
            },
          };
```

#### 1c. Add the `connection.changed` case

Insert AFTER the `session.output` case:

```typescript
        case "connection.changed":
          return { connected: event.connected };
```

> ⚠️ The full updated `applyEvent` switch should now have cases for: `listener.created`, `listener.stopped`, `listener.updated`, `session.opened`, `session.closed`, `session.output` (returns state unchanged), `session.upgraded`, `connection.changed`. The `default` clause stays.

### Step 2. Update `TargetWorkspace.tsx`

Replace the file contents (existing 79 lines) with the wired version below. Diff is small but inline shown for clarity:

#### 2a. Add imports

At the top of the file, alongside existing imports:

```typescript
import { useState, useCallback, useMemo } from "react";
import { useMetasploitStore } from "../../metasploitStore";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { TargetShellTab } from "./TargetShellTab";
import { TargetFilesTab } from "./TargetFilesTab";
import { TargetProcessesTab } from "./TargetProcessesTab";
import { TargetNetworkTab } from "./TargetNetworkTab";
import { TargetAgentInput } from "./TargetAgentInput";
import { getPrimaryEnvironmentConnection } from "../../environmentApi"; // NEW
```

#### 2b. Inside the component body, get rpcClient and define handler

After the existing `const session = useMetasploitStore(...)` line:

```typescript
  const rpcClient = useMemo(() => getPrimaryEnvironmentConnection().client, []);
  const [upgrading, setUpgrading] = useState(false);

  const canUpgrade = session?.type === "shell" && session?.listenerId != null;

  const handleUpgrade = useCallback(async () => {
    if (!canUpgrade) return;
    setUpgrading(true);
    try {
      await rpcClient.metasploit.sessionUpgrade({ sessionId });
      // Success: store updates via session.closed + session.upgraded events.
      // Component will re-render with new sessionId or unmount if active changed.
      // Don't reset `upgrading` on success — re-mount handles it.
    } catch (err) {
      console.warn(`[upgrade] failed for ${sessionId}:`, err);
      setUpgrading(false);
    }
  }, [rpcClient, sessionId, canUpgrade]);
```

#### 2c. Update the button JSX

Replace the existing button block (around L42–46):

```tsx
        {!isMeterpreter && (
          <Button variant="outline" size="sm">
            Upgrade to Meterpreter
          </Button>
        )}
```

With:

```tsx
        {!isMeterpreter && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpgrade}
            disabled={upgrading || !canUpgrade}
            title={
              !canUpgrade
                ? "Cannot upgrade: orphan session has no associated listener."
                : undefined
            }
          >
            {upgrading ? "Upgrading…" : "Upgrade to Meterpreter"}
          </Button>
        )}
```

> ⚠️ `canUpgrade` is computed defensively. Server (plan 06) also rejects orphan upgrades with `MetasploitListenerLookupError`, but client-side disable gives clearer UX.

## Validation

```bash
bun typecheck
bun lint
bun fmt
```

Grep checks:

```bash
grep -n "case \"listener.updated\"\|case \"connection.changed\"\|previousSessionId" apps/web/src/metasploitStore.ts
# Expect: 1 case for listener.updated, 1 case for connection.changed, 1+ uses of previousSessionId in session.upgraded.

grep -n "sessionUpgrade\|upgrading\|canUpgrade" apps/web/src/components/hack/TargetWorkspace.tsx
# Expect: handler def, state hook, conditional disable check, RPC call, button props.

grep -n "onClick" apps/web/src/components/hack/TargetWorkspace.tsx
# Expect: at least 1 site (the Upgrade button).
```

Compile-time check on store exhaustiveness:

```bash
bun typecheck 2>&1 | grep -i "metasploitStore\|applyEvent"
# Expect: no errors. If TypeScript exhaustiveness check (e.g. `assertNever(event)` in default)
# complains, add the missing case from the new event union.
```

## Done Criteria

- [ ] `metasploitStore.ts` `applyEvent` switch handles `listener.updated` (upsert).
- [ ] `applyEvent` handles `connection.changed` (sets `connected`).
- [ ] `applyEvent` `session.upgraded` case drops `event.previousSessionId` when present and remaps `activeSessionId` if it matched the old id.
- [ ] `TargetWorkspace.tsx` resolves `rpcClient` via `getPrimaryEnvironmentConnection().client`.
- [ ] `handleUpgrade` calls `rpcClient.metasploit.sessionUpgrade` with local `upgrading` pending state.
- [ ] Button is disabled when `upgrading` OR session is non-shell OR session has `listenerId == null`; tooltip explains the orphan case.
- [ ] Button label switches to `"Upgrading…"` while pending.
- [ ] `bun typecheck` clean.
