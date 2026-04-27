---
depends_on:
  - neovim-01c-rpc-methods
  - neovim-03c-manager-ui-input
---

# Plan 04a: Neovim JSON RPC Handlers

## Goal

Add lifecycle JSON RPC handlers (`spawn`, `kill`, `command`, `subscribeNeovimEvents`) into the existing JSON RPC WebSocket layer. Binary input/output WS comes in 04b/04c.

## Scope

- Modify: `apps/server/src/ws.ts` (or wherever `makeWsRpcLayer` is defined)

## Steps

### Step 1. Locate handler map

Open `apps/server/src/ws.ts`. Find:
- The Effect.gen body inside `makeWsRpcLayer` (or equivalent layer).
- Existing handler entries like `[WS_METHODS.terminalToggle]: ...`.
- Existing `observeRpcEffect` / `observeRpcStream` helpers.

### Step 2. Add NeovimManager dependency

Inside the `Effect.gen`, after existing service yields:

```typescript
const neovimManager = yield* NeovimManager;
```

Add import:

```typescript
import { NeovimManager } from "./neovim/Services/NeovimManager";
import type { NeovimEvent } from "@fenrir/contracts";
```

(Add `Stream` and `Queue` imports if not present.)

### Step 3. Add handlers to RPC handler map

Append in the handler object (alongside existing entries):

```typescript
[WS_METHODS.neovimSpawn]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimSpawn,
    neovimManager.spawn(input.projectId, input.cwd),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.neovimKill]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimKill,
    neovimManager.kill(input.projectId),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.neovimCommand]: (input) =>
  observeRpcEffect(
    WS_METHODS.neovimCommand,
    neovimManager.command(input.projectId, input.command),
    { "rpc.aggregate": "neovim" },
  ),

[WS_METHODS.subscribeNeovimEvents]: (_input) =>
  observeRpcStream(
    WS_METHODS.subscribeNeovimEvents,
    Stream.callback<NeovimEvent>((queue) =>
      Effect.acquireRelease(
        neovimManager.subscribe((event) => {
          Effect.runFork(Queue.offer(queue, event));
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ),
    { "rpc.aggregate": "neovim" },
  ),
```

### Step 4. Notes

- `attachUi`/`detachUi`/`resize`/`input`/`inputMouse` are NOT exposed via JSON RPC. They flow over the binary WS (04b/04c).
- Match the exact `observeRpcEffect`/`observeRpcStream` shape used by other entries — argument order may differ from the snippet.
- If existing entries use bare property syntax (no comma between handlers), match it.

## Validation

- `bun typecheck`
- `bun lint`
- Manual: open browser, call `wsRpcClient.neovim.spawn({ projectId, cwd })` (after 10a wires the client), expect snapshot response.

## Done Criteria

- 4 RPC handlers added: `neovimSpawn`, `neovimKill`, `neovimCommand`, `subscribeNeovimEvents`
- All handlers use existing telemetry helpers
- `NeovimManager` is yielded from service map
- Type errors in `WS_METHODS.*` keys are zero (depends on 01c registration)
