import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_GIT_DIFF_WORKBENCH_SCOPE_STATE,
  gitDiffWorkbenchScopeKey,
  selectGitDiffWorkbenchScopeState,
  useGitDiffWorkbenchStore,
} from "./gitDiffWorkbenchStore";

describe("gitDiffWorkbenchStore", () => {
  beforeEach(() => {
    useGitDiffWorkbenchStore.persist.clearStorage();
    useGitDiffWorkbenchStore.setState({ scopes: {} });
  });

  it("builds stable scope keys for project-scoped state", () => {
    expect(
      gitDiffWorkbenchScopeKey({
        environmentId: "env-1",
        projectId: "project-1",
      }),
    ).toBe("env-1:project-1");
    expect(
      gitDiffWorkbenchScopeKey({
        environmentId: null,
        projectId: "project-1",
      }),
    ).toBeNull();
  });

  it("returns default state for missing scopes", () => {
    expect(selectGitDiffWorkbenchScopeState(useGitDiffWorkbenchStore.getState(), "missing")).toBe(
      DEFAULT_GIT_DIFF_WORKBENCH_SCOPE_STATE,
    );
  });

  it("restores repository-specific state when switching repositories", () => {
    const scopeKey = "env-1:project-1";
    const store = useGitDiffWorkbenchStore.getState();

    store.selectRepository(scopeKey, "/repo-a");
    store.updateRepositoryState(scopeKey, "/repo-a", {
      mode: "stack",
      selectedPath: "src/a.ts",
      selectedTargetKind: "staged",
      selectedStackIndex: 2,
      selectedStashRef: "stash@{1}",
    });
    store.selectRepository(scopeKey, "/repo-b");
    store.updateRepositoryState(scopeKey, "/repo-b", {
      mode: "stashes",
      selectedPath: "src/b.ts",
      selectedStashRef: "stash@{0}",
    });
    store.selectRepository(scopeKey, "/repo-a");

    const state = selectGitDiffWorkbenchScopeState(useGitDiffWorkbenchStore.getState(), scopeKey);
    expect(state.selectedRepositoryCwd).toBe("/repo-a");
    expect(state.mode).toBe("stack");
    expect(state.selectedPath).toBe("src/a.ts");
    expect(state.selectedTargetKind).toBe("staged");
    expect(state.selectedStackIndex).toBe(2);
    expect(state.selectedStashRef).toBe("stash@{1}");
    expect(state.repositoryStates["/repo-b"]?.selectedPath).toBe("src/b.ts");
    expect(state.repositoryStates["/repo-b"]?.selectedStashRef).toBe("stash@{0}");
  });

  it("updates view preferences in the scoped persisted state", () => {
    const scopeKey = "env-1:project-1";
    const store = useGitDiffWorkbenchStore.getState();

    store.updatePreferences(scopeKey, {
      diffRenderMode: "stacked",
      diffWordWrap: true,
    });
    store.updatePreferences(scopeKey, (preferences) => ({
      sidebarWidth: preferences.sidebarWidth + 24,
    }));

    const state = selectGitDiffWorkbenchScopeState(useGitDiffWorkbenchStore.getState(), scopeKey);
    expect(state.preferences.diffRenderMode).toBe("stacked");
    expect(state.preferences.diffWordWrap).toBe(true);
    expect(state.preferences.sidebarWidth).toBe(376);
  });
});
