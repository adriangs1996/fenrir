---
depends_on:
  - neovim-01-contracts
  - neovim-04-server-binary-websocket
---

# Plan: Web Msgpack Codec + Neovim Bridge

## Summary

Implement browser-side msgpack encode/decode and the binary WebSocket client that connects to `/ws/neovim/:projectId`. Handles connection lifecycle, binary framing, and reconnection.

## Motivation

This is the browser-side counterpart to the server binary WebSocket route. Encodes input commands as msgpack binary frames, decodes incoming redraw event streams.

## Prerequisites

- `neovim-01-contracts`
- `neovim-04-server-binary-websocket` (protocol spec)

## Scope

- New file: `apps/web/src/modules/neovim-editor/protocol/MsgpackCodec.ts`
- New file: `apps/web/src/modules/neovim-editor/protocol/NeovimBridge.ts`
- New file: `apps/web/src/modules/neovim-editor/protocol/RedrawParser.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/MsgpackCodec.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/RedrawParser.test.ts`
- New file: `apps/web/src/modules/neovim-editor/__tests__/NeovimBridge.test.ts`
- Install: `bun add @msgpack/msgpack` in `apps/web/`

## Proposed Changes

### 1. MsgpackCodec — `protocol/MsgpackCodec.ts`

Thin wrapper around `@msgpack/msgpack` for browser use:

```typescript
import { encode, decodeMulti } from "@msgpack/msgpack";

// ── Command Frame Encoding (browser → server) ──

export const CMD_PING = 0;
export const CMD_ATTACH_UI = 1;
export const CMD_DETACH_UI = 2;
export const CMD_INPUT = 3;
export const CMD_MOUSE = 4;
export const CMD_RESIZE = 5;

export function encodeAttachUi(cols: number, rows: number): Uint8Array {
  return encode([CMD_ATTACH_UI, cols, rows]);
}

export function encodeDetachUi(): Uint8Array {
  return encode([CMD_DETACH_UI]);
}

export function encodeInput(keys: string): Uint8Array {
  return encode([CMD_INPUT, keys]);
}

export function encodeMouse(
  button: string,
  action: string,
  modifier: string,
  grid: number,
  row: number,
  col: number,
): Uint8Array {
  return encode([CMD_MOUSE, button, action, modifier, grid, row, col]);
}

export function encodeResize(cols: number, rows: number): Uint8Array {
  return encode([CMD_RESIZE, cols, rows]);
}

export function encodePing(): Uint8Array {
  return encode([CMD_PING]);
}

// ── Msgpack Decoding (server → browser) ──

/**
 * Decode a binary frame from the server.
 * The server forwards raw neovim stdout, which contains
 * msgpack-rpc messages: [2, "redraw", [...event_batches]]
 *
 * A single binary frame may contain multiple msgpack messages.
 */
export function* decodeFrame(buffer: Uint8Array): Generator<unknown[]> {
  for (const item of decodeMulti(buffer)) {
    yield item as unknown[];
  }
}
```

### 2. RedrawParser — `protocol/RedrawParser.ts`

Parses neovim "redraw" notification payloads into typed event objects:

