import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Scope } from "effect";
import { describe, expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { InstanceStore, type PersistedInstanceRecord } from "../Services/InstanceStore.ts";
import { InstanceStoreLive } from "./InstanceStore.ts";
import type { ManagedProcess, ProjectId } from "@fenrir/contracts";

// ── Helpers ──

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fenrir-instance-store-test-",
});
const InstanceStoreTestLayer = InstanceStoreLive.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(InstanceStoreTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const DUMMY_DEFINITION: ManagedProcess = {
  id: "dev-server",
  name: "Dev Server",
  command: "npm run dev",
  icon: "play",
  scope: "project",
  cwd: null,
  env: {},
  proxy: null,
  readiness: { kind: "none" },
  autoRestart: null,
} as ManagedProcess;

function makeRecord(overrides: Partial<PersistedInstanceRecord> = {}): PersistedInstanceRecord {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    instanceId: `inst-${suffix}`,
    processDefId: "dev-server",
    projectId: `project-${suffix}` as ProjectId,
    worktreePath: null,
    startedAt: new Date().toISOString(),
    definitionSnapshot: DUMMY_DEFINITION,
    executor: "tmux",
    tmuxWindow: "fenrir:dev-server",
    pid: 12345,
    ...overrides,
  };
}

// ── Tests ──

it.layer(TestLayer)("InstanceStore", (it) => {
  describe("upsert + list", () => {
    it.effect("round-trip: upsert then list returns the record", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const record = makeRecord();
        yield* store.upsert(record);
        const records = yield* store.list(record.projectId);
        expect(records).toHaveLength(1);
        expect(records[0]!.instanceId).toBe(record.instanceId);
        expect(records[0]!.processDefId).toBe(record.processDefId);
      }),
    );

    it.effect("upsert replaces existing record with same instanceId", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const record = makeRecord();
        yield* store.upsert(record);
        const updated = { ...record, pid: 99999 };
        yield* store.upsert(updated);
        const records = yield* store.list(record.projectId);
        expect(records).toHaveLength(1);
        expect(records[0]!.pid).toBe(99999);
      }),
    );

    it.effect("list returns records scoped to the given projectId", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const r1 = makeRecord({ projectId: "proj-a" as ProjectId });
        const r2 = makeRecord({ projectId: "proj-b" as ProjectId });
        yield* store.upsert(r1);
        yield* store.upsert(r2);

        const projA = yield* store.list("proj-a" as ProjectId);
        expect(projA).toHaveLength(1);
        expect(projA[0]!.instanceId).toBe(r1.instanceId);

        const projB = yield* store.list("proj-b" as ProjectId);
        expect(projB).toHaveLength(1);
        expect(projB[0]!.instanceId).toBe(r2.instanceId);
      }),
    );
  });

  describe("remove", () => {
    it.effect("removes a record by instanceId", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const record = makeRecord();
        yield* store.upsert(record);
        yield* store.remove(record.instanceId);
        const records = yield* store.list(record.projectId);
        expect(records).toHaveLength(0);
      }),
    );

    it.effect("no-op when instanceId does not exist", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        // Should not throw
        yield* store.remove("nonexistent-id");
      }),
    );
  });

  describe("listAll", () => {
    it.effect("enumerates records across multiple project directories", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const r1 = makeRecord({ projectId: "multi-a" as ProjectId });
        const r2 = makeRecord({ projectId: "multi-b" as ProjectId });
        const r3 = makeRecord({ projectId: "multi-b" as ProjectId });
        yield* store.upsert(r1);
        yield* store.upsert(r2);
        yield* store.upsert(r3);

        const all = yield* store.listAll();
        const ids = all.map((r) => r.instanceId);
        expect(ids).toContain(r1.instanceId);
        expect(ids).toContain(r2.instanceId);
        expect(ids).toContain(r3.instanceId);
      }),
    );
  });

  describe("concurrent upserts", () => {
    it.effect("concurrent upserts on same project serialize correctly", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const projectId = "conc-proj" as ProjectId;
        const records = Array.from({ length: 10 }, (_, i) =>
          makeRecord({
            instanceId: `conc-${i}`,
            projectId,
          }),
        );

        // Fire all upserts concurrently
        yield* Effect.all(
          records.map((r) => store.upsert(r)),
          { concurrency: "unbounded" },
        );

        const result = yield* store.list(projectId);
        expect(result).toHaveLength(10);
        const ids = new Set(result.map((r) => r.instanceId));
        for (const r of records) {
          expect(ids.has(r.instanceId)).toBe(true);
        }
      }),
    );
  });

  describe("decode failure", () => {
    it.effect("corrupt JSON yields empty list and does not crash", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const { stateDir } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;

        const projectId = "corrupt-proj" as ProjectId;
        const dir = `${stateDir}/managed-process/${projectId}`;
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(`${dir}/instances.json`, "NOT VALID JSON {{{");

        const records = yield* store.list(projectId);
        expect(records).toEqual([]);
      }),
    );

    it.effect("schema-invalid JSON yields empty list", () =>
      Effect.gen(function* () {
        const store = yield* InstanceStore;
        const { stateDir } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;

        const projectId = "bad-schema-proj" as ProjectId;
        const dir = `${stateDir}/managed-process/${projectId}`;
        yield* fs.makeDirectory(dir, { recursive: true });
        // Valid JSON but wrong shape (object instead of array)
        yield* fs.writeFileString(`${dir}/instances.json`, JSON.stringify({ bad: true }));

        const records = yield* store.list(projectId);
        expect(records).toEqual([]);
      }),
    );
  });
});
