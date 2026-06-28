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
  WorkflowMemoryItem,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowSchedule,
  WorkflowScheduleId,
  WorkflowThreadLink,
  WorkflowThreadSummary,
} from "@fenrir/contracts";

import { openInConfiguredEmbeddedEditor } from "~/editorPreferences";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { ensureLocalApi } from "~/localApi";

const EMPTY_WORKFLOW_SUMMARIES: readonly WorkflowThreadSummary[] = [];
const EMPTY_WORKFLOW_RUNS: readonly WorkflowRunSnapshot[] = [];
const EMPTY_WORKFLOW_EVENTS: readonly WorkflowEvent[] = [];
const EMPTY_WORKFLOW_LINKS: readonly WorkflowThreadLink[] = [];
const EMPTY_WORKFLOW_SCHEDULES: readonly WorkflowSchedule[] = [];
const EMPTY_WORKFLOW_MEMORY: readonly WorkflowMemoryItem[] = [];
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
const projectRunsCache = new WeakMap<
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
  readonly summariesByProjectId: Record<string, readonly WorkflowThreadSummary[]>;
  readonly linksByProjectId: Record<string, readonly WorkflowThreadLink[]>;
  readonly schedulesByProjectId: Record<string, readonly WorkflowSchedule[]>;
  readonly memoryByWorkflowId: Record<string, readonly WorkflowMemoryItem[]>;
  readonly runById: Record<string, WorkflowRunSnapshot>;
  readonly eventsByRunId: Record<string, readonly WorkflowEvent[]>;
  readonly fetchingThreadKeys: ReadonlySet<string>;
  readonly fetchingProjectIds: ReadonlySet<string>;

  readonly setThreadSnapshot: (
    projectId: ProjectId,
    originThreadId: ThreadId,
    workflows: readonly WorkflowThreadSummary[],
    runs: readonly WorkflowRunSnapshot[],
  ) => void;
  readonly setProjectSnapshot: (
    projectId: ProjectId,
    workflows: readonly WorkflowThreadSummary[],
    runs: readonly WorkflowRunSnapshot[],
    links: readonly WorkflowThreadLink[],
    schedules: readonly WorkflowSchedule[],
  ) => void;
  readonly upsertWorkflow: (workflow: WorkflowDraft) => void;
  readonly upsertRun: (run: WorkflowRunSnapshot) => void;
  readonly appendEvent: (event: WorkflowEvent) => void;
  readonly applyEvent: (event: WorkflowEventStreamItem) => void;
  readonly fetchThread: (projectId: ProjectId, originThreadId: ThreadId) => Promise<void>;
  readonly fetchProject: (projectId: ProjectId, includeArchived?: boolean) => Promise<void>;
  readonly fetchTimeline: (runId: WorkflowRunId) => Promise<void>;
  readonly runWorkflow: (
    projectId: ProjectId,
    originThreadId: ThreadId | null,
    workflowId?: WorkflowId,
    args?: unknown,
  ) => Promise<WorkflowRunSnapshot>;
  readonly scheduleWorkflow: (
    workflowId: WorkflowId,
    runAt: string,
    args?: unknown,
  ) => Promise<WorkflowSchedule>;
  readonly cancelScheduledRun: (scheduleId: WorkflowScheduleId) => Promise<WorkflowSchedule>;
  readonly stopRun: (runId: WorkflowRunId) => Promise<void>;
  readonly validateWorkflow: (workflowId: WorkflowId) => Promise<WorkflowDraft>;
  readonly archiveWorkflow: (workflowId: WorkflowId) => Promise<WorkflowDraft>;
  readonly openWorkflowSource: (workflowId: WorkflowId) => Promise<string>;
  readonly fetchMemory: (
    workflowId: WorkflowId,
    includeSuppressed?: boolean,
  ) => Promise<readonly WorkflowMemoryItem[]>;
  readonly suppressMemoryItem: (
    memoryId: WorkflowMemoryItem["memoryId"],
  ) => Promise<WorkflowMemoryItem>;
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

