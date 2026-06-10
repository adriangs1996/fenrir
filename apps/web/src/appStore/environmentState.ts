import type {
  EnvironmentId,
  ManagedProcessInstance,
  MessageId,
  OrchestrationManagedProcessSnapshot,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationThreadShell,
  OrchestrationThreadActivity,
  ProjectId,
  ThreadId,
  TurnId,
} from "@fenrir/contracts";
import {
  type ChatMessage,
  type Project,
  type ProposedPlan,
  type SidebarThreadSummary,
  type Thread,
  type ThreadSession,
  type ThreadShell,
  type ThreadTurnState,
  type TurnDiffSummary,
} from "../types";
import { getThreadFromEnvironmentState } from "../threadDerivation";
import { EMPTY_THREAD_IDS, type EnvironmentState } from "./state";
import {
  appendId,
  arraysEqual,
  buildActivitySlice,
  buildMessageSlice,
  buildProposedPlanSlice,
  buildSidebarThreadSummary,
  buildSidebarThreadSummaryFromShell,
  buildTurnDiffSlice,
  mapProject,
  mapThread,
  mapThreadShellRecord,
  mapThreadShellSession,
  mapThreadTurnStateFromShell,
  removeId,
  retainThreadScopedRecord,
  sidebarThreadSummariesEqual,
  threadShellsEqual,
  threadTurnStatesEqual,
  toThreadShell,
  toThreadTurnState,
} from "./mappers";

export function writeThreadState(
  state: EnvironmentState,
  nextThread: Thread,
  previousThread?: Thread,
): EnvironmentState {
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById[nextThread.id];
  const previousTurnState = state.threadTurnStateById[nextThread.id];
  const previousSummary = state.sidebarThreadSummaryById[nextThread.id];
  const nextSummary = buildSidebarThreadSummary(nextThread);

  let nextState = state;

  if (!state.threadIds.includes(nextThread.id)) {
    nextState = {
      ...nextState,
      threadIds: [...nextState.threadIds, nextThread.id],
    };
  }

  const previousProjectId = previousThread?.projectId;
  const nextProjectId = nextThread.projectId;
  if (previousProjectId !== nextProjectId) {
    let threadIdsByProjectId = nextState.threadIdsByProjectId;
    if (previousProjectId) {
      const previousIds = threadIdsByProjectId[previousProjectId] ?? EMPTY_THREAD_IDS;
      const nextIds = removeId(previousIds, nextThread.id);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = threadIdsByProjectId;
        threadIdsByProjectId = rest as Record<ProjectId, ThreadId[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        threadIdsByProjectId = {
          ...threadIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    }
    const projectThreadIds = threadIdsByProjectId[nextProjectId] ?? EMPTY_THREAD_IDS;
    const nextProjectThreadIds = appendId(projectThreadIds, nextThread.id);
    if (!arraysEqual(projectThreadIds, nextProjectThreadIds)) {
      threadIdsByProjectId = {
        ...threadIdsByProjectId,
        [nextProjectId]: nextProjectThreadIds,
      };
    }
    if (threadIdsByProjectId !== nextState.threadIdsByProjectId) {
      nextState = {
        ...nextState,
        threadIdsByProjectId,
      };
    }
  }

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.id]: nextShell,
      },
    };
  }

  if ((previousThread?.session ?? null) !== nextThread.session) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== nextThread.messages) {
    const nextMessageSlice = buildMessageSlice(nextThread);
    nextState = {
      ...nextState,
      messageIdsByThreadId: {
        ...nextState.messageIdsByThreadId,
        [nextThread.id]: nextMessageSlice.ids,
      },
      messageByThreadId: {
        ...nextState.messageByThreadId,
        [nextThread.id]: nextMessageSlice.byId,
      },
    };
  }

  if (previousThread?.activities !== nextThread.activities) {
    const nextActivitySlice = buildActivitySlice(nextThread);
    nextState = {
      ...nextState,
      activityIdsByThreadId: {
        ...nextState.activityIdsByThreadId,
        [nextThread.id]: nextActivitySlice.ids,
      },
      activityByThreadId: {
        ...nextState.activityByThreadId,
        [nextThread.id]: nextActivitySlice.byId,
      },
    };
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const nextProposedPlanSlice = buildProposedPlanSlice(nextThread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...nextState.proposedPlanIdsByThreadId,
        [nextThread.id]: nextProposedPlanSlice.ids,
      },
      proposedPlanByThreadId: {
        ...nextState.proposedPlanByThreadId,
        [nextThread.id]: nextProposedPlanSlice.byId,
      },
    };
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const nextTurnDiffSlice = buildTurnDiffSlice(nextThread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...nextState.turnDiffIdsByThreadId,
        [nextThread.id]: nextTurnDiffSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...nextState.turnDiffSummaryByThreadId,
        [nextThread.id]: nextTurnDiffSlice.byId,
      },
    };
  }

  if (!sidebarThreadSummariesEqual(previousSummary, nextSummary)) {
    nextState = {
      ...nextState,
      sidebarThreadSummaryById: {
        ...nextState.sidebarThreadSummaryById,
        [nextThread.id]: nextSummary,
      },
    };
  }

  return nextState;
}

