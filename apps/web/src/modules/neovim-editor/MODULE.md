# Module: Neovim Editor (Web)

> Embedded Neovim editor as a chat workspace view. Single instance per primary desktop host surface; respawned per project cwd. Speaks to the local desktop host adapter via `getDesktopHostAdapter().bridge.editor.*` (currently backed by Electron `window.desktopBridge`).

## Public API

### Stores

#### `useEditorStore` (Zustand — persisted)

| Selector / Action      | Input                | Output                 | Description                                                                           |
| ---------------------- | -------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `activeChatTab`        | —                    | `ChatTab`              | `"thread" \| "gitdiff" \| "editor" \| "terminal"` — global, persisted to localStorage |
| `setActiveChatTab`     | `ChatTab`            | `void`                 | Set active workspace view                                                             |
| `toggleChatTab`        | —                    | `void`                 | Flip between `"thread"` and `"editor"`                                                |
| `currentFile`          | —                    | `string \| null`       | File path from nvim BufEnter; null when no file buffer                                |
| `setCurrentFile`       | `string \| null`     | `void`                 | Hydrated by `useEditorEventListener`                                                  |
| `dirtyFiles`           | —                    | `Set<string>`          | Files with unsaved changes (BufModifiedSet)                                           |
| `setDirty`             | `string, boolean`    | `void`                 | Add/remove from dirty set                                                             |
| `pendingContexts`      | —                    | `EditorContextDraft[]` | Editor context selections awaiting next message send                                  |
| `addPendingContext`    | `EditorContextDraft` | `void`                 | Append to pending queue                                                               |
| `removePendingContext` | `string` (id)        | `void`                 | Remove by id                                                                          |
| `clearPendingContexts` | —                    | `void`                 | Clear all pending contexts                                                            |
| `resetVolatile`        | —                    | `void`                 | Reset `currentFile`, `dirtyFiles`, `pendingContexts`; preserve tab                    |

**Storage:** `fenrir:editor` in localStorage. Only `activeChatTab` persisted via `partialize`.

### Hooks

#### `useActiveEditorCwd` → `string | null`

Derive cwd from active thread. Prefers `thread.worktreePath`, falls back to `project.cwd`. Returns null when no active thread.

**Exported helper:** `resolveEditorCwd(thread, project) → string | null` — pure, testable without React.

#### `useEditorCwdSync` → `void`

Push cwd to desktop bridge across route changes. Mounted at app shell. Shows confirmation dialog when dirty buffers exist on project switch.

**Exported helpers (testable):**

| Function              | Input                                            | Output    | Description                         |
| --------------------- | ------------------------------------------------ | --------- | ----------------------------------- |
| `shouldPush`          | `{ bridgeAvailable, main, cwd, lastPushed }`     | `boolean` | Whether a push should be attempted  |
| `needsDirtyConfirm`   | `dirtyCount: number, lastPushed: string \| null` | `boolean` | Whether to show confirmation dialog |
| `dirtyConfirmMessage` | `dirtyCount: number`                             | `string`  | Build confirmation message text     |

#### `useEditorEventListener` → `void`

Subscribe to nvim → app events from the desktop host adapter's `editor.onEvent`. Mounted at app shell.

**Exported helpers (testable):**

| Function               | Input                            | Output    | Description                                                                                      |
| ---------------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `shouldSubscribe`      | `bridge: boolean, main: boolean` | `boolean` | Whether listener should activate                                                                 |
| `handleEditorEvent`    | `EditorEvent, store, dispatch`   | `void`    | Pure dispatcher: buf_enter→setCurrentFile, buf_write_post→CustomEvent, buf_modified_set→setDirty |
| `BUF_WRITE_POST_EVENT` | —                                | `string`  | `"fenrir:editor:bufWritePost"` constant                                                          |

#### `useEditorSendToComposerListener` → `void`

Subscribe to `:Fenrir send` / visual selection events. Creates `EditorContextDraft`, adds to store, switches to thread tab, focuses composer.

**Exported helpers (testable):**

| Function               | Input                                            | Output                       | Description                                         |
| ---------------------- | ------------------------------------------------ | ---------------------------- | --------------------------------------------------- |
| `shouldSubscribe`      | `bridge: boolean, main: boolean`                 | `boolean`                    | Whether listener should activate                    |
| `handleSendToComposer` | `EditorSendToComposer, threadId: string \| null` | `EditorContextDraft \| null` | Pure draft builder; null if no thread or empty text |

### Components

#### `ComposerPendingEditorContexts`

