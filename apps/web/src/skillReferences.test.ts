import { describe, expect, it } from "vitest";

import { findSkillReferenceMatches, formatSkillReferenceToken } from "./skillReferences";

describe("formatSkillReferenceToken", () => {
  it("formats a skill token with a leading dollar sign", () => {
    expect(formatSkillReferenceToken("docs")).toBe("$docs");
  });
});

describe("findSkillReferenceMatches", () => {
  it("finds skill references without consuming surrounding whitespace", () => {
    expect(findSkillReferenceMatches("Use $docs before $security review")).toEqual([
      {
        name: "docs",
        rawText: "$docs",
        start: "Use ".length,
        end: "Use $docs".length,
      },
      {
        name: "security",
        rawText: "$security",
        start: "Use $docs before ".length,
        end: "Use $docs before $security".length,
      },
    ]);
  });
});
