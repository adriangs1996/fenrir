# Native CLI Control Protocol

Status: versioned foundation for local `fenrir` CLI to Fenrir Native control.

Fenrir Native exposes local product-control commands over a Unix domain socket
owned by the logged-in user. This channel is only for small visible-state
commands such as open, attach, focus, list, remove, and workspace control. It is
not used for terminal bytes, pane streams, server RPC, or tmux admin traffic.

## Discovery

The CLI resolves the socket path in this order:

1. `FENRIR_NATIVE_CONTROL_SOCKET`
2. `${XDG_RUNTIME_DIR}/fenrir/native-control.sock`
3. `${TMPDIR}/fenrir-${uid}/native-control.sock`
4. `/tmp/fenrir-${uid}/native-control.sock`

When the native host creates a socket-specific parent directory, it should use
mode `0700`. It must not chmod an existing arbitrary override parent directory.
The socket itself should be bound with mode `0600` where the platform allows it.

## Ownership

Before connecting, the CLI stats the socket path and verifies:

- the path exists
- the path is a Unix socket
- the socket owner uid equals the current process uid

If ownership does not match, the CLI refuses to connect. Localhost or local
filesystem access is never treated as implicit authority.

## Framing

Each message is a single frame:

```text
uint32-be byteLength
utf8-json payload
```

`byteLength` is the JSON payload byte length and must not exceed 1 MiB.

## Version 1 Request

```json
{
  "protocolVersion": 1,
  "requestID": "request-1",
  "command": "open",
  "parameters": {
    "workspaceID": "workspace-a"
  }
}
```

`command` values are the NativeHost delivery commands: `open`, `switch`, `list`,
`attach`, `remove`, `focus`, and `control`.

## Version 1 Response

```json
{
  "protocolVersion": 1,
  "requestID": "request-1",
  "command": "open",
  "ok": true,
  "resultKind": "WorkspaceOpened",
  "payload": {
    "workspaceID": "workspace-a"
  }
}
```

Error responses use the same envelope with `ok: false` and a stable `error`
string such as `ClientControlDecodeError`, `NativeHostProtocolMalformedRequest`,
`NativeHostProtocolUnsupportedVersion`, or `NativeHostProtocolPayloadTooLarge`.

## Timeouts

The CLI applies bounded connect/read/write timeouts. A timeout returns a stable
client-side `timeout` error and does not retry automatically.
