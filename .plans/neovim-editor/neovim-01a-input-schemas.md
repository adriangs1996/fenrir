---
depends_on: []
---

# Plan 01a: Neovim Input Schemas

## Goal

Create `packages/contracts/src/neovim.ts` with session status, snapshot, and all RPC input schemas. Foundation file — events, errors, and RPC method registration depend on it.

## Scope

- New file: `packages/contracts/src/neovim.ts` (partial — schemas only; events/errors added in 01b)

## Steps

### Step 1. Create `packages/contracts/src/neovim.ts`

Add header import:

```typescript
import { Schema } from "effect";
```

### Step 2. Add session status + snapshot schemas

```typescript
// ─── Session Status ──────────────────────────────────────────────
export const NeovimSessionStatus = Schema.Literals([
  "spawning",
  "running",
  "exited",
  "crashed",
]);
export type NeovimSessionStatus = typeof NeovimSessionStatus.Type;

// ─── Session Snapshot ────────────────────────────────────────────
export const NeovimSessionSnapshot = Schema.Struct({
  projectId: Schema.NonEmptyString,
  pid: Schema.NullOr(Schema.Int),
  status: NeovimSessionStatus,
  apiLevel: Schema.optional(Schema.Int),
});
export type NeovimSessionSnapshot = typeof NeovimSessionSnapshot.Type;
```

### Step 3. Add RPC input schemas

```typescript
// ─── RPC Input Schemas ──────────────────────────────────────────

export const NeovimSpawnInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
});
export type NeovimSpawnInput = typeof NeovimSpawnInput.Type;

export const NeovimAttachInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  cols: Schema.Int.check(Schema.isGreaterThanOrEqualTo(20), Schema.isLessThanOrEqualTo(400)),
  rows: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(200)),
});
export type NeovimAttachInput = typeof NeovimAttachInput.Type;

export const NeovimDetachInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
});
export type NeovimDetachInput = typeof NeovimDetachInput.Type;

export const NeovimResizeInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  cols: Schema.Int.check(Schema.isGreaterThanOrEqualTo(20), Schema.isLessThanOrEqualTo(400)),
  rows: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(200)),
});
export type NeovimResizeInput = typeof NeovimResizeInput.Type;

export const NeovimInputInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  keys: Schema.NonEmptyString,
});
export type NeovimInputInput = typeof NeovimInputInput.Type;

export const NeovimMouseInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  button: Schema.Literals(["left", "right", "middle", "wheel", "move", "x1", "x2"]),
  action: Schema.Literals(["press", "drag", "release", "up", "down", "left", "right"]),
  modifier: Schema.String,  // "" or combo of "C-", "A-", "S-"
  grid: Schema.Int,
  row: Schema.Int,
  col: Schema.Int,
});
export type NeovimMouseInput = typeof NeovimMouseInput.Type;

export const NeovimCommandInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  command: Schema.NonEmptyString,
});
export type NeovimCommandInput = typeof NeovimCommandInput.Type;

export const NeovimKillInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
});
export type NeovimKillInput = typeof NeovimKillInput.Type;
```

## Validation

- `bun typecheck` passes — `packages/contracts` compiles (note: file not yet exported from index.ts; that happens in 01d)
- No runtime tests needed

## Done Criteria

- File `packages/contracts/src/neovim.ts` exists
- All status, snapshot, and 8 input schemas exported
- Schema bounds: cols 20-400, rows 5-200
- File compiles standalone
