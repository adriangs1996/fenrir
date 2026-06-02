import type { RemoteDirectoryEntry } from "@fenrir/contracts";

const KIND_RANK: Record<RemoteDirectoryEntry["kind"], number> = {
  directory: 0,
  symlink: 1,
  file: 2,
  other: 3,
};

export function sortRemoteDirectoryEntries(
  entries: readonly RemoteDirectoryEntry[],
): RemoteDirectoryEntry[] {
  return entries.toSorted((left, right) => {
    const kindDelta = KIND_RANK[left.kind] - KIND_RANK[right.kind];
    if (kindDelta !== 0) return kindDelta;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function basenameFromRemotePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/g, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed || path;
}
