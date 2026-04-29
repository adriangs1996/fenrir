import { Loader2Icon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { TrimmedNonEmptyString } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { useFeatureProjectId } from "../hooks/useFeatureProjectId";
import { PlanRunnerRunView } from "./PlanRunnerRunView";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";

interface PlanRunnerFeatureRunResolverProps {
  featureName: string;
}

type ResolveState =
  | { status: "loading" }
  | { status: "no-run" }
  | { status: "ready"; runId: string }
  | { status: "error"; message: string };

/**
 * Feature-scoped run resolver. Looks up the latest stored run for a feature
 * via `planRunner.getFeatureRun` and:
 *
 * - renders `PlanRunnerRunView` when a run is found,
 * - redirects to the configure route when no run exists,
 * - shows a loader while the lookup is in flight,
 * - shows an inline error on RPC failure.
 *
 * Resolution depends on the owning `projectId` being known — discovered via
 * the plan-runner store. A loader is shown while the store seeds.
 */
export const PlanRunnerFeatureRunResolver = memo(function PlanRunnerFeatureRunResolver({
  featureName,
}: PlanRunnerFeatureRunResolverProps) {
  const navigate = useNavigate();
  const projectId = useFeatureProjectId(featureName);
  const upsertRun = usePlanRunnerStore((s) => s.upsertRun);

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  const [state, setState] = useState<ResolveState>({ status: "loading" });

  useEffect(() => {
    if (!rpcClient || !projectId) return;
    let cancelled = false;
    setState({ status: "loading" });
    rpcClient.planRunner
      .getFeatureRun({
        projectId,
        featureName: featureName as typeof TrimmedNonEmptyString.Type,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.run) {
          // Seed store so PlanRunnerRunView renders without a second fetch.
          upsertRun(result.run);
          setState({ status: "ready", runId: result.run.runId });
        } else {
          setState({ status: "no-run" });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to resolve feature run";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [rpcClient, projectId, featureName, upsertRun]);

  // Redirect to configure when there is no stored run for the feature.
  useEffect(() => {
    if (state.status !== "no-run") return;
    void navigate({
      to: "/plan-runner/$featureName/configure",
      params: { featureName },
      replace: true,
    });
  }, [state.status, navigate, featureName]);

  if (!projectId || state.status === "loading" || state.status === "no-run") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {state.status === "no-run" ? "No run yet — opening configure…" : "Loading run…"}
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Could not load run</p>
        <p className="text-xs text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  return <PlanRunnerRunView runId={state.runId} />;
});
