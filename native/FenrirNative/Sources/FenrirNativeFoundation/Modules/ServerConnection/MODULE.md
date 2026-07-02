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

Transport implementations stay behind service ports. Live `URLSession` details
and live process handles must not leak through contracts or actions.
