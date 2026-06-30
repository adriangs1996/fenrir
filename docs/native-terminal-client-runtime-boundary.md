# Native Terminal Client Runtime Boundary

This boundary prepares native terminal clients, including a future libGhostty host, to talk to
Fenrir's tmux session kernel without embedding tmux orchestration in the native UI.

## Scope

- The server remains the owner of tmux workspace, window, pane, permission, and lifecycle state.
- Native clients use websocket RPC control-plane methods for workspace/pane operations.
- Pane bytes use the explicit `tmux.pane.subscribeStream` data-plane stream and
  `tmux.pane.write` write acknowledgement contract.
- Detach is a client subscription lifecycle operation unless the user explicitly closes a tmux pane
  or window through the service API.
- This does not implement the native libGhostty application.

## Connection And Auth

Native clients configure:

- `serverUrl`: the Fenrir server websocket endpoint.
- `auth.kind: "bearer"` and `auth.token`: the bearer token used for websocket authentication.
- `auth.sessionId` and `auth.subject`: the explicit tmux actor identity sent in every tmux kernel
  request.

The actor is never inferred from native, Electron, or web transport type. The authenticated websocket
session and `actor.sessionId` must match server-side route authorization.

## Workspace Lifecycle

The client-runtime boundary exposes:

- `listWorkspaces` for discovery.
- `attachWorkspace` with either `ensure` or `snapshot` mode.
- `detachWorkspace` for local subscription teardown state.
- `reconnectWorkspace` for asking the running server to reconnect and reconcile control-mode state.
- `subscribeWorkspace` for tmux kernel lifecycle events after a known revision.

Native clients should call server/service APIs through the websocket RPC adapter. They should not
parse tmux shell output directly while a service API exists.

## Pane Stream Semantics

Pane streams are sequence based:

- `backfill-started` marks the replay range returned by the server.
- `chunk` advances the client cursor to `seq`.
- `gap` records lost data and resumes from the reported sequence.
- `overflow` records ring-buffer or slow-client loss. With `fast-forward`, the stream continues from
  the server cursor. With `close`, the stream is treated as closed for client state.
- `closed` terminates local stream state.

Reconnect subscriptions are built from the last observed sequence using `backfill: "from-seq"`.
If the client has no cursor, it subscribes with `backfill: "latest"` to avoid pretending it can
recover unknown history.

## Writes

Pane input uses `tmux.pane.write` and receives one of:

- `accepted` with `requestId`, pane identity, and input sequence.
- `rejected` with a stable rejection code such as `permission-denied`, `backpressure`, or
  `invalid-state`.

Native clients should keep `requestId` stable across UI retries so acknowledgements can be matched
without relying on terminal output bytes.

## Web And Electron Compatibility

`apps/web/src/rpc/wsRpcClient.ts` now exposes a `tmuxKernel` namespace that maps directly to the
tmux kernel websocket RPC methods. Legacy `terminal.*` and tmux compatibility routes remain
unchanged during the transition.
