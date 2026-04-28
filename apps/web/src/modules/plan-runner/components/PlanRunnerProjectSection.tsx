import { ChevronRightIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { scopeProjectRef } from "@fenrir/client-runtime";
import type { EnvironmentId, ProjectId } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { PlanRunnerFeatureFolder } from "./PlanRunnerFeatureFolder";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "~/components/ui/collapsible";

const EMPTY_FEATURES: ReadonlyArray<never> = [];

const NEW_PLAN_PROMPT = `Help me break down a new feature into implementation plans.

Create a \`.plans/{featureName}/\` directory with .md plan files. Each plan should have YAML frontmatter with:
- id: unique identifier
- depends_on: array of plan IDs this depends on
- max_retries: number (default 2)

Then the markdown body with the full implementation plan.

Feature to plan: `;

interface PlanRunnerProjectSectionProps {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}

export const PlanRunnerProjectSection = memo(function PlanRunnerProjectSection({
  projectId,
  environmentId,
}: PlanRunnerProjectSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const features = usePlanRunnerStore((s) => s.featuresByProjectId[projectId] ?? EMPTY_FEATURES);
  const setFeatures = usePlanRunnerStore((s) => s.setFeatures);
  const { handleNewThread } = useNewThreadHandler();

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  // Fetch features on mount / expand
  useEffect(() => {
    if (!rpcClient) return;
    rpcClient.planRunner
      .listFeatures({ projectId })
      .then((result) => setFeatures(projectId, result.features))
      .catch(() => {
        // No .plans/ dir or error — set empty
        setFeatures(projectId, []);
      });
  }, [rpcClient, projectId, setFeatures]);

  const handleNewPlan = useCallback(() => {
    const ref = scopeProjectRef(environmentId, projectId);
    void handleNewThread(ref, { initialPrompt: NEW_PLAN_PROMPT });
  }, [environmentId, projectId, handleNewThread]);

  // Don't render section if no features and no way to create them
  if (features.length === 0 && !rpcClient) return null;

  return (
    <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0">
      <SidebarMenuSubItem className="w-full">
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <div className="flex items-center">
            <CollapsibleTrigger className="flex-1">
              <SidebarMenuSubButton
                size="sm"
                className="h-6 w-full translate-x-0 justify-start gap-1.5 px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
              >
                <ChevronRightIcon
                  className={`size-3 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                />
                <FolderOpenIcon className="size-3 shrink-0" />
                <span>Plans</span>
                {features.length > 0 && (
                  <Badge variant="outline" size="sm" className="ml-auto">
                    {features.length}
                  </Badge>
                )}
              </SidebarMenuSubButton>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground/80"
              onClick={handleNewPlan}
              title="New Plan"
            >
              <PlusIcon className="size-3" />
            </Button>
          </div>

          <CollapsibleContent>
            <SidebarMenuSub className="mx-2 gap-0.5 border-l border-sidebar-border py-0.5 pl-2">
              {features.length === 0 ? (
                <div className="flex h-6 w-full items-center px-2 text-[10px] text-muted-foreground/60">
                  No plans yet
                </div>
              ) : (
                features.map((feature) => (
                  <PlanRunnerFeatureFolder
                    key={feature.featureName}
                    feature={feature}
                    projectId={projectId}
                    environmentId={environmentId}
                  />
                ))
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
});
