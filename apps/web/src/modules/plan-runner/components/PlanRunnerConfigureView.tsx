import { ArrowLeftIcon, PlayIcon, Loader2Icon, GitBranchIcon, AlertCircleIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ProjectId, ProviderKind, ModelSelection } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useSettings } from "~/hooks/useSettings";
import { useServerProviders } from "~/rpc/serverState";
import { resolveAppModelSelectionState, getCustomModelOptionsByProvider } from "~/modelSelection";
import { getProviderModels } from "~/providerModels";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
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
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  // ── Resolve projectId from store ────────────────────────────────────
  const projectId = usePlanRunnerStore((s): ProjectId | null => {
    for (const key of Object.keys(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        return (key.split(":")[0] ?? null) as ProjectId | null;
      }
    }
    for (const [pid, features] of Object.entries(s.featuresByProjectId)) {
      if (features.some((f) => f.featureName === featureName)) return pid as ProjectId;
    }
    return null;
  });

  // ── Plans from store ────────────────────────────────────────────────
  const plans = usePlanRunnerStore((s): readonly PlanFileSummary[] => {
    for (const [key, cachedPlans] of Object.entries(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        return cachedPlans;
      }
    }
    return [];
  });

  // Fetch plans if not cached
  useEffect(() => {
    if (plans.length > 0 || !rpcClient || !projectId) return;
    rpcClient.planRunner
      .getFeaturePlans({ projectId, featureName: featureName as any })
      .then((result) => setPlans(`${projectId}:${featureName}`, result.plans))
      .catch((err) => console.error("getFeaturePlans failed:", err));
  }, [plans.length, rpcClient, projectId, featureName, setPlans]);

  // ── Model selection state (local, not global) ──────────────────────
  const settings = useSettings();
  const providers = useServerProviders();

  const defaultProvider = useMemo(() => {
    try {
      return resolveAppModelSelectionState(settings, providers).provider;
    } catch {
      return "codex" as ProviderKind;
    }
  }, [settings, providers]);

  const defaultModel = useMemo(() => {
    try {
      return resolveAppModelSelectionState(settings, providers).model;
    } catch {
      return "";
    }
  }, [settings, providers]);

  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(defaultProvider);
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [hasUserSelected, setHasUserSelected] = useState(false);

  // Sync defaults only until user makes a selection
  useEffect(() => {
    if (!hasUserSelected && defaultProvider && defaultModel) {
      setSelectedProvider(defaultProvider);
      setSelectedModel(defaultModel);
    }
  }, [hasUserSelected, defaultProvider, defaultModel]);

  const modelOptionsByProvider = useMemo<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >(
    () => ({
      codex: getProviderModels(providers, "codex"),
      claudeAgent: getProviderModels(providers, "claudeAgent"),
    }),
    [providers],
  );

  const handleProviderModelChange = useCallback((provider: ProviderKind, model: string) => {
    setHasUserSelected(true);
    setSelectedProvider(provider);
    setSelectedModel(model);
  }, []);

  // ── Start run ──────────────────────────────────────────────────────
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStartRun = useCallback(async () => {
    if (!rpcClient || !projectId) return;
    setIsStarting(true);
    setStartError(null);

    try {
      const modelSelection: ModelSelection = {
        provider: selectedProvider,
        model: selectedModel,
      };
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
  }, [rpcClient, projectId, featureName, selectedProvider, selectedModel, navigate]);

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
  if (plans.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading plans...</p>
      </div>
    );
  }

  const branchName = `feature/${featureName}`;

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
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Model selection */}
        <div className="border-b px-4 py-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Model
          </h3>
          <ProviderModelPicker
            provider={selectedProvider}
            model={selectedModel}
            lockedProvider={null}
            providers={providers}
            modelOptionsByProvider={modelOptionsByProvider}
            triggerVariant="outline"
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
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleBack}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleStartRun} disabled={isStarting || !projectId}>
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
  );
});
