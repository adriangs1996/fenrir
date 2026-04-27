---
depends_on:
  - neovim-03b-manager-spawn
---

# Plan 03c: NeovimManager UI + Input Methods

## Goal

Complete `NeovimManagerLive` by adding `attachUi`, `detachUi`, `resize`, `input`, `inputMouse`, `command` methods and removing the partial `as unknown` cast.

## Scope

- Modify: `apps/server/src/neovim/Layers/NeovimManager.ts` (extend Effect.gen body from 03b)

## Steps

### Step 1. Add session lookup helper

Inside the `Effect.gen` body (after `publishRaw`), add:

```typescript
const requireSession = (projectId: string) =>
  Effect.sync(() => sessions.get(projectId)).pipe(
    Effect.flatMap((s) =>
      s && s.status === "running"
        ? Effect.succeed(s)
        : Effect.fail(new NeovimSessionLookupError({ projectId })),
    ),
  );
```

Add `NeovimAttachError` and `NeovimRpcError` to existing import from `@fenrir/contracts`.

### Step 2. attachUi / detachUi

```typescript
const attachUi = (projectId: string, cols: number, rows: number) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    if (session.uiAttached) {
      return yield* Effect.fail(
        new NeovimAttachError({
          projectId,
          reason: "UI already attached",
        }),
      );
    }
    yield* (session.rpc.request("nvim_ui_attach", [
      cols,
      rows,
      { rgb: true, ext_linegrid: true, ext_multigrid: true },
    ]) as Effect.Effect<unknown, never>).pipe(
      Effect.mapError(
        (cause) =>
          new NeovimAttachError({
            projectId,
            reason: String((cause as Error)?.message ?? cause),
          }),
      ),
    );
    session.uiAttached = true;
  });

const detachUi = (projectId: string) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    if (!session.uiAttached) return;
    yield* Effect.ignoreLogged(session.rpc.request("nvim_ui_detach", []) as any);
    session.uiAttached = false;
  });
```

### Step 3. resize / input / inputMouse

```typescript
const resize = (projectId: string, cols: number, rows: number) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    yield* session.rpc.notify("nvim_ui_try_resize", [cols, rows]);
  });

const input = (projectId: string, keys: string) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    yield* session.rpc.notify("nvim_input", [keys]);
  });

const inputMouse = (
  projectId: string,
  button: string,
  action: string,
  modifier: string,
  grid: number,
  row: number,
  col: number,
) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    yield* session.rpc.notify("nvim_input_mouse", [
      button,
      action,
      modifier,
      grid,
      row,
      col,
    ]);
  });
```

### Step 4. command

```typescript
const command = (projectId: string, cmd: string) =>
  Effect.gen(function* () {
    const session = yield* requireSession(projectId);
    yield* (session.rpc.request("nvim_command", [cmd]) as Effect.Effect<unknown, never>).pipe(
      Effect.mapError(
        (cause) =>
          new NeovimRpcError({
            projectId,
            method: "nvim_command",
            detail: String((cause as Error)?.message ?? cause),
          }),
      ),
    );
  });
```

### Step 5. Final return — replace placeholder cast

Replace the `as unknown as NeovimManagerShape` return from 03b with:

```typescript
return {
  spawn: spawnSession,
  attachUi,
  detachUi,
  resize,
  input,
  inputMouse,
  command,
  kill: killSession,
  hasSession,
  subscribe,
  onRawRedraw,
} satisfies NeovimManagerShape;
```

### Step 6. Scope cleanup

Add finalizer to kill all surviving sessions:

```typescript
yield* Effect.addFinalizer(() =>
  Effect.sync(() => {
    for (const session of sessions.values()) {
      try {
        session.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    sessions.clear();
  }),
);
```

Place this BEFORE the `return` statement.

## Validation

- `bun typecheck` — full type satisfaction (no `as unknown` cast)
- `bun lint`

## Done Criteria

- All 11 `NeovimManagerShape` methods implemented
- `requireSession` handles missing-session lookup error
- `attachUi` rejects re-attach with `NeovimAttachError`
- `command` wraps rpc errors in `NeovimRpcError`
- Scope finalizer kills surviving sessions on layer teardown
- File compiles with `satisfies NeovimManagerShape` (no casts)
