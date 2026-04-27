---
depends_on:
  - neovim-04a-rpc-handlers
---

# Plan 04b: Binary WebSocket Route + Auth + Upgrade

## Goal

Register the `/ws/neovim` binary WebSocket route. Authenticates the upgrade, validates `projectId` query param, verifies a neovim session exists. Frame I/O comes in 04c.

## Scope

- Modify: `apps/server/src/ws.ts` (or new sibling file `apps/server/src/neovimBinaryWs.ts` if existing route file is large)

## Steps

### Step 1. Pick approach for raw binary upgrade

The Effect HTTP layer's raw WebSocket support varies by version. Pre-check before writing:

1. Check `apps/server/src/server.ts` for current HTTP server (Bun vs Effect platform-node).
2. Check existing `RpcServer.toHttpEffectWebsocket` usage — find the underlying socket primitive.
3. Decide:
   - **Approach A (preferred)**: `HttpRouter.add` + Effect's `Socket` primitive for binary.
   - **Approach B (fallback)**: Bun-native `server.upgrade()` with `data: { projectId, session }` if Effect raw support is awkward.
   - **Approach C**: Reuse `RpcServer.toHttpEffectWebsocket` with custom msgpack codec.

Document the chosen approach in a code comment at the top of the new route.

### Step 2. Create route module

If creating a new file `apps/server/src/neovimBinaryWs.ts`:

```typescript
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { ServerAuth } from "./auth/ServerAuth";
import { NeovimManager } from "./neovim/Services/NeovimManager";

export const neovimBinaryWebsocketRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws/neovim",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const neovimManager = yield* NeovimManager;

        // Step 2a: authenticate
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);

        // Step 2b: extract projectId
        const url = HttpServerRequest.toURL(request);
        const projectId = url.value?.searchParams.get("projectId");
        if (!projectId) {
          return yield* HttpServerResponse.text(
            "Missing projectId query parameter",
            { status: 400 },
          );
        }

        // Step 2c: verify session exists
        const hasSession = yield* neovimManager.hasSession(projectId);
        if (!hasSession) {
          return yield* HttpServerResponse.text(
            "No neovim session for project",
            { status: 404 },
          );
        }

        // Step 2d: handover to 04c — replace TODO with WebSocket upgrade
        // TODO(04c): perform binary upgrade and bridge frames
        return yield* HttpServerResponse.text(
          "Binary WS upgrade not yet implemented",
          { status: 501 },
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
```

(Match `respondToAuthError` import from existing ws code.)

### Step 3. Stale connection guard

Above the route, declare:

```typescript
const activeNeovimConnections = new Map<string, { socketId: string }>();
```

Document the eviction policy: on new connection for same projectId, close old socket. Implementation lives in 04c, but reserve the map name now.

### Step 4. Register route in server.ts

Modify `apps/server/src/server.ts` `makeRoutesLayer`:

```typescript
import { neovimBinaryWebsocketRouteLayer } from "./neovimBinaryWs";

const makeRoutesLayer = Layer.mergeAll(
  // ... existing routes ...
  websocketRpcRouteLayer,
  neovimBinaryWebsocketRouteLayer, // ← ADD
).pipe(Layer.provide(trafficLensApiCorsLayer));
```

### Step 5. Authentication parity

Reuse the same `ServerAuth.authenticateWebSocketUpgrade` as the JSON RPC WS. Token transport (cookie or `?token=` query) must match the existing convention — check current JSON RPC route for the exact mechanism.

## Validation

- `bun typecheck`
- `bun lint`
- Manual: `curl -i ws://localhost:PORT/ws/neovim?projectId=test` (without auth) → 401
- With auth + missing projectId → 400
- With auth + valid projectId but no session → 404

## Done Criteria

- New `/ws/neovim` route registered
- Authentication enforced (same as JSON RPC WS)
- Returns 400 / 404 for missing param / missing session
- 501 placeholder for the actual upgrade — completed in 04c
- `activeNeovimConnections` map declared
- Approach choice documented in comment
