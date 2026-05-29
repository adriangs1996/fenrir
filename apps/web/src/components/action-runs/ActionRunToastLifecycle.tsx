import { useEffect } from "react";

import { actionRunElapsedLabel, useActionRunStore, type ActionRun } from "~/modules/action-runs";
import { toastManager } from "../ui/toast";
import { closeActionRunLoadingToast } from "./actionRunToastRegistry";

function isTerminalActionRun(run: ActionRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
}

function actionRunCompletionToast(run: ActionRun): Parameters<typeof toastManager.add>[0] {
  const threadRef = { environmentId: run.environmentId, threadId: run.threadId };
  if (run.status === "succeeded") {
    return {
      type: "success",
      title: `"${run.scriptName}" passed`,
      description: `Finished in ${actionRunElapsedLabel(run)}.`,
      data: { threadRef, dismissAfterVisibleMs: 4500 },
    };
  }
  if (run.status === "cancelled") {
    return {
      type: "warning",
      title: `"${run.scriptName}" cancelled`,
      description: `Stopped after ${actionRunElapsedLabel(run)}.`,
      data: { threadRef, dismissAfterVisibleMs: 5500 },
    };
  }
  const exitLabel = typeof run.exitCode === "number" ? ` with exit ${run.exitCode}` : "";
  return {
    type: "error",
    title: `"${run.scriptName}" failed`,
    description: `Failed${exitLabel} after ${actionRunElapsedLabel(run)}.`,
    data: { threadRef, dismissAfterVisibleMs: 7000 },
  };
}

export function ActionRunToastLifecycle() {
  useEffect(() => {
    return useActionRunStore.subscribe((state, previousState) => {
      for (const run of Object.values(state.runsById)) {
        if (!isTerminalActionRun(run)) continue;
        const previousRun = previousState.runsById[run.id];
        if (previousRun && isTerminalActionRun(previousRun)) continue;

        closeActionRunLoadingToast(run.id);
        toastManager.add(actionRunCompletionToast(run));
      }

      for (const runId of Object.keys(previousState.runsById)) {
        if (state.runsById[runId]) continue;
        closeActionRunLoadingToast(runId);
      }
    });
  }, []);

  return null;
}
