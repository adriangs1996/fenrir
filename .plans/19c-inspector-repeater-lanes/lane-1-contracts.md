# Lane 1: Contracts

**Parent**: `19c-browser-phase3-inspector-repeater.md`
**Blocking**: Lanes 2, 3, 4 all depend on this lane completing first.
**Estimated time**: ~15 min

---

## Goal

Add replay request/response schemas to contracts and wire RPC definition. This is the foundation — all other lanes import these types.

---

## Tasks

### 1. Add replay schemas to `packages/contracts/src/trafficLens.ts`

Insert before the `// ─── Traffic Events ─────` section (after line 159):

```typescript
// ─── Replay Schemas ───────────────────────────────────────────────────────

export const TrafficLensReplayInput = Schema.Struct({
  trafficId: Schema.optional(Schema.Number),
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.optional(Schema.NullOr(Schema.String)), // base64
});
export type TrafficLensReplayInput = typeof TrafficLensReplayInput.Type;

export const TrafficLensReplayResponse = Schema.Struct({
  statusCode: Schema.Number,
  statusText: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.NullOr(Schema.String), // base64
  timing: Schema.Number, // ms
});
export type TrafficLensReplayResponse = typeof TrafficLensReplayResponse.Type;
```

**Key**: Use `Schema.Record(Schema.String, Schema.String)` — NOT `Schema.Record({ key: ..., value: ... })`. The plan had a syntax bug here.

### 2. Add to `WS_METHODS` in `packages/contracts/src/rpc.ts`

In the `// Traffic Lens` section (after line 187, before the closing `} as const`):

```typescript
  trafficLensReplayRequest: "trafficLens.replayRequest",
```

### 3. Add import for new schemas in `rpc.ts`

Update the trafficLens import block (lines 93-100) to include:

```typescript
import {
  TrafficLensError,
  TrafficLensEvent,
  TrafficLensEntry,
  TrafficLensDetail,
  TrafficLensNotFoundError,
  TrafficLensQueryInput,
  TrafficLensReplayInput,      // NEW
  TrafficLensReplayResponse,   // NEW
} from "./trafficLens";
```

### 4. Add RPC definition in `rpc.ts`

After `WsSubscribeTrafficLensEventsRpc` (after line 620), before `WsRpcGroup`:

```typescript
export const WsTrafficLensReplayRequestRpc = Rpc.make(
  WS_METHODS.trafficLensReplayRequest,
  {
    payload: TrafficLensReplayInput,
    success: TrafficLensReplayResponse,
    error: TrafficLensError,
  },
);
```

### 5. Add to `WsRpcGroup` in `rpc.ts`

Add `WsTrafficLensReplayRequestRpc` after `WsSubscribeTrafficLensEventsRpc` (line 680):

```typescript
  WsSubscribeTrafficLensEventsRpc,
  WsTrafficLensReplayRequestRpc,  // NEW
);
```

---

## Tests

### File: `packages/contracts/src/trafficLens.replay.test.ts` (NEW)

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TrafficLensReplayInput, TrafficLensReplayResponse } from "./trafficLens";

describe("TrafficLensReplayInput", () => {
  const decode = Schema.decodeUnknownSync(TrafficLensReplayInput);

  it("accepts minimal GET replay", () => {
    const input = decode({
      method: "GET",
      url: "https://target.htb/api",
      headers: { Accept: "application/json" },
    });
    expect(input.method).toBe("GET");
    expect(input.body).toBeUndefined();
  });

  it("accepts POST with body", () => {
    const input = decode({
      method: "POST",
      url: "https://target.htb/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: Buffer.from("user=admin").toString("base64"),
    });
    expect(input.body).toBeDefined();
  });

  it("accepts optional trafficId", () => {
    const input = decode({
      trafficId: 42,
      method: "GET",
      url: "https://target.htb/",
      headers: {},
    });
    expect(input.trafficId).toBe(42);
  });

  it("rejects missing method", () => {
    expect(() => decode({ url: "https://x.com", headers: {} })).toThrow();
  });

  it("rejects missing url", () => {
    expect(() => decode({ method: "GET", headers: {} })).toThrow();
  });
});

describe("TrafficLensReplayResponse", () => {
  const decode = Schema.decodeUnknownSync(TrafficLensReplayResponse);

  it("accepts valid response", () => {
    const resp = decode({
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>OK</html>").toString("base64"),
      timing: 150,
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.timing).toBe(150);
  });

  it("accepts null body", () => {
    const resp = decode({
      statusCode: 204,
      statusText: "No Content",
      headers: {},
      body: null,
      timing: 50,
    });
    expect(resp.body).toBeNull();
  });
});
```

---

## Verification

```bash
bun typecheck
bun test packages/contracts/src/trafficLens.replay.test.ts
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/contracts/src/trafficLens.ts` | Add `TrafficLensReplayInput`, `TrafficLensReplayResponse` |
| `packages/contracts/src/rpc.ts` | Add import, WS_METHOD, RPC def, WsRpcGroup entry |
| `packages/contracts/src/trafficLens.replay.test.ts` | NEW — schema validation tests |