```typescript
// ── Types ──

export interface GridLineCell {
  text: string;
  hlId: number;
  repeat: number;
}

export interface GridLineEvent {
  type: "grid_line";
  grid: number;
  row: number;
  colStart: number;
  cells: GridLineCell[];
  wrap: boolean;
}

export interface GridResizeEvent {
  type: "grid_resize";
  grid: number;
  width: number;
  height: number;
}

export interface GridScrollEvent {
  type: "grid_scroll";
  grid: number;
  top: number;
  bot: number;
  left: number;
  right: number;
  rows: number;
  cols: number;
}

export interface GridClearEvent {
  type: "grid_clear";
  grid: number;
}

export interface GridCursorGotoEvent {
  type: "grid_cursor_goto";
  grid: number;
  row: number;
  col: number;
}

export interface GridDestroyEvent {
  type: "grid_destroy";
  grid: number;
}

export interface HlAttrDefineEvent {
  type: "hl_attr_define";
  id: number;
  rgbAttr: HlAttr;
  ctermAttr: Record<string, unknown>;
  info: unknown[];
}

export interface HlAttr {
  foreground?: number;
  background?: number;
  special?: number;
  reverse?: boolean;
  italic?: boolean;
  bold?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  undercurl?: boolean;
  underdouble?: boolean;
  underdotted?: boolean;
  underdashed?: boolean;
  altfont?: boolean;
  dim?: boolean;
  blend?: number;
  url?: string;
}

export interface DefaultColorsSetEvent {
  type: "default_colors_set";
  rgbFg: number;
  rgbBg: number;
  rgbSp: number;
  ctermFg: number;
  ctermBg: number;
}

export interface ModeInfoSetEvent {
  type: "mode_info_set";
  cursorStyleEnabled: boolean;
  modeInfo: ModeInfo[];
}

export interface ModeInfo {
  cursorShape: "block" | "horizontal" | "vertical";
  cellPercentage: number;
  blinkwait: number;
  blinkon: number;
  blinkoff: number;
  attrId: number;
  attrIdLm: number;
  shortName: string;
  name: string;
}

export interface ModeChangeEvent {
  type: "mode_change";
  modeName: string;
  modeIdx: number;
}

export interface FlushEvent {
  type: "flush";
}

export interface OptionSetEvent {
  type: "option_set";
  name: string;
  value: unknown;
}

// Multigrid events
export interface WinPosEvent {
  type: "win_pos";
  grid: number;
  win: number;
  startRow: number;
  startCol: number;
  width: number;
  height: number;
}

export interface WinFloatPosEvent {
  type: "win_float_pos";
  grid: number;
  win: number;
  anchor: string;
  anchorGrid: number;
  anchorRow: number;
  anchorCol: number;
  focusable: boolean;
  zindex: number;
}

export interface WinHideEvent {
  type: "win_hide";
  grid: number;
}

export interface WinCloseEvent {
  type: "win_close";
  grid: number;
}

export interface WinViewportEvent {
  type: "win_viewport";
  grid: number;
  win: number;
  topline: number;
  botline: number;
  curline: number;
  curcol: number;
  lineCount: number;
  scrollDelta: number;
}

export interface MsgSetPosEvent {
  type: "msg_set_pos";
  grid: number;
  row: number;
  scrolled: boolean;
  sepChar: string;
}

// Global events
export interface SetTitleEvent {
  type: "set_title";
  title: string;
}
export interface BusyStartEvent {
  type: "busy_start";
}
export interface BusyStopEvent {
  type: "busy_stop";
}
export interface BellEvent {
  type: "bell";
}
export interface MouseOnEvent {
  type: "mouse_on";
}
export interface MouseOffEvent {
  type: "mouse_off";
}
export interface ChdirEvent {
  type: "chdir";
  path: string;
}

export type RedrawEvent =
  | GridLineEvent
  | GridResizeEvent
  | GridScrollEvent
  | GridClearEvent
  | GridCursorGotoEvent
  | GridDestroyEvent
  | HlAttrDefineEvent
  | DefaultColorsSetEvent
  | ModeInfoSetEvent
  | ModeChangeEvent
  | FlushEvent
  | OptionSetEvent
  | WinPosEvent
  | WinFloatPosEvent
  | WinHideEvent
  | WinCloseEvent
  | WinViewportEvent
  | MsgSetPosEvent
  | SetTitleEvent
  | BusyStartEvent
  | BusyStopEvent
  | BellEvent
  | MouseOnEvent
  | MouseOffEvent
  | ChdirEvent;

// ── Parser ──

/**
 * Parse a "redraw" notification's params array into typed events.
 *
 * Neovim sends: [2, "redraw", [[eventName, ...args], [eventName, ...args], ...]]
 * The outer array is the batch. Each inner array is [eventName, ...paramSets].
 * An event can have multiple parameter sets (e.g., multiple grid_line calls).
 */
export function parseRedrawBatch(batch: unknown[]): RedrawEvent[] {
  const events: RedrawEvent[] = [];

  for (const eventGroup of batch) {
    const group = eventGroup as unknown[];
    const name = group[0] as string;

    // Each event group can have multiple parameter sets (index 1..n)
    for (let i = 1; i < group.length; i++) {
      const params = group[i] as unknown[];
      const event = parseEvent(name, params);
      if (event) events.push(event);
    }
  }

  return events;
}

function parseEvent(name: string, params: unknown[]): RedrawEvent | null {
  switch (name) {
    case "grid_line":
      return parseGridLine(params);
    case "grid_resize":
      return {
        type: "grid_resize",
        grid: params[0],
        width: params[1],
        height: params[2],
      };
    case "grid_scroll":
      return {
        type: "grid_scroll",
        grid: params[0],
        top: params[1],
        bot: params[2],
        left: params[3],
        right: params[4],
        rows: params[5],
        cols: params[6],
      };
    case "grid_clear":
      return { type: "grid_clear", grid: params[0] };
    case "grid_cursor_goto":
      return {
        type: "grid_cursor_goto",
        grid: params[0],
        row: params[1],
        col: params[2],
      };
    case "grid_destroy":
      return { type: "grid_destroy", grid: params[0] };
    case "hl_attr_define":
      return parseHlAttrDefine(params);
    case "default_colors_set":
      return {
        type: "default_colors_set",
        rgbFg: params[0],
        rgbBg: params[1],
        rgbSp: params[2],
        ctermFg: params[3],
        ctermBg: params[4],
      };
    case "mode_info_set":
      return parseModeInfoSet(params);
    case "mode_change":
      return { type: "mode_change", modeName: params[0], modeIdx: params[1] };
    case "flush":
      return { type: "flush" };
    case "option_set":
      return { type: "option_set", name: params[0], value: params[1] };
    case "win_pos":
      return {
        type: "win_pos",
        grid: params[0],
        win: params[1],
        startRow: params[2],
        startCol: params[3],
        width: params[4],
        height: params[5],
      };
    case "win_float_pos":
      return {
        type: "win_float_pos",
        grid: params[0],
        win: params[1],
        anchor: params[2],
        anchorGrid: params[3],
        anchorRow: params[4],
        anchorCol: params[5],
        focusable: params[6],
        zindex: params[7],
      };
    case "win_hide":
      return { type: "win_hide", grid: params[0] };
    case "win_close":
      return { type: "win_close", grid: params[0] };
    case "win_viewport":
      return {
        type: "win_viewport",
        grid: params[0],
        win: params[1],
        topline: params[2],
        botline: params[3],
        curline: params[4],
        curcol: params[5],
        lineCount: params[6],
        scrollDelta: params[7],
      };
    case "msg_set_pos":
      return {
        type: "msg_set_pos",
        grid: params[0],
        row: params[1],
        scrolled: params[2],
        sepChar: params[3],
      };
    case "set_title":
      return { type: "set_title", title: params[0] };
    case "busy_start":
      return { type: "busy_start" };
    case "busy_stop":
      return { type: "busy_stop" };
    case "bell":
      return { type: "bell" };
    case "mouse_on":
      return { type: "mouse_on" };
    case "mouse_off":
      return { type: "mouse_off" };
    case "chdir":
      return { type: "chdir", path: params[0] };
    default:
      return null; // Forward-compatible: ignore unknown events
  }
}

// grid_line cells need special parsing
function parseGridLine(params: unknown[]): GridLineEvent {
  const rawCells = params[3] as unknown[][];
  let lastHlId = 0;
  const cells: GridLineCell[] = [];

  for (const cell of rawCells) {
    const text = cell[0] as string;
    const hlId = cell.length >= 2 ? (cell[1] as number) : lastHlId;
    const repeat = cell.length >= 3 ? (cell[2] as number) : 1;
    lastHlId = hlId;
    cells.push({ text, hlId, repeat });
  }

  return {
    type: "grid_line",
    grid: params[0] as number,
    row: params[1] as number,
    colStart: params[2] as number,
    cells,
    wrap: (params[4] as boolean) ?? false,
  };
}
```

