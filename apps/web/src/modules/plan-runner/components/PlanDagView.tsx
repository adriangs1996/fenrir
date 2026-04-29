import { memo, useMemo } from "react";
import {
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
  MinusCircleIcon,
  EyeIcon,
  CircleDotIcon,
  ZapIcon,
} from "lucide-react";

// ── Public types ───────────────────────────────────────────────────────────

interface DagPlan {
  readonly planId: string;
  readonly filename: string;
  readonly dependsOn: readonly string[];
  readonly state?: string | undefined;
  readonly startedAt?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
  readonly retriesUsed?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly error?: string | null | undefined;
}

interface PlanDagViewProps {
  plans: readonly DagPlan[];
  /** Max concurrent plan executions. Shown as a concurrency indicator. */
  maxConcurrency?: number | undefined;
  onPlanClick?: ((plan: DagPlan) => void) | undefined;
}

// ── Layout types ──────────────────────────────────────────────────────────

interface LayoutNode {
  planId: string;
  plan: DagPlan;
  column: number;
  row: number;
}

interface DagEdge {
  fromId: string;
  toId: string;
}

interface SvgEdge {
  id: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Edge color class derived from source node state. */
  colorClass: string;
}

// ── DAG layout computation ────────────────────────────────────────────────

/** Sort plans in-place by average row of their neighbors (barycenter heuristic). */
function sortByBarycenter(
  colPlans: DagPlan[],
  nodeRow: Map<string, number>,
  getNeighbors: (id: string) => string[],
) {
  const bary = new Map<string, number>();
  for (const plan of colPlans) {
    const neighborRows = getNeighbors(plan.planId)
      .map((nId) => nodeRow.get(nId))
      .filter((r): r is number => r !== undefined);
    const avg =
      neighborRows.length > 0 ? neighborRows.reduce((a, b) => a + b, 0) / neighborRows.length : 0;
    bary.set(plan.planId, avg);
  }
  colPlans.sort((a, b) => {
    const diff = (bary.get(a.planId) ?? 0) - (bary.get(b.planId) ?? 0);
    if (Math.abs(diff) > 0.001) return diff;
    return a.planId.localeCompare(b.planId);
  });
}