export function writeThreadShellState(
  state: EnvironmentState,
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): EnvironmentState {
  const nextShell = mapThreadShellRecord(thread, environmentId);
  const nextSession = mapThreadShellSession(thread.session);
  const nextTurnState = mapThreadTurnStateFromShell(thread);
  const nextSummary = buildSidebarThreadSummaryFromShell(thread, environmentId);

  let nextState = state;

  if (!state.threadIds.includes(thread.id)) {
    nextState = {
      ...nextState,
      threadIds: [...nextState.threadIds, thread.id],
    };
  }

  const currentProjectThreadIds =
    nextState.threadIdsByProjectId[thread.projectId] ?? EMPTY_THREAD_IDS;
  const nextProjectThreadIds = appendId(currentProjectThreadIds, thread.id);
  if (!arraysEqual(currentProjectThreadIds, nextProjectThreadIds)) {
    nextState = {
      ...nextState,
      threadIdsByProjectId: {
        ...nextState.threadIdsByProjectId,
        [thread.projectId]: nextProjectThreadIds,
      },
    };
  }

  if (!threadShellsEqual(nextState.threadShellById[thread.id], nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [thread.id]: nextShell,
      },
    };
  }

  if ((nextState.threadSessionById[thread.id] ?? null) !== nextSession) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [thread.id]: nextSession,
      },
    };
  }

  if (!threadTurnStatesEqual(nextState.threadTurnStateById[thread.id], nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [thread.id]: nextTurnState,
      },
    };
  }

  if (!sidebarThreadSummariesEqual(nextState.sidebarThreadSummaryById[thread.id], nextSummary)) {
    nextState = {
      ...nextState,
      sidebarThreadSummaryById: {
        ...nextState.sidebarThreadSummaryById,
        [thread.id]: nextSummary,
      },
    };
  }

  if (nextState.threadDetailsHydratedById?.[thread.id] === undefined) {
    nextState = {
      ...nextState,
      threadDetailsHydratedById: {
        ...nextState.threadDetailsHydratedById,
        [thread.id]: false,
      },
    };
  }

  return nextState;
}

export function removeThreadState(state: EnvironmentState, threadId: ThreadId): EnvironmentState {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return state;
  }

  const nextThreadIds = removeId(state.threadIds, threadId);
  const currentProjectThreadIds = state.threadIdsByProjectId[shell.projectId] ?? EMPTY_THREAD_IDS;
  const nextProjectThreadIds = removeId(currentProjectThreadIds, threadId);
  const nextThreadIdsByProjectId =
    nextProjectThreadIds.length === 0
      ? (() => {
          const { [shell.projectId]: _removed, ...rest } = state.threadIdsByProjectId;
          return rest as Record<ProjectId, ThreadId[]>;
        })()
      : {
          ...state.threadIdsByProjectId,
          [shell.projectId]: nextProjectThreadIds,
        };

  const { [threadId]: _removedShell, ...threadShellById } = state.threadShellById;
  const { [threadId]: _removedSession, ...threadSessionById } = state.threadSessionById;
  const { [threadId]: _removedTurnState, ...threadTurnStateById } = state.threadTurnStateById;
  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } = state.messageIdsByThreadId;
  const { [threadId]: _removedMessages, ...messageByThreadId } = state.messageByThreadId;
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } = state.activityIdsByThreadId;
  const { [threadId]: _removedActivities, ...activityByThreadId } = state.activityByThreadId;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } = state.proposedPlanByThreadId;
  const { [threadId]: _removedTurnDiffIds, ...turnDiffIdsByThreadId } = state.turnDiffIdsByThreadId;
  const { [threadId]: _removedTurnDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId;
  const { [threadId]: _removedSidebarSummary, ...sidebarThreadSummaryById } =
    state.sidebarThreadSummaryById;
  const { [threadId]: _removedDetailsHydrated, ...threadDetailsHydratedById } =
    state.threadDetailsHydratedById ?? {};

  return {
    ...state,
    threadIds: nextThreadIds,
    threadIdsByProjectId: nextThreadIdsByProjectId,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
    threadDetailsHydratedById,
  };
}

