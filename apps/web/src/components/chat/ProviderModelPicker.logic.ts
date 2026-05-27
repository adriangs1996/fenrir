import type { ProviderSelectionKind } from "@fenrir/contracts";

export type ModelPickerSection = ProviderSelectionKind | "favorites";

export interface ProviderModelPickerItem {
  provider: ProviderSelectionKind;
  providerLabel: string;
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  isFavorite: boolean;
}

export function providerModelKey(provider: ProviderSelectionKind, model: string): string {
  return `${provider}:${model}`;
}

function scoreField(field: string, query: string, weight: number): number {
  const normalizedField = field.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (normalizedField === normalizedQuery) {
    return weight * 100;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return weight * 60;
  }
  if (normalizedField.includes(normalizedQuery)) {
    return weight * 30;
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }
  const matchedTokenCount = tokens.filter((token) => normalizedField.includes(token)).length;
  if (matchedTokenCount === 0) {
    return 0;
  }
  return weight * (matchedTokenCount / tokens.length) * 20;
}

function scoreProviderModelPickerItem(item: ProviderModelPickerItem, query: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const score =
    scoreField(item.name, normalizedQuery, 5) +
    scoreField(item.slug, normalizedQuery, 4) +
    (item.shortName ? scoreField(item.shortName, normalizedQuery, 5) : 0) +
    (item.subProvider ? scoreField(item.subProvider, normalizedQuery, 3) : 0) +
    scoreField(item.providerLabel, normalizedQuery, 2);

  return score > 0 ? score : null;
}

export function searchProviderModelPickerItems(
  items: ReadonlyArray<ProviderModelPickerItem>,
  query: string,
  lockedProvider: ProviderSelectionKind | null,
): ProviderModelPickerItem[] {
  const ranked = items
    .filter((item) => lockedProvider === null || item.provider === lockedProvider)
    .map((item) => ({
      item,
      score: scoreProviderModelPickerItem(item, query),
    }))
    .filter(
      (entry): entry is { item: ProviderModelPickerItem; score: number } => entry.score !== null,
    )
    .toSorted((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      if (a.item.isFavorite !== b.item.isFavorite) {
        return a.item.isFavorite ? -1 : 1;
      }
      const providerDelta = a.item.providerLabel.localeCompare(b.item.providerLabel);
      if (providerDelta !== 0) {
        return providerDelta;
      }
      return a.item.name.localeCompare(b.item.name);
    });

  return ranked.map((entry) => entry.item);
}

export function splitProviderModelPickerSection(
  items: ReadonlyArray<ProviderModelPickerItem>,
  section: ModelPickerSection,
  lockedProvider: ProviderSelectionKind | null,
): {
  favorites: ProviderModelPickerItem[];
  models: ProviderModelPickerItem[];
} {
  const visibleItems = items.filter((item) => {
    if (lockedProvider !== null && item.provider !== lockedProvider) {
      return false;
    }
    if (section === "favorites") {
      return item.isFavorite;
    }
    return item.provider === section;
  });

  const favorites = visibleItems.filter((item) => item.isFavorite);
  const models = visibleItems.filter((item) => !item.isFavorite);

  return { favorites, models };
}
