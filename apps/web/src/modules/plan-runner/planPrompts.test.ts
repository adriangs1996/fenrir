import { describe, expect, it } from "vitest";

import { buildNewPlanComposerPrompt, NEW_PLAN_PROMPT } from "./planPrompts";

describe("buildNewPlanComposerPrompt", () => {
  it("uses the plan prompt for an empty composer", () => {
    expect(buildNewPlanComposerPrompt("   ")).toBe(NEW_PLAN_PROMPT);
  });

  it("keeps existing feature text after the plan prompt", () => {
    expect(buildNewPlanComposerPrompt("Add project search")).toBe(
      `${NEW_PLAN_PROMPT}Add project search`,
    );
  });

  it("does not duplicate an existing plan prompt", () => {
    const prompt = `${NEW_PLAN_PROMPT}Add project search`;

    expect(buildNewPlanComposerPrompt(prompt)).toBe(prompt);
  });
});
