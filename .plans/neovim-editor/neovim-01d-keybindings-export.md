---
depends_on:
  - neovim-01c-rpc-methods
---

# Plan 01d: Keybindings + Index Export

## Goal

Register `neovimEditor.toggle` keybinding command and export the new `neovim` module from contracts barrel.

## Scope

- Modify: `packages/contracts/src/keybindings.ts`
- Modify: `packages/contracts/src/index.ts`

## Steps

### Step 1. Add command to keybindings

Open `packages/contracts/src/keybindings.ts`. Find `STATIC_KEYBINDING_COMMANDS` array.

Insert `"neovimEditor.toggle"` after `"editor.openFavorite"` (before `...THREAD_KEYBINDING_COMMANDS`):

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

(If neighboring entries differ from this snippet, preserve original ordering — only add `"neovimEditor.toggle"` once.)

### Step 2. Export neovim module

Open `packages/contracts/src/index.ts`. Append:

```typescript
export * from "./neovim";
```

Match existing barrel style (e.g., if other entries use `export * as`, follow that pattern; otherwise use `export *`).

### Step 3. Verify type-level reachability

From `apps/server` and `apps/web`, `import { NeovimSpawnInput } from "@fenrir/contracts"` must resolve. Confirm by running typecheck.

## Validation

- `bun typecheck` (workspace-wide)
- `bun lint`
- `bun fmt`

## Done Criteria

- `neovimEditor.toggle` registered as a keybinding command
- `@fenrir/contracts` exports `Neovim*` schemas, errors, events, RPC defs
- All workspace packages typecheck