export function updateThreadState(
  state: EnvironmentState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): EnvironmentState {
  const currentThread = getThreadFromEnvironmentState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const nextThread = updater(currentThread);
  if (nextThread === currentThread) {
    return state;
  }
  return writeThreadState(state, nextThread, currentThread);
}

export function buildProjectState(
  projects: ReadonlyArray<Project>,
): Pick<EnvironmentState, "projectIds" | "projectById"> {
  return {
    projectIds: projects.map((project) => project.id),
    projectById: Object.fromEntries(
      projects.map((project) => [project.id, project] as const),
    ) as Record<ProjectId, Project>,
  };
}

export function buildThreadState(
  threads: ReadonlyArray<Thread>,
): Pick<
  EnvironmentState,
  | "threadIds"
  | "threadIdsByProjectId"
  | "threadShellById"
  | "threadSessionById"
  | "threadTurnStateById"
  | "messageIdsByThreadId"
  | "messageByThreadId"
  | "activityIdsByThreadId"
  | "activityByThreadId"
  | "proposedPlanIdsByThreadId"
  | "proposedPlanByThreadId"
  | "turnDiffIdsByThreadId"
  | "turnDiffSummaryByThreadId"
  | "sidebarThreadSummaryById"
  | "threadDetailsHydratedById"
> {
  const threadIds: ThreadId[] = [];
  const threadIdsByProjectId: Record<ProjectId, ThreadId[]> = {};
  const threadShellById: Record<ThreadId, ThreadShell> = {};
  const threadSessionById: Record<ThreadId, ThreadSession | null> = {};
  const threadTurnStateById: Record<ThreadId, ThreadTurnState> = {};
  const messageIdsByThreadId: Record<ThreadId, MessageId[]> = {};
  const messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>> = {};
  const activityIdsByThreadId: Record<ThreadId, string[]> = {};
  const activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>> = {};
  const proposedPlanIdsByThreadId: Record<ThreadId, string[]> = {};
  const proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>> = {};
  const turnDiffIdsByThreadId: Record<ThreadId, TurnId[]> = {};
  const turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>> = {};
  const sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary> = {};
  const threadDetailsHydratedById: Record<ThreadId, boolean> = {};

  for (const thread of threads) {
    threadIds.push(thread.id);
    threadIdsByProjectId[thread.projectId] = [
      ...(threadIdsByProjectId[thread.projectId] ?? EMPTY_THREAD_IDS),
      thread.id,
    ];
    threadShellById[thread.id] = toThreadShell(thread);
    threadSessionById[thread.id] = thread.session;
    threadTurnStateById[thread.id] = toThreadTurnState(thread);
    const messageSlice = buildMessageSlice(thread);
    messageIdsByThreadId[thread.id] = messageSlice.ids;
    messageByThreadId[thread.id] = messageSlice.byId;
    const activitySlice = buildActivitySlice(thread);
    activityIdsByThreadId[thread.id] = activitySlice.ids;
    activityByThreadId[thread.id] = activitySlice.byId;
    const proposedPlanSlice = buildProposedPlanSlice(thread);
    proposedPlanIdsByThreadId[thread.id] = proposedPlanSlice.ids;
    proposedPlanByThreadId[thread.id] = proposedPlanSlice.byId;
    const turnDiffSlice = buildTurnDiffSlice(thread);
    turnDiffIdsByThreadId[thread.id] = turnDiffSlice.ids;
    turnDiffSummaryByThreadId[thread.id] = turnDiffSlice.byId;
    sidebarThreadSummaryById[thread.id] = buildSidebarThreadSummary(thread);
    threadDetailsHydratedById[thread.id] = true;
  }

  return {
    threadIds,
    threadIdsByProjectId,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
    threadDetailsHydratedById,
  };
}

