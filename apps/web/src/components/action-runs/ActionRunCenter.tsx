import {
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
} from "@fenrir/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  Loader2Icon,
  PlayIcon,
  SquareTerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { readEnvironmentApi } from "~/environmentApi";
import {
  actionRunElapsedLabel,
  actionRunStatusLabel,
  countActiveActionRuns,
  countFailedActionRuns,
  selectActionRunsForThread,
  stripActionRunControlSequences,
  useActionRunStore,
  type ActionRun,
  type ActionRunStatus,
} from "~/modules/action-runs";
import { TerminalViewport } from "~/modules/terminal";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

interface ActionRunCenterProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  keybindings: ResolvedKeybindingsConfig;
  mode?: "inline" | "sheet";
  onClose: () => void;
  onRetry: (run: ActionRun) => void;
}

const STATUS_CLASS: Record<ActionRunStatus, string> = {
  "needs-input": "border-amber-500/35 bg-amber-500/10 text-amber-300",
  starting: "border-sky-500/35 bg-sky-500/10 text-sky-300",
  running: "border-sky-500/35 bg-sky-500/10 text-sky-300",
  succeeded: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  failed: "border-red-500/35 bg-red-500/10 text-red-300",
  cancelled: "border-border bg-muted/30 text-muted-foreground",
};
const ACTION_RUN_OBSERVER_COLS = 120;
const ACTION_RUN_OBSERVER_ROWS = 30;

function statusIcon(status: ActionRunStatus) {
  if (status === "running" || status === "starting") {
    return <Loader2Icon className="size-3.5 animate-spin" />;
  }
  if (status === "succeeded") return <CircleCheckIcon className="size-3.5" />;
  if (status === "failed") return <CircleAlertIcon className="size-3.5" />;
  if (status === "cancelled") return <XIcon className="size-3.5" />;
  return <CircleAlertIcon className="size-3.5" />;
}

function actionRunSortLabel(run: ActionRun): string {
  if (run.status === "needs-input") return "Waiting for input";
  if (run.status === "starting") return "Starting tmux session";
  if (run.status === "running") return `Running for ${actionRunElapsedLabel(run)}`;
  if (run.status === "succeeded") return `Passed in ${actionRunElapsedLabel(run)}`;
  if (run.status === "failed") return `Failed in ${actionRunElapsedLabel(run)}`;
  return `Cancelled after ${actionRunElapsedLabel(run)}`;
}

function actionRunCopyOutput(run: ActionRun): string {
  return stripActionRunControlSequences(run.outputTail)
    .split(/\r?\n/)
    .filter((line) => !line.includes("__FENRIR_ACTION_DONE__"))
    .join("\n")
    .trim();
}

function canRetryActionRun(run: ActionRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
}

