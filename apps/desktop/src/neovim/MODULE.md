# Module: Neovim (Desktop)

> Embedded Neovim process, RenderLoop SceneSource, Lua bridge, and IPC channels for app↔nvim communication. Lives in Electron main; web renderer talks to it via `desktopBridge`.

## Public API

### Classes

#### `NeovimSource` (public — implements `SceneSource` from `../render/RenderLoop`)

| Method                 | Input                      | Output                     | Description                                                                            |
| ---------------------- | -------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `setCwd(cwd)`          | `string`                   | `Promise<void>`            | Save session, kill nvim, respawn at new cwd on next render tick                        |
| `setEditorFontMetrics` | `EditorFontMetrics`        | `void`                     | Push font metrics; triggers `nvim_ui_try_resize` when client exists                    |
| `handleInput(event)`   | `InputEvent`               | `void`                     | Forward keyboard / mouse / resize to nvim                                              |
| `render(dtMs)`         | `number`                   | `Frame \| null`            | Build damage-tracked frame; returns null when nothing changed                          |
| `openFile(path, …)`    | `string, number?, number?` | `Promise<void>`            | Calls `_G.fenrir.private.bridge.open_file` via `nvim_exec_lua`                         |
| `invokeBridge(fn)`     | `string`                   | `Promise<void>`            | Whitelisted Lua function invocation (currently: `"send_selection"`)                    |
| `onFenrirEvent(l)`     | `(ev) => void`             | `() => void` (unsubscribe) | Subscribe to `fenrir_autocmd` / `fenrir_send_to_composer` / `fenrir_cmd` notifications |
| `shutdown()`           | —                          | `Promise<void>`            | Save session (500ms timeout), SIGTERM nvim                                             |

**Properties:** `kind: "neovim"` (readonly, satisfies `SceneSource`)

### Lua Exports (via `nvim_exec_lua`)

All Lua strings live as TS template literals in `neovimLua.ts`. Canonical `.lua` sources in `lua/` are kept in sync manually.

| Export               | Registers                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FENRIR_INIT_LUA`    | `vim.g.fenrir = true`, `_G.fenrir.private` namespace, sources `ginit.vim`                                                                                         |
| `FENRIR_EXIT_LUA`    | Graceful `:qa!` (or `:confirm qa` if `vim.g.fenrir_confirm_quit`). Currently unused by NeovimSource directly                                                      |
| `FENRIR_BRIDGE_LUA`  | `_G.fenrir.private.bridge.{open_file, send_selection}`                                                                                                            |
| `FENRIR_SESSION_LUA` | `_G.fenrir.private.session.{save, restore}`; host invokes restore explicitly after bootstrap                                                                      |
| `FENRIR_CMD_LUA`     | `:Fenrir <subcommand>` user command (focus-chat, send, save-and-quit, new-thread, submit, open, log)                                                              |
| `FENRIR_EVENTS_LUA`  | `FenrirEvents` augroup: BufEnter, BufWritePost, BufModifiedSet → `vim.rpcnotify(0, "fenrir_autocmd", …)` (avoids `_event` suffix swallowed by neovim Node client) |

### IPC Channels

Channels defined in `main.ts` and mirrored in `preload.ts`. Editor-level channels use constants from `@fenrir/contracts/ipc`.

| Channel                        | Direction       | Schema / Return        | Description                           |
| ------------------------------ | --------------- | ---------------------- | ------------------------------------- |
| `desktop:neovim-redraw`        | main → renderer | `unknown[][]`          | Raw redraw batches from nvim          |
| `desktop:nvim-available`       | renderer → main | `boolean`              | Probe nvim binary existence (cached)  |
| `desktop:nvim-probe-detail`    | renderer → main | `NvimProbeResult`      | Full probe result (version, binary)   |
| `desktop:render-start`         | renderer → main | `void`                 | Start RenderLoop tick                 |
| `desktop:render-stop`          | renderer → main | `void`                 | Stop RenderLoop tick                  |
| `desktop:render-frame`         | main → renderer | `Frame`                | Damage-tracked frame from SceneSource |
| `fenrir:editor:openFile`       | renderer → main | `EditorOpenFileInput`  | Open file in nvim                     |
| `fenrir:editor:invokeBridge`   | renderer → main | `string`               | Whitelisted bridge function name      |
| `fenrir:editor:event`          | main → renderer | `EditorEvent`          | Nvim autocmd events (buf_enter, etc.) |
| `fenrir:editor:sendToComposer` | main → renderer | `EditorSendToComposer` | `:Fenrir send` / visual selection     |
| `fenrir:editor:cmd`            | main → renderer | `EditorCmd`            | `:Fenrir focus-chat`, etc.            |

### Helpers

| Function                    | Input | Output                     | Description                                     |
| --------------------------- | ----- | -------------------------- | ----------------------------------------------- |
| `probeNvim()`               | —     | `Promise<NvimProbeResult>` | `nvim --version` with 3s timeout; caches result |
| `getCachedProbeResult()`    | —     | `NvimProbeResult \| null`  | Return cached probe without re-running          |
| `_resetCachedProbeResult()` | —     | `void`                     | Reset cache — testing only                      |

### Contracts (from `@fenrir/contracts`)

- `EditorOpenFileInput` — `{ path: string, line?: number, col?: number }`
- `EditorEvent` — Union: `buf_enter` | `buf_write_post` | `buf_modified_set`
- `EditorSendToComposer` — `{ file: string, lineStart: number, lineEnd: number, text: string }`
- `EditorCmd` — `{ subcommand: "focus-chat" | "new-thread" | "submit" }`
- `NvimProbeResult` — `{ available: boolean, version: string | null, binary: string | null, error: string | null }`
- `EditorFontMetrics` — `{ width, height, ascent, font, fontWeight, ligatures }`
- `Frame` (= `NeovimFrame`) — `{ kind, seq, cellMetrics?, hl?, defaultColors?, resizedGrids?, closedGrids?, gridDeltas?, windows?, cursor? }`
- `InputEvent` — Union: `key` | `mouse` | `resize`
- `EDITOR_OPEN_FILE_CHANNEL`, `EDITOR_EVENT_CHANNEL`, `EDITOR_SEND_TO_COMPOSER_CHANNEL`, `EDITOR_CMD_CHANNEL`, `EDITOR_INVOKE_BRIDGE_CHANNEL` — channel string constants

## Dependencies

### Packages

- `@fenrir/contracts` — Editor event schemas, frame types, IPC channel constants
- `neovim` (npm) — MessagePack-RPC `attach()` for `--embed` stdio
- `electron` — `app.getPath("userData")`, IPC main/preload

### Node APIs

- `child_process.spawn()` — nvim `--embed` process
- `crypto.createHash("sha256")` — Session file keying by cwd
- `fs.mkdirSync`, `fs.existsSync` — Session directory management
- `path.join()` — Session file path resolution

### Internal

- `../render/RenderLoop` — `SceneSource` interface, `RenderLoop` consumer

## Filesystem Layout

```
apps/desktop/src/neovim/
  MODULE.md
  index.ts                # Public barrel: NeovimSource, FENRIR_INIT_LUA, FENRIR_EXIT_LUA
  NeovimSource.ts         # SceneSource impl, grid/window state, damage tracking, Lua bootstrapping
  neovimLua.ts            # Lua string constants (init, exit, bridge, session, cmd, events)
  probe.ts                # probeNvim(), getCachedProbeResult(), _resetCachedProbeResult()
  probe.test.ts           # Probe tests (success, exit codes, spawn errors, timeout, cache)
  lua/
    init.lua              # Canonical source for FENRIR_INIT_LUA
    exit.lua              # Canonical source for FENRIR_EXIT_LUA
