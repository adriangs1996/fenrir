import {
  IsoDateTime,
  NonNegativeInt,
  PlanRunId,
  PlanRunnerLogEntryKind,
  PlanRunnerStepKind,
  PlanRunnerThreadRole,
  PlanState,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  PlanRunnerRepository,
  type PlanRunnerInternalThreadRow,
  type PlanRunnerRunRow,
  type PlanRunnerStepRow,
} from "../Services/PlanRunnerRepository.ts";
import { PlanRunnerRepositoryLive } from "./PlanRunnerRepository.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ts = IsoDateTime.makeUnsafe;
const tn = TrimmedNonEmptyString.makeUnsafe;
const nn = NonNegativeInt.makeUnsafe;

interface MakeRunOpts {
  readonly runId: string;
  readonly projectId: string;
  readonly featureName: string;
  readonly state?: PlanRunnerRunRow["state"];
  readonly startedAt?: string;
  readonly completedAt?: string | null;
  readonly lastUpdatedAt?: string;
}

function makeRunRow(opts: MakeRunOpts): PlanRunnerRunRow {
  const startedAt = ts(opts.startedAt ?? "2026-04-01T00:00:00.000Z");
  return {
    runId: PlanRunId.makeUnsafe(opts.runId),
    projectId: ProjectId.makeUnsafe(opts.projectId),
    featureName: tn(opts.featureName),
    state: opts.state ?? "executing",
    summary: null,
    branch: tn(`feature/${opts.featureName}`),
    worktreePath: `/tmp/${opts.featureName}`,
    ownsWorktree: true,
    modelSelection: { provider: "codex", model: "gpt-5" },
    maxConcurrency: 3,
    startedAt,
    completedAt: opts.completedAt === undefined ? null : ts(opts.completedAt!),
    lastUpdatedAt: ts(opts.lastUpdatedAt ?? opts.startedAt ?? "2026-04-01T00:00:00.000Z"),
  };
}

function makeStepRow(
  overrides: Partial<PlanRunnerStepRow> & { runId: PlanRunId },
): PlanRunnerStepRow {
  return {
    stepKey: tn("plan:p1"),
    stepKind: "plan" satisfies PlanRunnerStepKind,
    planId: "p1",
    filename: tn("01-step.md"),
    planMarkdown: "body",
    dependsOn: [],
    state: "blocked" satisfies PlanState,
    maxRetries: 2,
    retriesUsed: 0,
    error: null,
    failureSummary: null,
    startedAt: null,
    completedAt: null,
    executionOrder: nn(0),
    ...overrides,
  };
}

function makeThreadRow(
  overrides: Partial<PlanRunnerInternalThreadRow> & {
    runId: PlanRunId;
    threadId: ThreadId;
  },
): PlanRunnerInternalThreadRow {
  return {
    stepKey: tn("plan:p1"),
    threadRole: "executor" satisfies PlanRunnerThreadRole,
    createdAt: ts("2026-04-01T00:00:01.000Z"),
    ...overrides,
  };
}

// ─── Per-test fresh DB helper ───────────────────────────────────────────────
//
// `it.layer` builds the layer once per describe call and shares it across
// every `it.effect` inside that describe. The shared SQLite `:memory:` DB
// makes sequential-but-independent specs fragile when they all hit
// `plan_runner_feature_runs` — a transaction failure in one spec leaves
// constraint state that surprises the next. Each spec below opens its own
// describe so it gets a fresh database and stays isolated.
const layer = it.layer(PlanRunnerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

// ─── Persistence + replacement ──────────────────────────────────────────────

layer("PlanRunnerRepository — inserts a first run snapshot", (it) => {
  it.effect("reconstructs the snapshot through getRunById", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-1",
        projectId: "project-1",
        featureName: "feature-1",
      });
      const step = makeStepRow({
        runId: run.runId,
        startedAt: ts("2026-04-01T00:00:01.000Z"),
        executionOrder: nn(2),
        state: "running",
      });
      const thread = makeThreadRow({
        runId: run.runId,
        threadId: ThreadId.makeUnsafe("thread-1"),
      });

      yield* repo.insertRunSnapshot({
        run,
        steps: [step],
        internalThreads: [thread],
      });

      const fetched = yield* repo.getRunById({ runId: run.runId });
      assert.equal(fetched._tag, "Some");
      if (fetched._tag === "Some") {
        assert.equal(fetched.value.runId, run.runId);
        assert.equal(fetched.value.featureName, run.featureName);
        assert.equal(fetched.value.plans.length, 1);
        assert.equal(fetched.value.plans[0]?.planId, "p1");
        assert.equal(fetched.value.steps.length, 1);
        assert.equal(fetched.value.steps[0]?.threadRefs.length, 1);
        assert.equal(fetched.value.steps[0]?.threadRefs[0]?.role, "executor");
      }
    }),
  );
});

