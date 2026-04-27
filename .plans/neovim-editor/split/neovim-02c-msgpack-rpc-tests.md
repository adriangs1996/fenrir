---
depends_on:
  - neovim-02b-msgpack-rpc-layer
---

# Plan 02c: MsgpackRpc Tests

## Goal

Vitest test suite covering encode, decode, request/response tracking, notifications, raw passthrough, timeout, stream end, partial frames, concurrent requests.

## Scope

- New file: `apps/server/src/neovim/__tests__/MsgpackRpc.test.ts`

## Steps

### Step 1. Test scaffolding

```typescript
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { encode } from "@msgpack/msgpack";
import { PassThrough } from "node:stream";
import { MsgpackRpcFactoryLive } from "../Layers/MsgpackRpc";
import { MsgpackRpcFactory } from "../Services/MsgpackRpc";

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout };
}

async function withSession<R>(
  fn: (session: any, stdin: PassThrough, stdout: PassThrough) => Promise<R>,
): Promise<R> {
  const { stdin, stdout } = makeStreams();
  return Effect.gen(function* () {
    const factory = yield* MsgpackRpcFactory;
    const session = yield* factory.create(stdin, stdout);
    return yield* Effect.promise(() => fn(session, stdin, stdout));
  }).pipe(
    Effect.scoped,
    Effect.provide(MsgpackRpcFactoryLive),
    Effect.runPromise,
  );
}
```

### Step 2. Test cases

Implement these 10 tests:

1. **Encode request**: Spy on `stdin.write`, send request, verify decoded bytes match `[0, msgid, method, params]`.
2. **Encode notification**: Call `notify`, verify `[2, method, params]`.
3. **Decode response success**: Start request, write `encode([1, msgid, null, "ok"])` to stdout, expect resolve with `"ok"`.
4. **Decode error response**: Write `encode([1, msgid, [0, "boom"], null])`, expect reject with detail containing `"boom"`.
5. **Decode notification**: Register handler, write `encode([2, "redraw", [["flush"]]])`, expect handler called with method=`"redraw"` and params=`[[["flush"]]]`.
6. **Request timeout**: Start request, never write response, advance fake timers 10s, expect reject with `"timeout"`.
7. **Stream end rejects pending**: Start request, call `stdout.end()`, expect reject.
8. **Partial frame across chunks**: Take a single encoded msgpack frame, split into 2 chunks at byte 3, write sequentially with delay → still decodes correctly.
9. **Raw data passthrough**: Register `onRawData`, write arbitrary bytes to stdout, expect handler called with exact bytes.
10. **Concurrent requests**: Start 3 requests, write responses in reverse order, verify each resolves with the correct payload.

### Step 3. Use fake timers for timeout test

```typescript
import { vi } from "vitest";

it("rejects request after 10s timeout", async () => {
  vi.useFakeTimers();
  // ... start request, vi.advanceTimersByTime(10_001), assert
  vi.useRealTimers();
});
```

### Step 4. Concurrent test pattern

Issue 3 requests. After each `request()` call, capture msgid by reading what was written to stdin (decode the bytes). Then write responses in reverse msgid order; each promise must resolve to the matching payload.

## Validation

- `bun run test apps/server/src/neovim/__tests__/MsgpackRpc.test.ts` — all pass
- `bun typecheck`

## Done Criteria

- All 10 test cases implemented and passing
- Tests use `PassThrough` streams (no real child process)
- Fake timers used for timeout assertion
