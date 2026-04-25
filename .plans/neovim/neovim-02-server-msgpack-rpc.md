# Plan: Server Msgpack-RPC Codec

## Summary

Implement the msgpack-RPC protocol layer that communicates with neovim's stdin/stdout. This is the foundational protocol codec consumed by NeovimManager.

## Motivation

Neovim's `--embed` mode uses msgpack-RPC over stdin/stdout. We need a reliable encoder/decoder that handles the full protocol: requests (with response tracking), notifications (fire-and-forget), and streaming decode of partial msgpack frames.

## Scope

- New file: `apps/server/src/neovim/Services/MsgpackRpc.ts` (service interface)
- New file: `apps/server/src/neovim/Layers/MsgpackRpc.ts` (implementation)
- New file: `apps/server/src/neovim/__tests__/MsgpackRpc.test.ts`
- **Does NOT** manage neovim process lifecycle — that's NeovimManager's job

## Dependencies

- `@msgpack/msgpack` npm package (install: `bun add @msgpack/msgpack`)

## Proposed Changes

### 1. Service Interface — `Services/MsgpackRpc.ts`

```typescript
import { Effect, ServiceMap } from "effect";
import type { Writable, Readable } from "node:stream";

export class MsgpackRpcError extends Error {
  readonly _tag = "MsgpackRpcError";
  constructor(
    readonly method: string,
    readonly detail: string,
    override readonly cause?: unknown,
  ) {
    super(`MsgpackRpc error [${method}]: ${detail}`);
  }
}

/**
 * Msgpack-RPC message types per neovim protocol:
 * [0, msgid, method, params]  — Request
 * [1, msgid, error, result]   — Response
 * [2, method, params]         — Notification
 */
export type MsgpackRpcMessage =
  | { type: "request"; msgid: number; method: string; params: unknown[] }
  | { type: "response"; msgid: number; error: unknown; result: unknown }
  | { type: "notification"; method: string; params: unknown[] };

export interface MsgpackRpcSessionShape {
  /**
   * Send a request and await the response.
   * Tracks msgid internally, resolves when response with matching msgid arrives.
   * Timeout: 10 seconds default.
   */
  readonly request: (
    method: string,
    params: unknown[],
  ) => Effect.Effect<unknown, MsgpackRpcError>;

  /**
   * Send a notification (fire-and-forget, no response expected).
   * Used for nvim_input (non-blocking).
   */
  readonly notify: (
    method: string,
    params: unknown[],
  ) => Effect.Effect<void>;

  /**
   * Register handler for incoming notifications from neovim.
   * Returns unsubscribe function.
   * Primary use: "redraw" notifications.
   */
  readonly onNotification: (
    handler: (method: string, params: unknown[]) => void,
  ) => () => void;

  /**
   * Register handler for raw binary data from neovim stdout.
   * Receives raw Uint8Array BEFORE decode — for binary passthrough to WebSocket.
   * Returns unsubscribe function.
   */
  readonly onRawData: (
    handler: (data: Uint8Array) => void,
  ) => () => void;

  /**
   * Gracefully close the session. Stops reading, rejects pending requests.
   */
  readonly close: () => Effect.Effect<void>;
}

export class MsgpackRpcSession extends ServiceMap.Service<
  MsgpackRpcSession,
  MsgpackRpcSessionShape
>()("t3/neovim/Services/MsgpackRpcSession") {}
```

### 2. Layer Implementation — `Layers/MsgpackRpc.ts`

Key implementation details:

**Constructor**: Takes `stdin: Writable` and `stdout: Readable` from child process.

**Encoding** (stdin → neovim):
```typescript
import { encode } from "@msgpack/msgpack";

function encodeRequest(msgid: number, method: string, params: unknown[]): Uint8Array {
  return encode([0, msgid, method, params]);
}

function encodeNotification(method: string, params: unknown[]): Uint8Array {
  return encode([2, method, params]);
}
```