### 3. NeovimBridge — `protocol/NeovimBridge.ts`

Binary WebSocket client with lifecycle management:

```typescript
import {
  encodeAttachUi,
  encodeDetachUi,
  encodeInput,
  encodeMouse,
  encodeResize,
  encodePing,
  decodeFrame,
} from "./MsgpackCodec";
import { parseRedrawBatch, type RedrawEvent } from "./RedrawParser";

export type NeovimBridgeStatus =
  | "disconnected"
  | "connecting"
  | "attached"
  | "error";

export interface NeovimBridgeOptions {
  projectId: string;
  /**
   * WebSocket URL factory. Called on each connect/reconnect.
   * Must return full URL including auth token.
   * e.g., "ws://localhost:3000/ws/neovim?projectId=xxx&token=yyy"
   */
  getUrl: () => string;
  /** Called on each redraw batch after parsing */
  onRedraw: (events: RedrawEvent[]) => void;
  /** Called when connection status changes */
  onStatusChange: (status: NeovimBridgeStatus) => void;
  /** Called on unrecoverable error */
  onError: (message: string) => void;
}

export class NeovimBridge {
  private ws: WebSocket | null = null;
  private status: NeovimBridgeStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: NeovimBridgeOptions) {}

  /** Connect to server and attach UI */
  connect(cols: number, rows: number): void {
    if (this.disposed) return;
    this.setStatus("connecting");

    const url = this.options.getUrl();
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Immediately send attach UI command
      this.sendBinary(encodeAttachUi(cols, rows));
      this.setStatus("attached");

      // Start keepalive ping every 30s
      this.pingInterval = setInterval(() => {
        this.sendBinary(encodePing());
      }, 30_000);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);

      // Decode msgpack messages from the binary frame
      // Server forwards raw neovim stdout which contains:
      // [2, "redraw", [...batch]]
      try {
        for (const msg of decodeFrame(data)) {
          if (Array.isArray(msg) && msg[0] === 2 && msg[1] === "redraw") {
            const batch = msg[2] as unknown[];
            const events = parseRedrawBatch(batch);
            this.options.onRedraw(events);
          }
          // Ignore non-redraw notifications (responses, requests from neovim)
        }
      } catch (err) {
        console.warn("[NeovimBridge] Failed to decode frame:", err);
      }
    };

    ws.onclose = (event) => {
      this.cleanup();
      if (this.disposed) return;
      if (event.code === 1000) {
        // Normal close
        this.setStatus("disconnected");
      } else {
        // Unexpected close — reconnect
        this.scheduleReconnect(cols, rows);
      }
    };

    ws.onerror = () => {
      // onerror always followed by onclose in browsers
      // Actual handling in onclose
    };
  }

  /** Send keyboard input */
  sendInput(keys: string): void {
    this.sendBinary(encodeInput(keys));
  }

  /** Send mouse input */
  sendMouse(
    button: string,
    action: string,
    modifier: string,
    grid: number,
    row: number,
    col: number,
  ): void {
    this.sendBinary(encodeMouse(button, action, modifier, grid, row, col));
  }

  /** Send resize */
  resize(cols: number, rows: number): void {
    this.sendBinary(encodeResize(cols, rows));
  }

  /** Detach UI and disconnect */
  disconnect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendBinary(encodeDetachUi());
      this.ws.close(1000, "detach");
    }
    this.cleanup();
    this.setStatus("disconnected");
  }

  /** Permanently dispose — no reconnection */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }

  private sendBinary(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
  }

  private scheduleReconnect(cols: number, rows: number): void {
    if (this.disposed || this.reconnectAttempt >= 10) {
      this.setStatus("error");
      this.options.onError("Failed to reconnect after 10 attempts");
      return;
    }
    this.setStatus("connecting");
    const delay = Math.min(250 * Math.pow(2, this.reconnectAttempt), 10_000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.connect(cols, rows);
    }, delay);
  }

  private setStatus(status: NeovimBridgeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange(status);
  }
}
```

