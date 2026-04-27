---
depends_on:
  - neovim-04b-binary-ws-route
---

# Plan 04c: Binary WebSocket Frame Dispatch

## Goal

Replace the 501 placeholder in `/ws/neovim` with bidirectional binary I/O: forward neovim raw stdout to client; decode incoming command frames and dispatch to NeovimManager.

## Scope

- Modify: `apps/server/src/neovimBinaryWs.ts` (or wherever 04b placed the route)

## Steps

### Step 1. Add msgpack import

```typescript
import { decode } from "@msgpack/msgpack";
```

### Step 2. Define command opcode constants

At module top:

```typescript
const CMD_PING = 0;
const CMD_ATTACH_UI = 1;
const CMD_DETACH_UI = 2;
const CMD_INPUT = 3;
const CMD_MOUSE = 4;
const CMD_RESIZE = 5;
```

### Step 3. Replace 501 placeholder

Substitute the TODO block with the WebSocket upgrade and bidirectional bridge. Concrete shape depends on 04b's chosen approach. Below is the Effect Socket pattern (Approach A):

```typescript
return yield* Effect.gen(function* () {
  const socket = yield* Socket.Socket; // from upgrade

  const socketId = crypto.randomUUID();

  // Stale-connection guard: close prior socket for same projectId
  const prior = activeNeovimConnections.get(projectId);
  if (prior) {
    // Best-effort close; we don't hold the prior socket ref here.
    // Track via a Map<projectId, () => void> for explicit close instead if available.
  }
  activeNeovimConnections.set(projectId, { socketId });

  // ── Downstream: neovim stdout → WebSocket binary frames ──
  const unsubRaw = yield* neovimManager.onRawRedraw(
    (eventProjectId, data) => {
      if (eventProjectId !== projectId) return;
      Effect.runFork(socket.send(data));
    },
  );

  // ── Upstream: WebSocket binary frames → NeovimManager ──
  yield* Stream.fromSocket(socket).pipe(
    Stream.runForEach((frame) =>
      Effect.gen(function* () {
        let cmd: unknown[];
        try {
          cmd = decode(frame) as unknown[];
        } catch {
          return; // malformed frame — ignore
        }
        const op = cmd[0] as number;
        switch (op) {
          case CMD_PING:
            return;
          case CMD_ATTACH_UI:
            yield* neovimManager
              .attachUi(projectId, cmd[1] as number, cmd[2] as number)
              .pipe(Effect.ignoreLogged);
            return;
          case CMD_DETACH_UI:
            yield* neovimManager.detachUi(projectId).pipe(Effect.ignoreLogged);
            return;
          case CMD_INPUT:
            yield* neovimManager
              .input(projectId, cmd[1] as string)
              .pipe(Effect.ignoreLogged);
            return;
          case CMD_MOUSE:
            yield* neovimManager
              .inputMouse(
                projectId,
                cmd[1] as string,
                cmd[2] as string,
                cmd[3] as string,
                cmd[4] as number,
                cmd[5] as number,
                cmd[6] as number,
              )
              .pipe(Effect.ignoreLogged);
            return;
          case CMD_RESIZE:
            yield* neovimManager
              .resize(projectId, cmd[1] as number, cmd[2] as number)
              .pipe(Effect.ignoreLogged);
            return;
          default:
            return; // unknown opcode → ignore (forward compat)
        }
      }),
    ),
  );

  // ── Cleanup on disconnect ──
  unsubRaw();
  activeNeovimConnections.delete(projectId);
  yield* neovimManager.detachUi(projectId).pipe(Effect.ignore);
});
```

### Step 4. Stale-connection eviction

To make the guard active, track an explicit close-handle:

```typescript
const activeNeovimConnections = new Map<string, { close: () => void }>();
```

When a new connection arrives, call `prior.close()`. The close handle for an Effect Socket is typically `socket.close()` exposed via the upgrade primitive or via a Deferred resolved on disconnect.

### Step 5. Frame size note

WebSocket binary frames can be up to 16 MB on most browsers; neovim redraw batches rarely exceed a few KB. No explicit fragmentation needed.

### Step 6. If Approach B (Bun native) used

Replace `Stream.fromSocket` + `socket.send` with Bun's `ws.send()` and `ws.message` callback. The dispatch logic (switch on opcode) stays identical.

## Validation

- `bun typecheck`
- `bun lint`
- Manual end-to-end:
  1. Spawn nvim via JSON RPC `neovim.spawn`
  2. Open binary WS to `/ws/neovim?projectId=xxx&token=yyy`
  3. Send `encode([1, 80, 24])` → expect redraw bytes flowing back
  4. Send `encode([3, "ihello"])` → buffer mutates
  5. Close socket → server-side cleanup runs (no leaked listeners)

## Done Criteria

- Binary WS endpoint exchanges frames bidirectionally
- 6 opcodes dispatched: ping, attach, detach, input, mouse, resize
- Unknown opcodes silently ignored (forward compat)
- Malformed frames silently dropped (no crash)
- Stale connection per projectId is closed on new connect
- Disconnect: `unsubRaw()` runs, UI detached, map entry removed
