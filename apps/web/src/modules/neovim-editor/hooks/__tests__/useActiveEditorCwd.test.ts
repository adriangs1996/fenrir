import { EnvironmentId, ProjectId } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";
import { resolveEditorCwd } from "../useActiveEditorCwd";

const ENV_ID = EnvironmentId.makeUnsafe("env-1");
const PROJECT_ID = ProjectId.makeUnsafe("project-1");

function makeThread(worktreePath: string | null) {
  return { worktreePath, environmentId: ENV_ID, projectId: PROJECT_ID };
}

function makeProject(cwd: string) {
  return { cwd };
}

describe("resolveEditorCwd", () => {
  it("returns null when thread is null", () => {
    expect(resolveEditorCwd(null, makeProject("/repo"))).toBeNull();
  });

  it("returns null when thread is undefined", () => {
    expect(resolveEditorCwd(undefined, makeProject("/repo"))).toBeNull();
  });

  it("returns worktreePath when set", () => {
    expect(resolveEditorCwd(makeThread("/worktrees/feature-a"), makeProject("/repo"))).toBe(
      "/worktrees/feature-a",
    );
  });

  it("falls back to project cwd when worktreePath is null", () => {
    expect(resolveEditorCwd(makeThread(null), makeProject("/repo"))).toBe("/repo");
  });

  it("returns null when worktree absent and project is null", () => {
    expect(resolveEditorCwd(makeThread(null), null)).toBeNull();
  });

  it("returns null when worktree absent and project is undefined", () => {
    expect(resolveEditorCwd(makeThread(null), undefined)).toBeNull();
  });

  it("prefers worktreePath over project cwd", () => {
    expect(resolveEditorCwd(makeThread("/worktrees/feat"), makeProject("/repo"))).toBe(
      "/worktrees/feat",
    );
  });
});
