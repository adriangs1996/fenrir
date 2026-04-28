---
depends_on: []
---

# Plan 01: Contracts — Schemas, Errors, Events, RPC Wiring

## Goal

Add all contract additions needed for the Metasploit fix in one self-contained plan: new RPC inputs/outputs (`SessionAttach`/`SessionDetach`), new tagged error (`MetasploitListenerLookupError`), two new events (`listener.updated`, `connection.changed`), one schema-field extension (`SessionUpgradedEvent.previousSessionId`), and full RPC registration. Foundation for every downstream plan.

## Scope

- Modify: `packages/contracts/src/metasploit.ts` — schemas, errors, events
- Modify: `packages/contracts/src/rpc.ts` — `WS_METHODS`, RPC defs, `WsRpcGroup`

## Steps

### Step 1. Append new input/output schemas to `packages/contracts/src/metasploit.ts`

Insert these blocks **after** the existing `SessionCloseInput` (around L121, before `MetasploitStatusSnapshot`):

```typescript
export const SessionAttachInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type SessionAttachInput = typeof SessionAttachInput.Type;

export const SessionAttachOutput = Schema.Struct({
  sessionId: Schema.String.check(Schema.isNonEmpty()),
  attached: Schema.Boolean,
});
export type SessionAttachOutput = typeof SessionAttachOutput.Type;

export const SessionDetachInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type SessionDetachInput = typeof SessionDetachInput.Type;
```

### Step 2. Add `MetasploitListenerLookupError` tagged error

Append after the existing `MetasploitNotFoundError` class (around L171, before `MetasploitError` union):

```typescript
export class MetasploitListenerLookupError extends Schema.TaggedErrorClass<MetasploitListenerLookupError>()(
  "MetasploitListenerLookupError",
  {
    sessionId: Schema.optional(Schema.String),
    listenerId: Schema.optional(Schema.String),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
```

Add to the `MetasploitError` union (replace existing union):

```typescript
export const MetasploitError = Schema.Union([
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitSessionError,
  MetasploitNotFoundError,
  MetasploitListenerLookupError,
]);
export type MetasploitError = typeof MetasploitError.Type;
```

### Step 3. Extend `SessionUpgradedEvent` with `previousSessionId`

Replace the existing `SessionUpgradedEvent` declaration (around L218–222) with:

```typescript
const SessionUpgradedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("session.upgraded"),
  previousSessionId: Schema.optional(Schema.NonEmptyString),
  snapshot: MsfSessionSnapshot,
});
```

> ⚠️ Field is OPTIONAL so existing emitters (none yet, but defensive) don't break. Server (plan 06) populates it whenever the upgraded id differs from the original.

### Step 4. Add two new events: `ListenerUpdatedEvent`, `ConnectionChangedEvent`

Insert **before** the `MetasploitEvent = Schema.Union([...])` declaration:

```typescript
const ListenerUpdatedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("listener.updated"),
  snapshot: ListenerSnapshot,
});

const ConnectionChangedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("connection.changed"),
  connected: Schema.Boolean,
  version: Schema.optional(Schema.String),
});
```

Then update the `MetasploitEvent` union to include them:

```typescript
export const MetasploitEvent = Schema.Union([
  ListenerCreatedEvent,
  ListenerStoppedEvent,
  ListenerUpdatedEvent,
  SessionOpenedEvent,
  SessionClosedEvent,
  SessionOutputEvent,
  SessionUpgradedEvent,
  ConnectionChangedEvent,
]);
export type MetasploitEvent = typeof MetasploitEvent.Type;
```

### Step 5. Register new WS methods in `packages/contracts/src/rpc.ts`

In the `// Metasploit` section of `WS_METHODS` (around L184–194), add after `metasploitSessionClose`:

```typescript
  metasploitSessionAttach: "metasploit.sessionAttach",
  metasploitSessionDetach: "metasploit.sessionDetach",
```

### Step 6. Update the metasploit imports in `rpc.ts`

Replace the import block at L77–92 with the extended list:

```typescript
import {
  CreateListenerInput,
  ListenerSnapshot,
  MetasploitConnectionError,
  MetasploitEvent,
  MetasploitListenerError,
  MetasploitListenerLookupError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  MetasploitStatusSnapshot,
  MsfSessionSnapshot,
  SessionAttachInput,
  SessionAttachOutput,
  SessionCloseInput,
  SessionDetachInput,
  SessionResizeInput,
  SessionUpgradeInput,
  SessionWriteInput,
  StopListenerInput,
} from "./metasploit";
```

