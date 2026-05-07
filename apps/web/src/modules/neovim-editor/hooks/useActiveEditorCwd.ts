import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import type { Thread, Project } from "~/types";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { resolveThreadRouteTarget } from "~/threadRoutes";

/**
 * Pure derivation: given a thread and its project, resolve the cwd Neovim
 * should use. Prefers `thread.worktreePath`, falls back to `project.cwd`.
 */
export function resolveEditorCwd(
  thread: Pick<Thread, "worktreePath" | "environmentId" | "projectId"> | null | undefined,
  project: Pick<Project, "cwd"> | null | undefined,
): string | null {
  if (!thread) return null;
  if (thread.worktreePath) return thread.worktreePath;
  return project?.cwd ?? null;
}

/**
 * Resolve the cwd the embedded Neovim should be rooted at, derived from the
 * currently active thread. Falls back to the thread's project cwd when no
 * worktree is set. Returns null when there is no active thread.
 */
export function useActiveEditorCwd(): string | null {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });

  const activeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;

  const cwd = useStore((state) => {
    if (!activeThreadRef) return null;
    const thread = selectThreadByRef(state, activeThreadRef);
    if (!thread) return null;
    const project = selectProjectByRef(state, {
      environmentId: thread.environmentId,
      projectId: thread.projectId,
    });
    return resolveEditorCwd(thread, project);
  });

  return useMemo(() => cwd ?? null, [cwd]);
}