function computeLayout(plans: readonly DagPlan[]) {
  const planMap = new Map(plans.map((p) => [p.planId, p]));

  // 1. BFS level assignment (Kahn's algorithm).
  //    Wave 0 = nodes with no deps. Wave N = earliest wave where all deps are done.
  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const levels = new Map<string, number>();

  for (const p of plans) {
    successors.set(p.planId, []);
  }

  for (const p of plans) {
    const validDeps = p.dependsOn.filter((d) => planMap.has(d));
    inDegree.set(p.planId, validDeps.length);
    for (const dep of validDeps) {
      successors.get(dep)!.push(p.planId);
    }
  }

  // Seed queue with roots (in-degree 0)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  // Process BFS — each node enters queue only when all deps resolved
  const remaining = new Map(inDegree);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    for (const succ of successors.get(current) ?? []) {
      // Level = max(dep levels) + 1
      const prev = levels.get(succ) ?? 0;
      levels.set(succ, Math.max(prev, currentLevel + 1));
      const rem = (remaining.get(succ) ?? 1) - 1;
      remaining.set(succ, rem);
      if (rem === 0) queue.push(succ);
    }
  }

  // Fallback: orphaned nodes (cycle or missing deps) go to column 0
  for (const p of plans) {
    if (!levels.has(p.planId)) levels.set(p.planId, 0);
  }

  // 2. Adjacent-level edges only.
  //    Every node at level N has ≥1 dep at level N-1 (that's what set the max).
  //    Deps at earlier levels are already satisfied — drawing them adds visual noise
  //    without information (the level structure already communicates execution order).
  const edges: DagEdge[] = [];
  const adjLeft = new Map<string, string[]>(); // nodeId → adjacent-level deps (left neighbors)
  const adjRight = new Map<string, string[]>(); // nodeId → adjacent-level dependents (right neighbors)
  for (const p of plans) {
    adjLeft.set(p.planId, []);
    adjRight.set(p.planId, []);
  }

  for (const p of plans) {
    const pLevel = levels.get(p.planId) ?? 0;
    for (const depId of p.dependsOn) {
      if (!planMap.has(depId)) continue;
      const depLevel = levels.get(depId) ?? 0;
      if (pLevel - depLevel !== 1) continue; // only adjacent levels
      edges.push({ fromId: depId, toId: p.planId });
      adjLeft.get(p.planId)!.push(depId);
      adjRight.get(depId)!.push(p.planId);
    }
  }

  // 3. Group into columns
  const columnBuckets = new Map<number, DagPlan[]>();
  for (const plan of plans) {
    const col = levels.get(plan.planId) ?? 0;
    const bucket = columnBuckets.get(col) ?? [];
    bucket.push(plan);
    columnBuckets.set(col, bucket);
  }

  const sortedColKeys = [...columnBuckets.keys()].toSorted((a, b) => a - b);

  // 4. Multi-pass bidirectional barycenter to minimize edge crossings.
  const nodeRow = new Map<string, number>();

  // Initial assignment: row = index within column
  for (const colKey of sortedColKeys) {
    (columnBuckets.get(colKey) ?? []).forEach((p, i) => nodeRow.set(p.planId, i));
  }

  const BARYCENTER_PASSES = 4;
  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    // Left→right sweep: sort each column by avg row of left (dep) neighbors
    for (let ci = 1; ci < sortedColKeys.length; ci++) {
      const colPlans = columnBuckets.get(sortedColKeys[ci]!)!;
      sortByBarycenter(colPlans, nodeRow, (id) => adjLeft.get(id) ?? []);
      colPlans.forEach((p, i) => nodeRow.set(p.planId, i));
    }
    // Right→left sweep: sort each column by avg row of right (dependent) neighbors
    for (let ci = sortedColKeys.length - 2; ci >= 0; ci--) {
      const colPlans = columnBuckets.get(sortedColKeys[ci]!)!;
      sortByBarycenter(colPlans, nodeRow, (id) => adjRight.get(id) ?? []);
      colPlans.forEach((p, i) => nodeRow.set(p.planId, i));
    }
  }

  // 5. Build layout nodes
  const nodes: LayoutNode[] = [];
  for (const colKey of sortedColKeys) {
    const colPlans = columnBuckets.get(colKey) ?? [];
    for (const plan of colPlans) {
      nodes.push({
        planId: plan.planId,
        plan,
        column: colKey,
        row: nodeRow.get(plan.planId) ?? 0,
      });
    }
  }

  return { nodes, edges, columnCount: sortedColKeys.length };
}

// ── Elapsed time formatter ────────────────────────────────────────────────

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

// ── Status icon ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { icon: React.ElementType; cls: string }> = {
  blocked: { icon: CircleIcon, cls: "text-muted-foreground/40" },
  ready: { icon: CircleDotIcon, cls: "text-muted-foreground" },
  running: { icon: Loader2Icon, cls: "animate-spin text-blue-400" },
  reviewing: { icon: EyeIcon, cls: "text-amber-400" },
  done: { icon: CheckCircle2Icon, cls: "text-emerald-400" },
  failed: { icon: XCircleIcon, cls: "text-red-400" },
  skipped: { icon: MinusCircleIcon, cls: "text-muted-foreground/50" },
};

function StatusIcon({ state }: { state: string | undefined }) {
  const cfg = STATUS_CFG[state ?? "blocked"] ?? STATUS_CFG["blocked"]!;
  const Icon = cfg!.icon;
  return <Icon className={`size-4 shrink-0 ${cfg!.cls}`} />;
}

// ── Edge color from source state ──────────────────────────────────────────

