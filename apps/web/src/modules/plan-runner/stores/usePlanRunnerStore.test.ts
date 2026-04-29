import {
  IsoDateTime,
  NonNegativeInt,
  PlanRunId,
  PlanRunnerLogEntryId,
  PlanRunSnapshot,
  PlanState,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type FeatureSummary,
  type PlanRunnerLogEntry,
  type PlanRunnerStepSnapshot,
} from "@fenrir/contracts";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  selectActiveStepTabs,
  selectInternalThreadIds,
  selectRunIdByInternalThreadId,
  selectStartedStepHistory,
  stepLogCacheKey,
  usePlanRunnerStore,
} from "./usePlanRunnerStore";

// ─── Builders ───────────────────────────────────────────────────────────────

const tn = TrimmedNonEmptyString.makeUnsafe;
const ts = IsoDateTime.makeUnsafe;
const nn = NonNegativeInt.makeUnsafe;
const tid = ThreadId.makeUnsafe;
const rid = PlanRunId.makeUnsafe;
const pid = ProjectId.makeUnsafe;

interface MakeSnapshotOpts {
  readonly runId: string;
  readonly projectId?: string;
  readonly featureName?: string;
  readonly state?: PlanRunSnapshot["state"];
  readonly steps?: ReadonlyArray<Partial<PlanRunnerStepSnapshot> & { stepKey: string }>;
}

function makeStep(
  partial: Partial<PlanRunnerStepSnapshot> & { stepKey: string },
): PlanRunnerStepSnapshot {
  return {
    stepKey: tn(partial.stepKey),
    kind: partial.kind ?? "plan",
    planId: partial.planId === undefined ? "p" : partial.planId,
    filename: partial.filename === undefined ? tn("01.md") : partial.filename,
    state: (partial.state ?? "running") as PlanState,
    failureSummary: partial.failureSummary ?? null,
    startedAt: partial.startedAt === undefined ? ts("2026-04-01T00:00:00.000Z") : partial.startedAt,
    completedAt: partial.completedAt ?? null,
    executionOrder: partial.executionOrder ?? nn(0),
    threadRefs: partial.threadRefs ?? [],
  };
}

function makeSnapshot(opts: MakeSnapshotOpts): PlanRunSnapshot {
  return {
    runId: rid(opts.runId),
    featureName: tn(opts.featureName ?? "feat"),
    projectId: pid(opts.projectId ?? "proj"),
    branch: tn("feature/x"),
    worktreePath: null,
    state: opts.state ?? "executing",
    plans: [],
    maxConcurrency: 3,
    analyzerThreadId: null,
    integrationThreadId: null,
    steps: (opts.steps ?? []).map(makeStep),
    startedAt: ts("2026-04-01T00:00:00.000Z"),
    completedAt: null,
    lastUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
    summary: null,
  };
}

function makeLogEntry(partial: {
  runId: string;
  stepKey: string;
  entryId: string;
  sequence: number;
  createdAt?: string;
}): PlanRunnerLogEntry {
  return {
    entryId: PlanRunnerLogEntryId.makeUnsafe(partial.entryId),
    runId: rid(partial.runId),
    stepKey: tn(partial.stepKey),
    kind: "runner.status",
    sequence: nn(partial.sequence),
    createdAt: ts(partial.createdAt ?? "2026-04-01T00:00:00.000Z"),
    threadId: null,
    threadRole: null,
    title: tn("title"),
    bodyMarkdown: null,
    bodyText: null,
    copyText: "x",
    payload: null,
  };
}

function resetStore(): void {
  act(() => {
    usePlanRunnerStore.setState({
      featuresByProjectId: {},
      runById: {},
      plansByFeatureKey: {},
      stepLogsByKey: {},
    });
  });
}

beforeEach(resetStore);

// ─── Hidden-thread selectors ────────────────────────────────────────────────

