/**
 * SkillService - Core skill lifecycle management.
 *
 * Owns persistence, sync, and change notification of skills stored in
 * .fenrir/skills/ (source of truth). Bidirectionally syncs with provider
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
  ServiceMap,
  Stream,
} from "effect";
import * as Semaphore from "effect/Semaphore";

import type {
  CreateSkillInput,
  ResolveSkillConflictInput,
  ServerProviderSkill,
  SkillProviderSync,
  UpdateSkillInput,
} from "@fenrir/contracts";

import { ServerConfig } from "../config.ts";
import { makeClaudeSkillAdapter } from "./ClaudeSkillAdapter.ts";
import type { ProviderSkillAdapter } from "./ProviderSkillAdapter.ts";
import { importProviderSkills, needsInitialImport } from "./skillImport.ts";
import {
  scanSkillDirectory,
  validateSkillFile,
  writeSkillFile,
  type RawSkillFile,
} from "./skillFileFormat.ts";

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

export class SkillService extends ServiceMap.Service<SkillService, SkillServiceShape>()(
  "t3/skill/SkillService",
) {}

// ─── Codex stub (used inline — Codex has no skill dir yet) ─────

const codexAdapterStub: ProviderSkillAdapter = {
  provider: "codex",
  readProviderSkills: () =>
    Effect.andThen(
      Effect.logDebug("Codex skill sync not yet implemented"),
      Effect.succeed([] as RawSkillFile[]),
    ),
  writeSkillToProvider: (_skill) =>
    Effect.andThen(Effect.logDebug("Codex skill sync not yet implemented"), Effect.void),
  deleteSkillFromProvider: (_name) =>
    Effect.andThen(Effect.logDebug("Codex skill sync not yet implemented"), Effect.void),
  watchPath: () => null,
};

// ─── Project context ──────────────────────────────────────────

/** Mutable context that tracks the active project's skill paths and adapters. */
interface SkillProjectContext {
  readonly projectRoot: string;
  readonly fenrirSkillsPath: string;
  readonly adapters: readonly ProviderSkillAdapter[];
}

// ─── Helpers ───────────────────────────────────────────────────

/** Normalize body for comparison — trim + collapse whitespace. */
const normalizeBody = (body: string): string => body.trim().replace(/\s+/g, " ");

// ─── Service implementation ─────────────────────────────────────

