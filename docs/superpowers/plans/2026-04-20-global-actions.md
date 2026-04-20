# Global Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add app-wide actions with `{{placeholder}}` inputs and per-project defaults, so users define commands once and use them across all projects.

**Architecture:** Hybrid storage — JSON file (`global-actions.json`) for action definitions (following `keybindings.json` pattern), SQLite for per-project placeholder defaults (extending existing `projection_projects` table). UI integrates into existing actions dropdown with grouped sections. Placeholder resolution happens at execution time.

**Tech Stack:** Effect (Schema, Cache, PubSub, Stream, Semaphore), SQLite, React (Ark UI components), TypeScript

**Spec:** `docs/superpowers/specs/2026-04-20-global-actions-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/contracts/src/orchestration.ts` | `GlobalScript`, `GlobalScriptProjectDefaults` types; extend `OrchestrationProject`, command/event payloads |
| `packages/contracts/src/keybindings.ts` | `GLOBAL_SCRIPT_RUN_COMMAND_PATTERN` template literal; extend `KeybindingCommand` union |
| `packages/contracts/src/server.ts` | `globalActions` on `ServerConfig`; `ServerConfigStreamGlobalActionsUpdatedEvent` |
| `packages/contracts/src/ipc.ts` | Global action CRUD methods on `LocalApi.server` |
| `apps/server/src/config.ts` | `globalActionsPath` on `ServerDerivedPaths` |
| `apps/server/src/globalActions.ts` | New service: CRUD, file watch, PubSub streaming, atomic writes |
| `apps/server/src/persistence/Migrations/023_GlobalScriptDefaults.ts` | New column `global_script_defaults_json` |
| `apps/server/src/persistence/Services/ProjectionProjects.ts` | Extend `ProjectionProject` schema with `globalScriptDefaults` field |
| `apps/server/src/persistence/Layers/ProjectionProjects.ts` | Serialize/deserialize `global_script_defaults_json` (handle NULL for existing rows) |
| `apps/server/src/orchestration/decider.ts` | Handle `globalScriptDefaults` in `project.meta.update` |
| `apps/server/src/orchestration/projector.ts` | Project `globalScriptDefaults` to read model |
| `apps/web/src/projectScripts.ts` | `commandForGlobalScript()`, `globalScriptIdFromCommand()`, `nextGlobalScriptId()` |
| `apps/web/src/lib/projectScriptKeybindings.ts` | Support `global-script.{id}.run` commands |
| `apps/web/src/lib/placeholders.ts` | New: `parsePlaceholders()`, `substitutePlaceholders()` |
| `apps/web/src/components/PlaceholderInputDialog.tsx` | New: dialog for filling placeholder values |
| `apps/web/src/components/ProjectScriptsControl.tsx` | Grouped dropdown, global action add/edit form |
| `apps/web/src/components/ChatView.tsx` | `runGlobalScript()` with placeholder resolution + defaults |

---

### Task 1: Contract Types — GlobalScript and GlobalScriptProjectDefaults

**Files:**
- Modify: `packages/contracts/src/orchestration.ts:126-156` (after ProjectScript, extend OrchestrationProject)

- [ ] **Step 1: Add GlobalScript type**

Add after `ProjectScript` type (after line 143):

```typescript
export const GlobalScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
});
export type GlobalScript = typeof GlobalScript.Type;
```

- [ ] **Step 2: Add GlobalScriptProjectDefaults type**

Add after `GlobalScript`:

```typescript
export const GlobalScriptProjectDefaults = Schema.Struct({
  scriptId: TrimmedNonEmptyString,
  defaults: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type GlobalScriptProjectDefaults = typeof GlobalScriptProjectDefaults.Type;
```

- [ ] **Step 3: Extend OrchestrationProject**

At line 145, add `globalScriptDefaults` to `OrchestrationProject`:

```typescript
export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  globalScriptDefaults: Schema.Array(GlobalScriptProjectDefaults),  // NEW
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
```

- [ ] **Step 4: Extend ProjectMetaUpdateCommand**

Add optional `globalScriptDefaults` field (around line 317):

```typescript
const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  globalScriptDefaults: Schema.optional(Schema.Array(GlobalScriptProjectDefaults)),  // NEW
});
```

- [ ] **Step 5: Extend ProjectCreatedPayload**

Add `globalScriptDefaults` field (around line 652):

```typescript
export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  globalScriptDefaults: Schema.Array(GlobalScriptProjectDefaults),  // NEW
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 6: Extend ProjectMetaUpdatedPayload**

Add optional `globalScriptDefaults` field (around line 663):

```typescript
export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  globalScriptDefaults: Schema.optional(Schema.Array(GlobalScriptProjectDefaults)),  // NEW
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 7: Verify types compile**

Run: `cd packages/contracts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/orchestration.ts
git commit -m "feat(contracts): add GlobalScript and GlobalScriptProjectDefaults types"
```

---

### Task 2: Contract Types — Keybinding Command Pattern

**Files:**
- Modify: `packages/contracts/src/keybindings.ts:42-54`

- [ ] **Step 1: Add GLOBAL_SCRIPT_RUN_COMMAND_PATTERN**

After `SCRIPT_RUN_COMMAND_PATTERN` (line 49), add:

```typescript
export const GLOBAL_SCRIPT_RUN_COMMAND_PATTERN = Schema.TemplateLiteral([
  Schema.Literal("global-script."),
  Schema.NonEmptyString.check(
    Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH),
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  ),
  Schema.Literal(".run"),
]);
```

- [ ] **Step 2: Extend KeybindingCommand union**

Update the union (line 51) to include the new pattern:

