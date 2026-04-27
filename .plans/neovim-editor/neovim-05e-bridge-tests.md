---
depends_on:
  - neovim-05d-bridge
---

# Plan 05e: Codec + Parser + Bridge Tests

## Goal

Vitest suites for `MsgpackCodec`, `RedrawParser`, and `NeovimBridge`.

## Scope

- New file: `apps/web/src/modules/neovim-editor/__tests__/MsgpackCodec.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/RedrawParser.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/NeovimBridge.test.ts`

## Steps

### Step 1. MsgpackCodec.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { decode } from "@msgpack/msgpack";
import {
  encodeAttachUi, encodeDetachUi, encodeInput, encodeMouse,
  encodeResize, encodePing, decodeFrame,
  CMD_PING, CMD_ATTACH_UI, CMD_DETACH_UI, CMD_INPUT, CMD_MOUSE, CMD_RESIZE,
} from "../protocol/MsgpackCodec";
```

Cases:
1. `encodeAttachUi(80, 24)` decodes to `[CMD_ATTACH_UI, 80, 24]`
2. `encodeDetachUi()` decodes to `[CMD_DETACH_UI]`
3. `encodeInput("ihello")` decodes to `[CMD_INPUT, "ihello"]`
4. `encodeMouse("left","press","",0,5,10)` decodes correctly
5. `encodeResize(120, 40)` decodes correctly
6. `encodePing()` decodes to `[CMD_PING]`
7. `decodeFrame` over a buffer concatenating two encoded msgpack arrays yields both
8. `decodeFrame` over empty buffer yields nothing (no error)

### Step 2. RedrawParser.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parseRedrawBatch } from "../protocol/RedrawParser";
```

Cases:
1. `grid_line` with cell hl_id inheritance: pass `[["x"],["y",5],["z"]]` → cells have hlIds `[0, 5, 5]`
2. `grid_line` with `repeat`: `[["x", 1, 3]]` → expanded to 3 cells of "x" with hlId 1
3. `grid_resize` parses to `{ type, grid, width, height }`
4. `grid_scroll` parses 7 numeric params correctly
5. `grid_clear`, `grid_destroy` minimal events
6. `hl_attr_define` flattens `params[1]` snake_case keys into camelCase HlAttr
7. `default_colors_set` 5-tuple
8. `mode_info_set` snake_case → camelCase (`cursor_shape` → `cursorShape`, `cell_percentage` → `cellPercentage`)
9. `mode_change` modeName + modeIdx
10. `flush` no params
11. `win_pos`, `win_float_pos`, `win_hide`, `win_close` parse correctly
12. `win_viewport` 8-param tuple
13. Unknown event type returns `[]` (skipped)
14. Multiple parameter sets in one group (e.g., 3 grid_line calls in a single `["grid_line", set1, set2, set3]`) → 3 parsed events
15. Mixed batch: `[["grid_resize",[1,80,24]], ["flush"]]` → 2 events

### Step 3. NeovimBridge.test.ts

Use a mock WebSocket. Either:
- Vitest `vi.stubGlobal("WebSocket", MockWebSocket)`, or
- Inject through dependency injection (lift WebSocket constructor as a constructor option) — this requires a small refactor; if doing so, document in 05d.

Cases (with mock WS):
1. `connect(80, 24)` → on open, mock receives `encodeAttachUi(80, 24)` as first message
2. Server sends `encode([2, "redraw", [["flush"]]])` as binary → `onRedraw` called with `[{ type: "flush" }]`
3. `disconnect()` sends detach frame, then `close(1000, "detach")`
4. Unexpected close (code !== 1000) triggers `scheduleReconnect`. Use fake timers:
   - First reconnect after 250 ms
   - 10 failed attempts → status `"error"`, `onError` called with "Failed to reconnect after 10 attempts"
5. `dispose()` cancels pending reconnect timer; subsequent `connect()` no-ops
6. `pingInterval`: advance fake timers 30s → mock receives `encodePing()`
7. Status transitions emit `onStatusChange` only on actual change (no duplicate emits)

### Step 4. Mock WebSocket sketch

```typescript
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  binaryType: BinaryType = "blob";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: Uint8Array) { this.sent.push(data); }
  close(code: number, _reason?: string) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  fakeOpen() { this.readyState = 1; this.onopen?.(); }
  fakeMessage(data: Uint8Array) {
    this.onmessage?.({ data: data.buffer } as MessageEvent);
  }
}
```

## Validation

- `bun run test apps/web/src/modules/neovim-editor/__tests__/MsgpackCodec.test.ts`
- `bun run test apps/web/src/modules/neovim-editor/__tests__/RedrawParser.test.ts`
- `bun run test apps/web/src/modules/neovim-editor/__tests__/NeovimBridge.test.ts`
- `bun typecheck`

## Done Criteria

- 8 codec tests, 15 parser tests, 7 bridge tests passing
- Bridge tests use fake timers + mock WebSocket
- No real network calls in tests
