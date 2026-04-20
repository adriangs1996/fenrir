# Global Actions

## Problem

Fenrir actions are project-scoped. Users who run the same commands across many projects (CTF tools like nmap, gobuster, linpeas) must re-create actions in every project. Global actions solve this by defining commands once and making them available everywhere.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Storage | Hybrid: JSON file for definitions, SQLite for project defaults |
| Type | `GlobalScript` = `ProjectScript` minus `runOnWorktreeCreate` |
| UI grouping | Same dropdown, divider with section labels (Project / Global) |
| Management | From dropdown — "Add global action" link in global section |
| Keybinding conflicts | Project action wins over global action |
| Env vars | `FENRIR_PROJECT_ROOT` and `FENRIR_WORKTREE_PATH` set when available |
| Input | `{{placeholder}}` syntax in command string |
| Defaults | Per-project, first-run capture + edit UI |
| Default behavior | Auto-run with saved defaults; hold ⌥ to show input dialog |
| Output | Terminal panel (same as project actions) |

## Data Model

### GlobalScript

New type in `packages/contracts/src/orchestration.ts`:

```typescript
const GlobalScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,     // supports {{placeholder}} syntax
  icon: ProjectScriptIcon,             // reuse existing icon set
});
```

Mirrors `ProjectScript` without `runOnWorktreeCreate`. The `id` is auto-generated from name (same logic as `nextProjectScriptId`).

### GlobalScriptProjectDefaults

Per-project placeholder defaults:

```typescript
const GlobalScriptProjectDefaults = Schema.Struct({
  scriptId: TrimmedNonEmptyString,
  defaults: Schema.Record(
    Schema.String,   // placeholder name (e.g. "target")
    Schema.String    // default value (e.g. "10.10.11.42")
  ),
});
```

### Placeholder Parsing

Placeholders are extracted at runtime from the command string by matching `{{name}}` patterns. No separate field listing them — the command IS the schema. Duplicate placeholder names resolve to a single input field.

## Storage

### Global action definitions — file-based

Stored at `{stateDir}/global-actions.json` as a JSON array of `GlobalScript`.

Follows the same pattern as `keybindings.json` and `settings.json`:
- In-memory Effect Cache (1-slot)
- PubSub-based change streaming to clients
- Semaphore-guarded concurrent writes
- `FileSystem.watch()` with debounce for external edits
- Atomic writes via temp file + rename

New `ServerDerivedPaths` entry: `globalActionsPath: string` → `{stateDir}/global-actions.json`.

### Project defaults — database

New column on `projection_projects` table:

```sql
ALTER TABLE projection_projects
  ADD COLUMN global_script_defaults_json TEXT;
```

Serialized as JSON array of `GlobalScriptProjectDefaults` using `Schema.fromJsonString(Schema.Array(GlobalScriptProjectDefaults))` — same pattern as `scripts_json`.

Read/written through the existing `project.meta.update` command flow by adding an optional `globalScriptDefaults` field to `ProjectMetaUpdateCommand`. The `OrchestrationProject` read model, `ProjectCreatedPayload`, and `ProjectMetaUpdatedPayload` types must also be extended with `globalScriptDefaults` so clients can read defaults from the orchestration snapshot.

## Service Layer

### GlobalActions service

New file: `apps/server/src/globalActions.ts`

Follows the architecture of `keybindings.ts`:

```
GlobalActions service
├── getAll(): GlobalScript[]
├── create(input): GlobalScript
├── update(id, input): GlobalScript
├── delete(id): void
└── streamChanges(): Stream<GlobalScript[]>
```

### IPC Additions

New methods on `LocalApi.server` in `packages/contracts/src/ipc.ts`:

```typescript
getGlobalActions: () => Promise<GlobalScript[]>
createGlobalAction: (input: CreateGlobalActionInput) => Promise<GlobalScript>
updateGlobalAction: (id: string, input: UpdateGlobalActionInput) => Promise<GlobalScript>
deleteGlobalAction: (id: string) => Promise<void>
upsertGlobalActionKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>
```

Project defaults use existing `project.meta.update` command with a new optional `globalScriptDefaults` field — no new IPC methods needed.

### ServerConfig extension

Add `globalActions: GlobalScript[]` to `ServerConfig` so the client receives global actions on initial config load, same as keybindings.

### Config streaming

Add a new `ServerConfigStreamGlobalActionsUpdatedEvent` to the `ServerConfigStreamEvent` union in `packages/contracts/src/server.ts`. This pushes global action changes to already-connected clients in real time (same pattern as keybindings and settings stream events). Without this, clients only see global actions on initial load and require page refresh to pick up changes.

## UI

### Dropdown — grouped layout

The actions dropdown (`ProjectScriptsControl.tsx`) shows both sections:

```
┌──────────────────────────────┐
│ PROJECT                      │
│  ▶ Build                 ⌘B  │
│  🧪 Test                     │
│  + Add project action        │
│──────────────────────────────│
│ GLOBAL    available in all   │
│  ▶ Nmap Scan            ⌘⇧N  │
│  ▶ Gobuster                  │
│  ▶ LinPEAS                   │
│  + Add global action         │
└──────────────────────────────┘
```

