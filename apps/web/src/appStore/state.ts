import type {
  EnvironmentId,
  ManagedProcessInstance,
  MessageId,
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

export interface EnvironmentState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  activityIdsByThreadId: Record<ThreadId, string[]>;
  activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>>;
  proposedPlanIdsByThreadId: Record<ThreadId, string[]>;
  proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>>;
  turnDiffIdsByThreadId: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>>;
  sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary>;
  threadDetailsHydratedById?: Record<ThreadId, boolean>;
  managedProcessInstanceById: Record<string, ManagedProcessInstance>;
  managedProcessInstanceIdsByProjectId: Record<ProjectId, string[]>;
  bootstrapComplete: boolean;
}

export interface AppState {
  activeEnvironmentId: EnvironmentId | null;
  environmentStateById: Record<string, EnvironmentState>;
}

export const initialEnvironmentState: EnvironmentState = {
  projectIds: [],
  projectById: {},
  threadIds: [],
  threadIdsByProjectId: {},
  threadShellById: {},
  threadSessionById: {},
  threadTurnStateById: {},
  messageIdsByThreadId: {},
  messageByThreadId: {},
  activityIdsByThreadId: {},
  activityByThreadId: {},
  proposedPlanIdsByThreadId: {},
  proposedPlanByThreadId: {},
  turnDiffIdsByThreadId: {},
  turnDiffSummaryByThreadId: {},
  sidebarThreadSummaryById: {},
  threadDetailsHydratedById: {},
  managedProcessInstanceById: {},
  managedProcessInstanceIdsByProjectId: {},
  bootstrapComplete: false,
};

export const initialState: AppState = {
  activeEnvironmentId: null,
  environmentStateById: {},
};

export const EMPTY_THREAD_IDS: ThreadId[] = [];

export function getProjects(state: EnvironmentState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

export function getThreads(state: EnvironmentState): Thread[] {
  return state.threadIds.flatMap((threadId) => {
    const thread = getThreadFromEnvironmentState(state, threadId);
    return thread ? [thread] : [];
  });
}

export function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

export function commitEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
  nextEnvironmentState: EnvironmentState,
): AppState {
  const currentEnvironmentState = state.environmentStateById[environmentId];
  const environmentStateById =
    currentEnvironmentState === nextEnvironmentState
      ? state.environmentStateById
      : {
          ...state.environmentStateById,
          [environmentId]: nextEnvironmentState,
        };

  if (environmentStateById === state.environmentStateById) {
    return state;
  }

  return {
    ...state,
    environmentStateById,
  };
}