/** Returns a Tailwind color class for the edge based on the source node's state. */
function edgeColorClass(sourceState: string | undefined): string {
  switch (sourceState) {
    case "done":
      return "text-emerald-400/50";
    case "failed":
      return "text-red-400/40";
    case "skipped":
      return "text-muted-foreground/20";
    case "running":
    case "reviewing":
      return "text-blue-400/30";
    default:
      return "text-muted-foreground/25";
  }
}

/** Returns a Tailwind color class for the connection dot (matches edge). */
function dotColorClass(sourceState: string | undefined): string {
  switch (sourceState) {
    case "done":
      return "text-emerald-400/60";
    case "failed":
      return "text-red-400/50";
    default:
      return "text-muted-foreground/40";
  }
}

// ── Individual node card ──────────────────────────────────────────────────

const NODE_HEIGHT = 40;
const NODE_WIDTH = 220;
const COL_GAP = 100;
const ROW_GAP = 16;
/** Radius of the connection dots on node edges */
const DOT_R = 4;

const NodeCard = memo(function NodeCard({
  node,
  x,
  y,
  hasDeps,
  hasDependents,
  rightDotColor,
  onPlanClick,
}: {
  node: LayoutNode;
  x: number;
  y: number;
  hasDeps: boolean;
  hasDependents: boolean;
  /** Color class for the right-side dot (derived from this node's state). */
  rightDotColor: string;
  onPlanClick: ((plan: DagPlan) => void) | undefined;
}) {
  const elapsed = formatElapsed(node.plan.startedAt, node.plan.completedAt);

  return (
    <g>
      {/* Left connection dot (if has dependencies) */}
      {hasDeps && (
        <circle
          cx={x}
          cy={y + NODE_HEIGHT / 2}
          r={DOT_R}
          fill="currentColor"
          className="text-muted-foreground/40"
        />
      )}
      {/* Right connection dot (if has dependents, colored by this node's state) */}
      {hasDependents && (
        <circle
          cx={x + NODE_WIDTH}
          cy={y + NODE_HEIGHT / 2}
          r={DOT_R}
          fill="currentColor"
          className={rightDotColor}
        />
      )}
      {/* Card body */}
      <foreignObject x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT}>
        <button
          type="button"
          className={[
            "flex h-full w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card/80 px-3 transition-colors hover:bg-accent/50 backdrop-blur-sm",
            onPlanClick ? "cursor-pointer" : "cursor-default",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onPlanClick?.(node.plan)}
        >
          <StatusIcon state={node.plan.state} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {node.plan.filename.replace(/\.md$/, "")}
          </span>
          {elapsed && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {elapsed}
            </span>
          )}
        </button>
      </foreignObject>
    </g>
  );
});

// ── Edge path ─────────────────────────────────────────────────────────────

function buildEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.min(Math.abs(x2 - x1) * 0.5, 60);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// ── Concurrency indicator ─────────────────────────────────────────────────

const ConcurrencyBadge = memo(function ConcurrencyBadge({
  running,
  max,
}: {
  running: number;
  max: number;
}) {
  const isFull = running >= max;
  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium tabular-nums",
        isFull
          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
          : "border-border/60 bg-card/50 text-muted-foreground",
      ].join(" ")}
    >
      <ZapIcon className="size-3" />
      <span>
        {running}/{max}
      </span>
      <span className="text-[10px] font-normal">{isFull ? "at capacity" : "slots"}</span>
    </div>
  );
});

// ── Main DAG view ─────────────────────────────────────────────────────────

