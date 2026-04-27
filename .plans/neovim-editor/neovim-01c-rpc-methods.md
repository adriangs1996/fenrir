---
depends_on:
  - neovim-01b-events-errors
---

# Plan 01c: Neovim WS RPC Methods

## Goal

Register neovim WebSocket RPC method names and their `Rpc.make` definitions in `packages/contracts/src/rpc.ts`, then add them to `WsRpcGroup`.

## Scope

- Modify: `packages/contracts/src/rpc.ts`

## Steps

### Step 1. Read existing `rpc.ts` structure

Locate:
- The `WS_METHODS` constant object — check existing entries for prefix style (e.g., `terminal.toggle`, dot-namespaced).
- Existing `Rpc.make` calls — confirm import style.
- The `WsRpcGroup = RpcGroup.make(...)` aggregator.

### Step 2. Import neovim schemas

At top of file, add to existing imports:

```typescript
import {
  NeovimSpawnInput,
  NeovimAttachInput,
  NeovimDetachInput,
  NeovimResizeInput,
  NeovimInputInput,
  NeovimMouseInput,
  NeovimCommandInput,
  NeovimKillInput,
  NeovimSessionSnapshot,
  NeovimEvent,
  NeovimError,
} from "./neovim";
```

### Step 3. Add to `WS_METHODS` object

```typescript
  // Neovim
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

### Step 4. Define RPC entries

Add (alongside existing `Rpc.make` declarations):

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

### Step 5. Register in `WsRpcGroup`

Append the 9 new Rpc constants to the `RpcGroup.make(...)` argument list:

```typescript
export const WsRpcGroup = RpcGroup.make(
  // ... existing entries ...
  WsNeovimSpawnRpc,
  WsNeovimAttachRpc,
  WsNeovimDetachRpc,
  WsNeovimResizeRpc,
  WsNeovimInputRpc,
  WsNeovimMouseRpc,
  WsNeovimCommandRpc,
  WsNeovimKillRpc,
  WsSubscribeNeovimEventsRpc,
);
```

## Validation

- `bun typecheck` passes
- `bun lint` passes
- WS_METHODS exports are flat (no nested objects); follow existing convention

## Done Criteria

- 9 method names in `WS_METHODS`
- 9 `Rpc.make` exports
- All 9 registered in `WsRpcGroup`
- No type errors