```typescript
export const KeybindingCommand = Schema.Union([
  Schema.Literals(STATIC_KEYBINDING_COMMANDS),
  SCRIPT_RUN_COMMAND_PATTERN,
  GLOBAL_SCRIPT_RUN_COMMAND_PATTERN,  // NEW
]);
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/contracts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/keybindings.ts
git commit -m "feat(contracts): add GLOBAL_SCRIPT_RUN_COMMAND_PATTERN to KeybindingCommand"
```

---

### Task 3: Contract Types — ServerConfig and Stream Events

**Files:**
- Modify: `packages/contracts/src/server.ts:87-170`

- [ ] **Step 1: Import GlobalScript**

Add `GlobalScript` to imports from orchestration module at the top of the file.

- [ ] **Step 2: Add globalActions to ServerConfig**

Add to the `ServerConfig` struct (around line 87):

```typescript
export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
  globalActions: Schema.Array(GlobalScript),  // NEW
});
```

- [ ] **Step 3: Add stream event payload type**

Add after the existing `ServerConfigSettingsUpdatedPayload` (before line 156):

```typescript
export const ServerConfigGlobalActionsUpdatedPayload = Schema.Struct({
  globalActions: Schema.Array(GlobalScript),
});
export type ServerConfigGlobalActionsUpdatedPayload =
  typeof ServerConfigGlobalActionsUpdatedPayload.Type;
```

- [ ] **Step 4: Add stream event type**

Add after `ServerConfigStreamSettingsUpdatedEvent` (before line 164):

```typescript
const ServerConfigStreamGlobalActionsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("globalActionsUpdated"),
  payload: ServerConfigGlobalActionsUpdatedPayload,
});
```

- [ ] **Step 5: Extend ServerConfigStreamEvent union**

Add the new event to the union:

```typescript
export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
  ServerConfigStreamGlobalActionsUpdatedEvent,  // NEW
]);
```

- [ ] **Step 6: Verify types compile**

Run: `cd packages/contracts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/server.ts
git commit -m "feat(contracts): add globalActions to ServerConfig and stream events"
```

---

### Task 4: Contract Types — IPC Methods

**Files:**
- Modify: `packages/contracts/src/ipc.ts:241-249`

- [ ] **Step 1: Import new types**

Add `GlobalScript` to imports from orchestration module.

- [ ] **Step 2: Add input/result types for global action CRUD**

Add near other server types:

```typescript
export interface CreateGlobalActionInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
}

export interface UpdateGlobalActionInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
}
```

- [ ] **Step 3: Add global action methods to LocalApi.server**

Extend the `server` property (after line 249):

```typescript
server: {
  getConfig: () => Promise<ServerConfig>;
  refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
  upsertKeybinding: (
    input: ServerUpsertKeybindingInput,
  ) => Promise<ServerUpsertKeybindingResult>;
  getSettings: () => Promise<ServerSettings>;
  updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  // Global actions — NEW
  getGlobalActions: () => Promise<GlobalScript[]>;
  createGlobalAction: (input: CreateGlobalActionInput) => Promise<GlobalScript>;
  updateGlobalAction: (id: string, input: UpdateGlobalActionInput) => Promise<GlobalScript>;
  deleteGlobalAction: (id: string) => Promise<void>;
};
```

Note: `upsertGlobalActionKeybinding` reuses the existing `upsertKeybinding` method — the keybinding system already accepts any `KeybindingCommand`, and we extended that union in Task 2.

- [ ] **Step 4: Verify types compile**

Run: `cd packages/contracts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ipc.ts
git commit -m "feat(contracts): add global action CRUD methods to LocalApi"
```

---

### Task 5: Server — Config Path

**Files:**
- Modify: `apps/server/src/config.ts:19-35,64-91`

- [ ] **Step 1: Add globalActionsPath to ServerDerivedPaths**

```typescript
export interface ServerDerivedPaths {
  // ... existing fields ...
  readonly globalActionsPath: string;  // NEW
}
```

- [ ] **Step 2: Compute path in derivePaths function**

In the path computation function (around line 64-91), add:

```typescript
globalActionsPath: Path.join(stateDir, "global-actions.json"),
```

Follow the same pattern as `keybindingsConfigPath` and `settingsPath`.

- [ ] **Step 3: Verify types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/config.ts
git commit -m "feat(server): add globalActionsPath to ServerDerivedPaths"
```

---

### Task 6: Server — GlobalActions Service

**Files:**
- Create: `apps/server/src/globalActions.ts`

This is the largest task. Follow `serverSettings.ts` pattern exactly.

- [ ] **Step 1: Create service interface and class**

```typescript
import {
  GlobalScript,
  type CreateGlobalActionInput,
  type UpdateGlobalActionInput,
} from "@fenrir/contracts";
import {
  Cache,
  Duration,
  Effect,
  PubSub,
  Schema,
  Semaphore,
  Stream,
  pipe,
} from "effect";
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";
import { ServiceMap } from "./ServiceMap.js";

export class GlobalActionsError {
  readonly _tag = "GlobalActionsError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface GlobalActionsShape {
  readonly start: Effect.Effect<void, GlobalActionsError>;
  readonly ready: Effect.Effect<void, GlobalActionsError>;
  readonly getAll: Effect.Effect<GlobalScript[], GlobalActionsError>;
  readonly create: (
    input: CreateGlobalActionInput,
  ) => Effect.Effect<GlobalScript, GlobalActionsError>;
  readonly update: (
    id: string,
    input: UpdateGlobalActionInput,
  ) => Effect.Effect<GlobalScript, GlobalActionsError>;
  readonly delete: (id: string) => Effect.Effect<void, GlobalActionsError>;
  readonly streamChanges: Stream.Stream<GlobalScript[]>;
}

