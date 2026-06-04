import { describe, expect, it } from "vitest";
import { Option } from "effect";
import type { ChangeRequest } from "@fenrir/contracts/sourceControl";

import { selectProviderStackChain } from "../stackTopology.ts";

function changeRequest(input: {
  readonly number: number;
  readonly baseRefName: string;
  readonly headRefName: string;
}): ChangeRequest {
  return {
    provider: "github",
    number: input.number,
    title: `PR ${input.number}`,
    url: `https://github.com/fenrir/fenrir/pull/${input.number}`,
    baseRefName: input.baseRefName,
    headRefName: input.headRefName,
    state: "open",
    updatedAt: Option.none(),
  };
}

describe("SourceControlStackService topology", () => {
  it("discovers a main <- branch-a <- branch-b <- branch-c chain", () => {
    const result = selectProviderStackChain({
      selectedHeadRefName: "branch-c",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "branch-a", headRefName: "branch-b" }),
        changeRequest({ number: 3, baseRefName: "branch-b", headRefName: "branch-c" }),
      ],
    });

    expect(result.rootBaseRef).toBe("main");
    expect(result.selected.map((node) => node.headRefName)).toEqual([
      "branch-a",
      "branch-b",
      "branch-c",
    ]);
    expect(result.problems).toEqual([]);
  });

  it("selects the connected chain containing the current branch", () => {
    const result = selectProviderStackChain({
      selectedHeadRefName: "stack-b",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "stack-a" }),
        changeRequest({ number: 2, baseRefName: "stack-a", headRefName: "stack-b" }),
        changeRequest({ number: 3, baseRefName: "main", headRefName: "other-a" }),
      ],
    });

    expect(result.selected.map((node) => node.headRefName)).toEqual(["stack-a", "stack-b"]);
    expect(result.rootBaseRef).toBe("main");
  });

  it("reports ambiguous provider chains and cycles", () => {
    const ambiguous = selectProviderStackChain({
      selectedHeadRefName: null,
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "main", headRefName: "branch-b" }),
      ],
    });
    const cyclic = selectProviderStackChain({
      selectedHeadRefName: "branch-a",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "branch-b", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "branch-a", headRefName: "branch-b" }),
      ],
    });

    expect(ambiguous.problems).toContain("ambiguous-provider-chain");
    expect(cyclic.problems).toContain("cycle-detected");
  });
});
