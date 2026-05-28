import { describe, expect, it } from "vitest";
import { parseThreadRouteSearch } from "./threadRouteSearch";

describe("parseThreadRouteSearch", () => {
  it("parses diff route state and ignores source-control tab state", () => {
    expect(
      parseThreadRouteSearch({
        diff: "1",
        diffTurnId: "turn-1",
        tab: "source-control",
        sourceControlMode: "providers",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });
});
