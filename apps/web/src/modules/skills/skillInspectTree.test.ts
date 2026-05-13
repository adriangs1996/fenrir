import { describe, expect, it } from "vitest";
import type { ServerSkillFileEntry } from "@fenrir/contracts";
import { buildSkillFileTree } from "./skillInspectTree";

function file(
  relativePath: string,
  scope: ServerSkillFileEntry["scope"],
  overrides: Partial<ServerSkillFileEntry> = {},
): ServerSkillFileEntry {
  return {
    relativePath,
    absolutePath: `/tmp/${relativePath}`,
    executable: false,
    scope,
    ...overrides,
  };
}

describe("buildSkillFileTree", () => {
  it("sorts folders before files and preserves stable relative-path keys", () => {
    const tree = buildSkillFileTree([
      file("support/run.sh", { kind: "providerSpecific", provider: "codex" }),
      file("SKILL.md", { kind: "general" }),
      file("docs/usage.md", { kind: "general" }),
      file("docs/examples/sample.md", { kind: "providerSpecific", provider: "claudeAgent" }),
    ]);

    expect(tree.map((node) => [node.type, node.key])).toEqual([
      ["folder", "docs"],
      ["folder", "support"],
      ["file", "SKILL.md"],
    ]);

    const docsFolder = tree[0];
    expect(docsFolder?.type).toBe("folder");
    if (docsFolder?.type !== "folder") {
      throw new Error("expected folder");
    }

    expect(docsFolder.scopeRollup).toBe("mixed");
    expect(docsFolder.children.map((node) => node.key)).toEqual(["docs/examples", "docs/usage.md"]);
  });

  it("rolls up a uniform provider scope onto ancestor folders", () => {
    const tree = buildSkillFileTree([
      file("provider/config.json", { kind: "providerSpecific", provider: "codex" }),
      file("provider/scripts/build.ts", { kind: "providerSpecific", provider: "codex" }),
    ]);

    const providerFolder = tree[0];
    expect(providerFolder?.type).toBe("folder");
    if (providerFolder?.type !== "folder") {
      throw new Error("expected folder");
    }

    expect(providerFolder.scopeRollup).toBe("codex");
    expect(providerFolder.children[0]).toMatchObject({
      type: "folder",
      key: "provider/scripts",
      scopeRollup: "codex",
    });
  });
});
