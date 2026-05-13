import { describe, expect, it } from "@effect/vitest";

import { makeProviderPathClassifier } from "./providerSkillPathClassifier.ts";

describe("providerSkillPathClassifier", () => {
  it("classifies codex agents/** paths as provider-specific", () => {
    const classify = makeProviderPathClassifier("codex", ["agents"]);

    expect(classify("agents/openai.yaml")).toEqual({
      kind: "providerSpecific",
      provider: "codex",
    });
    expect(classify("scripts/run.sh")).toEqual({ kind: "general" });
  });

  it("treats all Claude paths as general", () => {
    const classify = makeProviderPathClassifier("claudeAgent", []);

    expect(classify("agents/openai.yaml")).toEqual({ kind: "general" });
    expect(classify("references/guide.md")).toEqual({ kind: "general" });
  });
});
