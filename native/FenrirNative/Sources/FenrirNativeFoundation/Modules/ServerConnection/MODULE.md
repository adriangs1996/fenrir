# ServerConnection

Owns authenticated Fenrir server endpoint/session contracts, explicit
connection-state transitions, reconnect/heartbeat handling, replay cursors,
health summaries, local server supervisor contracts, request/stream adapter
ports, and stable transport error tags.

This module does not implement live process spawning, store bearer secrets, or
own workspace/runtime replay semantics. NativeHost or a narrow native adapter
provides the local supervisor ports.

Public actions:

- `Connect` / `OpenServerSession`
- `Disconnect` / `CloseServerSession`
- `Reconnect` / `ReconnectServerSession`
- `Send` / `SendServerRequest`
- `Subscribe` / `OpenServerStream`
- `RecordServerHeartbeat`
- `HandleServerTransportClose`
- `RecordServerStreamMessage`
- `PrepareLocalServerConnection`
- `ShutdownLocalServer`

Transport implementations stay behind service ports. The native HTTP compatibility
adapter (`NativeURLSessionServerRPCTransport`, `NativeURLSessionServerRPCNetwork`, and
`NativeServerRequestSender`) lives in `Layers` so `NativeHost` remains only the
composition root. Live process handles must not leak through contracts or actions.

## Live Transport Notes

- NativeServerRequestSender can use either the HTTP compatibility transport or NativeWebSocketServerRPCTransport behind NativeServerRPCTransporting.
- NativeWebSocketServerRPCTransport speaks Effect JSON-RPC over /ws?wsToken=... after bootstrap credential exchange and websocket token issuance.
- Stream events are exposed as encoded JSON event bytes so NativeRuntime can consume them without depending on Effect internals.
