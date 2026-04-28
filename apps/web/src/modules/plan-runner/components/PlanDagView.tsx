import { memo, useMemo } from "react";
import {
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
  MinusCircleIcon,
  EyeIcon,
  CircleDotIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface DagPlan {
  readonly planId: string;
  readonly filename: string;
  readonly dependsOn: readonly string[];
  /** Present on run plans, absent on configure-time plans. */
  readonly state?: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly retriesUsed?: number;
  readonly maxRetries?: number;
  readonly error?: string | null;
}

interface PlanDagViewProps {
  plans: readonly DagPlan[];
  /** Render click target buttons for each plan. */
  onPlanClick?: ((plan: DagPlan) => void) | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeWaves(plans: readonly DagPlan[]): DagPlan[][] {
  const planMap = new Map(plans.map((p) => [p.planId, p]));
  const depths = new Map<string, number>();
  const visited = new Set<string>();

  function getDepth(planId: string): number {
    if (depths.has(planId)) return depths.get(planId)!;
    if (visited.has(planId)) return 0;
    visited.add(planId);

    const plan = planMap.get(planId);
    if (!plan || plan.dependsOn.length === 0) {
      depths.set(planId, 0);
      return 0;
    }

    const maxParentDepth = Math.max(
      ...plan.dependsOn.map((dep) => (planMap.has(dep) ? getDepth(dep) + 1 : 0)),
    );
    depths.set(planId, maxParentDepth);
    return maxParentDepth;
  }

  for (const plan of plans) {
    getDepth(plan.planId);
  }

  const waveMap = new Map<number, DagPlan[]>();
  for (const plan of plans) {
    const depth = depths.get(plan.planId) ?? 0;
    const wave = waveMap.get(depth) ?? [];
    wave.push(plan);
    waveMap.set(depth, wave);
  }

  return [...waveMap.entries()].sort(([a], [b]) => a - b).map(([, w]) => w);
}

function formatElapsed(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

// ── Status icon ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { icon: React.ElementType; className: string }> = {
  blocked: { icon: CircleIcon, className: "text-muted-foreground/40" },
  ready: { icon: CircleDotIcon, className: "text-muted-foreground" },
  running: { icon: Loader2Icon, className: "animate-spin text-blue-400" },
  reviewing: { icon: EyeIcon, className: "text-amber-400" },
  done: { icon: CheckCircle2Icon, className: "text-emerald-400" },
  failed: { icon: XCircleIcon, className: "text-red-400" },
  skipped: { icon: MinusCircleIcon, className: "text-muted-foreground/50" },
};

function PlanStatusIcon({ state }: { state: string | undefined }) {
  const config = STATUS_STYLES[state ?? "blocked"] ?? STATUS_STYLES["blocked"]!;
  const Icon = config!.icon;
  return <Icon className={`size-4 shrink-0 ${config!.className}`} />;
}

// ── Wave box (group of parallel plans) ──────────────────────────────────────

const WaveBox = memo(function WaveBox({
  plans,
  onPlanClick,
}: {
  plans: readonly DagPlan[];
  onPlanClick: ((plan: DagPlan) => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-0 rounded-lg border border-border/60 bg-card/50 backdrop-blur-sm">
      {plans.map((plan, i) => {
        const elapsed = formatElapsed(plan.startedAt, plan.completedAt);
        return (
          <button
            key={plan.planId}
            type="button"
            className={`flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/50 ${
              i > 0 ? "border-t border-border/40" : ""
            } ${onPlanClick ? "cursor-pointer" : "cursor-default"} ${
              i === 0 ? "rounded-t-lg" : ""
            } ${i === plans.length - 1 ? "rounded-b-lg" : ""}`}
            onClick={() => onPlanClick?.(plan)}
          >
            <PlanStatusIcon state={plan.state} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {plan.filename.replace(/\.md$/, "")}
            </span>
            {elapsed && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elapsed}</span>
            )}
            {plan.state === undefined && plan.dependsOn.length === 0 && (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">root</span>
            )}
          </button>
        );
      })}
    </div>
  );
});

// ── Connector (dots + line between waves) ───────────────────────────────────

function WaveConnector() {
  return (
    <div className="flex shrink-0 items-center gap-0 self-center px-1">
      <div className="size-1.5 rounded-full bg-muted-foreground/40" />
      <div className="h-px w-6 bg-muted-foreground/30" />
      <div className="size-1.5 rounded-full bg-muted-foreground/40" />
    </div>
  );
}

// ── Main DAG view ───────────────────────────────────────────────────────────

export const PlanDagView = memo(function PlanDagView({ plans, onPlanClick }: PlanDagViewProps) {
  const waves = useMemo(() => computeWaves(plans), [plans]);

  if (waves.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No plans
      </div>
    );
  }

  return (
    <div className="flex items-start gap-0 overflow-x-auto py-4">
      {waves.map((wave, waveIdx) => (
        <div key={waveIdx} className="flex items-center gap-0">
          {waveIdx > 0 && <WaveConnector />}
          <WaveBox plans={wave} onPlanClick={onPlanClick} />
        </div>
      ))}
    </div>
  );
});

export type { DagPlan };