layer("PlanRunnerRepository — replaceFeatureRun deletes prior + cascades", (it) => {
  it.effect("clears the old run + steps + threads + synthetic entries", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;

      const oldRun = makeRunRow({
        runId: "run-old",
        projectId: "project-replace",
        featureName: "feature-replace",
      });
      const oldStep = makeStepRow({ runId: oldRun.runId });
      const oldThread = makeThreadRow({
        runId: oldRun.runId,
        threadId: ThreadId.makeUnsafe("thread-old"),
      });
      yield* repo.insertRunSnapshot({
        run: oldRun,
        steps: [oldStep],
        internalThreads: [oldThread],
      });
      yield* repo.appendSyntheticLogEntry({
        runId: oldRun.runId,
        stepKey: oldStep.stepKey,
        entry: {
          kind: "runner.status" satisfies PlanRunnerLogEntryKind,
          title: "old",
          bodyMarkdown: null,
          bodyText: null,
          copyText: null,
          payload: null,
          createdAt: ts("2026-04-01T00:00:02.000Z"),
        },
      });

      const newRun = makeRunRow({
        runId: "run-new",
        projectId: "project-replace",
        featureName: "feature-replace",
        startedAt: "2026-04-02T00:00:00.000Z",
        lastUpdatedAt: "2026-04-02T00:00:00.000Z",
      });
      const newStep = makeStepRow({
        runId: newRun.runId,
        stepKey: tn("plan:p2"),
        planId: "p2",
      });

      const result = yield* repo.replaceFeatureRun({
        projectId: oldRun.projectId,
        featureName: oldRun.featureName,
        run: newRun,
        steps: [newStep],
        internalThreads: [],
      });
      assert.equal(result.deletedRunId, oldRun.runId);

      const oldFetched = yield* repo.getRunById({ runId: oldRun.runId });
      assert.equal(oldFetched._tag, "None");

      const oldThreadRefs = yield* repo.listInternalThreadRefs({ runId: oldRun.runId });
      assert.equal(oldThreadRefs.length, 0);
      const oldEntries = yield* repo.listSyntheticLogEntries({
        runId: oldRun.runId,
        stepKey: oldStep.stepKey,
      });
      assert.equal(oldEntries.length, 0);

      const newFetched = yield* repo.getRunById({ runId: newRun.runId });
      assert.equal(newFetched._tag, "Some");
      if (newFetched._tag === "Some") {
        assert.equal(newFetched.value.plans[0]?.planId, "p2");
      }
    }),
  );
});

layer("PlanRunnerRepository — replaceFeatureRun also clears stale oldRunId", (it) => {
  it.effect("removes a hinted phantom run row regardless of feature lookup", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;

      // Phantom run lives at a different (project, feature) pair.
      const phantomRun = makeRunRow({
        runId: "run-phantom",
        projectId: "project-other",
        featureName: "phantom-feature",
      });
      yield* repo.insertRunSnapshot({
        run: phantomRun,
        steps: [makeStepRow({ runId: phantomRun.runId })],
        internalThreads: [],
      });

      const newRun = makeRunRow({
        runId: "run-fresh",
        projectId: "project-fresh",
        featureName: "fresh-feature",
        startedAt: "2026-04-02T00:00:00.000Z",
        lastUpdatedAt: "2026-04-02T00:00:00.000Z",
      });
      yield* repo.replaceFeatureRun({
        projectId: newRun.projectId,
        featureName: newRun.featureName,
        run: newRun,
        steps: [makeStepRow({ runId: newRun.runId })],
        internalThreads: [],
        oldRunId: phantomRun.runId,
      });

      const phantom = yield* repo.getRunById({ runId: phantomRun.runId });
      assert.equal(phantom._tag, "None");
    }),
  );
});

