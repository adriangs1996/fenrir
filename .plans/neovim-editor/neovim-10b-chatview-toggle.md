---
depends_on:
  - neovim-09f-statusbar-export
  - neovim-10a-rpc-client-env-api
---

# Plan 10b: ChatView Editor Toggle + Render

## Goal

Add the editor/chat conditional rendering inside `ChatView`, plus a header toggle button.

## Scope

- Modify: `apps/web/src/components/ChatView.tsx`

## Steps

### Step 1. Imports

Add at top of file:

```typescript
import { NeovimEditor, useNeovimEditorStore } from "~/modules/neovim-editor";
```

(Use the project's path alias — confirm by reading current imports in this file.)

### Step 2. Subscribe to editor state

Inside the component body (near other zustand selectors):

```typescript
const editorOpen = useNeovimEditorStore((s) => s.editorOpen);
const toggleEditor = useNeovimEditorStore((s) => s.toggleEditor);
```

### Step 3. Wrap chat content + editor in conditional

Locate the main content `<div>` (currently the messages + composer wrapper, near the existing `planSidebarOpen` conditional). Restructure as:

```tsx
<div className="flex min-h-0 min-w-0 flex-1">
  {editorOpen ? (
    <NeovimEditor
      projectId={project?.id ?? ""}
      cwd={project?.cwd ?? ""}
      getAuthToken={getAuthToken}
      serverBaseUrl={serverBaseUrl}
      keybindings={keybindings}
      spawnNeovim={(input) => api.neovim.spawn(input)}
    />
  ) : (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* existing messages, composer, branch toolbar — leave untouched */}
    </div>
  )}
  {planSidebarOpen && <PlanSidebar /* existing props */ />}
</div>
```

**Important**: the terminal drawer rendered BELOW or ALONGSIDE the chat content must remain visible when `editorOpen` is true. Inspect surrounding markup to ensure the conditional doesn't accidentally swap the wrong subtree.

### Step 4. ChatHeader toggle button

Find the `ChatHeader` JSX (or its props pipeline). Add a button:

```tsx
<button
  type="button"
  onClick={toggleEditor}
  className={cn(
    "rounded px-2 py-1 text-xs",
    editorOpen ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300",
  )}
  title="Toggle Editor (⌘E)"
>
  {editorOpen ? "Chat" : "Editor"}
</button>
```

Place it near other header controls (e.g., terminal toggle). If `ChatHeader` is a sub-component, pipe `editorOpen` and `toggleEditor` as props rather than reading the store inside it.

### Step 5. Required props for `<NeovimEditor>`

Confirm sources for these:
- `getAuthToken` — likely already obtainable from existing auth context. Search for `getAuthToken` usages elsewhere in `ChatView.tsx`; reuse.
- `serverBaseUrl` — env var or context. Match existing usage.
- `keybindings` — same `ResolvedKeybindingsConfig` already used by other handlers in `ChatView`.
- `api` — the `EnvironmentApi` instance currently consumed in this file.

### Step 6. No changes to terminal drawer

Re-read the file to confirm the terminal drawer subtree sits OUTSIDE the conditional you added. If it's nested, hoist it.

## Validation

- `bun typecheck`
- `bun lint`
- `bun fmt`
- Manual: open app, click "Editor" button → editor renders; click again → back to chat. Terminal drawer stays visible in both modes.

## Done Criteria

- Conditional render: `editorOpen ? <NeovimEditor /> : <chat content />`
- Header button toggles `editorOpen`, label flips
- Terminal drawer not accidentally hidden
- All required props passed to `<NeovimEditor>`
- Type errors zero
