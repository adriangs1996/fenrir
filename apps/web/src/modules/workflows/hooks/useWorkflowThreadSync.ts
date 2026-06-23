import { useEffect } from "react";
import type { ProjectId, ThreadId } from "@fenrir/contracts";

import { useWorkflowStore } from "../stores/useWorkflowStore";

export function useWorkflowThreadSync(
  projectId: ProjectId | null | undefined,
  originThreadId: ThreadId | null | undefined,
) {
  const fetchThread = useWorkflowStore((state) => state.fetchThread);

  useEffect(() => {
    if (!projectId || !originThreadId) {
      return;
    }

    void fetchThread(projectId, originThreadId).catch((error) => {
      console.error("workflows.listThread failed:", error);
    });
  }, [fetchThread, originThreadId, projectId]);
}