export function buildThreadShellState(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  environmentId: EnvironmentId,
): Pick<
  EnvironmentState,
  | "threadIds"
  | "threadIdsByProjectId"
  | "threadShellById"
  | "threadSessionById"
  | "threadTurnStateById"
  | "messageIdsByThreadId"
  | "messageByThreadId"
  | "activityIdsByThreadId"
  | "activityByThreadId"
  | "proposedPlanIdsByThreadId"
  | "proposedPlanByThreadId"
  | "turnDiffIdsByThreadId"
  | "turnDiffSummaryByThreadId"
  | "sidebarThreadSummaryById"
  | "threadDetailsHydratedById"
> {
  const threadIds: ThreadId[] = [];
  const threadIdsByProjectId: Record<ProjectId, ThreadId[]> = {};
  const threadShellById: Record<ThreadId, ThreadShell> = {};
  const threadSessionById: Record<ThreadId, ThreadSession | null> = {};
  const threadTurnStateById: Record<ThreadId, ThreadTurnState> = {};
  const messageIdsByThreadId: Record<ThreadId, MessageId[]> = {};
  const messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>> = {};
  const activityIdsByThreadId: Record<ThreadId, string[]> = {};
  const activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>> = {};
  const proposedPlanIdsByThreadId: Record<ThreadId, string[]> = {};
  const proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>> = {};
  const turnDiffIdsByThreadId: Record<ThreadId, TurnId[]> = {};
  const turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>> = {};
  const sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary> = {};
  const threadDetailsHydratedById: Record<ThreadId, boolean> = {};

  for (const thread of threads) {
    threadIds.push(thread.id);
    threadIdsByProjectId[thread.projectId] = [
      ...(threadIdsByProjectId[thread.projectId] ?? EMPTY_THREAD_IDS),
      thread.id,
    ];
    threadShellById[thread.id] = mapThreadShellRecord(thread, environmentId);
    threadSessionById[thread.id] = mapThreadShellSession(thread.session);
    threadTurnStateById[thread.id] = mapThreadTurnStateFromShell(thread);
    messageIdsByThreadId[thread.id] = [];
    messageByThreadId[thread.id] = {};
    activityIdsByThreadId[thread.id] = [];
    activityByThreadId[thread.id] = {};
    proposedPlanIdsByThreadId[thread.id] = [];
    proposedPlanByThreadId[thread.id] = {};
    turnDiffIdsByThreadId[thread.id] = [];
    turnDiffSummaryByThreadId[thread.id] = {};
    sidebarThreadSummaryById[thread.id] = buildSidebarThreadSummaryFromShell(thread, environmentId);
    threadDetailsHydratedById[thread.id] = false;
  }

  return {
    threadIds,
    threadIdsByProjectId,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
    threadDetailsHydratedById,
  };
}

export function buildManagedProcessInstanceState(
  instances: ReadonlyArray<ManagedProcessInstance>,
): Pick<EnvironmentState, "managedProcessInstanceById" | "managedProcessInstanceIdsByProjectId"> {
  const managedProcessInstanceById: Record<string, ManagedProcessInstance> = {};
  const managedProcessInstanceIdsByProjectId: Record<ProjectId, string[]> = {};

  for (const instance of instances) {
    managedProcessInstanceById[instance.instanceId] = instance;
    const projectInstances = managedProcessInstanceIdsByProjectId[instance.projectId] ?? [];
    if (!projectInstances.includes(instance.instanceId)) {
      managedProcessInstanceIdsByProjectId[instance.projectId] = [
        ...projectInstances,
        instance.instanceId,
      ];
    }
  }

  return { managedProcessInstanceById, managedProcessInstanceIdsByProjectId };
}

export function syncEnvironmentManagedProcessSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationManagedProcessSnapshot,
): EnvironmentState {
  return {
    ...state,
    ...buildManagedProcessInstanceState(snapshot.instances),
  };
}

export function upsertManagedProcessInstance(
  state: EnvironmentState,
  instance: ManagedProcessInstance,
): EnvironmentState {
  const projectInstanceIds = state.managedProcessInstanceIdsByProjectId[instance.projectId] ?? [];
  const nextProjectInstanceIds = projectInstanceIds.includes(instance.instanceId)
    ? projectInstanceIds
    : [...projectInstanceIds, instance.instanceId];

  return {
    ...state,
    managedProcessInstanceById: {
      ...state.managedProcessInstanceById,
      [instance.instanceId]: instance,
    },
    managedProcessInstanceIdsByProjectId:
      nextProjectInstanceIds === projectInstanceIds
        ? state.managedProcessInstanceIdsByProjectId
        : {
            ...state.managedProcessInstanceIdsByProjectId,
            [instance.projectId]: nextProjectInstanceIds,
          },
  };
}