export const PlanDagView = memo(function PlanDagView({
  plans,
  maxConcurrency,
  onPlanClick,
}: PlanDagViewProps) {
  const { nodes, edges } = useMemo(() => computeLayout(plans), [plans]);

  // Plan state lookup (for edge coloring)
  const planStateMap = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const p of plans) m.set(p.planId, p.state);
    return m;
  }, [plans]);

  // Count running plans for concurrency indicator
  const runningCount = useMemo(
    () => plans.filter((p) => p.state === "running" || p.state === "reviewing").length,
    [plans],
  );

  // Pre-compute node positions from layout
  const { nodePositions, svgWidth, svgHeight } = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();

    // Find max rows per column for centering
    const colMaxRow = new Map<number, number>();
    for (const n of nodes) {
      const cur = colMaxRow.get(n.column) ?? 0;
      colMaxRow.set(n.column, Math.max(cur, n.row));
    }

    const padding = 16;

    // Find the tallest column to use as reference for vertical centering
    let maxColHeight = 0;
    for (const [, maxRow] of colMaxRow) {
      const colHeight = (maxRow + 1) * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
      maxColHeight = Math.max(maxColHeight, colHeight);
    }

    for (const n of nodes) {
      const colRows = (colMaxRow.get(n.column) ?? 0) + 1;
      const colHeight = colRows * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
      const yOffset = (maxColHeight - colHeight) / 2;

      const x = padding + n.column * (NODE_WIDTH + COL_GAP);
      const y = padding + yOffset + n.row * (NODE_HEIGHT + ROW_GAP);
      positions.set(n.planId, { x, y });
    }

    const maxCol = nodes.reduce((m, n) => Math.max(m, n.column), 0);
    const w = padding * 2 + (maxCol + 1) * NODE_WIDTH + maxCol * COL_GAP;
    const h = padding * 2 + maxColHeight;

    return { nodePositions: positions, svgWidth: Math.max(w, 0), svgHeight: Math.max(h, 0) };
  }, [nodes]);

  // Compute SVG edge paths with color
  const svgEdges = useMemo<SvgEdge[]>(() => {
    const result: SvgEdge[] = [];
    for (const edge of edges) {
      const fromPos = nodePositions.get(edge.fromId);
      const toPos = nodePositions.get(edge.toId);
      if (!fromPos || !toPos) continue;

      const x1 = fromPos.x + NODE_WIDTH + DOT_R;
      const y1 = fromPos.y + NODE_HEIGHT / 2;
      const x2 = toPos.x - DOT_R;
      const y2 = toPos.y + NODE_HEIGHT / 2;

      const sourceState = planStateMap.get(edge.fromId);

      result.push({
        id: `${edge.fromId}->${edge.toId}`,
        d: buildEdgePath(x1, y1, x2, y2),
        x1,
        y1,
        x2,
        y2,
        colorClass: edgeColorClass(sourceState),
      });
    }
    return result;
  }, [edges, nodePositions, planStateMap]);

  // Sets for quick lookup: which nodes have deps / dependents
  const { hasDepSet, hasDependentSet } = useMemo(() => {
    const depSet = new Set<string>();
    const dependentSet = new Set<string>();
    for (const e of edges) {
      depSet.add(e.toId);
      dependentSet.add(e.fromId);
    }
    return { hasDepSet: depSet, hasDependentSet: dependentSet };
  }, [edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No plans
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Concurrency indicator (only when maxConcurrency is known and there are active plans) */}
      {maxConcurrency != null && (
        <div className="flex items-center gap-2">
          <ConcurrencyBadge running={runningCount} max={maxConcurrency} />
        </div>
      )}

      <div className="overflow-x-auto py-2">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="select-none"
          style={{ minWidth: svgWidth, minHeight: svgHeight }}
        >
          {/* Edges — render behind nodes, colored by source state */}
          {svgEdges.map((e) => (
            <path
              key={e.id}
              d={e.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className={`transition-colors duration-300 ${e.colorClass}`}
            />
          ))}

          {/* Nodes */}
          {nodes.map((n) => {
            const pos = nodePositions.get(n.planId);
            if (!pos) return null;
            return (
              <NodeCard
                key={n.planId}
                node={n}
                x={pos.x}
                y={pos.y}
                hasDeps={hasDepSet.has(n.planId)}
                hasDependents={hasDependentSet.has(n.planId)}
                rightDotColor={dotColorClass(n.plan.state)}
                onPlanClick={onPlanClick}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
});

export type { DagPlan };
