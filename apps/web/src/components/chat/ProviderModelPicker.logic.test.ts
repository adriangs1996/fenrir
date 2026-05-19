import { describe, expect, it } from "vitest";

import {
  providerModelKey,
  searchProviderModelPickerItems,
  splitProviderModelPickerSection,
  type ProviderModelPickerItem,
} from "./ProviderModelPicker.logic";

const ITEMS: ProviderModelPickerItem[] = [
  {
    provider: "codex",
    providerLabel: "Codex",
    slug: "gpt-5-codex",
    name: "GPT-5 Codex",
    isFavorite: false,
  },
  {
    provider: "codex",
    providerLabel: "Codex",
    slug: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    isFavorite: true,
  },
  {
    provider: "claudeAgent",
    providerLabel: "Claude",
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isFavorite: false,
  },
];

describe("providerModelKey", () => {
  it("builds a stable provider/model key", () => {
    expect(providerModelKey("codex", "gpt-5")).toBe("codex:gpt-5");
  });
});

describe("searchProviderModelPickerItems", () => {
  it("searches by model name", () => {
    expect(searchProviderModelPickerItems(ITEMS, "sonnet", null).map((item) => item.slug)).toEqual([
      "claude-sonnet-4-6",
    ]);
  });

  it("searches by provider label", () => {
    expect(searchProviderModelPickerItems(ITEMS, "codex", null).map((item) => item.slug)).toEqual([
      "gpt-5.3-codex",
      "gpt-5-codex",
    ]);
  });

  it("respects a locked provider", () => {
    expect(
      searchProviderModelPickerItems(ITEMS, "codex", "claudeAgent").map((item) => item.slug),
    ).toEqual([]);
  });
});

describe("splitProviderModelPickerSection", () => {
  it("separates favorites from normal models for a provider section", () => {
    expect(splitProviderModelPickerSection(ITEMS, "codex", null)).toEqual({
      favorites: [ITEMS[1]!],
      models: [ITEMS[0]!],
    });
  });

  it("returns only favorites for the favorites section", () => {
    expect(splitProviderModelPickerSection(ITEMS, "favorites", null)).toEqual({
      favorites: [ITEMS[1]!],
      models: [],
    });
  });
});
