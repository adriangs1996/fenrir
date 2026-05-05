import { DiffIcon, ListTodoIcon, ZapIcon } from "lucide-react";
import { Suspense, lazy, memo, useCallback, useEffect, useState } from "react";
import type { EnvironmentId } from "@fenrir/contracts";
import type { TimestampFormat } from "@fenrir/contracts/settings";
import { cn } from "~/lib/utils";
import { useRightPanelStore, type RightPanelTab } from "../../rightPanelStore";
import { Button } from "../ui/button";
import PlanSidebar from "../PlanSidebar";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../DiffPanelShell";
import type { ActivePlanState, LatestProposedPlanState } from "../../session-logic";

const DiffPanel = lazy(() => import("../DiffPanel"));

const LazySkillsPanel = lazy(() =>
  import("~/modules/skills/SkillsPanel").then((m) => ({ default: m.SkillsPanel })),
);

function DiffLoadingFallback(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

export interface RightPanelTabsPlanProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  label: string;
  environmentId: EnvironmentId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  onClose: () => void;
}

interface TabButtonProps {
  tab: RightPanelTab;
  icon: React.ElementType;
  label: string;
}

const TabButton = memo(function TabButton({ tab, icon: Icon, label }: TabButtonProps) {
  const { activeTab, toggleTab } = useRightPanelStore();
  const isActive = activeTab === tab;

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={() => toggleTab(tab)}
      className={cn(
        "shrink-0 gap-1.5 rounded-none border-b-2 px-2 sm:px-3",
        isActive
          ? "border-blue-400 text-blue-400 hover:text-blue-300"
          : "border-transparent text-muted-foreground/70 hover:text-foreground/80",
      )}
      aria-selected={isActive}
      role="tab"
    >
      <Icon className="size-3.5" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  );
});

interface RightPanelTabsProps {
  planProps: RightPanelTabsPlanProps;
  /**
   * "sidebar" = desktop inline panel with fixed width.
   * "sheet" = mobile sheet overlay (full width).
   */
  mode?: "sidebar" | "sheet";
  /** Called when the user clicks a skill item to insert it into the composer. */
  onSkillInsert?: (skillName: string) => void;
}

export const RightPanelTabs = memo(function RightPanelTabs({
  planProps,
  mode = "sidebar",
  onSkillInsert,
}: RightPanelTabsProps) {
  const handleSkillInsert = useCallback(
    (skillName: string) => {
      onSkillInsert?.(skillName);
    },
    [onSkillInsert],
  );
  const { activeTab } = useRightPanelStore();
  const diffPanelMode: DiffPanelMode = mode === "sheet" ? "sheet" : "sidebar";

  // Keep DiffPanel mounted once it's first opened so scroll position and
  // virtualizer state are preserved when switching between tabs.
  const [diffEverOpened, setDiffEverOpened] = useState(false);
  useEffect(() => {
    if (activeTab === "diff") {
      setDiffEverOpened(true);
    }
  }, [activeTab]);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-card/50",
        mode === "sidebar"
          ? "w-[min(42vw,44rem)] min-w-[360px] shrink-0 border-l border-border/70"
          : "min-w-0 flex-1",
      )}
    >
      {/* Tab bar */}
      <div role="tablist" className="flex h-10 shrink-0 items-end border-b border-border/60 px-1">
        <TabButton tab="plan" icon={ListTodoIcon} label="Plan" />
        <TabButton tab="diff" icon={DiffIcon} label="Diff" />
        <TabButton tab="skills" icon={ZapIcon} label="Skills" />
      </div>

      {/* Tab content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Plan tab */}
        <div className={cn("h-full", activeTab !== "plan" && "hidden")}>
          <PlanSidebar
            activePlan={planProps.activePlan}
            activeProposedPlan={planProps.activeProposedPlan}
            label={planProps.label}
            environmentId={planProps.environmentId}
            markdownCwd={planProps.markdownCwd}
            workspaceRoot={planProps.workspaceRoot}
            timestampFormat={planProps.timestampFormat}
            mode="sidebar"
            onClose={planProps.onClose}
          />
        </div>

        {/* Diff tab */}
        <div className={cn("h-full", activeTab !== "diff" && "hidden")}>
          {diffEverOpened ? (
            <DiffWorkerPoolProvider>
              <Suspense fallback={<DiffLoadingFallback mode={diffPanelMode} />}>
                <DiffPanel mode={diffPanelMode} />
              </Suspense>
            </DiffWorkerPoolProvider>
          ) : null}
        </div>

        {/* Skills tab */}
        <div className={cn("h-full", activeTab !== "skills" && "hidden")}>
          {activeTab === "skills" ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center p-6">
                  <ZapIcon className="size-6 animate-pulse text-muted-foreground/30" />
                </div>
              }
            >
              <LazySkillsPanel onInsert={handleSkillInsert} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
});
