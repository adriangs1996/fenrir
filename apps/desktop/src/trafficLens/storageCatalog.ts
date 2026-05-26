import type { TrafficLensStorageOriginSummary } from "@fenrir/contracts";

export interface StorageOriginCatalogEntry {
  profileId: string;
  origin: string;
  lastDocumentUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  liveSessionTabIds: Set<string>;
}

export function storageOriginCatalogKey(profileId: string, origin: string): string {
  return `${profileId}::${origin}`;
}

export function upsertStorageOriginCatalogEntry(
  catalog: Map<string, StorageOriginCatalogEntry>,
  input: {
    profileId: string;
    origin: string;
    lastDocumentUrl: string | null;
    timestamp: string;
  },
): StorageOriginCatalogEntry {
  const key = storageOriginCatalogKey(input.profileId, input.origin);
  const existing = catalog.get(key);
  const next: StorageOriginCatalogEntry = existing
    ? {
        ...existing,
        lastDocumentUrl: input.lastDocumentUrl ?? existing.lastDocumentUrl,
        lastSeenAt: input.timestamp,
      }
    : {
        profileId: input.profileId,
        origin: input.origin,
        lastDocumentUrl: input.lastDocumentUrl,
        firstSeenAt: input.timestamp,
        lastSeenAt: input.timestamp,
        liveSessionTabIds: new Set<string>(),
      };
  catalog.set(key, next);
  return next;
}

export function addLiveSessionTab(
  catalog: Map<string, StorageOriginCatalogEntry>,
  profileId: string,
  origin: string,
  tabId: string,
): void {
  const entry = catalog.get(storageOriginCatalogKey(profileId, origin));
  if (!entry) {
    return;
  }
  entry.liveSessionTabIds.add(tabId);
}

export function removeLiveSessionTab(
  catalog: Map<string, StorageOriginCatalogEntry>,
  tabId: string,
): void {
  for (const entry of catalog.values()) {
    entry.liveSessionTabIds.delete(tabId);
  }
}

export function listStorageOriginSummaries(
  catalog: Map<string, StorageOriginCatalogEntry>,
  profileId: string,
): TrafficLensStorageOriginSummary[] {
  return [...catalog.values()]
    .filter((entry) => entry.profileId === profileId)
    .toSorted((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .map((entry) => ({
      profileId: entry.profileId as any,
      origin: entry.origin,
      lastDocumentUrl: entry.lastDocumentUrl,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      latestCookieVersionId: null,
      latestLocalStorageVersionId: null,
      latestSessionStorageVersionId: null,
      hasLiveSessionStorage: entry.liveSessionTabIds.size > 0,
      liveSessionTabIds: [...entry.liveSessionTabIds],
    }));
}
