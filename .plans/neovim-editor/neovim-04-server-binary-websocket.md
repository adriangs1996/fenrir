---
depends_on:
  - neovim-01-contracts
  - neovim-03-server-neovim-manager
---

# Plan: Server Binary WebSocket Route

## Summary

Add a binary WebSocket endpoint at `/ws/neovim/:projectId` that bridges raw msgpack bytes between the browser and neovim's stdout/stdin. Handles authentication, connection lifecycle, and bidirectional binary frame forwarding.

## Motivation

Performance is paramount. Instead of transcoding msgpack → JSON → msgpack, we pipe raw binary directly. Redraw events (the hot path) flow as raw `Uint8Array` from neovim stdout through the server to the browser WebSocket with zero decode overhead on the server.

## Prerequisites

- `neovim-01-contracts`
- `neovim-03-server-neovim-manager`

## Scope

- Modify: `apps/server/src/ws.ts` (add binary WebSocket route, add lifecycle RPC handlers)
- Modify: `apps/server/src/server.ts` (register new route)

## Proposed Changes

### 1. Add Lifecycle RPC Handlers to `ws.ts`

These use the existing JSON RPC WebSocket (`/ws`) for control plane operations:

```typescript
// Inside makeWsRpcLayer:
const neovimManager = yield* NeovimManager;

// ── Neovim lifecycle RPCs ──
[WS_METHODS.neovimSpawn]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimSpawn,
    neovimManager.spawn(input.projectId, input.cwd),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.neovimKill]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimKill,
    neovimManager.kill(input.projectId),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.neovimCommand]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimCommand,
    neovimManager.command(input.projectId, input.command),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.subscribeNeovimEvents]: (_input) =>
  observeRpcStream(
    WS_METHODS.subscribeNeovimEvents,
    Stream.callback<NeovimEvent>((queue) =>
      Effect.acquireRelease(
        neovimManager.subscribe((event) => {
          Effect.runFork(Queue.offer(queue, event));
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ),
    { "rpc.aggregate": "neovim" },
  ),
```

### 2. Add Binary WebSocket Route

This is a SEPARATE WebSocket endpoint — not part of the JSON RPC system.

**Protocol design for the binary WebSocket:**

The binary WebSocket carries two types of messages:

**Server → Client (downstream)**:

- Raw msgpack bytes from neovim's stdout (redraw events)
- These are forwarded AS-IS, no wrapping

**Client → Server (upstream)**:
Client sends msgpack-encoded "command frames" — small msgpack arrays:

- `[1, cols, rows]` — attach UI
- `[2]` — detach UI
- `[3, keys]` — keyboard input (nvim_input)
- `[4, button, action, modifier, grid, row, col]` — mouse input
- `[5, cols, rows]` — resize
- `[0]` — ping/keepalive

This avoids JSON RPC overhead for input — every keypress goes through this binary channel.

**Implementation in `ws.ts`**:

