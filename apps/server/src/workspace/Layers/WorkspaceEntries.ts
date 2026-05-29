import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";

import { Cache, Duration, Effect, Exit, Layer, Path } from "effect";

import {
  type FilesystemBrowseResult,
  type ProjectEntry,
  type ProjectListEntriesResult,
} from "@fenrir/contracts";

import {
  VcsDriverRegistry,
  VcsDriverRegistryLive,
  type VcsDriverHandle,
} from "../../vcs/VcsDriverRegistry.ts";
import {
  WorkspaceEntries,
  WorkspaceEntriesError,
  type WorkspaceEntriesShape,
} from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const WORKSPACE_CACHE_TTL_MS = 15_000;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

interface WorkspaceIndex {
  scannedAt: number;
  entries: SearchableWorkspaceEntry[];
  truncated: boolean;
}

interface SearchableWorkspaceEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

interface RankedWorkspaceEntry {
  entry: SearchableWorkspaceEntry;
  score: number;
}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function isExplicitRelativePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function hasTrailingPathSeparator(value: string): boolean {
  return /[\\/]$/.test(value);
}

function trimTrailingPathSeparators(value: string): string {
  if (value === "/" || value === "\\") {
    return value;
  }
  if (/^[A-Za-z]:[\\/]?$/.test(value)) {
    return `${value.slice(0, 2)}\\`;
  }
  return value.replace(/[\\/]+$/g, "");
}

function splitBrowsePartialPath(input: {
  partialPath: string;
  cwd?: string | undefined;
  path: Path.Path;
}):
  | { error: string }
  | {
      absoluteParentPath: string;
      childPrefix: string;
    } {
  const trimmed = input.partialPath.trim();
  if (trimmed.length === 0) {
    return { error: "Filesystem browse path cannot be empty." };
  }

  if (isExplicitRelativePath(trimmed) && !input.cwd) {
    return { error: "Relative filesystem browse paths require a current project." };
  }

  const hasTrailing = hasTrailingPathSeparator(trimmed);
  const resolvedPath = input.cwd
    ? input.path.resolve(input.cwd, trimmed)
    : input.path.resolve(trimmed);

  if (hasTrailing) {
    return {
      absoluteParentPath: trimTrailingPathSeparators(resolvedPath),
      childPrefix: "",
    };
  }

  const lastSeparatorIndex = Math.max(
    resolvedPath.lastIndexOf("/"),
    resolvedPath.lastIndexOf("\\"),
  );
  if (lastSeparatorIndex < 0) {
    return {
      absoluteParentPath: input.cwd ? input.path.resolve(input.cwd) : input.path.resolve("."),
      childPrefix: resolvedPath,
    };
  }

  const absoluteParentPath = resolvedPath.slice(0, lastSeparatorIndex + 1);
  const childPrefix = resolvedPath.slice(lastSeparatorIndex + 1);
  return {
    absoluteParentPath: trimTrailingPathSeparators(absoluteParentPath),
    childPrefix,
  };
}

function toSearchableWorkspaceEntry(entry: ProjectEntry): SearchableWorkspaceEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function normalizeQuery(input: string): string {
  return input
    .trim()
    .replace(/^[@./]+/, "")
    .toLowerCase();
}

function scoreSubsequenceMatch(value: string, query: string): number | null {
  if (!query) return 0;

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -1;
  let gapPenalty = 0;

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex;
    }
    if (previousMatchIndex !== -1) {
      gapPenalty += valueIndex - previousMatchIndex - 1;
    }

    previousMatchIndex = valueIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length;
      const lengthPenalty = Math.min(64, value.length - query.length);
      return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
    }
  }

  return null;
}

