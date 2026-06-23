import { useMemo } from "react";
import { create } from "zustand";
import type {
  ProjectId,
  ThreadId,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowEventStreamItem,
  WorkflowId,
  WorkflowInputRequestId,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowThreadSummary,
} from "@fenrir/contracts";

import { openInConfiguredEmbeddedEditor } from "~/editorPreferences";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { ensureLocalApi } from "~/localApi";

const EMPTY_WORKFLOW_SUMMARIES: readonly WorkflowThreadSummary[] = [];
const EMPTY_WORKFLOW_RUNS: readonly WorkflowRunSnapshot[] = [];
const EMPTY_WORKFLOW_EVENTS: readonly WorkflowEvent[] = [];
const EMPTY_WORKFLOW_COUNTS: WorkflowThreadCounts = {
  hasWorkflows: false,
  draftCount: 0,
  activeRunCount: 0,
  pendingInputCount: 0,
  runnableWorkflowCount: 0,
};

const ACTIVE_RUN_STATUSES = new Set<WorkflowRunStatus>(["running", "paused"]);

const threadRunsCache = new WeakMap<
  Record<string, WorkflowRunSnapshot>,
  Map<string, readonly WorkflowRunSnapshot[]>
>();
const threadCountsCache = new WeakMap<
  Record<string, readonly WorkflowThreadSummary[]>,
  WeakMap<Record<string, WorkflowRunSnapshot>, Map<string, WorkflowThreadCounts>>
>();

export interface WorkflowThreadCounts {
  readonly hasWorkflows: boolean;
  readonly draftCount: number;
  readonly activeRunCount: number;
  readonly pendingInputCount: number;
  readonly runnableWorkflowCount: number;
}

export interface WorkflowInternalThreadOwner {
  readonly runId: WorkflowRunId;
  readonly parentThreadId: ThreadId;
}

interface WorkflowState {
  readonly summariesByThreadKey: Record<string, readonly WorkflowThreadSummary[]>;
  readonly runById: Record<string, WorkflowRunSnapshot>;
  readonly eventsByRunId: Record<string, readonly WorkflowEvent[]>;
  readonly fetchingThreadKeys: ReadonlySet<string>;

  readonly setThreadSnapshot: (
    projectId: ProjectId,
    originThreadId: ThreadId,
    workflows: readonly WorkflowThreadSummary[],
    runs: readonly WorkflowRunSnapshot[],
  ) => void;
  readonly upsertWorkflow: (workflow: WorkflowDraft) => void;
  readonly upsertRun: (run: WorkflowRunSnapshot) => void;
  readonly appendEvent: (event: WorkflowEvent) => void;
  readonly applyEvent: (event: WorkflowEventStreamItem) => void;
  readonly fetchThread: (projectId: ProjectId, originThreadId: ThreadId) => Promise<void>;
  readonly fetchTimeline: (runId: WorkflowRunId) => Promise<void>;
  readonly runWorkflow: (
    projectId: ProjectId,
    originThreadId: ThreadId,
    workflowId?: WorkflowId,
    args?: unknown,
  ) => Promise<WorkflowRunSnapshot>;
  readonly stopRun: (runId: WorkflowRunId) => Promise<void>;
  readonly validateWorkflow: (workflowId: WorkflowId) => Promise<WorkflowDraft>;
  readonly archiveWorkflow: (workflowId: WorkflowId) => Promise<WorkflowDraft>;
  readonly openWorkflowSource: (workflowId: WorkflowId) => Promise<string>;
  readonly respondToInput: (
    runId: WorkflowRunId,
    requestId: WorkflowInputRequestId,
    response: unknown,
  ) => Promise<void>;
}

export function workflowThreadKey(projectId: ProjectId, originThreadId: ThreadId): string {
  return `${projectId}:${originThreadId}`;
}

function isActiveRun(run: WorkflowRunSnapshot): boolean {
  return ACTIVE_RUN_STATUSES.has(run.status);
}

export function isRunnableWorkflow(workflow: WorkflowDraft): boolean {
  return workflow.status === "validated" && workflow.validationStatus === "valid";
}

export function canAttemptWorkflowRun(workflow: WorkflowDraft): boolean {
  return (
    workflow.status !== "archived" &&
    (isRunnableWorkflow(workflow) || workflow.validationStatus === "pending")
  );
}

