# Module: WebSocket Routes

> Authenticated Effect RPC routes for server control-plane operations.

## Auth Boundary

`apps/server/src/ws.ts` authenticates each WebSocket upgrade through
`ServerAuth.authenticateWebSocketUpgrade`. Route handlers are then built with
the authenticated `AuthSessionId`, so per-connection state such as
`AuthClientSession.current` is session-relative rather than global or
single-client.

Clients should connect with a short-lived `wsToken` from `POST
/api/auth/ws-token`, or with an already valid session credential where supported.
Pairing/bootstrap credentials must not be reused as steady-state WebSocket
credentials.

WebSocket routes remain server control-plane contracts. Auth/access routes expose
pairing and client-session metadata only; terminal, provider, or browser data
streams require explicit data-plane boundaries.

## Streaming Observability

All route modules should go through `makeRpcDomain` or
`makeControlPlaneDomain`, which route streams through
`apps/server/src/observability/RpcInstrumentation.ts`.

Shared stream metrics:

- `t3_rpc_requests_total`: stream activation/exit count.
- `t3_rpc_request_duration`: stream lifetime.
- `t3_rpc_stream_items_total`: emitted item count.

Each metric is labeled with the RPC method and WebSocket plane from
`packages/contracts/src/rpc/planes.ts`. Compatibility data streams are visible
through these counters, but the counters do not provide backpressure. If a route
adds a high-volume stream or a route-local queue, document whether the queue is
bounded, whether it drops, and where overflow is reported.
