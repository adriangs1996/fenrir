/**
 * SkillService - Core skill lifecycle management.
 *
 * Owns persistence, sync, and change notification of skills stored in
 * Fenrir server state (source of truth). Bidirectionally syncs with provider
 * adapters (.claude/skills/ for Claude, stub for Codex). Watches all
 * relevant directories for external edits and auto-imports new provider
 * skills into Fenrir.
 *
 * Follows the same pattern as globalActions.ts: Cache + PubSub +
 * Semaphore + Scope for concurrency and file watching.
 *
 * @module SkillService
 */
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Scope,
  Context,
  Stream,
} from "effect";
import * as Semaphore from "effect/Semaphore";

import type {
  CreateSkillInput,
  ResolveSkillConflictInput,
  ServerProviderSkill,
  ServerSkillDetails,
  SkillProviderSync,
  UpdateSkillInput,
} from "@fenrir/contracts";

import { ServerConfig } from "../config.ts";
import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";
import { makeCodexSkillAdapter } from "./CodexSkillAdapter.ts";
import { readSkillFolderFiles } from "./providerSkillFolderIO.ts";
import type {
  ProviderSkillAdapter,
  ProviderSkillFolder,
  ProviderSkillProjection,
} from "./ProviderSkillAdapter.ts";
import {
  buildSkillProjectMetadata,
  getProjectSkillStatePaths,
  type ProjectSkillStatePaths,
} from "./projectSkillStatePaths.ts";
import { importProviderSkills, needsInitialImport } from "./skillImport.ts";
import { diffSkillManifests } from "./skillDiff.ts";
import { validateSkillFile } from "./skillFileFormat.ts";
import { buildSkillManifest } from "./skillManifest.ts";
import { isSafeSkillRelativePath } from "./providerSkillPathClassifier.ts";
import { buildProviderSkillProjection } from "./skillProjection.ts";
import {
  deleteSkillFromStorage,
  hasInternalProjectSkillState,
  importLegacyWorkspaceSkills,
  readGeneralSkillFileFromStorage,
  readSkillDetailsFromStorage,
  rebuildSkillIndexFromStorage,
  writeGeneralSkillToStorage,
} from "./skillStorage.ts";

// ─── Error ─────────────────────────────────────────────────────

export class SkillServiceError {
  readonly _tag = "SkillServiceError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

// ─── Service shape ─────────────────────────────────────────────

export interface SkillServiceShape {
  /** Start the service runtime and attach file watching. */
  readonly start: Effect.Effect<void, SkillServiceError>;

  /** Stop active file watching and release watcher resources. */
  readonly stop: Effect.Effect<void, never>;

  /** Await runtime readiness. */
  readonly ready: Effect.Effect<void, SkillServiceError>;

  /**
   * Switch the active project root used for skill discovery and sync.
   *
   * Re-initializes the Claude adapter for the new project, runs initial
   * import if needed, invalidates the cache, restarts file watchers, and
   * pushes updated skills to all connected clients.
   *
   * No-op when the new root matches the current one.
   */
  readonly setActiveProjectRoot: (projectRoot: string) => Effect.Effect<void, SkillServiceError>;

  /** Read the current skills list. */
  readonly getAll: Effect.Effect<readonly ServerProviderSkill[], SkillServiceError>;

  /** Read a single skill by name. */
  readonly getByName: (name: string) => Effect.Effect<ServerProviderSkill, SkillServiceError>;

  /** Read a single skill plus its flat file inventory. */
  readonly getDetails: (name: string) => Effect.Effect<ServerSkillDetails, SkillServiceError>;

  /** Create a new skill and sync to all providers. */
  readonly create: (
    input: CreateSkillInput,
  ) => Effect.Effect<ServerProviderSkill, SkillServiceError>;

  /** Update an existing skill and re-sync to all providers. */
  readonly update: (
    input: UpdateSkillInput,
  ) => Effect.Effect<ServerProviderSkill, SkillServiceError>;

  /** Delete a skill from Fenrir dir and all provider dirs. */
  readonly delete: (name: string) => Effect.Effect<void, SkillServiceError>;

  /** Toggle enabled flag of an existing skill. */
  readonly toggleEnabled: (name: string) => Effect.Effect<ServerProviderSkill, SkillServiceError>;

  /** Resolve a detected conflict for a specific skill+provider pair. */
  readonly resolveConflict: (
    input: ResolveSkillConflictInput,
  ) => Effect.Effect<ServerProviderSkill, SkillServiceError>;

