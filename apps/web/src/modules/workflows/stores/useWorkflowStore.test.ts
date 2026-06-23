import {
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type WorkflowDraft,
  WorkflowInputRequestId,
  WorkflowId,
  WorkflowRunId,
  type WorkflowRunSnapshot,
} from "@fenrir/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowStoreTestMocks = vi.hoisted(() => ({
  localApi: {
    persistence: {},
  },
  openInConfiguredEmbeddedEditor: vi.fn(async () => "neovim"),
  openSource: vi.fn(async () => ({ path: "/tmp/fenrir-workflows/workflow.js" })),
}));

vi.mock("~/editorPreferences", () => ({
  openInConfiguredEmbeddedEditor: workflowStoreTestMocks.openInConfiguredEmbeddedEditor,
}));

vi.mock("~/environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      workflows: {
        openSource: workflowStoreTestMocks.openSource,
      },
    },
  }),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => workflowStoreTestMocks.localApi,
}));

import {
  canAttemptWorkflowRun,
  isRunnableWorkflow,
  selectThreadWorkflowCounts,
  selectThreadWorkflowRuns,
  useWorkflowStore,
  workflowThreadKey,
} from "./useWorkflowStore";

const projectId = ProjectId.make("project-1");
const originThreadId = ThreadId.make("thread-1");
const otherThreadId = ThreadId.make("thread-2");
const tn = TrimmedNonEmptyString.make;

function makeWorkflow(
  input: {
    readonly workflowId?: string | undefined;
    readonly originThreadId?: ThreadId | undefined;
    readonly status?: WorkflowDraft["status"] | undefined;
    readonly validationStatus?: WorkflowDraft["validationStatus"] | undefined;
    readonly archivedAt?: string | null | undefined;
  } = {},
): WorkflowDraft {
  const now = "2026-06-22T12:00:00.000Z";
  return {
    workflowId: WorkflowId.make(input.workflowId ?? "workflow-1"),
    projectId,
    originThreadId: input.originThreadId ?? originThreadId,
    name: tn("Workflow"),
    description: null,
    source: "export default async function run() {}",
    sourceHash: tn("source-hash"),
    status: input.status ?? "validated",
    validationStatus: input.validationStatus ?? "valid",
    validationError: null,
    createdAt: now as any,
    updatedAt: now as any,
    archivedAt: (input.archivedAt ?? null) as any,
  };
}

function makeRun(input: {
  readonly runId: string;
  readonly originThreadId?: ThreadId | undefined;
  readonly startedAt?: string | undefined;
  readonly status?: WorkflowRunSnapshot["status"] | undefined;
}): WorkflowRunSnapshot {
  const startedAt = input.startedAt ?? "2026-06-22T12:00:00.000Z";
  const status = input.status ?? "completed";
  return {
    runId: WorkflowRunId.make(input.runId),
    workflowId: WorkflowId.make("workflow-1"),
    projectId,
    originThreadId: input.originThreadId ?? originThreadId,
    name: "Workflow",
    args: null,
    sourceHash: "source-hash" as any,
    status,
    summary: null,
    startedAt: startedAt as any,
    completedAt: status === "completed" ? (startedAt as any) : null,
    lastUpdatedAt: startedAt as any,
    steps: [],
    agents: [],
    tasks: [],
    inputRequests: [],
    state: [],
  };
}

function makePendingInputRequest(runId: WorkflowRunId, title: string) {
  const now = "2026-06-22T12:00:00.000Z";
  return {
    requestId: WorkflowInputRequestId.make(`input-${title}`),
    runId,
    title: tn(title),
    body: null,
    fields: [],
    status: "pending" as const,
    response: null,
    createdAt: now as any,
    resolvedAt: null,
  };
}

