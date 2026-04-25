import {
  ChevronRightIcon,
  FileTextIcon,
  PlayIcon,
  SquareIcon,
  PencilIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@fenrir/client-runtime";
import type { EnvironmentId, ProjectId } from "@fenrir/contracts";
import {
  FeatureSummary as FeatureSummarySchema,
  PlanFileSummary as PlanFileSummarySchema,
} from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "~/components/ui/sidebar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "~/components/ui/collapsible";

type FeatureSummary = typeof FeatureSummarySchema.Type;
type PlanFileSummary = typeof PlanFileSummarySchema.Type;

const EMPTY_PLANS: ReadonlyArray<PlanFileSummary> = [];

const STATE_BADGE_CONFIG: Record<
  string,
  { label: string; variant: "info" | "warning" | "success" | "destructive"; pulse?: boolean }
> = {
  analyzing: { label: "Analyzing", variant: "info", pulse: true },
  executing: { label: "Executing", variant: "info" },
  integrating: { label: "Integrating", variant: "warning" },
  completed: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

interface PlanRunnerFeatureFolderProps {
  feature: FeatureSummary;
  projectId: ProjectId;
  environmentId: EnvironmentId;
}

export const PlanRunnerFeatureFolder = memo(function PlanRunnerFeatureFolder({
  feature,
  projectId,
  environmentId,
}: PlanRunnerFeatureFolderProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const featureKey = `${projectId}:${feature.featureName}`;
  const plans = usePlanRunnerStore((s) => s.plansByFeatureKey[featureKey] ?? EMPTY_PLANS);
  const setPlans = usePlanRunnerStore((s) => s.setPlans);
  const runById = usePlanRunnerStore((s) => s.runById);
  const { handleNewThread } = useNewThreadHandler();

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  // Fetch plans when expanded
  useEffect(() => {
    if (!expanded || !rpcClient) return;
    rpcClient.planRunner
      .getFeaturePlans({ projectId, featureName: feature.featureName })
      .then((result) => setPlans(featureKey, result.plans))
      .catch((err) => console.error("getFeaturePlans failed:", err));
  }, [expanded, rpcClient, projectId, feature.featureName, featureKey, setPlans]);

  // Determine active run state
  const activeRun = feature.activeRunId ? runById[feature.activeRunId] : null;
  const badgeConfig = activeRun ? STATE_BADGE_CONFIG[activeRun.state] : null;

  const handleRun = useCallback(() => {
    if (!rpcClient) return;
    void rpcClient.planRunner.start({ projectId, featureName: feature.featureName });
  }, [rpcClient, projectId, feature.featureName]);

  const handleCancel = useCallback(() => {
    if (!rpcClient || !feature.activeRunId) return;
    void rpcClient.planRunner.cancel({ runId: feature.activeRunId });
  }, [rpcClient, feature.activeRunId]);

  const handleRunClick = useCallback(() => {
    if (feature.activeRunId) {
      void navigate({ to: "/plan-runner/$runId", params: { runId: feature.activeRunId } });
    }
  }, [navigate, feature.activeRunId]);

  const handlePlanClick = useCallback(
    (plan: PlanFileSummary) => {
      void navigate({
        to: "/plan-runner/$featureName/$planId",
        params: { featureName: feature.featureName, planId: plan.planId },
      });
    },
    [navigate, feature.featureName],
  );

  const handleRefine = useCallback(
    (plan: PlanFileSummary) => {
      const ref = scopeProjectRef(environmentId, projectId);
      const prompt = `Here is a plan file I'd like to refine:\n\n# ${plan.filename}\n${plan.content}\n\nPlease update this plan based on the following feedback:\n`;
      void handleNewThread(ref, { initialPrompt: prompt });
    },
    [environmentId, projectId, handleNewThread],
  );

  return (
    <SidebarMenuItem>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-center">
          <CollapsibleTrigger className="flex-1">
            <SidebarMenuButton className="w-full gap-1.5">
              <ChevronRightIcon
                className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              />
              <span className="truncate">{feature.featureName}</span>
              <Badge variant="outline" size="sm" className="ml-auto">
                {feature.planCount}
              </Badge>
              {badgeConfig && (
                <Badge
                  variant={badgeConfig.variant}
                  size="sm"
                  className={`cursor-pointer ${badgeConfig.pulse ? "animate-pulse" : ""}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    handleRunClick();
                  }}
                >
                  {badgeConfig.label}
                </Badge>
              )}
            </SidebarMenuButton>
          </CollapsibleTrigger>
          {feature.hasActiveRun ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-destructive"
              onClick={handleCancel}
              title="Cancel run"
            >
              <SquareIcon className="size-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0"
              onClick={handleRun}
              title="Run plans"
            >
              <PlayIcon className="size-3" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <SidebarMenuSub>
            {plans.map((plan) => (
              <SidebarMenuSubItem key={plan.planId}>
                <SidebarMenuSubButton
                  className="group flex items-center gap-1.5"
                  onClick={() => handlePlanClick(plan)}
                >
                  <FileTextIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{plan.filename}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="invisible ml-auto size-4 group-hover:visible"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      handleRefine(plan);
                    }}
                    title="Refine with Claude"
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
});
