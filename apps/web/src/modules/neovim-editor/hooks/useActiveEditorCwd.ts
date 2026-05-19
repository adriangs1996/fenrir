import { scopeProjectRef } from "@fenrir/client-runtime";
import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import type { DraftSessionState } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import type { Thread, Project } from "~/types";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { resolveThreadRouteTarget } from "~/threadRoutes";

type EditorCwdTarget =
  | Pick<Thread, "worktreePath" | "environmentId" | "projectId">
  | Pick<DraftSessionState, "worktreePath" | "environmentId" | "projectId">;

/**
 * Pure derivation: given a thread and its project, resolve the cwd Neovim
 * should use. Prefers `thread.worktreePath`, falls back to `project.cwd`.
 */
export function resolveEditorCwd(
  thread: Pick<EditorCwdTarget, "worktreePath"> | null | undefined,
  project: Pick<Project, "cwd"> | null | undefined,
): string | null {
  if (!thread) return null;
  if (thread.worktreePath) return thread.worktreePath;
  return project?.cwd ?? null;
}

export function resolveEditorProjectRef(
  target: Pick<EditorCwdTarget, "environmentId" | "projectId"> | null | undefined,
) {
  if (!target) {
    return null;
  }

  return scopeProjectRef(target.environmentId, target.projectId);
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
  const draftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;

  const activeThread = useStore(
    useMemo(() => (state) => selectThreadByRef(state, activeThreadRef), [activeThreadRef]),
  );
  const activeDraftSession = useComposerDraftStore(
    useMemo(() => (state) => (draftId ? state.getDraftSession(draftId) : null), [draftId]),
  );
  const projectRef = useMemo(
    () => resolveEditorProjectRef(activeThread ?? activeDraftSession),
    [activeDraftSession, activeThread],
  );
  const project = useStore(
    useMemo(() => (state) => selectProjectByRef(state, projectRef), [projectRef]),
  );

  return useMemo(
    () => resolveEditorCwd(activeThread ?? activeDraftSession, project),
    [activeDraftSession, activeThread, project],
  );
}