**Decoding** (neovim stdout → messages):
```typescript
import { decodeMultiStream } from "@msgpack/msgpack";

// Use streaming decoder on stdout
// neovim sends multiple msgpack messages in a stream
// decodeMultiStream handles partial messages across chunks
async function* readMessages(stdout: Readable): AsyncGenerator<MsgpackRpcMessage> {
  for await (const item of decodeMultiStream(stdout)) {
    const arr = item as unknown[];
    if (arr[0] === 0) {
      yield { type: "request", msgid: arr[1], method: arr[2], params: arr[3] };
    } else if (arr[0] === 1) {
      yield { type: "response", msgid: arr[1], error: arr[2], result: arr[3] };
    } else if (arr[0] === 2) {
      yield { type: "notification", method: arr[1], params: arr[2] };
    }
  }
}
```

**Request tracking**:
```typescript
// Map of msgid → { resolve, reject, timer }
const pendingRequests = new Map<number, {
  resolve: (result: unknown) => void;
  reject: (error: MsgpackRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

let nextMsgId = 1;
```

**Request flow**:
1. Generate `msgid = nextMsgId++`
2. Store promise resolve/reject in `pendingRequests` map
3. Encode `[0, msgid, method, params]` and write to stdin
4. When response `[1, msgid, error, result]` arrives, resolve/reject matching pending request
5. Timeout after 10s → reject with `MsgpackRpcError`

**Notification flow** (outgoing):
1. Encode `[2, method, params]` and write to stdin
2. No response tracking

**Notification flow** (incoming):
1. When `[2, method, params]` arrives from stdout
2. Call all registered notification handlers

**Raw data passthrough**:
- Hook into `stdout.on("data", chunk)` BEFORE decode
- Forward raw `Uint8Array` to all `onRawData` handlers
- This enables binary WebSocket passthrough without re-encoding

**Read loop** (Effect fiber):
- Run in background fiber via `Effect.forkScoped`
- Read from stdout async generator
- Dispatch responses to pending request map
- Dispatch notifications to handlers
- On stream end: reject all pending requests, clean up

**Error handling**:
- stdout stream error → log, reject all pending, notify lifecycle
- stdin write error → wrap in `MsgpackRpcError`
- Response with non-null error field → reject with neovim error message
- Decode error → log, skip malformed message, continue reading

### 3. Factory Function

The Layer is NOT a singleton — each neovim process gets its own `MsgpackRpcSession`. Use a factory pattern:

```typescript
export interface MsgpackRpcFactoryShape {
  readonly create: (
    stdin: Writable,
    stdout: Readable,
  ) => Effect.Effect<MsgpackRpcSessionShape, never, Scope.Scope>;
}

export class MsgpackRpcFactory extends ServiceMap.Service<
  MsgpackRpcFactory,
  MsgpackRpcFactoryShape
>()("t3/neovim/Services/MsgpackRpcFactory") {}
```

The `create` method returns a scoped effect — cleanup (close session, reject pending) runs when scope closes.

### 4. Tests — `__tests__/MsgpackRpc.test.ts`

Test cases:
1. **Encode request**: Verify `[0, msgid, method, params]` msgpack bytes
2. **Encode notification**: Verify `[2, method, params]` msgpack bytes
3. **Decode response**: Feed `[1, msgid, null, result]` → pending request resolves
4. **Decode error response**: Feed `[1, msgid, "error msg", null]` → pending request rejects
5. **Decode notification**: Feed `[2, "redraw", [...events]]` → handler called
6. **Request timeout**: No response within 10s → rejects with timeout error
7. **Stream end**: stdout closes → all pending requests reject
8. **Partial message**: Send msgpack bytes split across multiple chunks → still decodes correctly
9. **Raw data passthrough**: `onRawData` receives exact bytes from stdout
10. **Multiple concurrent requests**: Different msgids resolve independently

Use `PassThrough` streams from `node:stream` as mock stdin/stdout.

## Risks

- `@msgpack/msgpack`'s `decodeMultiStream` may not handle all edge cases with neovim's binary output. Mitigation: test with real nvim output captured as fixtures.
- Large redraw batches could be slow to decode. Mitigation: `onRawData` passthrough bypasses decode for WebSocket forwarding.

## Validation

- `bun test apps/server/src/neovim/__tests__/MsgpackRpc.test.ts`
- `bun typecheck`

## Done Criteria

- MsgpackRpcFactory service creates session from stdin/stdout streams
- Request/response tracking works with msgid matching
- Notification handlers receive "redraw" events
- Raw data passthrough works for binary WebSocket forwarding
- All 10 test cases pass
- Cleanup on scope close: pending requests rejected, handlers cleared