export function updateManagedProcessInstance(
  state: EnvironmentState,
  instanceId: string,
  updater: (instance: ManagedProcessInstance) => ManagedProcessInstance,
): EnvironmentState {
  const existing = state.managedProcessInstanceById[instanceId];
  if (!existing) return state;
  const next = updater(existing);
  if (next === existing) return state;
  return {
    ...state,
    managedProcessInstanceById: {
      ...state.managedProcessInstanceById,
      [instanceId]: next,
    },
  };
}

export function syncEnvironmentReadModel(
  state: EnvironmentState,
  readModel: OrchestrationReadModel,
  environmentId: EnvironmentId,
): EnvironmentState {
  const projects = readModel.projects
    .filter((project) => project.deletedAt === null)
    .map((project) => mapProject(project, environmentId));
  const threads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => mapThread(thread, environmentId));
  return {
    ...state,
    ...buildProjectState(projects),
    ...buildThreadState(threads),
    ...(readModel.managedProcessInstances.length > 0
      ? buildManagedProcessInstanceState(readModel.managedProcessInstances)
      : {
          managedProcessInstanceById: state.managedProcessInstanceById,
          managedProcessInstanceIdsByProjectId: state.managedProcessInstanceIdsByProjectId,
        }),
    bootstrapComplete: true,
  };
}

export function markAllThreadDetailsHydrated(
  state: EnvironmentState,
  hydrated: boolean,
): EnvironmentState {
  const nextThreadDetailsHydratedById = Object.fromEntries(
    state.threadIds.map((threadId) => [threadId, hydrated] as const),
  ) as Record<ThreadId, boolean>;

  if (
    Object.keys(state.threadDetailsHydratedById ?? {}).length ===
      Object.keys(nextThreadDetailsHydratedById).length &&
    state.threadIds.every(
      (threadId) =>
        (state.threadDetailsHydratedById?.[threadId] ?? false) ===
        nextThreadDetailsHydratedById[threadId],
    )
  ) {
    return state;
  }

  return {
    ...state,
    threadDetailsHydratedById: nextThreadDetailsHydratedById,
  };
}

export function syncEnvironmentShellSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): EnvironmentState {
  const projects = snapshot.projects
    .filter((project) => project.deletedAt === null)
    .map((project) => mapProject(project, environmentId));
  const nextProjectIds = new Set(projects.map((project) => project.id));
  const nextThreadIds = new Set(snapshot.threads.map((thread) => thread.id));
  const managedProcessInstanceById = Object.fromEntries(
    Object.entries(state.managedProcessInstanceById).filter(([, instance]) =>
      nextProjectIds.has(instance.projectId),
    ),
  ) as Record<string, ManagedProcessInstance>;
  const managedProcessInstanceIdsByProjectId = Object.fromEntries(
    Object.entries(state.managedProcessInstanceIdsByProjectId)
      .filter(([projectId]) => nextProjectIds.has(projectId as ProjectId))
      .map(([projectId, instanceIds]) => [
        projectId,
        instanceIds.filter((instanceId) => managedProcessInstanceById[instanceId] !== undefined),
      ]),
  ) as Record<ProjectId, string[]>;

  let nextState: EnvironmentState = {
    ...state,
    ...buildProjectState(projects),
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    sidebarThreadSummaryById: {},
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    threadDetailsHydratedById: retainThreadScopedRecord(
      state.threadDetailsHydratedById ?? {},
      nextThreadIds,
    ),
    managedProcessInstanceById,
    managedProcessInstanceIdsByProjectId,
    bootstrapComplete: true,
  };

  for (const thread of snapshot.threads) {
    nextState = writeThreadShellState(nextState, thread, environmentId);
  }

  return nextState;
}

export function applyEnvironmentShellEvent(
  state: EnvironmentState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.kind) {
    case "project-upserted": {
      const nextProject = mapProject(event.project, environmentId);
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.project.id ||
            state.projectById[projectId]?.cwd === event.project.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }
    case "project-removed": {
      if (!state.projectById[event.projectId]) {
        return state;
      }
      const { [event.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.projectId),
      };
    }
    case "thread-upserted":
      return writeThreadShellState(state, event.thread, environmentId);
    case "thread-removed":
      return removeThreadState(state, event.threadId);
  }
}