export const makeSkillService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const initialClaudeAdapter = yield* makeClaudeSkillAdapter(config.cwd);
  const projectCtxRef = yield* Ref.make<SkillProjectContext>({
    projectRoot: config.cwd,
    fenrirSkillsPath: pathService.join(config.cwd, ".fenrir", "skills"),
    adapters: [initialClaudeAdapter, codexAdapterStub],
  });

  const cacheKey = "skills" as const;

  const changesPubSub = yield* PubSub.unbounded<readonly ServerProviderSkill[]>();
  const writeSemaphore = yield* Semaphore.make(1);
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, SkillServiceError>();

  const emitChange = (skills: readonly ServerProviderSkill[]) =>
    PubSub.publish(changesPubSub, skills).pipe(Effect.asVoid);

  // ── Sync status computation ─────────────────────────────────────

  const computeSyncStatus = (
    skill: ServerProviderSkill,
    currentAdapters: readonly ProviderSkillAdapter[],
    providerSkillsByAdapter: Map<ProviderSkillAdapter, Map<string, RawSkillFile>>,
  ): readonly SkillProviderSync[] =>
    currentAdapters.map((adapter): SkillProviderSync => {
      if (adapter.watchPath() === null) {
        return { provider: adapter.provider, state: "unsupported", lastSyncedAt: null };
      }
      const byName = providerSkillsByAdapter.get(adapter);
      const providerRaw = byName?.get(skill.name);
      if (!providerRaw) {
        return { provider: adapter.provider, state: "pending", lastSyncedAt: null };
      }
      const state =
        normalizeBody(skill.body) === normalizeBody(providerRaw.body) ? "synced" : "conflict";
      return { provider: adapter.provider, state, lastSyncedAt: null };
    });

  // ── Disk I/O ────────────────────────────────────────────────────

  const loadFromDisk: Effect.Effect<readonly ServerProviderSkill[], SkillServiceError> = Effect.gen(
    function* () {
      const ctx = yield* Ref.get(projectCtxRef);

      // Pre-load all provider skills for sync status computation
      const providerSkillsByAdapter = new Map<ProviderSkillAdapter, Map<string, RawSkillFile>>();
      for (const adapter of ctx.adapters) {
        const raw = yield* adapter
          .readProviderSkills()
          .pipe(Effect.catch(() => Effect.succeed([] as RawSkillFile[])));
        const byName = new Map(raw.map((r) => [String(r.frontmatter.name ?? ""), r]));
        providerSkillsByAdapter.set(adapter, byName);
      }

      // Scan Fenrir source-of-truth directory
      const rawSkills = yield* scanSkillDirectory(ctx.fenrirSkillsPath).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to scan .fenrir/skills directory", cause),
        ),
      );

      const skills: ServerProviderSkill[] = [];
      for (const raw of rawSkills) {
        const validated = yield* validateSkillFile(raw).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(`Skipping invalid skill at ${raw.filePath}: ${e.message}`),
          ),
          Effect.option,
        );
        if (Option.isNone(validated)) continue;

        const skill = validated.value;
        const syncStatus = computeSyncStatus(skill, ctx.adapters, providerSkillsByAdapter);
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

      yield* writeSkillFile(ctx.fenrirSkillsPath, {
        name: merged.name,
        displayName: merged.displayName,
        description: merged.description,
        body: merged.body,
        ...(merged.icon !== undefined ? { icon: merged.icon } : {}),
        tags: Array.from(merged.tags),
        enabled: merged.enabled,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError(
          (cause) => new SkillServiceError("failed to write updated skill file", cause),
        ),
      );

      for (const adapter of ctx.adapters) {
        yield* adapter.writeSkillToProvider(merged).pipe(
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
        const current = yield* getAllFromCache;
        if (current.some((s) => s.name === input.name)) {
          return yield* Effect.fail(new SkillServiceError(`Skill already exists: ${input.name}`));
        }

        yield* writeSkillFile(ctx.fenrirSkillsPath, input).pipe(
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
          yield* adapter.writeSkillToProvider(skill).pipe(
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

        const skillDir = pathService.join(ctx.fenrirSkillsPath, name);
        yield* fs
          .remove(skillDir, { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) => new SkillServiceError("failed to delete skill directory", cause),
            ),
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
          // Re-sync Fenrir version to provider, overwriting external edit
          yield* adapter
            .writeSkillToProvider(existing)
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
          // "accept-external" — read provider version and overwrite Fenrir
          const providerSkills = yield* adapter
            .readProviderSkills()
            .pipe(
              Effect.mapError(
                (e) =>
                  new SkillServiceError(
                    `Failed to read skills from ${input.provider}: ${e.message}`,
                    e,
                  ),
              ),
            );

          const providerRaw = providerSkills.find(
            (r) => String(r.frontmatter.name ?? "") === input.name,
          );
          if (!providerRaw) {
            return yield* Effect.fail(
              new SkillServiceError(
                `Skill "${input.name}" not found in provider ${input.provider}`,
              ),
            );
          }

          const providerValidated = yield* validateSkillFile(providerRaw).pipe(
            Effect.mapError(
              (e) =>
                new SkillServiceError(`Invalid skill file from ${input.provider}: ${e.message}`, e),
            ),
          );

          // Merge: keep Fenrir metadata, accept provider body
          const merged: ServerProviderSkill = {
            ...existing,
            body: providerValidated.body,
            updatedAt: new Date().toISOString(),
          };

          yield* writeSkillFile(ctx.fenrirSkillsPath, {
            name: merged.name,
            displayName: merged.displayName,
            description: merged.description,
            body: merged.body,
            ...(merged.icon !== undefined ? { icon: merged.icon } : {}),
            tags: Array.from(merged.tags),
            enabled: merged.enabled,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
            Effect.mapError(
              (cause) =>
                new SkillServiceError("failed to write accepted skill to Fenrir dir", cause),
            ),
          );

          // Re-confirm to provider so sync status shows "synced"
          yield* adapter.writeSkillToProvider(merged).pipe(
            Effect.tapError((e) =>
              Effect.logWarning(
                `Failed to re-confirm skill "${input.name}" to ${input.provider} after accept: ${e.message}`,
              ),
            ),
            Effect.catch(() => Effect.void),
          );
        }

        yield* Cache.invalidate(skillsCache, cacheKey);
        const allSkills = yield* getAllFromCache;
        yield* emitChange(allSkills);

        return allSkills.find((s) => s.name === input.name) ?? existing;
      }),
    );

  // ── External change detection ───────────────────────────────────

  const detectExternalChanges = (adapter: ProviderSkillAdapter) =>
    writeSemaphore
      .withPermits(1)(
        Effect.gen(function* () {
          const ctx = yield* Ref.get(projectCtxRef);
          const current = yield* getAllFromCache;
          const fenrirByName = new Map(current.map((s) => [s.name, s]));

          const providerRaw = yield* adapter
            .readProviderSkills()
            .pipe(Effect.catch(() => Effect.succeed([] as RawSkillFile[])));

          for (const raw of providerRaw) {
            const name = String(raw.frontmatter.name ?? "");
            if (!name || fenrirByName.has(name)) continue;

            // Auto-import: skill exists in provider but not in Fenrir
            const validated = yield* validateSkillFile(raw).pipe(Effect.option);
            if (Option.isNone(validated)) continue;

            const v = validated.value;
            yield* writeSkillFile(ctx.fenrirSkillsPath, {
              name: v.name,
              displayName: v.displayName,
              description: v.description,
              body: v.body,
              ...(v.icon !== undefined ? { icon: v.icon } : {}),
              tags: Array.from(v.tags),
              enabled: v.enabled,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, pathService),
              Effect.tapError((e) =>
                Effect.logWarning(
                  `Auto-import of "${name}" from ${adapter.provider} failed: ${e.message}`,
                ),
              ),
              Effect.catch(() => Effect.void),
            );
          }

          // Revalidate so conflicts (body differs) are reflected in sync status
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
        .makeDirectory(ctx.fenrirSkillsPath, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillServiceError(
                "failed to create .fenrir/skills directory for watching",
                cause,
              ),
          ),
        );

      const revalidateSafely = revalidateAndPublish.pipe(Effect.ignoreCause({ log: true }));

      // Watch Fenrir source-of-truth directory
      yield* fs.watch(ctx.fenrirSkillsPath).pipe(
        Stream.debounce(Duration.millis(100)),
        Stream.runForEach(() => revalidateSafely),
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

  // Clean up active watcher scope on service teardown
  yield* Effect.addFinalizer(() =>
    Ref.get(watcherScopeRef).pipe(
      Effect.flatMap((scope) => (scope ? Scope.close(scope, Exit.void) : Effect.void)),
    ),
  );

  /**
   * Run the initial import + start watchers for the given context.
   * Closes any previous watcher scope first.
   */
  const bootstrapContext = (ctx: SkillProjectContext): Effect.Effect<void, SkillServiceError> =>
    Effect.gen(function* () {
      // Close previous watcher scope if any
      const prevScope = yield* Ref.get(watcherScopeRef);
      if (prevScope) {
        yield* Scope.close(prevScope, Exit.void);
      }

      // Run initial import for this project if needed
      yield* Effect.gen(function* () {
        const shouldImport = yield* needsInitialImport(ctx.fenrirSkillsPath, [
          ...ctx.adapters,
        ]).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
        );
        if (shouldImport) {
          yield* importProviderSkills(ctx.fenrirSkillsPath, [...ctx.adapters]).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
          );
        }
      }).pipe(Effect.ignoreCause({ log: true }));

      // Start watchers in a new scope
      const newScope = yield* Scope.make("sequential");
      yield* Ref.set(watcherScopeRef, newScope);
      yield* startWatchersForContext(ctx, newScope);
    });

  // ── setActiveProjectRoot ──────────────────────────────────────

  const setActiveProjectRoot = (newProjectRoot: string) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const currentCtx = yield* Ref.get(projectCtxRef);
        if (currentCtx.projectRoot === newProjectRoot) return;

        yield* Effect.logInfo(
          `Skill service switching project root: ${currentCtx.projectRoot} → ${newProjectRoot}`,
        );

        // Build new context (provide FS/Path so adapter requirements are satisfied)
        const newClaudeAdapter = yield* makeClaudeSkillAdapter(newProjectRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
        );
        const newCtx: SkillProjectContext = {
          projectRoot: newProjectRoot,
          fenrirSkillsPath: pathService.join(newProjectRoot, ".fenrir", "skills"),
          adapters: [newClaudeAdapter, codexAdapterStub],
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

    ready: Deferred.await(startedDeferred),

    setActiveProjectRoot,

    getAll: getAllFromCache,

    getByName: (name) =>
      Effect.gen(function* () {
        const all = yield* getAllFromCache;
        const found = all.find((s) => s.name === name);
        if (!found) {
          return yield* Effect.fail(new SkillServiceError(`Skill not found: ${name}`));
        }
        return found;
      }),

    create,
    update,
    delete: deleteSkill,
    toggleEnabled,
    resolveConflict,
    streamChanges: Stream.fromPubSub(changesPubSub),
  });
});

export const SkillServiceLive = Layer.effect(SkillService, makeSkillService);
