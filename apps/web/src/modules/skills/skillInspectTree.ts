import type { ServerSkillFileEntry, SkillFileScope } from "@fenrir/contracts";

export type SkillTreeScopeKey = "general" | "codex" | "claude";
export type SkillTreeScopeRollup = SkillTreeScopeKey | "mixed" | null;

export interface SkillFileTreeFolderNode {
  readonly type: "folder";
  readonly key: string;
  readonly name: string;
  readonly relativePath: string;
  readonly children: readonly SkillFileTreeNode[];
  readonly scopeRollup: SkillTreeScopeRollup;
}

export interface SkillFileTreeFileNode {
  readonly type: "file";
  readonly key: string;
  readonly name: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly executable: boolean;
  readonly scope: SkillFileScope;
}

export type SkillFileTreeNode = SkillFileTreeFolderNode | SkillFileTreeFileNode;

interface MutableFolderNode {
  readonly type: "folder";
  readonly key: string;
  readonly name: string;
  readonly relativePath: string;
  readonly children: Map<string, MutableFolderNode | SkillFileTreeFileNode>;
}

const ROOT_KEY = "__root__";

export function buildSkillFileTree(
  files: readonly ServerSkillFileEntry[],
): readonly SkillFileTreeNode[] {
  const root: MutableFolderNode = {
    type: "folder",
    key: ROOT_KEY,
    name: "",
    relativePath: "",
    children: new Map(),
  };

  for (const file of files) {
    const segments = file.relativePath.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let folder = root;
    for (const [index, segment] of segments.entries()) {
      const relativePath = segments.slice(0, index + 1).join("/");
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        folder.children.set(file.relativePath, {
          type: "file",
          key: file.relativePath,
          name: segment,
          relativePath: file.relativePath,
          absolutePath: file.absolutePath,
          executable: file.executable,
          scope: file.scope,
        });
        continue;
      }

      const existing = folder.children.get(relativePath);
      if (existing?.type === "folder") {
        folder = existing;
        continue;
      }

      const nextFolder: MutableFolderNode = {
        type: "folder",
        key: relativePath,
        name: segment,
        relativePath,
        children: new Map(),
      };
      folder.children.set(relativePath, nextFolder);
      folder = nextFolder;
    }
  }

  return sortAndFreezeChildren(root.children);
}

export function toSkillTreeScopeKey(scope: SkillFileScope): SkillTreeScopeKey {
  if (scope.kind === "general") {
    return "general";
  }

  return scope.provider === "codex" ? "codex" : "claude";
}

function sortAndFreezeChildren(
  children: ReadonlyMap<string, MutableFolderNode | SkillFileTreeFileNode>,
): readonly SkillFileTreeNode[] {
  return Array.from(children.values())
    .toSorted(compareNodes)
    .map((node) => {
      if (node.type === "file") {
        return node;
      }

      const sortedChildren = sortAndFreezeChildren(node.children);
      return {
        type: "folder",
        key: node.key,
        name: node.name,
        relativePath: node.relativePath,
        children: sortedChildren,
        scopeRollup: rollupSkillTreeScopes(sortedChildren),
      } satisfies SkillFileTreeFolderNode;
    });
}

function compareNodes(
  left: MutableFolderNode | SkillFileTreeFileNode,
  right: MutableFolderNode | SkillFileTreeFileNode,
): number {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }

  return left.relativePath.localeCompare(right.relativePath) || left.key.localeCompare(right.key);
}

function rollupSkillTreeScopes(children: readonly SkillFileTreeNode[]): SkillTreeScopeRollup {
  const scopes = new Set<SkillTreeScopeKey>();

  for (const child of children) {
    if (child.type === "file") {
      scopes.add(toSkillTreeScopeKey(child.scope));
      continue;
    }

    if (child.scopeRollup === "mixed") {
      return "mixed";
    }

    if (child.scopeRollup !== null) {
      scopes.add(child.scopeRollup);
    }
  }

  if (scopes.size === 0) return null;
  if (scopes.size > 1) return "mixed";
  return scopes.values().next().value ?? null;
}
