---
depends_on:
  - neovim-10b-chatview-toggle
---

# Plan 10c: Keybinding Default + Shortcut Context + AI File-Reload Hook

## Goal

Wire the Cmd/Ctrl+E shortcut for `neovimEditor.toggle`, add `neovimFocus` to the shortcut context, and trigger `nvim_command "checktime"` after AI file edits.

## Scope

- Modify: `apps/web/src/keybindings.ts` (or wherever `ShortcutMatchContext` lives)
- Modify: file holding the default keybinding config (search for `terminal.toggle` registration)
- Modify: file holding orchestration / AI file-edit event handling (search for `ApplyDiff` or file-write event handlers)
- Modify (existing): `apps/web/src/components/ChatView.tsx` — add `neovimEditor.toggle` to keybinding handler

## Steps

### Step 1. Default keybinding registration

Locate where defaults like `terminal.toggle` are registered (e.g., a `DEFAULT_KEYBINDINGS` array). Add:

```typescript
{
  key: "e",
  command: "neovimEditor.toggle",
  // Use the project's "modKey" convention — Cmd on Mac, Ctrl on Win/Linux.
  // If the type uses "ctrl"/"meta" booleans, set the Mac-aware flag the same way
  // existing entries do.
  // when: omitted → always active
},
```

If the project requires explicit per-platform binding, add both:

```typescript
{ key: "e", modKey: true, command: "neovimEditor.toggle" },
```

Match existing entries 1:1 in shape.

### Step 2. Populate `neovimFocus` at runtime

The `ShortcutMatchContext` type was already broadened with
`neovimFocus?: boolean` in plan 09d (Step 0) so that `useNeovimKeyboard`
could typecheck without depending on this plan. Here we only wire the
runtime assignment.

In `keybindings.ts`, find where the shortcut context is constructed
(search for `terminalFocus`). Add:

```typescript
const editorOpen = useNeovimEditorStore.getState().editorOpen;

const shortcutContext = {
  terminalFocus: isTerminalFocused(),
  terminalOpen: Boolean(terminalState.terminalOpen),
  neovimFocus: editorOpen, // ← ADD (field already declared optional in 09d)
};
```

Do **not** re-narrow the type to `neovimFocus: boolean` — keep the field
optional so the 09d → 10c chain stays acyclic. If you want the runtime
assignment to be exhaustive, leave the type optional and document the
invariant in a JSDoc on the construction site.

### Step 3. Handle `neovimEditor.toggle` in ChatView keybinding handler

In `apps/web/src/components/ChatView.tsx`, locate the existing keybinding command dispatcher (the `useEffect` that listens for resolved commands). Add:

```typescript
if (command === "neovimEditor.toggle") {
  event.preventDefault();
  event.stopPropagation();
  toggleEditor();
  return;
}
```

(`toggleEditor` is the function pulled from the store in 10b.)

### Step 4. AI file-edit → `checktime` hook

Search for where AI file edits are applied or signaled. Likely candidates:

```bash
rg -n "ApplyDiff|applyDiff|file_changed|writeFile" apps/web apps/server
```

Find the event flow that fires after an AI agent writes to a file. Common location: a runtime/orchestration handler in `environments/runtime/` or `apps/server/src/orchestration/`.

In the post-write handler, call:

```typescript
import type { EnvironmentApi } from "~/environmentApi";

async function notifyNeovimFileChanged(api: EnvironmentApi, projectId: string) {
  try {
    await api.neovim.command({ projectId, command: "checktime" });
  } catch {
    // Neovim may not be running for this project — ignore.
  }
}
```

Wire `notifyNeovimFileChanged(api, projectId)` after a successful file edit. If the orchestration code is server-side, expose the same call via the server's `NeovimManager` directly:

```typescript
yield* neovimManager.command(projectId, "checktime").pipe(Effect.ignore);
```

Choose whichever side already owns the file-edit event stream.

### Step 5. Project switching

`NeovimEditor` already disposes its bridge on `projectId` change (09b's effect cleanup). The neovim process for the previous project remains alive on the server (persistent, like tmux). No additional code needed; just confirm:

- Switch project A → B: bridge disconnects from A, spawns/connects to B.
- Switch back A: bridge re-connects to A; A's session was alive, redraw resyncs.

Add a manual-test note in the plan PR description rather than code.

## Validation

- `bun typecheck`
- `bun lint`
- `bun fmt`
- Manual flow:
  1. Open project thread
  2. Cmd+E → editor opens, neovim spawns, canvas renders
  3. Type `ihello world<Esc>` → text persists
  4. Cmd+E → back to chat
  5. Cmd+E → editor returns, text still present
  6. AI agent edits an open file → `:checktime` fires, neovim auto-reloads
  7. Switch project → new neovim instance
  8. Switch back → old instance still alive

## Done Criteria

- Default `Cmd/Ctrl+E` → `neovimEditor.toggle` registered
- `neovimFocus` added to `ShortcutMatchContext` type and runtime context object
- ChatView keybinding handler dispatches `neovimEditor.toggle`
- AI file-edit pipeline fires `nvim_command "checktime"` (best-effort, errors ignored)
- All type checks pass
- All lint checks pass