export class GlobalActionsService extends ServiceMap.Service<
  GlobalActionsService,
  GlobalActionsShape
>()("t3/globalActions/GlobalActionsService") {}
```

- [ ] **Step 2: Implement the service layer**

Add the `make` function following `serverSettings.ts` pattern. Key components:

```typescript
const GlobalActionsArrayCodec = Schema.Array(GlobalScript);
const cacheKey = "globalActions" as const;

export const makeGlobalActionsService = (globalActionsPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const changesPubSub = yield* PubSub.unbounded<GlobalScript[]>();
    const writeSemaphore = yield* Semaphore.make(1);
    const globalActionsDir = Path.dirname(globalActionsPath);

    // Load from disk — return empty array if file doesn't exist
    const loadFromDisk = Effect.gen(function* () {
      const exists = yield* fs.exists(globalActionsPath);
      if (!exists) return [] as GlobalScript[];
      const content = yield* fs.readFileString(globalActionsPath);
      return yield* Schema.decode(Schema.parseJson(GlobalActionsArrayCodec))(content);
    }).pipe(
      Effect.catchAll(() => Effect.succeed([] as GlobalScript[])),
    );

    const actionsCache = yield* Cache.make<typeof cacheKey, GlobalScript[], GlobalActionsError>({
      capacity: 1,
      lookup: () => loadFromDisk,
    });

    // Atomic write — same temp-file + rename pattern as serverSettings.ts (writeSettingsAtomically)
    const writeToDisk = (actions: GlobalScript[]) =>
      writeSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const content = JSON.stringify(actions, null, 2);
          const tmpPath = `${globalActionsPath}.${process.pid}.${Date.now()}.tmp`;
          yield* Effect.succeed(content).pipe(
            Effect.tap(() => fs.makeDirectory(globalActionsDir, { recursive: true })),
            Effect.tap((c) => fs.writeFileString(tmpPath, c)),
            Effect.flatMap(() => fs.rename(tmpPath, globalActionsPath)),
            Effect.ensuring(fs.remove(tmpPath, { force: true }).pipe(Effect.ignore({ log: true }))),
          );
          yield* Cache.invalidate(actionsCache, cacheKey);
          yield* PubSub.publish(changesPubSub, actions);
        }),
      );

    // File watcher — debounced, same pattern as serverSettings.ts
    const watchEffect = Effect.gen(function* () {
      const debouncedEvents = fs.watch(globalActionsDir).pipe(
        Stream.filter((event) =>
          event.path === globalActionsPath || event.path === Path.basename(globalActionsPath),
        ),
        Stream.debounce(Duration.millis(100)),
      );
      yield* debouncedEvents.pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* Cache.invalidate(actionsCache, cacheKey);
            const fresh = yield* Cache.get(actionsCache, cacheKey);
            yield* PubSub.publish(changesPubSub, fresh);
          }),
        ),
      );
    });

    // CRUD operations
    const getAll = Cache.get(actionsCache, cacheKey);

    const create = (input: CreateGlobalActionInput) =>
      Effect.gen(function* () {
        const current = yield* getAll;
        const existingIds = current.map((s) => s.id);
        const id = nextGlobalScriptId(input.name, existingIds);
        const script = Schema.decodeSync(GlobalScript)({
          id,
          name: input.name.trim(),
          command: input.command.trim(),
          icon: input.icon,
        });
        yield* writeToDisk([...current, script]);
        return script;
      });

    const update = (id: string, input: UpdateGlobalActionInput) =>
      Effect.gen(function* () {
        const current = yield* getAll;
        const index = current.findIndex((s) => s.id === id);
        if (index === -1) {
          return yield* Effect.fail(new GlobalActionsError(`Global action not found: ${id}`));
        }
        const updated = Schema.decodeSync(GlobalScript)({
          id,
          name: input.name.trim(),
          command: input.command.trim(),
          icon: input.icon,
        });
        const next = [...current];
        next[index] = updated;
        yield* writeToDisk(next);
        return updated;
      });

    const deleteAction = (id: string) =>
      Effect.gen(function* () {
        const current = yield* getAll;
        const next = current.filter((s) => s.id !== id);
        if (next.length === current.length) {
          return yield* Effect.fail(new GlobalActionsError(`Global action not found: ${id}`));
        }
        yield* writeToDisk(next);
      });

    return GlobalActionsService.of({
      start: watchEffect.pipe(Effect.forkDaemon, Effect.asVoid),
      ready: Effect.void,
      getAll,
      create,
      update,
      delete: deleteAction,
      streamChanges: Stream.fromPubSub(changesPubSub),
    });
  });
```

Note: `nextGlobalScriptId` helper is the same normalization logic as `nextProjectScriptId` from `apps/web/src/projectScripts.ts`. Inline it here since the server can't import from the web package:

```typescript
function normalizeScriptId(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return "script";
  if (cleaned.length <= 64) return cleaned;
  return cleaned.slice(0, 64).replace(/-+$/g, "") || "script";
}

