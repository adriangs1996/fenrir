# Module: Neovim (Server)

> Project-scoped Neovim process lifecycle, msgpack-RPC bridge, and binary WebSocket channel for embedded editor.

## Public API

### Services

#### `NeovimManager` (public — consumed by WebSocket route handler)

| Method            | Input                                                 | Output                       | Errors                                                          | Description                                             |
| ----------------- | ----------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `spawn`           | `projectId, cwd`                                      | `NeovimSessionSnapshot`      | `NeovimNotInstalledError \| NeovimSpawnError \| NeovimCwdError` | Spawn `nvim --embed` for project if not running         |
| `attachUi`        | `projectId, cols, rows`                               | `void`                       | `NeovimAttachError \| NeovimSessionLookupError`                 | Send `nvim_ui_attach` with ext_linegrid + ext_multigrid |
| `detachUi`        | `projectId`                                           | `void`                       | `NeovimSessionLookupError`                                      | Send `nvim_ui_detach`, keep nvim process alive          |
| `resize`          | `projectId, cols, rows`                               | `void`                       | `NeovimSessionLookupError`                                      | Send `nvim_ui_try_resize`                               |
| `input`           | `projectId, keys`                                     | `void`                       | `NeovimSessionLookupError`                                      | Send `nvim_input(keys)` — non-blocking                  |
| `inputMouse`      | `projectId, button, action, modifier, grid, row, col` | `void`                       | `NeovimSessionLookupError`                                      | Send `nvim_input_mouse`                                 |
| `command`         | `projectId, command`                                  | `void`                       | `NeovimSessionLookupError \| NeovimRpcError`                    | Send `nvim_command` (for AI: `checktime`, etc.)         |
| `getApiInfo`      | `projectId`                                           | `NeovimApiInfo`              | `NeovimSessionLookupError \| NeovimRpcError`                    | Call `nvim_get_api_info`                                |
| `kill`            | `projectId`                                           | `void`                       | —                                                               | Kill nvim process, clean up session                     |
| `hasSession`      | `projectId`                                           | `boolean`                    | —                                                               | Check if nvim process running for project               |
| `subscribe`       | `(NeovimEvent => void)`                               | `() => void`                 | —                                                               | Subscribe to lifecycle events (started/crashed/exited)  |
| `getRedrawStream` | `projectId`                                           | `ReadableStream<Uint8Array>` | `NeovimSessionLookupError`                                      | Raw msgpack redraw stream for binary WS forwarding      |

#### `MsgpackRpc` (internal — consumed by NeovimManager only)

| Method     | Input                      | Output                | Errors           | Description                         |
| ---------- | -------------------------- | --------------------- | ---------------- | ----------------------------------- |
| `request`  | `method, params`           | `unknown`             | `NeovimRpcError` | Send request, await response        |
| `notify`   | `method, params`           | `void`                | —                | Send notification (fire-and-forget) |
| `onNotify` | `(method, params) => void` | `() => void`          | —                | Register notification handler       |
| `encode`   | `message`                  | `Uint8Array`          | —                | Encode msgpack-rpc message          |
| `decode`   | `Uint8Array`               | `MsgpackRpcMessage[]` | `NeovimRpcError` | Decode msgpack-rpc stream chunk     |

### Events Emitted

| Event     | Schema               | When                                    |
| --------- | -------------------- | --------------------------------------- |
| `started` | `NeovimStartedEvent` | nvim process spawned successfully       |
| `crashed` | `NeovimCrashedEvent` | nvim process exited unexpectedly        |
| `exited`  | `NeovimExitedEvent`  | nvim process exited normally            |
| `redraw`  | Raw `Uint8Array`     | nvim sends redraw notification (binary) |

### Contracts (from `@fenrir/contracts`)

- `NeovimAttachInput`, `NeovimDetachInput`, `NeovimInputInput`, `NeovimMouseInput`, `NeovimResizeInput`, `NeovimCommandInput` — RPC input schemas
- `NeovimSessionSnapshot` — Session state snapshot (`projectId`, `pid`, `status`)
- `NeovimEvent` — Lifecycle event union (started/crashed/exited)
- `NeovimNotInstalledError`, `NeovimSpawnError`, `NeovimCwdError`, `NeovimAttachError`, `NeovimSessionLookupError`, `NeovimRpcError`, `NeovimCrashedError` — Error types

## Dependencies

### Services Consumed

| Service        | From Module | Why                                 |
| -------------- | ----------- | ----------------------------------- |
| `ServerConfig` | `config`    | Resolve nvim binary path, data dirs |

### Packages

- `@fenrir/contracts` — Neovim schemas and error types
- `effect` — Effect, Layer, Scope, Fiber, SynchronizedRef
- `@msgpack/msgpack` — msgpack encode/decode for nvim RPC protocol

### External

- `node:child_process` — Spawn `nvim --embed` with stdin/stdout pipes (NOT node-pty — neovim uses structured msgpack, not raw terminal)

## Error Taxonomy

| Error                      | Tag                        | Recovery                               |
| -------------------------- | -------------------------- | -------------------------------------- |
| `NeovimNotInstalledError`  | `NeovimNotInstalled`       | Show install instructions to user      |
| `NeovimSpawnError`         | `NeovimSpawnError`         | Log, report to client, offer retry     |
| `NeovimCwdError`           | `NeovimCwdError`           | Validate cwd exists before spawn       |
| `NeovimAttachError`        | `NeovimAttachError`        | UI already attached — detach first     |
| `NeovimSessionLookupError` | `NeovimSessionLookupError` | Session doesn't exist — spawn first    |
| `NeovimRpcError`           | `NeovimRpcError`           | Protocol error — log, may need restart |
| `NeovimCrashedError`       | `NeovimCrashedError`       | Show crash info to user, offer restart |

## Filesystem Layout

```
apps/server/src/neovim/
  MODULE.md
  Services/
    NeovimManager.ts          # Public service interface (STABLE)
    MsgpackRpc.ts             # Internal msgpack-rpc codec service
  Layers/
    NeovimManager.ts          # Process lifecycle, session map, event fanout
    MsgpackRpc.ts             # Msgpack encode/decode, request/response tracking
  __tests__/
    NeovimManager.test.ts     # Integration tests for spawn/attach/input/kill
    MsgpackRpc.test.ts        # Unit tests for encode/decode/request tracking
```

## Integration Points

- **Upstream**: Binary WebSocket route handler in `ws.ts` (spawn, attachUi, input, mouse, resize, kill, getRedrawStream)
- **Downstream**: `node:child_process` for nvim process, `@msgpack/msgpack` for protocol
- **Events**: Lifecycle events (started/crashed/exited) published to subscribers; redraw binary stream piped directly to WebSocket
- **AI integration**: Orchestration engine calls `command("checktime")` after file edits to notify neovim

## Working On This Module

### For implementers (working INSIDE this module):

- `MsgpackRpc` is internal — change freely without breaking consumers
- `NeovimManager` service interface in `Services/NeovimManager.ts` is PUBLIC — changes are BREAKING
- Redraw stream is raw `Uint8Array` — server does NOT decode redraw events, just forwards binary
- Session map keyed by `projectId` — one nvim process per project
- Process cleanup: kill nvim on session destroy, handle SIGTERM gracefully

### For consumers (working in OTHER modules):

- Import ONLY from `Services/NeovimManager.ts`
- Never import from `Layers/` or `MsgpackRpc`
- Handle all declared error types
- Redraw stream is raw msgpack bytes — consumer (WebSocket handler) pipes directly to client
- Use `command("checktime")` to notify neovim of external file changes
