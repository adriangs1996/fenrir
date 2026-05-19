import { describe, expect, it } from "vitest";

import {
  expandSkillReferences,
  findSkillReferenceMatches,
  formatSkillReferenceToken,
} from "./skillReferences";

const SKILLS = [
  {
    name: "docs",
    body: "Read the docs first.",
  },
  {
    name: "security",
    body: "Review for security issues.",
  },
] as const;

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

describe("expandSkillReferences", () => {
  it("expands matching skill references into their bodies", () => {
    expect(expandSkillReferences("Use $docs and $security", SKILLS)).toEqual({
      text: "Use Read the docs first. and Review for security issues.",
      expandedSkillNames: ["docs", "security"],
      unresolvedSkillNames: [],
    });
  });

  it("leaves unknown skill references intact while reporting them", () => {
    expect(expandSkillReferences("Use $unknown and $docs", SKILLS)).toEqual({
      text: "Use $unknown and Read the docs first.",
      expandedSkillNames: ["docs"],
      unresolvedSkillNames: ["unknown"],
    });
  });

  it("returns the original text when no skill can be resolved", () => {
    expect(expandSkillReferences("Use $unknown only", SKILLS)).toEqual({
      text: "Use $unknown only",
      expandedSkillNames: [],
      unresolvedSkillNames: ["unknown"],
    });
  });
});