Renders pending editor context chips in composer. Returns null when contexts array is empty.

| Prop        | Type                                | Description               |
| ----------- | ----------------------------------- | ------------------------- |
| `contexts`  | `ReadonlyArray<EditorContextDraft>` | Pending drafts to display |
| `onRemove`  | `(id: string) => void`              | Remove callback           |
| `className` | `string?`                           | Optional container class  |

#### `ComposerPendingEditorContextChip`

Individual chip: `EditorContextInlineChip` + dismiss button. Shows "expired" styling when context text is empty.

| Prop       | Type                   | Description      |
| ---------- | ---------------------- | ---------------- |
| `context`  | `EditorContextDraft`   | Draft to display |
| `onRemove` | `(id: string) => void` | Remove callback  |

#### `EditorContextInlineChip`

Inline chip with FileCodeIcon, label, and tooltip. Supports expired state with destructive styling.

| Prop          | Type       | Description                                                                                                     |
| ------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `label`       | `string`   | Display text                                                                                                    |
| `tooltipText` | `string`   | Tooltip content (whitespace-pre-wrap, max-w-80)                                                                 |
| `expired`     | `boolean?` | When true: `border-destructive/35 bg-destructive/8 text-destructive`, sets `data-editor-context-expired="true"` |

### Types

| Type                       | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `ChatTab`                  | `"thread" \| "gitdiff" \| "editor" \| "terminal"`      |
| `EditorContextSelection`   | `{ file, lineStart, lineEnd, text }`                   |
| `EditorContextDraft`       | Selection + `{ id, threadId, createdAt }`              |
| `ExtractedEditorContexts`  | `{ promptText, contextCount, previewTitle, contexts }` |
| `ParsedEditorContextEntry` | `{ file, lineStart, lineEnd, body }`                   |

### Utilities (`editorContext.ts`)

#### Normalization & Filtering

| Function                          | Input                               | Output                           | Description                            |
| --------------------------------- | ----------------------------------- | -------------------------------- | -------------------------------------- |
| `normalizeEditorContextText`      | `string`                            | `string`                         | Normalize `\r\n` → `\n`, trim newlines |
| `hasEditorContextText`            | `{ text: string }`                  | `boolean`                        | Non-empty after normalization          |
| `isEditorContextExpired`          | `{ text: string }`                  | `boolean`                        | Inverse of `hasEditorContextText`      |
| `filterEditorContextsWithText`    | `ReadonlyArray<T extends { text }>` | `T[]`                            | Drop expired contexts                  |
| `normalizeEditorContextSelection` | `EditorContextSelection`            | `EditorContextSelection \| null` | Validate + normalize; null if invalid  |

#### Formatting

| Function                         | Input                                   | Output           | Description                                                    |
| -------------------------------- | --------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `formatEditorContextRange`       | `{ lineStart, lineEnd }`                | `string`         | `"line 5"` or `"lines 5-10"`                                   |
| `formatEditorContextLabel`       | `{ file, lineStart, lineEnd }`          | `string`         | `"foo.ts line 5"` or `"foo.ts lines 5-10"`                     |
| `formatInlineEditorContextLabel` | `{ file, lineStart, lineEnd }`          | `string`         | `"@foo.ts:5"` or `"@foo.ts:5-10"`                              |
| `buildEditorContextPreviewTitle` | `ReadonlyArray<EditorContextSelection>` | `string \| null` | Multi-context preview (3 lines max, 180 chars max per context) |

#### Building & Extraction

| Function                        | Input                                       | Output                    | Description                                                                                      |
| ------------------------------- | ------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `buildEditorContextBlock`       | `EditorContextDraft`                        | `string`                  | Build `<editor_context …>…</editor_context>` XML block                                           |
| `appendEditorContextsToPrompt`  | `string, ReadonlyArray<EditorContextDraft>` | `string`                  | Append context blocks to prompt with blank line separator                                        |
| `extractTrailingEditorContexts` | `string`                                    | `ExtractedEditorContexts` | Extract contiguous trailing `<editor_context>` blocks; return separated prompt + parsed contexts |

### Events Consumed

| Event                            | From                           | UI Effect                                                         |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `EditorEvent` (buf_enter)        | nvim BufEnter autocmd          | Hydrate `currentFile` in store                                    |
| `EditorEvent` (buf_write_post)   | nvim BufWritePost              | Dispatch `fenrir:editor:bufWritePost` window CustomEvent          |
| `EditorEvent` (buf_modified_set) | nvim BufModifiedSet            | Update `dirtyFiles` set in store                                  |
| `EditorSendToComposer`           | `:Fenrir send` / `Cmd+Shift+C` | Append `EditorContextDraft`, switch to thread tab, focus composer |
| `EditorCmd`                      | `:Fenrir focus-chat` / etc.    | Flip to thread tab (or route-level command)                       |

