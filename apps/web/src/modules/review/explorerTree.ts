import type { ReviewDiffFileEntry } from "../../../../../packages/contracts/src/review.ts";

export interface ReviewExplorerFileRef {
  readonly laneId: string;
  readonly fileId: string;
  readonly fileEntry: ReviewDiffFileEntry;
}

export interface ReviewExplorerTreeStat {
  readonly insertions: number;
  readonly deletions: number;
}

export interface ReviewExplorerTreeDirectoryNode {
  readonly kind: "directory";
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly stat: ReviewExplorerTreeStat;
  readonly children: readonly ReviewExplorerTreeNode[];
}

export interface ReviewExplorerTreeFileNode {
  readonly kind: "file";
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly stat: ReviewExplorerTreeStat;
  readonly entry: ReviewExplorerFileRef;
}

export type ReviewExplorerTreeNode = ReviewExplorerTreeDirectoryNode | ReviewExplorerTreeFileNode;

interface MutableDirectoryNode {
  readonly name: string;
  readonly path: string;
  readonly stat: {
    insertions: number;
    deletions: number;
  };
  readonly directories: Map<string, MutableDirectoryNode>;
  readonly files: ReviewExplorerTreeFileNode[];
}

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function normalizePathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

function compareByName(a: { readonly name: string }, b: { readonly name: string }): number {
  return a.name.localeCompare(b.name, undefined, SORT_LOCALE_OPTIONS);
}

function compactDirectoryNode(
  node: ReviewExplorerTreeDirectoryNode,
): ReviewExplorerTreeDirectoryNode {
  const compactedChildren = node.children.map((child) =>
    child.kind === "directory" ? compactDirectoryNode(child) : child,
  );

  let compactedNode: ReviewExplorerTreeDirectoryNode = {
    ...node,
    children: compactedChildren,
  };

  while (compactedNode.children.length === 1 && compactedNode.children[0]?.kind === "directory") {
    const onlyChild = compactedNode.children[0];
    compactedNode = {
      kind: "directory",
      key: `dir:${onlyChild.path}`,
      name: `${compactedNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      stat: onlyChild.stat,
      children: onlyChild.children,
    };
  }

  return compactedNode;
}

function toTreeNodes(directory: MutableDirectoryNode): readonly ReviewExplorerTreeNode[] {
  const subdirectories = Array.from(directory.directories.values())
    .toSorted(compareByName)
    .map<ReviewExplorerTreeDirectoryNode>((subdirectory) => ({
      kind: "directory",
      key: `dir:${subdirectory.path}`,
      name: subdirectory.name,
      path: subdirectory.path,
      stat: {
        insertions: subdirectory.stat.insertions,
        deletions: subdirectory.stat.deletions,
      },
      children: toTreeNodes(subdirectory),
    }))
    .map((subdirectory) => compactDirectoryNode(subdirectory));

  const files = directory.files.toSorted((left, right) => {
    const nameComparison = compareByName(left, right);
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return left.key.localeCompare(right.key, undefined, SORT_LOCALE_OPTIONS);
  });

  return [...subdirectories, ...files];
}

export function buildReviewExplorerTree(
  files: ReadonlyArray<ReviewExplorerFileRef>,
): readonly ReviewExplorerTreeNode[] {
  const root: MutableDirectoryNode = {
    name: "",
    path: "",
    stat: { insertions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const pathValue = file.fileEntry.normalizedPath || file.fileEntry.displayPath;
    const segments = normalizePathSegments(pathValue);
    if (segments.length === 0) {
      continue;
    }

    const filePath = segments.join("/");
    const fileName = segments.at(-1);
    if (!fileName) {
      continue;
    }

    const stat = {
      insertions: file.fileEntry.insertions,
      deletions: file.fileEntry.deletions,
    };
    const ancestors: MutableDirectoryNode[] = [root];
    let currentDirectory = root;

    for (const segment of segments.slice(0, -1)) {
      const nextPath = currentDirectory.path ? `${currentDirectory.path}/${segment}` : segment;
      const existing = currentDirectory.directories.get(segment);
      if (existing) {
        currentDirectory = existing;
      } else {
        const created: MutableDirectoryNode = {
          name: segment,
          path: nextPath,
          stat: { insertions: 0, deletions: 0 },
          directories: new Map(),
          files: [],
        };
        currentDirectory.directories.set(segment, created);
        currentDirectory = created;
      }
      ancestors.push(currentDirectory);
    }

    currentDirectory.files.push({
      kind: "file",
      key: `file:${file.fileId}`,
      name: fileName,
      path: filePath,
      stat,
      entry: file,
    });

    for (const ancestor of ancestors) {
      ancestor.stat.insertions += stat.insertions;
      ancestor.stat.deletions += stat.deletions;
    }
  }

  return toTreeNodes(root);
}

export function collectReviewExplorerDirectoryPaths(
  nodes: ReadonlyArray<ReviewExplorerTreeNode>,
): readonly string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") {
      continue;
    }
    paths.push(node.path);
    paths.push(...collectReviewExplorerDirectoryPaths(node.children));
  }
  return paths;
}

export function collectReviewExplorerAncestorPaths(pathValue: string): readonly string[] {
  const segments = normalizePathSegments(pathValue);
  const paths: string[] = [];
  let currentPath = "";

  for (const segment of segments.slice(0, -1)) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    paths.push(currentPath);
  }

  return paths;
}
