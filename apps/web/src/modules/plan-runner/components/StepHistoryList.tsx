import { memo, useCallback } from "react";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  Loader2Icon,
  MinusCircleIcon,
  XCircleIcon,
  CircleIcon,
} from "lucide-react";
import { type PlanRunnerStepSnapshot, type PlanState } from "@fenrir/contracts";
import { cn } from "~/lib/utils";
import { formatElapsed } from "./formatElapsed";
import { stepLabel } from "./stepLabels";

// ─── State icon ──────────────────────────────────────────────────────────────

const STATE_CFG: Record<PlanState, { icon: React.ElementType; cls: string }> = {
  blocked: { icon: CircleIcon, cls: "text-muted-foreground/40" },
  ready: { icon: CircleDotIcon, cls: "text-muted-foreground" },
  running: { icon: Loader2Icon, cls: "animate-spin text-blue-400" },
  done: { icon: CheckCircle2Icon, cls: "text-emerald-400" },
  failed: { icon: XCircleIcon, cls: "text-red-400" },
  skipped: { icon: MinusCircleIcon, cls: "text-muted-foreground/50" },
};

function StateIcon({ state }: { state: PlanState }) {
  const cfg = STATE_CFG[state] ?? STATE_CFG.blocked;
  const Icon = cfg.icon;
  return <Icon className={cn("size-3.5 shrink-0", cfg.cls)} />;
}

// ─── Row ─────────────────────────────────────────────────────────────────────

const HistoryRow = memo(function HistoryRow({
  step,
  isSelected,
  onSelect,
}: {
  step: PlanRunnerStepSnapshot;
  isSelected: boolean;
  onSelect: (stepKey: string) => void;
}) {
  const elapsed = formatElapsed(step.startedAt, step.completedAt);
  const isFailed = step.state === "failed";

  return (
    <button
      type="button"
      onClick={() => onSelect(step.stepKey)}
      className={cn(
        "group flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
        isSelected
          ? "border-primary/40 bg-primary/8"
          : "border-border/40 bg-card/30 hover:border-border/70 hover:bg-accent/30",
      )}
    >
      <div className="flex items-center gap-2">
        <StateIcon state={step.state} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            step.kind !== "plan" && "uppercase tracking-wide text-[10px] text-muted-foreground",
          )}
        >
          {stepLabel(step)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {step.state}
        </span>
        {elapsed && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {elapsed}
          </span>
        )}
      </div>
      {isFailed && step.failureSummary && (
        <p
          className="line-clamp-2 ps-5 text-[10.5px] leading-snug text-destructive-foreground"
          title={step.failureSummary}
        >
          {step.failureSummary}
        </p>
      )}
    </button>
  );
});

// ─── List ────────────────────────────────────────────────────────────────────

interface StepHistoryListProps {
  /** Steps in execution order, only those that have actually started. */
  steps: readonly PlanRunnerStepSnapshot[];
  selectedStepKey: string | null;
  onSelect: (stepKey: string) => void;
}

/**
 * Unified started-step history. Plan steps and runner phases are rendered in
 * actual execution order. Selection is controlled by the parent so the same
 * viewer is reused for live tabs and historical rows.
 */
export const StepHistoryList = memo(function StepHistoryList({
  steps,
  selectedStepKey,
  onSelect,
}: StepHistoryListProps) {
  const handleSelect = useCallback(
    (stepKey: string) => {
      onSelect(stepKey);
    },
    [onSelect],
  );

  if (steps.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">No steps have started yet.</div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        History
      </div>
      <div className="flex flex-col gap-1">
        {steps.map((step) => (
          <HistoryRow
            key={step.stepKey}
            step={step}
            isSelected={step.stepKey === selectedStepKey}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
});
