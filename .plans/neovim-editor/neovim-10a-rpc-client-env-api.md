---
depends_on:
  - neovim-04a-rpc-handlers
  - neovim-09g-module-barrel
---

# Plan 10a: WsRpcClient + EnvironmentApi (neovim namespace)

## Goal

Expose the JSON RPC `neovim` namespace on both the WebSocket client and the environment-API bridge consumed by the web app.

## Scope

- Modify: `apps/web/src/rpc/wsRpcClient.ts`
- Modify: `apps/web/src/environmentApi.ts`

## Steps

### Step 1. Locate existing namespaces

In `wsRpcClient.ts`, find existing per-namespace blocks (e.g., `terminal: { ... }`). Confirm the `RpcUnaryMethod` / `RpcStreamMethod` helper names used.

### Step 2. Add neovim to the WsRpcClient interface

```typescript
import { WS_METHODS } from "@fenrir/contracts";

// In WsRpcClient interface:
readonly neovim: {
  readonly spawn: RpcUnaryMethod<typeof WS_METHODS.neovimSpawn>;
  readonly kill: RpcUnaryMethod<typeof WS_METHODS.neovimKill>;
  readonly command: RpcUnaryMethod<typeof WS_METHODS.neovimCommand>;
  readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeNeovimEvents>;
};
```

### Step 3. Implement in `createWsRpcClient`

```typescript
neovim: {
  spawn: (input) =>
    transport.request((client) => client[WS_METHODS.neovimSpawn](input)),
  kill: (input) =>
    transport.request((client) => client[WS_METHODS.neovimKill](input)),
  command: (input) =>
    transport.request((client) => client[WS_METHODS.neovimCommand](input)),
  onEvent: (listener, options) =>
    transport.subscribe(
      (client) => client[WS_METHODS.subscribeNeovimEvents]({}),
      listener,
      options,
    ),
},
```

Match the exact `transport.request` / `transport.subscribe` API used by other namespaces.

### Step 4. EnvironmentApi (apps/web/src/environmentApi.ts)

Add to the EnvironmentApi interface (alongside existing namespaces like `terminal`):

```typescript
import type {
  NeovimSpawnInput,
  NeovimKillInput,
  NeovimCommandInput,
  NeovimSessionSnapshot,
  NeovimEvent,
} from "@fenrir/contracts";

// In EnvironmentApi:
neovim: {
  spawn: (input: NeovimSpawnInput) => Promise<NeovimSessionSnapshot>;
  kill: (input: NeovimKillInput) => Promise<void>;
  command: (input: NeovimCommandInput) => Promise<void>;
  onEvent: (callback: (event: NeovimEvent) => void) => () => void;
};
```

### Step 5. Bridge implementation in `createEnvironmentApi`

```typescript
neovim: {
  spawn: (input) => rpcClient.neovim.spawn(input),
  kill: (input) => rpcClient.neovim.kill(input),
  command: (input) => rpcClient.neovim.command(input),
  onEvent: (callback) => rpcClient.neovim.onEvent(callback),
},
```

If the existing pattern wraps results in `Effect.runPromise` or similar, follow it.

## Validation

- `bun typecheck`
- `bun lint`
- Browser smoke: from devtools, `window.__env?.neovim?.spawn?.({ projectId: "x", cwd: "/" })` (if exposed) returns a snapshot

## Done Criteria

- `WsRpcClient.neovim` namespace with 4 methods
- `EnvironmentApi.neovim` namespace with 4 methods
- Type errors zero across `apps/web`
- Pattern matches existing `terminal` / similar namespaces