function nextGlobalScriptId(name: string, existingIds: string[]): string {
  const taken = new Set(existingIds);
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;
  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
  }
  return `${baseId}-${Date.now()}`.slice(0, 64);
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/globalActions.ts
git commit -m "feat(server): add GlobalActions file-based service with CRUD and file watch"
```

---

### Task 7: Server — Wire GlobalActions Into Config Stream

**Files:**
- Modify: The server file that builds `ServerConfig` and streams config events to clients

- [ ] **Step 1: Find and update the ServerConfig builder**

Search for where `ServerConfig` is constructed (likely in the server's main setup or an RPC handler). Add `globalActions` field by calling `GlobalActionsService.getAll`.

- [ ] **Step 2: Wire stream events**

Find where `ServerConfigStreamEvent` events are emitted (likely near keybindings/settings stream handling). Add a parallel stream from `GlobalActionsService.streamChanges` that maps to:

```typescript
{
  version: 1 as const,
  type: "globalActionsUpdated" as const,
  payload: { globalActions },
}
```

Merge this stream into the existing config stream, same as keybindings and settings.

- [ ] **Step 3: Wire IPC handlers**

Find where `LocalApi.server` methods are implemented. Add handlers for the 4 new methods that delegate to `GlobalActionsService`:

```typescript
getGlobalActions: () => Effect.runPromise(GlobalActionsService.getAll),
createGlobalAction: (input) => Effect.runPromise(GlobalActionsService.create(input)),
updateGlobalAction: (id, input) => Effect.runPromise(GlobalActionsService.update(id, input)),
deleteGlobalAction: (id) => Effect.runPromise(GlobalActionsService.delete(id)),
```

Adapt to whatever Effect runtime pattern the existing handlers use.

- [ ] **Step 4: Verify types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): wire GlobalActions into config stream and IPC handlers"
```

---

### Task 8: Server — Database Migration for Project Defaults

**Files:**
- Create: `apps/server/src/persistence/Migrations/023_GlobalScriptDefaults.ts`
- Modify: Migration index file (import + register the new migration)

- [ ] **Step 1: Create migration file**

Follow the pattern from `021_AuthSessionClientMetadata.ts`:

```typescript
import { Effect } from "effect";
import { SqlClient } from "@effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("global_script_defaults_json")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN global_script_defaults_json TEXT`;
  }
});
```

- [ ] **Step 2: Register migration**

Find the migration index/registry file and add the new migration in order.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/persistence/Migrations/023_GlobalScriptDefaults.ts
git commit -m "feat(server): add migration for global_script_defaults_json column"
```

---

### Task 9: Server — ProjectionProjects Serialization

**Files:**
- Modify: `apps/server/src/persistence/Services/ProjectionProjects.ts` (base schema)
- Modify: `apps/server/src/persistence/Layers/ProjectionProjects.ts:15-79` (DB layer)

- [ ] **Step 0: Extend ProjectionProject base schema**

The `ProjectionProject` schema is defined in `apps/server/src/persistence/Services/ProjectionProjects.ts`. Add `globalScriptDefaults` field to it:

```typescript
import { GlobalScriptProjectDefaults } from "@fenrir/contracts";

// Add to the ProjectionProject schema struct:
globalScriptDefaults: Schema.Array(GlobalScriptProjectDefaults),
```

This is required because the Layers file uses `ProjectionProject.mapFields(...)` — the base schema must have the field for `mapFields` to remap it.

- [ ] **Step 1: Add GlobalScriptProjectDefaults to DB row schema**

Extend `ProjectionProjectDbRow` field mapping (around line 15):

```typescript
const ProjectionProjectDbRow = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    // NEW — use Schema.transform to map NULL → [] for existing rows
    globalScriptDefaults: Schema.transform(
      Schema.NullOr(Schema.fromJsonString(Schema.Array(GlobalScriptProjectDefaults))),
      Schema.Array(GlobalScriptProjectDefaults),
      { decode: (v) => v ?? [], encode: (v) => v },
    ),
  }),
);
```

Import `GlobalScriptProjectDefaults` from contracts.

**Important:** The column has no DEFAULT — existing rows have NULL. The `Schema.transform` converts NULL → `[]` on decode, satisfying the base schema's non-nullable array type.

- [ ] **Step 2: Update upsert to serialize**

In the INSERT statement (around line 26-60), add `global_script_defaults_json` column:
- INSERT value: `JSON.stringify(row.globalScriptDefaults ?? [])`
- ON CONFLICT UPDATE: `excluded.global_script_defaults_json`

- [ ] **Step 3: Update SELECT to deserialize**

In the SELECT query (around line 62-79), add column alias:
- `global_script_defaults_json AS "globalScriptDefaults"`

Schema auto-deserializes via `Schema.fromJsonString()`.

- [ ] **Step 4: Verify types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence/Services/ProjectionProjects.ts apps/server/src/persistence/Layers/ProjectionProjects.ts
git commit -m "feat(server): serialize/deserialize globalScriptDefaults in ProjectionProjects"
```

---

### Task 10: Server — Decider and Projector

**Files:**
- Modify: `apps/server/src/orchestration/decider.ts:88-114`
- Modify: `apps/server/src/orchestration/projector.ts:204-225`

- [ ] **Step 1: Extend decider — project.meta.update case**

Add `globalScriptDefaults` to the event payload construction (around line 88-114). Follow the existing ternary spread pattern:

```typescript
case "project.meta.update": {
  yield* requireProject({ readModel, command, projectId: command.projectId });
  const occurredAt = nowIso();
  return {
    ...withEventBase({
      aggregateKind: "project",
      aggregateId: command.projectId,
      occurredAt,
      commandId: command.commandId,
    }),
    type: "project.meta-updated",
    payload: {
      projectId: command.projectId,
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
      ...(command.defaultModelSelection !== undefined
        ? { defaultModelSelection: command.defaultModelSelection }
        : {}),
      ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
      ...(command.globalScriptDefaults !== undefined                              // NEW
        ? { globalScriptDefaults: command.globalScriptDefaults }                  // NEW
        : {}),                                                                     // NEW
      updatedAt: occurredAt,
    },
  };
}
```

- [ ] **Step 2: Extend projector — project.meta-updated case**

Add `globalScriptDefaults` to the projection (around line 204-225). Follow the same ternary spread pattern:

```typescript
case "project.meta-updated":
  return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
    Effect.map((payload) => ({
      ...nextBase,
      projects: nextBase.projects.map((project) =>
        project.id === payload.projectId
          ? {
              ...project,
              ...(payload.title !== undefined ? { title: payload.title } : {}),
              ...(payload.workspaceRoot !== undefined
                ? { workspaceRoot: payload.workspaceRoot }
                : {}),
              ...(payload.defaultModelSelection !== undefined
                ? { defaultModelSelection: payload.defaultModelSelection }
                : {}),
              ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
              ...(payload.globalScriptDefaults !== undefined                       // NEW
                ? { globalScriptDefaults: payload.globalScriptDefaults }           // NEW
                : {}),                                                              // NEW
              updatedAt: payload.updatedAt,
            }
          : project,
      ),
    })),
  );