describe("selectInternalThreadIds / selectRunIdByInternalThreadId", () => {
  it("derives hidden thread ids from every step's threadRefs", () => {
    const snapshot = makeSnapshot({
      runId: "run-1",
      steps: [
        {
          stepKey: "plan:a",
          threadRefs: [
            { threadId: tid("th-exec"), role: "executor" },
            { threadId: tid("th-rev"), role: "reviewer" },
          ],
        },
        {
          stepKey: "analyzer",
          kind: "analyzer",
          planId: null,
          filename: null,
          threadRefs: [{ threadId: tid("th-analyzer"), role: "analyzer" }],
        },
      ],
    });
    const ids = selectInternalThreadIds({ [snapshot.runId]: snapshot });
    expect([...ids].toSorted()).toEqual(
      [tid("th-exec"), tid("th-rev"), tid("th-analyzer")].toSorted(),
    );
  });

  it("returns an empty set when no run has thread refs", () => {
    const snapshot = makeSnapshot({ runId: "run-empty" });
    const ids = selectInternalThreadIds({ [snapshot.runId]: snapshot });
    expect(ids.size).toBe(0);
  });

  it("maps each internal threadId back to its owning runId", () => {
    const a = makeSnapshot({
      runId: "run-a",
      steps: [
        {
          stepKey: "plan:a",
          threadRefs: [{ threadId: tid("th-1"), role: "executor" }],
        },
      ],
    });
    const b = makeSnapshot({
      runId: "run-b",
      steps: [
        {
          stepKey: "plan:b",
          threadRefs: [{ threadId: tid("th-2"), role: "reviewer" }],
        },
      ],
    });
    const map = selectRunIdByInternalThreadId({
      [a.runId]: a,
      [b.runId]: b,
    });
    expect(map.get(tid("th-1"))).toBe(a.runId);
    expect(map.get(tid("th-2"))).toBe(b.runId);
  });

  it("first-encountered run wins when a thread id appears in two runs", () => {
    const a = makeSnapshot({
      runId: "run-a",
      steps: [
        {
          stepKey: "plan:a",
          threadRefs: [{ threadId: tid("dup"), role: "executor" }],
        },
      ],
    });
    const b = makeSnapshot({
      runId: "run-b",
      steps: [
        {
          stepKey: "plan:b",
          threadRefs: [{ threadId: tid("dup"), role: "reviewer" }],
        },
      ],
    });
    // Object.values order matches insertion order in modern JS engines.
    const map = selectRunIdByInternalThreadId({
      [a.runId]: a,
      [b.runId]: b,
    });
    expect(map.get(tid("dup"))).toBe(a.runId);
  });
});

// ─── Active / history selectors ─────────────────────────────────────────────

describe("selectStartedStepHistory / selectActiveStepTabs", () => {
  const snapshot = makeSnapshot({
    runId: "run-history",
    steps: [
      {
        stepKey: "plan:b",
        executionOrder: nn(2),
        startedAt: ts("2026-04-01T00:00:02.000Z"),
        state: "running",
      },
      {
        stepKey: "plan:a",
        executionOrder: nn(1),
        startedAt: ts("2026-04-01T00:00:01.000Z"),
        state: "running",
      },
      {
        stepKey: "plan:never",
        executionOrder: nn(99),
        startedAt: null,
        state: "blocked",
      },
      {
        stepKey: "plan:done",
        executionOrder: nn(0),
        startedAt: ts("2026-04-01T00:00:00.000Z"),
        completedAt: ts("2026-04-01T00:00:05.000Z"),
        state: "done",
      },
    ],
  });

  it("orders started steps by executionOrder and excludes never-started", () => {
    const history = selectStartedStepHistory(snapshot);
    expect(history.map((s) => s.stepKey)).toEqual([tn("plan:done"), tn("plan:a"), tn("plan:b")]);
  });

  it("active tabs only include in-flight (ready/running/reviewing) steps", () => {
    const tabs = selectActiveStepTabs(snapshot);
    expect(tabs.map((s) => s.stepKey)).toEqual([tn("plan:a"), tn("plan:b")]);
  });

  it("returns empty arrays when run is undefined", () => {
    expect(selectStartedStepHistory(undefined)).toEqual([]);
    expect(selectActiveStepTabs(undefined)).toEqual([]);
  });
});

// ─── Reducer + cache rollover ───────────────────────────────────────────────