layer("PlanRunnerRepository — insertRunSnapshot fails on duplicate (project, feature)", (it) => {
  it.effect("rejects re-insert without replaceFeatureRun", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-1",
        projectId: "project-dup",
        featureName: "feature-dup",
      });
      yield* repo.insertRunSnapshot({
        run,
        steps: [makeStepRow({ runId: run.runId })],
        internalThreads: [],
      });

      const exit = yield* Effect.exit(
        repo.insertRunSnapshot({
          run: makeRunRow({
            runId: "run-2",
            projectId: "project-dup",
            featureName: "feature-dup",
          }),
          steps: [
            makeStepRow({
              runId: PlanRunId.makeUnsafe("run-2"),
            }),
          ],
          internalThreads: [],
        }),
      );
      assert.equal(exit._tag, "Failure");
    }),
  );
});

// ─── Recovery + summaries ───────────────────────────────────────────────────

layer("PlanRunnerRepository — listRecoverableRuns", (it) => {
  it.effect("returns only non-terminal runs", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const projectId = "project-r";
      const active = makeRunRow({
        runId: "r-active",
        projectId,
        featureName: "active",
        state: "executing",
      });
      const recovering = makeRunRow({
        runId: "r-recover",
        projectId,
        featureName: "recover",
        state: "recovering",
      });
      const completed = makeRunRow({
        runId: "r-done",
        projectId,
        featureName: "done",
        state: "completed",
        completedAt: "2026-04-01T01:00:00.000Z",
      });
      const failed = makeRunRow({
        runId: "r-failed",
        projectId,
        featureName: "failed",
        state: "failed",
        completedAt: "2026-04-01T01:00:00.000Z",
      });
      for (const run of [active, recovering, completed, failed]) {
        yield* repo.insertRunSnapshot({
          run,
          steps: [makeStepRow({ runId: run.runId })],
          internalThreads: [],
        });
      }

      const recoverable = yield* repo.listRecoverableRuns();
      const ids = recoverable.map((r) => r.runId).toSorted();
      assert.deepEqual(ids, [active.runId, recovering.runId].toSorted());
    }),
  );
});

layer("PlanRunnerRepository — listFeatureSummaries", (it) => {
  it.effect("marks active vs terminal runs correctly", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const projectId = ProjectId.makeUnsafe("project-summary");

      yield* repo.insertRunSnapshot({
        run: makeRunRow({
          runId: "run-a",
          projectId,
          featureName: "alpha",
          state: "executing",
        }),
        steps: [makeStepRow({ runId: PlanRunId.makeUnsafe("run-a") })],
        internalThreads: [],
      });
      yield* repo.insertRunSnapshot({
        run: makeRunRow({
          runId: "run-b",
          projectId,
          featureName: "bravo",
          state: "completed",
          completedAt: "2026-04-01T01:00:00.000Z",
        }),
        steps: [makeStepRow({ runId: PlanRunId.makeUnsafe("run-b") })],
        internalThreads: [],
      });

      const summaries = yield* repo.listFeatureSummaries({ projectId });
      assert.equal(summaries.length, 2);
      const byName = new Map(summaries.map((s) => [s.featureName, s]));
      assert.equal(byName.get(tn("alpha"))?.hasActiveRun, true);
      assert.equal(byName.get(tn("alpha"))?.activeRunId, PlanRunId.makeUnsafe("run-a"));
      assert.equal(byName.get(tn("bravo"))?.hasActiveRun, false);
      assert.equal(byName.get(tn("bravo"))?.activeRunId, null);
      assert.equal(byName.get(tn("bravo"))?.lastRunState, "completed");
    }),
  );
});

layer("PlanRunnerRepository — getFeatureRun returns None for unknown feature", (it) => {
  it.effect("yields Option.none when no row matches", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const result = yield* repo.getFeatureRun({
        projectId: ProjectId.makeUnsafe("project-x"),
        featureName: tn("nonexistent"),
      });
      assert.equal(Option.isNone(result), true);
    }),
  );
});