```

- [ ] **Step 3: Also check the project.created case in projector**

Find where `project.created` is projected and ensure `globalScriptDefaults` is included (default to `[]` if not present in payload).

- [ ] **Step 4: Verify types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/decider.ts apps/server/src/orchestration/projector.ts
git commit -m "feat(server): handle globalScriptDefaults in decider and projector"
```

---

### Task 11: Web — Placeholder Utilities

**Files:**
- Create: `apps/web/src/lib/placeholders.ts`
- Create: `apps/web/src/lib/placeholders.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { parsePlaceholders, substitutePlaceholders } from "./placeholders";

describe("parsePlaceholders", () => {
  test("extracts unique placeholder names", () => {
    expect(parsePlaceholders("nmap {{target}} -p {{ports}}")).toEqual(["target", "ports"]);
  });

  test("deduplicates repeated placeholders", () => {
    expect(parsePlaceholders("nmap {{target}} -oN {{target}}.txt")).toEqual(["target"]);
  });

  test("returns empty array when no placeholders", () => {
    expect(parsePlaceholders("ls -la")).toEqual([]);
  });

  test("handles adjacent placeholders", () => {
    expect(parsePlaceholders("{{a}}{{b}}")).toEqual(["a", "b"]);
  });

  test("only matches word characters in placeholder names", () => {
    expect(parsePlaceholders("{{valid}} {{in valid}} {{also_valid}}")).toEqual([
      "valid",
      "also_valid",
    ]);
  });
});

describe("substitutePlaceholders", () => {
  test("replaces all occurrences", () => {
    expect(
      substitutePlaceholders("nmap {{target}} -oN {{target}}.txt", { target: "10.10.11.42" }),
    ).toBe("nmap 10.10.11.42 -oN 10.10.11.42.txt");
  });

  test("replaces multiple different placeholders", () => {
    expect(
      substitutePlaceholders("nmap {{target}} -p {{ports}}", {
        target: "10.10.11.42",
        ports: "1-1000",
      }),
    ).toBe("nmap 10.10.11.42 -p 1-1000");
  });

  test("leaves unmatched placeholders untouched", () => {
    expect(substitutePlaceholders("nmap {{target}} -p {{ports}}", { target: "10.10.11.42" })).toBe(
      "nmap 10.10.11.42 -p {{ports}}",
    );
  });

  test("returns original when no placeholders", () => {
    expect(substitutePlaceholders("ls -la", {})).toBe("ls -la");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && bun test src/lib/placeholders.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement placeholders.ts**

```typescript
const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g;

export function parsePlaceholders(command: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of command.matchAll(PLACEHOLDER_REGEX)) {
    const name = match[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export function substitutePlaceholders(
  command: string,
  values: Record<string, string>,
): string {
  return command.replace(PLACEHOLDER_REGEX, (full, name: string) =>
    name in values ? values[name]! : full,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && bun test src/lib/placeholders.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/placeholders.ts apps/web/src/lib/placeholders.test.ts
git commit -m "feat(web): add placeholder parsing and substitution utilities"
```

---

### Task 12: Web — Global Script Keybinding Helpers

**Files:**
- Modify: `apps/web/src/projectScripts.ts`
- Modify: `apps/web/src/lib/projectScriptKeybindings.ts`

- [ ] **Step 1: Add global script helpers to projectScripts.ts**

Add imports and new functions after existing ones:

```typescript
import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  GLOBAL_SCRIPT_RUN_COMMAND_PATTERN,  // NEW
  type KeybindingCommand,
  type ProjectScript,
  type GlobalScript,  // NEW
} from "@fenrir/contracts";

// ... existing functions ...

// NEW: Global script command helpers
export const commandForGlobalScript = (scriptId: string): KeybindingCommand =>
  GLOBAL_SCRIPT_RUN_COMMAND_PATTERN.makeUnsafe(`global-script.${scriptId}.run`);

export function globalScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!Schema.is(GLOBAL_SCRIPT_RUN_COMMAND_PATTERN)(trimmed)) return null;
  const [prefix, , suffix] = GLOBAL_SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextGlobalScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) return safeCandidate;
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}
```

- [ ] **Step 2: Update projectScriptKeybindings.ts**

The existing `decodeProjectScriptKeybindingRule` and `keybindingValueForCommand` functions already work with any `KeybindingCommand`. No changes needed — they accept the union type which now includes `GLOBAL_SCRIPT_RUN_COMMAND_PATTERN`.

Verify this by checking that `commandForGlobalScript()` returns a `KeybindingCommand` (it does, since we extended the union in Task 2).

- [ ] **Step 3: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/projectScripts.ts
git commit -m "feat(web): add global script command and ID helpers"
```

---

### Task 13: Web — PlaceholderInputDialog Component

**Files:**
- Create: `apps/web/src/components/PlaceholderInputDialog.tsx`

- [ ] **Step 1: Create the dialog component**

