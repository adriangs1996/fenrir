import { EnvironmentId, ProjectId } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";
import { resolveEditorCwd, resolveEditorProjectRef } from "../useActiveEditorCwd";

const ENV_ID = EnvironmentId.make("env-1");
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(worktreePath: string | null) {
  return { worktreePath, environmentId: ENV_ID, projectId: PROJECT_ID };
}

function makeDraftSession(worktreePath: string | null) {
  return { worktreePath };
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

  it("supports draft sessions the same way as server threads", () => {
    expect(resolveEditorCwd(makeDraftSession("/worktrees/draft"), makeProject("/repo"))).toBe(
      "/worktrees/draft",
    );
    expect(resolveEditorCwd(makeDraftSession(null), makeProject("/repo"))).toBe("/repo");
  });
});

describe("resolveEditorProjectRef", () => {
  it("returns null when target is null", () => {
    expect(resolveEditorProjectRef(null)).toBeNull();
  });

  it("returns the scoped project ref for server threads", () => {
    expect(resolveEditorProjectRef(makeThread(null))).toEqual({
      environmentId: ENV_ID,
      projectId: PROJECT_ID,
    });
  });

  it("returns the scoped project ref for draft sessions", () => {
    expect(
      resolveEditorProjectRef({
        environmentId: ENV_ID,
        projectId: PROJECT_ID,
      }),
    ).toEqual({
      environmentId: ENV_ID,
      projectId: PROJECT_ID,
    });
  });
});
