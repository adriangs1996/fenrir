---
depends_on:
  - neovim-09a-zustand-store
  - neovim-09e-editor-component
  - neovim-09f-statusbar-export
---

# Plan 09g: neovim-editor Module Barrel Export

## Goal

Public barrel for the `neovim-editor` module. Re-exports `NeovimEditor`,
`NeovimEditorStatusBar`, and the zustand store hook + types so consumers
(`ChatView`, `wsRpcClient`, etc.) import via the module root path.

> **Dep-graph note**: extracted from the original `neovim-09f-statusbar-export`
> plan to break the cycle 09e ↔ 09f. The StatusBar component is produced in 09f
> (no dep on 09e); the barrel is produced here (depends on 09e).

## Scope

- New file: `apps/web/src/modules/neovim-editor/index.ts`

## Steps

### Step 1. index.ts barrel

```typescript
export { NeovimEditor } from "./components/NeovimEditor";
export { NeovimEditorStatusBar } from "./components/NeovimEditorStatusBar";
export { useNeovimEditorStore } from "./stores/neovimState";
export type { NeovimConnectionStatus } from "./stores/neovimState";
```

(Match existing module barrel style — some modules omit `export type` block, etc.)

### Step 2. Public surface check

`apps/web/src/components/ChatView.tsx` (touched in plan 10b) imports from `~/modules/neovim-editor`. Confirm path alias resolves; if the project uses a different alias (e.g., `@/modules/...`), use that.

## Validation

- `bun typecheck`
- `bun lint`
- `bun fmt`

## Done Criteria

- `index.ts` exports `NeovimEditor`, `NeovimEditorStatusBar`, `useNeovimEditorStore`, `NeovimConnectionStatus`
- No additional named exports leaked
- `ChatView` and `wsRpcClient` (10a/10b) resolve `~/modules/neovim-editor`