function sortRunsNewestFirst(runs: readonly WorkflowRunSnapshot[]): readonly WorkflowRunSnapshot[] {
  return runs.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function runPendingInputCount(run: WorkflowRunSnapshot): number {
  if (!isActiveRun(run)) {
    return 0;
  }
  return run.inputRequests.filter((request) => request.status === "pending").length;
}

function getThreadRunsCache(
  runById: Record<string, WorkflowRunSnapshot>,
): Map<string, readonly WorkflowRunSnapshot[]> {
  const cached = threadRunsCache.get(runById);
  if (cached) {
    return cached;
  }

  const next = new Map<string, readonly WorkflowRunSnapshot[]>();
  threadRunsCache.set(runById, next);
  return next;
}

function getThreadCountsCache(
  summariesByThreadKey: Record<string, readonly WorkflowThreadSummary[]>,
  runById: Record<string, WorkflowRunSnapshot>,
): Map<string, WorkflowThreadCounts> {
  let runCache = threadCountsCache.get(summariesByThreadKey);
  if (!runCache) {
    runCache = new WeakMap<
      Record<string, WorkflowRunSnapshot>,
      Map<string, WorkflowThreadCounts>
    >();
    threadCountsCache.set(summariesByThreadKey, runCache);
  }

  const cached = runCache.get(runById);
  if (cached) {
    return cached;
  }

  const next = new Map<string, WorkflowThreadCounts>();
  runCache.set(runById, next);
  return next;
}

function latestRunForWorkflow(
  runById: Record<string, WorkflowRunSnapshot>,
  workflowId: WorkflowId,
): WorkflowRunSnapshot | null {
  const runs = Object.values(runById).filter((run) => run.workflowId === workflowId);
  return sortRunsNewestFirst(runs)[0] ?? null;
}

function countsForWorkflow(
  runById: Record<string, WorkflowRunSnapshot>,
  workflowId: WorkflowId,
): Pick<WorkflowThreadSummary, "activeRunCount" | "pendingInputCount"> {
  const runs = Object.values(runById).filter((run) => run.workflowId === workflowId);
  return {
    activeRunCount: runs.filter(isActiveRun).length as WorkflowThreadSummary["activeRunCount"],
    pendingInputCount: runs.reduce(
      (count, run) => count + runPendingInputCount(run),
      0,
    ) as WorkflowThreadSummary["pendingInputCount"],
  };
}

function mergeWorkflowIntoSummaries(
  summariesByThreadKey: Record<string, readonly WorkflowThreadSummary[]>,
  runById: Record<string, WorkflowRunSnapshot>,
  workflow: WorkflowDraft,
): Record<string, readonly WorkflowThreadSummary[]> {
  const key = workflowThreadKey(workflow.projectId, workflow.originThreadId);
  const summaries = summariesByThreadKey[key] ?? EMPTY_WORKFLOW_SUMMARIES;
  const latestRun = latestRunForWorkflow(runById, workflow.workflowId);
  const counts = countsForWorkflow(runById, workflow.workflowId);
  const existing = summaries.find((summary) => summary.workflow.workflowId === workflow.workflowId);
  const nextSummary: WorkflowThreadSummary = {
    workflow,
    latestRun: latestRun ?? existing?.latestRun ?? null,
    ...counts,
  };
  const nextSummaries = existing
    ? summaries.map((summary) =>
        summary.workflow.workflowId === workflow.workflowId ? nextSummary : summary,
      )
    : [nextSummary, ...summaries];
  return {
    ...summariesByThreadKey,
    [key]: nextSummaries.toSorted((a, b) =>
      b.workflow.updatedAt.localeCompare(a.workflow.updatedAt),
    ),
  };
}

function removeWorkflowFromSummaries(
  summariesByThreadKey: Record<string, readonly WorkflowThreadSummary[]>,
  workflow: WorkflowDraft,
): Record<string, readonly WorkflowThreadSummary[]> {
  const key = workflowThreadKey(workflow.projectId, workflow.originThreadId);
  const summaries = summariesByThreadKey[key] ?? EMPTY_WORKFLOW_SUMMARIES;
  return {
    ...summariesByThreadKey,
    [key]: summaries.filter((summary) => summary.workflow.workflowId !== workflow.workflowId),
  };
}

function refreshSummaryForRun(
  summariesByThreadKey: Record<string, readonly WorkflowThreadSummary[]>,
  runById: Record<string, WorkflowRunSnapshot>,
  run: WorkflowRunSnapshot,
): Record<string, readonly WorkflowThreadSummary[]> {
  const key = workflowThreadKey(run.projectId, run.originThreadId);
  const summaries = summariesByThreadKey[key];
  if (!summaries) {
    return summariesByThreadKey;
  }
  const counts = countsForWorkflow(runById, run.workflowId);
  const latestRun = latestRunForWorkflow(runById, run.workflowId);
  const nextSummaries = summaries.map((summary) =>
    summary.workflow.workflowId === run.workflowId
      ? Object.assign({}, summary, { latestRun }, counts)
      : summary,
  );
  return {
    ...summariesByThreadKey,
    [key]: nextSummaries,
  };
}

function appendTimelineEvent(
  events: readonly WorkflowEvent[] | undefined,
  event: WorkflowEvent,
): readonly WorkflowEvent[] {
  const current = events ?? EMPTY_WORKFLOW_EVENTS;
  if (current.some((existing) => existing.eventId === event.eventId)) {
    return current;
  }
  return [...current, event].toSorted((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  summariesByThreadKey: {},
  runById: {},
  eventsByRunId: {},
  fetchingThreadKeys: new Set(),

  setThreadSnapshot: (projectId, originThreadId, workflows, runs) =>
    set((state) => {
      const runById = { ...state.runById };
      for (const [runId, run] of Object.entries(runById)) {
        if (run.projectId === projectId && run.originThreadId === originThreadId) {
          delete runById[runId];
        }
      }
      for (const run of runs) {
        runById[run.runId] = run;
      }
      return {
        runById,
        summariesByThreadKey: {
          ...state.summariesByThreadKey,
          [workflowThreadKey(projectId, originThreadId)]: workflows,
        },
      };
    }),

  upsertWorkflow: (workflow) =>
    set((state) => ({
      summariesByThreadKey:
        workflow.status === "archived" || workflow.archivedAt !== null
          ? removeWorkflowFromSummaries(state.summariesByThreadKey, workflow)
          : mergeWorkflowIntoSummaries(state.summariesByThreadKey, state.runById, workflow),
    })),

  upsertRun: (run) =>
    set((state) => {
      const runById = { ...state.runById, [run.runId]: run };
      return {
        runById,
        summariesByThreadKey: refreshSummaryForRun(state.summariesByThreadKey, runById, run),
      };
    }),

  appendEvent: (event) =>
    set((state) => {
      if (!event.runId) {
        return state;
      }
      return {
        eventsByRunId: {
          ...state.eventsByRunId,
          [event.runId]: appendTimelineEvent(state.eventsByRunId[event.runId], event),
        },
      };
    }),

  applyEvent: (event) => {
    switch (event.type) {
      case "workflow.changed":
        get().upsertWorkflow(event.workflow);
        return;
      case "workflow.run.changed":
        get().upsertRun(event.run);
        return;
      case "workflow.event.appended":
        get().appendEvent(event.event);
        return;
    }
  },

  fetchThread: async (projectId, originThreadId) => {
    const key = workflowThreadKey(projectId, originThreadId);
    set((state) => ({
      fetchingThreadKeys: new Set(state.fetchingThreadKeys).add(key),
    }));
    try {
      const client = getPrimaryEnvironmentConnection().client;
      const result = await client.workflows.listThread({ projectId, originThreadId });
      get().setThreadSnapshot(projectId, originThreadId, result.workflows, result.runs);
    } finally {
      set((state) => {
        const next = new Set(state.fetchingThreadKeys);
        next.delete(key);
        return { fetchingThreadKeys: next };
      });
    }
  },

  fetchTimeline: async (runId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.getTimeline({ runId });
    set((state) => ({
      eventsByRunId: {
        ...state.eventsByRunId,
        [runId]: result.events,
      },
    }));
  },

  runWorkflow: async (projectId, originThreadId, workflowId, args) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.run({
      projectId,
      originThreadId,
      ...(workflowId !== undefined ? { workflowId } : {}),
      ...(args !== undefined ? { args } : {}),
    });
    get().upsertRun(result.run);
    return result.run;
  },

  stopRun: async (runId) => {
    const client = getPrimaryEnvironmentConnection().client;
    await client.workflows.stop({ runId });
    const run = await client.workflows.getRun({ runId });
    get().upsertRun(run);
  },

  validateWorkflow: async (workflowId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.validate({ workflowId });
    get().upsertWorkflow(result.workflow);
    return result.workflow;
  },

  archiveWorkflow: async (workflowId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.archive({ workflowId });
    get().upsertWorkflow(result.workflow);
    return result.workflow;
  },

  openWorkflowSource: async (workflowId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.openSource({ workflowId });
    await openInConfiguredEmbeddedEditor(ensureLocalApi(), result.path);
    return result.path;
  },

  respondToInput: async (runId, requestId, response) => {
    const client = getPrimaryEnvironmentConnection().client;
    await client.workflows.respondToInput({ runId, requestId, response });
    const run = await client.workflows.getRun({ runId });
    get().upsertRun(run);
  },
}));