### Contracts (from `@fenrir/contracts`)

- `EditorEvent` — Discriminated union: `buf_enter | buf_write_post | buf_modified_set`
- `EditorSendToComposer` — `{ file, lineStart, lineEnd, text }`
- `EditorCmd` — `{ subcommand: "focus-chat" | "new-thread" | "submit" }`
- `ThreadId` — Thread identifier for `EditorContextDraft.threadId`

## Dependencies

### Packages

- `@fenrir/contracts` — Editor event schemas, `ThreadId`
- `zustand` + `zustand/middleware` — State management with localStorage persistence
- `@tanstack/react-router` — `useParams` for active thread resolution
- `lucide-react` — `FileCodeIcon`, `XIcon`

### Internal (from `apps/web/src/`)

- `~/hooks/useDesktopBridge` — `useDesktopBridgeAvailable()`, `useIsMainWindow()`
- `~/store` — `selectProjectByRef`, `selectThreadByRef`, `useStore`
- `~/threadRoutes` — `resolveThreadRouteTarget()`
- `~/lib/storage` — `resolveStorage` for Zustand persistence
- `~/lib/utils` — `cn()`, `randomUUID()`
- `~/components/composerInlineChip` — Chip styling class constants
- `~/components/ui/tooltip` — `Tooltip`, `TooltipPopup`, `TooltipTrigger`

## Filesystem Layout

```
apps/web/src/modules/neovim-editor/
  MODULE.md
  index.ts                                  # Public API barrel export
  editorContext.ts                           # Context types, normalization, XML block build/extract
  stores/
    editorStore.ts                           # Zustand store (persisted tab, volatile nvim state)
    __tests__/
      editorStore.test.ts
  hooks/
    useActiveEditorCwd.ts                    # Resolve cwd from active thread
    useEditorCwdSync.ts                      # Push cwd to bridge on route changes
    useEditorEventListener.ts                # Subscribe to nvim autocmd events
    useEditorSendToComposerListener.ts       # Subscribe to send-to-composer events
    __tests__/
      useActiveEditorCwd.test.ts
      useEditorCwdSync.test.ts
      useEditorEventListener.test.ts
      useEditorSendToComposerListener.test.ts
  components/
    ComposerPendingEditorContexts.tsx        # Pending context chip rail + individual chip
    EditorContextInlineChip.tsx              # Inline chip with tooltip
  __tests__/
    ComposerPendingEditorContexts.test.tsx
    editorContext.test.ts
```

## Integration Points

- **Upstream**: `ChatView.tsx` imports `useEditorStore`, `formatEditorContextLabel`, `appendEditorContextsToPrompt` for composing messages with editor context. `__root.tsx` mounts `useEditorCwdSync` + `useEditorEventListener` + `useEditorSendToComposerListener` in an `EditorCwdSync` render-null component at the app shell level.
- **Downstream**: desktop host adapter bridge (`editor.*`, `neovimSetCwd`, `confirm`). Electron currently implements this as `window.desktopBridge`; future native hosts should provide equivalent adapter semantics without changing this module's public API.
- **Events**: Consumes `EditorEvent`, `EditorSendToComposer`, `EditorCmd` from the desktop host adapter. Emits `fenrir:editor:bufWritePost` window CustomEvent for external listeners (e.g. diff refresh).

## Working On This Module

### For implementers (working INSIDE this module):

- Public API exported from `index.ts` barrel — add exports intentionally.
- Workspace view state (`activeChatTab`) is global; per-thread state intentionally avoided.
- Editor context types mirror terminal context for cohesion — keep parsers in lockstep with `~/modules/terminal/terminalContext.ts`.
- All hooks export pure helper functions alongside the hook for testing without React.
- `editorContext.ts` is pure — no React, no side effects. Test in isolation.

### For consumers (working in OTHER modules):

- Import ONLY from `~/modules/neovim-editor` (barrel). Never import from internal paths.
- The host adapter's `editor.invokeBridge` accepts only whitelisted function names; expand the whitelist in `apps/desktop/src/neovim/NeovimSource.ts` before adding new app→nvim Lua calls.
- `pendingContexts` are cleared by the consumer after message send — call `clearPendingContexts()`.
- Use `extractTrailingEditorContexts()` to parse editor context from received message text for inline chip rendering.