This dialog shows input fields for each placeholder in a global action command. It handles:
- Displaying one field per unique placeholder
- Pre-filling with project defaults when available
- "Save as default for this project" toggle (on by default)
- Showing resolved command preview

```typescript
import type { GlobalScript, GlobalScriptProjectDefaults } from "@fenrir/contracts";
import React, { type FormEvent, useState, useMemo } from "react";
import { parsePlaceholders, substitutePlaceholders } from "~/lib/placeholders";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface PlaceholderInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script: GlobalScript;
  defaults: GlobalScriptProjectDefaults | null;
  onRun: (values: Record<string, string>, saveAsDefault: boolean) => void;
}

export default function PlaceholderInputDialog({
  open,
  onOpenChange,
  script,
  defaults,
  onRun,
}: PlaceholderInputDialogProps) {
  const placeholders = useMemo(() => parsePlaceholders(script.command), [script.command]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const name of placeholders) {
      initial[name] = defaults?.defaults[name] ?? "";
    }
    return initial;
  });
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // Reset values when dialog opens with new script/defaults
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const name of placeholders) {
        initial[name] = defaults?.defaults[name] ?? "";
      }
      setValues(initial);
      setSaveAsDefault(true);
    }
  }, [open, script.id, defaults, placeholders]);

  const resolvedCommand = useMemo(
    () => substitutePlaceholders(script.command, values),
    [script.command, values],
  );

  const allFilled = placeholders.every((name) => (values[name] ?? "").trim().length > 0);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!allFilled) return;
    onRun(values, saveAsDefault);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{script.name}</DialogTitle>
          <DialogDescription>Fill in the values to run this action</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="placeholder-form" className="space-y-4" onSubmit={handleSubmit}>
            {placeholders.map((name) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`placeholder-${name}`}>
                  <code className="text-xs">{name}</code>
                </Label>
                <Input
                  id={`placeholder-${name}`}
                  autoFocus={placeholders[0] === name}
                  placeholder={name}
                  value={values[name] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                />
              </div>
            ))}

            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
              <span>Save as default for this project</span>
              <Switch
                checked={saveAsDefault}
                onCheckedChange={(checked) => setSaveAsDefault(Boolean(checked))}
              />
            </label>

            {/* Command preview */}
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-1">Command preview</p>
              <code className="text-xs break-all">{resolvedCommand}</code>
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button form="placeholder-form" type="submit" disabled={!allFilled}>
            Run
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PlaceholderInputDialog.tsx
git commit -m "feat(web): add PlaceholderInputDialog component"
```

---

### Task 14: Web — Grouped Dropdown in ProjectScriptsControl

**Files:**
- Modify: `apps/web/src/components/ProjectScriptsControl.tsx`

This is a UI-heavy task. The component needs new props and a restructured dropdown.

- [ ] **Step 1: Add new props to interface**

```typescript
interface ProjectScriptsControlProps {
  scripts: ProjectScript[];
  globalScripts: GlobalScript[];                                     // NEW
  globalScriptDefaults: GlobalScriptProjectDefaults[];               // NEW
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onRunGlobalScript: (script: GlobalScript, altKey: boolean) => void; // NEW
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
  onAddGlobalScript: (input: NewGlobalScriptInput) => Promise<void> | void;       // NEW
  onUpdateGlobalScript: (scriptId: string, input: NewGlobalScriptInput) => Promise<void> | void; // NEW
  onDeleteGlobalScript: (scriptId: string) => Promise<void> | void;               // NEW
}

// NEW input type (no runOnWorktreeCreate)
export interface NewGlobalScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  keybinding: string | null;
}
```

- [ ] **Step 2: Add state for global action editing**

Add alongside existing state variables:

```typescript
const [editingGlobalScriptId, setEditingGlobalScriptId] = useState<string | null>(null);
const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
// Reuse name, command, icon, keybinding state — add a flag to track which dialog type
const [isGlobalDialog, setIsGlobalDialog] = useState(false);
```

- [ ] **Step 3: Restructure dropdown menu with grouped sections**

Replace the single list of `scripts.map(...)` with two sections:

```tsx
<MenuPopup align="end">
  {/* PROJECT section */}
  <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
    Project
  </div>
  {scripts.map((script) => (
    /* existing MenuItem code unchanged */
  ))}
  <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
    <PlusIcon className="size-4" />
    Add project action
  </MenuItem>

  {/* Divider */}
  <div className="mx-2 my-1 border-t border-border/50" />

  {/* GLOBAL section */}
  <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
    Global
    <span className="ml-1.5 text-[9px] font-normal normal-case tracking-normal opacity-70">
      available in all projects
    </span>
  </div>
  {globalScripts.map((script) => {
    const shortcutLabel = shortcutLabelForCommand(
      keybindings,
      commandForGlobalScript(script.id),
    );
    return (
      <MenuItem
        key={script.id}
        className={`group ${dropdownItemClassName}`}
        onClick={(event: React.MouseEvent) =>
          onRunGlobalScript(script, event.altKey)
        }
      >
        <ScriptIcon icon={script.icon} className="size-4" />
        <span className="truncate">{script.name}</span>
        <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
          {shortcutLabel && (
            <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
              {shortcutLabel}
            </MenuShortcut>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
            aria-label={`Edit ${script.name}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openEditGlobalDialog(script);
            }}
          >
            <SettingsIcon className="size-3.5" />
          </Button>
        </span>
      </MenuItem>
    );
  })}
  <MenuItem className={dropdownItemClassName} onClick={openAddGlobalDialog}>
    <PlusIcon className="size-4" />
    Add global action
  </MenuItem>