describe("useWorkflowStore", () => {
  beforeEach(() => {
    workflowStoreTestMocks.openInConfiguredEmbeddedEditor.mockClear();
    workflowStoreTestMocks.openSource.mockClear();
    workflowStoreTestMocks.openSource.mockResolvedValue({
      path: "/tmp/fenrir-workflows/workflow.js",
    });
    useWorkflowStore.setState({
      summariesByThreadKey: {},
      runById: {},
      eventsByRunId: {},
      fetchingThreadKeys: new Set(),
    });
  });

  it("replaces runs for a fetched thread snapshot without removing other threads", () => {
    const staleRun = makeRun({ runId: "run-stale" });
    const otherThreadRun = makeRun({
      runId: "run-other-thread",
      originThreadId: otherThreadId,
    });
    const freshRun = makeRun({
      runId: "run-fresh",
      startedAt: "2026-06-22T12:01:00.000Z",
    });

    useWorkflowStore.setState({
      runById: {
        [staleRun.runId]: staleRun,
        [otherThreadRun.runId]: otherThreadRun,
      },
    });

    useWorkflowStore.getState().setThreadSnapshot(projectId, originThreadId, [], [freshRun]);

    const state = useWorkflowStore.getState();
    expect(selectThreadWorkflowRuns(state, projectId, originThreadId)).toEqual([freshRun]);
    expect(selectThreadWorkflowRuns(state, projectId, otherThreadId)).toEqual([otherThreadRun]);
  });

  it("counts only persisted validated workflows as runnable", () => {
    const workflow = {
      ...makeWorkflow({
        workflowId: "workflow-pending",
        status: "draft",
        validationStatus: "valid",
      }),
      name: tn("Pending but syntactically valid"),
    };

    useWorkflowStore.setState({
      summariesByThreadKey: {
        [workflowThreadKey(projectId, originThreadId)]: [
          {
            workflow,
            latestRun: null,
            activeRunCount: 0 as any,
            pendingInputCount: 0 as any,
          },
        ],
      },
    });

    expect(isRunnableWorkflow(workflow)).toBe(false);
    expect(
      selectThreadWorkflowCounts(useWorkflowStore.getState(), projectId, originThreadId)
        .runnableWorkflowCount,
    ).toBe(0);
  });

  it("allows pending workflows to attempt validate-then-run without counting them as runnable", () => {
    const pending = makeWorkflow({
      workflowId: "workflow-pending",
      status: "draft",
      validationStatus: "pending",
    });
    const invalid = makeWorkflow({
      workflowId: "workflow-invalid",
      status: "invalid",
      validationStatus: "invalid",
    });

    useWorkflowStore.setState({
      summariesByThreadKey: {
        [workflowThreadKey(projectId, originThreadId)]: [
          {
            workflow: pending,
            latestRun: null,
            activeRunCount: 0 as any,
            pendingInputCount: 0 as any,
          },
          {
            workflow: invalid,
            latestRun: null,
            activeRunCount: 0 as any,
            pendingInputCount: 0 as any,
          },
        ],
      },
    });

    expect(isRunnableWorkflow(pending)).toBe(false);
    expect(canAttemptWorkflowRun(pending)).toBe(true);
    expect(canAttemptWorkflowRun(invalid)).toBe(false);
    expect(
      selectThreadWorkflowCounts(useWorkflowStore.getState(), projectId, originThreadId)
        .runnableWorkflowCount,
    ).toBe(0);
  });

  it("counts pending workflow input only for active runs", () => {
    const completedRun = {
      ...makeRun({ runId: "run-completed-with-old-input" }),
      status: "completed" as const,
    };
    const pausedRun = {
      ...makeRun({ runId: "run-paused-with-input" }),
      status: "paused" as const,
      completedAt: null,
    };

    useWorkflowStore.setState({
      runById: {
        [completedRun.runId]: {
          ...completedRun,
          inputRequests: [makePendingInputRequest(completedRun.runId, "completed")],
        },
        [pausedRun.runId]: {
          ...pausedRun,
          inputRequests: [makePendingInputRequest(pausedRun.runId, "paused")],
        },
      },
    });

    expect(
      selectThreadWorkflowCounts(useWorkflowStore.getState(), projectId, originThreadId)
        .pendingInputCount,
    ).toBe(1);
  });

  it("counts running and paused workflow runs as active", () => {
    const completedRun = makeRun({ runId: "run-completed", status: "completed" });
    const runningRun = makeRun({ runId: "run-running", status: "running" });
    const pausedRun = makeRun({ runId: "run-paused", status: "paused" });
    const cancelledRun = makeRun({ runId: "run-cancelled", status: "cancelled" });

    useWorkflowStore.setState({
      runById: {
        [completedRun.runId]: completedRun,
        [runningRun.runId]: runningRun,
        [pausedRun.runId]: pausedRun,
        [cancelledRun.runId]: cancelledRun,
      },
    });

    expect(
      selectThreadWorkflowCounts(useWorkflowStore.getState(), projectId, originThreadId)
        .activeRunCount,
    ).toBe(2);
  });

  it("returns stable derived selector references while workflow state is unchanged", () => {
    const workflow = makeWorkflow();
    const run = makeRun({ runId: "run-stable" });

    useWorkflowStore.setState({
      summariesByThreadKey: {
        [workflowThreadKey(projectId, originThreadId)]: [
          {
            workflow,
            latestRun: run,
            activeRunCount: 0 as any,
            pendingInputCount: 0 as any,
          },
        ],
      },
      runById: {
        [run.runId]: run,
      },
    });

    const state = useWorkflowStore.getState();
    const runs = selectThreadWorkflowRuns(state, projectId, originThreadId);
    const counts = selectThreadWorkflowCounts(state, projectId, originThreadId);

    expect(selectThreadWorkflowRuns(state, projectId, originThreadId)).toBe(runs);
    expect(selectThreadWorkflowCounts(state, projectId, originThreadId)).toBe(counts);
  });

  it("removes archived workflow drafts from thread summaries", () => {
    const workflow = makeWorkflow();
    const archived = makeWorkflow({
      status: "archived",
      archivedAt: "2026-06-22T12:05:00.000Z",
    });

    useWorkflowStore.setState({
      summariesByThreadKey: {
        [workflowThreadKey(projectId, originThreadId)]: [
          {
            workflow,
            latestRun: null,
            activeRunCount: 0 as any,
            pendingInputCount: 0 as any,
          },
        ],
      },
    });

    useWorkflowStore.getState().upsertWorkflow(archived);

    expect(
      selectThreadWorkflowRuns(useWorkflowStore.getState(), projectId, originThreadId),
    ).toEqual([]);
    expect(
      useWorkflowStore.getState().summariesByThreadKey[
        workflowThreadKey(projectId, originThreadId)
      ],
    ).toEqual([]);
    expect(
      selectThreadWorkflowCounts(useWorkflowStore.getState(), projectId, originThreadId).draftCount,
    ).toBe(0);
  });

  it("opens materialized workflow source in the embedded editor tab", async () => {
    const path = await useWorkflowStore
      .getState()
      .openWorkflowSource(WorkflowId.make("workflow-open"));

    expect(path).toBe("/tmp/fenrir-workflows/workflow.js");
    expect(workflowStoreTestMocks.openSource).toHaveBeenCalledWith({
      workflowId: WorkflowId.make("workflow-open"),
    });
    expect(workflowStoreTestMocks.openInConfiguredEmbeddedEditor).toHaveBeenCalledWith(
      workflowStoreTestMocks.localApi,
      "/tmp/fenrir-workflows/workflow.js",
    );
  });
});
