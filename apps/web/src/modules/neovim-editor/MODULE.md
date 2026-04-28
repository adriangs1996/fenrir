# Module: Neovim Editor (Web)

> Canvas2D/WebGL Neovim grid renderer with binary msgpack WebSocket bridge, keyboard/mouse input translation, and ChatView integration.

## Public API

### Stores

#### `useNeovimEditorStore` (Zustand)

| Selector/Action      | Input             | Output                | Description                                               |
| -------------------- | ----------------- | --------------------- | --------------------------------------------------------- |
| `editorOpen`         | —                 | `boolean`             | Whether editor view is active (vs chat)                   |
| `toggleEditor`       | —                 | `void`                | Toggle between editor and chat views                      |
| `setEditorOpen`      | `boolean`         | `void`                | Explicitly set editor visibility                          |
| `activeProjectId`    | —                 | `string \| null`      | Project whose neovim is currently displayed               |
| `setActiveProjectId` | `projectId`       | `void`                | Switch neovim to different project                        |
| `sessionStatus`      | —                 | `NeovimSessionStatus` | `"disconnected" \| "connecting" \| "attached" \| "error"` |
| `setSessionStatus`   | `status`          | `void`                | Update connection status                                  |
| `lastError`          | —                 | `string \| null`      | Last error message for display                            |
| `setLastError`       | `message \| null` | `void`                | Set/clear error message                                   |

### Components

#### `NeovimEditor` (main component)

- Props: `projectId: string, cwd: string`
- Renders: Canvas element filling container, status bar
- Handles: WebSocket lifecycle, grid rendering, input capture, resize
- Mounts/unmounts: spawns nvim on mount if needed, detaches UI on unmount (keeps process)

#### `NeovimEditorStatusBar`

- Props: `sessionStatus, mode, cursorPosition, fileName`
- Renders: Mode indicator, file name, cursor position, connection status

### Hooks

#### `useNeovimBridge`

| Input            | Output                                                     | Description                                   |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `projectId, cwd` | `{ attach, detach, sendInput, sendMouse, resize, status }` | Manages binary WebSocket connection lifecycle |

#### `useNeovimRenderer`

| Input                  | Output                             | Description                         |
| ---------------------- | ---------------------------------- | ----------------------------------- |
| `canvasRef, gridState` | `{ render, setFont, measureCell }` | Canvas2D + WebGL rendering pipeline |

#### `useNeovimKeyboard`

| Input                      | Output        | Description                               |
| -------------------------- | ------------- | ----------------------------------------- |
| `sendInput, editorFocused` | event handler | DOM keyboard → neovim notation translator |

#### `useNeovimMouse`

| Input                            | Output         | Description                             |
| -------------------------------- | -------------- | --------------------------------------- |
| `sendMouse, canvasRef, cellSize` | event handlers | DOM mouse → nvim_input_mouse translator |

### Internal Modules

#### `GridState` (internal)

- Maintains 2D cell arrays per grid ID
- Processes redraw events: `grid_line`, `grid_scroll`, `grid_clear`, `grid_resize`, `grid_cursor_goto`
- Tracks highlight definitions (`hl_attr_define`), default colors, mode info
- Dirty-rect tracking for incremental rendering

#### `CanvasRenderer` (internal)

- Canvas2D text rendering with WebGL compositing
- Cell-by-cell monospace drawing at `(col * cellWidth, row * cellHeight)`
- Highlight attribute application (fg/bg/bold/italic/underline/etc.)
- Cursor rendering (block/horizontal/vertical per mode)
- Double-buffered: process all events → render on `flush` only
- Dirty-rect optimization: only repaint changed cells

#### `MsgpackCodec` (internal)

- Browser-side msgpack encode/decode using `@msgpack/msgpack`
- Streaming decoder for WebSocket binary frames
- Handles partial messages across frame boundaries

#### `NeovimBridge` (internal)

- Binary WebSocket connection to `/ws/neovim/:projectId`
- Reconnection with exponential backoff
- Encodes outgoing RPC requests/notifications
- Decodes incoming redraw notification batches
- Lifecycle: connect → authenticate → attachUi → event loop → detach

#### `KeyboardHandler` (internal)

- Maps DOM `KeyboardEvent` to Neovim key notation
- Handles: modifiers (Ctrl/Alt/Shift/Meta), special keys, function keys
- Dead key / IME composition support
- `<LT>` for literal `<`

#### `MouseHandler` (internal)

