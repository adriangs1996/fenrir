---
depends_on:
  - neovim-02a-msgpack-rpc-service
---

# Plan 02b: MsgpackRpc Layer Implementation

## Goal

Implement `MsgpackRpcFactoryLive` Layer — encodes msgpack-RPC frames to neovim stdin, decodes responses/notifications from stdout, tracks pending requests, exposes raw-data passthrough.

## Scope

- New file: `apps/server/src/neovim/Layers/MsgpackRpc.ts`

## Steps

### Step 1. Create file with imports

```typescript
import { Effect, Layer, Scope } from "effect";
import { encode, decodeMultiStream } from "@msgpack/msgpack";
import type { Writable, Readable } from "node:stream";
import {
  MsgpackRpcError,
  MsgpackRpcFactory,
  type MsgpackRpcFactoryShape,
  type MsgpackRpcSessionShape,
} from "../Services/MsgpackRpc";
```

### Step 2. Encoders (module-level helpers)

```typescript
function encodeRequest(msgid: number, method: string, params: unknown[]): Uint8Array {
  return encode([0, msgid, method, params]);
}

function encodeNotification(method: string, params: unknown[]): Uint8Array {
  return encode([2, method, params]);
}
```

### Step 3. Session factory function

Create `createSession(stdin, stdout)` that returns `Effect<MsgpackRpcSessionShape, never, Scope.Scope>`. Internal state:

```typescript
function createSession(
  stdin: Writable,
  stdout: Readable,
): Effect.Effect<MsgpackRpcSessionShape, never, Scope.Scope> {
  return Effect.gen(function* () {
    let nextMsgId = 1;
    const pending = new Map<number, {
      resolve: (result: unknown) => void;
      reject: (err: MsgpackRpcError) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();
    const notificationHandlers = new Set<(method: string, params: unknown[]) => void>();
    const rawDataHandlers = new Set<(data: Uint8Array) => void>();
    let closed = false;

    // ── Raw passthrough hook ──
    const rawDataListener = (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (const h of rawDataHandlers) h(bytes);
    };
    stdout.on("data", rawDataListener);

    // ── Decode loop fiber ──
    const fiber = yield* Effect.forkScoped(
      Effect.tryPromise({
        try: async () => {
          for await (const item of decodeMultiStream(stdout)) {
            if (closed) break;
            const arr = item as unknown[];
            if (arr[0] === 1) {
              // Response
              const msgid = arr[1] as number;
              const errorField = arr[2];
              const result = arr[3];
              const slot = pending.get(msgid);
              if (slot) {
                clearTimeout(slot.timer);
                pending.delete(msgid);
                if (errorField != null) {
                  const detail = Array.isArray(errorField) ? String(errorField[1] ?? errorField) : String(errorField);
                  slot.reject(new MsgpackRpcError("response", detail));
                } else {
                  slot.resolve(result);
                }
              }
            } else if (arr[0] === 2) {
              // Notification
              const method = arr[1] as string;
              const params = arr[2] as unknown[];
              for (const h of notificationHandlers) h(method, params);
            }
            // Ignore type 0 (request from neovim) — not used in --embed flow
          }
        },
        catch: (cause) => new MsgpackRpcError("readLoop", "stream error", cause),
      }).pipe(
        Effect.catchAll((err) => Effect.sync(() => {
          // Reject all pending on stream error
          for (const slot of pending.values()) {
            clearTimeout(slot.timer);
            slot.reject(err as MsgpackRpcError);
          }
          pending.clear();
        })),
      ),
    );

    // ── Public API ──
    const request = (method: string, params: unknown[]): Effect.Effect<unknown, MsgpackRpcError> =>
      Effect.async<unknown, MsgpackRpcError>((resume) => {
        if (closed) {
          resume(Effect.fail(new MsgpackRpcError(method, "session closed")));
          return;
        }
        const msgid = nextMsgId++;
        const timer = setTimeout(() => {
          pending.delete(msgid);
          resume(Effect.fail(new MsgpackRpcError(method, "timeout after 10s")));
        }, 10_000);
        pending.set(msgid, {
          resolve: (r) => resume(Effect.succeed(r)),
          reject: (e) => resume(Effect.fail(e)),
          timer,
        });
        try {
          stdin.write(encodeRequest(msgid, method, params));
        } catch (cause) {
          clearTimeout(timer);
          pending.delete(msgid);
          resume(Effect.fail(new MsgpackRpcError(method, "stdin write failed", cause)));
        }
      });

    const notify = (method: string, params: unknown[]): Effect.Effect<void> =>
      Effect.sync(() => {
        if (closed) return;
        try {
          stdin.write(encodeNotification(method, params));
        } catch {
          // Notifications are fire-and-forget; ignore write errors
        }
      });

    const onNotification = (handler: (method: string, params: unknown[]) => void): (() => void) => {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    };

    const onRawData = (handler: (data: Uint8Array) => void): (() => void) => {
      rawDataHandlers.add(handler);
      return () => rawDataHandlers.delete(handler);
    };

    const close = (): Effect.Effect<void> =>
      Effect.sync(() => {
        if (closed) return;
        closed = true;
        stdout.off("data", rawDataListener);
        for (const slot of pending.values()) {
          clearTimeout(slot.timer);
          slot.reject(new MsgpackRpcError("close", "session closed"));
        }
        pending.clear();
        notificationHandlers.clear();
        rawDataHandlers.clear();
      });

    // Cleanup on scope close
    yield* Effect.addFinalizer(() => close());

    return { request, notify, onNotification, onRawData, close } satisfies MsgpackRpcSessionShape;
  });
}
```

### Step 4. Layer

```typescript
export const MsgpackRpcFactoryLive = Layer.succeed(
  MsgpackRpcFactory,
  { create: createSession } satisfies MsgpackRpcFactoryShape,
);
```

### Step 5. Notes

- `decodeMultiStream` consumes the stdout async iterator. Raw `on("data")` listener fires BEFORE that decode (Node emits to all listeners synchronously), so passthrough captures bytes verbatim.
- If the codebase uses Effect Stream wrappers for stdout, adapt accordingly — the decode loop must NOT consume stdout twice.
- Reject-all-pending on stream end is the safe default; NeovimManager will detect crash and signal upward.

## Validation

- `bun typecheck`
- Manual smoke (deferred to 02c tests)

## Done Criteria

- `MsgpackRpcFactoryLive` exported
- `request` resolves on matching response, rejects on error or 10s timeout
- `notify` writes notification frame to stdin
- `onNotification` / `onRawData` register/unregister handlers
- `close` rejects pending, removes listeners, idempotent
- Scope finalizer calls `close`
