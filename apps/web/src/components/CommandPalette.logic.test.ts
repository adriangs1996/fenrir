import { describe, expect, it } from "vitest";
import {
  buildRootGroups,
  filterBrowseEntries,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteItemValue,
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

  it("reads item values from Base UI highlight payloads", () => {
    expect(getCommandPaletteItemValue("action:settings")).toBe("action:settings");
    expect(getCommandPaletteItemValue({ value: "thread:1" })).toBe("thread:1");
    expect(getCommandPaletteItemValue({ value: 42 })).toBeNull();
    expect(getCommandPaletteItemValue(null)).toBeNull();
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

  it("filters browse entries by the current leaf segment and hides dot-directories by default", () => {
    const filtered = filterBrowseEntries({
      browseEntries: [
        { name: ".git", fullPath: "/repo/.git" },
        { name: "alpha", fullPath: "/repo/alpha" },
        { name: "beta", fullPath: "/repo/beta" },
      ],
      browseFilterQuery: "a",
      highlightedItemValue: null,
    });

    expect(filtered.filteredEntries.map((entry) => entry.name)).toEqual(["alpha"]);
    expect(filtered.exactEntry).toBeNull();
  });

  it("preserves dot-directory results when the browse query starts with a dot", () => {
    const filtered = filterBrowseEntries({
      browseEntries: [
        { name: ".git", fullPath: "/repo/.git" },
        { name: ".github", fullPath: "/repo/.github" },
        { name: "alpha", fullPath: "/repo/alpha" },
      ],
      browseFilterQuery: ".g",
      highlightedItemValue: "browse:/repo/.git",
    });

    expect(filtered.filteredEntries.map((entry) => entry.name)).toEqual([".git", ".github"]);
    expect(filtered.highlightedEntry?.fullPath).toBe("/repo/.git");
  });

  it("returns the correct placeholder", () => {
    expect(getCommandPaletteInputPlaceholder("root")).toContain("projects");
    expect(getCommandPaletteInputPlaceholder("root-browse")).toContain("project path");
    expect(getCommandPaletteInputPlaceholder("submenu")).toBe("Search...");
    expect(getCommandPaletteInputPlaceholder("submenu-browse")).toContain("Enter path");
  });
});
