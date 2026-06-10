import type {
  EnvironmentId,
  ManagedProcess,
  ManagedProcessInstance,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@fenrir/contracts";
import { type Project, type SidebarThreadSummary, type Thread, type ThreadShell } from "../types";
import { getThreadFromEnvironmentState } from "../threadDerivation";
import {
  type AppState,
  type EnvironmentState,
  EMPTY_THREAD_IDS,
  getProjects,
  getStoredEnvironmentState,
  getThreads,
  initialEnvironmentState,
} from "./state";

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentState {
  return environmentId ? getStoredEnvironmentState(state, environmentId) : initialEnvironmentState;
}

export function selectProjectsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Project[] {
  return getProjects(selectEnvironmentState(state, environmentId));
}

export function selectThreadsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Thread[] {
  return getThreads(selectEnvironmentState(state, environmentId));
}

export function selectProjectsAcrossEnvironments(state: AppState): Project[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getProjects(environmentState),
  );
}

export function selectThreadsAcrossEnvironments(state: AppState): Thread[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getThreads(environmentState),
  );
}

/** Like `selectThreadsAcrossEnvironments` but returns stable `ThreadShell` references from the store (no derived data). */
export function selectThreadShellsAcrossEnvironments(state: AppState): ThreadShell[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const shell = environmentState.threadShellById[threadId];
      return shell ? [shell] : [];
    }),
  );
}

export function selectSidebarThreadsAcrossEnvironments(state: AppState): SidebarThreadSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const thread = environmentState.sidebarThreadSummaryById[threadId];
      return thread && thread.environmentId === environmentId ? [thread] : [];
    }),
  );
}

export function selectSidebarThreadsForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarThreadSummary[] {
  if (!ref) {
    return [];
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const threadIds = environmentState.threadIdsByProjectId[ref.projectId] ?? EMPTY_THREAD_IDS;
  return threadIds.flatMap((threadId) => {
    const thread = environmentState.sidebarThreadSummaryById[threadId];
    return thread ? [thread] : [];
  });
}

export function selectSidebarThreadsForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarThreadSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarThreadsForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarThreadsForProjectRef(state, ref));
}

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectProjectByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): Project | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId]
    : undefined;
}

export function selectThreadByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): Thread | undefined {
  return ref
    ? getThreadFromEnvironmentState(selectEnvironmentState(state, ref.environmentId), ref.threadId)
    : undefined;
}

export function selectThreadExistsByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).threadShellById[ref.threadId] !== undefined
    : false;
}

export function selectThreadDetailsHydratedByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).threadDetailsHydratedById?.[ref.threadId] ??
        false)
    : false;
}

export function selectSidebarThreadSummaryByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): SidebarThreadSummary | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
    : undefined;
}

export function selectThreadIdsByProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): ThreadId[] {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).threadIdsByProjectId[ref.projectId] ??
        EMPTY_THREAD_IDS)
    : EMPTY_THREAD_IDS;
}

// ---------- Managed process selectors ----------

const EMPTY_INSTANCE_IDS: string[] = [];

export function selectManagedProcessInstancesForProject(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
  projectId: ProjectId,
): ManagedProcessInstance[] {
  const envState = selectEnvironmentState(state, environmentId);
  const ids = envState.managedProcessInstanceIdsByProjectId[projectId] ?? EMPTY_INSTANCE_IDS;
  return ids.flatMap((id) => {
    const instance = envState.managedProcessInstanceById[id];
    return instance ? [instance] : [];
  });
}

export function selectManagedProcessInstanceById(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
  instanceId: string,
): ManagedProcessInstance | undefined {
  return selectEnvironmentState(state, environmentId).managedProcessInstanceById[instanceId];
}

export function selectInstanceForDefinition(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
  projectId: ProjectId,
  processDefId: string,
  worktreePath: string | null,
): ManagedProcessInstance | undefined {
  return selectManagedProcessInstancesForProject(state, environmentId, projectId).find(
    (inst) => inst.processDefId === processDefId && (inst.worktreePath ?? null) === worktreePath,
  );
}

const EMPTY_DEFINITIONS: ManagedProcess[] = [];

export function selectManagedProcessDefinitions(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
  projectId: ProjectId,
): ManagedProcess[] {
  const envState = selectEnvironmentState(state, environmentId);
  return envState.projectById[projectId]?.managedProcesses ?? EMPTY_DEFINITIONS;
}
