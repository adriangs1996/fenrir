import {
  ArchiveIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  RotateCwIcon,
  SquareIcon,
  XCircleIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ProjectId } from "@fenrir/contracts";
import {
  FeatureSummary as FeatureSummarySchema,
  PlanFileSummary as PlanFileSummarySchema,
} from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import { getFeatureRunStatus, type FeatureRunStatus } from "./featureRunStatus";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "~/components/ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { toastManager } from "~/components/ui/toast";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";

type FeatureSummary = typeof FeatureSummarySchema.Type;
type PlanFileSummary = typeof PlanFileSummarySchema.Type;

const EMPTY_PLANS: ReadonlyArray<PlanFileSummary> = [];

interface PlanRunnerFeatureFolderProps {
  feature: FeatureSummary;
  projectId: ProjectId;
  projectCwd: string;
}

const PLAN_RUNNER_FEATURE_FOLDER_KEY_PREFIX = "plan-runner:feature:";

export const PlanRunnerFeatureFolder = memo(function PlanRunnerFeatureFolder({
  feature,
  projectId,
  projectCwd,
}: PlanRunnerFeatureFolderProps) {
  const navigate = useNavigate();
  const featureKey = `${projectId}:${feature.featureName}`;
  const expansionKey = `${PLAN_RUNNER_FEATURE_FOLDER_KEY_PREFIX}${projectCwd}:${feature.featureName}`;
  const expanded = useUiStateStore((s) => s.planRunnerFolderExpandedByKey[expansionKey] ?? false);
  const setPlanRunnerFolderExpanded = useUiStateStore((s) => s.setPlanRunnerFolderExpanded);
  const plans = usePlanRunnerStore((s) => s.plansByFeatureKey[featureKey] ?? EMPTY_PLANS);
  const setPlans = usePlanRunnerStore((s) => s.setPlans);
  const archiveFeature = usePlanRunnerStore((s) => s.archiveFeature);

  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  // Fetch plans when expanded — skip if already cached in store
  useEffect(() => {
    if (!expanded || !rpcClient || plans.length > 0) return;
    rpcClient.planRunner
      .getFeaturePlans({ projectId, featureName: feature.featureName })
      .then((result) => setPlans(featureKey, result.plans))
      .catch((err) => console.error("getFeaturePlans failed:", err));
  }, [expanded, rpcClient, projectId, feature.featureName, featureKey, setPlans, plans.length]);

  const status: FeatureRunStatus = useMemo(() => getFeatureRunStatus(feature), [feature]);

  const handleConfigure = useCallback(() => {
    void navigate({
      to: "/plan-runner/$featureName/run",
      params: { featureName: feature.featureName },
    });
  }, [navigate, feature.featureName]);

  const handleCancel = useCallback(() => {
    if (!rpcClient || !feature.activeRunId) return;
    void rpcClient.planRunner.cancel({ runId: feature.activeRunId });
  }, [rpcClient, feature.activeRunId]);

  const canArchive = !feature.hasActiveRun;

  const handleArchive = useCallback(() => {
    if (!canArchive) return;
    archiveFeature(projectId, feature.featureName).catch((err) => {
      toastManager.add({
        type: "error",
        title: "Failed to archive feature",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    });
  }, [canArchive, archiveFeature, projectId, feature.featureName]);

  // Status-icon click target: prefer the active run, fall back to last stored run.
  const statusRunId = feature.activeRunId ?? feature.lastRunId ?? null;
  const handleStatusClick = useCallback(() => {
    if (!statusRunId) return;
    void navigate({
      to: "/plan-runner/$runId",
      params: { runId: statusRunId },
    });
  }, [navigate, statusRunId]);

  const handlePlanClick = useCallback(
    (plan: PlanFileSummary) => {
      void navigate({
        to: "/plan-runner/$featureName/$planId",
        params: { featureName: feature.featureName, planId: plan.planId },
      });
    },
    [navigate, feature.featureName],
  );

  return (
    <SidebarMenuSubItem className="w-full">
      <Collapsible
        open={expanded}
        onOpenChange={(open) => setPlanRunnerFolderExpanded(expansionKey, open)}
      >
        <div className="flex items-center">
          <CollapsibleTrigger
            aria-label={expanded ? "Collapse plans" : "Expand plans"}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRightIcon
              className={`size-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
          </CollapsibleTrigger>
          <SidebarMenuSubButton
            size="sm"
            className="h-7 min-w-0 flex-1 translate-x-0 justify-start gap-1.5 px-2 text-left text-xs text-muted-foreground"
            onClick={handleConfigure}
            title={`Open ${feature.featureName} run`}
          >
            <span className="min-w-0 flex-1 truncate">{feature.featureName}</span>
          </SidebarMenuSubButton>
          <FeatureStatusIcon
            status={status}
            lastUpdatedAt={feature.lastRunUpdatedAt}
            hasRun={statusRunId !== null}
            onClick={handleStatusClick}
          />
          {feature.hasActiveRun && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-destructive"
              onClick={handleCancel}
              title="Cancel run"
            >
              <SquareIcon className="size-3" />
            </Button>
          )}
          <button
            type="button"
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 ${
              canArchive
                ? "hover:bg-accent hover:text-foreground"
                : "cursor-not-allowed opacity-50 group-hover/menu-sub-item:opacity-50"
            }`}
            disabled={!canArchive}
            title={canArchive ? "Archive feature" : "Cannot archive feature with active run"}
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
            aria-label={`Archive feature ${feature.featureName}`}
          >
            <ArchiveIcon className="size-3" />
          </button>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 gap-0 border-l border-sidebar-border py-0 pl-2">
            {plans.map((plan) => (
              <SidebarMenuSubItem key={plan.planId}>
                <SidebarMenuSubButton
                  size="sm"
                  className="group h-6 w-full gap-1.5 px-1.5 text-[10px] text-muted-foreground/70"
                  onClick={() => handlePlanClick(plan)}
                >
                  <FileTextIcon className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{plan.filename}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  );
});

// ── Status icon ────────────────────────────────────────────────────────────

type FeatureStatusIconConfig = {
  Icon: typeof Loader2Icon;
  /** Tailwind text color class for the icon. */
  colorClass: string;
  /** Animation class applied to the icon (`animate-spin`/`animate-pulse`/empty). */
  animateClass: string;
  /** Short state label ("Running", "Failed", …). */
  label: string;
  /** One-line meaning of the state. */
  description: string;
};

const STATUS_ICON_CONFIG: Record<FeatureRunStatus, FeatureStatusIconConfig> = {
  notRun: {
    Icon: CircleDashedIcon,
    colorClass: "text-muted-foreground/60",
    animateClass: "",
    label: "Not run yet",
    description: "Feature has no stored run.",
  },
  running: {
    Icon: Loader2Icon,
    colorClass: "text-info",
    animateClass: "animate-spin",
    label: "Running",
    description: "A run is in progress.",
  },
  recovering: {
    Icon: RotateCwIcon,
    colorClass: "text-warning",
    animateClass: "animate-pulse",
    label: "Recovering",
    description: "The runner is recovering from a failure.",
  },
  passed: {
    Icon: CheckCircle2Icon,
    colorClass: "text-success",
    animateClass: "",
    label: "Passed",
    description: "Last run completed successfully.",
  },
  failed: {
    Icon: XCircleIcon,
    colorClass: "text-destructive",
    animateClass: "",
    label: "Failed",
    description: "Last run failed.",
  },
};

interface FeatureStatusIconProps {
  status: FeatureRunStatus;
  lastUpdatedAt: string | null;
  hasRun: boolean;
  onClick: () => void;
}

function FeatureStatusIcon({ status, lastUpdatedAt, hasRun, onClick }: FeatureStatusIconProps) {
  const config = STATUS_ICON_CONFIG[status];
  const clickable = status !== "notRun" && hasRun;
  const updatedLabel = lastUpdatedAt ? formatRelativeTimeLabel(lastUpdatedAt) : null;
  const iconClass = `size-3 ${config.animateClass}`.trim();
  const wrapperClass = `inline-flex size-5 shrink-0 items-center justify-center rounded ${config.colorClass}`;

  // base-ui Tooltip — Trigger renders the actual interactive node so we can
  // swap between a clickable button and a static span without losing hover.
  const trigger = clickable ? (
    <button
      type="button"
      aria-label={`${config.label} — open run`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${wrapperClass} cursor-pointer hover:bg-accent`}
    >
      <config.Icon className={iconClass} />
    </button>
  ) : (
    <span aria-label={config.label} role="img" className={`${wrapperClass} cursor-default`}>
      <config.Icon className={iconClass} />
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipPopup className="max-w-60 px-2 py-1.5">
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">{config.label}</span>
          <span className="text-muted-foreground">{config.description}</span>
          {updatedLabel && (
            <span className="text-muted-foreground">Last updated {updatedLabel}</span>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
