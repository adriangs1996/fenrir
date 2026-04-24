# Module: Terminal (Web)

> Terminal UI state management, xterm.js rendering, and context extraction for thread-scoped terminals.

## Public API

### Stores

#### `useTerminalStateStore` (Zustand)

| Selector/Action              | Input                                      | Output                    | Description                                    |
| ---------------------------- | ------------------------------------------ | ------------------------- | ---------------------------------------------- |
| `selectThreadTerminalState`  | `terminalStateByThreadKey, threadRef`       | `ThreadTerminalState`     | Get terminal UI state for thread               |
| `selectTerminalEventEntries` | `entriesByKey, threadRef, terminalId`       | `TerminalEventEntry[]`    | Get buffered events for terminal               |
| `setTerminalOpen`            | `threadRef, open`                          | `void`                    | Toggle terminal drawer visibility              |
| `setTerminalHeight`          | `threadRef, height`                        | `void`                    | Set terminal drawer height                     |
| `splitTerminal`              | `threadRef, terminalId`                    | `void`                    | Split terminal into active group               |
| `newTerminal`                | `threadRef, terminalId`                    | `void`                    | Create terminal in new group                   |
| `ensureTerminal`             | `threadRef, terminalId, options?`          | `void`                    | Ensure terminal exists, optionally activate     |
| `setActiveTerminal`          | `threadRef, terminalId`                    | `void`                    | Switch active terminal                         |
| `closeTerminal`              | `threadRef, terminalId`                    | `void`                    | Close terminal tab                             |
| `applyTerminalEvent`         | `threadRef, event`                         | `void`                    | Apply server event to UI state                 |
| `recordTerminalEvent`        | `threadRef, event`                         | `void`                    | Buffer event without state mutation             |
| `clearTerminalState`         | `threadRef`                                | `void`                    | Reset terminal state for thread                |
| `removeTerminalState`        | `threadRef`                                | `void`                    | Remove all terminal state for thread           |
| `removeOrphanedTerminalStates` | `activeThreadKeys`                       | `void`                    | Clean up stale thread entries                  |
| `setTerminalLaunchContext`   | `threadRef, context`                       | `void`                    | Store cwd/worktreePath for terminal            |
| `clearTerminalLaunchContext` | `threadRef`                                | `void`                    | Clear launch context                           |
| `setTerminalActivity`        | `threadRef, terminalId, hasSubprocess`     | `void`                    | Update subprocess activity indicator           |
| `setActiveTmuxProject`       | `projectId \| null`                        | `void`                    | Set active tmux project                        |

### Hooks & Utilities

#### Terminal Activity

| Function                             | Input            | Output           | Description                               |
| ------------------------------------ | ---------------- | ---------------- | ----------------------------------------- |
| `terminalRunningSubprocessFromEvent` | `TerminalEvent`  | `boolean \| null`| Extract subprocess state from event       |

#### Terminal Links

| Function                    | Input                  | Output            | Description                             |
| --------------------------- | ---------------------- | ----------------- | --------------------------------------- |
| `extractTerminalLinks`      | `terminal buffer`      | `TerminalLink[]`  | Extract clickable links from output     |
| `isTerminalLinkActivation`  | `mouse event`          | `boolean`         | Detect Cmd/Ctrl+click on link           |
| `resolvePathLinkTarget`     | `rawPath, cwd`         | `string`          | Resolve relative path to absolute       |

#### Terminal Context

| Function / Type              | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `TerminalContextSelection`   | Line range selection from terminal                       |
| `TerminalContextDraft`       | Selection with id, threadId, timestamp                   |
| `normalizeTerminalContextText` | Strip leading/trailing newlines                        |
| `hasTerminalContextText`     | Check if context has content                             |
| `buildTerminalContextBlock`  | Format context for AI prompt                             |
| `parseTerminalContextBlocks` | Extract contexts from message text                       |

#### Terminal Focus

| Function            | Input | Output    | Description                          |
| ------------------- | ----- | --------- | ------------------------------------ |
| `isTerminalFocused` | —     | `boolean` | Check if terminal drawer has focus   |

#### Extract Last Command Output

| Function                   | Input              | Output           | Description                                |
| -------------------------- | ------------------ | ---------------- | ------------------------------------------ |
| `extractLastCommandOutput` | `xterm Terminal`   | `string \| null` | Heuristic prompt detection, extract output |

#### Terminal State Cleanup

| Function                         | Input  | Output          | Description                               |
| -------------------------------- | ------ | --------------- | ----------------------------------------- |
| `collectActiveTerminalThreadIds` | —      | `Set<string>`   | Gather active thread keys for cleanup     |

### Components

#### `ThreadTerminalDrawer`