</MenuPopup>
```

Import `commandForGlobalScript` from `~/projectScripts`.

- [ ] **Step 4: Add global action dialog**

Add a second `Dialog` for global actions (or reuse the existing one with conditional rendering based on `isGlobalDialog` flag). Key differences from project dialog:
- No `runOnWorktreeCreate` toggle
- Description: "Global actions are available in all projects. Run from the top bar or keybindings."
- Add placeholder hint chips below command textarea:

```tsx
{/* Placeholder chips — shown in global action dialog */}
{isGlobalDialog && command.includes("{{") && (
  <div className="flex flex-wrap gap-1.5">
    {parsePlaceholders(command).map((name) => (
      <span
        key={name}
        className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono text-primary"
      >
        {name}
      </span>
    ))}
  </div>
)}
```

Import `parsePlaceholders` from `~/lib/placeholders`.

- [ ] **Step 5: Add open/submit handlers for global dialog**

```typescript
const openAddGlobalDialog = () => {
  setIsGlobalDialog(true);
  setEditingGlobalScriptId(null);
  setName("");
  setCommand("");
  setIcon("play");
  setKeybinding("");
  setValidationError(null);
  setGlobalDialogOpen(true);
};

const openEditGlobalDialog = (script: GlobalScript) => {
  setIsGlobalDialog(true);
  setEditingGlobalScriptId(script.id);
  setName(script.name);
  setCommand(script.command);
  setIcon(script.icon);
  setKeybinding(
    keybindingValueForCommand(keybindings, commandForGlobalScript(script.id)) ?? "",
  );
  setValidationError(null);
  setGlobalDialogOpen(true);
};

const submitGlobalScript = async (event: FormEvent) => {
  event.preventDefault();
  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  if (trimmedName.length === 0) { setValidationError("Name is required."); return; }
  if (trimmedCommand.length === 0) { setValidationError("Command is required."); return; }

  setValidationError(null);
  try {
    const payload: NewGlobalScriptInput = {
      name: trimmedName,
      command: trimmedCommand,
      icon,
      keybinding: keybinding || null,
    };
    if (editingGlobalScriptId) {
      await onUpdateGlobalScript(editingGlobalScriptId, payload);
    } else {
      await onAddGlobalScript(payload);
    }
    setGlobalDialogOpen(false);
  } catch (error) {
    setValidationError(error instanceof Error ? error.message : "Failed to save action.");
  }
};
```

- [ ] **Step 6: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ProjectScriptsControl.tsx
git commit -m "feat(web): add grouped dropdown with global actions section and form"
```

---

### Task 15: Web — Execution Logic in ChatView

**Files:**
- Modify: `apps/web/src/components/ChatView.tsx:1600-1836`

- [ ] **Step 1: Add global action CRUD functions**

Follow the pattern of `saveProjectScript`, `updateProjectScript`, `deleteProjectScript`. These call IPC methods instead of orchestration commands:

```typescript
const saveGlobalScript = useCallback(
  async (input: NewGlobalScriptInput) => {
    const script = await localApi.server.createGlobalAction({
      name: input.name,
      command: input.command,
      icon: input.icon,
    });
    if (input.keybinding) {
      const rule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: commandForGlobalScript(script.id),
      });
      if (rule) {
        await localApi.server.upsertKeybinding({
          key: rule.key,
          command: rule.command,
        });
      }
    }
  },
  [localApi],
);

const updateGlobalScript = useCallback(
  async (scriptId: string, input: NewGlobalScriptInput) => {
    await localApi.server.updateGlobalAction(scriptId, {
      name: input.name,
      command: input.command,
      icon: input.icon,
    });
    if (input.keybinding) {
      const rule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: commandForGlobalScript(scriptId),
      });
      if (rule) {
        await localApi.server.upsertKeybinding({
          key: rule.key,
          command: rule.command,
        });
      }
    }
  },
  [localApi],
);

const deleteGlobalScript = useCallback(
  async (scriptId: string) => {
    await localApi.server.deleteGlobalAction(scriptId);
  },
  [localApi],
);
```

- [ ] **Step 2: Add runGlobalScript function**

This is the core execution logic with placeholder resolution:

```typescript
const [placeholderDialogOpen, setPlaceholderDialogOpen] = useState(false);
const [pendingGlobalScript, setPendingGlobalScript] = useState<GlobalScript | null>(null);

const runGlobalScript = useCallback(
  async (script: GlobalScript, altKey: boolean) => {
    const placeholders = parsePlaceholders(script.command);

    if (placeholders.length === 0) {
      // No placeholders — run immediately (same as runProjectScript)
      await executeInTerminal(script.command, script.name);
      return;
    }

    // Check project defaults
    const projectDefaults = activeProject?.globalScriptDefaults?.find(
      (d) => d.scriptId === script.id,
    );
    const allDefaultsFilled = projectDefaults
      ? placeholders.every((name) => (projectDefaults.defaults[name] ?? "").length > 0)
      : false;

    if (allDefaultsFilled && !altKey) {
      // Defaults exist and user didn't hold Alt — run immediately
      const resolved = substitutePlaceholders(script.command, projectDefaults!.defaults);
      await executeInTerminal(resolved, script.name);
      return;
    }

    // Show placeholder input dialog
    setPendingGlobalScript(script);
    setPlaceholderDialogOpen(true);
  },
  [activeProject, /* executeInTerminal */],
);
```

- [ ] **Step 3: Add placeholder dialog run handler**

