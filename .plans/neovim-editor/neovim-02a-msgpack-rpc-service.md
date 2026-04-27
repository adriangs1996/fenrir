---
depends_on: []
---

# Plan 02a: MsgpackRpc Service Interface

## Goal

Define the `MsgpackRpcSession` and `MsgpackRpcFactory` Effect service interfaces. No implementation — just the contract that 02b consumes.

## Scope

- New file: `apps/server/src/neovim/Services/MsgpackRpc.ts`
- Install: `bun add @msgpack/msgpack` (in `apps/server/`)

## Steps

### Step 1. Install dependency

```bash
cd apps/server && bun add @msgpack/msgpack
```

### Step 2. Create file

Create `apps/server/src/neovim/Services/MsgpackRpc.ts` with:

```typescript
import { Effect, ServiceMap, Scope } from "effect";
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
  /** Send request, await response. 10s timeout. */
  readonly request: (
    method: string,
    params: unknown[],
  ) => Effect.Effect<unknown, MsgpackRpcError>;

  /** Fire-and-forget notification (used for nvim_input). */
  readonly notify: (
    method: string,
    params: unknown[],
  ) => Effect.Effect<void>;

  /** Subscribe to incoming notifications from neovim (e.g., "redraw"). */
  readonly onNotification: (
    handler: (method: string, params: unknown[]) => void,
  ) => () => void;

  /** Subscribe to raw stdout bytes BEFORE decode (binary passthrough). */
  readonly onRawData: (
    handler: (data: Uint8Array) => void,
  ) => () => void;

  /** Gracefully close: stop reading, reject pending requests. */
  readonly close: () => Effect.Effect<void>;
}

export class MsgpackRpcSession extends ServiceMap.Service<
  MsgpackRpcSession,
  MsgpackRpcSessionShape
>()("t3/neovim/Services/MsgpackRpcSession") {}

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

### Step 3. Verify

- File compiles (`bun typecheck`).
- No runtime tests yet — interfaces only.

## Validation

- `bun typecheck`

## Done Criteria

- `MsgpackRpcError` class exported
- `MsgpackRpcMessage` type union exported
- `MsgpackRpcSessionShape` + `MsgpackRpcSession` service exported
- `MsgpackRpcFactoryShape` + `MsgpackRpcFactory` service exported
- `@msgpack/msgpack` installed in `apps/server`