- Section labels are small, uppercase, muted — "PROJECT" and "GLOBAL"
- Global label has subtle "available in all projects" subtext
- Each section has its own "Add action" link
- Edit gear icon on hover (same as project actions)
- When no project actions exist, project section still shows "Add project action"
- When no global actions exist, global section still shows "Add global action"

### Primary button behavior

The top-bar primary button (left of dropdown chevron) shows the preferred project script, same as today. Global actions are only accessible via dropdown or keybinding — they don't become the primary button.

### Add/Edit global action dialog

Same dialog as project actions with two differences:

1. No "Run automatically on worktree creation" toggle
2. Description reads: "Global actions are available in all projects. Run from the top bar or keybindings."

Fields: name, icon picker, keybinding capture, command textarea.

**Placeholder hint**: Below the command textarea, detected `{{placeholders}}` render as small chips/tags. Typing `nmap {{target}} -p {{ports}}` shows `target` and `ports` as visual tags. Gives the user confidence the syntax is correct.

### Placeholder input dialog

Shown when running a global action that has `{{placeholders}}` and no saved defaults:

```
┌──────────────────────────────┐
│ Nmap Scan                    │
│ Fill in values to run        │
│                              │
│ target                       │
│ ┌──────────────────────────┐ │
│ │ 10.10.11.42              │ │
│ └──────────────────────────┘ │
│ 💾 Save as default           │
│                              │
│          [Cancel]  [Run]     │
└──────────────────────────────┘
```

- One input field per unique placeholder
- "Save as default for this project" toggle (on by default)
- On submit: substitute values into command, execute in terminal
- If save toggled: persist defaults via `project.meta.update`

### Subsequent runs with defaults

When project defaults exist for all placeholders:

- Action executes immediately with saved defaults (no dialog)
- Hold ⌥ (Option key on macOS, Alt on Windows/Linux) when clicking → shows input dialog with defaults pre-filled for override
- Resolved command shown as preview in the dialog

### Editing project defaults

From the placeholder input dialog (hold ⌥ to open), user can change values and re-save. No separate "manage defaults" UI needed.

## Execution Flow

1. User clicks global action in dropdown (or triggers via keybinding)
2. Parse `{{placeholders}}` from command string
3. **No placeholders** → execute immediately in terminal
4. **Has placeholders** → check project defaults for this `scriptId`:
   - **Defaults exist for all placeholders** → execute immediately. Hold ⌥ → show input dialog with pre-filled defaults
   - **Defaults missing or partial** → show input dialog
5. Input dialog has "Save as default for this project" toggle (on by default)
6. On submit → substitute all `{{name}}` occurrences → execute in terminal
7. If save-defaults toggled → persist via `project.meta.update`

### Terminal execution

Same path as project actions (`runProjectScript` in `ChatView.tsx`):
- Opens/focuses a terminal
- Sets env vars: `FENRIR_PROJECT_ROOT`, `FENRIR_WORKTREE_PATH` (when available)
- Writes substituted command via `api.terminal.write()`
- Creates new terminal if current one is busy

### Keybinding resolution

Project action keybindings are checked first, global action keybindings second. If both have the same keybinding, project action wins. This mirrors local-overrides-global convention.

Keybinding commands follow the pattern `global-script.{scriptId}.run` (distinct from project `script.{scriptId}.run`).

The `KeybindingCommand` union in `packages/contracts/src/keybindings.ts` must be extended with a new `GLOBAL_SCRIPT_RUN_COMMAND_PATTERN` template literal alongside the existing `SCRIPT_RUN_COMMAND_PATTERN`. Without this, keybinding schema validation rejects `global-script.*` commands.

## Files to Create or Modify

| File | Change |
|------|--------|
| `packages/contracts/src/orchestration.ts` | Add `GlobalScript`, `GlobalScriptProjectDefaults` types |
| `packages/contracts/src/ipc.ts` | Add global action IPC methods |
| `packages/contracts/src/keybindings.ts` | Add `GLOBAL_SCRIPT_RUN_COMMAND_PATTERN` to `KeybindingCommand` union |
| `packages/contracts/src/server.ts` | Add `globalActions` to `ServerConfig`, add `ServerConfigStreamGlobalActionsUpdatedEvent` |
| `apps/server/src/config.ts` | Add `globalActionsPath` to `ServerDerivedPaths` |
| `apps/server/src/globalActions.ts` | New service (CRUD, file watch, streaming) |
| `apps/server/src/persistence/Migrations/` | New migration: add `global_script_defaults_json` column |
| `apps/server/src/persistence/Layers/ProjectionProjects.ts` | Read/write `global_script_defaults_json` |
| `apps/server/src/orchestration/decider.ts` | Handle `globalScriptDefaults` in `project.meta.update` |
| `apps/server/src/orchestration/projector.ts` | Project `globalScriptDefaults` to DB |
| `apps/web/src/components/ProjectScriptsControl.tsx` | Add global section, global action form, placeholder UI |
| `apps/web/src/components/ChatView.tsx` | Add `runGlobalScript` with placeholder resolution |
| `apps/web/src/lib/projectScriptKeybindings.ts` | Support `global-script.{id}.run` pattern |
| `apps/web/src/projectScripts.ts` | Add global script command pattern |

## Out of Scope

- Global actions as primary button in top bar
- Standalone settings page for global actions (can come later)
- Placeholder syntax beyond `{{name}}` (no defaults in syntax, no conditionals)
- Sharing/exporting global actions between machines
