---
depends_on:
  - neovim-05a-msgpack-codec
  - neovim-05c-redraw-parser
---

# Plan 05d: NeovimBridge Class

## Goal

Browser-side `NeovimBridge` class — manages binary WebSocket connection, encodes outbound commands, decodes inbound redraw batches, handles reconnection with exponential backoff, keepalive ping.

## Scope

- New file: `apps/web/src/modules/neovim-editor/protocol/NeovimBridge.ts`

## Steps

### Step 1. Imports + types

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
  /** WebSocket URL factory (called on each connect/reconnect). Must include auth token. */
  getUrl: () => string;
  onRedraw: (events: RedrawEvent[]) => void;
  onStatusChange: (status: NeovimBridgeStatus) => void;
  onError: (message: string) => void;
}
```

### Step 2. Class skeleton

```typescript
export class NeovimBridge {
  private ws: WebSocket | null = null;
  private status: NeovimBridgeStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastCols = 80;
  private lastRows = 24;

  constructor(private readonly options: NeovimBridgeOptions) {}
}
```

### Step 3. `connect` method

```typescript
connect(cols: number, rows: number): void {
  if (this.disposed) return;
  this.lastCols = cols;
  this.lastRows = rows;
  this.setStatus("connecting");

  const url = this.options.getUrl();
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  this.ws = ws;

  ws.onopen = () => {
    this.reconnectAttempt = 0;
    this.sendBinary(encodeAttachUi(cols, rows));
    this.setStatus("attached");

    this.pingInterval = setInterval(() => {
      this.sendBinary(encodePing());
    }, 30_000);
  };

  ws.onmessage = (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const data = new Uint8Array(event.data);
    try {
      for (const msg of decodeFrame(data)) {
        if (Array.isArray(msg) && msg[0] === 2 && msg[1] === "redraw") {
          const batch = msg[2] as unknown[];
          const events = parseRedrawBatch(batch);
          this.options.onRedraw(events);
        }
        // Non-redraw notifications (responses, requests) are ignored.
      }
    } catch (err) {
      console.warn("[NeovimBridge] Failed to decode frame:", err);
    }
  };

  ws.onclose = (event) => {
    this.cleanupSocket();
    if (this.disposed) return;
    if (event.code === 1000) {
      this.setStatus("disconnected");
    } else {
      this.scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // Followed by onclose. Keep noise low.
  };
}
```

### Step 4. Send + lifecycle methods

```typescript
sendInput(keys: string): void {
  this.sendBinary(encodeInput(keys));
}

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

resize(cols: number, rows: number): void {
  this.lastCols = cols;
  this.lastRows = rows;
  this.sendBinary(encodeResize(cols, rows));
}

disconnect(): void {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.sendBinary(encodeDetachUi());
    this.ws.close(1000, "detach");
  }
  this.cleanupSocket();
  this.setStatus("disconnected");
}

dispose(): void {
  this.disposed = true;
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  this.disconnect();
}
```

### Step 5. Internals

```typescript
private sendBinary(data: Uint8Array): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(data);
  }
}

private cleanupSocket(): void {
  if (this.pingInterval) {
    clearInterval(this.pingInterval);
    this.pingInterval = null;
  }
  this.ws = null;
}

private scheduleReconnect(): void {
  if (this.disposed || this.reconnectAttempt >= 10) {
    this.setStatus("error");
    this.options.onError("Failed to reconnect after 10 attempts");
    return;
  }
  this.setStatus("connecting");
  const delay = Math.min(250 * 2 ** this.reconnectAttempt, 10_000);
  this.reconnectAttempt++;
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    this.connect(this.lastCols, this.lastRows);
  }, delay);
}

private setStatus(status: NeovimBridgeStatus): void {
  if (this.status === status) return;
  this.status = status;
  this.options.onStatusChange(status);
}
```

### Step 6. Reconnect contract

Re-attach uses `lastCols`/`lastRows` so the consumer doesn't need to re-pass them. Note in code that the server-side neovim session must already exist (re-spawn is the consumer's responsibility).

## Validation

- `bun typecheck`
- Tests in 05e

## Done Criteria

- `NeovimBridge` class with `connect`/`sendInput`/`sendMouse`/`resize`/`disconnect`/`dispose`
- WebSocket binaryType set to `"arraybuffer"`
- Auto-attach on open, auto-detach + close on `disconnect()`
- Reconnect with exponential backoff (250ms → 10s, capped at 10 attempts)
- 30s keepalive ping
- `dispose()` is idempotent; cancels pending reconnect timer
- Status transitions: disconnected → connecting → attached → (disconnected|error)
