---
depends_on: []
---

# Plan 09a: Zustand Store

## Goal

Zustand store holding editor view state, active project, connection status, last error, and surface metadata extracted from neovim events.

## Scope

- New file: `apps/web/src/modules/neovim-editor/stores/neovimState.ts`

## Steps

### Step 1. Verify zustand is already a dep

`apps/web/package.json` should already include `zustand`. If not:

```bash
cd apps/web && bun add zustand
```

### Step 2. Create store

```typescript
import { create } from "zustand";

export type NeovimConnectionStatus =
  | "disconnected"
  | "connecting"
  | "attached"
  | "error";

interface NeovimEditorState {
  // View toggle
  editorOpen: boolean;
  toggleEditor: () => void;
  setEditorOpen: (open: boolean) => void;

  // Active project
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;

  // Connection
  sessionStatus: NeovimConnectionStatus;
  setSessionStatus: (status: NeovimConnectionStatus) => void;

  // Errors
  lastError: string | null;
  setLastError: (message: string | null) => void;

  // Surface metadata (from redraw events)
  title: string;
  setTitle: (title: string) => void;
  modeName: string;
  setModeName: (mode: string) => void;
  cursorPosition: { row: number; col: number };
  setCursorPosition: (pos: { row: number; col: number }) => void;
}

export const useNeovimEditorStore = create<NeovimEditorState>((set) => ({
  editorOpen: false,
  toggleEditor: () => set((s) => ({ editorOpen: !s.editorOpen })),
  setEditorOpen: (open) => set({ editorOpen: open }),

  activeProjectId: null,
  setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),

  sessionStatus: "disconnected",
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),

  lastError: null,
  setLastError: (lastError) => set({ lastError }),

  title: "",
  setTitle: (title) => set({ title }),
  modeName: "normal",
  setModeName: (modeName) => set({ modeName }),
  cursorPosition: { row: 0, col: 0 },
  setCursorPosition: (cursorPosition) => set({ cursorPosition }),
}));
```

### Step 3. Selectors note

Consumers should subscribe via narrow selectors (`useNeovimEditorStore((s) => s.editorOpen)`) to avoid unnecessary re-renders. Document this expectation in a JSDoc on the store export.

## Validation

- `bun typecheck`
- `bun lint`

## Done Criteria

- `useNeovimEditorStore` exported with all 7 state slices and matching setters
- `NeovimConnectionStatus` type exported
- Default state: `editorOpen=false`, `sessionStatus="disconnected"`, `modeName="normal"`
