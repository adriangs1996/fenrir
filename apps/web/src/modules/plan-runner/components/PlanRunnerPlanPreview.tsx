import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@fenrir/client-runtime";
import type { ProjectId } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { buildPlanRefinementPrompt } from "../planPrompts";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import ChatMarkdown from "~/components/ChatMarkdown";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";

interface PlanRunnerPlanPreviewProps {
  featureName: string;
  planId: string;
}

export const PlanRunnerPlanPreview = memo(function PlanRunnerPlanPreview({
  featureName,
  planId,
}: PlanRunnerPlanPreviewProps) {
  const navigate = useNavigate();
  const { handleNewThread } = useNewThreadHandler();
  const setPlans = usePlanRunnerStore((s) => s.setPlans);

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  // Find the plan across all cached feature keys
  const plan = usePlanRunnerStore((s) => {
    for (const [key, plans] of Object.entries(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        const found = plans.find((p) => p.planId === planId);
        if (found) return found;
      }
    }
    return null;
  });

  // Extract projectId from feature key
  const projectId = usePlanRunnerStore((s): ProjectId | null => {
    for (const key of Object.keys(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        return (key.split(":")[0] ?? null) as ProjectId | null;
      }
    }
    // Fallback: check features
    for (const [pid, features] of Object.entries(s.featuresByProjectId)) {
      if (features.some((f) => f.featureName === featureName)) return pid as ProjectId;
    }
    return null;
  });
  const project = useStore((store) =>
    projectId
      ? (selectProjectsAcrossEnvironments(store).find((candidate) => candidate.id === projectId) ??
        null)
      : null,
  );

  // Fetch plans if not cached
  useEffect(() => {
    if (plan || !rpcClient || !projectId) return;
    rpcClient.planRunner
      .getFeaturePlans({ projectId, featureName: featureName as any })
      .then((result) => setPlans(`${projectId}:${featureName}`, result.plans))
      .catch((err) => console.error("getFeaturePlans failed:", err));
  }, [plan, rpcClient, projectId, featureName, setPlans]);

  const handleBack = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  const handleRefine = useCallback(() => {
    if (!plan || !project) return;
    const ref = scopeProjectRef(project.environmentId, project.id);
    const prompt = buildPlanRefinementPrompt({
      filename: plan.filename,
      content: plan.content,
    });
    void handleNewThread(ref, { initialPrompt: prompt });
  }, [plan, project, handleNewThread]);

  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Loading plan...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{plan.filename}</h2>
          <span className="text-xs text-muted-foreground">{featureName}</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefine}>
          <PencilIcon className="mr-1.5 size-3" />
          Refine with Claude
        </Button>
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        {plan.dependsOn.length > 0 && (
          <div className="flex items-center gap-1">
            <span>Depends on:</span>
            {plan.dependsOn.map((dep) => (
              <Badge key={dep} variant="outline" size="sm">
                {dep}
              </Badge>
            ))}
          </div>
        )}
        <span>Max retries: {plan.maxRetries}</span>
      </div>

      {/* Markdown content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ChatMarkdown text={plan.content} cwd={undefined} />
        </div>
      </div>
    </div>
  );
});