export function selectThreadWorkflowSummaries(
  state: Pick<WorkflowState, "summariesByThreadKey">,
  projectId: ProjectId | null,
  originThreadId: ThreadId | null,
): readonly WorkflowThreadSummary[] {
  if (!projectId || !originThreadId) {
    return EMPTY_WORKFLOW_SUMMARIES;
  }
  return (
    state.summariesByThreadKey[workflowThreadKey(projectId, originThreadId)] ??
    EMPTY_WORKFLOW_SUMMARIES
  );
}

export function selectThreadWorkflowRuns(
  state: Pick<WorkflowState, "runById">,
  projectId: ProjectId | null,
  originThreadId: ThreadId | null,
): readonly WorkflowRunSnapshot[] {
  if (!projectId || !originThreadId) {
    return EMPTY_WORKFLOW_RUNS;
  }
  const key = workflowThreadKey(projectId, originThreadId);
  const cache = getThreadRunsCache(state.runById);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const runs = Object.values(state.runById).filter(
    (run) => run.projectId === projectId && run.originThreadId === originThreadId,
  );
  const sortedRuns = runs.length === 0 ? EMPTY_WORKFLOW_RUNS : sortRunsNewestFirst(runs);
  cache.set(key, sortedRuns);
  return sortedRuns;
}

