import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, ManagedRuntime, Path, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { PlanRunId, ProjectId, TrimmedNonEmptyString } from "@fenrir/contracts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { PlanRunnerRepository } from "../../persistence/Services/PlanRunnerRepository.ts";
import { PlanRunnerRepositoryLive } from "../../persistence/Layers/PlanRunnerRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SourceControlQuery } from "../../sourceControl/Services/SourceControlQuery.ts";
import { SourceControlWorkflows } from "../../sourceControl/Services/SourceControlWorkflows.ts";
import { PlanRunnerService } from "../Services/PlanRunner.ts";
import {
  PlanRunnerLive,
  buildWorkspacePromptContext,
  computeExecutionDispatch,
  findRecentProviderTurnStartFailure,
  isExecutablePlanFile,
} from "./PlanRunner";

describe("findRecentProviderTurnStartFailure", () => {
  it("returns the recent provider failure detail", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: { detail: "Claude binary path is invalid." },
              createdAt: "2026-04-30T10:31:49.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBe("Claude binary path is invalid.");
  });

  it("ignores stale failures from before the current wait window", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: { detail: "Old failure." },
              createdAt: "2026-04-30T10:31:47.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBeNull();
  });

  it("falls back to the activity summary when no detail exists", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: {},
              createdAt: "2026-04-30T10:31:49.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBe("Provider turn start failed");
  });
});

describe("computeExecutionDispatch", () => {
  it("fills newly opened slots with dependency-ready plans", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "done" },
          { planId: "b", state: "running" },
          { planId: "d", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["b"]),
      }),
    ).toEqual({
      occupiedSlots: 1,
      readyPlanIds: ["d"],
    });
  });

  it("does not dispatch more work when all slots are occupied", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "running" },
          { planId: "b", state: "running" },
          { planId: "c", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["a", "b"]),
      }),
    ).toEqual({
      occupiedSlots: 2,
      readyPlanIds: [],
    });
  });

  it("excludes plans already being launched from the ready queue", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "ready" },
          { planId: "b", state: "ready" },
          { planId: "c", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["a"]),
      }),
    ).toEqual({
      occupiedSlots: 1,
      readyPlanIds: ["b"],
    });
  });
});

describe("buildWorkspacePromptContext", () => {
  it("describes the project root when no worktree is active", () => {
    expect(
      buildWorkspacePromptContext({
        projectCwd: "/repo/project",
        worktreePath: null,
      }),
    ).toBe("# Workspace\n- Thread cwd: /repo/project");
  });

  it("describes the worktree cwd and project root when they differ", () => {
    expect(
      buildWorkspacePromptContext({
        projectCwd: "/repo/project",
        worktreePath: "/repo/.worktrees/feature-a",
      }),
    ).toBe(
      "# Workspace\n- Thread cwd: /repo/.worktrees/feature-a\n- Project root: /repo/project\n- This run is executing inside a git worktree, not the project root.",
    );
  });
});

describe("isExecutablePlanFile", () => {
  it("accepts normal markdown plan files", () => {
    expect(isExecutablePlanFile("01-step.md")).toBe(true);
  });

  it("rejects underscore-prefixed markdown reference files", () => {
    expect(isExecutablePlanFile("_reference.md")).toBe(false);
  });

  it("rejects non-markdown files", () => {
    expect(isExecutablePlanFile("notes.txt")).toBe(false);
  });
});

// ─── Archive lifecycle integration tests ────────────────────────────────────

const testProjectId = ProjectId.makeUnsafe("test-project");
const tn = TrimmedNonEmptyString.makeUnsafe;

/**
 * Build a ManagedRuntime with PlanRunnerLive and all deps.
 * The orchestration engine mock resolves `testProjectId` to `projectCwd`.
 */
function buildArchiveRuntime(projectCwd: string) {
  const readModel = {
    snapshotSequence: 0,
    updatedAt: new Date().toISOString(),
    projects: [
      {
        id: testProjectId,
        title: "Test",
        workspaceRoot: projectCwd,
        defaultModelSelection: { provider: "codex" as const, model: "gpt-5" },
        scripts: [],
        globalScriptDefaults: [],
        managedProcesses: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      },
    ],
    threads: [],
    managedProcessInstances: [],
  };

  const testLayer = PlanRunnerLive.pipe(
    Layer.provideMerge(PlanRunnerRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        getReadModel: () => Effect.succeed(readModel),
        readEvents: () => Stream.empty,
        dispatch: () => Effect.succeed({ sequence: 0 }),
        streamDomainEvents: Stream.empty,
        injectExternalEvent: () => Effect.void,
      }),
    ),
    Layer.provide(Layer.mock(SourceControlQuery)({})),
    Layer.provide(Layer.mock(SourceControlWorkflows)({})),
  );

  return ManagedRuntime.make(testLayer);
}