### Step 7. Add new RPC definitions

Insert **after** the `WsMetasploitSessionCloseRpc` declaration (around L536–539), **before** `WsSubscribeMetasploitEventsRpc`:

```typescript
export const WsMetasploitSessionAttachRpc = Rpc.make(WS_METHODS.metasploitSessionAttach, {
  payload: SessionAttachInput,
  success: SessionAttachOutput,
  error: Schema.Union([MetasploitSessionError, MetasploitConnectionError]),
});

export const WsMetasploitSessionDetachRpc = Rpc.make(WS_METHODS.metasploitSessionDetach, {
  payload: SessionDetachInput,
  error: MetasploitSessionError,
});
```

Also extend the `sessionUpgrade` RPC's error union to surface the new lookup error:

Replace:
```typescript
export const WsMetasploitSessionUpgradeRpc = Rpc.make(WS_METHODS.metasploitSessionUpgrade, {
  payload: SessionUpgradeInput,
  success: MsfSessionSnapshot,
  error: MetasploitSessionError,
});
```

With:
```typescript
export const WsMetasploitSessionUpgradeRpc = Rpc.make(WS_METHODS.metasploitSessionUpgrade, {
  payload: SessionUpgradeInput,
  success: MsfSessionSnapshot,
  error: Schema.Union([MetasploitSessionError, MetasploitListenerLookupError]),
});
```

### Step 8. Register the new RPCs in `WsRpcGroup`

In the `RpcGroup.make(...)` call (around L660–669), add the two new RPCs after `WsMetasploitSessionCloseRpc` and before `WsSubscribeMetasploitEventsRpc`:

```typescript
  WsMetasploitSessionCloseRpc,
  WsMetasploitSessionAttachRpc,
  WsMetasploitSessionDetachRpc,
  WsSubscribeMetasploitEventsRpc,
```

## Validation

```bash
bun typecheck --filter @fenrir/contracts
bun typecheck   # whole repo — surfaces consumers that need updates
bun lint
bun fmt
```

Expected:
- `bun typecheck @fenrir/contracts` clean.
- Whole-repo typecheck shows ONLY type errors in:
  - `apps/server/src/ws.ts` (no handlers for new RPC methods → handled in plan 02)
  - `apps/server/src/server.test.ts` (mock missing `emitSessionOutput` → handled in plan 02 + plan 08)
  - `apps/web/src/metasploitStore.ts` (exhaustiveness check on new event types → handled in plan 10)
  - `apps/web/src/components/hack/useMetasploitSync.ts` (new event handler missing → handled in plan 11)
  
  All other type errors indicate a regression in this plan.

Grep checks:

```bash
grep -n "metasploitSessionAttach\|metasploitSessionDetach" packages/contracts/src/rpc.ts
# Expect: WS_METHODS entry, RPC def, WsRpcGroup entry — 3 hits each.

grep -n "MetasploitListenerLookupError" packages/contracts/src/metasploit.ts
# Expect: class declaration + union entry.

grep -n "listener.updated\|connection.changed\|previousSessionId" packages/contracts/src/metasploit.ts
# Expect: each event type exactly once in struct + once in union; previousSessionId once in SessionUpgradedEvent.
```

## Done Criteria

- [ ] `SessionAttachInput`, `SessionAttachOutput`, `SessionDetachInput` exported.
- [ ] `MetasploitListenerLookupError` class exported and added to `MetasploitError` union.
- [ ] `SessionUpgradedEvent` carries optional `previousSessionId`.
- [ ] `ListenerUpdatedEvent` and `ConnectionChangedEvent` defined and added to `MetasploitEvent` union.
- [ ] `WS_METHODS.metasploitSessionAttach` and `WS_METHODS.metasploitSessionDetach` registered.
- [ ] `WsMetasploitSessionAttachRpc` and `WsMetasploitSessionDetachRpc` defined and added to `WsRpcGroup`.
- [ ] `WsMetasploitSessionUpgradeRpc` error widened to include `MetasploitListenerLookupError`.
- [ ] `bun typecheck --filter @fenrir/contracts` clean. Whole-repo typecheck shows only the four listed downstream errors.
