# Plan: ChatView Integration + Keybinding

## Summary

Wire the NeovimEditor component into ChatView with Cmd+E toggle, register the keybinding command, update the environment API bridge, and add neovim spawn trigger from the web client.

## Motivation

This is the final integration step that makes neovim accessible to users. Connects all the modules into the existing app shell.

## Prerequisites

- `neovim-01-contracts` (keybinding command, RPC methods)
- `neovim-09-web-editor-component` (NeovimEditor, useNeovimEditorStore)

## Scope

- Modify: `apps/web/src/components/ChatView.tsx` — add editor/chat toggle rendering
- Modify: `apps/web/src/rpc/wsRpcClient.ts` — add neovim namespace
- Modify: `apps/web/src/environmentApi.ts` — add neovim methods
- Modify: `apps/web/src/routes/_chat.tsx` — add global shortcut handler for neovimEditor.toggle
- Modify: `apps/web/src/keybindings.ts` — add neovimFocus context

## Proposed Changes

### 1. Update WsRpcClient — `rpc/wsRpcClient.ts`

Add neovim namespace to WsRpcClient interface:

```typescript
// In WsRpcClient interface:
readonly neovim: {
  readonly spawn: RpcUnaryMethod<typeof WS_METHODS.neovimSpawn>;
  readonly kill: RpcUnaryMethod<typeof WS_METHODS.neovimKill>;
  readonly command: RpcUnaryMethod<typeof WS_METHODS.neovimCommand>;
  readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeNeovimEvents>;
};
```

Add implementation in `createWsRpcClient`:

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

### 2. Update EnvironmentApi — `environmentApi.ts`

Add neovim namespace:

```typescript
// In EnvironmentApi interface:
neovim: {
  spawn: (input: NeovimSpawnInput) => Promise<NeovimSessionSnapshot>;
  kill: (input: NeovimKillInput) => Promise<void>;
  command: (input: NeovimCommandInput) => Promise<void>;
  onEvent: (callback: (event: NeovimEvent) => void) => () => void;
};

// In createEnvironmentApi:
neovim: {
  spawn: (input) => rpcClient.neovim.spawn(input),
  kill: (input) => rpcClient.neovim.kill(input),
  command: (input) => rpcClient.neovim.command(input),
  onEvent: (callback) => rpcClient.neovim.onEvent(callback),
},
```

### 3. Update ChatView — `components/ChatView.tsx`

Add editor view toggle. Key changes:

**Import NeovimEditor**:
```typescript
import { NeovimEditor, useNeovimEditorStore } from "~/modules/neovim-editor";
```

**In the component body** (near other state):
```typescript
const { editorOpen, toggleEditor } = useNeovimEditorStore();
```

**In the keybinding handler** (inside the useEffect at ~line 2438):
```typescript
if (command === "neovimEditor.toggle") {
  event.preventDefault();
  event.stopPropagation();
  toggleEditor();
  return;
}
```

**In the render** (modify the main content area at ~line 3469):

The key architectural change: wrap the chat content in a conditional:

```tsx
{/* Main content area */}
<div className="flex min-h-0 min-w-0 flex-1">
  {editorOpen ? (
    // ── Editor View ──
    <NeovimEditor
      projectId={project?.id ?? ""}
      cwd={project?.cwd ?? ""}
      getAuthToken={getAuthToken}
      serverBaseUrl={serverBaseUrl}
      keybindings={keybindings}
    />
  ) : (
    // ── Chat View (existing) ──
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ... existing messages, composer, branch toolbar ... */}
    </div>
  )}
  {planSidebarOpen && (
    <PlanSidebar /* ... */ />
  )}
</div>
```

**Important**: The terminal drawer should still be visible below the editor when in editor mode. The editor replaces only the chat messages + composer area, not the terminal drawer.

**ChatHeader modification**: Add an editor toggle button to the header:

```tsx
// In ChatHeader or as a new sub-component
<button
  onClick={toggleEditor}
  className={cn(
    "rounded px-2 py-1 text-xs",
    editorOpen ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300"
  )}
  title="Toggle Editor (⌘E)"
>
  {editorOpen ? "Chat" : "Editor"}
</button>
```

### 4. Update Shortcut Context — `keybindings.ts`

Add `neovimFocus` to the shortcut context:

```typescript
// In ShortcutMatchContext type or wherever context is constructed:
const shortcutContext = {
  terminalFocus: isTerminalFocused(),
  terminalOpen: Boolean(terminalState.terminalOpen),
  neovimFocus: editorOpen,  // ← ADD
};
```

This allows keybinding rules to use `when: "!neovimFocus"` to disable shortcuts when editor is focused.

### 5. Neovim Spawn on Editor Open

When the editor opens and no neovim session exists, spawn one:

```typescript
// In NeovimEditor component or a parent wrapper:
useEffect(() => {
  if (!projectId) return;

  // Spawn neovim via JSON RPC if not already running
  api.neovim.spawn({ projectId, cwd }).catch((err) => {
    console.error("[NeovimEditor] Failed to spawn:", err);
    setLastError(err.message);
  });
}, [projectId, cwd]);
```

### 6. AI Integration Hook

When AI agents edit files, notify neovim to reload:

```typescript
// In orchestration event handler (environments/runtime/connection.ts or similar):
// After AI file edit events:
const notifyNeovimOfFileChanges = async (projectId: string) => {
  try {
    await api.neovim.command({ projectId, command: "checktime" });
  } catch {
    // Ignore — neovim might not be running
  }
};
```

This should be wired into the orchestration event pipeline where file changes are processed. Exact location depends on how file edit events flow — look for where `ApplyDiff` or file write events are handled.

### 7. Default Keybinding

Add default keybinding for `neovimEditor.toggle`. This goes in the default keybindings config (wherever defaults are defined):

```typescript
{
  key: "e",
  command: "neovimEditor.toggle",
  // modKey = Cmd on Mac, Ctrl on Windows/Linux
  // when: undefined (always active)
}
```

Check how existing defaults like `terminal.toggle` are registered and follow the same pattern.

### 8. Lifecycle: Project Switching

When the active thread's project changes:
1. Old neovim process stays alive (persistent, like tmux)
2. Binary WebSocket disconnects from old project
3. New project's neovim spawns if needed
4. Binary WebSocket connects to new project

This is handled naturally by `NeovimEditor` receiving a new `projectId` prop — the `useEffect` cleanup in `useNeovimBridge` disconnects the old, and the new effect connects to the new.

## Validation

- `bun typecheck` (all packages)
- `bun lint`
- Manual test flow:
  1. Open app, navigate to a project thread
  2. Press Cmd+E → editor view appears, neovim spawns, canvas renders
  3. Type `ihello world<Esc>` → text appears in editor
  4. Press Cmd+E → back to chat view
  5. Press Cmd+E → editor view returns, neovim state preserved (text still there)
  6. Switch to different project thread → new neovim instance
  7. Switch back → old neovim instance still alive

## Done Criteria

- Cmd+E toggles between chat and editor views
- NeovimEditor renders in ChatView area when active
- Terminal drawer visible below editor (not hidden)
- WsRpcClient has neovim namespace with spawn/kill/command/onEvent
- EnvironmentApi bridge exposes neovim methods
- Neovim auto-spawns when editor opens for a project
- Project switching creates separate neovim instances
- Editor toggle button visible in ChatHeader
- AI file edits trigger `checktime` in active neovim
- All type checks pass
