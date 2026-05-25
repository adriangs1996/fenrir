import { useVirtualizer } from "@tanstack/react-virtual";
import type { EnvironmentId, ThreadId } from "@fenrir/contracts";
import {
  BotIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  RefreshCcwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DiffStatLabel, hasNonZeroStat } from "~/components/chat/DiffStatLabel";
import { VscodeEntryIcon } from "~/components/chat/VscodeEntryIcon";
import { useTheme } from "~/hooks/useTheme";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import type {
  ReviewDiffChunk,
  ReviewDiffFilePatch,
  ReviewProgressState,
  ReviewRawLaneKind,
} from "../../../../../../packages/contracts/src/review.ts";
import {
  buildReviewExplorerTree,
  collectReviewExplorerAncestorPaths,
  collectReviewExplorerDirectoryPaths,
  type ReviewExplorerFileRef,
  type ReviewExplorerTreeDirectoryNode,
  type ReviewExplorerTreeFileNode,
  type ReviewExplorerTreeNode,
} from "../explorerTree";
import { useReviewController } from "../hooks/useReviewController";
import {
  buildAskAgentPrompt,
  buildChunkSelectionTarget,
  buildFileSelectionTarget,
  bulkProgressStatesForTargets,
  deriveRawMutationAvailability,
  resolveOpenChangeTarget,
  reviewSectionKeyForLane,
  reviewSectionTitle,
  type ReviewExplorerSectionKey,
  type ReviewRawSelectionTarget,
} from "../rawState";
import type { ReviewRouteMode, ReviewRouteScope, ReviewRouteState } from "../routeSearch";

interface ReviewRawModeShellProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  routeKind: "server" | "draft";
  routeState: ReviewRouteState;
  active: boolean;
  onModeChange: (mode: ReviewRouteMode) => void;
  onScopeChange: (scope: ReviewRouteScope) => void;
  onRouteStateChange: (nextState: ReviewRouteState) => void;
}

type ExplorerRow =
  | {
      readonly id: string;
      readonly kind: "section";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly title: string;
      readonly fileCount: number;
    }
  | {
      readonly id: string;
      readonly kind: "directory";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly depth: number;
      readonly expansionKey: string;
      readonly node: ReviewExplorerTreeDirectoryNode;
    }
  | {
      readonly id: string;
      readonly kind: "file";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly depth: number;
      readonly fileId: string;
      readonly laneId: string;
      readonly node: ReviewExplorerTreeFileNode;
    }
  | {
      readonly id: string;
      readonly kind: "chunk";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly depth: number;
      readonly laneId: string;
      readonly fileId: string;
      readonly node: ReviewExplorerTreeFileNode;
      readonly chunk: ReviewDiffChunk;
    }
  | {
      readonly id: string;
      readonly kind: "status";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly depth: number;
      readonly fileId: string;
      readonly message: string;
      readonly tone: "muted" | "error";
    };

export type { ExplorerRow };

const MODE_OPTIONS: ReadonlyArray<ReviewRouteMode> = ["raw", "review"];
const SCOPE_OPTIONS: ReadonlyArray<ReviewRouteScope> = ["uncommitted", "branch", "combined"];
const PROGRESS_FILTERS: ReadonlyArray<ReviewProgressState> = [
  "unreviewed",
  "reviewed",
  "needs-follow-up",
];
const LANE_FILTERS: ReadonlyArray<ReviewRawLaneKind> = [
  "ignored",
  "unstaged",
  "staged",
  "committed",
  "inverse-edit",
];
const SECTION_ORDER: readonly ReviewExplorerSectionKey[] = [
  "ignored",
  "unstaged",
  "staged",
  "committed",
];

export function buildExplorerRows(args: {
  readonly sectionTrees: ReadonlyMap<ReviewExplorerSectionKey, readonly ReviewExplorerTreeNode[]>;
  readonly expandedSections: Readonly<Record<ReviewExplorerSectionKey, boolean>>;
  readonly expandedDirectories: Readonly<Record<string, boolean>>;
  readonly autoExpandedDirectories: ReadonlySet<string>;
  readonly fileExpansion: Readonly<Record<string, boolean>>;
  readonly selectedFileId: string | null | undefined;
  readonly selectedPatchFileId: string | null | undefined;
  readonly selectedFilePatch:
    | {
        readonly status: "idle" | "loading" | "ready" | "error";
        readonly value: ReviewDiffFilePatch | null;
        readonly error: string | null;
      }
    | null
    | undefined;
}): readonly ExplorerRow[] {
  const rows: ExplorerRow[] = [];

  const appendNodes = (
    sectionKey: ReviewExplorerSectionKey,
    nodes: readonly ReviewExplorerTreeNode[],
    depth: number,
  ) => {
    for (const node of nodes) {
      if (node.kind === "directory") {
        const expansionKey = `directory:${sectionKey}:${node.path}`;
        const expanded =
          args.expandedDirectories[expansionKey] ?? args.autoExpandedDirectories.has(expansionKey);
        rows.push({
          id: expansionKey,
          kind: "directory",
          sectionKey,
          depth,
          expansionKey,
          node,
        });
        if (expanded) {
          appendNodes(sectionKey, node.children, depth + 1);
        }
        continue;
      }

      rows.push({
        id: `file:${sectionKey}:${node.entry.fileId}`,
        kind: "file",
        sectionKey,
        depth,
        laneId: node.entry.laneId,
        fileId: node.entry.fileId,
        node,
      });
      const fileExpanded =
        args.fileExpansion[node.entry.fileId] || args.selectedFileId === node.entry.fileId;
      if (!fileExpanded) {
        continue;
      }

      const patchEntry =
        args.selectedPatchFileId === node.entry.fileId ? (args.selectedFilePatch ?? null) : null;
      if (patchEntry?.status === "loading") {
        rows.push({
          id: `status:${sectionKey}:${node.entry.fileId}:loading`,
          kind: "status",
          sectionKey,
          depth: depth + 1,
          fileId: node.entry.fileId,
          message: "Loading chunks…",
          tone: "muted",
        });
        continue;
      }
      if (patchEntry?.error) {
        rows.push({
          id: `status:${sectionKey}:${node.entry.fileId}:error`,
          kind: "status",
          sectionKey,
          depth: depth + 1,
          fileId: node.entry.fileId,
          message: patchEntry.error,
          tone: "error",
        });
        continue;
      }
      if (patchEntry?.value?.chunks.length) {
        for (const chunk of patchEntry.value.chunks) {
          rows.push({
            id: `chunk:${sectionKey}:${chunk.chunkId}`,
            kind: "chunk",
            sectionKey,
            depth: depth + 1,
            laneId: node.entry.laneId,
            fileId: node.entry.fileId,
            node,
            chunk,
          });
        }
      }
    }
  };

  for (const sectionKey of SECTION_ORDER) {
    const nodes = args.sectionTrees.get(sectionKey) ?? [];
    rows.push({
      id: `section:${sectionKey}`,
      kind: "section",
      sectionKey,
      title: reviewSectionTitle(sectionKey),
      fileCount: countSectionFileNodes(nodes),
    });

    if (!args.expandedSections[sectionKey]) {
      continue;
    }

    appendNodes(sectionKey, nodes, 0);
  }

  return rows;
}