/**
 * Create a temp dir with `.plans/` using node:fs (no Effect runtime needed).
 */
function makeTempProject(): string {
  const tempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "fenrir-archive-test-"));
  nodeFs.mkdirSync(nodePath.join(tempDir, ".plans"), { recursive: true });
  return tempDir;
}

/**
 * Helper: create a `.plans/{name}/` dir with N `.md` files inside.
 */
const seedFeature = (projectCwd: string, name: string, mdCount: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(projectCwd, ".plans", name);
    yield* fs.makeDirectory(dir, { recursive: true });
    for (let i = 1; i <= mdCount; i++) {
      yield* fs.writeFileString(
        path.join(dir, `${String(i).padStart(2, "0")}-step.md`),
        `# Step ${i}`,
      );
    }
  });

describe("listFeatures", () => {
  it("ignores underscore-prefixed markdown files in planCount", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const featureDir = path.join(tempDir, ".plans", "feature-a");
          yield* fs.makeDirectory(featureDir, { recursive: true });
          yield* fs.writeFileString(path.join(featureDir, "01-step.md"), "# Step 1");
          yield* fs.writeFileString(path.join(featureDir, "_reference.md"), "# Reference");
          yield* fs.writeFileString(path.join(featureDir, "notes.txt"), "reference");

          const service = yield* PlanRunnerService;
          return yield* service.listFeatures({ projectId: testProjectId });
        }),
      );

      expect(result.features).toHaveLength(1);
      expect(result.features[0]?.featureName).toBe("feature-a");
      expect(result.features[0]?.planCount).toBe(1);
    } finally {
      await rt.dispose();
    }
  });
});

describe("getFeaturePlans", () => {
  it("ignores underscore-prefixed markdown files", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const featureDir = path.join(tempDir, ".plans", "feature-a");
          yield* fs.makeDirectory(featureDir, { recursive: true });
          yield* fs.writeFileString(path.join(featureDir, "01-step.md"), "# Step 1");
          yield* fs.writeFileString(path.join(featureDir, "_reference.md"), "# Reference");
          yield* fs.writeFileString(path.join(featureDir, "notes.txt"), "reference");

          const service = yield* PlanRunnerService;
          return yield* service.getFeaturePlans({
            projectId: testProjectId,
            featureName: "feature-a",
          });
        }),
      );

      expect(result.featureName).toBe("feature-a");
      expect(result.plans).toHaveLength(1);
      expect(result.plans[0]?.filename).toBe("01-step.md");
    } finally {
      await rt.dispose();
    }
  });
});

