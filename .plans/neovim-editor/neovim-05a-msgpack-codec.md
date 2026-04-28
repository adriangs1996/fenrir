---
depends_on: []
---

<!--
  No real import edge to @fenrir/contracts: MsgpackCodec.ts imports from
  @msgpack/msgpack only. Opcode constants are duplicated by design across
  client/server (see Step 2). Earlier draft listed neovim-01a-input-schemas
  as a dep — removed because it was spurious.
-->


# Plan 05a: Web MsgpackCodec

## Goal

Browser-side msgpack encode/decode helpers. Encodes 6 outbound command opcodes; decodes inbound multi-message binary frames.

## Scope

- Install: `bun add @msgpack/msgpack` in `apps/web`
- New file: `apps/web/src/modules/neovim-editor/protocol/MsgpackCodec.ts`

## Steps

### Step 1. Install

```bash
cd apps/web && bun add @msgpack/msgpack
```

### Step 2. Create file

`apps/web/src/modules/neovim-editor/protocol/MsgpackCodec.ts`:

```typescript
import { encode, decodeMulti } from "@msgpack/msgpack";

// ── Command opcodes (must match server: apps/server/src/neovimBinaryWs.ts) ──

export const CMD_PING = 0;
export const CMD_ATTACH_UI = 1;
export const CMD_DETACH_UI = 2;
export const CMD_INPUT = 3;
export const CMD_MOUSE = 4;
export const CMD_RESIZE = 5;

// ── Outbound encoders ──

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

// ── Inbound decode ──

/**
 * Decode a single binary frame from the server. Frame may contain
 * multiple msgpack messages (server forwards raw neovim stdout).
 * Each yielded value is a top-level msgpack array.
 */
export function* decodeFrame(buffer: Uint8Array): Generator<unknown[]> {
  for (const item of decodeMulti(buffer)) {
    yield item as unknown[];
  }
}
```

### Step 3. Tree-shake check

Verify bundle: `@msgpack/msgpack` should tree-shake to `encode` + `decodeMulti` (~5 KB gzipped). If a wildcard import sneaks in, refactor to named imports only.

## Validation

- `bun typecheck`
- Tests in `05e-bridge-tests` will validate roundtrip

## Done Criteria

- 6 encode functions exported with stable opcode constants
- `decodeFrame` generator handles multi-message buffers
- Opcode constants exported (consumers in 05d use them)
- Imports limited to `encode` + `decodeMulti`
