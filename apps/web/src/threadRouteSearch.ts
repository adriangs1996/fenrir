import { type DiffRouteSearch, parseDiffRouteSearch } from "./diffRouteSearch";
import { type ReviewRouteSearch, parseReviewRouteSearch } from "./modules/review";

export type ThreadRouteSearch = DiffRouteSearch & ReviewRouteSearch;

export function parseThreadRouteSearch(search: Record<string, unknown>): ThreadRouteSearch {
  return {
    ...parseDiffRouteSearch(search),
    ...parseReviewRouteSearch(search),
  };
}