function scoreEntry(entry: SearchableWorkspaceEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const { normalizedPath, normalizedName } = entry;

  if (normalizedName === query) return 0;
  if (normalizedPath === query) return 1;
  if (normalizedName.startsWith(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(`/${query}`)) return 4;
  if (normalizedName.includes(query)) return 5;
  if (normalizedPath.includes(query)) return 6;

  const nameFuzzyScore = scoreSubsequenceMatch(normalizedName, query);
  if (nameFuzzyScore !== null) {
    return 100 + nameFuzzyScore;
  }

  const pathFuzzyScore = scoreSubsequenceMatch(normalizedPath, query);
  if (pathFuzzyScore !== null) {
    return 200 + pathFuzzyScore;
  }

  return null;
}

function compareRankedWorkspaceEntries(
  left: RankedWorkspaceEntry,
  right: RankedWorkspaceEntry,
): number {
  const scoreDelta = left.score - right.score;
  if (scoreDelta !== 0) return scoreDelta;
  return left.entry.path.localeCompare(right.entry.path);
}

function findInsertionIndex(
  rankedEntries: RankedWorkspaceEntry[],
  candidate: RankedWorkspaceEntry,
): number {
  let low = 0;
  let high = rankedEntries.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const current = rankedEntries[middle];
    if (!current) {
      break;
    }

    if (compareRankedWorkspaceEntries(candidate, current) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

function insertRankedEntry(
  rankedEntries: RankedWorkspaceEntry[],
  candidate: RankedWorkspaceEntry,
  limit: number,
): void {
  if (limit <= 0) {
    return;
  }

  const insertionIndex = findInsertionIndex(rankedEntries, candidate);
  if (rankedEntries.length < limit) {
    rankedEntries.splice(insertionIndex, 0, candidate);
    return;
  }

  if (insertionIndex >= limit) {
    return;
  }

  rankedEntries.splice(insertionIndex, 0, candidate);
  rankedEntries.pop();
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

const processErrorDetail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

function compareProjectEntries(left: ProjectEntry, right: ProjectEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.path.localeCompare(right.path);
}

export const makeWorkspaceEntries = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry;
  const workspacePaths = yield* WorkspacePaths;

  const resolveWorkspaceVcs = (cwd: string): Effect.Effect<VcsDriverHandle | null> =>
    vcsRegistry.detect({ cwd }).pipe(Effect.catch(() => Effect.succeed(null)));

  const filterIgnoredPaths = (
    handle: VcsDriverHandle | null,
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    handle
      ? handle.driver.filterIgnoredPaths(cwd, relativePaths).pipe(
          Effect.map((paths) => [...paths]),
          Effect.catch(() => Effect.succeed(relativePaths)),
        )
      : Effect.succeed(relativePaths);

  const buildWorkspaceIndexFromVcs = Effect.fn("WorkspaceEntries.buildWorkspaceIndexFromVcs")(
    function* (cwd: string, handle: VcsDriverHandle | null) {
      if (!handle) {
        return null;
      }

      const listedFiles = yield* handle.driver
        .listWorkspaceFiles(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      if (!listedFiles) {
        return null;
      }

      const listedPaths = [...listedFiles.paths]
        .map((entry) => toPosixPath(entry))
        .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
      const filePaths = yield* filterIgnoredPaths(handle, cwd, listedPaths);

      const directorySet = new Set<string>();
      for (const filePath of filePaths) {
        for (const directoryPath of directoryAncestorsOf(filePath)) {
          if (!isPathInIgnoredDirectory(directoryPath)) {
            directorySet.add(directoryPath);
          }
        }
      }

      const directoryEntries = [...directorySet]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (directoryPath): ProjectEntry => ({
            path: directoryPath,
            kind: "directory",
            parentPath: parentPathOf(directoryPath),
          }),
        )
        .map(toSearchableWorkspaceEntry);
      const fileEntries = [...new Set(filePaths)]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (filePath): ProjectEntry => ({
            path: filePath,
            kind: "file",
            parentPath: parentPathOf(filePath),
          }),
        )
        .map(toSearchableWorkspaceEntry);

      const entries = [...directoryEntries, ...fileEntries];
      return {
        scannedAt: Date.now(),
        entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
        truncated: listedFiles.truncated || entries.length > WORKSPACE_INDEX_MAX_ENTRIES,
      };
    },
  );

  const readDirectoryEntries = Effect.fn("WorkspaceEntries.readDirectoryEntries")(function* (
    cwd: string,
    relativeDir: string,
  ): Effect.fn.Return<
    { readonly relativeDir: string; readonly dirents: Dirent[] | null },
    WorkspaceEntriesError
  > {
    return yield* Effect.tryPromise({
      try: async () => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        const dirents = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
        return { relativeDir, dirents };
      },
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd,
          operation: "workspaceEntries.readDirectoryEntries",
          detail: processErrorDetail(cause),
          cause,
        }),
    }).pipe(
      Effect.catchIf(
        () => relativeDir.length > 0,
        () => Effect.succeed({ relativeDir, dirents: null }),
      ),
    );
  });

  const buildWorkspaceIndexFromFilesystem = Effect.fn(
    "WorkspaceEntries.buildWorkspaceIndexFromFilesystem",
  )(function* (
    cwd: string,
    handle: VcsDriverHandle | null,
  ): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const shouldFilterWithVcsIgnore = handle !== null;

    let pendingDirectories: string[] = [""];
    const entries: SearchableWorkspaceEntry[] = [];
    let truncated = false;

    while (pendingDirectories.length > 0 && !truncated) {
      const currentDirectories = pendingDirectories;
      pendingDirectories = [];

      const directoryEntries = yield* Effect.forEach(
        currentDirectories,
        (relativeDir) => readDirectoryEntries(cwd, relativeDir),
        { concurrency: WORKSPACE_SCAN_READDIR_CONCURRENCY },
      );

      const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
        const { relativeDir, dirents } = directoryEntry;
        if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

        dirents.sort((left, right) => left.name.localeCompare(right.name));
        const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
        for (const dirent of dirents) {
          if (!dirent.name || dirent.name === "." || dirent.name === "..") {
            continue;
          }
          if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
            continue;
          }
          if (!dirent.isDirectory() && !dirent.isFile()) {
            continue;
          }

          const relativePath = toPosixPath(
            relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
          );
          if (isPathInIgnoredDirectory(relativePath)) {
            continue;
          }
          candidates.push({ dirent, relativePath });
        }
        return candidates;
      });

      const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
        candidateEntries.map((entry) => entry.relativePath),
      );
      const allowedPathSet = shouldFilterWithVcsIgnore
        ? new Set(yield* filterIgnoredPaths(handle, cwd, candidatePaths))
        : null;

      for (const candidateEntries of candidateEntriesByDirectory) {
        for (const candidate of candidateEntries) {
          if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
            continue;
          }

          const entry = toSearchableWorkspaceEntry({
            path: candidate.relativePath,
            kind: candidate.dirent.isDirectory() ? "directory" : "file",
            parentPath: parentPathOf(candidate.relativePath),
          });
          entries.push(entry);

          if (candidate.dirent.isDirectory()) {
            pendingDirectories.push(candidate.relativePath);
          }

          if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
            truncated = true;
            break;
          }
        }

        if (truncated) {
          break;
        }
      }
    }

    return {
      scannedAt: Date.now(),
      entries,
      truncated,
    };
  });

  const buildWorkspaceIndex = Effect.fn("WorkspaceEntries.buildWorkspaceIndex")(function* (
    cwd: string,
  ): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const vcsHandle = yield* resolveWorkspaceVcs(cwd);
    const vcsIndexed = yield* buildWorkspaceIndexFromVcs(cwd, vcsHandle);
    if (vcsIndexed) {
      return vcsIndexed;
    }
    return yield* buildWorkspaceIndexFromFilesystem(cwd, vcsHandle);
  });

  const workspaceIndexCache = yield* Cache.makeWith<string, WorkspaceIndex, WorkspaceEntriesError>(
    buildWorkspaceIndex,
    {
      capacity: WORKSPACE_CACHE_MAX_KEYS,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.millis(WORKSPACE_CACHE_TTL_MS) : Duration.zero,
    },
  );

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceEntriesError({
            cwd,
            operation: "workspaceEntries.normalizeWorkspaceRoot",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const resolveDirectoryWithinWorkspace = Effect.fn(
    "WorkspaceEntries.resolveDirectoryWithinWorkspace",
  )(function* (input: {
    cwd: string;
    relativePath?: string | undefined;
  }): Effect.fn.Return<
    { normalizedCwd: string; absolutePath: string; relativePath: string },
    WorkspaceEntriesError
  > {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    const requestedRelativePath = input.relativePath?.trim() ?? "";

    if (requestedRelativePath.length > 0 && path.isAbsolute(requestedRelativePath)) {
      return yield* new WorkspaceEntriesError({
        cwd: input.cwd,
        operation: "workspaceEntries.resolveDirectoryWithinWorkspace",
        detail: "Workspace path must stay within the project root.",
      });
    }

    const absolutePath =
      requestedRelativePath.length === 0
        ? normalizedCwd
        : path.resolve(normalizedCwd, requestedRelativePath);
    const relativeToRoot = toPosixPath(path.relative(normalizedCwd, absolutePath));
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith("../") ||
      path.isAbsolute(relativeToRoot)
    ) {
      return yield* new WorkspaceEntriesError({
        cwd: input.cwd,
        operation: "workspaceEntries.resolveDirectoryWithinWorkspace",
        detail: "Workspace path must stay within the project root.",
      });
    }

    return {
      normalizedCwd,
      absolutePath,
      relativePath: relativeToRoot === "." ? "" : relativeToRoot,
    };
  });

  const invalidate: WorkspaceEntriesShape["invalidate"] = Effect.fn("WorkspaceEntries.invalidate")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.catch(() => Effect.succeed(cwd)),
      );
      yield* Cache.invalidate(workspaceIndexCache, cwd);
      if (normalizedCwd !== cwd) {
        yield* Cache.invalidate(workspaceIndexCache, normalizedCwd);
      }
    },
  );

  const listEntries: WorkspaceEntriesShape["listEntries"] = Effect.fn(
    "WorkspaceEntries.listEntries",
  )(function* (input) {
    const target = yield* resolveDirectoryWithinWorkspace({
      cwd: input.cwd,
      relativePath: input.relativePath,
    });
    const dirents = yield* Effect.tryPromise({
      try: () =>
        fsPromises.readdir(target.absolutePath, {
          withFileTypes: true,
        }),
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd: input.cwd,
          operation: "workspaceEntries.listEntries",
          detail: processErrorDetail(cause),
          cause,
        }),
    });

    const candidates: Array<{ entry: ProjectEntry; path: string }> = [];
    for (const dirent of dirents) {
      if (!dirent.name || dirent.name === "." || dirent.name === "..") {
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isFile()) {
        continue;
      }
      if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
        continue;
      }

      const childPath = toPosixPath(
        target.relativePath ? path.join(target.relativePath, dirent.name) : dirent.name,
      );
      if (isPathInIgnoredDirectory(childPath)) {
        continue;
      }

      candidates.push({
        path: childPath,
        entry: {
          path: childPath,
          kind: dirent.isDirectory() ? "directory" : "file",
          ...(target.relativePath ? { parentPath: target.relativePath } : {}),
        },
      });
    }

    const handle = yield* resolveWorkspaceVcs(target.normalizedCwd);
    const allowedPaths = new Set(
      yield* filterIgnoredPaths(
        handle,
        target.normalizedCwd,
        candidates.map((candidate) => candidate.path),
      ),
    );
    const sortedEntries = candidates
      .filter((candidate) => allowedPaths.has(candidate.path))
      .map((candidate) => candidate.entry)
      .toSorted(compareProjectEntries);
    const limit = Math.max(0, Math.floor(input.limit));

    return {
      entries: sortedEntries.slice(0, limit),
      truncated: sortedEntries.length > limit,
    } satisfies ProjectListEntriesResult;
  });

  const search: WorkspaceEntriesShape["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      return yield* Cache.get(workspaceIndexCache, normalizedCwd).pipe(
        Effect.map((index) => {
          const normalizedQuery = normalizeQuery(input.query);
          const limit = Math.max(0, Math.floor(input.limit));
          const rankedEntries: RankedWorkspaceEntry[] = [];
          let matchedEntryCount = 0;

          for (const entry of index.entries) {
            const score = scoreEntry(entry, normalizedQuery);
            if (score === null) {
              continue;
            }

            matchedEntryCount += 1;
            insertRankedEntry(rankedEntries, { entry, score }, limit);
          }

          return {
            entries: rankedEntries.map((candidate) => candidate.entry),
            truncated: index.truncated || matchedEntryCount > limit,
          };
        }),
      );
    },
  );

  const browse: WorkspaceEntriesShape["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const split = splitBrowsePartialPath({
        partialPath: input.partialPath,
        cwd: input.cwd,
        path,
      });
      if ("error" in split) {
        return yield* new WorkspaceEntriesError({
          cwd: input.cwd ?? input.partialPath,
          operation: "workspaceEntries.browse",
          detail: split.error,
        });
      }

      const normalizedParentPath = yield* workspacePaths
        .normalizeWorkspaceRoot(split.absoluteParentPath)
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceEntriesError({
                cwd: split.absoluteParentPath,
                operation: "workspaceEntries.browse",
                detail: cause.message,
                cause,
              }),
          ),
        );

      const dirents = yield* Effect.tryPromise({
        try: () =>
          fsPromises.readdir(normalizedParentPath, {
            withFileTypes: true,
          }),
        catch: (cause) =>
          new WorkspaceEntriesError({
            cwd: normalizedParentPath,
            operation: "workspaceEntries.browse",
            detail: processErrorDetail(cause),
            cause,
          }),
      });

      const normalizedPrefix = split.childPrefix.toLowerCase();
      const entries = dirents
        .filter((entry): entry is Dirent => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          fullPath: path.join(normalizedParentPath, entry.name),
        }))
        .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
        .toSorted((left, right) => left.name.localeCompare(right.name));

      return {
        parentPath: normalizedParentPath,
        entries,
      } satisfies FilesystemBrowseResult;
    },
  );

  return {
    browse,
    invalidate,
    listEntries,
    search,
  } satisfies WorkspaceEntriesShape;
});

export const WorkspaceEntriesLive = Layer.effect(WorkspaceEntries, makeWorkspaceEntries).pipe(
  Layer.provide(VcsDriverRegistryLive),
);
