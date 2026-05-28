import { type DiffRouteSearch, parseDiffRouteSearch } from "./diffRouteSearch";

export type ThreadRouteSearch = DiffRouteSearch;

export function parseThreadRouteSearch(search: Record<string, unknown>): ThreadRouteSearch {
  return parseDiffRouteSearch(search);
}
