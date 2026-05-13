import {
  type ManagedProcess,
  type ManagedProcessInstance,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
} from "@fenrir/contracts";
import {
  selectEnvironmentState,
  selectManagedProcessInstancesForProject,
  type AppState,
  type EnvironmentState,
} from "./store";
import { type Project, type SidebarThreadSummary, type Thread } from "./types";
import { getThreadFromEnvironmentState } from "./threadDerivation";

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

export function createSidebarThreadSummarySelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => SidebarThreadSummary | undefined {
  return (state) =>
    ref
      ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
      : undefined;
}

function createScopedThreadSelector(
  resolveRef: (state: AppState) => ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousThreadId: ThreadId | undefined;
  let previousThread: Thread | undefined;

  return (state) => {
    const ref = resolveRef(state);
    if (!ref) {
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    if (
      previousThread &&
      previousEnvironmentState === environmentState &&
      previousThreadId === ref.threadId
    ) {
      return previousThread;
    }

    previousEnvironmentState = environmentState;
    previousThreadId = ref.threadId;
    previousThread = getThreadFromEnvironmentState(environmentState, ref.threadId);
    return previousThread;
  };
}

export function createThreadSelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector(() => ref);
}

export function createThreadSelectorAcrossEnvironments(
  threadId: ThreadId | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector((state) => {
    if (!threadId) {
      return undefined;
    }

    for (const [environmentId, environmentState] of Object.entries(
      state.environmentStateById,
    ) as Array<[ScopedThreadRef["environmentId"], EnvironmentState]>) {
      if (environmentState.threadShellById[threadId]) {
        return {
          environmentId,
          threadId,
        };
      }
    }
    return undefined;
  });
}

// ---------- Managed process selectors ----------

const EMPTY_DEFINITIONS: ManagedProcess[] = [];

export function createManagedProcessDefinitionsSelector(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => ManagedProcess[] {
  return (state) => {
    if (!ref) return EMPTY_DEFINITIONS;
    const project = selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId];
    return project?.managedProcesses ?? EMPTY_DEFINITIONS;
  };
}

export function createManagedProcessInstancesSelector(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => ManagedProcessInstance[] {
  const empty: ManagedProcessInstance[] = [];
  return (state) =>
    ref ? selectManagedProcessInstancesForProject(state, ref.environmentId, ref.projectId) : empty;
}

export function createInstanceForDefinitionSelector(
  ref: ScopedProjectRef | null | undefined,
  processDefId: string,
  worktreePath: string | null,
): (state: AppState) => ManagedProcessInstance | undefined {
  return (state) => {
    if (!ref) return undefined;
    return selectManagedProcessInstancesForProject(state, ref.environmentId, ref.projectId).find(
      (inst) => inst.processDefId === processDefId && (inst.worktreePath ?? null) === worktreePath,
    );
  };
}
