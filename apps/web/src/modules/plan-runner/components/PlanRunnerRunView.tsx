import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
  MinusCircleIcon,
  EyeIcon,
  SquareIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  type PlanNode as PlanNodeType,
  type FeatureState as FeatureStateType,
  PlanRunId as PlanRunIdSchema,
} from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";

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
  completed: "success",
  failed: "destructive",
};

function PlanNodeIcon({ state }: { state: PlanNodeType["state"] }) {
  switch (state) {
    case "blocked":
      return <CircleIcon className="size-4 text-muted-foreground opacity-50" />;
    case "ready":
      return <CircleIcon className="size-4 text-foreground" />;
    case "running":
      return <Loader2Icon className="size-4 animate-spin text-blue-500" />;
    case "reviewing":
      return <EyeIcon className="size-4 text-yellow-500" />;
    case "done":
      return <CheckCircleIcon className="size-4 text-green-500" />;
    case "failed":
      return <XCircleIcon className="size-4 text-red-500" />;
    case "skipped":
      return <MinusCircleIcon className="size-4 text-muted-foreground line-through" />;
    default:
      return <CircleIcon className="size-4" />;
  }
}

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

export const PlanRunnerRunView = memo(function PlanRunnerRunView({
  runId,
}: PlanRunnerRunViewProps) {
  const navigate = useNavigate();
  const run = usePlanRunnerStore((s) => s.runById[runId]);
  const upsertRun = usePlanRunnerStore((s) => s.upsertRun);

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  const brandedRunId = useMemo(() => PlanRunIdSchema.makeUnsafe(runId), [runId]);

  // Fetch run status if not in store
  useEffect(() => {
    if (run || !rpcClient) return;
    rpcClient.planRunner
      .getStatus({ runId: brandedRunId })
      .then((snapshot) => upsertRun(snapshot))
      .catch((err) => console.error("getStatus failed:", err));
  }, [run, rpcClient, brandedRunId, upsertRun]);

  const handleCancel = useCallback(() => {
    if (!rpcClient) return;
    void rpcClient.planRunner.cancel({ runId: brandedRunId });
  }, [rpcClient, brandedRunId]);

  const handleBack = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  const handleThreadClick = useCallback(
    (threadId: string | null) => {
      if (!threadId || !run) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: run.projectId, threadId },
      });
    },
    [navigate, run],
  );

  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading run...</p>
      </div>
    );
  }

  const isTerminal = run.state === "completed" || run.state === "failed";

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

        {!isTerminal && (
          <Button variant="destructive" size="sm" onClick={handleCancel}>
            <SquareIcon className="mr-1.5 size-3" />
            Cancel
          </Button>
        )}
      </div>

      {/* Phase indicator */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        {(() => {
          const isFailed = run.state === "failed";
          // When failed, no progression phase is active. Otherwise locate
          // current phase in the progression.
          const currentIdx = isFailed ? -1 : PROGRESSION_PHASES.indexOf(run.state);
          return PROGRESSION_PHASES.map((phase, i) => {
            const isActive = !isFailed && i === currentIdx;
            const isPast = !isFailed && i < currentIdx;
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
      </div>

      {/* Analyzer / Integration thread links */}
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
        {run.analyzerThreadId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleThreadClick(run.analyzerThreadId)}
          >
            Analyzer Thread
          </Button>
        )}
        {run.integrationThreadId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleThreadClick(run.integrationThreadId)}
          >
            Integration Thread
          </Button>
        )}
      </div>

      {/* Plan nodes */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-2">
          {run.plans.map((plan) => (
            <PlanNodeRow key={plan.planId} plan={plan} onThreadClick={handleThreadClick} />
          ))}
        </div>

        {/* Summary */}
        {isTerminal && run.summary && (
          <div className="mt-4 rounded-md border p-3">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Summary</h3>
            <p className="text-sm">{run.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
});

const PlanNodeRow = memo(function PlanNodeRow({
  plan,
  onThreadClick,
}: {
  plan: PlanNodeType;
  onThreadClick: (threadId: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <PlanNodeIcon state={plan.state} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{plan.filename}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{plan.state}</span>
          {plan.retriesUsed > 0 && (
            <span>
              retries: {plan.retriesUsed}/{plan.maxRetries}
            </span>
          )}
          {plan.error && <span className="text-destructive">{plan.error}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {plan.executorThreadId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => onThreadClick(plan.executorThreadId)}
          >
            Executor
          </Button>
        )}
        {plan.reviewerThreadId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => onThreadClick(plan.reviewerThreadId)}
          >
            Reviewer
          </Button>
        )}
      </div>
    </div>
  );
});