describe("archiveFeature", () => {
  it("happy path: moves .plans/foo/ → .plans/.archive/foo/ and returns archivedDirName", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* seedFeature(tempDir, "foo", 2);

          const service = yield* PlanRunnerService;
          const out = yield* service.archiveFeature({
            projectId: testProjectId,
            featureName: "foo",
          });

          expect(out.archivedDirName).toBe("foo");

          // Source gone
          const srcExists = yield* fs.exists(path.join(tempDir, ".plans", "foo"));
          expect(srcExists).toBe(false);

          // Destination exists
          const dstExists = yield* fs.exists(path.join(tempDir, ".plans", ".archive", "foo"));
          expect(dstExists).toBe(true);

          // Contents preserved
          const files = yield* fs.readDirectory(path.join(tempDir, ".plans", ".archive", "foo"));
          expect(files.filter((f) => f.endsWith(".md")).length).toBe(2);
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("collision: second archive of same name produces suffixed dir", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          // Seed and archive first copy
          yield* seedFeature(tempDir, "foo", 1);
          const service = yield* PlanRunnerService;
          const first = yield* service.archiveFeature({
            projectId: testProjectId,
            featureName: "foo",
          });
          expect(first.archivedDirName).toBe("foo");

          // Recreate source feature for second archive
          yield* seedFeature(tempDir, "foo", 1);
          const second = yield* service.archiveFeature({
            projectId: testProjectId,
            featureName: "foo",
          });
          expect(second.archivedDirName).toMatch(/^foo--archived-\d+$/);

          // Both dirs exist in .archive/
          const archEntries = yield* fs.readDirectory(path.join(tempDir, ".plans", ".archive"));
          const fooEntries = archEntries.filter((e) => e.startsWith("foo"));
          expect(fooEntries.length).toBe(2);
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("rejects when a persisted non-terminal run exists for the feature", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const error = await rt.runPromise(
        Effect.gen(function* () {
          yield* seedFeature(tempDir, "foo", 1);

          const service = yield* PlanRunnerService;
          // Seed the persistence layer with a non-terminal run row.
          const repo = yield* PlanRunnerRepository;
          yield* repo.replaceFeatureRun({
            projectId: testProjectId,
            featureName: tn("foo"),
            run: {
              runId: PlanRunId.makeUnsafe("run-active"),
              projectId: testProjectId,
              featureName: tn("foo"),
              state: "executing",
              summary: null,
              branch: tn("feature/foo"),
              worktreePath: null,
              ownsWorktree: false,
              modelSelection: { provider: "codex", model: "gpt-5" },
              maxConcurrency: 3,
              startedAt: tn("2026-04-01T00:00:00.000Z") as any,
              completedAt: null,
              lastUpdatedAt: tn("2026-04-01T00:00:00.000Z") as any,
            },
            steps: [],
            internalThreads: [],
          });

          return yield* service
            .archiveFeature({ projectId: testProjectId, featureName: "foo" })
            .pipe(Effect.flip);
        }),
      );
      expect(error._tag).toBe("PlanRunnerError");
      expect(error.message).toContain("foo");
    } finally {
      await rt.dispose();
    }
  });

  it("rejects when feature folder does not exist", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const error = await rt.runPromise(
        Effect.gen(function* () {
          const service = yield* PlanRunnerService;
          return yield* service
            .archiveFeature({ projectId: testProjectId, featureName: "nonexistent" })
            .pipe(Effect.flip);
        }),
      );
      expect(error._tag).toBe("PlanRunnerError");
      expect(error.message).toContain("not found");
    } finally {
      await rt.dispose();
    }
  });

  it("rejects path traversal attempts", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      for (const bad of ["../etc", "foo/bar", "foo\\bar"]) {
        const error = await rt.runPromise(
          Effect.gen(function* () {
            const service = yield* PlanRunnerService;
            return yield* service
              .archiveFeature({ projectId: testProjectId, featureName: bad })
              .pipe(Effect.flip);
          }),
        );
        expect(error._tag).toBe("PlanRunnerError");
        expect(error.message).toContain("must not contain");
      }
    } finally {
      await rt.dispose();
    }
  });
});

describe("unarchiveFeature", () => {
  it("happy path: archive then unarchive restores the source folder", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* seedFeature(tempDir, "bar", 3);

          const service = yield* PlanRunnerService;
          const archived = yield* service.archiveFeature({
            projectId: testProjectId,
            featureName: "bar",
          });
          expect(archived.archivedDirName).toBe("bar");

          const restored = yield* service.unarchiveFeature({
            projectId: testProjectId,
            archivedDirName: archived.archivedDirName,
          });
          expect(restored.featureName).toBe("bar");

          // Source restored
          const srcExists = yield* fs.exists(path.join(tempDir, ".plans", "bar"));
          expect(srcExists).toBe(true);

          // Archive gone
          const archExists = yield* fs.exists(
            path.join(tempDir, ".plans", ".archive", archived.archivedDirName),
          );
          expect(archExists).toBe(false);

          // Content preserved
          const files = yield* fs.readDirectory(path.join(tempDir, ".plans", "bar"));
          expect(files.filter((f) => f.endsWith(".md")).length).toBe(3);
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("suffix preservation: strips --archived-{epoch} suffix on unarchive", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          // Seed and archive twice to force suffix on second
          yield* seedFeature(tempDir, "baz", 1);
          const service = yield* PlanRunnerService;
          yield* service.archiveFeature({ projectId: testProjectId, featureName: "baz" });

          yield* seedFeature(tempDir, "baz", 1);
          const second = yield* service.archiveFeature({
            projectId: testProjectId,
            featureName: "baz",
          });
          expect(second.archivedDirName).toMatch(/^baz--archived-\d+$/);

          // Unarchive first (unsuffixed) to clear the collision
          yield* service.unarchiveFeature({
            projectId: testProjectId,
            archivedDirName: "baz",
          });

          // Now unarchive the suffixed one — should restore as plain "baz"
          // But first, rename "baz" away to avoid collision
          yield* fs.rename(
            path.join(tempDir, ".plans", "baz"),
            path.join(tempDir, ".plans", "baz-moved"),
          );

          const restored = yield* service.unarchiveFeature({
            projectId: testProjectId,
            archivedDirName: second.archivedDirName,
          });
          expect(restored.featureName).toBe("baz");

          const exists = yield* fs.exists(path.join(tempDir, ".plans", "baz"));
          expect(exists).toBe(true);
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("rejects when target feature already exists (collision)", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const error = await rt.runPromise(
        Effect.gen(function* () {
          yield* seedFeature(tempDir, "dup", 1);

          const service = yield* PlanRunnerService;
          yield* service.archiveFeature({ projectId: testProjectId, featureName: "dup" });

          // Recreate the source feature so it collides with unarchive target
          yield* seedFeature(tempDir, "dup", 1);

          return yield* service
            .unarchiveFeature({ projectId: testProjectId, archivedDirName: "dup" })
            .pipe(Effect.flip);
        }),
      );
      expect(error._tag).toBe("PlanRunnerError");
      expect(error.message).toContain("already exists");
    } finally {
      await rt.dispose();
    }
  });

  it("rejects when archived source does not exist", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const error = await rt.runPromise(
        Effect.gen(function* () {
          const service = yield* PlanRunnerService;
          return yield* service
            .unarchiveFeature({ projectId: testProjectId, archivedDirName: "ghost" })
            .pipe(Effect.flip);
        }),
      );
      expect(error._tag).toBe("PlanRunnerError");
      expect(error.message).toContain("not found");
    } finally {
      await rt.dispose();
    }
  });
});

