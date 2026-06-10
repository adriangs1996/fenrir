import type {
  EnvironmentId,
  OrchestrationBootstrapSnapshot,
  OrchestrationEvent,
  OrchestrationManagedProcessSnapshot,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationThread,
  ScopedThreadRef,
  ThreadId,
} from "@fenrir/contracts";
import { create } from "zustand";
import { getThreadFromEnvironmentState } from "./threadDerivation";
import {
  type AppState,
  commitEnvironmentState,
  getStoredEnvironmentState,
  initialState,
} from "./appStore/state";
import { mapProject, mapThread, setThreadDetailsHydrated } from "./appStore/mappers";
import {
  applyEnvironmentShellEvent,
  buildManagedProcessInstanceState,
  buildProjectState,
  buildThreadShellState,
  markAllThreadDetailsHydrated,
  syncEnvironmentManagedProcessSnapshot,
  syncEnvironmentReadModel,
  syncEnvironmentShellSnapshot,
  updateThreadState,
  writeThreadState,
} from "./appStore/environmentState";
import { applyEnvironmentOrchestrationEvent } from "./appStore/orchestrationEvents";

// The app store internals are split by concern under ./appStore/ (state shape,
// orchestration mappers, environment-state writers, the orchestration event
// reducer, and selectors). This module re-exports the public surface so
// existing call sites keep importing from "./store".
export type { AppState, EnvironmentState } from "./appStore/state";
export {
  selectEnvironmentState,
  selectProjectsForEnvironment,
  selectThreadsForEnvironment,
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarThreadsForProjectRef,
  selectSidebarThreadsForProjectRefs,
  selectBootstrapCompleteForActiveEnvironment,
  selectProjectByRef,
  selectThreadByRef,
  selectThreadExistsByRef,
  selectThreadDetailsHydratedByRef,
  selectSidebarThreadSummaryByRef,
  selectThreadIdsByProjectRef,
  selectManagedProcessInstancesForProject,
  selectManagedProcessInstanceById,
  selectInstanceForDefinition,
  selectManagedProcessDefinitions,
} from "./appStore/selectors";

export function syncServerReadModel(
  state: AppState,
  readModel: OrchestrationReadModel,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentReadModel(
      getStoredEnvironmentState(state, environmentId),
      readModel,
      environmentId,
    ),
  );
}

export function syncServerBootstrapSnapshot(
  state: AppState,
  snapshot: OrchestrationBootstrapSnapshot,
  environmentId: EnvironmentId,
): AppState {
  const projects = snapshot.projects
    .filter((project) => project.deletedAt === null)
    .map((project) => mapProject(project, environmentId));
  return commitEnvironmentState(state, environmentId, {
    ...getStoredEnvironmentState(state, environmentId),
    ...buildProjectState(projects),
    ...buildThreadShellState(snapshot.threads, environmentId),
    ...(snapshot.managedProcessInstances.length > 0
      ? buildManagedProcessInstanceState(snapshot.managedProcessInstances)
      : {
          managedProcessInstanceById: getStoredEnvironmentState(state, environmentId)
            .managedProcessInstanceById,
          managedProcessInstanceIdsByProjectId: getStoredEnvironmentState(state, environmentId)
            .managedProcessInstanceIdsByProjectId,
        }),
    bootstrapComplete: true,
  });
}

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentShellSnapshot(
      getStoredEnvironmentState(state, environmentId),
      snapshot,
      environmentId,
    ),
  );
}

export function syncServerManagedProcessSnapshot(
  state: AppState,
  snapshot: OrchestrationManagedProcessSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentManagedProcessSnapshot(
      getStoredEnvironmentState(state, environmentId),
      snapshot,
    ),
  );
}

export function applyShellEvent(
  state: AppState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentShellEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function syncThreadSnapshot(
  state: AppState,
  thread: OrchestrationThread,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const previousThread = getThreadFromEnvironmentState(environmentState, thread.id);
  const nextEnvironmentState = setThreadDetailsHydrated(
    writeThreadState(environmentState, mapThread(thread, environmentId), previousThread),
    thread.id,
    true,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function setEnvironmentThreadDetailsHydrated(
  state: AppState,
  environmentId: EnvironmentId,
  hydrated: boolean,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    markAllThreadDetailsHydrated(getStoredEnvironmentState(state, environmentId), hydrated),
  );
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const nextEnvironmentState = events.reduce(
    (nextState, event) => applyEnvironmentOrchestrationEvent(nextState, event, environmentId),
    currentEnvironmentState,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  if (state.activeEnvironmentId === null) {
    return state;
  }

  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, state.activeEnvironmentId),
    threadId,
    (thread) => {
      if (thread.error === error) return thread;
      return { ...thread, error };
    },
  );
  return commitEnvironmentState(state, state.activeEnvironmentId, nextEnvironmentState);
}

export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentOrchestrationEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function setActiveEnvironmentId(state: AppState, environmentId: EnvironmentId): AppState {
  if (state.activeEnvironmentId === environmentId) {
    return state;
  }

  return {
    ...state,
    activeEnvironmentId: environmentId,
  };
}

export function setThreadBranch(
  state: AppState,
  threadRef: ScopedThreadRef,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, threadRef.environmentId),
    threadRef.threadId,
    (thread) => {
      if (thread.branch === branch && thread.worktreePath === worktreePath) return thread;
      const cwdChanged = thread.worktreePath !== worktreePath;
      return {
        ...thread,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
  );
  return commitEnvironmentState(state, threadRef.environmentId, nextEnvironmentState);
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerManagedProcessSnapshot: (
    snapshot: OrchestrationManagedProcessSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerBootstrapSnapshot: (
    snapshot: OrchestrationBootstrapSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerReadModel: (readModel: OrchestrationReadModel, environmentId: EnvironmentId) => void;
  syncThreadSnapshot: (thread: OrchestrationThread, environmentId: EnvironmentId) => void;
  setEnvironmentThreadDetailsHydrated: (environmentId: EnvironmentId, hydrated: boolean) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (
    threadRef: ScopedThreadRef,
    branch: string | null,
    worktreePath: string | null,
  ) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...initialState,
  setActiveEnvironmentId: (environmentId) =>
    set((state) => setActiveEnvironmentId(state, environmentId)),
  syncServerShellSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerShellSnapshot(state, snapshot, environmentId)),
  syncServerManagedProcessSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerManagedProcessSnapshot(state, snapshot, environmentId)),
  syncServerBootstrapSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerBootstrapSnapshot(state, snapshot, environmentId)),
  syncServerReadModel: (readModel, environmentId) =>
    set((state) => syncServerReadModel(state, readModel, environmentId)),
  syncThreadSnapshot: (thread, environmentId) =>
    set((state) => syncThreadSnapshot(state, thread, environmentId)),
  setEnvironmentThreadDetailsHydrated: (environmentId, hydrated) =>
    set((state) => setEnvironmentThreadDetailsHydrated(state, environmentId, hydrated)),
  applyShellEvent: (event, environmentId) =>
    set((state) => applyShellEvent(state, event, environmentId)),
  applyOrchestrationEvent: (event, environmentId) =>
    set((state) => applyOrchestrationEvent(state, event, environmentId)),
  applyOrchestrationEvents: (events, environmentId) =>
    set((state) => applyOrchestrationEvents(state, events, environmentId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadRef, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadRef, branch, worktreePath)),
}));
