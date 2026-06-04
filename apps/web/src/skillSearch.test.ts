import type { ServerProviderSkill } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import { searchProviderSkills } from "./skillSearch";

function skill(input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name" | "path">) {
  return {
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("searchProviderSkills", () => {
  it("returns each skill name once for prompt-addressable menu entries", () => {
    const results = searchProviderSkills(
      [
        skill({
          name: "vercel-plugin:next-upgrade",
          path: "/skills/next-upgrade/SKILL.md",
          description: "Upgrade Next.js projects.",
        }),
        skill({
          name: "vercel-plugin:next-upgrade",
          path: "/skills/next-upgrade/upstream/SKILL.md",
          description: "Upstream duplicate.",
        }),
        skill({
          name: "review",
          path: "/skills/review/SKILL.md",
        }),
      ],
      "",
    );

    expect(results.map((result) => result.name)).toEqual(["vercel-plugin:next-upgrade", "review"]);
  });

  it("keeps the highest-ranked duplicate for searched results", () => {
    const results = searchProviderSkills(
      [
        skill({
          name: "deploy",
          path: "/skills/deploy/SKILL.md",
          description: "Deploy changes.",
        }),
        skill({
          name: "deploy",
          path: "/skills/deploy/upstream/SKILL.md",
          displayName: "Deploy Vercel",
          description: "Deploy changes.",
        }),
      ],
      "deploy",
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe("/skills/deploy/upstream/SKILL.md");
  });
});