### 4. Tests

**MsgpackCodec.test.ts**:

1. Encode/decode roundtrip for each command type
2. `decodeFrame` handles multiple messages in one buffer
3. `decodeFrame` handles empty buffer

**RedrawParser.test.ts**:

1. Parse `grid_line` with cell hl_id inheritance
2. Parse `grid_line` with repeat cells
3. Parse `grid_resize`, `grid_scroll`, `grid_clear`
4. Parse `hl_attr_define` with all attribute combinations
5. Parse `default_colors_set`
6. Parse `mode_info_set` + `mode_change`
7. Parse `flush` event
8. Parse multigrid events: `win_pos`, `win_float_pos`, `win_hide`, `win_close`
9. Unknown event names → skipped (forward compatible)
10. Full redraw batch with mixed events

**NeovimBridge.test.ts**:

1. Connect sends attach UI frame on open
2. Binary message decoded and onRedraw called
3. Disconnect sends detach frame then closes
4. Reconnect on unexpected close with exponential backoff
5. Dispose prevents reconnection
6. Ping sent every 30s

## Risks

- `@msgpack/msgpack` bundle size. Check tree-shaking — we only need `encode`, `decodeMulti`. Should be ~5KB gzipped.
- WebSocket binary frame max size: browsers handle large frames fine (up to 16MB). Neovim redraw batches rarely exceed a few KB.

## Validation

- `bun test apps/web/src/modules/neovim-editor/__tests__/MsgpackCodec.test.ts`
- `bun test apps/web/src/modules/neovim-editor/__tests__/RedrawParser.test.ts`
- `bun typecheck`

## Done Criteria

- MsgpackCodec encodes all 6 command types and decodes binary frames
- RedrawParser parses all critical event types (grid*line, grid_resize, grid_scroll, hl_attr_define, mode**, flush, win\_*)
- NeovimBridge manages WebSocket lifecycle with reconnection
- Forward-compatible: unknown event types silently ignored
- All tests pass
