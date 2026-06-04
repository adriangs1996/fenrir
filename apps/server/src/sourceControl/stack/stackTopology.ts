import type { ChangeRequest } from "@fenrir/contracts/sourceControl";
import type { SourceControlStackProblem } from "@fenrir/contracts/sourceControlStack";

export interface StackTopologyNode {
  readonly key: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly changeRequest: ChangeRequest;
}

export interface StackTopologyResult {
  readonly selected: ReadonlyArray<StackTopologyNode>;
  readonly rootBaseRef: string | null;
  readonly problems: ReadonlyArray<SourceControlStackProblem>;
}

function connectedComponent(
  nodes: ReadonlyArray<StackTopologyNode>,
  seedHeadRefName: string,
): ReadonlyArray<StackTopologyNode> {
  const byHead = new Map(nodes.map((node) => [node.headRefName, node]));
  const byBase = new Map<string, StackTopologyNode[]>();
  for (const node of nodes) {
    const existing = byBase.get(node.baseRefName) ?? [];
    existing.push(node);
    byBase.set(node.baseRefName, existing);
  }

  const selected = new Map<string, StackTopologyNode>();
  const queue: StackTopologyNode[] = [];
  const seed = byHead.get(seedHeadRefName);
  if (seed) {
    queue.push(seed);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (selected.has(node.key)) continue;
    selected.set(node.key, node);

    const parent = byHead.get(node.baseRefName);
    if (parent) queue.push(parent);
    for (const child of byBase.get(node.headRefName) ?? []) {
      queue.push(child);
    }
  }

  return [...selected.values()];
}

function orderedChain(nodes: ReadonlyArray<StackTopologyNode>): {
  readonly entries: ReadonlyArray<StackTopologyNode>;
  readonly rootBaseRef: string | null;
  readonly problems: ReadonlyArray<SourceControlStackProblem>;
} {
  if (nodes.length === 0) {
    return { entries: [], rootBaseRef: null, problems: [] };
  }

  const problems = new Set<SourceControlStackProblem>();
  const byHead = new Map<string, StackTopologyNode>();
  const duplicateHeads = new Set<string>();
  for (const node of nodes) {
    if (byHead.has(node.headRefName)) {
      duplicateHeads.add(node.headRefName);
    }
    byHead.set(node.headRefName, node);
  }
  if (duplicateHeads.size > 0) {
    problems.add("ambiguous-provider-chain");
  }

  const roots = nodes.filter((node) => !byHead.has(node.baseRefName));
  if (roots.length !== 1) {
    problems.add("ambiguous-provider-chain");
  }

  const root = roots[0] ?? nodes[0]!;
  const ordered: StackTopologyNode[] = [];
  const seen = new Set<string>();
  let current: StackTopologyNode | undefined = root;
  while (current) {
    if (seen.has(current.key)) {
      problems.add("cycle-detected");
      break;
    }
    seen.add(current.key);
    ordered.push(current);
    const children = nodes.filter((node) => node.baseRefName === current!.headRefName);
    if (children.length > 1) {
      problems.add("ambiguous-provider-chain");
      break;
    }
    current = children[0];
  }

  if (seen.size !== nodes.length) {
    problems.add("ambiguous-provider-chain");
  }

  return {
    entries: ordered,
    rootBaseRef: root.baseRefName,
    problems: [...problems],
  };
}

export function selectProviderStackChain(input: {
  readonly changeRequests: ReadonlyArray<ChangeRequest>;
  readonly selectedHeadRefName: string | null;
}): StackTopologyResult {
  const nodes = input.changeRequests.map((changeRequest) => ({
    key: `${changeRequest.provider}:${changeRequest.number}`,
    baseRefName: changeRequest.baseRefName,
    headRefName: changeRequest.headRefName,
    changeRequest,
  }));
  if (nodes.length === 0) {
    return { selected: [], rootBaseRef: null, problems: [] };
  }

  const selectedSeed =
    input.selectedHeadRefName &&
    nodes.some((node) => node.headRefName === input.selectedHeadRefName)
      ? input.selectedHeadRefName
      : null;

  if (selectedSeed) {
    const ordered = orderedChain(connectedComponent(nodes, selectedSeed));
    return {
      selected: ordered.entries,
      rootBaseRef: ordered.rootBaseRef,
      problems: ordered.problems,
    };
  }

  const ordered = orderedChain(nodes);
  return {
    selected: ordered.entries,
    rootBaseRef: ordered.rootBaseRef,
    problems:
      nodes.length > ordered.entries.length
        ? [...new Set([...ordered.problems, "ambiguous-provider-chain" as const])]
        : ordered.problems,
  };
}
