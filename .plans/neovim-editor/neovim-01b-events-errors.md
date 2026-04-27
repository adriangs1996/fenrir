---
depends_on:
  - neovim-01a-input-schemas
---

# Plan 01b: Neovim Events + Error Types

## Goal

Append lifecycle event schemas and tagged error classes to `packages/contracts/src/neovim.ts`.

## Scope

- Modify: `packages/contracts/src/neovim.ts` (append to existing file from 01a)

## Steps

### Step 1. Append lifecycle events

After existing input schemas, add:

```typescript
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
```

### Step 2. Append tagged error classes

```typescript
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

## Validation

- `bun typecheck` — file compiles
- All error classes follow `Schema.TaggedErrorClass` pattern with override `message` getter

## Done Criteria

- 3 lifecycle events + union exported
- 7 tagged error classes exported
- `NeovimError` union exported
