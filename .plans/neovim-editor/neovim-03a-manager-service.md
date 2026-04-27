---
depends_on:
  - neovim-01b-events-errors
  - neovim-02a-msgpack-rpc-service
---

# Plan 03a: NeovimManager Service Interface

## Goal

Define the `NeovimManager` Effect service interface — public API for spawning, attaching/detaching, input forwarding, command exec, and event subscription.

## Scope

- New file: `apps/server/src/neovim/Services/NeovimManager.ts`

## Steps

### Step 1. Create file

```typescript
import { Effect, ServiceMap } from "effect";
import {
  NeovimAttachError,
  NeovimCwdError,
  NeovimNotInstalledError,
  NeovimRpcError,
  NeovimSessionLookupError,
  NeovimSessionSnapshot,
  NeovimSpawnError,
  NeovimEvent,
} from "@fenrir/contracts";

export interface NeovimManagerShape {
  /** Spawn nvim --embed for project. No-op if running. Validates cwd, resolves binary. */
  readonly spawn: (
    projectId: string,
    cwd: string,
  ) => Effect.Effect<
    NeovimSessionSnapshot,
    NeovimNotInstalledError | NeovimSpawnError | NeovimCwdError
  >;

  /** nvim_ui_attach with rgb + ext_linegrid + ext_multigrid. */
  readonly attachUi: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, NeovimAttachError | NeovimSessionLookupError>;

  /** nvim_ui_detach. Process stays alive for reattach. */
  readonly detachUi: (
    projectId: string,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /** nvim_ui_try_resize. */
  readonly resize: (
    projectId: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /** nvim_input (non-blocking notification). */
  readonly input: (
    projectId: string,
    keys: string,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /** nvim_input_mouse. */
  readonly inputMouse: (
    projectId: string,
    button: string,
    action: string,
    modifier: string,
    grid: number,
    row: number,
    col: number,
  ) => Effect.Effect<void, NeovimSessionLookupError>;

  /** nvim_command (await response). Used for "checktime" etc. */
  readonly command: (
    projectId: string,
    command: string,
  ) => Effect.Effect<void, NeovimSessionLookupError | NeovimRpcError>;

  /** Kill process: detach UI, SIGTERM, 2s grace, SIGKILL. */
  readonly kill: (projectId: string) => Effect.Effect<void>;

  /** Returns true if a running session exists for projectId. */
  readonly hasSession: (projectId: string) => Effect.Effect<boolean>;

  /** Subscribe to lifecycle events. Returns unsubscribe fn. */
  readonly subscribe: (
    listener: (event: NeovimEvent) => void,
  ) => Effect.Effect<() => void>;

  /** Subscribe to raw msgpack stdout bytes (for binary WS forward). Returns unsubscribe fn. */
  readonly onRawRedraw: (
    handler: (projectId: string, data: Uint8Array) => void,
  ) => Effect.Effect<() => void>;
}

export class NeovimManager extends ServiceMap.Service<
  NeovimManager,
  NeovimManagerShape
>()("t3/neovim/Services/NeovimManager") {}
```

## Validation

- `bun typecheck`

## Done Criteria

- `NeovimManagerShape` interface exported with all 11 methods
- `NeovimManager` service class exported
- All errors imported from `@fenrir/contracts`
- File compiles standalone