  /** Stream of skills change events emitted on every state mutation. */
  readonly streamChanges: Stream.Stream<readonly ServerProviderSkill[]>;
}

export class SkillService extends Context.Service<SkillService, SkillServiceShape>()(
  "t3/skill/SkillService",
) {}

// ─── Project context ──────────────────────────────────────────

/** Mutable context that tracks the active project's skill paths and adapters. */
interface SkillProjectContext {
  readonly projectRoot: string;
  readonly statePaths: ProjectSkillStatePaths;
  readonly adapters: readonly ProviderSkillAdapter[];
}

// ─── Helpers ───────────────────────────────────────────────────

const sortAdapters = (adapters: readonly ProviderSkillAdapter[]): readonly ProviderSkillAdapter[] =>
  adapters.toSorted((left, right) => right.priority - left.priority);

// ─── Service implementation ─────────────────────────────────────

export const makeSkillService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const initialStatePaths = getProjectSkillStatePaths({
    stateDir: config.stateDir,
    workspaceRoot: config.cwd,
    path: pathService,
  });
  const initialClaudeAdapter = yield* makeClaudeSkillAdapter(initialStatePaths.workspaceRoot);
  const initialCodexAdapter = yield* makeCodexSkillAdapter(initialStatePaths.workspaceRoot);
  const projectCtxRef = yield* Ref.make<SkillProjectContext>({
    projectRoot: initialStatePaths.workspaceRoot,
    statePaths: initialStatePaths,
    adapters: sortAdapters([initialClaudeAdapter, initialCodexAdapter]),
  });

  const cacheKey = "skills" as const;

  const changesPubSub = yield* PubSub.unbounded<readonly ServerProviderSkill[]>();
  const writeSemaphore = yield* Semaphore.make(1);
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, SkillServiceError>();

  const emitChange = (skills: readonly ServerProviderSkill[]) =>
    PubSub.publish(changesPubSub, skills).pipe(Effect.asVoid);