```typescript
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { NeovimManager } from "./neovim/Services/NeovimManager";
import { decode } from "@msgpack/msgpack";

export const neovimBinaryWebsocketRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws/neovim", // projectId passed as query param: /ws/neovim?projectId=xxx
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const neovimManager = yield* NeovimManager;

        // 1. Authenticate
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);

        // 2. Extract projectId from query string
        const url = HttpServerRequest.toURL(request);
        const projectId = url.value?.searchParams.get("projectId");
        if (!projectId) {
          return yield* HttpServerResponse.text(
            "Missing projectId query parameter",
            {
              status: 400,
            },
          );
        }

        // 3. Verify neovim session exists
        const hasSession = yield* neovimManager.hasSession(projectId);
        if (!hasSession) {
          return yield* HttpServerResponse.text(
            "No neovim session for project",
            {
              status: 404,
            },
          );
        }

        // 4. Upgrade to WebSocket
        // Use platform-specific WebSocket upgrade
        // This section depends on whether using Bun or Node HTTP server
        //
        // For Bun:
        //   server.upgrade(request, { data: { projectId, session } })
        //
        // For Effect HTTP:
        //   Use Socket.fromWebSocket pattern
        //
        // The exact implementation depends on Effect's WebSocket upgrade API.
        // Key pattern from existing ws.ts: RpcServer.toHttpEffectWebsocket
        // We need the RAW WebSocket, not the RPC wrapper.

        // Pseudo-implementation using Effect's socket layer:
        return yield* Effect.gen(function* () {
          const socket = yield* Socket.Socket;

          // ── Downstream: neovim stdout → WebSocket ──
          const unsubRawData = yield* neovimManager.onRawRedraw(
            (eventProjectId, data) => {
              if (eventProjectId !== projectId) return;
              // Send binary frame to WebSocket
              Effect.runFork(socket.send(data));
            },
          );

          // ── Upstream: WebSocket → neovim stdin ──
          // Read binary frames from WebSocket
          yield* Stream.fromSocket(socket).pipe(
            Stream.runForEach((frame) =>
              Effect.gen(function* () {
                // Decode command frame
                const cmd = decode(frame) as unknown[];
                const opcode = cmd[0] as number;

                switch (opcode) {
                  case 0: // ping
                    break;
                  case 1: // attach UI
                    yield* neovimManager.attachUi(
                      projectId,
                      cmd[1] as number,
                      cmd[2] as number,
                    );
                    break;
                  case 2: // detach UI
                    yield* neovimManager.detachUi(projectId);
                    break;
                  case 3: // keyboard input
                    yield* neovimManager.input(projectId, cmd[1] as string);
                    break;
                  case 4: // mouse input
                    yield* neovimManager.inputMouse(
                      projectId,
                      cmd[1] as string,
                      cmd[2] as string,
                      cmd[3] as string,
                      cmd[4] as number,
                      cmd[5] as number,
                      cmd[6] as number,
                    );
                    break;
                  case 5: // resize
                    yield* neovimManager.resize(
                      projectId,
                      cmd[1] as number,
                      cmd[2] as number,
                    );
                    break;
                }
              }),
            ),
          );

          // Cleanup on disconnect
          unsubRawData();
          yield* neovimManager.detachUi(projectId).pipe(Effect.ignore);
        });
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
```

### 3. Register Route in `server.ts`

```typescript
// In makeRoutesLayer:
const makeRoutesLayer = Layer.mergeAll(
  // ... existing routes ...
  websocketRpcRouteLayer,
  neovimBinaryWebsocketRouteLayer, // ← ADD
).pipe(Layer.provide(trafficLensApiCorsLayer));
```

### 4. Important Implementation Notes

**WebSocket upgrade with Effect HTTP**: The exact API for raw WebSocket upgrade in Effect's HTTP layer needs investigation. Two approaches:

**Approach A**: Use `HttpRouter.add` with a handler that returns a WebSocket upgrade response. Effect's `@effect/platform` provides `Socket.fromWebSocket` and related utilities.

**Approach B**: If Effect's HTTP layer doesn't easily support raw binary WebSocket, add a parallel Bun/Node native WebSocket handler on a different port or path prefix, authenticated via the same session token.

**Approach C**: Use the same `RpcServer.toHttpEffectWebsocket` but with a custom msgpack serialization layer. Less flexible but stays within Effect's patterns.

The implementer should investigate which approach works best with the current Effect version. Start with Approach A. If blocked, fall back to B.

**Authentication**: The binary WebSocket uses the same `serverAuth.authenticateWebSocketUpgrade()` as the JSON RPC WebSocket. Session token is passed as a query parameter or cookie — same mechanism.

**Stale connection guard**: Same pattern as tmux's `activeTmuxProcesses`:

```typescript
const activeNeovimConnections = new Map<string, { socketId: string }>();
// On new connection: kill old connection for same projectId
// On disconnect: remove from map
```

## Risks

- Effect HTTP raw WebSocket support may be limited. Mitigation: investigate API before implementing, have fallback approach.
- Binary frame ordering: WebSocket guarantees in-order delivery, so this is fine.
- Large redraw batches: single binary frame could be large. WebSocket handles fragmentation automatically.

## Validation

- Manual: connect with browser WebSocket to `/ws/neovim?projectId=xxx`, send attach frame, verify redraw bytes arrive
- `bun typecheck`

## Done Criteria

- Binary WebSocket endpoint registered at `/ws/neovim`
- Authenticated via same mechanism as JSON RPC WebSocket
- Downstream: raw neovim stdout bytes forwarded as binary frames
- Upstream: binary command frames decoded and dispatched to NeovimManager
- Lifecycle RPC handlers (spawn, kill, command, subscribeNeovimEvents) work via JSON RPC
- Cleanup on WebSocket disconnect: detach UI, remove from active connections
- Single connection per project enforced
