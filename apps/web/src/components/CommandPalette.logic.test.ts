import { describe, expect, it } from "vitest";
import {
  buildRootGroups,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  normalizeSearchText,
  type CommandPaletteActionItem,
} from "./CommandPalette.logic";

function actionItem(input: {
  value: string;
  searchTerms: string[];
  title?: string;
}): CommandPaletteActionItem {
  return {
    kind: "action",
    value: input.value,
    searchTerms: input.searchTerms,
    title: input.title ?? input.value,
    icon: null,
    run: async () => undefined,
  };
}

describe("CommandPalette.logic", () => {
  it("normalizes search text", () => {
    expect(normalizeSearchText("  New   Thread  ")).toBe("new thread");
  });

  it("filters root groups and appends project and thread matches", () => {
    const groups = buildRootGroups({
      actionItems: [actionItem({ value: "settings", searchTerms: ["settings", "preferences"] })],
      recentThreadItems: [actionItem({ value: "recent", searchTerms: ["alpha thread"] })],
    });

    const filtered = filterCommandPaletteGroups({
      activeGroups: groups,
      query: "alpha",
      isInSubmenu: false,
      projectSearchItems: [actionItem({ value: "project", searchTerms: ["alpha project"] })],
      threadSearchItems: [actionItem({ value: "thread", searchTerms: ["alpha thread"] })],
    });

    expect(filtered.map((group) => group.value)).toEqual(["projects-search", "threads-search"]);
  });

  it("supports actions-only filtering", () => {
    const groups = buildRootGroups({
      actionItems: [actionItem({ value: "settings", searchTerms: ["settings", "preferences"] })],
      recentThreadItems: [actionItem({ value: "recent", searchTerms: ["recent thread"] })],
    });

    const filtered = filterCommandPaletteGroups({
      activeGroups: groups,
      query: ">sett",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.value).toBe("actions");
    expect(filtered[0]?.items.map((item) => item.value)).toEqual(["settings"]);
  });

  it("returns the correct placeholder", () => {
    expect(getCommandPaletteInputPlaceholder("root")).toContain("projects");
    expect(getCommandPaletteInputPlaceholder("submenu")).toBe("Search...");
  });
});