```typescript
const handlePlaceholderRun = useCallback(
  async (values: Record<string, string>, saveAsDefault: boolean) => {
    if (!pendingGlobalScript || !activeProject) return;
    const resolved = substitutePlaceholders(pendingGlobalScript.command, values);
    await executeInTerminal(resolved, pendingGlobalScript.name);

    if (saveAsDefault) {
      // Update project defaults
      const currentDefaults = activeProject.globalScriptDefaults ?? [];
      const existingIndex = currentDefaults.findIndex(
        (d) => d.scriptId === pendingGlobalScript.id,
      );
      const newEntry = { scriptId: pendingGlobalScript.id, defaults: values };
      const nextDefaults =
        existingIndex >= 0
          ? currentDefaults.map((d, i) => (i === existingIndex ? newEntry : d))
          : [...currentDefaults, newEntry];

      // Persist via project.meta.update
      await dispatch({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: activeProject.id,
        globalScriptDefaults: nextDefaults,
      });
    }
    setPendingGlobalScript(null);
  },
  [pendingGlobalScript, activeProject, dispatch],
);
```

Note: `executeInTerminal` is a reference to the terminal execution logic already in `runProjectScript`. Extract the terminal open/write portion into a shared helper, or inline the same logic. The key steps are:
1. Open/focus terminal
2. Set env vars (`FENRIR_PROJECT_ROOT`, `FENRIR_WORKTREE_PATH` when available)
3. Write command via `api.terminal.write()`

- [ ] **Step 4: Add PlaceholderInputDialog to JSX**

Import and render the dialog:

```tsx
import PlaceholderInputDialog from "./PlaceholderInputDialog";

// In the JSX return:
{pendingGlobalScript && (
  <PlaceholderInputDialog
    open={placeholderDialogOpen}
    onOpenChange={setPlaceholderDialogOpen}
    script={pendingGlobalScript}
    defaults={
      activeProject?.globalScriptDefaults?.find(
        (d) => d.scriptId === pendingGlobalScript.id,
      ) ?? null
    }
    onRun={handlePlaceholderRun}
  />
)}
```

- [ ] **Step 5: Pass new props to ProjectScriptsControl**

Update the `<ProjectScriptsControl>` render call to include:

```tsx
<ProjectScriptsControl
  scripts={activeProject?.scripts ?? []}
  globalScripts={serverConfig?.globalActions ?? []}
  globalScriptDefaults={activeProject?.globalScriptDefaults ?? []}
  keybindings={serverConfig?.keybindings ?? []}
  preferredScriptId={preferredScriptId}
  onRunScript={runProjectScript}
  onRunGlobalScript={runGlobalScript}
  onAddScript={saveProjectScript}
  onUpdateScript={updateProjectScript}
  onDeleteScript={deleteProjectScript}
  onAddGlobalScript={saveGlobalScript}
  onUpdateGlobalScript={updateGlobalScript}
  onDeleteGlobalScript={deleteGlobalScript}
/>
```

- [ ] **Step 6: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ChatView.tsx
git commit -m "feat(web): add global action execution with placeholder resolution and defaults"
```

---

### Task 16: Web — Handle Config Stream Events for Global Actions

**Files:**
- Modify: The file where `ServerConfigStreamEvent` is consumed on the client (likely in a WebSocket handler or config hook)

- [ ] **Step 1: Find the config stream consumer**

Search for where `ServerConfigStreamEvent` is decoded/handled on the client side. It should have cases for `keybindingsUpdated`, `providerStatuses`, `settingsUpdated`.

- [ ] **Step 2: Add globalActionsUpdated case**

```typescript
case "globalActionsUpdated": {
  // Update the globalActions in the local config state
  // Follow the same pattern as keybindingsUpdated
  updateConfig((prev) => ({
    ...prev,
    globalActions: event.payload.globalActions,
  }));
  break;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): handle globalActionsUpdated config stream event"
```

---

### Task 17: Integration — Keybinding Execution for Global Actions

**Files:**
- Modify: The keybinding dispatcher (likely where `script.{id}.run` commands are handled)

- [ ] **Step 1: Find keybinding command dispatcher**

Search for where `projectScriptIdFromCommand` is called — this is where keybinding-triggered script execution happens.

- [ ] **Step 2: Add global script keybinding handler**

After the existing project script keybinding check, add:

```typescript
const globalScriptId = globalScriptIdFromCommand(command);
if (globalScriptId) {
  const script = globalScripts.find((s) => s.id === globalScriptId);
  if (script) {
    runGlobalScript(script, false); // false = not holding alt key
  }
  return;
}
```

Import `globalScriptIdFromCommand` from `~/projectScripts`.

- [ ] **Step 3: Ensure project keybindings checked FIRST**

Verify the project script check runs before the global script check. This implements the "project wins" priority rule.

- [ ] **Step 4: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): handle global action keybinding commands with project-wins priority"
```

---

### Task 18: Full Build Verification

- [ ] **Step 1: Run full type check**

Run: `npx turbo run typecheck`
Expected: All packages pass

- [ ] **Step 2: Run tests**

Run: `npx turbo run test`
Expected: All tests pass (including new placeholder tests)

- [ ] **Step 3: Run build**

Run: `npx turbo run build`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

1. Launch the app
2. Open a project
3. Click the actions dropdown — verify "Project" and "Global" sections appear
4. Click "Add global action" — verify form appears without "Run on worktree creation"
5. Create a global action: name "Nmap Scan", command `nmap -sCV {{target}} -oN scans/{{target}}.txt`
6. Verify placeholder chips appear below command textarea
7. Run the action — verify placeholder input dialog appears
8. Fill in "target" = "10.10.11.42", toggle "Save as default"
9. Click Run — verify command executes in terminal with substituted values
10. Run the action again — verify it executes immediately with saved default
11. Hold ⌥/Alt and click — verify dialog appears with pre-filled default
12. Switch to a different project — verify the global action appears there too (but no defaults)
13. Assign a keybinding to the global action — verify it works
14. Create a project action with the same keybinding — verify project action takes priority

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify full build and type check pass"
```
