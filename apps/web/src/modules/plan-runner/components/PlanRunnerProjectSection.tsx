import { ChevronRightIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { scopeProjectRef } from "@fenrir/client-runtime";
import type { EnvironmentId, ProjectId } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { PlanRunnerFeatureFolder } from "./PlanRunnerFeatureFolder";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu } from "~/components/ui/sidebar";
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
    <SidebarGroup className="py-0">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SidebarGroupLabel className="flex items-center gap-1.5">
          <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground">
            <ChevronRightIcon
              className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
            <FolderOpenIcon className="size-3.5 shrink-0" />
            <span>Plans</span>
            {features.length > 0 && (
              <Badge variant="outline" size="sm">
                {features.length}
              </Badge>
            )}
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={handleNewPlan}
            title="New Plan"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </SidebarGroupLabel>

        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {features.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
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
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
});
