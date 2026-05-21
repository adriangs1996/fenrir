import { describe, expect, it } from "vitest";
import { parseThreadRouteSearch } from "./threadRouteSearch";

describe("parseThreadRouteSearch", () => {
  it("merges diff and review route state", () => {
    expect(
      parseThreadRouteSearch({
        diff: "1",
        diffTurnId: "turn-1",
        tab: "review",
        reviewMode: "raw",
        reviewScope: "branch",
        reviewChunkId: "chunk-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      tab: "review",
      reviewMode: "raw",
      reviewScope: "branch",
      reviewChunkId: "chunk-1",
    });
  });
});