```

## Integration Points

- **Upstream**: `main.ts` instantiates `NeovimSource`, registers it as `RenderLoop` source, wires IPC handlers for all channels. `preload.ts` exposes `window.desktopBridge` methods wrapping those IPC channels.
- **Downstream**: `neovim` npm package (msgpack-rpc over stdio), `electron.app.getPath("userData")` for session storage.
- **Events**: Emits `Frame` objects to renderer via `RENDER_FRAME_CHANNEL`. Forwards nvim rpcnotify messages (`fenrir_autocmd`, `fenrir_send_to_composer`, `fenrir_cmd`) to renderer via dedicated editor channels.

## Working On This Module

### For implementers (working INSIDE this module):

- Lua strings live as TS template literals in `neovimLua.ts` — keeps the build single-file and dependency-free. Canonical `.lua` files in `lua/` are reference copies; keep them in sync manually.
- All app→nvim Lua calls go through `_G.fenrir.private.*` namespace — do not pollute global vim namespace.
- All nvim→app messages are `vim.rpcnotify(0, "fenrir_<topic>", payload)` — single-arg Lua table payloads consumed by `client.on("notification", ...)`.
- Session files use SHA256(cwd) keying — never collide between worktrees.
- `invokeBridge` allowlist is a static `Set` on the class — expand it in `NeovimSource.ts` before adding new app→nvim Lua calls.
- Damage tracking (`dirtyRows`, `hlPending`, `resizedGrids`, etc.) is flushed per frame in `buildFrame()`. Avoid side-effects in `applyRedraw`.
- `ext_multigrid: true` is enabled — grid IDs > 1 map to floating/split windows.

### For consumers (working in OTHER modules):

- Import `NeovimSource` from `./neovim` (barrel). Use `FENRIR_INIT_LUA` and `FENRIR_EXIT_LUA` only if wiring custom nvim lifecycle in `main.ts`.
- All renderer interaction goes through `desktopBridge` IPC — never import from this module in web code.
- To add a new `:Fenrir` subcommand, update `FENRIR_CMD_LUA` in `neovimLua.ts` and handle the new `fenrir_cmd` payload in `main.ts` event forwarding.
- `probeNvim()` result is cached after first call per process lifetime — no need to throttle.
