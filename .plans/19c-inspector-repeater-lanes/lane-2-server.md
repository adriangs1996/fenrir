# Lane 2: Server — Replay Implementation

**Parent**: `19c-browser-phase3-inspector-repeater.md`
**Depends on**: Lane 1 (contracts)
**Parallelizable with**: Lanes 3, 4 (after Lane 1 complete)
**Estimated time**: ~20 min

---

## Goal

Add `replayRequest` to `TrafficLensService` — executes HTTP requests from server process (bypasses browser CORS). Wire RPC handler. Update server MODULE.md.

---

## Tasks

### 1. Extend service interface — `apps/server/src/traffic-lens/Services/TrafficLensService.ts`

Add import for new types:

```typescript
import type {
  TrafficLensEntry,
  TrafficLensDetail,
  TrafficLensQueryInput,
  TrafficLensIngestPayload,
  TrafficLensNotFoundError,
  TrafficLensEvent,
  TrafficLensReplayInput,       // NEW
  TrafficLensReplayResponse,    // NEW
  TrafficLensError,             // NEW
} from "@fenrir/contracts";
```

Add method to `TrafficLensServiceShape` (after `subscribe` on line 16):

```typescript
readonly replayRequest: (
  input: TrafficLensReplayInput,
) => Effect.Effect<TrafficLensReplayResponse, TrafficLensError>;
```

### 2. Implement in Layer — `apps/server/src/traffic-lens/Layers/TrafficLensService.ts`

Add import for `TrafficLensError`:

```typescript
import { TrafficLensNotFoundError, TrafficLensError, type TrafficLensEvent } from "@fenrir/contracts";
```

Add `replayRequest` implementation inside the return object (after `subscribe`, before `} satisfies TrafficLensServiceShape`):

```typescript
replayRequest: (input) =>
  Effect.gen(function* () {
    const startTime = Date.now();

    const fetchHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.headers)) {
      fetchHeaders[key] = value;
    }

    let fetchBody: string | Buffer | undefined;
    if (input.body) {
      fetchBody = Buffer.from(input.body, "base64");
    }

    const response = yield* Effect.tryPromise({
      try: async () => {
        const resp = await fetch(input.url, {
          method: input.method,
          headers: fetchHeaders,
          body: ["GET", "HEAD"].includes(input.method.toUpperCase())
            ? undefined
            : fetchBody,
          redirect: "manual",
        });

        const bodyBuffer = await resp.arrayBuffer();
        const bodyBase64 = Buffer.from(bodyBuffer).toString("base64");

        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((value, key) => {
          respHeaders[key] = value;
        });

        return {
          statusCode: resp.status,
          statusText: resp.statusText,
          headers: respHeaders,
          body: bodyBase64,
          timing: Date.now() - startTime,
        };
      },
      catch: (error) =>
        new TrafficLensError({
          message: `Replay request failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });

    return response;
  }),
```

**Key design decisions:**
- `redirect: "manual"` — user sees raw 3xx responses, not auto-followed
- Body capped implicitly by response size (10MB limit already in place for storage; replay is ephemeral so no explicit cap needed on response)
- Request body base64-decoded before sending
- Response body base64-encoded before returning
- Timing measured server-side in ms

### 3. Add RPC handler — `apps/server/src/ws.ts`

After the `trafficLensClearTraffic` handler (after line 1370), before `subscribeTrafficLensEvents`:

```typescript
[WS_METHODS.trafficLensReplayRequest]: (input) =>
  observeRpcEffect(
    WS_METHODS.trafficLensReplayRequest,
    trafficLensService.replayRequest(input),
    { "rpc.aggregate": "trafficLens" },
  ),
```

Also add `WS_METHODS` import already exists. Verify `TrafficLensReplayInput` and `TrafficLensReplayResponse` are re-exported through contracts barrel.

### 4. Update server MODULE.md

In `apps/server/src/traffic-lens/MODULE.md`:

**Add row to Service table** (after `subscribe`):

```
| `replayRequest`  | `TrafficLensReplayInput`      | `TrafficLensReplayResponse`   | `TrafficLensError`        | Execute HTTP request from server process (bypasses CORS), manual redirect mode |
```

**Add to Contracts section:**

```
- `TrafficLensReplayInput` — Method, URL, headers record, optional base64 body
- `TrafficLensReplayResponse` — Status code/text, headers record, base64 body, timing ms
```

**Update Extension Points** — move Phase 3 from "future" to "done":

Replace the Phase 3 section with:
```
### Phase 3 — Inspector & Repeater (DONE)
- `replayRequest` method added to service
- New schemas: `TrafficLensReplayInput`, `TrafficLensReplayResponse`
- RPC method: `trafficLens.replayRequest`
```

---

## Tests

### File: `apps/server/src/traffic-lens/__tests__/TrafficLensService.replay.test.ts` (NEW)

**Note**: These tests hit real network. Consider `describe.skipIf(!process.env.NETWORK_TESTS)` or local mock server.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient";
import { runMigrations } from "../../persistence/Migrations";
import { TrafficLensService } from "../Services/TrafficLensService";
import { TrafficLensServiceLive } from "../Layers/TrafficLensService";

const TestLayer = TrafficLensServiceLive.pipe(
  Layer.provide(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(
  Layer.effectDiscard(runMigrations()).pipe(Layer.provide(TestLayer)),
);

layer("TrafficLensService — replayRequest", (it) => {
  it.effect("sends GET and returns response", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/get",
        headers: { Accept: "application/json" },
      });

      assert.strictEqual(result.statusCode, 200);
      assert.ok(result.body);
      assert.ok(result.timing > 0);
      assert.ok(result.headers["content-type"]);
    }),
  );

  it.effect("sends POST with body", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "POST",
        url: "https://httpbin.org/post",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ test: true })).toString("base64"),
      });

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(Buffer.from(result.body!, "base64").toString());
      assert.deepStrictEqual(body.json, { test: true });
    }),
  );

  it.effect("does not follow redirects (manual mode)", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/redirect/1",
        headers: {},
      });

      assert.strictEqual(result.statusCode, 302);
    }),
  );

  it.effect("returns TrafficLensError for unreachable host", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* Effect.either(
        service.replayRequest({
          method: "GET",
          url: "https://this-host-does-not-exist-12345.invalid/",
          headers: {},
        }),
      );

      assert.strictEqual(result._tag, "Left");
    }),
  );
});
```

---

## Verification

```bash
bun typecheck
bun test apps/server/src/traffic-lens/__tests__/TrafficLensService.replay.test.ts
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/server/src/traffic-lens/Services/TrafficLensService.ts` | Add `replayRequest` to interface + new imports |
| `apps/server/src/traffic-lens/Layers/TrafficLensService.ts` | Add `replayRequest` implementation + import `TrafficLensError` |
| `apps/server/src/ws.ts` | Add `trafficLensReplayRequest` RPC handler |
| `apps/server/src/traffic-lens/MODULE.md` | Add replayRequest row, new contracts, update Phase 3 status |
| `apps/server/src/traffic-lens/__tests__/TrafficLensService.replay.test.ts` | NEW — replay integration tests |
