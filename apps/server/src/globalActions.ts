/**
 * GlobalActions - App-wide actions service.
 *
 * Owns persistence, validation, and change notification of global actions
 * (commands that are available in all projects, with optional {{placeholder}} syntax).
 *
 * Follows the same pattern as `serverSettings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module GlobalActions
 */
import {
  GlobalScript,
  GLOBAL_SCRIPT_RUN_COMMAND_PATTERN,
  MAX_SCRIPT_ID_LENGTH,
  type CreateGlobalActionInput,
  type UpdateGlobalActionInput,
} from "@fenrir/contracts";
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Schema,
  Scope,
  Context,
  Stream,
  Cause,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "./config";
import { watchFileDebounced } from "./fileWatcher.ts";

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export class GlobalActionsError {
  readonly _tag = "GlobalActionsError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

export interface GlobalActionsShape {
  /** Start the service runtime and attach file watching. */
  readonly start: Effect.Effect<void, GlobalActionsError>;

  /** Await runtime readiness. */
  readonly ready: Effect.Effect<void, GlobalActionsError>;

  /** Read the current global actions list. */
  readonly getAll: Effect.Effect<readonly GlobalScript[], GlobalActionsError>;

  /** Create a new global action. */
  readonly create: (
    input: CreateGlobalActionInput,
  ) => Effect.Effect<GlobalScript, GlobalActionsError>;

  /** Update an existing global action. */
  readonly update: (
    id: string,
    input: UpdateGlobalActionInput,
  ) => Effect.Effect<GlobalScript, GlobalActionsError>;

  /** Delete a global action by id. */
  readonly delete: (id: string) => Effect.Effect<void, GlobalActionsError>;

  /** Stream of global actions change events. */
  readonly streamChanges: Stream.Stream<readonly GlobalScript[]>;
}

export class GlobalActionsService extends Context.Service<
  GlobalActionsService,
  GlobalActionsShape
>()("t3/globalActions/GlobalActionsService") {}

// ---------------------------------------------------------------------------
// ID helpers (mirrors apps/web/src/projectScripts.ts normalizeScriptId logic)
// ---------------------------------------------------------------------------

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return "script";
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

function nextGlobalScriptId(name: string, existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
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

function isValidGlobalScriptId(id: string): boolean {
  return isGlobalScriptRunCommand(`global-script.${id}.run`);
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

const GlobalActionsJson = Schema.fromJsonString(Schema.Array(GlobalScript));
const isGlobalScriptRunCommand = Schema.is(GLOBAL_SCRIPT_RUN_COMMAND_PATTERN);
const decodeUnknownGlobalScript = Schema.decodeUnknownExit(GlobalScript);
const decodeUnknownGlobalActionsJson = Schema.decodeUnknownExit(GlobalActionsJson);

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export const makeGlobalActions = Effect.gen(function* () {
  const { globalActionsPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "globalActions" as const;
  const changesPubSub = yield* PubSub.unbounded<readonly GlobalScript[]>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, GlobalActionsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (actions: readonly GlobalScript[]) =>
    PubSub.publish(changesPubSub, actions).pipe(Effect.asVoid);

  const decodeGlobalScript = (input: unknown) => {
    const decoded = decodeUnknownGlobalScript(input);
    if (decoded._tag === "Failure") {
      return Effect.fail(
        new GlobalActionsError(`Invalid global action: ${Cause.pretty(decoded.cause)}`),
      );
    }
    if (!isValidGlobalScriptId(decoded.value.id)) {
      return Effect.fail(
        new GlobalActionsError(
          `Invalid global action id "${decoded.value.id}": ids must be valid keybinding command ids with at most ${MAX_SCRIPT_ID_LENGTH} characters.`,
        ),
      );
    }
    return Effect.succeed(decoded.value);
  };

  const validateGlobalActions = (actions: readonly GlobalScript[]) =>
    Effect.forEach(actions, decodeGlobalScript, { discard: true }).pipe(Effect.asVoid);

  // -- Disk I/O -----------------------------------------------------------

  const loadFromDisk: Effect.Effect<readonly GlobalScript[], GlobalActionsError> = Effect.gen(
    function* () {
      const exists = yield* fs
        .exists(globalActionsPath)
        .pipe(
          Effect.mapError(
            (cause) =>
              new GlobalActionsError("failed to check global-actions.json existence", cause),
          ),
        );
      if (!exists) return [] as readonly GlobalScript[];

      const raw = yield* fs
        .readFileString(globalActionsPath)
        .pipe(
          Effect.mapError(
            (cause) => new GlobalActionsError("failed to read global-actions.json", cause),
          ),
        );

      const decoded = decodeUnknownGlobalActionsJson(raw);
      if (decoded._tag === "Failure") {
        yield* Effect.logWarning("failed to parse global-actions.json, using empty list", {
          path: globalActionsPath,
          issues: Cause.pretty(decoded.cause),
        });
        return [] as readonly GlobalScript[];
      }

      const validActions: GlobalScript[] = [];
      for (const action of decoded.value) {
        if (isValidGlobalScriptId(action.id)) {
          validActions.push(action);
          continue;
        }
        yield* Effect.logWarning("ignoring invalid global action entry", {
          path: globalActionsPath,
          id: action.id,
          error: `id must be a valid global script command id with at most ${MAX_SCRIPT_ID_LENGTH} characters`,
        });
      }
      return validActions;
    },
  );

  const actionsCache = yield* Cache.make<
    typeof cacheKey,
    readonly GlobalScript[],
    GlobalActionsError
  >({
    capacity: 1,
    lookup: () => loadFromDisk,
  });

  const getAllFromCache = Cache.get(actionsCache, cacheKey);

  const writeAtomically = (actions: readonly GlobalScript[]) => {
    const tempPath = `${globalActionsPath}.${process.pid}.${Date.now()}.tmp`;

    return validateGlobalActions(actions).pipe(
      Effect.as(`${JSON.stringify(actions, null, 2)}\n`),
      Effect.tap(() =>
        fs.makeDirectory(pathService.dirname(globalActionsPath), { recursive: true }),
      ),
      Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fs.rename(tempPath, globalActionsPath)),
      Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
      Effect.mapError(
        (cause) => new GlobalActionsError("failed to write global-actions.json", cause),
      ),
    );
  };

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(actionsCache, cacheKey);
      const actions = yield* getAllFromCache;
      yield* emitChange(actions);
    }),
  );

  // -- File watcher -------------------------------------------------------

  const startWatcher = Effect.gen(function* () {
    yield* fs
      .makeDirectory(pathService.dirname(globalActionsPath), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new GlobalActionsError("failed to prepare global-actions directory", cause),
        ),
      );

    yield* watchFileDebounced({
      filePath: globalActionsPath,
      debounce: Duration.millis(100),
      scope: watcherScope,
      onChange: revalidateAndEmit,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, pathService),
    );
  });

  // -- CRUD ---------------------------------------------------------------

  const create = (input: CreateGlobalActionInput) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getAllFromCache;
        const id = nextGlobalScriptId(
          input.name,
          current.map((s) => s.id),
        );
        const script = yield* decodeGlobalScript({
          id,
          name: input.name.trim(),
          command: input.command.trim(),
          icon: input.icon,
        });
        const next = [...current, script];
        yield* writeAtomically(next);
        yield* Cache.invalidate(actionsCache, cacheKey);
        yield* emitChange(next);
        return script;
      }),
    );

  const update = (id: string, input: UpdateGlobalActionInput) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getAllFromCache;
        const index = current.findIndex((s) => s.id === id);
        if (index === -1) {
          return yield* Effect.fail(new GlobalActionsError(`Global action not found: ${id}`));
        }
        const updated = yield* decodeGlobalScript({
          id,
          name: input.name.trim(),
          command: input.command.trim(),
          icon: input.icon,
        });
        const next = [...current];
        next[index] = updated;
        yield* writeAtomically(next);
        yield* Cache.invalidate(actionsCache, cacheKey);
        yield* emitChange(next);
        return updated;
      }),
    );

  const deleteAction = (id: string) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getAllFromCache;
        const next = current.filter((s) => s.id !== id);
        if (next.length === current.length) {
          return yield* Effect.fail(new GlobalActionsError(`Global action not found: ${id}`));
        }
        yield* writeAtomically(next);
        yield* Cache.invalidate(actionsCache, cacheKey);
        yield* emitChange(next);
      }),
    );

  // -- Service return -----------------------------------------------------

  return GlobalActionsService.of({
    start: Effect.gen(function* () {
      const alreadyStarted = yield* Ref.getAndSet(startedRef, true);
      if (alreadyStarted) {
        yield* Deferred.await(startedDeferred);
        return;
      }
      yield* startWatcher.pipe(
        Effect.tap(() => Deferred.succeed(startedDeferred, void 0 as void)),
        Effect.onError((cause) => Deferred.failCause(startedDeferred, cause)),
      );
    }),
    ready: Deferred.await(startedDeferred),
    getAll: getAllFromCache,
    create,
    update,
    delete: deleteAction,
    streamChanges: Stream.fromPubSub(changesPubSub),
  });
});

export const GlobalActionsLive = Layer.effect(GlobalActionsService, makeGlobalActions);
