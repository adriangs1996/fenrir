import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

export type GitDiffWorkbenchViewMode = "stack" | "worktree";
export type GitDiffWorkbenchRenderMode = "stacked" | "split";
export type GitDiffWorkbenchLineHighlightMode = "inline" | "none";
export type GitDiffWorkbenchHunkSeparators =
  | "line-info"
  | "line-info-basic"
  | "metadata"
  | "simple";

export type GitDiffWorkbenchRepositoryState = {
  readonly mode: GitDiffWorkbenchViewMode;
  readonly selectedPath: string | null;
  readonly selectedStackIndex: number | null;
};

export type GitDiffWorkbenchPreferences = {
  readonly diffRenderMode: GitDiffWorkbenchRenderMode;
  readonly diffWordWrap: boolean;
  readonly diffIgnoreWhitespace: boolean;
  readonly diffLineNumbers: boolean;
  readonly diffLineHighlightMode: GitDiffWorkbenchLineHighlightMode;
  readonly diffHunkSeparators: GitDiffWorkbenchHunkSeparators;
  readonly stackSectionOpen: boolean;
  readonly filesSectionOpen: boolean;
  readonly sidebarWidth: number;
  readonly stackSectionHeight: number;
};

export type GitDiffWorkbenchScopeState = GitDiffWorkbenchRepositoryState & {
  readonly selectedRepositoryCwd: string | null;
  readonly repositoryStates: Record<string, GitDiffWorkbenchRepositoryState>;
  readonly preferences: GitDiffWorkbenchPreferences;
};

export type GitDiffWorkbenchPreferenceUpdater =
  | Partial<GitDiffWorkbenchPreferences>
  | ((preferences: GitDiffWorkbenchPreferences) => Partial<GitDiffWorkbenchPreferences>);

interface GitDiffWorkbenchStoreState {
  readonly scopes: Record<string, GitDiffWorkbenchScopeState>;
  readonly selectRepository: (scopeKey: string | null, cwd: string) => void;
  readonly updateRepositoryState: (
    scopeKey: string | null,
    cwd: string | null,
    patch: Partial<GitDiffWorkbenchRepositoryState>,
  ) => void;
  readonly updatePreferences: (
    scopeKey: string | null,
    updater: GitDiffWorkbenchPreferenceUpdater,
  ) => void;
}

const DEFAULT_REPOSITORY_STATE: GitDiffWorkbenchRepositoryState = {
  mode: "worktree",
  selectedPath: null,
  selectedStackIndex: null,
};

export const DEFAULT_GIT_DIFF_WORKBENCH_PREFERENCES: GitDiffWorkbenchPreferences = {
  diffRenderMode: "split",
  diffWordWrap: false,
  diffIgnoreWhitespace: false,
  diffLineNumbers: true,
  diffLineHighlightMode: "inline",
  diffHunkSeparators: "line-info",
  stackSectionOpen: true,
  filesSectionOpen: true,
  sidebarWidth: 352,
  stackSectionHeight: 520,
};

export const DEFAULT_GIT_DIFF_WORKBENCH_SCOPE_STATE: GitDiffWorkbenchScopeState = {
  ...DEFAULT_REPOSITORY_STATE,
  selectedRepositoryCwd: null,
  repositoryStates: {},
  preferences: DEFAULT_GIT_DIFF_WORKBENCH_PREFERENCES,
};

export function gitDiffWorkbenchScopeKey(input: {
  readonly environmentId: string | null;
  readonly projectId: string | null;
}): string | null {
  if (!input.environmentId || !input.projectId) return null;
  return `${input.environmentId}:${input.projectId}`;
}

export function selectGitDiffWorkbenchScopeState(
  state: Pick<GitDiffWorkbenchStoreState, "scopes">,
  scopeKey: string | null,
): GitDiffWorkbenchScopeState {
  if (!scopeKey) return DEFAULT_GIT_DIFF_WORKBENCH_SCOPE_STATE;
  return state.scopes[scopeKey] ?? DEFAULT_GIT_DIFF_WORKBENCH_SCOPE_STATE;
}

function createScopeState(): GitDiffWorkbenchScopeState {
  return {
    ...DEFAULT_REPOSITORY_STATE,
    selectedRepositoryCwd: null,
    repositoryStates: {},
    preferences: { ...DEFAULT_GIT_DIFF_WORKBENCH_PREFERENCES },
  };
}

function createGitDiffWorkbenchStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useGitDiffWorkbenchStore = create<GitDiffWorkbenchStoreState>()(
  persist(
    (set) => ({
      scopes: {},
      selectRepository: (scopeKey, cwd) => {
        if (!scopeKey) return;
        set((state) => {
          const scopeState = state.scopes[scopeKey] ?? createScopeState();
          const repositoryState = scopeState.repositoryStates[cwd] ?? DEFAULT_REPOSITORY_STATE;
          return {
            scopes: {
              ...state.scopes,
              [scopeKey]: {
                ...scopeState,
                ...repositoryState,
                selectedRepositoryCwd: cwd,
              },
            },
          };
        });
      },
      updateRepositoryState: (scopeKey, cwd, patch) => {
        if (!scopeKey || !cwd) return;
        set((state) => {
          const scopeState = state.scopes[scopeKey] ?? createScopeState();
          const currentRepositoryState =
            scopeState.repositoryStates[cwd] ??
            (scopeState.selectedRepositoryCwd === cwd
              ? {
                  mode: scopeState.mode,
                  selectedPath: scopeState.selectedPath,
                  selectedStackIndex: scopeState.selectedStackIndex,
                }
              : DEFAULT_REPOSITORY_STATE);
          const repositoryState = {
            ...currentRepositoryState,
            ...patch,
          };
          return {
            scopes: {
              ...state.scopes,
              [scopeKey]: {
                ...scopeState,
                ...repositoryState,
                selectedRepositoryCwd: cwd,
                repositoryStates: {
                  ...scopeState.repositoryStates,
                  [cwd]: repositoryState,
                },
              },
            },
          };
        });
      },
      updatePreferences: (scopeKey, updater) => {
        if (!scopeKey) return;
        set((state) => {
          const scopeState = state.scopes[scopeKey] ?? createScopeState();
          const patch = typeof updater === "function" ? updater(scopeState.preferences) : updater;
          return {
            scopes: {
              ...state.scopes,
              [scopeKey]: {
                ...scopeState,
                preferences: {
                  ...scopeState.preferences,
                  ...patch,
                },
              },
            },
          };
        });
      },
    }),
    {
      name: "fenrir:git-diff-workbench-state:v2",
      storage: createJSONStorage(createGitDiffWorkbenchStorage),
      partialize: (state) => ({
        scopes: state.scopes,
      }),
    },
  ),
);