export const ActionRunCenter = memo(function ActionRunCenter({
  threadRef,
  threadId,
  keybindings,
  mode = "inline",
  onClose,
  onRetry,
}: ActionRunCenterProps) {
  const runs = useActionRunStore(
    useShallow((state) => selectActionRunsForThread(state, threadRef)),
  );
  const clearCompletedForThread = useActionRunStore((state) => state.clearCompletedForThread);
  const removeActionRun = useActionRunStore((state) => state.removeActionRun);
  const requestCancel = useActionRunStore((state) => state.requestCancel);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const previousSelectedRunRef = useRef<ActionRun | null>(null);
  const activeCount = useMemo(() => countActiveActionRuns(runs), [runs]);
  const failedCount = useMemo(() => countFailedActionRuns(runs), [runs]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs, selectedRunId]);

  useEffect(() => {
    const previousRun = previousSelectedRunRef.current;
    previousSelectedRunRef.current = selectedRun;
    if (!previousRun || previousRun.id === selectedRun?.id) return;
    if (previousRun.status !== "starting" && previousRun.status !== "running") return;

    const api = readEnvironmentApi(threadRef.environmentId);
    if (!api) return;

    const timeoutId = window.setTimeout(() => {
      void api.terminal.attachTmux({
        projectId: previousRun.tmuxProjectId,
        cwd: previousRun.cwd,
        cols: ACTION_RUN_OBSERVER_COLS,
        rows: ACTION_RUN_OBSERVER_ROWS,
      });
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedRun, threadRef.environmentId]);

  const handleCancel = useCallback(
    async (run: ActionRun) => {
      requestCancel(run.id);
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) return;
      try {
        await api.terminal.writeTmux({ projectId: run.tmuxProjectId, data: "\u0003" });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not cancel action",
          description: error instanceof Error ? error.message : "Terminal write failed.",
        });
      }
    },
    [requestCancel, threadRef.environmentId],
  );

  const handleCopyOutput = useCallback(async (run: ActionRun) => {
    const output = actionRunCopyOutput(run);
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      toastManager.add({ type: "success", title: "Copied action output" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy output",
        description: error instanceof Error ? error.message : "Clipboard unavailable.",
      });
    }
  }, []);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col bg-background",
        mode === "inline"
          ? "w-[min(520px,34vw)] min-w-[420px] border-l border-border"
          : "h-full w-full",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-foreground">Action Center</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {activeCount} active, {failedCount} failed, {runs.length} total
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => clearCompletedForThread(threadRef)}
          >
            Clear done
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close">
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground/70">
          Run a project or global action to see live status, output, and receipts here.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,42%)_minmax(320px,58%)]">
          <div className="min-h-0 overflow-y-auto p-2">
            <div className="space-y-2">
              {runs.map((run) => {
                const selected = selectedRun?.id === run.id;
                return (
                  <button
                    key={run.id}
                    type="button"
                    className={`w-full rounded-lg border p-2 text-left transition-colors ${
                      selected
                        ? "border-primary/45 bg-card"
                        : "border-border/70 bg-card/45 hover:border-border hover:bg-card/80"
                    }`}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-1 ${STATUS_CLASS[run.status]}`}
                      >
                        {statusIcon(run.status)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {run.scriptName}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {actionRunSortLabel(run)}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/65">
                          {run.command}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 border-t border-border bg-card/35">
            {selectedRun ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-border px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-1 text-[10px] ${STATUS_CLASS[selectedRun.status]}`}
                        >
                          {statusIcon(selectedRun.status)}
                          {actionRunStatusLabel(selectedRun.status)}
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/65">
                        {selectedRun.tmuxProjectId}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => handleCopyOutput(selectedRun)}
                        aria-label="Copy action output"
                        disabled={actionRunCopyOutput(selectedRun).length === 0}
                      >
                        <CopyIcon className="size-3.5" />
                      </Button>
                      {canRetryActionRun(selectedRun) ? (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => onRetry(selectedRun)}
                          aria-label="Retry action"
                        >
                          <PlayIcon className="size-3.5" />
                        </Button>
                      ) : null}
                      {(selectedRun.status === "running" || selectedRun.status === "starting") && (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleCancel(selectedRun)}
                          aria-label="Cancel action"
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => removeActionRun(selectedRun.id)}
                        aria-label="Remove action run"
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div data-xterm-theme-surface className="min-h-0 flex-1 bg-background p-1">
                  <TerminalViewport
                    mode="tmux"
                    threadRef={threadRef}
                    threadId={threadId}
                    terminalId={`action-${selectedRun.id}`}
                    terminalLabel={selectedRun.scriptName}
                    cwd={selectedRun.cwd}
                    projectId={selectedRun.tmuxProjectId}
                    onSessionExited={() => undefined}
                    focusRequestId={0}
                    autoFocus={false}
                    resizeEpoch={0}
                    drawerHeight={260}
                    keybindings={keybindings}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                <SquareTerminalIcon className="size-3.5" />
                Select a run to inspect terminal output.
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
});
