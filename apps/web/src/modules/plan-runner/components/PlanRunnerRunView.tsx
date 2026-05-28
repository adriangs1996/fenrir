import {
  AlertCircleIcon,
  ArrowLeftIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  type FeatureSummary,
  type PlanNode as PlanNodeType,
  type FeatureState as FeatureStateType,
  type PlanRunnerStepSnapshot,
  PlanRunId as PlanRunIdSchema,
} from "@fenrir/contracts";
import {
  stepLogCacheKey,
  useActiveStepTabs,
  usePlanRunnerStore,
  useStartedStepHistory,
  useStepLog,
} from "../stores/usePlanRunnerStore";
import { useStepLogFetcher } from "../hooks/useStepLogFetcher";
import { usePlanRunnerModelSelection } from "../hooks/usePlanRunnerModelSelection";
import { getFeatureRunStatus, isFeatureStartBlocked } from "./featureRunStatus";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useSettings } from "~/hooks/useSettings";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { PlanDagView, type DagPlan } from "./PlanDagView";
import { LiveStepMonitorPanel } from "./LiveStepMonitorPanel";
import { PlanRunnerModelSelectionPanel } from "./PlanRunnerModelSelectionPanel";
import { StepHistoryList } from "./StepHistoryList";
import { StepLogViewer } from "./StepLogViewer";
import { stepLabel } from "./stepLabels";

/**
 * Linear progression of feature lifecycle phases. Excludes the terminal
 * `failed` state because failure can occur mid-progression and is rendered
 * separately on the phase strip.
 */
const PROGRESSION_PHASES: FeatureStateType[] = [
  "analyzing",
  "executing",
  "integrating",
  "completed",
];

const PHASE_BADGE_VARIANT: Record<
  string,
  "info" | "warning" | "success" | "destructive" | "outline"
> = {
  analyzing: "info",
  executing: "warning",
  integrating: "warning",
  stopped: "warning",
  completed: "success",
  failed: "destructive",
};

