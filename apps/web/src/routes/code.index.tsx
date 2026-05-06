import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ThreadId } from "@fenrir/contracts";
import { RenderSurface } from "../components/RenderSurface";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useUiStateStore } from "../uiStateStore";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

/**
 * Pick the threadId of the most recently visited thread. Used as a stand-in
 * for "currently selected project" on the standalone /code/ route, which has
 * no thread/project URL params of its own. When the user has been working in
 * a thread elsewhere, the embedded nvim opens against that thread's project
 * cwd (or worktree path) instead of the desktop process's HOME.
 */
function selectMostRecentThreadId(
  threadLastVisitedAtById: Record<string, string>,
): ThreadId | null {
  let bestId: string | null = null;
  let bestAt = "";
  for (const [threadId, visitedAt] of Object.entries(threadLastVisitedAtById)) {
    if (!visitedAt) continue;
    if (visitedAt > bestAt) {
      bestAt = visitedAt;
      bestId = threadId;
    }
  }
  return bestId ? (bestId as ThreadId) : null;
}

function CodeIndexRoute() {
  const recentThreadId = useUiStateStore((state) =>
    selectMostRecentThreadId(state.threadLastVisitedAtById),
  );
  const recentThread = useStore(
    useMemo(() => createThreadSelectorAcrossEnvironments(recentThreadId), [recentThreadId]),
  );
  const recentProject = useStore((store) =>
    recentThread
      ? selectProjectByRef(store, {
          environmentId: recentThread.environmentId,
          projectId: recentThread.projectId,
        })
      : undefined,
  );
  const cwd = recentThread?.worktreePath ?? recentProject?.cwd ?? null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <RenderSurface fps={60} style={{ flex: 1 }} cwd={cwd} />
    </div>
  );
}
