# AuthSession

Owns native client auth session contracts, secure-session boundaries, WebSocket
token issuance contracts, and explicit actor construction.

Public callers use `AuthSession` contracts and specific actions only. Concrete
HTTP and secure-storage layers stay behind service ports.

`NativeBearerSession` is intentionally opaque outside this module. It must be
created only by verified AuthSession exchange/load/refresh paths, then handed
to `BuildAuthenticatedActor` or server-connection composition. Do not add a
public initializer or Codable decoding path for bearer material.

Bearer tokens and local/remote server credentials must never be persisted in
Settings, logs, or Codable session snapshots. The live storage layer is
`KeychainAuthSecureStorage`; tests and non-persistent previews can use
`InMemoryAuthSecureStorage`.

This module must not depend on `ServerConnection`, AppKit, renderer objects,
tmux runtime state, or local IPC delivery.