export function selectThreadWorkflowCounts(
  state: Pick<WorkflowState, "summariesByThreadKey" | "runById">,
  projectId: ProjectId | null,
  originThreadId: ThreadId | null,
): WorkflowThreadCounts {
  if (!projectId || !originThreadId) {
    return EMPTY_WORKFLOW_COUNTS;
  }

  const key = workflowThreadKey(projectId, originThreadId);
  const cache = getThreadCountsCache(state.summariesByThreadKey, state.runById);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const summaries = selectThreadWorkflowSummaries(state, projectId, originThreadId);
  const runs = selectThreadWorkflowRuns(state, projectId, originThreadId);
  const activeRunCount = runs.filter(isActiveRun).length;
  const pendingInputCount = runs.reduce((count, run) => count + runPendingInputCount(run), 0);
  const counts =
    summaries.length === 0 && runs.length === 0
      ? EMPTY_WORKFLOW_COUNTS
      : {
          hasWorkflows: summaries.length > 0 || runs.length > 0,
          draftCount: summaries.length,
          activeRunCount,
          pendingInputCount,
          runnableWorkflowCount: summaries.filter((summary) => isRunnableWorkflow(summary.workflow))
            .length,
        };
  cache.set(key, counts);
  return counts;
}

export function selectInternalWorkflowThreadIds(
  runById: Record<string, WorkflowRunSnapshot>,
): Set<ThreadId> {
  const ids = new Set<ThreadId>();
  for (const run of Object.values(runById)) {
    for (const agent of run.agents) {
      if (agent.threadId !== null) {
        ids.add(agent.threadId);
      }
    }
  }
  return ids;
}

export function selectWorkflowThreadOwners(
  runById: Record<string, WorkflowRunSnapshot>,
): Map<ThreadId, WorkflowInternalThreadOwner> {
  const owners = new Map<ThreadId, WorkflowInternalThreadOwner>();
  for (const run of Object.values(runById)) {
    for (const agent of run.agents) {
      if (agent.threadId !== null && !owners.has(agent.threadId)) {
        owners.set(agent.threadId, {
          runId: run.runId,
          parentThreadId: run.originThreadId,
        });
      }
    }
  }
  return owners;
}

export function useInternalWorkflowThreadIds(): ReadonlySet<ThreadId> {
  const runById = useWorkflowStore((state) => state.runById);
  return useMemo(() => selectInternalWorkflowThreadIds(runById), [runById]);
}

export function useInternalWorkflowThreadOwners(): ReadonlyMap<
  ThreadId,
  WorkflowInternalThreadOwner
> {
  const runById = useWorkflowStore((state) => state.runById);
  return useMemo(() => selectWorkflowThreadOwners(runById), [runById]);
}
