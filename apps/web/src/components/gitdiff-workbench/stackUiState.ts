import type { ReviewRawLaneKind } from "@fenrir/contracts";

export type DiffViewMode = "unified" | "split";

export const RAW_LANE_ORDER: ReviewRawLaneKind[] = [
  "unstaged",
  "staged",
  "committed",
  "inverse-edit",
  "ignored",
];

export function laneLabel(lane: ReviewRawLaneKind): string {
  switch (lane) {
    case "ignored":
      return "Ignored";
    case "unstaged":
      return "Unstaged";
    case "staged":
      return "Staged";
    case "committed":
      return "Committed";
    case "inverse-edit":
      return "Inverse Edit";
  }
}

export function changeKindLabel(kind: string): string {
  switch (kind) {
    case "delete":
      return "Deleted";
    case "rename":
      return "Renamed";
    case "binary":
      return "Binary";
    case "permission-only":
      return "Mode";
    case "ignored":
      return "Ignored";
    default:
      return "Modified";
  }
}
