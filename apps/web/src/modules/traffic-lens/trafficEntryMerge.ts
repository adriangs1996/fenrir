import type { TrafficLensEntry } from "@fenrir/contracts";

function trafficEntryScore(entry: TrafficLensEntry): number {
  let score = 0;

  if (entry.statusCode !== null) {
    score += 4;
  }
  if (entry.timingCompletedAt !== null) {
    score += 2;
  }
  if (entry.timingResponseAt !== null) {
    score += 1;
  }
  if (entry.contentType !== null) {
    score += 1;
  }
  if (entry.contentLength !== null) {
    score += 1;
  }

  return score;
}

function trafficEntryUpdatedAt(entry: TrafficLensEntry): number {
  return new Date(
    entry.timingCompletedAt ?? entry.timingResponseAt ?? entry.createdAt ?? entry.timingStartedAt,
  ).getTime();
}

function choosePreferredTrafficEntry(
  left: TrafficLensEntry,
  right: TrafficLensEntry,
): TrafficLensEntry {
  const leftScore = trafficEntryScore(left);
  const rightScore = trafficEntryScore(right);

  if (leftScore !== rightScore) {
    return leftScore > rightScore ? left : right;
  }

  const leftUpdatedAt = trafficEntryUpdatedAt(left);
  const rightUpdatedAt = trafficEntryUpdatedAt(right);
  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt > rightUpdatedAt ? left : right;
  }

  return left.id >= right.id ? left : right;
}

export function mergeTrafficEntriesForTab(
  tabId: string,
  liveEntries: readonly TrafficLensEntry[],
  hydratedEntries: readonly TrafficLensEntry[],
): TrafficLensEntry[] {
  const merged = new Map<number, TrafficLensEntry>();

  for (const entry of hydratedEntries) {
    if (entry.tabId === tabId) {
      merged.set(entry.id, entry);
    }
  }

  for (const entry of liveEntries) {
    if (entry.tabId !== tabId) {
      continue;
    }

    const existing = merged.get(entry.id);
    merged.set(entry.id, existing ? choosePreferredTrafficEntry(existing, entry) : entry);
  }

  return [...merged.values()].toSorted((left, right) => right.id - left.id);
}