function formatElapsed(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

interface PlanRunnerRunViewProps {
  runId: string;
}

/**
 * Selection model for the inline log viewer. The page renders one log at a
 * time, but we track the source so we know whether to highlight the live
 * panel's tab or merely the history row.
 */
type LogSelection = { kind: "live"; stepKey: string } | { kind: "history"; stepKey: string } | null;

export const PlanRunnerRunView = memo(function PlanRunnerRunView({
  runId,
}: PlanRunnerRunViewProps) {
  const navigate = useNavigate();
  const run = usePlanRunnerStore((s) => s.runById[runId]);
  const upsertRun = usePlanRunnerStore((s) => s.upsertRun);
  const timestampFormat = useSettings((s) => s.timestampFormat);
  const {
    providers,
    selectedProvider,
    selectedModel,
    modelSelection,
    modelOptionsByProvider,
    handleProviderModelChange,
  } = usePlanRunnerModelSelection();

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  const brandedRunId = useMemo(() => PlanRunIdSchema.make(runId), [runId]);

  // Lifecycle of the cold-fetch path. `notFound` short-circuits the loader
  // so stale/replaced run ids resolve to a generic not-found state instead
  // of spinning forever or being redirected somewhere misleading.
  const [notFound, setNotFound] = useState(false);

  // Reset not-found whenever we point at a new run id.
  useEffect(() => {
    setNotFound(false);
  }, [runId]);

  // Fetch run status if not in store
  useEffect(() => {
    if (run || !rpcClient) return;
    let cancelled = false;
    rpcClient.planRunner
      .getStatus({ runId: brandedRunId })
      .then((snapshot) => {
        if (!cancelled) upsertRun(snapshot);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isPlanRunnerNotFoundError(err)) {
          setNotFound(true);
          return;
        }
        console.error("getStatus failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [run, rpcClient, brandedRunId, upsertRun]);

  const handleCancel = useCallback(() => {
    if (!rpcClient) return;
    void rpcClient.planRunner.cancel({ runId: brandedRunId });
  }, [rpcClient, brandedRunId]);

  const [runAction, setRunAction] = useState<"stop" | "resume" | null>(null);
  const [runActionError, setRunActionError] = useState<string | null>(null);

  const handleStop = useCallback(async () => {
    if (!rpcClient) return;
    setRunAction("stop");
    setRunActionError(null);
    try {
      await rpcClient.planRunner.stop({ runId: brandedRunId });
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Failed to stop run");
      setRunAction(null);
    }
  }, [rpcClient, brandedRunId]);

  const handleResume = useCallback(async () => {
    if (!rpcClient) return;
    setRunAction("resume");
    setRunActionError(null);
    try {
      await rpcClient.planRunner.resume({ runId: brandedRunId });
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Failed to resume run");
      setRunAction(null);
    }
  }, [rpcClient, brandedRunId]);

  const featureSummary = usePlanRunnerStore((s): FeatureSummary | null => {
    if (!run) return null;
    const features = s.featuresByProjectId[run.projectId];
    if (!features) return null;
    return features.find((feature) => feature.featureName === run.featureName) ?? null;
  });
  const featureStatus = featureSummary ? getFeatureRunStatus(featureSummary) : "notRun";
  const startBlocked = featureSummary ? isFeatureStartBlocked(featureSummary) : false;
  const blockedReason =
    featureStatus === "recovering"
      ? "Recovery in progress"
      : featureStatus === "stopped"
        ? "Run is stopped. Resume it to continue."
        : "Run already in progress";

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStartRun = useCallback(async () => {
    if (!rpcClient || !run || startBlocked) return;
    setIsStarting(true);
    setStartError(null);

    try {
      const result = await rpcClient.planRunner.start({
        projectId: run.projectId,
        featureName: run.featureName,
        modelSelection,
      });
      void navigate({
        to: "/plan-runner/$runId",
        params: { runId: result.runId },
      });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start run");
      setIsStarting(false);
    }
  }, [rpcClient, run, startBlocked, modelSelection, navigate]);

  const hasCompletedPlans = useMemo(
    () => run?.plans.some((p) => p.state === "done") ?? false,
    [run],
  );

  const canRerunFromFailure = run?.state === "failed" && hasCompletedPlans;

  const handleRerunFromFailure = useCallback(async () => {
    if (!rpcClient || !run || !canRerunFromFailure || startBlocked) return;
    setIsStarting(true);
    setStartError(null);

    try {
      const result = await rpcClient.planRunner.rerunFromFailure({
        projectId: run.projectId,
        featureName: run.featureName,
        failedRunId: brandedRunId,
        modelSelection,
      });
      void navigate({
        to: "/plan-runner/$runId",
        params: { runId: result.runId },
      });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to re-run from failure");
      setIsStarting(false);
    }
  }, [rpcClient, run, canRerunFromFailure, startBlocked, brandedRunId, modelSelection, navigate]);

  const handleBack = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  // ── Step / log selection state ─────────────────────────────────────────────

  const activeSteps = useActiveStepTabs(runId);
  const startedSteps = useStartedStepHistory(runId);

  const [selection, setSelection] = useState<LogSelection>(null);

  // Reset selection when the runId itself changes — we never want a stale
  // stepKey from a previous run sticking around.
  useEffect(() => {
    setSelection(null);
  }, [runId]);

  useEffect(() => {
    setStartError(null);
    setIsStarting(false);
    setRunAction(null);
    setRunActionError(null);
  }, [runId]);

  useEffect(() => {
    if (
      run?.state === "stopped" ||
      run?.state === "executing" ||
      run?.state === "analyzing" ||
      run?.state === "integrating"
    ) {
      setRunAction(null);
    }
  }, [run?.state]);

  // Live-tab stickiness:
  //   • When the panel transitions from absent → present, auto-select the
  //     first running step.
  //   • Keep the user's tab choice while it remains active.
  //   • When the selected live step disappears, fall through to another live
  //     tab if any remain, otherwise null (the user can reopen via history).
  const prevActiveLenRef = useRef(0);
  useEffect(() => {
    const prevLen = prevActiveLenRef.current;
    prevActiveLenRef.current = activeSteps.length;

    setSelection((current) => {
      if (current?.kind === "live") {
        const stillActive = activeSteps.some((s) => s.stepKey === current.stepKey);
        if (stillActive) return current;
        if (activeSteps.length > 0 && activeSteps[0]) {
          return { kind: "live", stepKey: activeSteps[0].stepKey };
        }
        return null;
      }
      // Panel just appeared — auto-pick first running step. This intentionally
      // overrides any prior history selection so live work takes focus when it
      // kicks off, matching "auto-select the first running step when the panel
      // first appears".
      if (prevLen === 0 && activeSteps.length > 0 && activeSteps[0]) {
        return { kind: "live", stepKey: activeSteps[0].stepKey };
      }
      return current;
    });
  }, [activeSteps]);

  // Fetch the log for whatever step is currently selected (live or history).
  // The fetcher dedupes per (runId, stepKey) so reselecting is free.
  const selectedStepKey = selection?.stepKey ?? null;
  useStepLogFetcher(rpcClient, runId, selectedStepKey);

  // Resolve the selected step snapshot for the inline viewer below history.
  // Prefer the started-history list because it includes finished steps; the
  // live tabs are always a subset of it.
  const selectedStep: PlanRunnerStepSnapshot | null = useMemo(() => {
    if (!selection) return null;
    return startedSteps.find((s) => s.stepKey === selection.stepKey) ?? null;
  }, [selection, startedSteps]);

  // Log entries cached for the currently-selected step (empty array when
  // nothing is selected). The selector falls back to a stable empty tuple, so
  // this is safe even when the cache is missing.
  const selectedEntries = useStepLog(runId, selection?.stepKey ?? "");

  // Whether we're still waiting on the first backfill response for the
  // selected step. Used to show a spinner while the cache is empty.
  const stepLogsByKey = usePlanRunnerStore((s) => s.stepLogsByKey);
  const isSelectedLogLoading = useMemo(() => {
    if (!selection) return false;
    const key = stepLogCacheKey(runId, selection.stepKey);
    return !Object.prototype.hasOwnProperty.call(stepLogsByKey, key);
  }, [selection, runId, stepLogsByKey]);

  const handleSelectLive = useCallback((stepKey: string) => {
    setSelection({ kind: "live", stepKey });
  }, []);

  const handleSelectHistory = useCallback(
    (stepKey: string) => {
      // If the chosen history row is still active, surface it as a live tab
      // so the panel highlights it. Otherwise treat it as a postmortem.
      const isActive = activeSteps.some((s) => s.stepKey === stepKey);
      setSelection({ kind: isActive ? "live" : "history", stepKey });
    },
    [activeSteps],
  );

  // Adapt PlanNode[] → DagPlan[] for the shared DAG component
  const dagPlans: DagPlan[] = useMemo(() => {
    if (!run) return [];
    return run.plans.map((p: PlanNodeType) => ({
      planId: p.planId,
      filename: p.filename,
      dependsOn: p.dependsOn,
      state: p.state,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      retriesUsed: p.retriesUsed,
      maxRetries: p.maxRetries,
      error: p.error,
    }));
  }, [run]);

  // Graph clicks switch the inline log viewer instead of navigating away. A
  // node without a started step (e.g. blocked plan) is a no-op.
  const handlePlanClick = useCallback(
    (plan: DagPlan) => {
      const step = startedSteps.find((s) => s.kind === "plan" && s.planId === plan.planId);
      if (!step) return;
      handleSelectHistory(step.stepKey);
    },
    [startedSteps, handleSelectHistory],
  );

  if (!run) {
    if (notFound) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium">Run not found</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            This run id is no longer available. It may have been replaced by a newer run for the
            same feature, or removed.
          </p>
          <Button variant="outline" size="sm" onClick={handleBack}>
            Back to home
          </Button>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading run...</p>
      </div>
    );
  }

  const isTerminal = run.state === "completed" || run.state === "failed";
  const showLivePanel = run.state !== "stopped" && activeSteps.length > 0;
  const cwd = run.worktreePath ?? undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{run.featureName}</h2>
            <Badge variant={PHASE_BADGE_VARIANT[run.state] ?? "outline"} size="sm">
              {run.state}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Branch: {run.branch}</span>
            <span>·</span>
            <span>{formatElapsed(run.startedAt, run.completedAt)}</span>
          </div>
        </div>

        {!isTerminal && run.state !== "stopped" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={runAction === "stop"}
            >
              {runAction === "stop" ? (
                <Loader2Icon className="mr-1.5 size-3 animate-spin" />
              ) : (
                <SquareIcon className="mr-1.5 size-3" />
              )}
              Stop
            </Button>
            <Button variant="destructive" size="sm" onClick={handleCancel}>
              <SquareIcon className="mr-1.5 size-3" />
              Cancel
            </Button>
          </div>
        )}
        {run.state === "stopped" && (
          <Button size="sm" onClick={handleResume} disabled={runAction === "resume"}>
            {runAction === "resume" ? (
              <Loader2Icon className="mr-1.5 size-3 animate-spin" />
            ) : (
              <PlayIcon className="mr-1.5 size-3 fill-current" />
            )}
            Resume
          </Button>
        )}
      </div>

      {runActionError && (
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {runActionError}
          </div>
        </div>
      )}

      {isTerminal && (
        <div className="border-b px-4 py-4">
          {startError && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {startError}
            </div>
          )}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <PlanRunnerModelSelectionPanel
                provider={selectedProvider}
                model={selectedModel}
                providers={providers}
                modelOptionsByProvider={modelOptionsByProvider}
                onProviderModelChange={handleProviderModelChange}
              />
            </div>
            <div className="flex items-center gap-2">
              {canRerunFromFailure && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRerunFromFailure}
                  disabled={isStarting || startBlocked}
                >
                  {isStarting ? (
                    <Loader2Icon className="mr-1.5 size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="mr-1.5 size-3" />
                  )}
                  Re-run failed
                </Button>
              )}
              <Button size="sm" onClick={handleStartRun} disabled={isStarting || startBlocked}>
                {isStarting ? (
                  <>
                    <Loader2Icon className="mr-1.5 size-3 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Start Run"
                )}
              </Button>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {startBlocked ? blockedReason : null}
          </div>
        </div>
      )}

      {/* Phase indicator */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        {(() => {
          const isFailed = run.state === "failed";
          const isStopped = run.state === "stopped";
          const currentIdx = isFailed || isStopped ? -1 : PROGRESSION_PHASES.indexOf(run.state);
          return PROGRESSION_PHASES.map((phase, i) => {
            const isActive = !isFailed && !isStopped && i === currentIdx;
            const isPast = !isFailed && !isStopped && i < currentIdx;
            return (
              <div key={phase} className="flex items-center gap-1">
                {i > 0 && (
                  <div className={`h-px w-4 ${isPast || isActive ? "bg-primary" : "bg-border"}`} />
                )}
                <Badge
                  variant={
                    isActive
                      ? (PHASE_BADGE_VARIANT[phase] ?? "outline")
                      : isPast
                        ? "success"
                        : "outline"
                  }
                  size="sm"
                >
                  {phase}
                </Badge>
              </div>
            );
          });
        })()}
        {run.state === "failed" && (
          <>
            <div className="h-px w-4 bg-destructive" />
            <Badge variant="destructive" size="sm">
              failed
            </Badge>
          </>
        )}
        {run.state === "stopped" && (
          <>
            <div className="h-px w-4 bg-warning" />
            <Badge variant="warning" size="sm">
              stopped
            </Badge>
          </>
        )}
      </div>

      {/* Main scroll area: graph → live tabs → log viewer → history → summary */}
      <div className="flex-1 overflow-y-auto">
        {/* DAG visualization */}
        <div className="px-4 pt-2">
          <PlanDagView
            plans={dagPlans}
            maxConcurrency={run.maxConcurrency}
            onPlanClick={handlePlanClick}
          />
        </div>

        {/* Live monitor tab strip — only mounted when there are active steps. */}
        {showLivePanel && (
          <div className="mt-2">
            <LiveStepMonitorPanel
              activeSteps={activeSteps}
              selectedStepKey={selection?.kind === "live" ? selection.stepKey : null}
              onSelect={handleSelectLive}
            />
          </div>
        )}

        {/* Inline log viewer — single instance for either source. */}
        {selectedStep && (
          <div className="px-4 pt-3">
            <div className="h-96 min-h-0">
              <StepLogViewer
                entries={selectedEntries}
                timestampFormat={timestampFormat}
                cwd={cwd}
                loading={isSelectedLogLoading}
                emptyHint={
                  selection?.kind === "live"
                    ? "Waiting for first log entry…"
                    : "No entries recorded for this step."
                }
                title={
                  <>
                    <span className="truncate font-medium">{stepLabel(selectedStep)}</span>
                    <Badge
                      variant={
                        selectedStep.state === "failed"
                          ? "destructive"
                          : selectedStep.state === "done"
                            ? "success"
                            : selection?.kind === "live"
                              ? "info"
                              : "outline"
                      }
                      size="sm"
                      className="px-1.5 font-normal lowercase"
                    >
                      {selectedStep.state}
                    </Badge>
                    {selection?.kind === "history" && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        postmortem
                      </span>
                    )}
                  </>
                }
              />
            </div>
          </div>
        )}

        {/* Unified started-step history */}
        <div className="mt-3 border-t border-border/60">
          <StepHistoryList
            steps={startedSteps}
            selectedStepKey={selection?.stepKey ?? null}
            onSelect={handleSelectHistory}
          />
        </div>

        {/* Summary */}
        {isTerminal && run.summary && (
          <div className="mx-4 my-3 rounded-md border p-3">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Summary</h3>
            <p className="text-sm">{run.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detect a `PlanRunnerNotFoundError` from the wire by its `_tag`. Effect's
 * `TaggedErrorClass` decodes/encodes errors with a stable `_tag` literal,
 * which survives the RPC boundary on both success and failure channels.
 */
function isPlanRunnerNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "_tag" in err &&
    (err as { _tag: unknown })._tag === "PlanRunnerNotFoundError"
  );
}