- Maps DOM mouse events to `nvim_input_mouse` params
- Pixel → grid cell coordinate translation
- Button mapping: left/right/middle/wheel
- Action mapping: press/drag/release/scroll
- Modifier extraction

### Events Consumed

| Event          | From             | Effect                                  |
| -------------- | ---------------- | --------------------------------------- |
| `redraw` batch | Binary WebSocket | Update GridState → render on flush      |
| AI file edit   | Orchestration    | Server sends `checktime` → nvim reloads |

### Contracts (from `@fenrir/contracts`)

- `NeovimSessionSnapshot` — Session state
- `NeovimSessionStatus` — Connection status literal union
- `NeovimEvent` — Lifecycle events (started/crashed/exited)
- `NeovimError` — Error union for UI display

## Dependencies

### Packages

- `@fenrir/contracts` — Neovim schemas and error types
- `@msgpack/msgpack` — Browser msgpack encode/decode (~5KB)
- `zustand` — State management

### Internal (from `apps/web/src/`)

- `keybindings.ts` — Register `neovimEditor.toggle` command
- `environmentApi.ts` — Environment API bridge (for lifecycle RPC if needed)
- `store.ts` — Project data access (`project.cwd`)
- `components/ChatView.tsx` — Conditional rendering of editor vs chat

## Filesystem Layout

```
apps/web/src/modules/neovim-editor/
  MODULE.md
  index.ts                          # Public API barrel export
  stores/
    neovimState.ts                  # Zustand store for editor UI state
  components/
    NeovimEditor.tsx                # Main editor component (canvas + hooks)
    NeovimEditorStatusBar.tsx       # Status bar (mode, file, cursor, connection)
  hooks/
    useNeovimBridge.ts              # Binary WebSocket lifecycle management
    useNeovimRenderer.ts            # Canvas2D + WebGL rendering pipeline
    useNeovimKeyboard.ts            # Keyboard → neovim notation
    useNeovimMouse.ts               # Mouse → nvim_input_mouse
  renderer/
    GridState.ts                    # Grid data structures + redraw event processing
    CanvasRenderer.ts               # Canvas2D text drawing + WebGL compositing
    HighlightManager.ts             # hl_attr_define processing, color resolution
    CursorRenderer.ts               # Cursor shape rendering per mode
    FontMetrics.ts                  # Monospace cell measurement
  protocol/
    MsgpackCodec.ts                 # Browser msgpack encode/decode
    NeovimBridge.ts                 # Binary WebSocket + RPC framing
    RedrawParser.ts                 # Parse "redraw" notification batches
  input/
    KeyboardHandler.ts              # DOM KeyboardEvent → neovim key notation
    MouseHandler.ts                 # DOM MouseEvent → nvim_input_mouse params
  __tests__/
    GridState.test.ts
    CanvasRenderer.test.ts
    HighlightManager.test.ts
    MsgpackCodec.test.ts
    RedrawParser.test.ts
    KeyboardHandler.test.ts
    MouseHandler.test.ts
    NeovimBridge.test.ts
    neovimState.test.ts
```

## Integration Points

- **Upstream**: `ChatView.tsx` (renders `<NeovimEditor>` when `editorOpen`), `keybindings.ts` (`Cmd+E` toggle), `routes/_chat.tsx` (global shortcut handler)
- **Downstream**: Binary WebSocket to server (`/ws/neovim/:projectId`), `@fenrir/contracts` types
- **Events**: Consumes raw msgpack redraw stream from binary WebSocket; consumes lifecycle events (started/crashed/exited) for status display

## Working On This Module

### For implementers (working INSIDE this module):

- `renderer/` files are pure computation — test without DOM
- `protocol/` files handle binary data — test with fixture msgpack bytes
- `input/` files are pure mappings — test with synthetic KeyboardEvent/MouseEvent
- `hooks/` integrate the above — test with React Testing Library
- `components/` are thin wrappers around hooks — minimal logic
- Canvas rendering: use `OffscreenCanvas` in tests when possible
- WebGL context: graceful fallback to Canvas2D if WebGL unavailable

### For consumers (working in OTHER modules):

- Import ONLY from `~/modules/neovim-editor` (barrel export)
- Never import from internal `renderer/`, `protocol/`, `input/` directly
- Toggle editor via `useNeovimEditorStore().toggleEditor()` or keybinding
- Check status via `useNeovimEditorStore().sessionStatus`
