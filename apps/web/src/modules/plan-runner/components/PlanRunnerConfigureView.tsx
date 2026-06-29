import {
  ArrowLeftIcon,
  PlayIcon,
  Loader2Icon,
  GitBranchIcon,
  AlertCircleIcon,
  ActivityIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { FeatureSummary } from "@fenrir/contracts";
import { selectFeaturePlans, usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { useFeatureProjectId } from "../hooks/useFeatureProjectId";
import { usePlanRunnerModelSelection } from "../hooks/usePlanRunnerModelSelection";
import { getFeatureRunStatus, isFeatureStartBlocked } from "./featureRunStatus";
import { PlanRunnerModelSelectionPanel } from "./PlanRunnerModelSelectionPanel";
import { usePrimaryEnvironmentClient } from "~/environments/runtime";
import { Button } from "~/components/ui/button";
import { PlanDagView, type DagPlan } from "./PlanDagView";

type PlanFileSummary = {
  planId: string;
  filename: string;
  dependsOn: readonly string[];
  maxRetries: number;
  content: string;
};

interface PlanRunnerConfigureViewProps {
  featureName: string;
}

export const PlanRunnerConfigureView = memo(function PlanRunnerConfigureView({
  featureName,
}: PlanRunnerConfigureViewProps) {
  const navigate = useNavigate();
  const setPlans = usePlanRunnerStore((s) => s.setPlans);

  // ── RPC client ──────────────────────────────────────────────────────
  const rpcClient = usePrimaryEnvironmentClient();

  // ── Resolve projectId from store ────────────────────────────────────
  const projectId = useFeatureProjectId(featureName);
  const featurePlansKey = projectId ? `${projectId}:${featureName}` : null;

  // ── Plans from store ────────────────────────────────────────────────
  const plans = usePlanRunnerStore((s): readonly PlanFileSummary[] =>
    selectFeaturePlans(s.plansByFeatureKey, featurePlansKey),
  );
  const [plansLoadState, setPlansLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPlansLoadState("idle");
    setPlansLoadError(null);
  }, [featurePlansKey]);

  // Fetch plans if not cached. Configure/preview always reads live `.plans/`
  // files so the UI reflects in-flight edits; only the run detail page uses
  // a frozen run snapshot.
  useEffect(() => {
    if (plans.length > 0) {
      setPlansLoadState("ready");
      return;
    }
    if (!rpcClient || !projectId || plansLoadState !== "idle") return;
    setPlansLoadState("loading");
    rpcClient.planRunner
      .getFeaturePlans({ projectId, featureName: featureName as any })
      .then((result) => {
        setPlans(`${projectId}:${featureName}`, result.plans);
        setPlansLoadState("ready");
      })
      .catch((err) => {
        console.error("getFeaturePlans failed:", err);
        setPlansLoadError(err instanceof Error ? err.message : "Failed to load plans");
        setPlansLoadState("error");
      });
  }, [plans.length, plansLoadState, rpcClient, projectId, featureName, setPlans]);

  // ── Feature summary (for last-run navigation + start gating) ───────
  const featureSummary = usePlanRunnerStore((s): FeatureSummary | null => {
    if (!projectId) return null;
    const features = s.featuresByProjectId[projectId];
    if (!features) return null;
    return features.find((f) => f.featureName === featureName) ?? null;
  });

  const featureStatus = useMemo(
    () => (featureSummary ? getFeatureRunStatus(featureSummary) : "notRun"),
    [featureSummary],
  );
  const startBlocked = featureSummary ? isFeatureStartBlocked(featureSummary) : false;
  const blockedReason =
    featureStatus === "recovering"
      ? "Recovery in progress"
      : featureStatus === "stopped"
        ? "Run is stopped. Resume it from the run view."
        : "Run already in progress";

  const handleViewCurrentRun = useCallback(() => {
    if (!featureSummary?.activeRunId) return;
    void navigate({
      to: "/plan-runner/$runId",
      params: { runId: featureSummary.activeRunId },
    });
  }, [navigate, featureSummary?.activeRunId]);

  useEffect(() => {
    if (!featureSummary?.lastRunId) return;
    void navigate({
      to: "/plan-runner/$runId",
      params: { runId: featureSummary.lastRunId },
      replace: true,
    });
  }, [navigate, featureSummary?.lastRunId]);

  const {
    providers,
    selectedProvider,
    selectedModel,
    modelSelection,
    modelOptionsByProvider,
    handleProviderModelChange,
  } = usePlanRunnerModelSelection();

  // ── Start run ──────────────────────────────────────────────────────
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStartRun = useCallback(async () => {
    if (!rpcClient || !projectId || startBlocked) return;
    setIsStarting(true);
    setStartError(null);

    try {
      const result = await rpcClient.planRunner.start({
        projectId,
        featureName: featureName as any,
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
  }, [rpcClient, projectId, featureName, modelSelection, navigate, startBlocked]);

  const handleBack = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  // Adapt PlanFileSummary[] → DagPlan[] for shared DAG component
  const dagPlans: DagPlan[] = useMemo(
    () =>
      plans.map((p) => ({
        planId: p.planId,
        filename: p.filename,
        dependsOn: p.dependsOn,
      })),
    [plans],
  );

  const handleDagPlanClick = useCallback(
    (plan: DagPlan) => {
      void navigate({
        to: "/plan-runner/$featureName/$planId",
        params: { featureName, planId: plan.planId },
      });
    },
    [navigate, featureName],
  );

  // ── Loading state ──────────────────────────────────────────────────
  if (!projectId || plansLoadState === "idle" || plansLoadState === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading plans...</p>
      </div>
    );
  }

  if (plansLoadState === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Could not load plans</p>
        <p className="text-xs text-muted-foreground">
          {plansLoadError ?? "The plan files could not be loaded."}
        </p>
      </div>
    );
  }

  const branchName = `feature/${featureName}`;
  const showCurrentRunButton = startBlocked && featureSummary?.activeRunId != null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Configure Run: {featureName}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranchIcon className="size-3" />
            <span>{branchName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showCurrentRunButton && (
            <Button variant="outline" size="sm" onClick={handleViewCurrentRun}>
              <ActivityIcon className="mr-1.5 size-3" />
              View current run
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Model selection */}
        <div className="border-b px-4 py-4">
          <PlanRunnerModelSelectionPanel
            provider={selectedProvider}
            model={selectedModel}
            providers={providers}
            modelOptionsByProvider={modelOptionsByProvider}
            onProviderModelChange={handleProviderModelChange}
          />
        </div>

        {/* Execution DAG */}
        <div className="px-4 py-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Execution graph ({plans.length} plans)
          </h3>
          <PlanDagView plans={dagPlans} onPlanClick={handleDagPlanClick} />
        </div>
      </div>

      {/* Footer with start button */}
      <div className="border-t px-4 py-3">
        {startError && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {startError}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{startBlocked ? blockedReason : null}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBack}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleStartRun}
              disabled={isStarting || plans.length === 0 || startBlocked}
              title={
                startBlocked ? blockedReason : plans.length === 0 ? "No plans available" : undefined
              }
            >
              {isStarting ? (
                <>
                  <Loader2Icon className="mr-1.5 size-3 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon className="mr-1.5 size-3" />
                  Start Run
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});
