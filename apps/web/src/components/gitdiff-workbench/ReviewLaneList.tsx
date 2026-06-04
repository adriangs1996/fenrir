import type { ReviewDiffLane, ReviewRawLaneKind } from "@fenrir/contracts";

import { cn } from "~/lib/utils";
import { RAW_LANE_ORDER, laneLabel } from "./stackUiState";

interface ReviewLaneListProps {
  readonly lanes: ReadonlyArray<ReviewDiffLane>;
  readonly selectedLane: ReviewRawLaneKind | null;
  readonly onSelectLane: (lane: ReviewRawLaneKind) => void;
}

export function ReviewLaneList({ lanes, selectedLane, onSelectLane }: ReviewLaneListProps) {
  const byKind = new Map(lanes.map((lane) => [lane.kind, lane]));
  return (
    <div className="border-b border-border p-2">
      <div className="mb-2 px-1 text-xs font-medium uppercase text-muted-foreground">Lanes</div>
      <div className="flex flex-wrap gap-1">
        {RAW_LANE_ORDER.map((kind) => {
          const lane = byKind.get(kind);
          return (
            <button
              key={kind}
              type="button"
              disabled={!lane || lane.fileCount === 0}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs",
                selectedLane === kind
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent",
                (!lane || lane.fileCount === 0) && "cursor-not-allowed opacity-50",
              )}
              onClick={() => onSelectLane(kind)}
            >
              {laneLabel(kind)}
              <span className="text-[11px]">{lane?.fileCount ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