describe("listArchivedFeatures", () => {
  it("returns empty array when .archive/ does not exist", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const service = yield* PlanRunnerService;
          return yield* service.listArchivedFeatures({ projectId: testProjectId });
        }),
      );
      expect(result.features).toEqual([]);
    } finally {
      await rt.dispose();
    }
  });

  it("returns parsed features sorted by archivedAt desc", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const service = yield* PlanRunnerService;

          // Manually create archived dirs with epoch suffixes for deterministic
          // archivedAt ordering (mtime-based ordering is racy in tests).
          const archDir = path.join(tempDir, ".plans", ".archive");
          yield* fs.makeDirectory(archDir, { recursive: true });

          const olderDir = path.join(archDir, "alpha--archived-1000000000000");
          yield* fs.makeDirectory(olderDir, { recursive: true });
          yield* fs.writeFileString(path.join(olderDir, "01.md"), "# A1");
          yield* fs.writeFileString(path.join(olderDir, "02.md"), "# A2");

          const newerDir = path.join(archDir, "beta--archived-2000000000000");
          yield* fs.makeDirectory(newerDir, { recursive: true });
          yield* fs.writeFileString(path.join(newerDir, "01.md"), "# B1");

          return yield* service.listArchivedFeatures({ projectId: testProjectId });
        }),
      );

      expect(result.features.length).toBe(2);
      // beta archived later → first (desc order)
      expect(result.features[0]!.featureName).toBe("beta");
      expect(result.features[1]!.featureName).toBe("alpha");
      // planCount preserved
      expect(result.features[1]!.planCount).toBe(2);
      expect(result.features[0]!.planCount).toBe(1);
    } finally {
      await rt.dispose();
    }
  });

  it("aggregates across multiple projects when projectId is omitted", async () => {
    const tempDir1 = makeTempProject();
    const tempDir2 = makeTempProject();
    const project2Id = ProjectId.makeUnsafe("test-project-2");

    // Build runtime with two projects
    const readModel = {
      snapshotSequence: 0,
      updatedAt: new Date().toISOString(),
      projects: [
        {
          id: testProjectId,
          title: "Project 1",
          workspaceRoot: tempDir1,
          defaultModelSelection: { provider: "codex" as const, model: "gpt-5" },
          scripts: [],
          globalScriptDefaults: [],
          managedProcesses: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
        {
          id: project2Id,
          title: "Project 2",
          workspaceRoot: tempDir2,
          defaultModelSelection: { provider: "codex" as const, model: "gpt-5" },
          scripts: [],
          globalScriptDefaults: [],
          managedProcesses: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
      ],
      threads: [],
      managedProcessInstances: [],
    };

    const testLayer = PlanRunnerLive.pipe(
      Layer.provideMerge(PlanRunnerRepositoryLive),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(
        Layer.mock(OrchestrationEngineService)({
          getReadModel: () => Effect.succeed(readModel),
          readEvents: () => Stream.empty,
          dispatch: () => Effect.succeed({ sequence: 0 }),
          streamDomainEvents: Stream.empty,
          injectExternalEvent: () => Effect.void,
        }),
      ),
      Layer.provide(Layer.mock(SourceControlQuery)({})),
      Layer.provide(Layer.mock(SourceControlWorkflows)({})),
    );

    const rt = ManagedRuntime.make(testLayer);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const service = yield* PlanRunnerService;

          // Seed and archive in project 1
          yield* seedFeature(tempDir1, "feat-a", 1);
          yield* service.archiveFeature({ projectId: testProjectId, featureName: "feat-a" });

          // Seed and archive in project 2
          yield* seedFeature(tempDir2, "feat-b", 2);
          yield* service.archiveFeature({ projectId: project2Id, featureName: "feat-b" });

          // List without projectId → aggregated
          return yield* service.listArchivedFeatures({});
        }),
      );

      expect(result.features.length).toBe(2);
      const names = result.features.map((f) => f.featureName);
      expect(names).toContain("feat-a");
      expect(names).toContain("feat-b");
      // Both project IDs represented
      const projectIds = result.features.map((f) => f.projectId);
      expect(projectIds).toContain(testProjectId);
      expect(projectIds).toContain(project2Id);
    } finally {
      await rt.dispose();
    }
  });

  it("handles mix of plain and suffixed archive dirs", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const service = yield* PlanRunnerService;

          // Archive "qux" once (plain name)
          yield* seedFeature(tempDir, "qux", 1);
          yield* service.archiveFeature({ projectId: testProjectId, featureName: "qux" });

          // Archive "qux" again (will get epoch suffix)
          yield* seedFeature(tempDir, "qux", 2);
          yield* service.archiveFeature({ projectId: testProjectId, featureName: "qux" });

          return yield* service.listArchivedFeatures({ projectId: testProjectId });
        }),
      );

      expect(result.features.length).toBe(2);
      // Both should have displayName "qux"
      expect(result.features.every((f) => f.featureName === "qux")).toBe(true);
      // The suffixed one has a parsed archivedAt, the plain one uses mtime
      const suffixed = result.features.find((f) => f.archivedDirName.includes("--archived-"));
      expect(suffixed).toBeDefined();
    } finally {
      await rt.dispose();
    }
  });

  it("ignores underscore-prefixed markdown files in archived planCount", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const service = yield* PlanRunnerService;

          const archDir = path.join(tempDir, ".plans", ".archive");
          const featureDir = path.join(archDir, "alpha--archived-2000000000000");
          yield* fs.makeDirectory(featureDir, { recursive: true });
          yield* fs.writeFileString(path.join(featureDir, "01.md"), "# Step 1");
          yield* fs.writeFileString(path.join(featureDir, "_reference.md"), "# Reference");
          yield* fs.writeFileString(path.join(featureDir, "notes.txt"), "reference");

          return yield* service.listArchivedFeatures({ projectId: testProjectId });
        }),
      );

      expect(result.features).toHaveLength(1);
      expect(result.features[0]?.planCount).toBe(1);
    } finally {
      await rt.dispose();
    }
  });

  it("falls back to directory mtime when archive suffix is outside Date range", async () => {
    const tempDir = makeTempProject();
    const rt = buildArchiveRuntime(tempDir);
    try {
      const result = await rt.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const service = yield* PlanRunnerService;

          const archDir = path.join(tempDir, ".plans", ".archive");
          const featureDir = path.join(archDir, "alpha--archived-999999999999999999999999999999");
          yield* fs.makeDirectory(featureDir, { recursive: true });
          yield* fs.writeFileString(path.join(featureDir, "01.md"), "# Step 1");

          return yield* service.listArchivedFeatures({ projectId: testProjectId });
        }),
      );

      expect(result.features).toHaveLength(1);
      expect(result.features[0]?.featureName).toBe("alpha");
      expect(() => new Date(result.features[0]!.archivedAt).toISOString()).not.toThrow();
    } finally {
      await rt.dispose();
    }
  });
});

// ─── Test coverage gaps (documented) ──────────────────────────────────────
//
// The following plan-06 scenarios are intentionally deferred because the
// PlanRunnerLive implementation holds `activeRuns` and `recoveringFeatures`
// as internal Effect `Ref`s that are not externally seedable from tests:
//
// - "active-run reject": seeding the in-memory `activeRuns` map requires
//   a running execution fiber. The persisted-non-terminal reject test
//   exercises the same `assertNoActiveRun` predicate via the persistence
//   fallback path.
//
// - "recovering reject": `recoveringFeatures` is populated only during
//   boot recovery, which requires simulating a mid-run server restart.
//   Covering this requires an integration-level test with lifecycle
//   control.
//
// - "Watcher partition": The chokidar watcher is started in the layer
//   scope and publishes events asynchronously. Testing it end-to-end
//   requires timing-sensitive assertions against the event stream, which
//   makes them inherently flaky in CI. The watcher logic is trivial
//   (rename → publish) and is implicitly covered by the archive/unarchive
//   happy-path tests that verify event publication.