function getProjectRunsCache(
  runById: Record<string, WorkflowRunSnapshot>,
): Map<string, readonly WorkflowRunSnapshot[]> {
  const cached = projectRunsCache.get(runById);
  if (cached) {
    return cached;
  }

  const next = new Map<string, readonly WorkflowRunSnapshot[]>();
  projectRunsCache.set(runById, next);
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

function mergeWorkflowIntoProjectSummaries(
  summariesByProjectId: Record<string, readonly WorkflowThreadSummary[]>,
  runById: Record<string, WorkflowRunSnapshot>,
  workflow: WorkflowDraft,
): Record<string, readonly WorkflowThreadSummary[]> {
  const summaries = summariesByProjectId[workflow.projectId] ?? EMPTY_WORKFLOW_SUMMARIES;
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
    ...summariesByProjectId,
    [workflow.projectId]: nextSummaries.toSorted((a, b) =>
      b.workflow.updatedAt.localeCompare(a.workflow.updatedAt),
    ),
  };
}

function removeWorkflowFromProjectSummaries(
  summariesByProjectId: Record<string, readonly WorkflowThreadSummary[]>,
  workflow: WorkflowDraft,
): Record<string, readonly WorkflowThreadSummary[]> {
  const summaries = summariesByProjectId[workflow.projectId] ?? EMPTY_WORKFLOW_SUMMARIES;
  return {
    ...summariesByProjectId,
    [workflow.projectId]: summaries.filter(
      (summary) => summary.workflow.workflowId !== workflow.workflowId,
    ),
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

function refreshProjectSummaryForRun(
  summariesByProjectId: Record<string, readonly WorkflowThreadSummary[]>,
  runById: Record<string, WorkflowRunSnapshot>,
  run: WorkflowRunSnapshot,
): Record<string, readonly WorkflowThreadSummary[]> {
  const summaries = summariesByProjectId[run.projectId];
  if (!summaries) {
    return summariesByProjectId;
  }
  const counts = countsForWorkflow(runById, run.workflowId);
  const latestRun = latestRunForWorkflow(runById, run.workflowId);
  return {
    ...summariesByProjectId,
    [run.projectId]: summaries.map((summary) =>
      summary.workflow.workflowId === run.workflowId
        ? Object.assign({}, summary, { latestRun }, counts)
        : summary,
    ),
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
  summariesByProjectId: {},
  linksByProjectId: {},
  schedulesByProjectId: {},
  memoryByWorkflowId: {},
  runById: {},
  eventsByRunId: {},
  fetchingThreadKeys: new Set(),
  fetchingProjectIds: new Set(),

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

  setProjectSnapshot: (projectId, workflows, runs, links, schedules) =>
    set((state) => {
      const runById = { ...state.runById };
      for (const [runId, run] of Object.entries(runById)) {
        if (run.projectId === projectId) {
          delete runById[runId];
        }
      }
      for (const run of runs) {
        runById[run.runId] = run;
      }
      return {
        runById,
        summariesByProjectId: {
          ...state.summariesByProjectId,
          [projectId]: workflows,
        },
        linksByProjectId: {
          ...state.linksByProjectId,
          [projectId]: links,
        },
        schedulesByProjectId: {
          ...state.schedulesByProjectId,
          [projectId]: schedules,
        },
      };
    }),

  upsertWorkflow: (workflow) =>
    set((state) => ({
      summariesByThreadKey:
        workflow.status === "archived" || workflow.archivedAt !== null
          ? removeWorkflowFromSummaries(state.summariesByThreadKey, workflow)
          : mergeWorkflowIntoSummaries(state.summariesByThreadKey, state.runById, workflow),
      summariesByProjectId:
        workflow.status === "archived" || workflow.archivedAt !== null
          ? removeWorkflowFromProjectSummaries(state.summariesByProjectId, workflow)
          : mergeWorkflowIntoProjectSummaries(state.summariesByProjectId, state.runById, workflow),
    })),

  upsertRun: (run) =>
    set((state) => {
      const runById = { ...state.runById, [run.runId]: run };
      return {
        runById,
        summariesByThreadKey: refreshSummaryForRun(state.summariesByThreadKey, runById, run),
        summariesByProjectId: refreshProjectSummaryForRun(state.summariesByProjectId, runById, run),
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

  fetchProject: async (projectId, includeArchived = false) => {
    set((state) => ({
      fetchingProjectIds: new Set(state.fetchingProjectIds).add(projectId),
    }));
    try {
      const client = getPrimaryEnvironmentConnection().client;
      const result = await client.workflows.listProjectWorkflows({ projectId, includeArchived });
      get().setProjectSnapshot(
        projectId,
        result.workflows,
        result.runs,
        result.links,
        result.schedules,
      );
    } finally {
      set((state) => {
        const next = new Set(state.fetchingProjectIds);
        next.delete(projectId);
        return { fetchingProjectIds: next };
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
      ...(originThreadId !== null ? { originThreadId } : {}),
      ...(workflowId !== undefined ? { workflowId } : {}),
      ...(args !== undefined ? { args } : {}),
    });
    get().upsertRun(result.run);
    return result.run;
  },

  scheduleWorkflow: async (workflowId, runAt, args) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.scheduleRun({
      workflowId,
      runAt: runAt as WorkflowSchedule["runAt"],
      ...(args !== undefined ? { args } : {}),
    });
    set((state) => ({
      schedulesByProjectId: {
        ...state.schedulesByProjectId,
        [result.schedule.projectId]: [
          result.schedule,
          ...(state.schedulesByProjectId[result.schedule.projectId] ?? EMPTY_WORKFLOW_SCHEDULES),
        ],
      },
    }));
    return result.schedule;
  },

  cancelScheduledRun: async (scheduleId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.cancelScheduledRun({ scheduleId });
    set((state) => {
      const schedules = state.schedulesByProjectId[result.schedule.projectId] ?? [];
      return {
        schedulesByProjectId: {
          ...state.schedulesByProjectId,
          [result.schedule.projectId]: schedules.map((schedule) =>
            schedule.scheduleId === result.schedule.scheduleId ? result.schedule : schedule,
          ),
        },
      };
    });
    return result.schedule;
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

  fetchMemory: async (workflowId, includeSuppressed = false) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.listMemory({ workflowId, includeSuppressed });
    set((state) => ({
      memoryByWorkflowId: {
        ...state.memoryByWorkflowId,
        [workflowId]: result.items,
      },
    }));
    return result.items;
  },

  suppressMemoryItem: async (memoryId) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.workflows.suppressMemoryItem({ memoryId });
    set((state) => {
      const items = state.memoryByWorkflowId[result.item.workflowId] ?? EMPTY_WORKFLOW_MEMORY;
      return {
        memoryByWorkflowId: {
          ...state.memoryByWorkflowId,
          [result.item.workflowId]: items.map((item) =>
            item.memoryId === result.item.memoryId ? result.item : item,
          ),
        },
      };
    });
    return result.item;
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

export function selectProjectWorkflowSummaries(
  state: Pick<WorkflowState, "summariesByProjectId">,
  projectId: ProjectId | null,
): readonly WorkflowThreadSummary[] {
  if (!projectId) {
    return EMPTY_WORKFLOW_SUMMARIES;
  }
  return state.summariesByProjectId[projectId] ?? EMPTY_WORKFLOW_SUMMARIES;
}

export function selectProjectWorkflowRuns(
  state: Pick<WorkflowState, "runById">,
  projectId: ProjectId | null,
): readonly WorkflowRunSnapshot[] {
  if (!projectId) {
    return EMPTY_WORKFLOW_RUNS;
  }
  const cache = getProjectRunsCache(state.runById);
  const cached = cache.get(projectId);
  if (cached) {
    return cached;
  }

  const runs = Object.values(state.runById).filter((run) => run.projectId === projectId);
  const sortedRuns = runs.length === 0 ? EMPTY_WORKFLOW_RUNS : sortRunsNewestFirst(runs);
  cache.set(projectId, sortedRuns);
  return sortedRuns;
}

export function selectProjectWorkflowLinks(
  state: Pick<WorkflowState, "linksByProjectId">,
  projectId: ProjectId | null,
): readonly WorkflowThreadLink[] {
  if (!projectId) {
    return EMPTY_WORKFLOW_LINKS;
  }
  return state.linksByProjectId[projectId] ?? EMPTY_WORKFLOW_LINKS;
}

export function selectProjectWorkflowSchedules(
  state: Pick<WorkflowState, "schedulesByProjectId">,
  projectId: ProjectId | null,
): readonly WorkflowSchedule[] {
  if (!projectId) {
    return EMPTY_WORKFLOW_SCHEDULES;
  }
  return state.schedulesByProjectId[projectId] ?? EMPTY_WORKFLOW_SCHEDULES;
}

export function selectWorkflowMemoryItems(
  state: Pick<WorkflowState, "memoryByWorkflowId">,
  workflowId: WorkflowId | null,
): readonly WorkflowMemoryItem[] {
  if (!workflowId) {
    return EMPTY_WORKFLOW_MEMORY;
  }
  return state.memoryByWorkflowId[workflowId] ?? EMPTY_WORKFLOW_MEMORY;
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
