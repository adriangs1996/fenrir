import { ChevronRightIcon, FolderOpenIcon } from "lucide-react";
import { memo, useEffect, useMemo } from "react";
import type { ProjectId } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { PlanRunnerFeatureFolder } from "./PlanRunnerFeatureFolder";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "~/components/ui/sidebar";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "~/components/ui/collapsible";
import { useUiStateStore } from "~/uiStateStore";
import { cn } from "~/lib/utils";

const EMPTY_FEATURES: ReadonlyArray<never> = [];

interface PlanRunnerProjectSectionProps {
  className?: string;
  layout?: "folder" | "drawer";
  projectId: ProjectId;
  projectCwd: string;
}

const PLAN_RUNNER_PROJECT_FOLDER_KEY_PREFIX = "plan-runner:project:";

export const PlanRunnerProjectSection = memo(function PlanRunnerProjectSection({
  className,
  layout = "folder",
  projectId,
  projectCwd,
}: PlanRunnerProjectSectionProps) {
  const expansionKey = `${PLAN_RUNNER_PROJECT_FOLDER_KEY_PREFIX}${projectCwd}`;
  const expanded = useUiStateStore((s) => s.planRunnerFolderExpandedByKey[expansionKey] ?? false);
  const setPlanRunnerFolderExpanded = useUiStateStore((s) => s.setPlanRunnerFolderExpanded);
  const features = usePlanRunnerStore((s) => s.featuresByProjectId[projectId] ?? EMPTY_FEATURES);
  const setFeatures = usePlanRunnerStore((s) => s.setFeatures);

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

  // Don't render the legacy folder section if no features and no way to create them.
  if (features.length === 0 && !rpcClient && layout === "folder") return null;

  if (layout === "drawer") {
    return (
      <SidebarMenuSub
        className={cn("mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0", className)}
      >
        {features.length === 0 ? (
          <SidebarMenuSubItem className="w-full">
            <div className="flex h-7 w-full items-center px-2 text-[10px] text-muted-foreground/60">
              {rpcClient ? "No plans yet" : "Plans unavailable"}
            </div>
          </SidebarMenuSubItem>
        ) : (
          features.map((feature) => (
            <PlanRunnerFeatureFolder
              key={feature.featureName}
              feature={feature}
              projectId={projectId}
              projectCwd={projectCwd}
            />
          ))
        )}
      </SidebarMenuSub>
    );
  }

  return (
    <SidebarMenuSub
      className={cn(
        "mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0",
        className,
      )}
    >
      <SidebarMenuSubItem className="w-full">
        <Collapsible
          open={expanded}
          onOpenChange={(open) => setPlanRunnerFolderExpanded(expansionKey, open)}
        >
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
              </SidebarMenuSubButton>
            </CollapsibleTrigger>
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
                    projectCwd={projectCwd}
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
