import type { SkillSyncState } from "@fenrir/contracts";

import type { SkillManifest, SkillManifestEntry } from "./skillManifest.ts";

export interface SkillManifestDiff {
  readonly state: Extract<SkillSyncState, "synced" | "pending" | "conflict">;
  readonly missing: readonly SkillManifestEntry[];
  readonly extra: readonly SkillManifestEntry[];
  readonly changed: readonly {
    readonly expected: SkillManifestEntry;
    readonly actual: SkillManifestEntry;
  }[];
}

export const diffSkillManifests = (
  expected: SkillManifest,
  actual: SkillManifest,
): SkillManifestDiff => {
  const actualByPath = new Map(actual.entries.map((entry) => [entry.relativePath, entry]));
  const expectedByPath = new Map(expected.entries.map((entry) => [entry.relativePath, entry]));

  const missing: SkillManifestEntry[] = [];
  const changed: Array<{ expected: SkillManifestEntry; actual: SkillManifestEntry }> = [];

  for (const expectedEntry of expected.entries) {
    const actualEntry = actualByPath.get(expectedEntry.relativePath);
    if (!actualEntry) {
      missing.push(expectedEntry);
      continue;
    }

    if (
      actualEntry.kind !== expectedEntry.kind ||
      actualEntry.executable !== expectedEntry.executable ||
      actualEntry.contentHash !== expectedEntry.contentHash
    ) {
      changed.push({ expected: expectedEntry, actual: actualEntry });
    }
  }

  const extra = actual.entries.filter((entry) => !expectedByPath.has(entry.relativePath));

  const state: SkillManifestDiff["state"] =
    missing.length === 0 && extra.length === 0 && changed.length === 0
      ? "synced"
      : missing.length > 0 && extra.length === 0 && changed.length === 0
        ? "pending"
        : "conflict";

  return { state, missing, extra, changed };
};
