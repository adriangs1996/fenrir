import { memo, useCallback } from "react";
import { Loader2Icon } from "lucide-react";
import { type PlanRunnerStepSnapshot } from "@fenrir/contracts";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { stepLabel } from "./stepLabels";

interface LiveStepMonitorPanelProps {
  activeSteps: readonly PlanRunnerStepSnapshot[];
  /**
   * Currently selected stepKey. When this matches an active step, that tab
   * is highlighted. The parent owns selection so the same selection can drive
   * either a live or a history-row log view.
   */
  selectedStepKey: string | null;
  onSelect: (stepKey: string) => void;
}

/**
 * Tab strip for currently-active steps. The actual log viewer is rendered by
 * the parent so selection can be shared between live tabs and the history
 * list, satisfying "one selected step at a time".
 *
 * Visibility is owned by the parent — this component renders nothing if it
 * is mounted with an empty active list.
 */
export const LiveStepMonitorPanel = memo(function LiveStepMonitorPanel({
  activeSteps,
  selectedStepKey,
  onSelect,
}: LiveStepMonitorPanelProps) {
  const handleTabClick = useCallback(
    (stepKey: string) => {
      onSelect(stepKey);
    },
    [onSelect],
  );

  if (activeSteps.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-y border-border/60 bg-background/40 px-3 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground">Live</span>
      <Loader2Icon className="size-3 animate-spin text-muted-foreground/70" />
      <div className="flex flex-wrap items-center gap-1">
        {activeSteps.map((step) => {
          const isSelected = step.stepKey === selectedStepKey;
          return (
            <button
              key={step.stepKey}
              type="button"
              onClick={() => handleTabClick(step.stepKey)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                isSelected
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
              )}
            >
              <span className="max-w-40 truncate font-medium">{stepLabel(step)}</span>
              <Badge variant="outline" size="sm" className="px-1 font-normal lowercase">
                {step.state}
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
});
