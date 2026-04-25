# Plan: Neovim Contracts

## Summary

Define all schemas, error types, event types, and RPC method definitions for the Neovim editor integration in `packages/contracts/`.

## Motivation

Contracts must exist before any server or web implementation. Every module depends on these shared types. This is the foundation that unblocks all parallel work.

## Scope

- New file: `packages/contracts/src/neovim.ts`
- Modifications: `packages/contracts/src/rpc.ts` (add WS methods + binary WS schemas)
- Modifications: `packages/contracts/src/keybindings.ts` (add `neovimEditor.toggle` command)
- Modifications: `packages/contracts/src/index.ts` (export new module)

## Proposed Changes

### 1. Create `packages/contracts/src/neovim.ts`

```typescript
import { Schema } from "effect";

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

// ─── Lifecycle Events ────────────────────────────────────────────

export const NeovimStartedEvent = Schema.Struct({
  type: Schema.Literal("neovim:started"),
  projectId: Schema.NonEmptyString,
  pid: Schema.Int,
  createdAt: Schema.String,
});

export const NeovimCrashedEvent = Schema.Struct({
  type: Schema.Literal("neovim:crashed"),
  projectId: Schema.NonEmptyString,
  exitCode: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

export const NeovimExitedEvent = Schema.Struct({
  type: Schema.Literal("neovim:exited"),
  projectId: Schema.NonEmptyString,
  exitCode: Schema.Int,
  createdAt: Schema.String,
});

export const NeovimEvent = Schema.Union([
  NeovimStartedEvent,
  NeovimCrashedEvent,
  NeovimExitedEvent,
]);
export type NeovimEvent = typeof NeovimEvent.Type;

// ─── Error Types ─────────────────────────────────────────────────

export class NeovimNotInstalledError extends Schema.TaggedErrorClass<NeovimNotInstalledError>()(
  "NeovimNotInstalled",
  {
    searchedPaths: Schema.optional(Schema.Array(Schema.String)),
  },
) {
  override get message() {
    return "nvim binary not found. Install Neovim: https://neovim.io/";
  }
}

export class NeovimSpawnError extends Schema.TaggedErrorClass<NeovimSpawnError>()(
  "NeovimSpawnError",
  {
    projectId: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Failed to spawn nvim for project ${this.projectId}: ${this.reason}`;
  }
}

export class NeovimCwdError extends Schema.TaggedErrorClass<NeovimCwdError>()(
  "NeovimCwdError",
  {
    cwd: Schema.String,
    reason: Schema.Literals(["notFound", "notDirectory", "statFailed"]),
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Neovim cwd ${this.reason}: ${this.cwd}`;
  }
}

export class NeovimAttachError extends Schema.TaggedErrorClass<NeovimAttachError>()(
  "NeovimAttachError",
  {
    projectId: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Failed to attach UI for project ${this.projectId}: ${this.reason}`;
  }
}

export class NeovimSessionLookupError extends Schema.TaggedErrorClass<NeovimSessionLookupError>()(
  "NeovimSessionLookupError",
  {
    projectId: Schema.String,
  },
) {
  override get message() {
    return `No neovim session for project: ${this.projectId}`;
  }
}

export class NeovimRpcError extends Schema.TaggedErrorClass<NeovimRpcError>()(
  "NeovimRpcError",
  {
    projectId: Schema.String,
    method: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Neovim RPC error [${this.method}] for project ${this.projectId}: ${this.detail}`;
  }
}

export class NeovimCrashedError extends Schema.TaggedErrorClass<NeovimCrashedError>()(
  "NeovimCrashedError",
  {
    projectId: Schema.String,
    exitCode: Schema.NullOr(Schema.Int),
    signal: Schema.NullOr(Schema.String),
  },
) {
  override get message() {
    return `Neovim crashed for project ${this.projectId} (exit=${this.exitCode}, signal=${this.signal})`;
  }
}

// ─── Union Error ─────────────────────────────────────────────────
export const NeovimError = Schema.Union([
  NeovimNotInstalledError,
  NeovimSpawnError,
  NeovimCwdError,
  NeovimAttachError,
  NeovimSessionLookupError,
  NeovimRpcError,
  NeovimCrashedError,
]);
export type NeovimError = typeof NeovimError.Type;
```

### 2. Modify `packages/contracts/src/rpc.ts`

Add these WS method constants:

```typescript
// In WS_METHODS object:
neovimSpawn: "neovim.spawn",
neovimAttach: "neovim.attach",
neovimDetach: "neovim.detach",
neovimResize: "neovim.resize",
neovimInput: "neovim.input",
neovimMouse: "neovim.mouse",
neovimCommand: "neovim.command",
neovimKill: "neovim.kill",
subscribeNeovimEvents: "subscribeNeovimEvents",
```

Add RPC definitions:

```typescript
export const WsNeovimSpawnRpc = Rpc.make(WS_METHODS.neovimSpawn, {
  payload: NeovimSpawnInput,
  success: NeovimSessionSnapshot,
  error: NeovimError,
});

export const WsNeovimAttachRpc = Rpc.make(WS_METHODS.neovimAttach, {
  payload: NeovimAttachInput,
  error: NeovimError,
});

export const WsNeovimDetachRpc = Rpc.make(WS_METHODS.neovimDetach, {
  payload: NeovimDetachInput,
  error: NeovimError,
});

export const WsNeovimResizeRpc = Rpc.make(WS_METHODS.neovimResize, {
  payload: NeovimResizeInput,
  error: NeovimError,
});

export const WsNeovimInputRpc = Rpc.make(WS_METHODS.neovimInput, {
  payload: NeovimInputInput,
  error: NeovimError,
});

export const WsNeovimMouseRpc = Rpc.make(WS_METHODS.neovimMouse, {
  payload: NeovimMouseInput,
  error: NeovimError,
});

export const WsNeovimCommandRpc = Rpc.make(WS_METHODS.neovimCommand, {
  payload: NeovimCommandInput,
  error: NeovimError,
});

export const WsNeovimKillRpc = Rpc.make(WS_METHODS.neovimKill, {
  payload: NeovimKillInput,
  error: NeovimError,
});

export const WsSubscribeNeovimEventsRpc = Rpc.make(
  WS_METHODS.subscribeNeovimEvents,
  {
    payload: Schema.Struct({}),
    success: NeovimEvent,
    stream: true,
  },
);
```

Add all new Rpc definitions to the `WsRpcGroup = RpcGroup.make(...)` call.

### 3. Modify `packages/contracts/src/keybindings.ts`

Add `"neovimEditor.toggle"` to `STATIC_KEYBINDING_COMMANDS` array:

```typescript
const STATIC_KEYBINDING_COMMANDS = [
  "terminal.toggle",
  "terminal.split",
  "terminal.new",
  "terminal.close",
  "diff.toggle",
  "chat.new",
  "chat.newLocal",
  "editor.openFavorite",
  "neovimEditor.toggle",  // ← ADD
  ...THREAD_KEYBINDING_COMMANDS,
] as const;
```

### 4. Export from `packages/contracts/src/index.ts`

Add: `export * from "./neovim";`

## Validation

- `bun typecheck` passes (all packages)
- `bun lint` passes
- No runtime tests needed — schemas are type-level

## Done Criteria

- All neovim schemas defined and exported from `@fenrir/contracts`
- RPC methods registered in `WsRpcGroup`
- `neovimEditor.toggle` keybinding command registered
- All error types follow `Schema.TaggedErrorClass` pattern
- Types importable from both server and web packages
