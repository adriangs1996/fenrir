import { WorkflowRunId } from "@fenrir/contracts";
import { type DiffRouteSearch, parseDiffRouteSearch } from "./diffRouteSearch";

export interface WorkflowRouteSearch {
  workflowPanel?: "1" | undefined;
  workflowRunId?: WorkflowRunId | undefined;
}

export type ThreadRouteSearch = DiffRouteSearch & WorkflowRouteSearch;

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseThreadRouteSearch(search: Record<string, unknown>): ThreadRouteSearch {
  const workflowPanelRequested =
    search.workflowPanel === "1" || search.workflowPanel === 1 || search.workflowPanel === true;
  const workflowRunIdRaw = normalizeSearchString(search.workflowRunId);
  const workflowRunId = workflowRunIdRaw ? WorkflowRunId.make(workflowRunIdRaw) : undefined;
  return {
    ...parseDiffRouteSearch(search),
    ...(workflowPanelRequested || workflowRunId ? { workflowPanel: "1" } : {}),
    ...(workflowRunId ? { workflowRunId } : {}),
  };
}