- Main xterm.js terminal renderer
- Props: threadRef, terminal events, context selection callbacks
- Handles: resize, multi-terminal tabs, groups, copy, clear, links

#### `ComposerPendingTerminalContexts`

- Renders pending terminal context chips in composer

#### `TerminalContextInlineChip`

- Inline chip showing terminal context in message

### Events Consumed

| Event               | From Server              | UI Effect                                    |
| ------------------- | ------------------------ | -------------------------------------------- |
| `started/restarted` | TerminalManager          | Ensure terminal in UI, set active, open drawer |
| `output`            | TerminalManager          | Buffer event, write to xterm                  |
| `exited`            | TerminalManager          | Update status, clear subprocess indicator     |
| `error`             | TerminalManager          | Display error in terminal                     |
| `cleared`           | TerminalManager          | Reset xterm buffer                            |
| `activity`          | TerminalManager          | Update subprocess running indicator           |

### Contracts (from `@fenrir/contracts`)

- `TerminalEvent` — Server event union consumed by store
- `TerminalSessionSnapshot` — Snapshot applied to xterm on open
- `ScopedThreadRef` — Thread identity for state keying
- `ThreadId` — Thread identifier
- `buildTerminalFontFamily` — Font family string for xterm

## Dependencies

### Packages

- `@fenrir/contracts` — Terminal event/snapshot types, font config
- `@fenrir/client-runtime` — `scopedThreadKey`, `parseScopedThreadKey`
- `zustand` + `zustand/middleware` — State management with localStorage persistence
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-serialize` — Terminal rendering
- `lucide-react` — Icons

### Internal (from `apps/web/src/`)

- `types.ts` — `ThreadTerminalGroup`, `DEFAULT_THREAD_TERMINAL_ID`, `MAX_TERMINALS_PER_GROUP`, `getDefaultThreadTerminalHeight`
- `lib/storage.ts` — `resolveStorage` for Zustand persistence
- `store.ts` — `selectThreadByRef`, `useStore` (thread data)
- `keybindings.ts` — Terminal keyboard shortcuts
- `editorPreferences.ts` — Open file in editor from terminal links
- `environmentApi.ts`, `localApi.ts` — RPC client access

## Filesystem Layout

```
apps/web/src/modules/terminal/
  MODULE.md
  index.ts                          # Public API barrel export
  stores/
    terminalState.ts                # Zustand store (from terminalStateStore.ts)
  components/
    ThreadTerminalDrawer.tsx         # Main xterm.js terminal component
    ThreadTerminalDrawer.browser.tsx # Browser-specific variant
    ComposerPendingTerminalContexts.tsx
    TerminalContextInlineChip.tsx
  terminalActivity.ts               # Subprocess activity helpers
  terminalLinks.ts                  # Link extraction from terminal output
  terminalContext.ts                # Context selection for AI prompts
  terminalFocus.ts                  # Focus detection
  extractLastCommandOutput.ts       # Heuristic command output extraction
  terminalStateCleanup.ts           # Orphan state cleanup
  userMessageTerminalContexts.ts    # Terminal context in user messages
  __tests__/
    terminalState.test.ts
    terminalState.tmux.test.ts
    terminalActivity.test.ts
    terminalContext.test.ts
    terminalFocus.test.ts
    terminalLinks.test.ts
    terminalStateCleanup.test.ts
    extractLastCommandOutput.test.ts
    ThreadTerminalDrawer.test.tsx
```

## Integration Points

- **Upstream**: `ChatView.tsx`, `Sidebar.tsx`, `routes/_chat.tsx`, `hooks/useThreadActions.ts`, `environments/runtime/service.ts`, `DiffPanel.tsx`, `GitActionsControl.tsx`
- **Downstream**: `@fenrir/contracts` types, `@fenrir/client-runtime` thread identity, RPC client for server operations
- **Events**: Consumes `TerminalEvent` stream from server via WebSocket RPC subscription

## Working On This Module

### For implementers (working INSIDE this module):

- `stores/terminalState.ts` is the core — most logic lives here
- Components in `components/` depend on stores but not vice-versa
- Utility files (terminalLinks, terminalContext, etc.) are pure/near-pure — test in isolation
- Test coverage exists for all utilities and store logic
- `index.ts` barrel export defines public API — add exports intentionally

### For consumers (working in OTHER modules):

- Import ONLY from `~/modules/terminal` (barrel export)
- Never import from `~/modules/terminal/stores/` or internal files directly
- Terminal state is keyed by `ScopedThreadRef` — always provide scoped ref
- Use `applyTerminalEvent` for server events, not manual state mutations
- Terminal context types are stable — safe to depend on for chat integration
