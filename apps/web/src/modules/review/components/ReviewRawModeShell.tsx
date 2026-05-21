import { useVirtualizer } from "@tanstack/react-virtual";
import type { EnvironmentId, ThreadId } from "@fenrir/contracts";
import {
  BotIcon,
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
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import type {
  ReviewDiffChunk,
  ReviewDiffFileEntry,
  ReviewDiffFilePatch,
  ReviewProgressState,
  ReviewRawLaneKind,
} from "../../../../../../packages/contracts/src/review.ts";
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

interface ExplorerFileRef {
  readonly laneId: string;
  readonly fileId: string;
  readonly fileEntry: ReviewDiffFileEntry;
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
      readonly kind: "file";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly laneId: string;
      readonly fileId: string;
      readonly fileEntry: ReviewDiffFileEntry;
    }
  | {
      readonly id: string;
      readonly kind: "chunk";
      readonly sectionKey: ReviewExplorerSectionKey;
      readonly laneId: string;
      readonly fileId: string;
      readonly fileEntry: ReviewDiffFileEntry;
      readonly chunk: ReviewDiffChunk;
    }
  | {
      readonly id: string;
      readonly kind: "status";
      readonly sectionKey: ReviewExplorerSectionKey;
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
  readonly sections: ReadonlyMap<ReviewExplorerSectionKey, readonly ExplorerFileRef[]>;
  readonly expandedSections: Readonly<Record<ReviewExplorerSectionKey, boolean>>;
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

  for (const sectionKey of SECTION_ORDER) {
    const files = args.sections.get(sectionKey) ?? [];
    rows.push({
      id: `section:${sectionKey}`,
      kind: "section",
      sectionKey,
      title: reviewSectionTitle(sectionKey),
      fileCount: files.length,
    });

    if (!args.expandedSections[sectionKey]) {
      continue;
    }

    for (const { laneId, fileId, fileEntry } of files) {
      rows.push({
        id: `file:${fileId}`,
        kind: "file",
        sectionKey,
        laneId,
        fileId,
        fileEntry,
      });
      const fileExpanded = args.fileExpansion[fileId] || args.selectedFileId === fileId;
      if (!fileExpanded) {
        continue;
      }

      const patchEntry =
        args.selectedPatchFileId === fileId ? (args.selectedFilePatch ?? null) : null;
      if (patchEntry?.status === "loading") {
        rows.push({
          id: `status:${fileId}:loading`,
          kind: "status",
          sectionKey,
          fileId,
          message: "Loading chunks…",
          tone: "muted",
        });
        continue;
      }
      if (patchEntry?.error) {
        rows.push({
          id: `status:${fileId}:error`,
          kind: "status",
          sectionKey,
          fileId,
          message: patchEntry.error,
          tone: "error",
        });
        continue;
      }
      if (patchEntry?.value?.chunks.length) {
        for (const chunk of patchEntry.value.chunks) {
          rows.push({
            id: `chunk:${chunk.chunkId}`,
            kind: "chunk",
            sectionKey,
            laneId,
            fileId,
            fileEntry,
            chunk,
          });
        }
      }
    }
  }

  return rows;
}

export function estimateExplorerRowSize(row: ExplorerRow | undefined): number {
  if (!row) return 56;
  switch (row.kind) {
    case "section":
      return 48;
    case "file":
      return 82;
    case "chunk":
      return 68;
    case "status":
      return 36;
  }
}

export function estimatePatchChunkRowSize(chunk: ReviewDiffChunk | undefined): number {
  return 64 + (chunk?.lines.length ?? 0) * 18;
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
    const sectionMap = new Map<ReviewExplorerSectionKey, ExplorerFileRef[]>(
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

  const explorerRows = useMemo<readonly ExplorerRow[]>(
    () =>
      buildExplorerRows({
        sections,
        expandedSections,
        fileExpansion: state?.expansion.fileIds ?? {},
        selectedFileId: selection?.fileId,
        selectedPatchFileId: selectedPatch?.fileId,
        selectedFilePatch: review.selectedFilePatch,
      }),
    [
      expandedSections,
      review.selectedFilePatch,
      sections,
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,_color-mix(in_srgb,var(--accent)_10%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--card))_0%,var(--background)_100%)]">
      <div className="border-b border-border/60 px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-base text-foreground">Review</h2>
            <p className="text-muted-foreground text-sm">
              Raw mode is authoritative for live Git state. File patches and chunks hydrate lazily.
            </p>
          </div>
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge label={`Session ${state?.sessionStatus ?? "idle"}`} />
          <StatusBadge label={`Live ${state?.liveStatus ?? "inactive"}`} />
          {summary ? <StatusBadge label={`${summary.fileCount} files`} /> : null}
          {summary ? <StatusBadge label={`${summary.progressCounts.reviewed} reviewed`} /> : null}
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

      <div className="flex min-h-0 min-w-0 flex-1 gap-3 px-3 py-3 sm:px-5 sm:py-4">
        <aside className="flex min-h-0 w-full max-w-[380px] flex-col rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
          <div className="mb-4">
            <h3 className="font-medium text-sm text-foreground">Explorer</h3>
            <p className="mt-1 text-muted-foreground text-xs">
              Sections stay fixed while files can appear more than once when provenance differs.
            </p>
          </div>

          <FilterSection
            progressStates={state?.filters.progressStates}
            laneKinds={state?.filters.laneKinds}
            onToggleProgress={(progressState) =>
              review.setFilters((current) => ({
                ...current,
                progressStates: {
                  ...current.progressStates,
                  [progressState]: !current.progressStates[progressState],
                },
              }))
            }
            onToggleLane={(laneKind) =>
              review.setFilters((current) => ({
                ...current,
                laneKinds: {
                  ...current.laneKinds,
                  [laneKind]: !current.laneKinds[laneKind],
                },
              }))
            }
          />

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
                          onToggleChecked={(checked) =>
                            toggleSelectionTarget(buildFileSelectionTarget(row.fileEntry), checked)
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
                              buildChunkSelectionTarget(row.fileEntry, row.chunk),
                              checked,
                            )
                          }
                          onSelect={() => selectChunk(row.laneId, row.fileId, row.chunk.chunkId)}
                        />
                      ) : (
                        <div
                          className={cn(
                            "px-3 py-2 text-[11px]",
                            row.tone === "error"
                              ? "text-destructive-foreground"
                              : "text-muted-foreground",
                          )}
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

        <main className="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(290px,0.6fr)]">
          <section className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-sm text-foreground">Raw Review Surface</h3>
                <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
                  {routeState.reviewMode === "review"
                    ? "The AI brief can help prioritize, but the raw explorer remains the source of truth for staging, undo, and provenance."
                    : "Use the explorer to compare ignored, unstaged, staged, and branch-committed state without leaving Fenrir."}
                </p>
              </div>
              <div className="rounded-full border border-border/60 bg-background/80 px-3 py-1 font-mono text-[11px] text-muted-foreground">
                {summary?.id ?? "No session"}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Mode" value={routeState.reviewMode} />
              <MetricCard label="Scope" value={routeState.reviewScope} />
              <MetricCard label="Selection" value={String(activeTargets.length)} />
              <MetricCard label="Analysis" value={latestArtifact?.staleStatus ?? "none"} />
            </div>

            <div className="mt-4 rounded-xl border border-border/50 bg-background/80 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-sm text-foreground">
                    Bulk actions
                    {selectedTargets.length > 0 ? ` (${selectedTargets.length} selected)` : ""}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Undo applies to the current live anchor only. If the underlying diff moved, the
                    action will fail and ask for a refresh.
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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ActionButton
                  label="Stage"
                  disabled={!mutationAvailability.stage || actionState.busy}
                  onClick={() =>
                    void runMutation("Staging selection", async () => {
                      const results = await review.applyRawMutations("stage", activeTargets);
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
                      const results = await review.applyRawMutations("unstage", activeTargets);
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
                {progressActions.map((progressState) => (
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
                ))}
              </div>

              {actionState.busy && actionState.label ? (
                <div className="mt-3 text-[11px] text-muted-foreground">{actionState.label}…</div>
              ) : null}
              {actionState.error ? (
                <div className="mt-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
                  {actionState.error}
                </div>
              ) : null}
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
                  body="Select a file in the explorer to hydrate its patch. Expand the file to select chunks for safe bulk actions."
                />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/50 bg-background/80 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-foreground">
                          {selectedFileEntry.displayPath}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge size="sm" variant="outline">
                            {selectedFileEntry.changeKind}
                          </Badge>
                          <Badge size="sm" variant="outline">
                            {selectedFileEntry.provenance.lane}
                          </Badge>
                          <Badge size="sm" variant="outline">
                            {selectedFileEntry.provenance.scope}
                          </Badge>
                          <span>
                            +{selectedFileEntry.insertions} / -{selectedFileEntry.deletions}
                          </span>
                        </div>
                      </div>
                      <StatusBadge label={review.selectedFilePatch?.status ?? "idle"} />
                    </div>
                    {selectedFileEntry.ignoreRule ? (
                      <div className="mt-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
                        Ignore rule: {selectedFileEntry.ignoreRule.ruleKind}{" "}
                        {selectedFileEntry.ignoreRule.matchPath}
                      </div>
                    ) : null}
                  </div>

                  {selectedFileEntry.metadata ? (
                    <MetadataCard
                      title={selectedFileEntry.metadata.title}
                      kind={selectedFileEntry.metadata.kind}
                      lines={selectedFileEntry.metadata.summaryLines}
                    />
                  ) : null}

                  {review.selectedFilePatch?.error ? (
                    <EmptyPanel title="Patch load failed" body={review.selectedFilePatch.error} />
                  ) : review.selectedFilePatch?.status === "loading" ? (
                    <EmptyPanel title="Loading patch" body="Hydrating the current file patch." />
                  ) : selectedPatch && selectedPatch.chunks.length > 0 ? (
                    <>
                      {selectedChunk ? (
                        <section className="rounded-xl border border-border/50 bg-background/80 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-sm text-foreground">
                              Selected chunk
                            </div>
                            <Badge size="sm" variant="outline">
                              {selectedChunk.anchor.provenance.lane}
                            </Badge>
                            <Badge size="sm" variant="outline">
                              {selectedChunk.anchor.provenance.scope}
                            </Badge>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {selectedChunk.header}
                            </span>
                          </div>
                          {review.selectedChunkPayload ? (
                            <pre className="mt-3 overflow-x-auto rounded-lg bg-card px-3 py-2 font-mono text-[11px] text-foreground/90">
                              {review.selectedChunkPayload.rawPatch}
                            </pre>
                          ) : review.selectedChunkPayloadEntry?.status === "loading" ? (
                            <div className="mt-3 text-[11px] text-muted-foreground">
                              Loading raw chunk payload…
                            </div>
                          ) : null}
                        </section>
                      ) : null}

                      <section className="flex min-h-0 flex-col rounded-xl border border-border/50 bg-background/80 p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <h4 className="font-medium text-sm text-foreground">Patch chunks</h4>
                          <span className="text-[11px] text-muted-foreground">
                            Virtualized for large diffs
                          </span>
                        </div>
                        <div ref={patchParentRef} className="min-h-0 max-h-[520px] overflow-y-auto">
                          <div
                            className="relative"
                            style={{ height: `${patchVirtualizer.getTotalSize()}px` }}
                          >
                            {patchVirtualizer.getVirtualItems().map((virtualItem) => {
                              const chunk = patchChunks[virtualItem.index];
                              if (!chunk) return null;
                              return (
                                <div
                                  key={chunk.chunkId}
                                  className="absolute left-0 top-0 w-full"
                                  style={{ transform: `translateY(${virtualItem.start}px)` }}
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
                    </>
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

          <section className="flex min-h-0 flex-col gap-3">
            <section className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
              <h3 className="font-medium text-sm text-foreground">Session Snapshot</h3>
              <div className="mt-3 space-y-2 text-sm">
                <InfoRow
                  label="Repository"
                  value={summary?.target.repositoryName ?? summary?.target.repositoryRoot ?? "—"}
                />
                <InfoRow label="Selection" value={summary?.target.selectionLabel ?? "—"} />
                <InfoRow label="Base" value={summary?.target.baseRef ?? "—"} />
                <InfoRow label="Head" value={summary?.target.headRef ?? "—"} />
                <InfoRow label="Files" value={String(summary?.fileCount ?? 0)} />
                <InfoRow
                  label="Review progress"
                  value={`${summary?.progressCounts.reviewed ?? 0} reviewed / ${summary?.progressCounts.needsFollowUp ?? 0} follow-up`}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm text-foreground">Latest Analysis</h3>
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
                <div className="mt-3 space-y-2 text-sm">
                  <InfoRow label="Provider" value={latestArtifact.provider} />
                  <InfoRow label="Status" value={latestArtifact.status} />
                  <InfoRow label="Freshness" value={latestArtifact.staleStatus} />
                  <InfoRow
                    label="Generated"
                    value={latestArtifact.completedAt ?? latestArtifact.requestedAt}
                  />
                  <div className="rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                    {latestArtifact.summaryMarkdown
                      ? latestArtifact.summaryMarkdown.slice(0, 320)
                      : "This artifact does not include a summary body yet."}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No review analysis has been generated for this session yet.
                </p>
              )}
            </section>
          </section>
        </main>
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
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/85 px-3 py-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={props.onSelectLane}>
          <div className="font-medium text-sm text-foreground">{props.row.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {props.row.fileCount} visible file{props.row.fileCount === 1 ? "" : "s"}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Badge size="sm" variant="outline">
            {props.row.fileCount}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={props.onToggle}
          >
            {props.expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExplorerFileRow(props: {
  row: Extract<ExplorerRow, { kind: "file" }>;
  progressState: ReviewProgressState;
  selected: boolean;
  expanded: boolean;
  checked: boolean;
  onToggleChecked: (checked: boolean) => void;
  onSelect: () => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div className="py-1">
      <div
        className={cn(
          "rounded-xl border px-3 py-2.5",
          props.selected ? "border-primary/35 bg-primary/8" : "border-border/40 bg-card/45",
        )}
      >
        <div className="flex items-start gap-2">
          <Checkbox
            checked={props.checked}
            onCheckedChange={(checked) => props.onToggleChecked(checked === true)}
            className="mt-0.5"
          />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={props.onSelect}>
            <div className="truncate font-mono text-xs text-foreground">
              {props.row.fileEntry.displayPath}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge size="sm" variant="outline">
                {props.progressState}
              </Badge>
              <Badge size="sm" variant="outline">
                {props.row.fileEntry.provenance.lane}
              </Badge>
              <Badge size="sm" variant="outline">
                {props.row.fileEntry.provenance.scope}
              </Badge>
              <span>
                +{props.row.fileEntry.insertions} / -{props.row.fileEntry.deletions}
              </span>
            </div>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={props.onToggleExpanded}
          >
            {props.expanded ? "Hide" : "Chunks"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExplorerChunkRow(props: {
  row: Extract<ExplorerRow, { kind: "chunk" }>;
  selected: boolean;
  checked: boolean;
  onToggleChecked: (checked: boolean) => void;
  onSelect: () => void;
}) {
  return (
    <div className="pl-7 py-1">
      <div
        className={cn(
          "rounded-lg border px-3 py-2",
          props.selected ? "border-primary/35 bg-primary/8" : "border-border/35 bg-background/75",
        )}
      >
        <div className="flex items-start gap-2">
          <Checkbox
            checked={props.checked}
            onCheckedChange={(checked) => props.onToggleChecked(checked === true)}
            className="mt-0.5"
          />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={props.onSelect}>
            <div className="font-mono text-[11px] text-foreground">{props.row.chunk.header}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge size="sm" variant="outline">
                {props.row.chunk.anchor.provenance.lane}
              </Badge>
              <Badge size="sm" variant="outline">
                {props.row.chunk.anchor.provenance.scope}
              </Badge>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
              {props.row.chunk.lines
                .slice(0, 2)
                .map((line) => line.text)
                .join(" ")}
            </div>
          </button>
        </div>
      </div>
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
        "mb-3 block w-full rounded-xl border px-3 py-3 text-left",
        props.selected ? "border-primary/35 bg-primary/8" : "border-border/40 bg-card/40",
      )}
      onClick={props.onSelect}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{props.chunk.header}</span>
        <Badge size="sm" variant="outline">
          {props.chunk.anchor.provenance.lane}
        </Badge>
        <Badge size="sm" variant="outline">
          {props.chunk.anchor.provenance.scope}
        </Badge>
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
  onToggleProgress: (progressState: ReviewProgressState) => void;
  onToggleLane: (laneKind: ReviewRawLaneKind) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Progress
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
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Provenance
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

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/80 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-2 font-medium text-lg text-foreground">{props.value}</div>
    </div>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="max-w-[62%] text-right text-foreground">{props.value}</span>
    </div>
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
