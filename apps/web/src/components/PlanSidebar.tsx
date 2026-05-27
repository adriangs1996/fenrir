import { memo, useState, useCallback } from "react";
import type { EnvironmentId } from "@fenrir/contracts";
import { type TimestampFormat } from "@fenrir/contracts/settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import ChatMarkdown from "./ChatMarkdown";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  LoaderIcon,
  PanelRightCloseIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../session-logic";
import type { LatestProposedPlanState } from "../session-logic";
import { formatTimestamp } from "../timestampFormat";
import {
  proposedPlanTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  downloadPlanAsTextFile,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { readEnvironmentApi } from "~/environmentApi";
import { toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

type PlanStep = ActivePlanState["steps"][number];

function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/18 text-emerald-400 ring-1 ring-emerald-500/20">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/18 text-blue-300 ring-1 ring-blue-400/25">
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/60">
      <span className="size-1.5 rounded-full bg-muted-foreground/55" />
    </span>
  );
}

function stepStatusLabel(status: PlanStep["status"]): string {
  if (status === "completed") return "Done";
  if (status === "inProgress") return "Now";
  return "Next";
}

function keyedPlanSteps(
  steps: ActivePlanState["steps"],
): Array<{ key: string; step: ActivePlanState["steps"][number] }> {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const baseKey = `${step.status}:${step.step}`;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return {
      key: occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`,
      step,
    };
  });
}

function summarizePlanSteps(steps: ActivePlanState["steps"]) {
  const completed = steps.filter((step) => step.status === "completed").length;
  const inProgress = steps.filter((step) => step.status === "inProgress").length;
  const pending = steps.length - completed - inProgress;
  const percent = steps.length === 0 ? 0 : Math.round((completed / steps.length) * 100);
  const activeStep = steps.find((step) => step.status === "inProgress") ?? null;

  return {
    activeStep,
    completed,
    inProgress,
    pending,
    percent,
    total: steps.length,
  };
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  label?: string;
  environmentId: EnvironmentId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  onClose: () => void;
}

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  label = "Plan",
  environmentId,
  markdownCwd,
  workspaceRoot,
  timestampFormat,
  onClose,
}: PlanSidebarProps) {
  const [proposedPlanExpanded, setProposedPlanExpanded] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const stepSummary = activePlan ? summarizePlanSteps(activePlan.steps) : null;

  const handleCopyPlan = useCallback(() => {
    if (!planMarkdown) return;
    copyToClipboard(planMarkdown);
  }, [planMarkdown, copyToClipboard]);

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown));
  }, [planMarkdown]);

  const handleSaveToWorkspace = useCallback(() => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !workspaceRoot || !planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then((result) => {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      })
      .then(
        () => setIsSavingToWorkspace(false),
        () => setIsSavingToWorkspace(false),
      );
  }, [environmentId, planMarkdown, workspaceRoot]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card/50">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-blue-400 uppercase"
          >
            {label}
          </Badge>
          {activePlan ? (
            <span className="text-[11px] text-muted-foreground/60">
              {formatTimestamp(activePlan.createdAt, timestampFormat)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {planMarkdown ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground/50 hover:text-foreground/70"
                    aria-label="Plan actions"
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={handleCopyPlan}>
                  {isCopied ? "Copied!" : "Copy to clipboard"}
                </MenuItem>
                <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
                <MenuItem
                  onClick={handleSaveToWorkspace}
                  disabled={!workspaceRoot || isSavingToWorkspace}
                >
                  Save to workspace
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()} sidebar`}
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl space-y-4 p-3">
          {/* Explanation */}
          {activePlan?.explanation ? (
            <p className="rounded-md border border-border/55 bg-background/45 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground/85">
              {activePlan.explanation}
            </p>
          ) : null}

          {/* Plan Steps */}
          {activePlan && activePlan.steps.length > 0 ? (
            <div className="space-y-2.5">
              <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                      Steps
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/75">
                      {stepSummary?.activeStep
                        ? stepSummary.activeStep.step
                        : stepSummary?.completed === stepSummary?.total
                          ? "All steps completed"
                          : "Waiting for the next step"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-foreground/90">
                      {stepSummary?.completed ?? 0}/{stepSummary?.total ?? 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground/55">
                      {stepSummary?.pending ?? 0} pending
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/70">
                  <div
                    className="h-full rounded-full bg-blue-400/80 transition-[width] duration-300"
                    style={{ width: `${stepSummary?.percent ?? 0}%` }}
                  />
                </div>
              </div>
              {keyedPlanSteps(activePlan.steps).map(({ key, step }) => (
                <div
                  key={key}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-200",
                    step.status === "inProgress" &&
                      "border-blue-400/25 bg-blue-500/10 shadow-[inset_3px_0_0_rgb(96_165_250_/_0.55)]",
                    step.status === "completed" && "border-emerald-500/18 bg-emerald-500/6",
                    step.status === "pending" && "border-border/55 bg-background/35",
                  )}
                >
                  <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase",
                          step.status === "completed" && "bg-emerald-500/12 text-emerald-300/85",
                          step.status === "inProgress" && "bg-blue-500/18 text-blue-200",
                          step.status === "pending" && "bg-muted/55 text-muted-foreground/75",
                        )}
                      >
                        {stepStatusLabel(step.status)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "wrap-break-word text-[13px] leading-snug",
                        step.status === "completed"
                          ? "text-muted-foreground/62 line-through decoration-muted-foreground/25"
                          : step.status === "inProgress"
                            ? "text-foreground/95"
                            : "text-muted-foreground/82",
                      )}
                    >
                      {step.step}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Proposed Plan Markdown */}
          {planMarkdown ? (
            <div className="space-y-2">
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 text-left"
                onClick={() => setProposedPlanExpanded((v) => !v)}
              >
                {proposedPlanExpanded ? (
                  <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                ) : (
                  <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                )}
                <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/60">
                  {planTitle ?? "Full Plan"}
                </span>
              </button>
              {proposedPlanExpanded ? (
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <ChatMarkdown
                    text={displayedPlanMarkdown ?? ""}
                    cwd={markdownCwd}
                    isStreaming={false}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Empty state */}
          {!activePlan && !planMarkdown ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Plans will appear here when generated.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});

export default PlanSidebar;
export type { PlanSidebarProps };
