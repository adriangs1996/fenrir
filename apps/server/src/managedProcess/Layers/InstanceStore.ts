/**
 * InstanceStore layer - JSON-file persistence for managed process instances.
 *
 * One JSON file per project at:
 *   {stateDir}/managed-process/{projectId}/instances.json
 *
 * Read-modify-write is serialized per-project via an in-memory keyed mutex.
 * Uses atomicWrite for write-then-rename safety.
 *
 * @module ManagedProcess/Layers/InstanceStore
 */
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import { writeFileStringAtomically } from "../../atomicWrite.ts";
import {
  InstanceStore,
  InstanceStoreError,
  type InstanceStoreShape,
  type PersistedInstanceRecord,
} from "../Services/InstanceStore.ts";
import type { ProjectId } from "@fenrir/contracts";

// ── Schema for on-disk validation ──

const PersistedInstanceRecordSchema = Schema.Struct({
  instanceId: Schema.String,
  processDefId: Schema.String,
  projectId: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  definitionSnapshot: Schema.Unknown,
  executor: Schema.String,
  tmuxWindow: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(Schema.Number),
});

const InstancesFileSchema = Schema.Array(PersistedInstanceRecordSchema);

// ── Helpers ──

function projectFilePath(
  stateDir: string,
  projectId: ProjectId,
  join: (...args: string[]) => string,
): string {
  return join(stateDir, "managed-process", projectId, "instances.json");
}

// ── Implementation ──

const makeInstanceStore = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const { join } = pathService;

  // Keyed mutex: one semaphore per projectId to serialize read-modify-write
  const mutexes = new Map<string, Semaphore.Semaphore>();

  function getMutex(projectId: ProjectId): Effect.Effect<Semaphore.Semaphore> {
    const existing = mutexes.get(projectId);
    if (existing) return Effect.succeed(existing);
    return Semaphore.make(1).pipe(
      Effect.tap((sem) => Effect.sync(() => mutexes.set(projectId, sem))),
    );
  }

  function filePath(projectId: ProjectId): string {
    return projectFilePath(stateDir, projectId, join);
  }

  function readRecords(
    projectId: ProjectId,
  ): Effect.Effect<PersistedInstanceRecord[], InstanceStoreError> {
    const fp = filePath(projectId);
    return Effect.gen(function* () {
      const exists = yield* fs
        .exists(fp)
        .pipe(Effect.mapError((e) => new InstanceStoreError("io", `failed to check ${fp}`, e)));
      if (!exists) return [];

      const raw = yield* fs
        .readFileString(fp)
        .pipe(Effect.mapError((e) => new InstanceStoreError("io", `failed to read ${fp}`, e)));

      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (error) => new InstanceStoreError("decode", `failed to parse ${fp}`, error),
      }).pipe(
        Effect.catchTag("InstanceStoreError", (error) =>
          Effect.logWarning("InstanceStore: corrupt JSON, returning empty list", {
            path: fp,
            error: error.cause,
          }).pipe(Effect.as(null)),
        ),
      );
      if (parsed === null) {
        return [];
      }

      const decoded = Schema.decodeUnknownExit(InstancesFileSchema)(parsed);
      if (decoded._tag === "Failure") {
        yield* Effect.logWarning("InstanceStore: schema validation failed, returning empty list", {
          path: fp,
        });
        return [];
      }

      return decoded.value as unknown as PersistedInstanceRecord[];
    });
  }

  function writeRecords(
    projectId: ProjectId,
    records: PersistedInstanceRecord[],
  ): Effect.Effect<void, InstanceStoreError> {
    const fp = filePath(projectId);
    return writeFileStringAtomically({
      filePath: fp,
      contents: `${JSON.stringify(records, null, 2)}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, pathService),
      Effect.mapError((e) => new InstanceStoreError("io", `failed to write ${fp}`, e)),
    );
  }

  const list: InstanceStoreShape["list"] = (projectId) => readRecords(projectId);

  const upsert: InstanceStoreShape["upsert"] = (record) =>
    Effect.gen(function* () {
      const mutex = yield* getMutex(record.projectId);
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const records = yield* readRecords(record.projectId);
          const idx = records.findIndex((r) => r.instanceId === record.instanceId);
          if (idx >= 0) {
            records[idx] = record;
          } else {
            records.push(record);
          }
          yield* writeRecords(record.projectId, records);
        }),
      );
    });

  const remove: InstanceStoreShape["remove"] = (instanceId) =>
    Effect.gen(function* () {
      // Must scan all project directories to find the instance
      const allRecords = yield* listAllInternal();
      const target = allRecords.find((r) => r.instanceId === instanceId);
      if (!target) return;

      const mutex = yield* getMutex(target.projectId);
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const records = yield* readRecords(target.projectId);
          const filtered = records.filter((r) => r.instanceId !== instanceId);
          yield* writeRecords(target.projectId, filtered);
        }),
      );
    });

  function listAllInternal(): Effect.Effect<PersistedInstanceRecord[], InstanceStoreError> {
    const managedProcessDir = join(stateDir, "managed-process");
    return Effect.gen(function* () {
      const dirExists = yield* fs
        .exists(managedProcessDir)
        .pipe(
          Effect.mapError(
            (e) => new InstanceStoreError("io", `failed to check ${managedProcessDir}`, e),
          ),
        );
      if (!dirExists) return [];

      const entries = yield* fs
        .readDirectory(managedProcessDir)
        .pipe(
          Effect.mapError(
            (e) => new InstanceStoreError("io", `failed to list ${managedProcessDir}`, e),
          ),
        );

      const results: PersistedInstanceRecord[] = [];
      for (const entry of entries) {
        const instancesFile = join(managedProcessDir, entry, "instances.json");
        const fileExists = yield* fs
          .exists(instancesFile)
          .pipe(
            Effect.mapError(
              (e) => new InstanceStoreError("io", `failed to check ${instancesFile}`, e),
            ),
          );
        if (!fileExists) continue;

        // Use the directory name as projectId
        const records = yield* readRecords(entry as ProjectId);
        results.push(...records);
      }
      return results;
    });
  }

  const listAll: InstanceStoreShape["listAll"] = () => listAllInternal();

  return { list, upsert, remove, listAll } satisfies InstanceStoreShape;
});

export const InstanceStoreLive = Layer.effect(InstanceStore, makeInstanceStore);