  const withFsPath = <A, E, R>(
    effect: Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path>,
  ): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, pathService),
    );

  const ensureProjectStateLayout = (
    ctx: SkillProjectContext,
  ): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        `Skill project state: workspace=${ctx.statePaths.workspaceRoot} key=${ctx.statePaths.projectKey} root=${ctx.statePaths.projectRootStateDir}`,
      );
      yield* fs
        .makeDirectory(ctx.statePaths.projectRootStateDir, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError("failed to create Fenrir project state directory", cause),
          ),
        );
      yield* Effect.all(
        [
          fs.makeDirectory(ctx.statePaths.skillsRootDir, { recursive: true }),
          fs.makeDirectory(ctx.statePaths.generalSkillsDir, { recursive: true }),
          fs.makeDirectory(ctx.statePaths.providerSkillsDir, { recursive: true }),
          fs.makeDirectory(ctx.statePaths.skillIndexDir, { recursive: true }),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SkillServiceError("failed to prepare Fenrir per-project skill-state paths", cause),
        ),
      );
      yield* fs
        .writeFileString(
          ctx.statePaths.projectMetadataPath,
          `${JSON.stringify(buildSkillProjectMetadata(ctx.statePaths), null, 2)}\n`,
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError("failed to persist Fenrir project skill metadata", cause),
          ),
        );
    });

  const getProviderStateDir = (
    ctx: SkillProjectContext,
    provider: ProviderSkillAdapter["provider"],
  ) => pathService.join(ctx.statePaths.providerSkillsDir, provider);

  const getProviderSkillStateDir = (
    ctx: SkillProjectContext,
    provider: ProviderSkillAdapter["provider"],
    skillName: string,
  ) => pathService.join(getProviderStateDir(ctx, provider), skillName);

  const buildSkillProjection = (
    ctx: SkillProjectContext,
    adapter: ProviderSkillAdapter,
    skill: ServerProviderSkill,
  ): Effect.Effect<ProviderSkillProjection, SkillServiceError> =>
    Effect.gen(function* () {
      const generalRoot = pathService.join(ctx.statePaths.generalSkillsDir, skill.name);
      const providerRoot = getProviderSkillStateDir(ctx, adapter.provider, skill.name);

      const [generalFiles, providerFiles] = yield* Effect.all([
        readSkillFolderFiles(generalRoot, () => ({ kind: "general" as const })),
        readSkillFolderFiles(providerRoot, (relativePath) =>
          adapter.classifyRelativePath(relativePath),
        ),
      ]).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) =>
            new SkillServiceError(`failed to build ${adapter.provider} skill projection`, cause),
        ),
      );

      return buildProviderSkillProjection({
        skill,
        adapter,
        generalFiles,
        providerFiles,
      });
    });

  const buildProjectedManifest = (
    ctx: SkillProjectContext,
    adapter: ProviderSkillAdapter,
    skill: ServerProviderSkill,
  ): Effect.Effect<
    {
      readonly projection: ProviderSkillProjection;
      readonly manifest: ReturnType<typeof buildSkillManifest>;
    },
    SkillServiceError
  > =>
    buildSkillProjection(ctx, adapter, skill).pipe(
      Effect.map((projection) => ({
        projection,
        manifest: buildSkillManifest(projection.files),
      })),
    );

  const buildProviderFolderManifest = (
    folder: ProviderSkillFolder,
  ): ReturnType<typeof buildSkillManifest> =>
    buildSkillManifest([folder.entryFile, ...folder.files]);

  const listGeneralSkillNames = (
    ctx: SkillProjectContext,
  ): Effect.Effect<readonly string[], SkillServiceError> =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectory(ctx.statePaths.generalSkillsDir).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to read Fenrir general skills directory", cause),
        ),
      );

      const names: string[] = [];
      for (const entry of entries.toSorted()) {
        if (entry.startsWith(".")) continue;
        const skillDir = pathService.join(ctx.statePaths.generalSkillsDir, entry);
        const stat = yield* fs.stat(skillDir).pipe(Effect.option);
        if (Option.isNone(stat) || stat.value.type !== "Directory") continue;
        const skillFilePath = pathService.join(skillDir, "skill.md");
        const exists = yield* fs
          .exists(skillFilePath)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        if (exists) {
          names.push(entry);
        }
      }

      return names;
    });

  const clearFenrirGeneralSupportFiles = (
    ctx: SkillProjectContext,
    skillName: string,
  ): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      const generalSkillDir = pathService.join(ctx.statePaths.generalSkillsDir, skillName);
      const generalFiles = yield* readSkillFolderFiles(generalSkillDir, () => ({
        kind: "general" as const,
      })).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to read Fenrir general support files", cause),
        ),
      );

      for (const file of generalFiles) {
        if (file.relativePath === "skill.md") continue;
        yield* fs.remove(file.absolutePath).pipe(Effect.catch(() => Effect.void));
      }
    });

  const importProviderFilesIntoFenrirState = (
    ctx: SkillProjectContext,
    adapter: ProviderSkillAdapter,
    folder: ProviderSkillFolder,
    skill: ServerProviderSkill,
  ): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      const generalSkillDir = pathService.join(ctx.statePaths.generalSkillsDir, skill.name);
      const providerSkillDir = getProviderSkillStateDir(ctx, adapter.provider, skill.name);

      yield* fs
        .makeDirectory(generalSkillDir, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError("failed to prepare Fenrir general skill directory", cause),
          ),
        );
      yield* clearFenrirGeneralSupportFiles(ctx, skill.name);
      yield* fs
        .remove(providerSkillDir, { recursive: true, force: true })
        .pipe(Effect.catch(() => Effect.void));

      for (const file of folder.files) {
        if (!isSafeSkillRelativePath(file.relativePath)) {
          yield* Effect.logWarning(
            `Ignoring unsafe provider support file during import: ${adapter.provider} ${skill.name} ${file.relativePath}`,
          );
          continue;
        }

        const scope = adapter.classifyRelativePath(file.relativePath);
        const targetRoot = scope.kind === "general" ? generalSkillDir : providerSkillDir;
        const targetPath = pathService.join(targetRoot, file.relativePath);

        yield* fs
          .makeDirectory(pathService.dirname(targetPath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new SkillServiceError(
                  `failed to create skill file directory: ${targetPath}`,
                  cause,
                ),
            ),
          );
        const writeEffect =
          scope.kind === "general"
            ? fs.writeFile(targetPath, file.bytes)
            : fs.writeFile(targetPath, file.bytes);
        yield* writeEffect.pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError(`failed to write skill support file: ${targetPath}`, cause),
          ),
        );
        const existing = yield* fs
          .stat(targetPath)
          .pipe(
            Effect.mapError(
              (cause) =>
                new SkillServiceError(`failed to stat projected file: ${targetPath}`, cause),
            ),
          );
        const mode = file.executable ? existing.mode | 0o111 : existing.mode & ~0o111;
        yield* fs.chmod(targetPath, mode).pipe(Effect.catch(() => Effect.void));
      }

      yield* rebuildSkillIndexFromStorage(ctx.statePaths, skill.name).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) =>
            new SkillServiceError("failed to rebuild skill index after provider import", cause),
        ),
      );
    });

  const refreshSkillIndex = (
    ctx: SkillProjectContext,
    skillName: string,
  ): Effect.Effect<void, SkillServiceError> =>
    withFsPath(rebuildSkillIndexFromStorage(ctx.statePaths, skillName)).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, pathService),
      Effect.mapError(
        (cause) => new SkillServiceError(`failed to rebuild skill index for "${skillName}"`, cause),
      ),
    );

  const refreshAllSkillIndexes = (
    ctx: SkillProjectContext,
  ): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      const skillNames = yield* listGeneralSkillNames(ctx);
      yield* Effect.forEach(skillNames, (skillName) => refreshSkillIndex(ctx, skillName), {
        concurrency: "unbounded",
        discard: true,
      });
    });

  // ── Sync status computation ─────────────────────────────────────

  const computeSyncStatus = (
    ctx: SkillProjectContext,
    skill: ServerProviderSkill,
    currentAdapters: readonly ProviderSkillAdapter[],
    providerSkillsByAdapter: Map<ProviderSkillAdapter, Map<string, ProviderSkillFolder>>,
  ): Effect.Effect<readonly SkillProviderSync[], SkillServiceError> =>
    Effect.forEach(currentAdapters, (adapter) =>
      Effect.gen(function* () {
        const byName = providerSkillsByAdapter.get(adapter);
        const providerFolder = byName?.get(skill.name);
        if (!providerFolder) {
          return {
            provider: adapter.provider,
            state: "pending",
            lastSyncedAt: null,
          } satisfies SkillProviderSync;
        }

        const projected = yield* buildProjectedManifest(ctx, adapter, skill);
        const diff = diffSkillManifests(
          projected.manifest,
          buildProviderFolderManifest(providerFolder),
        );

        return {
          provider: adapter.provider,
          state: diff.state,
          lastSyncedAt: null,
        } satisfies SkillProviderSync;
      }),
    );

  // ── Disk I/O ────────────────────────────────────────────────────

  const initializeProjectStateIfNeeded = (
    ctx: SkillProjectContext,
  ): Effect.Effect<"none" | "provider-bootstrap", SkillServiceError> =>
    Effect.gen(function* () {
      const hasInternalState = yield* withFsPath(hasInternalProjectSkillState(ctx.statePaths)).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to inspect internal Fenrir skill state", cause),
        ),
      );

      if (hasInternalState) {
        yield* Effect.logInfo(
          `Skill bootstrap: using existing internal state for ${ctx.statePaths.workspaceRoot}`,
        );
        yield* ensureProjectStateLayout(ctx);
        return "none";
      }

      const shouldImportFromProviders = yield* needsInitialImport(ctx.statePaths, [
        ...ctx.adapters,
      ]).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
      );

      yield* ensureProjectStateLayout(ctx);
      yield* Effect.logInfo(
        `Skill bootstrap: evaluating sources for ${ctx.statePaths.workspaceRoot} (legacy > codex > claude)`,
      );

      const bootstrapExit = yield* Effect.exit(
        Effect.gen(function* () {
          const importedLegacy = yield* importLegacyWorkspaceSkills(ctx.statePaths).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
          );
          if (importedLegacy.length > 0) {
            yield* Effect.logInfo(
              `Initial import: migrated ${importedLegacy.length} legacy Fenrir skill${importedLegacy.length !== 1 ? "s" : ""} into internal project state from ${pathService.join(ctx.statePaths.workspaceRoot, ".fenrir", "skills")}`,
            );
            return "none" as const;
          }

          if (!shouldImportFromProviders) {
            return "none" as const;
          }

          const imported = yield* importProviderSkills(ctx.statePaths, [...ctx.adapters]).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
          );
          return imported.length > 0 ? ("provider-bootstrap" as const) : ("none" as const);
        }),
      );
      if (Exit.isFailure(bootstrapExit)) {
        yield* Effect.logWarning("Initial import: bootstrap failed");
        return "none";
      }

      return bootstrapExit.value;
    });

  const loadFromDisk: Effect.Effect<readonly ServerProviderSkill[], SkillServiceError> = Effect.gen(
    function* () {
      const ctx = yield* Ref.get(projectCtxRef);
      yield* initializeProjectStateIfNeeded(ctx);

      const providerSkillsByAdapter = new Map<
        ProviderSkillAdapter,
        Map<string, ProviderSkillFolder>
      >();
      for (const adapter of ctx.adapters) {
        const folders = yield* adapter
          .readProviderSkillFolders()
          .pipe(Effect.catch(() => Effect.succeed([] as readonly ProviderSkillFolder[])));
        const byName = new Map(
          folders.map((folder) => [
            String(folder.entry.frontmatter.name ?? folder.skillName),
            folder,
          ]),
        );
        providerSkillsByAdapter.set(adapter, byName);
      }

      const skills: ServerProviderSkill[] = [];
      const storedSkillNames = yield* listGeneralSkillNames(ctx);
      for (const skillName of storedSkillNames) {
        const raw = yield* withFsPath(
          readGeneralSkillFileFromStorage(ctx.statePaths, skillName),
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.tapError((e) =>
            Effect.logWarning(
              `Skipping skill "${skillName}" without readable general skill.md: ${e.message}`,
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(raw)) continue;
        const validated = yield* validateSkillFile(raw.value).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(`Skipping invalid skill at ${raw.value.filePath}: ${e.message}`),
          ),
          Effect.option,
        );
        if (Option.isNone(validated)) continue;

        const skill = validated.value;
        const syncStatus = yield* computeSyncStatus(
          ctx,
          skill,
          ctx.adapters,
          providerSkillsByAdapter,
        );
        skills.push({ ...skill, syncStatus });
      }

      return skills;
    },
  );

  const skillsCache = yield* Cache.make<
    typeof cacheKey,
    readonly ServerProviderSkill[],
    SkillServiceError
  >({
    capacity: 1,
    lookup: () => loadFromDisk,
  });

  const getAllFromCache = Cache.get(skillsCache, cacheKey);

  // ── Internal update (callers must hold the write semaphore) ──────

  const updateSkillInternal = (input: UpdateSkillInput) =>
    Effect.gen(function* () {
      const ctx = yield* Ref.get(projectCtxRef);
      const current = yield* getAllFromCache;
      const existing = current.find((s) => s.name === input.name);
      if (!existing) {
        return yield* Effect.fail(new SkillServiceError(`Skill not found: ${input.name}`));
      }

      const merged: ServerProviderSkill = {
        ...existing,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date().toISOString(),
      };

      yield* withFsPath(
        writeGeneralSkillToStorage(ctx.statePaths, {
          name: merged.name,
          displayName: merged.displayName,
          description: merged.description,
          body: merged.body,
          ...(merged.icon !== undefined ? { icon: merged.icon } : {}),
          tags: Array.from(merged.tags),
          enabled: merged.enabled,
        }),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to write updated skill file", cause),
        ),
      );

      for (const adapter of ctx.adapters) {
        const projection = yield* buildSkillProjection(ctx, adapter, merged);
        yield* adapter.writeSkillProjection(projection).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(
              `Failed to sync updated skill "${merged.name}" to ${adapter.provider}: ${e.message}`,
            ),
          ),
          Effect.catch(() => Effect.void),
        );
      }

      yield* Cache.invalidate(skillsCache, cacheKey);
      const allSkills = yield* getAllFromCache;
      yield* emitChange(allSkills);

      return allSkills.find((s) => s.name === input.name) ?? merged;
    });

  const syncFenrirStateToProviders = (options?: {
    readonly providers?: readonly ProviderSkillAdapter["provider"][];
    readonly skillNames?: readonly string[];
  }) =>
    Effect.gen(function* () {
      const ctx = yield* Ref.get(projectCtxRef);
      const skillNameFilter = options?.skillNames ? new Set(options.skillNames) : null;

      if (skillNameFilter === null) {
        yield* refreshAllSkillIndexes(ctx);
      } else {
        yield* Effect.forEach(skillNameFilter, (skillName) => refreshSkillIndex(ctx, skillName), {
          concurrency: "unbounded",
          discard: true,
        });
      }

      const allSkills = yield* loadFromDisk;
      const targetSkills =
        skillNameFilter === null
          ? allSkills
          : allSkills.filter((skill) => skillNameFilter.has(skill.name));
      const providerFilter = options?.providers ? new Set(options.providers) : null;
      const targetAdapters = ctx.adapters.filter((adapter) =>
        providerFilter === null ? true : providerFilter.has(adapter.provider),
      );

      for (const adapter of targetAdapters) {
        const existingProviderFolders = yield* adapter
          .readProviderSkillFolders()
          .pipe(Effect.catch(() => Effect.succeed([] as readonly ProviderSkillFolder[])));
        const desiredSkillNames = new Set(targetSkills.map((skill) => skill.name));

        for (const folder of existingProviderFolders) {
          const skillName = String(folder.entry.frontmatter.name ?? folder.skillName);
          if (skillNameFilter !== null && !skillNameFilter.has(skillName)) {
            continue;
          }
          if (desiredSkillNames.has(skillName)) continue;
          yield* adapter.deleteSkillFromProvider(skillName).pipe(
            Effect.tapError((e) =>
              Effect.logWarning(
                `Failed to delete stale ${adapter.provider} skill "${skillName}": ${e.message}`,
              ),
            ),
            Effect.catch(() => Effect.void),
          );
        }

        for (const skill of targetSkills) {
          const { projection } = yield* buildProjectedManifest(ctx, adapter, skill);
          yield* adapter.writeSkillProjection(projection).pipe(
            Effect.tapError((e) =>
              Effect.logWarning(
                `Failed to sync skill "${skill.name}" to ${adapter.provider}: ${e.message}`,
              ),
            ),
            Effect.catch(() => Effect.void),
          );
        }
      }

      yield* Cache.invalidate(skillsCache, cacheKey);
      const refreshed = yield* getAllFromCache;
      yield* emitChange(refreshed);
    });

  // ── Revalidate + publish (holds semaphore — for watcher use) ─────

  const revalidateAndPublish = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(skillsCache, cacheKey);
      const skills = yield* getAllFromCache;
      yield* emitChange(skills);
    }),
  );

  // ── CRUD ────────────────────────────────────────────────────────

  const create = (input: CreateSkillInput) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const ctx = yield* Ref.get(projectCtxRef);
        yield* ensureProjectStateLayout(ctx);
        const current = yield* getAllFromCache;
        if (current.some((s) => s.name === input.name)) {
          return yield* Effect.fail(new SkillServiceError(`Skill already exists: ${input.name}`));
        }

        yield* withFsPath(writeGeneralSkillToStorage(ctx.statePaths, input)).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.mapError((cause) => new SkillServiceError("failed to write skill file", cause)),
        );

        const now = new Date().toISOString();
        const skill: ServerProviderSkill = {
          ...input,
          syncStatus: [],
          createdAt: now,
          updatedAt: now,
        };

        for (const adapter of ctx.adapters) {
          const projection = yield* buildSkillProjection(ctx, adapter, skill);
          yield* adapter.writeSkillProjection(projection).pipe(
            Effect.tapError((e) =>
              Effect.logWarning(
                `Failed to sync new skill "${input.name}" to ${adapter.provider}: ${e.message}`,
              ),
            ),
            Effect.catch(() => Effect.void),
          );
        }

        yield* Cache.invalidate(skillsCache, cacheKey);
        const allSkills = yield* getAllFromCache;
        yield* emitChange(allSkills);

        return allSkills.find((s) => s.name === input.name) ?? skill;
      }),
    );

  const update = (input: UpdateSkillInput) =>
    writeSemaphore.withPermits(1)(updateSkillInternal(input));

  const deleteSkill = (name: string) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const ctx = yield* Ref.get(projectCtxRef);
        const current = yield* getAllFromCache;
        if (!current.some((s) => s.name === name)) {
          return yield* Effect.fail(new SkillServiceError(`Skill not found: ${name}`));
        }

        yield* withFsPath(deleteSkillFromStorage(ctx.statePaths, name)).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.mapError(
            (cause) => new SkillServiceError("failed to delete skill directory", cause),
          ),
        );
        yield* Effect.forEach(ctx.adapters, (adapter) =>
          fs
            .remove(getProviderSkillStateDir(ctx, adapter.provider, name), {
              recursive: true,
              force: true,
            })
            .pipe(Effect.catch(() => Effect.void)),
        );

        for (const adapter of ctx.adapters) {
          yield* adapter.deleteSkillFromProvider(name).pipe(
            Effect.tapError((e) =>
              Effect.logWarning(
                `Failed to delete skill "${name}" from ${adapter.provider}: ${e.message}`,
              ),
            ),
            Effect.catch(() => Effect.void),
          );
        }

        yield* Cache.invalidate(skillsCache, cacheKey);
        const allSkills = yield* getAllFromCache;
        yield* emitChange(allSkills);
      }),
    );

  const toggleEnabled = (name: string) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getAllFromCache;
        const existing = current.find((s) => s.name === name);
        if (!existing) {
          return yield* Effect.fail(new SkillServiceError(`Skill not found: ${name}`));
        }
        return yield* updateSkillInternal({ name, enabled: !existing.enabled });
      }),
    );

  const resolveConflict = (input: ResolveSkillConflictInput) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const ctx = yield* Ref.get(projectCtxRef);
        const current = yield* getAllFromCache;
        const existing = current.find((s) => s.name === input.name);
        if (!existing) {
          return yield* Effect.fail(new SkillServiceError(`Skill not found: ${input.name}`));
        }

        const adapter = ctx.adapters.find((a) => a.provider === input.provider);
        if (!adapter) {
          return yield* Effect.fail(
            new SkillServiceError(`Provider adapter not found: ${input.provider}`),
          );
        }

        if (input.resolution === "keep-fenrir") {
          yield* Effect.logInfo(
            `Skill conflict: keeping Fenrir copy for ${input.name} on ${input.provider}`,
          );
          const { projection } = yield* buildProjectedManifest(ctx, adapter, existing);
          yield* adapter
            .writeSkillProjection(projection)
            .pipe(
              Effect.mapError(
                (e) =>
                  new SkillServiceError(
                    `Failed to sync skill "${input.name}" to ${input.provider}: ${e.message}`,
                    e,
                  ),
              ),
            );
        } else {
          yield* Effect.logInfo(
            `Skill conflict: accepting external ${input.provider} copy for ${input.name}`,
          );
          const providerSkills = yield* adapter
            .readProviderSkillFolders()
            .pipe(
              Effect.mapError(
                (e) =>
                  new SkillServiceError(
                    `Failed to read skills from ${input.provider}: ${e.message}`,
                    e,
                  ),
              ),
            );

          const providerFolder = providerSkills.find(
            (folder) => String(folder.entry.frontmatter.name ?? folder.skillName) === input.name,
          );
          if (!providerFolder) {
            return yield* Effect.fail(
              new SkillServiceError(
                `Skill "${input.name}" not found in provider ${input.provider}`,
              ),
            );
          }

          const providerValidated = yield* validateSkillFile(providerFolder.entry).pipe(
            Effect.mapError(
              (e) =>
                new SkillServiceError(`Invalid skill file from ${input.provider}: ${e.message}`, e),
            ),
          );

          // Merge: keep Fenrir metadata, accept provider body
          const merged: ServerProviderSkill = {
            ...existing,
            description: providerValidated.description,
            body: providerValidated.body,
            updatedAt: new Date().toISOString(),
          };

          yield* withFsPath(
            writeGeneralSkillToStorage(ctx.statePaths, {
              name: merged.name,
              displayName: merged.displayName,
              description: merged.description,
              body: merged.body,
              ...(merged.icon !== undefined ? { icon: merged.icon } : {}),
              tags: Array.from(merged.tags),
              enabled: merged.enabled,
            }),
          ).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
            Effect.mapError(
              (cause) =>
                new SkillServiceError("failed to write accepted skill to Fenrir dir", cause),
            ),
          );

          yield* importProviderFilesIntoFenrirState(ctx, adapter, providerFolder, merged);

          yield* syncFenrirStateToProviders({
            providers: [adapter.provider],
            skillNames: [input.name],
          });
        }

        yield* Cache.invalidate(skillsCache, cacheKey);
        const allSkills = yield* getAllFromCache;
        yield* emitChange(allSkills);

        return allSkills.find((s) => s.name === input.name) ?? existing;
      }),
    );

  const getByName = (name: string) =>
    Effect.gen(function* () {
      const all = yield* getAllFromCache;
      const found = all.find((s) => s.name === name);
      if (!found) {
        return yield* Effect.fail(new SkillServiceError(`Skill not found: ${name}`));
      }
      return found;
    });

  const getDetails = (name: string) =>
    Effect.gen(function* () {
      const ctx = yield* Ref.get(projectCtxRef);
      yield* ensureProjectStateLayout(ctx);
      const skill = yield* getByName(name);
      yield* refreshSkillIndex(ctx, name);

      return {
        skill,
        files: yield* withFsPath(readSkillDetailsFromStorage(ctx.statePaths, name)).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.mapError(
            (cause) => new SkillServiceError("failed to read internal skill file inventory", cause),
          ),
        ),
      } satisfies ServerSkillDetails;
    });

  // ── External change detection ───────────────────────────────────

  const detectExternalChanges = (adapter: ProviderSkillAdapter) =>
    writeSemaphore
      .withPermits(1)(
        Effect.gen(function* () {
          const ctx = yield* Ref.get(projectCtxRef);
          const current = yield* getAllFromCache;
          const fenrirByName = new Map(current.map((s) => [s.name, s]));

          const providerFolders = yield* adapter
            .readProviderSkillFolders()
            .pipe(Effect.catch(() => Effect.succeed([] as readonly ProviderSkillFolder[])));

          for (const folder of providerFolders) {
            const name = String(folder.entry.frontmatter.name ?? folder.skillName);
            if (!name || fenrirByName.has(name)) continue;
            yield* Effect.logInfo(
              `Detected external provider skill drift: importing "${name}" from ${adapter.provider}`,
            );

            const validated = yield* validateSkillFile(folder.entry).pipe(Effect.option);
            if (Option.isNone(validated)) continue;

            const v = validated.value;
            yield* withFsPath(
              writeGeneralSkillToStorage(ctx.statePaths, {
                name: v.name,
                displayName: v.displayName,
                description: v.description,
                body: v.body,
                ...(v.icon !== undefined ? { icon: v.icon } : {}),
                tags: Array.from(v.tags),
                enabled: v.enabled,
              }),
            ).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, pathService),
              Effect.tapError((e) =>
                Effect.logWarning(
                  `Auto-import of "${name}" from ${adapter.provider} failed: ${e.message}`,
                ),
              ),
              Effect.catch(() => Effect.void),
            );

            yield* importProviderFilesIntoFenrirState(ctx, adapter, folder, v).pipe(
              Effect.tapError((e) =>
                Effect.logWarning(
                  `Auto-import of support files for "${name}" from ${adapter.provider} failed: ${e.message}`,
                ),
              ),
              Effect.catch(() => Effect.void),
            );
          }

          yield* Cache.invalidate(skillsCache, cacheKey);
          const allSkills = yield* getAllFromCache;
          yield* emitChange(allSkills);
        }),
      )
      .pipe(Effect.ignoreCause({ log: true }));

  // ── File watchers ───────────────────────────────────────────────

  /**
   * Start file watchers for the given project context and scope.
   * Watches both the Fenrir skills directory and provider directories.
   */
  const startWatchersForContext = (
    ctx: SkillProjectContext,
    scope: Scope.Closeable,
  ): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      yield* fs
        .makeDirectory(ctx.statePaths.generalSkillsDir, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError(
                "failed to create Fenrir project skill-state directory for watching",
                cause,
              ),
          ),
        );
      yield* fs
        .makeDirectory(ctx.statePaths.providerSkillsDir, { recursive: true })
        .pipe(Effect.catch(() => Effect.void));

      const revalidateSafely = revalidateAndPublish.pipe(Effect.ignoreCause({ log: true }));
      const syncAllProvidersSafely = writeSemaphore
        .withPermits(1)(syncFenrirStateToProviders())
        .pipe(Effect.ignoreCause({ log: true }));

      // Watch Fenrir source-of-truth directory
      yield* fs.watch(ctx.statePaths.generalSkillsDir).pipe(
        Stream.debounce(Duration.millis(100)),
        Stream.runForEach(() => syncAllProvidersSafely),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(scope),
        Effect.asVoid,
      );

      yield* fs.watch(ctx.statePaths.providerSkillsDir).pipe(
        Stream.debounce(Duration.millis(100)),
        Stream.runForEach((event) => {
          const [provider] = event.path.replaceAll("\\", "/").split("/");
          if (provider !== "codex" && provider !== "claudeAgent") {
            return revalidateSafely;
          }

          return writeSemaphore
            .withPermits(1)(syncFenrirStateToProviders({ providers: [provider] }))
            .pipe(Effect.ignoreCause({ log: true }));
        }),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(scope),
        Effect.asVoid,
      );

      // Watch each provider directory (when supported)
      for (const adapter of ctx.adapters) {
        const watchRelPath = adapter.watchPath();
        if (!watchRelPath) continue;

        const watchAbsPath = pathService.isAbsolute(watchRelPath)
          ? watchRelPath
          : pathService.join(ctx.projectRoot, watchRelPath);

        // Ensure provider dir exists before watching
        yield* fs
          .makeDirectory(watchAbsPath, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));

        yield* fs.watch(watchAbsPath).pipe(
          Stream.debounce(Duration.millis(100)),
          Stream.runForEach(() => detectExternalChanges(adapter)),
          Effect.ignoreCause({ log: true }),
          Effect.forkIn(scope),
          Effect.asVoid,
        );
      }
    });

  // ── Watcher scope management ────────────────────────────────────

  const watcherScopeRef = yield* Ref.make<Scope.Closeable | null>(null);

  const closeWatcherScope: Effect.Effect<void, never> = Ref.get(watcherScopeRef).pipe(
    Effect.flatMap((scope) =>
      scope
        ? Scope.close(scope, Exit.void).pipe(Effect.flatMap(() => Ref.set(watcherScopeRef, null)))
        : Effect.void,
    ),
  );

  // Clean up active watcher scope on service teardown
  yield* Effect.addFinalizer(() => closeWatcherScope);

  /**
   * Run the initial import + start watchers for the given context.
   * Closes any previous watcher scope first.
   */
  const bootstrapContext = (ctx: SkillProjectContext): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      // Close previous watcher scope if any
      yield* closeWatcherScope;

      const bootstrapResult = yield* initializeProjectStateIfNeeded(ctx);
      if (bootstrapResult === "provider-bootstrap") {
        yield* Effect.logInfo(
          `Initial import: converging lower-precedence provider mirrors for ${ctx.statePaths.workspaceRoot}`,
        );
        yield* syncFenrirStateToProviders();
      }

      // Start watchers in a new scope
      const newScope = yield* Scope.make("sequential");
      yield* Ref.set(watcherScopeRef, newScope);
      yield* startWatchersForContext(ctx, newScope);
    });

  // ── setActiveProjectRoot ──────────────────────────────────────

  const setActiveProjectRoot = (newProjectRoot: string) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const newStatePaths = getProjectSkillStatePaths({
          stateDir: config.stateDir,
          workspaceRoot: newProjectRoot,
          path: pathService,
        });
        const currentCtx = yield* Ref.get(projectCtxRef);
        if (currentCtx.projectRoot === newStatePaths.workspaceRoot) return;

        yield* Effect.logInfo(
          `Skill service switching project root: ${currentCtx.projectRoot} → ${newStatePaths.workspaceRoot}`,
        );
        yield* Effect.logInfo(
          `Skill service project state target: ${newStatePaths.projectRootStateDir}`,
        );

        // Build new context (provide FS/Path so adapter requirements are satisfied)
        const newClaudeAdapter = yield* makeClaudeSkillAdapter(newStatePaths.workspaceRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
        );
        const newCodexAdapter = yield* makeCodexSkillAdapter(newStatePaths.workspaceRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
        );
        const newCtx: SkillProjectContext = {
          projectRoot: newStatePaths.workspaceRoot,
          statePaths: newStatePaths,
          adapters: sortAdapters([newClaudeAdapter, newCodexAdapter]),
        };
        yield* Ref.set(projectCtxRef, newCtx);

        // Bootstrap: import + watchers
        yield* bootstrapContext(newCtx);

        // Invalidate cache and push updated skills to clients
        yield* Cache.invalidate(skillsCache, cacheKey);
        const skills = yield* getAllFromCache;
        yield* emitChange(skills);
      }),
    );

  // ── Service return ─────────────────────────────────────────────

  return SkillService.of({
    start: Effect.gen(function* () {
      const alreadyStarted = yield* Ref.getAndSet(startedRef, true);
      if (alreadyStarted) {
        yield* Deferred.await(startedDeferred);
        return;
      }

      const ctx = yield* Ref.get(projectCtxRef);
      yield* bootstrapContext(ctx).pipe(
        Effect.tap(() => Deferred.succeed(startedDeferred, void 0 as void)),
        Effect.onError((cause) => Deferred.failCause(startedDeferred, cause)),
      );
    }),

    stop: closeWatcherScope,

    ready: Deferred.await(startedDeferred),

    setActiveProjectRoot,

    getAll: getAllFromCache,
    getByName,
    getDetails,

    create,
    update,
    delete: deleteSkill,
    toggleEnabled,
    resolveConflict,
    streamChanges: Stream.fromPubSub(changesPubSub),
  });
});

export const SkillServiceLive = Layer.effect(SkillService, makeSkillService);