// ─── Synthetic log + step state ─────────────────────────────────────────────

layer("PlanRunnerRepository — appendSyntheticLogEntry sequences", (it) => {
  it.effect("assigns a monotonic sequence per (run, step)", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-log",
        projectId: "project-log",
        featureName: "feature-log",
      });
      const step = makeStepRow({
        runId: run.runId,
        stepKey: tn("analyzer"),
        stepKind: "analyzer",
      });
      yield* repo.insertRunSnapshot({ run, steps: [step], internalThreads: [] });

      const append = (i: number) =>
        repo.appendSyntheticLogEntry({
          runId: run.runId,
          stepKey: step.stepKey,
          entry: {
            kind: "runner.status",
            title: `entry-${i}`,
            bodyMarkdown: null,
            bodyText: null,
            copyText: null,
            payload: { i },
            createdAt: ts(`2026-04-01T00:00:0${i}.000Z`),
          },
        });

      yield* append(1);
      yield* append(2);
      yield* append(3);

      const entries = yield* repo.listSyntheticLogEntries({
        runId: run.runId,
        stepKey: step.stepKey,
      });
      assert.deepEqual(
        entries.map((e) => e.sequence),
        [nn(0), nn(1), nn(2)],
      );
      assert.deepEqual(
        entries.map((e) => e.title),
        ["entry-1", "entry-2", "entry-3"],
      );
    }),
  );
});

layer("PlanRunnerRepository — synthetic entries are scoped per step", (it) => {
  it.effect("each (run, step) pair gets an independent counter", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-scope",
        projectId: "project-scope",
        featureName: "feature-scope",
      });
      const stepA = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:a"),
        planId: "a",
      });
      const stepB = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:b"),
        planId: "b",
      });
      yield* repo.insertRunSnapshot({
        run,
        steps: [stepA, stepB],
        internalThreads: [],
      });

      yield* repo.appendSyntheticLogEntry({
        runId: run.runId,
        stepKey: stepA.stepKey,
        entry: {
          kind: "runner.status",
          title: "a",
          bodyMarkdown: null,
          bodyText: null,
          copyText: null,
          payload: null,
          createdAt: ts("2026-04-01T00:00:01.000Z"),
        },
      });
      yield* repo.appendSyntheticLogEntry({
        runId: run.runId,
        stepKey: stepB.stepKey,
        entry: {
          kind: "runner.status",
          title: "b",
          bodyMarkdown: null,
          bodyText: null,
          copyText: null,
          payload: null,
          createdAt: ts("2026-04-01T00:00:01.500Z"),
        },
      });

      const aEntries = yield* repo.listSyntheticLogEntries({
        runId: run.runId,
        stepKey: stepA.stepKey,
      });
      const bEntries = yield* repo.listSyntheticLogEntries({
        runId: run.runId,
        stepKey: stepB.stepKey,
      });
      assert.equal(aEntries.length, 1);
      assert.equal(bEntries.length, 1);
      assert.equal(aEntries[0]?.sequence, nn(0));
      assert.equal(bEntries[0]?.sequence, nn(0));
    }),
  );
});

layer("PlanRunnerRepository — registerInternalThread is idempotent", (it) => {
  it.effect("re-registering the same threadId is a no-op", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-th",
        projectId: "project-th",
        featureName: "feature-th",
      });
      const step = makeStepRow({ runId: run.runId });
      yield* repo.insertRunSnapshot({ run, steps: [step], internalThreads: [] });

      const tid = ThreadId.makeUnsafe("th-idem");
      yield* repo.registerInternalThread({
        runId: run.runId,
        stepKey: step.stepKey,
        threadId: tid,
        threadRole: "executor",
        createdAt: ts("2026-04-01T00:00:01.000Z"),
      });
      yield* repo.registerInternalThread({
        runId: run.runId,
        stepKey: step.stepKey,
        threadId: tid,
        threadRole: "executor",
        createdAt: ts("2026-04-01T00:00:02.000Z"),
      });
      const refs = yield* repo.listInternalThreadRefs({ runId: run.runId });
      assert.equal(refs.length, 1);
    }),
  );
});