export function estimateExplorerRowSize(row: ExplorerRow | undefined): number {
  if (!row) return 56;
  switch (row.kind) {
    case "section":
      return 34;
    case "directory":
      return 30;
    case "file":
      return 36;
    case "chunk":
      return 54;
    case "status":
      return 28;
  }
}

export function estimatePatchChunkRowSize(chunk: ReviewDiffChunk | undefined): number {
  return 64 + (chunk?.lines.length ?? 0) * 18;
}

function countSectionFileNodes(nodes: readonly ReviewExplorerTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === "file") {
      count += 1;
    } else {
      count += countSectionFileNodes(node.children);
    }
  }
  return count;
}

export function ReviewRawModeShell({
  environmentId,
  threadId,
  routeKind,
  routeState,
  active,
  onModeChange,
  onScopeChange,
  onRouteStateChange,
}: ReviewRawModeShellProps) {
  const { resolvedTheme } = useTheme();
  const review = useReviewController({
    environmentId,
    threadId,
    routeKind,
    routeState,
    active,
  });
  const state = review.state;
  const summary = state?.snapshot.summary ?? null;
  const selection = state?.selection ?? null;
  const selectedFileEntry = review.selectedFileEntry;
  const selectedPatch = review.selectedFilePatch?.value ?? null;
  const selectedChunk =
    selectedPatch && selection?.chunkId
      ? (selectedPatch.chunks.find((chunk) => chunk.chunkId === selection.chunkId) ?? null)
      : null;
  const [selectedTargetsByKey, setSelectedTargetsByKey] = useState<
    Readonly<Record<string, ReviewRawSelectionTarget>>
  >({});
  const [expandedSections, setExpandedSections] = useState<
    Readonly<Record<ReviewExplorerSectionKey, boolean>>
  >({
    ignored: true,
    unstaged: true,
    staged: true,
    committed: true,
  });
  const [expandedDirectories, setExpandedDirectories] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
  const [actionState, setActionState] = useState<{
    readonly busy: boolean;
    readonly label: string | null;
    readonly error: string | null;
  }>({
    busy: false,
    label: null,
    error: null,
  });

  const selectLane = (laneId: string) =>
    onRouteStateChange({
      ...routeState,
      reviewGroupId: laneId,
      reviewFileId: undefined,
      reviewChunkId: undefined,
      reviewCommentId: undefined,
    });
  const selectFile = (groupId: string, fileId: string) =>
    onRouteStateChange({
      ...routeState,
      reviewGroupId: groupId,
      reviewFileId: fileId,
      reviewChunkId: undefined,
      reviewCommentId: undefined,
    });
  const selectChunk = (groupId: string, fileId: string, chunkId: string) =>
    onRouteStateChange({
      ...routeState,
      reviewGroupId: groupId,
      reviewFileId: fileId,
      reviewChunkId: chunkId,
      reviewCommentId: undefined,
    });

  const sections = useMemo(() => {
    const sectionMap = new Map<ReviewExplorerSectionKey, ReviewExplorerFileRef[]>(
      SECTION_ORDER.map((sectionKey) => [sectionKey, []]),
    );
    if (!state) {
      return sectionMap;
    }

    for (const laneId of review.visibleLaneIds) {
      const lane = state.explorer.laneById[laneId];
      if (!lane) {
        continue;
      }
      const sectionKey = reviewSectionKeyForLane(lane.kind);
      const fileIds = state.explorer.fileIdsByLaneId[laneId] ?? [];
      for (const fileId of fileIds) {
        const file = state.snapshot.filesById[fileId];
        const fileEntry = state.explorer.fileEntryById[fileId];
        if (!file || !fileEntry || !state.filters.progressStates[file.progressState]) {
          continue;
        }
        sectionMap.get(sectionKey)!.push({
          laneId,
          fileId,
          fileEntry,
        });
      }
    }

    return sectionMap;
  }, [review.visibleLaneIds, state]);

  const sectionTrees = useMemo(
    () =>
      new Map(
        SECTION_ORDER.map((sectionKey) => [
          sectionKey,
          buildReviewExplorerTree(sections.get(sectionKey) ?? []),
        ]),
      ),
    [sections],
  );

  useEffect(() => {
    if (!state) {
      if (Object.keys(selectedTargetsByKey).length > 0) {
        setSelectedTargetsByKey({});
      }
      return;
    }

    const validKeys = new Set<string>();
    for (const fileEntry of Object.values(state.explorer.fileEntryById)) {
      validKeys.add(`file:${fileEntry.fileId}`);
    }
    for (const chunkId of Object.keys(state.explorer.chunkPatchById)) {
      validKeys.add(`chunk:${chunkId}`);
    }

    let changed = false;
    const next: Record<string, ReviewRawSelectionTarget> = {};
    for (const [key, value] of Object.entries(selectedTargetsByKey)) {
      if (validKeys.has(key)) {
        next[key] = value;
      } else {
        changed = true;
      }
    }
    if (changed) {
      setSelectedTargetsByKey(next);
    }
  }, [selectedTargetsByKey, state]);

  useEffect(() => {
    const validKeys = new Set<string>();
    for (const sectionKey of SECTION_ORDER) {
      const nodes = sectionTrees.get(sectionKey) ?? [];
      for (const pathValue of collectReviewExplorerDirectoryPaths(nodes)) {
        validKeys.add(`directory:${sectionKey}:${pathValue}`);
      }
    }

    let changed = false;
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(expandedDirectories)) {
      if (validKeys.has(key)) {
        next[key] = value;
      } else {
        changed = true;
      }
    }
    if (changed) {
      setExpandedDirectories(next);
    }
  }, [expandedDirectories, sectionTrees]);

  const selectedTargets = useMemo(
    () => Object.values(selectedTargetsByKey),
    [selectedTargetsByKey],
  );
  const activeTargets = useMemo(() => {
    if (selectedTargets.length > 0) {
      return selectedTargets;
    }
    if (selectedFileEntry && selectedChunk) {
      return [buildChunkSelectionTarget(selectedFileEntry, selectedChunk)];
    }
    if (selectedFileEntry) {
      return [buildFileSelectionTarget(selectedFileEntry)];
    }
    return [];
  }, [selectedChunk, selectedFileEntry, selectedTargets]);
  const mutationAvailability = useMemo(
    () => deriveRawMutationAvailability(activeTargets),
    [activeTargets],
  );
  const progressActions = useMemo(
    () => bulkProgressStatesForTargets(activeTargets),
    [activeTargets],
  );
  const autoExpandedDirectories = useMemo(() => {
    if (!selectedFileEntry) {
      return new Set<string>();
    }
    const sectionKey = reviewSectionKeyForLane(selectedFileEntry.lane);
    return new Set(
      collectReviewExplorerAncestorPaths(selectedFileEntry.normalizedPath).map(
        (pathValue) => `directory:${sectionKey}:${pathValue}`,
      ),
    );
  }, [selectedFileEntry]);

  const explorerRows = useMemo<readonly ExplorerRow[]>(
    () =>
      buildExplorerRows({
        sectionTrees,
        expandedSections,
        expandedDirectories,
        autoExpandedDirectories,
        fileExpansion: state?.expansion.fileIds ?? {},
        selectedFileId: selection?.fileId,
        selectedPatchFileId: selectedPatch?.fileId,
        selectedFilePatch: review.selectedFilePatch,
      }),
    [
      autoExpandedDirectories,
      expandedDirectories,
      expandedSections,
      review.selectedFilePatch,
      sectionTrees,
      selectedPatch?.fileId,
      selection?.fileId,
      state?.expansion.fileIds,
    ],
  );

  const explorerParentRef = useRef<HTMLDivElement | null>(null);
  const explorerVirtualizer = useVirtualizer({
    count: explorerRows.length,
    getScrollElement: () => explorerParentRef.current,
    estimateSize: (index) => estimateExplorerRowSize(explorerRows[index]),
    overscan: 10,
  });

  const patchChunks = selectedPatch?.chunks ?? [];
  const patchParentRef = useRef<HTMLDivElement | null>(null);
  const patchVirtualizer = useVirtualizer({
    count: patchChunks.length,
    getScrollElement: () => patchParentRef.current,
    estimateSize: (index) => estimatePatchChunkRowSize(patchChunks[index]),
    overscan: 6,
  });

  const primaryTarget = activeTargets[0] ?? null;
  const primaryOpenFile =
    selectedFileEntry ??
    (primaryTarget ? (state?.explorer.fileEntryById[primaryTarget.fileId] ?? null) : null);
  const primaryOpenChunk =
    selectedChunk ??
    (selectedPatch && primaryTarget?.chunkId
      ? (selectedPatch.chunks.find((chunk) => chunk.chunkId === primaryTarget.chunkId) ?? null)
      : null);

  const runMutation = async (label: string, work: () => Promise<void>) => {
    setActionState({
      busy: true,
      label,
      error: null,
    });
    try {
      await work();
      setActionState({
        busy: false,
        label: null,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionState({
        busy: false,
        label: null,
        error: message,
      });
      toastManager.add({
        type: "error",
        title: "Review action failed",
        description: message,
      });
    }
  };

  const toggleSelectionTarget = (target: ReviewRawSelectionTarget, checked: boolean) => {
    setSelectedTargetsByKey((current) => {
      const next = { ...current };
      if (checked) {
        next[target.selectionKey] = target;
      } else {
        delete next[target.selectionKey];
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedTargetsByKey({});

  const handleOpenChange = () => {
    if (!summary || !primaryOpenFile) {
      return;
    }
    const target = resolveOpenChangeTarget({
      cwd: summary.target.cwd,
      file: primaryOpenFile,
      ...(primaryOpenChunk ? { chunk: primaryOpenChunk } : {}),
      ...(review.selectedChunkPayload ? { chunkPayload: review.selectedChunkPayload } : {}),
    });
    void runMutation("Opening change", async () => {
      await review.openChange(target);
    });
  };

  const handleAskAgent = (mode: "selection" | "risk") => {
    if (activeTargets.length === 0) {
      return;
    }
    review.askAgentAboutChange(
      buildAskAgentPrompt({
        mode,
        targets: activeTargets,
        selectedFile: selectedFileEntry,
        selectedPatch,
        selectedChunk,
      }),
    );
  };

  const latestArtifact = review.latestAnalysisArtifact;
  const analysisBusy = review.analysisRequest.status === "running";
  const visibleFileCount = useMemo(
    () => Array.from(sections.values()).reduce((total, files) => total + files.length, 0),
    [sections],
  );
  const activeProgressFilterCount = useMemo(
    () =>
      PROGRESS_FILTERS.filter(
        (progressState) => state?.filters.progressStates[progressState] ?? true,
      ).length,
    [state?.filters.progressStates],
  );
  const activeLaneFilterCount = useMemo(
    () => LANE_FILTERS.filter((laneKind) => state?.filters.laneKinds[laneKind] ?? true).length,
    [state?.filters.laneKinds],
  );
  const selectionSummary = useMemo(() => {
    if (selectedTargets.length > 0) {
      return {
        value: String(selectedTargets.length),
        detail: "Checked files and chunks are the active bulk selection.",
      };
    }
    if (selectedChunk) {
      return {
        value: "Chunk",
        detail: selectedChunk.header,
      };
    }
    if (selectedFileEntry) {
      return {
        value: "File",
        detail: selectedFileEntry.displayPath,
      };
    }
    return {
      value: "None",
      detail: "Choose a file to hydrate its patch.",
    };
  }, [selectedChunk, selectedFileEntry, selectedTargets.length]);
  const actionSummary =
    activeTargets.length > 0
      ? selectedTargets.length > 0
        ? `${selectedTargets.length} checked item${selectedTargets.length === 1 ? "" : "s"} will be mutated together.`
        : selectedChunk
          ? "Actions apply to the selected chunk until you check a broader selection."
          : "Actions apply to the current file until you check specific chunks."
      : "Select a file or chunk to enable actions.";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,_color-mix(in_srgb,var(--accent)_10%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--card))_0%,var(--background)_100%)]">
      <div className="border-b border-border/60 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_82%,transparent),transparent)] px-3 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-col gap-2 xl:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedButtons
                label="Mode"
                options={MODE_OPTIONS}
                activeValue={routeState.reviewMode}
                onSelect={onModeChange}
              />
              <SegmentedButtons
                label="Scope"
                options={SCOPE_OPTIONS}
                activeValue={routeState.reviewScope}
                onSelect={onScopeChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={review.refresh}
                disabled={!summary || routeKind !== "server" || actionState.busy}
                className="h-7 gap-1.5 px-2.5 text-xs"
              >
                <RefreshCcwIcon className="size-3.5" />
                Refresh
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Session {summary?.id ?? "not attached"}
            </div>
          </div>
        </div>
      </div>

      {state?.degradedBanners?.length ? (
        <div className="flex flex-col gap-2 border-b border-border/60 bg-background/70 px-3 py-3 sm:px-5">
          {state.degradedBanners.map((banner) => (
            <div
              key={banner.id}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm",
                banner.tone === "error"
                  ? "border-destructive/30 bg-destructive/8 text-destructive-foreground"
                  : "border-warning/30 bg-warning/8 text-warning-foreground",
              )}
            >
              <div className="flex items-center gap-2 font-medium">
                <TriangleAlertIcon className="size-4" />
                {banner.title}
              </div>
              <p className="mt-1 text-xs opacity-85">{banner.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row">
        <aside className="flex min-h-0 w-full flex-col border border-border/60 bg-card/70 p-4 shadow-sm xl:w-[330px] xl:shrink-0">
          <div ref={explorerParentRef} className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {routeKind !== "server" ? (
              <EmptyPanel
                title="Review needs a server thread"
                body="Draft threads keep route state, but the review session only exists after the thread is persisted."
              />
            ) : state?.explorerStatus === "loading" && explorerRows.length === 0 ? (
              <EmptyPanel title="Loading diff lanes" body="Attaching to the live review session." />
            ) : explorerRows.length === 0 ? (
              <EmptyPanel
                title="No visible files"
                body={
                  state?.explorerStatus === "error"
                    ? (state.explorerError ?? "Failed to load diff lanes.")
                    : "No files match the current scope and filters."
                }
              />
            ) : (
              <div
                className="relative"
                style={{ height: `${explorerVirtualizer.getTotalSize()}px` }}
              >
                {explorerVirtualizer.getVirtualItems().map((virtualItem) => {
                  const row = explorerRows[virtualItem.index];
                  if (!row) return null;
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 top-0 w-full"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      {row.kind === "section" ? (
                        <ExplorerSectionRow
                          row={row}
                          expanded={expandedSections[row.sectionKey]}
                          onToggle={() =>
                            setExpandedSections((current) => ({
                              ...current,
                              [row.sectionKey]: !current[row.sectionKey],
                            }))
                          }
                          onSelectLane={() => {
                            const firstFile = sections.get(row.sectionKey)?.[0];
                            if (firstFile) {
                              selectLane(firstFile.laneId);
                            }
                          }}
                        />
                      ) : row.kind === "directory" ? (
                        <ExplorerDirectoryRow
                          row={row}
                          expanded={
                            expandedDirectories[row.expansionKey] ??
                            autoExpandedDirectories.has(row.expansionKey)
                          }
                          resolvedTheme={resolvedTheme}
                          onToggle={() =>
                            setExpandedDirectories((current) => ({
                              ...current,
                              [row.expansionKey]: !(
                                current[row.expansionKey] ??
                                autoExpandedDirectories.has(row.expansionKey)
                              ),
                            }))
                          }
                        />
                      ) : row.kind === "file" ? (
                        <ExplorerFileRow
                          row={row}
                          progressState={
                            state?.snapshot.filesById[row.fileId]?.progressState ?? "unreviewed"
                          }
                          selected={selection?.fileId === row.fileId}
                          expanded={
                            (state?.expansion.fileIds[row.fileId] ?? false) ||
                            selection?.fileId === row.fileId
                          }
                          checked={Boolean(selectedTargetsByKey[`file:${row.fileId}`])}
                          resolvedTheme={resolvedTheme}
                          onToggleChecked={(checked) =>
                            toggleSelectionTarget(
                              buildFileSelectionTarget(row.node.entry.fileEntry),
                              checked,
                            )
                          }
                          onSelect={() => selectFile(row.laneId, row.fileId)}
                          onToggleExpanded={() => review.toggleFileExpanded(row.fileId)}
                        />
                      ) : row.kind === "chunk" ? (
                        <ExplorerChunkRow
                          row={row}
                          selected={selection?.chunkId === row.chunk.chunkId}
                          checked={Boolean(selectedTargetsByKey[`chunk:${row.chunk.chunkId}`])}
                          onToggleChecked={(checked) =>
                            toggleSelectionTarget(
                              buildChunkSelectionTarget(row.node.entry.fileEntry, row.chunk),
                              checked,
                            )
                          }
                          resolvedTheme={resolvedTheme}
                          onSelect={() => selectChunk(row.laneId, row.fileId, row.chunk.chunkId)}
                        />
                      ) : (
                        <div
                          className={cn(
                            "px-3 py-1.5 text-[11px]",
                            row.tone === "error"
                              ? "text-destructive-foreground"
                              : "text-muted-foreground",
                          )}
                          style={{ paddingLeft: `${18 + row.depth * 14}px` }}
                        >
                          {row.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="grid min-h-0 min-w-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border/50 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-sm text-foreground">Current focus</h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    The raw diff stays authoritative. Keep analysis and bulk actions secondary to
                    the selected file or chunk.
                  </p>
                </div>
                <StatusBadge label={review.selectedFilePatch?.status ?? "idle"} />
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {routeKind !== "server" ? (
                <EmptyPanel
                  title="Draft review is intentionally inert"
                  body="This tab keeps its URL-backed review state, but it only attaches after the thread exists on the server."
                />
              ) : !summary ? (
                <EmptyPanel
                  title={
                    state?.sessionStatus === "error" ? "Review session failed" : "Attaching review"
                  }
                  body={
                    state?.sessionError ?? "Requesting or restoring the current review session."
                  }
                />
              ) : !selectedFileEntry ? (
                <EmptyPanel
                  title="Choose a file"
                  body="Start in the left rail. The patch, chunk list, and safe bulk actions only hydrate after a file is selected."
                />
              ) : (
                <div className="space-y-4">
                  <section className="rounded-2xl border border-border/50 bg-background/80 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-foreground">
                          {selectedFileEntry.displayPath}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <MetaBadge label={selectedFileEntry.changeKind} />
                          <MetaBadge
                            label={`${selectedFileEntry.provenance.lane} / ${selectedFileEntry.provenance.scope}`}
                          />
                          <DiffCount
                            insertions={selectedFileEntry.insertions}
                            deletions={selectedFileEntry.deletions}
                          />
                          {selectedChunk ? <MetaBadge label="chunk selected" /> : null}
                        </div>
                        {selectedFileEntry.ignoreRule ? (
                          <div className="mt-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
                            Ignore rule: {selectedFileEntry.ignoreRule.ruleKind}{" "}
                            {selectedFileEntry.ignoreRule.matchPath}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:w-[240px]">
                        <FocusMetric
                          label="Patch"
                          value={review.selectedFilePatch?.status ?? "idle"}
                        />
                        <FocusMetric
                          label="Chunks"
                          value={String(selectedPatch?.chunks.length ?? 0)}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-border/50 bg-background/80 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="font-medium text-sm text-foreground">
                          Actions
                          {selectedTargets.length > 0 ? ` (${selectedTargets.length} checked)` : ""}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{actionSummary}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Undo only succeeds while the live anchor still matches the underlying
                          diff. Refresh if the action reports drift.
                        </div>
                      </div>
                      {selectedTargets.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={clearSelection}
                          disabled={actionState.busy}
                        >
                          Clear selection
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      <ActionGroup
                        title="Git state"
                        description="Move the current diff between lanes or revert it."
                      >
                        <ActionButton
                          label="Stage"
                          disabled={!mutationAvailability.stage || actionState.busy}
                          onClick={() =>
                            void runMutation("Staging selection", async () => {
                              const results = await review.applyRawMutations(
                                "stage",
                                activeTargets,
                              );
                              clearSelection();
                              toastManager.add({
                                type: "success",
                                title:
                                  results.length > 1
                                    ? "Selection staged"
                                    : (results[0]?.confirmation ?? "Selection staged"),
                              });
                            })
                          }
                        />
                        <ActionButton
                          label="Unstage"
                          variant="outline"
                          disabled={!mutationAvailability.unstage || actionState.busy}
                          onClick={() =>
                            void runMutation("Unstaging selection", async () => {
                              const results = await review.applyRawMutations(
                                "unstage",
                                activeTargets,
                              );
                              clearSelection();
                              toastManager.add({
                                type: "success",
                                title:
                                  results.length > 1
                                    ? "Selection unstaged"
                                    : (results[0]?.confirmation ?? "Selection unstaged"),
                              });
                            })
                          }
                        />
                        <ActionButton
                          label="Undo"
                          variant="outline"
                          disabled={!mutationAvailability.undo || actionState.busy}
                          onClick={() =>
                            void runMutation("Undoing selection", async () => {
                              const results = await review.applyRawMutations("undo", activeTargets);
                              clearSelection();
                              const inverseEditCount = results.filter(
                                (result) => result.generatedInverseEdit,
                              ).length;
                              toastManager.add({
                                type: "success",
                                title:
                                  inverseEditCount > 0
                                    ? `Undo created ${inverseEditCount} inverse edit${inverseEditCount === 1 ? "" : "s"}`
                                    : results.length > 1
                                      ? "Selection undone"
                                      : (results[0]?.confirmation ?? "Selection undone"),
                              });
                            })
                          }
                        />
                      </ActionGroup>

                      <ActionGroup
                        title="Review state"
                        description="Track what has been inspected and what needs a second pass."
                      >
                        {progressActions.length > 0 ? (
                          progressActions.map((progressState) => (
                            <ActionButton
                              key={progressState}
                              label={`Mark ${progressState}`}
                              variant="outline"
                              disabled={actionState.busy}
                              onClick={() =>
                                void runMutation(`Marking ${progressState}`, async () => {
                                  await review.setBulkProgress(progressState, activeTargets);
                                  toastManager.add({
                                    type: "success",
                                    title: `Marked ${activeTargets.length} item${activeTargets.length === 1 ? "" : "s"} as ${progressState}`,
                                  });
                                })
                              }
                            />
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-border/50 px-3 py-3 text-xs text-muted-foreground">
                            Pick a file or chunk to update review progress.
                          </div>
                        )}
                      </ActionGroup>

                      <ActionGroup
                        title="Investigate"
                        description="Open the change locally, involve the agent, or change visibility."
                      >
                        <ActionButton
                          label="Open change"
                          variant="ghost"
                          icon={<ExternalLinkIcon className="size-3.5" />}
                          disabled={!primaryOpenFile || actionState.busy}
                          onClick={handleOpenChange}
                        />
                        <ActionButton
                          label="Ask agent"
                          variant="ghost"
                          icon={<BotIcon className="size-3.5" />}
                          disabled={activeTargets.length === 0 || actionState.busy}
                          onClick={() => handleAskAgent("selection")}
                        />
                        <ActionButton
                          label="Ask for risks"
                          variant="ghost"
                          icon={<SparklesIcon className="size-3.5" />}
                          disabled={activeTargets.length === 0 || actionState.busy}
                          onClick={() => handleAskAgent("risk")}
                        />
                        <ActionButton
                          label="Ignore"
                          variant="outline"
                          disabled={!mutationAvailability.ignore || actionState.busy}
                          onClick={() =>
                            void runMutation("Ignoring selection", async () => {
                              await review.applyRawMutations("ignore", activeTargets);
                              clearSelection();
                              toastManager.add({
                                type: "success",
                                title: "Selection ignored",
                              });
                            })
                          }
                        />
                        <ActionButton
                          label="Unignore"
                          variant="outline"
                          disabled={!mutationAvailability.unignore || actionState.busy}
                          onClick={() =>
                            void runMutation("Unignoring selection", async () => {
                              await review.applyRawMutations("unignore", activeTargets);
                              clearSelection();
                              toastManager.add({
                                type: "success",
                                title: "Selection restored from ignore rules",
                              });
                            })
                          }
                        />
                      </ActionGroup>
                    </div>

                    {actionState.busy && actionState.label ? (
                      <div className="mt-3 text-[11px] text-muted-foreground">
                        {actionState.label}…
                      </div>
                    ) : null}
                    {actionState.error ? (
                      <div className="mt-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
                        {actionState.error}
                      </div>
                    ) : null}
                  </section>

                  {selectedFileEntry.metadata || selectedChunk ? (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {selectedFileEntry.metadata ? (
                        <MetadataCard
                          title={selectedFileEntry.metadata.title}
                          kind={selectedFileEntry.metadata.kind}
                          lines={selectedFileEntry.metadata.summaryLines}
                        />
                      ) : null}
                      {selectedChunk ? (
                        <SelectedChunkCard
                          chunk={selectedChunk}
                          rawPatch={review.selectedChunkPayload?.rawPatch ?? null}
                          loading={review.selectedChunkPayloadEntry?.status === "loading"}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {review.selectedFilePatch?.error ? (
                    <EmptyPanel title="Patch load failed" body={review.selectedFilePatch.error} />
                  ) : review.selectedFilePatch?.status === "loading" ? (
                    <EmptyPanel title="Loading patch" body="Hydrating the current file patch." />
                  ) : selectedPatch && selectedPatch.chunks.length > 0 ? (
                    <section className="flex min-h-0 flex-col rounded-2xl border border-border/50 bg-background/80 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="font-medium text-sm text-foreground">Patch chunks</h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Scroll the virtualized chunk list, then select the chunk that needs a
                            closer pass.
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {selectedPatch.chunks.length} chunk
                          {selectedPatch.chunks.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div ref={patchParentRef} className="min-h-0 max-h-[560px] overflow-y-auto">
                        <div
                          className="relative"
                          style={{
                            height: `${patchVirtualizer.getTotalSize()}px`,
                          }}
                        >
                          {patchVirtualizer.getVirtualItems().map((virtualItem) => {
                            const chunk = patchChunks[virtualItem.index];
                            if (!chunk) return null;
                            return (
                              <div
                                key={chunk.chunkId}
                                className="absolute left-0 top-0 w-full"
                                style={{
                                  transform: `translateY(${virtualItem.start}px)`,
                                }}
                              >
                                <PatchChunkCard
                                  chunk={chunk}
                                  selected={selection?.chunkId === chunk.chunkId}
                                  onSelect={() =>
                                    selectChunk(
                                      selectedPatch.groupId,
                                      selectedPatch.fileId,
                                      chunk.chunkId,
                                    )
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ) : selectedFileEntry.changeKind !== "text" ? (
                    <EmptyPanel
                      title="No text patch"
                      body="This change is represented as metadata rather than a text diff."
                    />
                  ) : (
                    <EmptyPanel
                      title="No patch chunks"
                      body="This file does not currently expose chunk-level diff content."
                    />
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 2xl:sticky 2xl:top-0 2xl:self-start">
            <section className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
              <div>
                <h3 className="font-medium text-sm text-foreground">Review context</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Session and branch context for the currently attached diff.
                </p>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <InfoRow
                  label="Repository"
                  value={summary?.target.repositoryName ?? summary?.target.repositoryRoot ?? "—"}
                />
                <InfoRow label="Selection" value={summary?.target.selectionLabel ?? "—"} />
                <InfoRow label="Base" value={summary?.target.baseRef ?? "—"} />
                <InfoRow label="Head" value={summary?.target.headRef ?? "—"} />
                <InfoRow label="Files" value={String(summary?.fileCount ?? 0)} />
                <InfoRow
                  label="Progress"
                  value={`${summary?.progressCounts.reviewed ?? 0} reviewed / ${summary?.progressCounts.needsFollowUp ?? 0} follow-up`}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-sm text-foreground">Analysis brief</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use AI analysis for ordering and risk scans, not as the source of truth.
                  </p>
                </div>
                {routeKind === "server" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      routeState.reviewMode === "review"
                        ? review.refreshAnalysis()
                        : review.generateAnalysis()
                    }
                    disabled={analysisBusy}
                  >
                    {analysisBusy ? "Running…" : latestArtifact ? "Refresh" : "Generate"}
                  </Button>
                ) : null}
              </div>
              {review.analysisRequest.error ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                  {review.analysisRequest.error}
                </div>
              ) : null}
              {latestArtifact ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-border/50 bg-background/80 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaBadge label={latestArtifact.provider} />
                      <MetaBadge label={latestArtifact.status} />
                      <MetaBadge label={latestArtifact.staleStatus} />
                    </div>
                    <div className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      {latestArtifact.summaryMarkdown
                        ? latestArtifact.summaryMarkdown.slice(0, 320)
                        : "This artifact does not include a summary body yet."}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <InfoRow label="Requested" value={latestArtifact.requestedAt} />
                    <InfoRow
                      label="Completed"
                      value={latestArtifact.completedAt ?? latestArtifact.requestedAt}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No review analysis has been generated for this session yet.
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ActionButton(props: {
  label: string;
  variant?: "default" | "outline" | "ghost";
  icon?: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={props.variant ?? "default"}
      size="sm"
      className="h-8 gap-1.5"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </Button>
  );
}

function ExplorerSectionRow(props: {
  row: Extract<ExplorerRow, { kind: "section" }>;
  expanded: boolean;
  onToggle: () => void;
  onSelectLane: () => void;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background/80"
          onClick={props.onToggle}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
              props.expanded && "rotate-90",
            )}
          />
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {props.row.title}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {props.row.fileCount}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={props.onSelectLane}
        >
          Open
        </Button>
      </div>
    </div>
  );
}

function ExplorerDirectoryRow(props: {
  row: Extract<ExplorerRow, { kind: "directory" }>;
  expanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
      style={{ paddingLeft: `${10 + props.row.depth * 14}px` }}
      onClick={props.onToggle}
    >
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
          props.expanded && "rotate-90",
        )}
      />
      <VscodeEntryIcon
        pathValue={props.row.node.path}
        kind="directory"
        theme={props.resolvedTheme}
        className="size-3.5 text-muted-foreground/75"
      />
      <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
        {props.row.node.name}
      </span>
      {hasNonZeroStat({
        additions: props.row.node.stat.insertions,
        deletions: props.row.node.stat.deletions,
      }) ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
          <DiffStatLabel
            additions={props.row.node.stat.insertions}
            deletions={props.row.node.stat.deletions}
          />
        </span>
      ) : null}
    </button>
  );
}

function ExplorerFileRow(props: {
  row: Extract<ExplorerRow, { kind: "file" }>;
  progressState: ReviewProgressState;
  selected: boolean;
  expanded: boolean;
  checked: boolean;
  resolvedTheme: "light" | "dark";
  onToggleChecked: (checked: boolean) => void;
  onSelect: () => void;
  onToggleExpanded: () => void;
}) {
  const pathValue = props.row.node.entry.fileEntry.normalizedPath;
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md py-1 pr-2 transition-colors",
        props.selected && "bg-primary/8",
      )}
      style={{ paddingLeft: `${10 + props.row.depth * 14}px` }}
    >
      <Checkbox
        checked={props.checked}
        onCheckedChange={(checked) => props.onToggleChecked(checked === true)}
        aria-label={`Select file ${props.row.node.entry.fileEntry.displayPath} from ${props.row.node.entry.fileEntry.provenance.lane} ${props.row.node.entry.fileEntry.provenance.scope}`}
        data-testid={`review-raw-file-checkbox:${props.row.node.entry.fileEntry.displayPath}:${props.row.node.entry.fileEntry.provenance.lane}`}
        className="mt-0.5 shrink-0"
      />
      <button
        type="button"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-background/80 hover:text-foreground/80"
        onClick={props.onToggleExpanded}
        aria-label={props.expanded ? "Collapse file chunks" : "Expand file chunks"}
        data-testid={`review-raw-file-expand:${props.row.node.entry.fileEntry.displayPath}:${props.row.node.entry.fileEntry.provenance.lane}`}
      >
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", props.expanded && "rotate-90")}
        />
      </button>
      <button
        type="button"
        data-testid={`review-raw-file-button:${props.row.node.entry.fileEntry.displayPath}:${props.row.node.entry.fileEntry.provenance.lane}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-left hover:bg-background/80"
        onClick={props.onSelect}
      >
        <VscodeEntryIcon
          pathValue={pathValue}
          kind="file"
          theme={props.resolvedTheme}
          className="size-3.5 shrink-0 text-muted-foreground/70"
        />
        <span
          className={cn(
            "truncate font-mono text-[11px]",
            props.selected
              ? "text-foreground"
              : "text-muted-foreground/85 group-hover:text-foreground/90",
          )}
        >
          {props.row.node.name}
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground/70 lg:inline">
          {props.row.node.entry.fileEntry.provenance.scope}
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground/70 xl:inline">
          {props.progressState}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
          <DiffStatLabel
            additions={props.row.node.stat.insertions}
            deletions={props.row.node.stat.deletions}
          />
        </span>
      </button>
    </div>
  );
}

function ExplorerChunkRow(props: {
  row: Extract<ExplorerRow, { kind: "chunk" }>;
  selected: boolean;
  checked: boolean;
  resolvedTheme: "light" | "dark";
  onToggleChecked: (checked: boolean) => void;
  onSelect: () => void;
}) {
  const preview = props.row.chunk.lines
    .slice(0, 2)
    .map((line) => line.text)
    .join(" ");

  return (
    <div
      className={cn(
        "group flex items-start gap-1.5 rounded-md py-1 pr-2 transition-colors",
        props.selected && "bg-primary/8",
      )}
      style={{ paddingLeft: `${10 + props.row.depth * 14}px` }}
    >
      <Checkbox
        checked={props.checked}
        onCheckedChange={(checked) => props.onToggleChecked(checked === true)}
        aria-label={`Select chunk ${props.row.chunk.anchor.excerpt} from ${props.row.node.entry.fileEntry.displayPath} ${props.row.chunk.anchor.provenance.lane} ${props.row.chunk.anchor.provenance.scope}`}
        data-testid={`review-raw-chunk-checkbox:${props.row.node.entry.fileEntry.displayPath}:${props.row.chunk.anchor.provenance.lane}:${props.row.chunk.chunkId}`}
        className="mt-1 shrink-0"
      />
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <VscodeEntryIcon
          pathValue={props.row.node.entry.fileEntry.normalizedPath}
          kind="file"
          theme={props.resolvedTheme}
          className="size-3 text-muted-foreground/45"
        />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md py-0.5 text-left hover:bg-background/80"
        onClick={props.onSelect}
      >
        <div
          className={cn(
            "truncate font-mono text-[11px]",
            props.selected
              ? "text-foreground"
              : "text-muted-foreground/90 group-hover:text-foreground/90",
          )}
        >
          {props.row.chunk.header}
        </div>
        <div className="truncate text-[10px] text-muted-foreground/65">{preview}</div>
      </button>
    </div>
  );
}

function PatchChunkCard(props: {
  chunk: ReviewDiffChunk;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "mb-3 block w-full rounded-2xl border px-3 py-3 text-left transition-colors",
        props.selected ? "border-primary/35 bg-primary/8" : "border-border/40 bg-card/40",
      )}
      onClick={props.onSelect}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{props.chunk.header}</span>
        <MetaBadge
          label={`${props.chunk.anchor.provenance.lane} / ${props.chunk.anchor.provenance.scope}`}
        />
      </div>
      <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-5 text-foreground/90">
        {props.chunk.lines
          .map((line) => {
            const prefix = line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " ";
            const left = line.oldLineNumber?.toString().padStart(4, " ") ?? "    ";
            const right = line.newLineNumber?.toString().padStart(4, " ") ?? "    ";
            return `${left} ${right} ${prefix} ${line.text}`;
          })
          .join("\n")}
      </pre>
    </button>
  );
}

function MetadataCard(props: { title: string; kind: string; lines: readonly string[] }) {
  return (
    <section className="rounded-xl border border-border/50 bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium text-sm text-foreground">{props.title}</h4>
        <Badge size="sm" variant="outline">
          {props.kind}
        </Badge>
      </div>
      <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        {props.lines.map((line) => (
          <div key={line} className="rounded-lg border border-border/35 bg-card/40 px-3 py-2">
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}

function FilterSection(props: {
  progressStates: Partial<Record<ReviewProgressState, boolean>> | undefined;
  laneKinds: Partial<Record<ReviewRawLaneKind, boolean>> | undefined;
  progressSummary: string;
  laneSummary: string;
  onToggleProgress: (progressState: ReviewProgressState) => void;
  onToggleLane: (laneKind: ReviewRawLaneKind) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span>Progress</span>
          <span className="tracking-normal">{props.progressSummary}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROGRESS_FILTERS.map((progressState) => (
            <FilterChip
              key={progressState}
              active={props.progressStates?.[progressState] ?? true}
              onClick={() => props.onToggleProgress(progressState)}
            >
              {progressState}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span>Provenance</span>
          <span className="tracking-normal">{props.laneSummary}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {LANE_FILTERS.map((laneKind) => (
            <FilterChip
              key={laneKind}
              active={props.laneKinds?.[laneKind] ?? true}
              onClick={() => props.onToggleLane(laneKind)}
            >
              {laneKind}
            </FilterChip>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterChip(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        props.active
          ? "border-primary/40 bg-primary/8 text-foreground"
          : "border-border/50 bg-background/70 text-muted-foreground",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function SegmentedButtons<TValue extends string>(props: {
  label: string;
  options: ReadonlyArray<TValue>;
  activeValue: TValue;
  onSelect: (value: TValue) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border/60 bg-background/80 p-0.5">
      <span className="sr-only">{props.label}</span>
      {props.options.map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            "rounded-full px-2.5 py-1 text-xs transition-colors",
            option === props.activeValue
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => props.onSelect(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function StatusBadge(props: { label: string }) {
  return (
    <div className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
      {props.label}
    </div>
  );
}

function AtGlanceCard(props: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/80 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-2 font-medium text-xl text-foreground">{props.value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{props.detail}</div>
    </div>
  );
}

function FocusMetric(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/45 bg-card/45 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-2 text-sm text-foreground">{props.value}</div>
    </div>
  );
}

function ActionGroup(props: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/45 bg-card/45 px-3 py-3">
      <div className="font-medium text-sm text-foreground">{props.title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{props.description}</div>
      <div className="mt-3 flex flex-wrap gap-2">{props.children}</div>
    </section>
  );
}

function MetaBadge(props: { label: string }) {
  return (
    <span className="rounded-full border border-border/50 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground">
      {props.label}
    </span>
  );
}

function DiffCount(props: { insertions: number; deletions: number }) {
  return (
    <span className="rounded-full border border-border/50 bg-card/50 px-2.5 py-1 text-[11px]">
      <span className="text-success-foreground">+{props.insertions}</span>
      <span className="px-1 text-muted-foreground">/</span>
      <span className="text-destructive-foreground">-{props.deletions}</span>
    </span>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="max-w-[62%] break-all text-right text-foreground">{props.value}</span>
    </div>
  );
}

function SelectedChunkCard(props: {
  chunk: ReviewDiffChunk;
  rawPatch: string | null;
  loading: boolean;
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium text-sm text-foreground">Selected chunk</h4>
        <MetaBadge
          label={`${props.chunk.anchor.provenance.lane} / ${props.chunk.anchor.provenance.scope}`}
        />
      </div>
      <div className="mt-2 font-mono text-[11px] text-foreground">{props.chunk.header}</div>
      {props.rawPatch ? (
        <pre className="mt-3 overflow-x-auto rounded-xl bg-card px-3 py-2 font-mono text-[11px] text-foreground/90">
          {props.rawPatch}
        </pre>
      ) : props.loading ? (
        <div className="mt-3 text-[11px] text-muted-foreground">Loading raw chunk payload…</div>
      ) : (
        <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
          {props.chunk.lines.slice(0, 4).map((line) => (
            <div
              key={`${line.oldLineNumber ?? "none"}:${line.newLineNumber ?? "none"}:${line.kind}:${line.text}`}
              className="rounded-lg border border-border/35 bg-card/40 px-3 py-2"
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyPanel(props: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-4 py-5">
      <div className="font-medium text-sm text-foreground">{props.title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{props.body}</div>
    </div>
  );
}