describe("usePlanRunnerStore reducer", () => {
  it("upsertRun replaces a prior run for the same (project, feature) and prunes its step logs", () => {
    const run1 = makeSnapshot({
      runId: "run-1",
      projectId: "proj",
      featureName: "f",
    });
    const run2 = makeSnapshot({
      runId: "run-2",
      projectId: "proj",
      featureName: "f",
    });
    const entry = makeLogEntry({
      runId: "run-1",
      stepKey: "plan:p",
      entryId: "e1",
      sequence: 0,
    });

    act(() => {
      usePlanRunnerStore.getState().upsertRun(run1);
      usePlanRunnerStore.getState().setStepLog(rid("run-1"), tn("plan:p"), [entry]);
    });

    expect(usePlanRunnerStore.getState().stepLogsByKey[stepLogCacheKey("run-1", "plan:p")]).toEqual(
      [entry],
    );

    act(() => {
      usePlanRunnerStore.getState().upsertRun(run2);
    });

    const state = usePlanRunnerStore.getState();
    expect(state.runById["run-1"]).toBeDefined();
    expect(state.runById["run-2"]).toBeDefined();
    // Stale per-step cache for the previous run is pruned.
    expect(state.stepLogsByKey[stepLogCacheKey("run-1", "plan:p")]).toBeUndefined();
  });

  it("removeRun drops the run + its step-log cache entries", () => {
    const snap = makeSnapshot({ runId: "run-1" });
    const entry = makeLogEntry({
      runId: "run-1",
      stepKey: "plan:p",
      entryId: "e1",
      sequence: 0,
    });
    act(() => {
      usePlanRunnerStore.getState().upsertRun(snap);
      usePlanRunnerStore.getState().setStepLog(rid("run-1"), tn("plan:p"), [entry]);
    });

    act(() => {
      usePlanRunnerStore.getState().removeRun("run-1");
    });

    const state = usePlanRunnerStore.getState();
    expect(state.runById["run-1"]).toBeUndefined();
    expect(state.stepLogsByKey[stepLogCacheKey("run-1", "plan:p")]).toBeUndefined();
  });

  it("planRunner.stepLogAppended dedupes by entryId and orders by sequence", () => {
    act(() => {
      usePlanRunnerStore.getState().applyEvent({
        type: "planRunner.stepLogAppended",
        runId: rid("run-1"),
        stepKey: tn("plan:p"),
        entry: makeLogEntry({
          runId: "run-1",
          stepKey: "plan:p",
          entryId: "e2",
          sequence: 2,
        }),
      });
      usePlanRunnerStore.getState().applyEvent({
        type: "planRunner.stepLogAppended",
        runId: rid("run-1"),
        stepKey: tn("plan:p"),
        entry: makeLogEntry({
          runId: "run-1",
          stepKey: "plan:p",
          entryId: "e1",
          sequence: 1,
        }),
      });
      // Duplicate of e2 — must not be added twice.
      usePlanRunnerStore.getState().applyEvent({
        type: "planRunner.stepLogAppended",
        runId: rid("run-1"),
        stepKey: tn("plan:p"),
        entry: makeLogEntry({
          runId: "run-1",
          stepKey: "plan:p",
          entryId: "e2",
          sequence: 2,
        }),
      });
    });
    const cache = usePlanRunnerStore.getState().stepLogsByKey[stepLogCacheKey("run-1", "plan:p")];
    expect(cache?.map((e) => e.entryId)).toEqual([
      PlanRunnerLogEntryId.makeUnsafe("e1"),
      PlanRunnerLogEntryId.makeUnsafe("e2"),
    ]);
  });

  it("planRunner.completed flips the feature summary to inactive", () => {
    const projectId = "proj";
    const featureName = "f";
    const features: ReadonlyArray<FeatureSummary> = [
      {
        featureName: tn(featureName),
        planCount: 1,
        hasActiveRun: true,
        activeRunId: rid("run-1"),
        lastRunId: rid("run-1"),
        lastRunState: "executing",
        lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
      },
    ];
    const snap = makeSnapshot({ runId: "run-1", projectId, featureName });
    act(() => {
      usePlanRunnerStore.getState().setFeatures(projectId, features);
      usePlanRunnerStore.getState().upsertRun(snap);
    });

    act(() => {
      usePlanRunnerStore.getState().applyEvent({
        type: "planRunner.completed",
        runId: rid("run-1"),
        state: "completed",
        summary: "ok",
        completedAt: ts("2026-04-01T00:01:00.000Z"),
      });
    });

    const state = usePlanRunnerStore.getState();
    expect(state.runById["run-1"]?.state).toBe("completed");
    const feat = state.featuresByProjectId[projectId]?.[0];
    expect(feat?.hasActiveRun).toBe(false);
    expect(feat?.activeRunId).toBeNull();
    expect(feat?.lastRunState).toBe("completed");
  });

  it("planRunner.featuresChanged rewrites the project feature list and invalidates plan cache", () => {
    const projectId = "proj";
    act(() => {
      usePlanRunnerStore.getState().setFeatures(projectId, []);
      usePlanRunnerStore.getState().setPlans(`${projectId}:f`, []);
    });

    act(() => {
      usePlanRunnerStore.getState().applyEvent({
        type: "planRunner.featuresChanged",
        projectId: pid(projectId),
        features: [
          {
            featureName: tn("g"),
            planCount: 2,
            hasActiveRun: false,
            activeRunId: null,
            lastRunId: null,
            lastRunState: null,
            lastRunUpdatedAt: null,
          },
        ],
      });
    });

    const state = usePlanRunnerStore.getState();
    expect(state.featuresByProjectId[projectId]?.length).toBe(1);
    expect(state.plansByFeatureKey[`${projectId}:f`]).toBeUndefined();
  });
});