layer("PlanRunnerRepository — snapshot reconstruction preserves execution_order", (it) => {
  it.effect("steps come back ordered, plans-list filters to plan-kind only", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-order",
        projectId: "project-order",
        featureName: "feature-order",
      });
      const analyzer = makeStepRow({
        runId: run.runId,
        stepKey: tn("analyzer"),
        stepKind: "analyzer",
        planId: null,
        filename: null,
        planMarkdown: null,
        executionOrder: nn(0),
        startedAt: ts("2026-04-01T00:00:01.000Z"),
        state: "done",
      });
      const integration = makeStepRow({
        runId: run.runId,
        stepKey: tn("integration"),
        stepKind: "integration",
        planId: null,
        filename: null,
        planMarkdown: null,
        executionOrder: nn(1),
        startedAt: ts("2026-04-01T00:00:09.000Z"),
        state: "ready",
      });
      const planA = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:a"),
        planId: "a",
        executionOrder: nn(2),
        startedAt: ts("2026-04-01T00:00:02.000Z"),
        state: "running",
      });
      const planB = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:b"),
        planId: "b",
        executionOrder: nn(3),
        startedAt: ts("2026-04-01T00:00:03.000Z"),
        state: "running",
      });
      yield* repo.insertRunSnapshot({
        run,
        steps: [planB, integration, planA, analyzer],
        internalThreads: [],
      });

      const snapshot = yield* repo.getRunById({ runId: run.runId });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(
          snapshot.value.steps.map((s) => s.stepKey),
          [tn("analyzer"), tn("integration"), tn("plan:a"), tn("plan:b")],
        );
        assert.deepEqual(
          snapshot.value.plans.map((p) => p.planId),
          ["a", "b"],
        );
      }
    }),
  );
});

layer("PlanRunnerRepository — startedAt = null excludes step from history", (it) => {
  it.effect("plans-list still includes the blocked step", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-h",
        projectId: "project-h",
        featureName: "feature-h",
      });
      const blocked = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:blocked"),
        planId: "blocked",
        startedAt: null,
        state: "blocked",
      });
      const started = makeStepRow({
        runId: run.runId,
        stepKey: tn("plan:started"),
        planId: "started",
        startedAt: ts("2026-04-01T00:00:01.000Z"),
        state: "running",
      });
      yield* repo.insertRunSnapshot({
        run,
        steps: [blocked, started],
        internalThreads: [],
      });

      const snapshot = yield* repo.getRunById({ runId: run.runId });
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.plans.length, 2);
        assert.equal(snapshot.value.steps.length, 1);
        assert.equal(snapshot.value.steps[0]?.planId, "started");
      }
    }),
  );
});

layer("PlanRunnerRepository — deleteRun cascades to children", (it) => {
  it.effect("steps, threads, and synthetic entries vanish", () =>
    Effect.gen(function* () {
      const repo = yield* PlanRunnerRepository;
      const run = makeRunRow({
        runId: "run-c",
        projectId: "project-c",
        featureName: "feature-c",
      });
      const step = makeStepRow({ runId: run.runId });
      yield* repo.insertRunSnapshot({
        run,
        steps: [step],
        internalThreads: [
          makeThreadRow({
            runId: run.runId,
            threadId: ThreadId.makeUnsafe("th-c"),
            stepKey: step.stepKey,
          }),
        ],
      });
      yield* repo.appendSyntheticLogEntry({
        runId: run.runId,
        stepKey: step.stepKey,
        entry: {
          kind: "runner.status",
          title: "x",
          bodyMarkdown: null,
          bodyText: null,
          copyText: null,
          payload: null,
          createdAt: ts("2026-04-01T00:00:01.000Z"),
        },
      });

      yield* repo.deleteRun({ runId: run.runId });

      const after = yield* repo.getRunById({ runId: run.runId });
      assert.equal(after._tag, "None");
      const refs = yield* repo.listInternalThreadRefs({ runId: run.runId });
      assert.equal(refs.length, 0);
      const entries = yield* repo.listSyntheticLogEntries({
        runId: run.runId,
        stepKey: step.stepKey,
      });
      assert.equal(entries.length, 0);
    }),
  );
});
