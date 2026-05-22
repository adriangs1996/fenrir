import type { EnvironmentId, ThreadId } from "@fenrir/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { type DraftId, useComposerDraftStore, useComposerThreadDraft } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import type {
  ReviewAnalysisSemanticGroup,
  GitHubReviewDecision,
  GitHubReviewGeneralComment,
  GitHubReviewThread,
  ReviewDiffChunk,
  ReviewLocalAnnotationReply,
  ReviewLocalAnnotationThread,
  ReviewOverviewNote,
  ReviewProgressState,
  ReviewStableAnchor,
} from "../../../../../../packages/contracts/src/review.ts";
import { useReviewController } from "../hooks/useReviewController";
import { type ReviewCommandId, useReviewCommandStore } from "../commandStore";
import type { ReviewRouteMode, ReviewRouteScope, ReviewRouteState } from "../routeSearch";
import {
  buildReviewContextSummaryLabel,
  isReviewContextAttachmentStale,
  type ReviewContextAttachmentDraft,
} from "../reviewComposer";
import { resolveOpenChangeTarget } from "../rawState";

interface ReviewTabShellProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  composerDraftTarget?: unknown;
  onAskAgent?: () => void;
  routeKind: "server" | "draft";
  routeState: ReviewRouteState;
  active: boolean;
  onModeChange: (mode: ReviewRouteMode) => void;
  onScopeChange: (scope: ReviewRouteScope) => void;
  onRouteStateChange: (nextState: ReviewRouteState) => void;
}

type ReviewController = ReturnType<typeof useReviewController>;
type ReviewState = NonNullable<ReviewController["state"]>;

type OverviewDiscussionItem =
  | {
      readonly source: "local";
      readonly note: ReviewOverviewNote;
      readonly updatedAt: string;
    }
  | {
      readonly source: "github";
      readonly comment: GitHubReviewGeneralComment;
      readonly updatedAt: string;
    };

type ChunkDiscussionItem =
  | {
      readonly source: "local";
      readonly thread: ReviewLocalAnnotationThread;
      readonly updatedAt: string;
    }
  | {
      readonly source: "github";
      readonly thread: GitHubReviewThread;
      readonly updatedAt: string;
    };

const MODE_OPTIONS: readonly ReviewRouteMode[] = ["raw", "review"];
const SCOPE_OPTIONS: readonly ReviewRouteScope[] = ["uncommitted", "branch", "combined"];
const PROGRESS_OPTIONS = ["unreviewed", "reviewed", "needs-follow-up"] as const;
const GITHUB_DECISIONS: readonly GitHubReviewDecision[] = ["comment", "approve", "request-changes"];

export function deriveReviewAvailableCommands(args: {
  readonly hasSelectedFileEntry: boolean;
  readonly hasSelectedFile: boolean;
  readonly hasComposerDraftTarget: boolean;
}): ReadonlySet<ReviewCommandId> {
  const availableCommands = new Set<ReviewCommandId>([
    "review.previousItem",
    "review.nextItem",
    "review.toggleMode",
    "review.refreshAnalysis",
    "review.openSubmitReviewTray",
  ]);

  if (args.hasSelectedFileEntry) {
    availableCommands.add("review.openChange");
  }

  if (args.hasSelectedFile) {
    availableCommands.add("review.markReviewed");
    availableCommands.add("review.markNeedsFollowUp");
  }

  if (args.hasComposerDraftTarget) {
    availableCommands.add("review.askAgent");
  }

  return availableCommands;
}

export function ReviewTabShell(props: ReviewTabShellProps) {
  const review = useReviewController(props);
  const composerDraftTarget = (props.composerDraftTarget ?? null) as
    | { environmentId: EnvironmentId; threadId: ThreadId }
    | DraftId
    | null;
  const composerDraft = useComposerThreadDraft(
    composerDraftTarget ??
      ({
        environmentId: props.environmentId,
        threadId: props.threadId,
      } as const),
  );

  useEffect(() => {
    console.log(review);
  }, [review]);

  const setComposerPrompt = useComposerDraftStore((store) => store.setPrompt);
  const removeReviewContext = useComposerDraftStore((store) => store.removeReviewContext);
  const clearReviewContexts = useComposerDraftStore((store) => store.clearReviewContexts);
  const state = review.state;
  const selection = state?.selection ?? null;
  const summary = state?.snapshot.summary ?? null;
  const githubSnapshot = state?.snapshot.github ?? null;
  const latestArtifact = review.latestAnalysisArtifact;
  const semanticGroups = (latestArtifact?.semanticGroups ?? []).toSorted(
    (left, right) => left.suggestedReviewOrder - right.suggestedReviewOrder,
  );
  const selectedFile = selection?.fileId
    ? (state?.snapshot.filesById[selection.fileId] ?? null)
    : null;
  const selectedPatch = review.selectedFilePatch?.value ?? null;
  const selectedChunk =
    selection?.chunkId && selectedPatch
      ? (selectedPatch.chunks.find((chunk) => chunk.chunkId === selection.chunkId) ?? null)
      : null;
  const visibleChunkIds = selectedFile
    ? (state?.snapshot.chunkIdsByFileId[selectedFile.id] ?? [])
    : [];
  const localThreads = useMemo(
    () => filterVisibleLocalThreads(state, selectedFile?.id ?? null, selection?.chunkId ?? null),
    [selectedFile?.id, selection?.chunkId, state],
  );
  const githubThreads = useMemo(
    () =>
      filterVisibleGitHubThreads({
        state,
        normalizedPath: selectedFile?.normalizedPath ?? null,
        selectedAnchor: selectedChunk?.anchor ?? null,
      }),
    [selectedChunk?.anchor, selectedFile?.normalizedPath, state],
  );
  const overviewItems = useMemo(() => buildOverviewDiscussionItems(state), [state]);
  const chunkItems = useMemo(
    () => buildChunkDiscussionItems(localThreads, githubThreads),
    [githubThreads, localThreads],
  );
  const pendingInlineDrafts =
    githubSnapshot?.pendingDrafts.filter((draft) => draft.draftKind === "inline-comment") ?? [];
  const summaryDraft =
    githubSnapshot?.pendingDrafts.find((draft) => draft.draftKind === "review-summary") ?? null;

  const [threadBody, setThreadBody] = useState("");
  const [overviewTitle, setOverviewTitle] = useState("");
  const [overviewBody, setOverviewBody] = useState("");
  const [githubChunkDraftBody, setGitHubChunkDraftBody] = useState("");
  const [githubOverviewBody, setGitHubOverviewBody] = useState(summaryDraft?.body ?? "");
  const [submitDecision, setSubmitDecision] = useState<GitHubReviewDecision>(
    summaryDraft?.submitAction ?? githubSnapshot?.draft?.decision ?? "comment",
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewComposerError, setReviewComposerError] = useState<string | null>(null);
  const askAgentDockRef = useRef<HTMLDivElement | null>(null);
  const askAgentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitReviewTrayRef = useRef<HTMLDivElement | null>(null);
  const setReviewCommandRegistration = useReviewCommandStore((store) => store.setRegistration);

  useEffect(() => {
    setGitHubOverviewBody(summaryDraft?.body ?? "");
  }, [summaryDraft?.body]);

  useEffect(() => {
    setSubmitDecision(summaryDraft?.submitAction ?? githubSnapshot?.draft?.decision ?? "comment");
  }, [githubSnapshot?.draft?.decision, summaryDraft?.submitAction]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setPendingKey(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingKey((current) => (current === key ? null : current));
    }
  };

  const runReviewComposerAction = async (key: string, action: () => Promise<unknown>) => {
    setPendingKey(key);
    setReviewComposerError(null);
    try {
      await action();
    } catch (error) {
      setReviewComposerError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingKey((current) => (current === key ? null : current));
    }
  };

  const githubAvailability = deriveGitHubComposerAvailability({
    state,
    summaryPullRequestNumber: summary?.target.pullRequestNumber ?? null,
    selectedChunkAnchor: selectedChunk?.anchor ?? null,
  });

  const selectFile = (groupId: string, fileId: string) =>
    props.onRouteStateChange({
      ...props.routeState,
      reviewGroupId: groupId,
      reviewFileId: fileId,
      reviewChunkId: undefined,
      reviewCommentId: undefined,
    });

  const selectChunk = (groupId: string, fileId: string, chunkId: string) =>
    props.onRouteStateChange({
      ...props.routeState,
      reviewGroupId: groupId,
      reviewFileId: fileId,
      reviewChunkId: chunkId,
      reviewCommentId: undefined,
    });

  const navigationItems = useMemo(
    () =>
      buildReviewNavigationItems({
        review,
        state,
      }),
    [review, state],
  );

  useEffect(() => {
    if (!props.active || !state) {
      setReviewCommandRegistration(null);
      return;
    }

    const availableCommands = deriveReviewAvailableCommands({
      hasSelectedFileEntry: Boolean(review.selectedFileEntry),
      hasSelectedFile: Boolean(selectedFile),
      hasComposerDraftTarget: Boolean(props.composerDraftTarget),
    });

    const runCommand = async (command: ReviewCommandId) => {
      switch (command) {
        case "review.previousItem": {
          const previous = moveReviewNavigation(navigationItems, selection, "previous");
          if (previous) {
            props.onRouteStateChange(previous);
          }
          return;
        }
        case "review.nextItem": {
          const next = moveReviewNavigation(navigationItems, selection, "next");
          if (next) {
            props.onRouteStateChange(next);
          }
          return;
        }
        case "review.openChange": {
          if (!summary || !review.selectedFileEntry) {
            return;
          }
          const target = resolveOpenChangeTarget({
            cwd: summary.target.cwd,
            file: review.selectedFileEntry,
            ...(selectedPatch ? { patch: selectedPatch } : {}),
            ...(selectedChunk ? { chunk: selectedChunk } : {}),
            ...(review.selectedChunkPayload ? { chunkPayload: review.selectedChunkPayload } : {}),
          });
          await review.openChange(target);
          return;
        }
        case "review.askAgent": {
          if (!props.composerDraftTarget) {
            return;
          }
          askAgentDockRef.current?.scrollIntoView({ block: "nearest" });
          askAgentTextareaRef.current?.focus();
          return;
        }
        case "review.markReviewed": {
          if (!selectedFile) {
            return;
          }
          await review.setProgress({
            ...(selectedChunk ? { chunkId: selectedChunk.chunkId } : { fileId: selectedFile.id }),
            progressState: "reviewed",
          });
          return;
        }
        case "review.markNeedsFollowUp": {
          if (!selectedFile) {
            return;
          }
          await review.setProgress({
            ...(selectedChunk ? { chunkId: selectedChunk.chunkId } : { fileId: selectedFile.id }),
            progressState: "needs-follow-up",
          });
          return;
        }
        case "review.toggleMode": {
          props.onModeChange(props.routeState.reviewMode === "review" ? "raw" : "review");
          return;
        }
        case "review.refreshAnalysis": {
          if (latestArtifact) {
            review.refreshAnalysis();
          } else {
            review.generateAnalysis();
          }
          return;
        }
        case "review.openSubmitReviewTray": {
          submitReviewTrayRef.current?.scrollIntoView({ block: "nearest" });
          return;
        }
      }
    };

    setReviewCommandRegistration({
      availableCommands,
      runCommand,
    });
    return () => {
      setReviewCommandRegistration(null);
    };
  }, [
    latestArtifact,
    navigationItems,
    props,
    review,
    selectedChunk,
    selectedFile,
    selectedPatch,
    selection,
    setReviewCommandRegistration,
    state,
    summary,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-base">Review</h2>
            <p className="text-muted-foreground text-sm">
              Local and GitHub review activity share the same surface, with source-specific actions
              inline.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={props.routeState.reviewMode}
              values={MODE_OPTIONS}
              onChange={props.onModeChange}
            />
            <SegmentedControl
              value={props.routeState.reviewScope}
              values={SCOPE_OPTIONS}
              onChange={props.onScopeChange}
            />
            <Button size="sm" variant="outline" onClick={review.refresh}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Pill>{state?.sessionStatus ?? "idle"}</Pill>
          <Pill>{state?.liveStatus ?? "inactive"}</Pill>
          <Pill>{summary?.fileCount ?? 0} files</Pill>
          <Pill>{summary?.chunkCount ?? 0} chunks</Pill>
          <Pill>{summary?.localThreadCount ?? 0} local</Pill>
          <Pill>{githubThreads.length} GitHub threads</Pill>
          <Pill>{pendingInlineDrafts.length} pending GitHub drafts</Pill>
        </div>
      </div>

      <div className="space-y-3 px-4 pt-4">
        {state?.degradedBanners.map((banner) => (
          <Banner key={banner.id} tone={banner.tone} title={banner.title} detail={banner.detail} />
        ))}
        {actionError ? (
          <Banner tone="error" title="Review action failed" detail={actionError} />
        ) : null}
        {reviewComposerError ? (
          <Banner tone="error" title="Ask agent failed" detail={reviewComposerError} />
        ) : null}
        {!githubAvailability.ready ? (
          <Banner
            tone="warning"
            title="GitHub review is limited"
            detail={githubAvailability.detail}
          />
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)_420px]">
        <section className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/60 p-3">
          <h3 className="mb-3 font-medium text-sm">
            {props.routeState.reviewMode === "review" ? "Analysis + Explorer" : "Explorer"}
          </h3>
          {props.routeKind !== "server" ? (
            <EmptyPanel text="Review sessions only exist for saved server threads." />
          ) : review.visibleLaneIds.length === 0 ? (
            <EmptyPanel text={state?.explorerError ?? "No files match the current review scope."} />
          ) : (
            <div className="space-y-3">
              {props.routeState.reviewMode === "review" && semanticGroups.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-border/50 bg-background/70 p-2.5">
                  <div className="font-medium text-sm">Semantic groups</div>
                  {semanticGroups.map((group) => (
                    <SemanticGroupAttachCard
                      key={group.id}
                      group={group}
                      pending={pendingKey === `attach-group:${group.id}`}
                      onAttach={() =>
                        void runReviewComposerAction(`attach-group:${group.id}`, () =>
                          review.attachSemanticGroupToComposer({
                            title: group.title,
                            targetRefs: group.targetRefs,
                          }),
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}
              {review.visibleLaneIds.map((laneId) => {
                const lane = state?.explorer.laneById[laneId];
                if (!lane || !state) return null;
                return (
                  <div key={laneId} className="rounded-lg border border-border/50 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{lane.title}</div>
                        <div className="text-muted-foreground text-[11px]">{lane.kind}</div>
                      </div>
                      <Badge variant="outline">
                        {(state.explorer.fileIdsByLaneId[laneId] ?? []).length}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      {(state.explorer.fileIdsByLaneId[laneId] ?? []).map((fileId) => {
                        const file = state.snapshot.filesById[fileId];
                        const entry = state.explorer.fileEntryById[fileId];
                        if (!file || !entry) return null;
                        return (
                          <div
                            key={fileId}
                            className={cn(
                              "rounded-md border px-2 py-2",
                              selection?.fileId === fileId
                                ? "border-primary/40 bg-primary/10"
                                : "border-border/40",
                            )}
                          >
                            <button
                              type="button"
                              className="block w-full text-left"
                              onClick={() => selectFile(laneId, fileId)}
                            >
                              <div className="truncate font-mono text-xs">{entry.displayPath}</div>
                              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                                <span>{file.progressState}</span>
                                <span>
                                  +{entry.insertions}/-{entry.deletions}
                                </span>
                                <span>
                                  {state.snapshot.chunkIdsByFileId[fileId]?.length ?? 0} chunks
                                </span>
                              </div>
                            </button>
                            <div className="mt-2 flex justify-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                disabled={pendingKey === `attach-file:${fileId}`}
                                onClick={() =>
                                  void runReviewComposerAction(`attach-file:${fileId}`, () =>
                                    review.attachFileToComposer({
                                      lane: entry.lane,
                                      normalizedPath: entry.normalizedPath,
                                      title: entry.displayPath,
                                    }),
                                  )
                                }
                              >
                                Attach
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/60 p-4">
          {!selectedFile || !state ? (
            <EmptyPanel text="Choose a file to inspect chunks, progress, and review discussion." />
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/50 bg-background/70 p-3">
                <div className="font-mono text-sm">{selectedFile.displayPath}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill>{selectedFile.progressState}</Pill>
                  <ProgressButtons
                    current={selectedFile.progressState}
                    pending={pendingKey === `file-progress:${selectedFile.id}`}
                    onChange={(progressState) =>
                      void run(`file-progress:${selectedFile.id}`, () =>
                        review.setProgress({
                          fileId: selectedFile.id,
                          progressState,
                        }),
                      )
                    }
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 font-medium text-sm">Patch</div>
                {selectedPatch ? (
                  <pre className="max-h-72 overflow-auto rounded-md bg-background/80 p-3 font-mono text-[11px]">
                    {selectedPatch.chunks.map((chunk) => renderChunk(chunk)).join("\n\n")}
                  </pre>
                ) : review.selectedFilePatch?.error ? (
                  <p className="text-sm text-destructive">{review.selectedFilePatch.error}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Patch content loads after a file is selected.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 font-medium text-sm">Chunks</div>
                <div className="space-y-2">
                  {visibleChunkIds.length === 0 ? (
                    <EmptyPanel text="No reviewable chunks are available for this file." />
                  ) : (
                    visibleChunkIds.map((chunkId) => {
                      const chunk = state.snapshot.chunksById[chunkId];
                      if (!chunk) return null;
                      return (
                        <button
                          key={chunkId}
                          type="button"
                          className={cn(
                            "block w-full rounded-md border px-3 py-2 text-left",
                            selection?.chunkId === chunkId
                              ? "border-primary/40 bg-primary/10"
                              : "border-border/40",
                          )}
                          onClick={() => selectChunk(chunk.groupId, chunk.fileId, chunk.id)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">{formatChunkRange(chunk)}</span>
                            <Badge variant="outline">{chunk.progressState}</Badge>
                          </div>
                          <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-muted-foreground">
                            {chunk.anchor.excerpt}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedChunk ? (
                <div className="rounded-lg border border-border/50 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{selectedChunk.header}</Badge>
                      <ProgressButtons
                        current={
                          state.snapshot.chunksById[selectedChunk.chunkId]?.progressState ??
                          "unreviewed"
                        }
                        pending={pendingKey === `chunk-progress:${selectedChunk.chunkId}`}
                        onChange={(progressState) =>
                          void run(`chunk-progress:${selectedChunk.chunkId}`, () =>
                            review.setProgress({
                              chunkId: selectedChunk.chunkId,
                              progressState,
                            }),
                          )
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={pendingKey === `attach-chunk:${selectedChunk.chunkId}`}
                      onClick={() =>
                        void runReviewComposerAction(`attach-chunk:${selectedChunk.chunkId}`, () =>
                          review.attachChunkToComposer({
                            groupId: selectedFile.groupId,
                            fileId: selectedFile.id,
                            lane: selectedPatch?.lane ?? selectedChunk.anchor.provenance.lane,
                            normalizedPath: selectedFile.normalizedPath,
                            displayPath: selectedFile.displayPath,
                            chunkId: selectedChunk.chunkId,
                            title: `${selectedFile.displayPath} ${selectedChunk.header}`,
                          }),
                        )
                      }
                    >
                      Attach chunk
                    </Button>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-md bg-background/80 p-3 font-mono text-[11px]">
                    {review.selectedChunkPayload?.rawPatch ?? renderChunk(selectedChunk)}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-background/70 p-3">
              <div className="font-medium text-sm">Overview discussion</div>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <ComposerCard
                  title="Add local note"
                  detail="Shared only inside this Fenrir thread."
                  actionLabel="Add local note"
                >
                  <Input
                    value={overviewTitle}
                    onChange={(event) => setOverviewTitle(event.target.value)}
                    placeholder="Optional title"
                  />
                  <Textarea
                    className="mt-2"
                    rows={4}
                    value={overviewBody}
                    onChange={(event) => setOverviewBody(event.target.value)}
                    placeholder="General local review comment for the whole thread."
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      disabled={overviewBody.trim().length === 0 || pendingKey === "create-note"}
                      onClick={() =>
                        void run("create-note", async () => {
                          await review.upsertOverviewNote({
                            body: overviewBody.trim(),
                            ...(overviewTitle.trim().length > 0
                              ? { title: overviewTitle.trim() }
                              : {}),
                          });
                          setOverviewTitle("");
                          setOverviewBody("");
                        })
                      }
                    >
                      Add local note
                    </Button>
                  </div>
                </ComposerCard>

                <ComposerCard
                  title="Reply on GitHub"
                  detail="Saved into the review submit tray as the overall review body."
                  actionLabel="Save GitHub review body"
                  disabled={!githubAvailability.ready}
                  disabledDetail={githubAvailability.detail}
                >
                  <Textarea
                    rows={4}
                    value={githubOverviewBody}
                    onChange={(event) => setGitHubOverviewBody(event.target.value)}
                    placeholder="Optional overall GitHub review summary."
                    disabled={!githubAvailability.ready}
                  />
                  <div className="mt-2 flex justify-between gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!summaryDraft || pendingKey === "delete-summary-draft"}
                      onClick={() =>
                        summaryDraft
                          ? void run("delete-summary-draft", async () => {
                              await review.deleteGitHubDraft(summaryDraft.id);
                              setGitHubOverviewBody("");
                            })
                          : undefined
                      }
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !githubAvailability.ready ||
                        githubOverviewBody.trim().length === 0 ||
                        pendingKey === "save-summary-draft"
                      }
                      onClick={() =>
                        void run("save-summary-draft", () =>
                          review.upsertGitHubDraft({
                            draftKind: "review-summary",
                            body: githubOverviewBody.trim(),
                            submitAction: submitDecision,
                            ...(summaryDraft ? { draftId: summaryDraft.id } : {}),
                          }),
                        )
                      }
                    >
                      Save to tray
                    </Button>
                  </div>
                </ComposerCard>
              </div>
            </div>

            <OverviewDiscussionSection
              items={overviewItems}
              pendingKey={pendingKey}
              onDeleteLocalNote={(noteId) =>
                void run(`note-delete:${noteId}`, () => review.deleteOverviewNote(noteId))
              }
              onProgressChange={(noteId, progressState) =>
                void run(`note-progress:${noteId}`, () =>
                  review.setProgress({ overviewNoteId: noteId, progressState }),
                )
              }
            />

            {selectedChunk && selectedFile ? (
              <div className="rounded-lg border border-border/50 bg-background/70 p-3">
                <div className="font-medium text-sm">Chunk discussion</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {selectedFile.displayPath}
                </div>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <ComposerCard
                    title="Add local note"
                    detail="Creates a thread only in Fenrir."
                    actionLabel="Add local thread"
                  >
                    <Textarea
                      rows={4}
                      value={threadBody}
                      onChange={(event) => setThreadBody(event.target.value)}
                      placeholder="Start a local discussion on this chunk."
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        disabled={threadBody.trim().length === 0 || pendingKey === "create-thread"}
                        onClick={() =>
                          void run("create-thread", async () => {
                            await review.createLocalThread({
                              groupId: selectedFile.groupId,
                              fileId: selectedFile.id,
                              chunkId: selectedChunk.chunkId,
                              anchor: selectedChunk.anchor,
                              body: threadBody.trim(),
                            });
                            setThreadBody("");
                          })
                        }
                      >
                        Add local note
                      </Button>
                    </div>
                  </ComposerCard>

                  <ComposerCard
                    title="Reply on GitHub"
                    detail="Creates a new pending inline review comment in the submit tray."
                    actionLabel="Queue GitHub comment"
                    disabled={!githubAvailability.canCreateInlineComment}
                    disabledDetail={githubAvailability.inlineDetail}
                  >
                    <Textarea
                      rows={4}
                      value={githubChunkDraftBody}
                      onChange={(event) => setGitHubChunkDraftBody(event.target.value)}
                      placeholder="Queue a GitHub inline review comment for final submit."
                      disabled={!githubAvailability.canCreateInlineComment}
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        disabled={
                          !githubAvailability.canCreateInlineComment ||
                          githubChunkDraftBody.trim().length === 0 ||
                          pendingKey === `github-inline-draft:${selectedChunk.chunkId}`
                        }
                        onClick={() =>
                          void run(`github-inline-draft:${selectedChunk.chunkId}`, async () => {
                            await review.upsertGitHubDraft({
                              draftKind: "inline-comment",
                              chunkId: selectedChunk.chunkId,
                              body: githubChunkDraftBody.trim(),
                            });
                            setGitHubChunkDraftBody("");
                          })
                        }
                      >
                        Save to tray
                      </Button>
                    </div>
                  </ComposerCard>
                </div>
              </div>
            ) : null}

            <ChunkDiscussionSection
              items={chunkItems}
              repliesByThreadId={state?.snapshot.localRepliesByThreadId ?? {}}
              pendingKey={pendingKey}
              onDeleteLocalThread={(threadId) =>
                void run(`thread-delete:${threadId}`, () => review.deleteLocalThread(threadId))
              }
              onResolveLocalThread={(thread) =>
                void run(`thread-resolve:${thread.id}`, () =>
                  review.setLocalThreadResolved(thread.id, !thread.isResolved),
                )
              }
              onProgressChange={(threadId, progressState) =>
                void run(`thread-progress:${threadId}`, () =>
                  review.setProgress({ threadId, progressState }),
                )
              }
              onCreateLocalReply={(threadId, body) =>
                void run(`reply-create:${threadId}`, () => review.createLocalReply(threadId, body))
              }
              onDeleteLocalReply={(replyId) =>
                void run(`reply-delete:${replyId}`, () => review.deleteLocalReply(replyId))
              }
              onCreateGitHubReply={(threadId, body) =>
                void run(`github-reply:${threadId}`, () =>
                  review.replyToGitHubThread(threadId, body),
                )
              }
            />

            <SubmitReviewTray
              containerRef={submitReviewTrayRef}
              pendingInlineDrafts={pendingInlineDrafts}
              summaryDraft={summaryDraft}
              submitDecision={submitDecision}
              setSubmitDecision={setSubmitDecision}
              pendingKey={pendingKey}
              githubReady={githubAvailability.ready}
              githubDetail={githubAvailability.detail}
              onRemoveDraft={(draftId) =>
                void run(`github-draft-delete:${draftId}`, () => review.deleteGitHubDraft(draftId))
              }
              onSaveSummary={() =>
                void run("save-summary-draft-from-tray", () =>
                  review.upsertGitHubDraft({
                    draftKind: "review-summary",
                    body: githubOverviewBody.trim(),
                    submitAction: submitDecision,
                    ...(summaryDraft ? { draftId: summaryDraft.id } : {}),
                  }),
                )
              }
              onSubmit={(decision) =>
                void run(`github-submit:${decision}`, async () => {
                  if (githubOverviewBody.trim().length > 0) {
                    await review.upsertGitHubDraft({
                      draftKind: "review-summary",
                      body: githubOverviewBody.trim(),
                      submitAction: decision,
                      ...(summaryDraft ? { draftId: summaryDraft.id } : {}),
                    });
                  }
                  await review.submitGitHubDraft({ decision });
                  setGitHubOverviewBody("");
                })
              }
            />
          </div>
        </section>
      </div>

      {composerDraftTarget ? (
        <ReviewComposerDock
          containerRef={askAgentDockRef}
          textareaRef={askAgentTextareaRef}
          draft={composerDraft}
          diffCacheToken={state?.diffCacheToken ?? null}
          pendingKey={pendingKey}
          onPromptChange={(prompt) => setComposerPrompt(composerDraftTarget, prompt)}
          onRemoveAttachment={(attachmentId) =>
            removeReviewContext(composerDraftTarget, attachmentId)
          }
          onClearAll={() => clearReviewContexts(composerDraftTarget)}
          onRefreshAttachment={(attachment) =>
            void runReviewComposerAction(`refresh-review:${attachment.id}`, () =>
              review.refreshComposerReviewContext(attachment),
            )
          }
          onAskAgent={() => props.onAskAgent?.()}
        />
      ) : null}
    </div>
  );
}

function ComposerCard(props: {
  title: string;
  detail: string;
  actionLabel: string;
  children: ReactNode;
  disabled?: boolean;
  disabledDetail?: string;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">{props.title}</div>
        <Badge variant="outline">{props.actionLabel}</Badge>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {props.disabled ? (props.disabledDetail ?? props.detail) : props.detail}
      </div>
      <div className={cn("mt-3", props.disabled ? "pointer-events-none opacity-60" : undefined)}>
        {props.children}
      </div>
    </div>
  );
}

function Banner(props: { tone: "warning" | "error"; title: string; detail: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        props.tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <div className="font-medium text-sm">{props.title}</div>
      <div className="text-xs opacity-90">{props.detail}</div>
    </div>
  );
}

function SemanticGroupAttachCard(props: {
  group: ReviewAnalysisSemanticGroup;
  pending: boolean;
  onAttach: () => void;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{props.group.title}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{props.group.rationale}</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={props.pending}
          onClick={props.onAttach}
        >
          Attach
        </Button>
      </div>
    </div>
  );
}

function ReviewComposerDock(props: {
  containerRef?: RefObject<HTMLDivElement | null>;
  draft: {
    prompt: string;
    reviewContexts: ReviewContextAttachmentDraft[];
  };
  diffCacheToken: string | null;
  pendingKey: string | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onPromptChange: (prompt: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onClearAll: () => void;
  onRefreshAttachment: (attachment: ReviewContextAttachmentDraft) => void;
  onAskAgent: () => void;
}) {
  const staleCount = props.draft.reviewContexts.filter((attachment) =>
    isReviewContextAttachmentStale(attachment, props.diffCacheToken),
  ).length;

  return (
    <div ref={props.containerRef} className="border-t border-border/60 bg-background/95 px-4 py-3">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-xl border border-border/60 bg-card/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Ask agent</div>
            <div className="text-[11px] text-muted-foreground">
              Attached review selections freeze immediately and need refresh after diff changes.
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {props.draft.reviewContexts.length} attached
            {staleCount > 0 ? ` • ${staleCount} stale` : ""}
          </div>
        </div>

        {props.draft.reviewContexts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {props.draft.reviewContexts.map((attachment) => {
              const stale = isReviewContextAttachmentStale(attachment, props.diffCacheToken);
              return (
                <div
                  key={attachment.id}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]",
                    stale
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                      : "border-border/50 bg-card/50",
                  )}
                >
                  <Badge variant={stale ? "warning" : "outline"}>{attachment.sourceKind}</Badge>
                  <span className="max-w-56 truncate">{attachment.title}</span>
                  <span className="text-muted-foreground">
                    {buildReviewContextSummaryLabel(attachment)}
                  </span>
                  {stale ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[11px]"
                      disabled={props.pendingKey === `refresh-review:${attachment.id}`}
                      onClick={() => props.onRefreshAttachment(attachment)}
                    >
                      Refresh
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[11px]"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Attach a chunk, file, or semantic group to send frozen review context through the
            existing thread pipeline.
          </div>
        )}

        <Textarea
          ref={props.textareaRef}
          rows={4}
          value={props.draft.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          placeholder="Ask the agent about the attached review context."
        />

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.draft.reviewContexts.length === 0}
            onClick={props.onClearAll}
          >
            Clear all attachments
          </Button>
          <Button type="button" size="sm" disabled={staleCount > 0} onClick={props.onAskAgent}>
            Ask agent
          </Button>
        </div>
      </div>
    </div>
  );
}

function OverviewDiscussionSection(props: {
  items: readonly OverviewDiscussionItem[];
  pendingKey: string | null;
  onDeleteLocalNote: (noteId: string) => void;
  onProgressChange: (noteId: string, progressState: ReviewProgressState) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="font-medium text-sm">Overview discussion history</div>
      {props.items.length === 0 ? (
        <EmptyPanel text="No overview discussion yet." />
      ) : (
        props.items.map((item) =>
          item.source === "local" ? (
            <div key={item.note.id} className="rounded-lg border border-border/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium text-sm">{item.note.title ?? "Overview note"}</div>
                    <SourceBadge source="local" />
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {item.note.author.subject} • {formatTimestamp(item.note.updatedAt)}
                  </div>
                </div>
                <Badge variant="outline">{item.note.progressState}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{item.note.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ProgressButtons
                  current={item.note.progressState}
                  pending={props.pendingKey === `note-progress:${item.note.id}`}
                  onChange={(progressState) => props.onProgressChange(item.note.id, progressState)}
                />
                {item.note.viewerCanEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => props.onDeleteLocalNote(item.note.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div key={item.comment.id} className="rounded-lg border border-border/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SourceBadge source="github" />
                {item.comment.isPending ? <Badge variant="outline">pending</Badge> : null}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {item.comment.authorLogin} • {formatTimestamp(item.comment.updatedAt)}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{item.comment.body}</p>
            </div>
          ),
        )
      )}
    </div>
  );
}

function ChunkDiscussionSection(props: {
  items: readonly ChunkDiscussionItem[];
  repliesByThreadId: Readonly<Record<string, readonly ReviewLocalAnnotationReply[]>>;
  pendingKey: string | null;
  onDeleteLocalThread: (threadId: string) => void;
  onResolveLocalThread: (thread: ReviewLocalAnnotationThread) => void;
  onProgressChange: (threadId: string, progressState: ReviewProgressState) => void;
  onCreateLocalReply: (threadId: string, body: string) => void;
  onDeleteLocalReply: (replyId: string) => void;
  onCreateGitHubReply: (threadId: string, body: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="font-medium text-sm">Chunk discussion history</div>
      {props.items.length === 0 ? (
        <EmptyPanel text="No discussion exists for the current selection." />
      ) : (
        props.items.map((item) =>
          item.source === "local" ? (
            <LocalThreadCard
              key={item.thread.id}
              thread={item.thread}
              replies={props.repliesByThreadId[item.thread.id] ?? []}
              pendingKey={props.pendingKey}
              onDelete={() => props.onDeleteLocalThread(item.thread.id)}
              onResolve={() => props.onResolveLocalThread(item.thread)}
              onProgressChange={(progressState) =>
                props.onProgressChange(item.thread.id, progressState)
              }
              onCreateReply={(body) => props.onCreateLocalReply(item.thread.id, body)}
              onDeleteReply={props.onDeleteLocalReply}
            />
          ) : (
            <GitHubThreadCard
              key={item.thread.id}
              thread={item.thread}
              pendingKey={props.pendingKey}
              onCreateReply={(body) => props.onCreateGitHubReply(item.thread.id, body)}
            />
          ),
        )
      )}
    </div>
  );
}

function LocalThreadCard(props: {
  thread: ReviewLocalAnnotationThread;
  replies: readonly ReviewLocalAnnotationReply[];
  pendingKey: string | null;
  onDelete: () => void;
  onResolve: () => void;
  onProgressChange: (progressState: ReviewProgressState) => void;
  onCreateReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  const [replyBody, setReplyBody] = useState("");

  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap gap-2">
        <SourceBadge source="local" />
        <Badge variant="outline">{props.thread.progressState}</Badge>
        {props.thread.isResolved ? <Badge variant="outline">resolved</Badge> : null}
        {props.thread.isSuggestedResolved ? (
          <Badge variant="outline">suggested resolved</Badge>
        ) : null}
        {props.thread.isOutdated ? <Badge variant="outline">outdated</Badge> : null}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {props.thread.author.subject} • {formatTimestamp(props.thread.updatedAt)}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm">{props.thread.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ProgressButtons
          current={props.thread.progressState}
          pending={props.pendingKey === `thread-progress:${props.thread.id}`}
          onChange={props.onProgressChange}
        />
        <Button size="sm" variant="outline" onClick={props.onResolve}>
          {props.thread.isResolved ? "Reopen" : "Resolve"}
        </Button>
        {props.thread.viewerCanEdit ? (
          <Button size="sm" variant="ghost" onClick={props.onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
      <div className="mt-4 space-y-2">
        {props.replies.map((reply) => (
          <div key={reply.id} className="rounded-md border border-border/40 bg-background/60 p-2">
            <div className="text-[11px] text-muted-foreground">
              {reply.author.subject} • {formatTimestamp(reply.updatedAt)}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{reply.body}</p>
            {reply.viewerCanEdit ? (
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => props.onDeleteReply(reply.id)}>
                  Delete
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <Textarea
        className="mt-3"
        rows={3}
        value={replyBody}
        onChange={(event) => setReplyBody(event.target.value)}
        placeholder="Reply locally"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          disabled={
            replyBody.trim().length === 0 || props.pendingKey === `reply-create:${props.thread.id}`
          }
          onClick={() => {
            const nextBody = replyBody.trim();
            void props.onCreateReply(nextBody);
            setReplyBody("");
          }}
        >
          Add local reply
        </Button>
      </div>
    </div>
  );
}

function GitHubThreadCard(props: {
  thread: GitHubReviewThread;
  pendingKey: string | null;
  onCreateReply: (body: string) => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const latestTimestamp =
    props.thread.comments.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0]?.updatedAt ?? null;

  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap gap-2">
        <SourceBadge source="github" />
        {props.thread.isResolved ? <Badge variant="outline">resolved</Badge> : null}
        {props.thread.isOutdated ? <Badge variant="outline">outdated</Badge> : null}
        <Badge variant="outline">{formatAnchorLabel(props.thread.anchor)}</Badge>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {props.thread.path}
        {latestTimestamp ? ` • updated ${formatTimestamp(latestTimestamp)}` : ""}
      </div>
      <div className="mt-4 space-y-2">
        {props.thread.comments.map((comment) => (
          <div key={comment.id} className="rounded-md border border-border/40 bg-background/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] text-muted-foreground">
                {comment.authorLogin} • {formatTimestamp(comment.updatedAt)}
              </div>
              {comment.isPending ? <Badge variant="outline">pending</Badge> : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
          </div>
        ))}
      </div>
      <Textarea
        className="mt-3"
        rows={3}
        value={replyBody}
        onChange={(event) => setReplyBody(event.target.value)}
        placeholder="Reply on GitHub"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          disabled={
            replyBody.trim().length === 0 || props.pendingKey === `github-reply:${props.thread.id}`
          }
          onClick={() => {
            const nextBody = replyBody.trim();
            void props.onCreateReply(nextBody);
            setReplyBody("");
          }}
        >
          Reply on GitHub
        </Button>
      </div>
    </div>
  );
}

function SubmitReviewTray(props: {
  containerRef?: RefObject<HTMLDivElement | null>;
  pendingInlineDrafts: readonly {
    readonly id: string;
    readonly anchor: ReviewStableAnchor | null;
    readonly body: string;
    readonly isOutdated: boolean;
    readonly updatedAt: string;
  }[];
  summaryDraft:
    | {
        readonly id: string;
        readonly body: string;
      }
    | null
    | undefined;
  submitDecision: GitHubReviewDecision;
  setSubmitDecision: (decision: GitHubReviewDecision) => void;
  pendingKey: string | null;
  githubReady: boolean;
  githubDetail: string;
  onRemoveDraft: (draftId: string) => void;
  onSaveSummary: () => void;
  onSubmit: (decision: GitHubReviewDecision) => void;
}) {
  const hasPendingReview = props.pendingInlineDrafts.length > 0 || !!props.summaryDraft;

  return (
    <div
      ref={props.containerRef}
      className="rounded-lg border border-border/50 bg-background/70 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-sm">Submit review</div>
          <div className="text-[11px] text-muted-foreground">
            Replies post immediately. New inline comments stay here until final submit.
          </div>
        </div>
        <SourceBadge source="github" />
      </div>

      {!props.githubReady ? (
        <div className="mt-3">
          <EmptyPanel text={props.githubDetail} />
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <div>
          <div className="font-medium text-sm">Pending inline comments</div>
          {props.pendingInlineDrafts.length === 0 ? (
            <div className="mt-2 text-sm text-muted-foreground">
              No queued GitHub inline comments.
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {props.pendingInlineDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="rounded-md border border-border/40 bg-background/60 p-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">
                      {draft.anchor
                        ? `${draft.anchor.normalizedPath} • ${formatAnchorLabel(draft.anchor)}`
                        : "Pending inline comment"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.isOutdated ? <Badge variant="outline">stale</Badge> : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => props.onRemoveDraft(draft.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{draft.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-sm">Overall summary</div>
            <Button
              size="sm"
              variant="outline"
              disabled={props.pendingKey === "save-summary-draft-from-tray"}
              onClick={props.onSaveSummary}
            >
              Save summary
            </Button>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {props.summaryDraft?.body?.trim().length
              ? props.summaryDraft.body
              : "No overall GitHub summary saved yet."}
          </div>
        </div>

        <div>
          <div className="font-medium text-sm">Final action</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {GITHUB_DECISIONS.map((decision) => (
              <Button
                key={decision}
                size="sm"
                variant={props.submitDecision === decision ? "default" : "outline"}
                onClick={() => props.setSubmitDecision(decision)}
              >
                {formatDecisionLabel(decision)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            disabled={
              !props.githubReady ||
              !hasPendingReview ||
              props.pendingKey === `github-submit:${props.submitDecision}`
            }
            onClick={() => props.onSubmit(props.submitDecision)}
          >
            {formatDecisionLabel(props.submitDecision)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProgressButtons(props: {
  current: ReviewProgressState;
  pending: boolean;
  onChange: (progressState: ReviewProgressState) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {PROGRESS_OPTIONS.map((progressState) => (
        <Button
          key={progressState}
          size="sm"
          variant={props.current === progressState ? "default" : "outline"}
          disabled={props.pending}
          onClick={() => props.onChange(progressState)}
        >
          {progressState}
        </Button>
      ))}
    </div>
  );
}

export interface ReviewNavigationItem {
  readonly routeState: ReviewRouteState;
}

export function buildReviewNavigationItems(args: {
  review: ReviewController;
  state: ReviewState | null | undefined;
}): readonly ReviewNavigationItem[] {
  if (!args.state) {
    return [];
  }

  const items: ReviewNavigationItem[] = [];
  for (const laneId of args.review.visibleLaneIds) {
    const fileIds = args.state.explorer.fileIdsByLaneId[laneId] ?? [];
    for (const fileId of fileIds) {
      const file = args.state.snapshot.filesById[fileId];
      if (!file || !args.state.filters.progressStates[file.progressState]) {
        continue;
      }
      items.push({
        routeState: {
          tab: "review",
          reviewMode: args.state.routeState.reviewMode,
          reviewScope: args.state.routeState.reviewScope,
          reviewGroupId: laneId,
          reviewFileId: fileId,
        },
      });
      for (const chunkId of args.state.snapshot.chunkIdsByFileId[fileId] ?? []) {
        items.push({
          routeState: {
            tab: "review",
            reviewMode: args.state.routeState.reviewMode,
            reviewScope: args.state.routeState.reviewScope,
            reviewGroupId: laneId,
            reviewFileId: fileId,
            reviewChunkId: chunkId,
          },
        });
      }
    }
  }
  return items;
}

export function moveReviewNavigation(
  items: readonly ReviewNavigationItem[],
  selection:
    | {
        readonly groupId: string | null;
        readonly fileId: string | null;
        readonly chunkId: string | null;
      }
    | null
    | undefined,
  direction: "previous" | "next",
): ReviewRouteState | null {
  if (items.length === 0) {
    return null;
  }

  const currentIndex = items.findIndex(
    (item) =>
      (item.routeState.reviewGroupId ?? null) === (selection?.groupId ?? null) &&
      (item.routeState.reviewFileId ?? null) === (selection?.fileId ?? null) &&
      (item.routeState.reviewChunkId ?? null) === (selection?.chunkId ?? null),
  );
  if (currentIndex === -1) {
    return items[0]?.routeState ?? null;
  }

  const delta = direction === "next" ? 1 : -1;
  const targetIndex = (currentIndex + delta + items.length) % items.length;
  return items[targetIndex]?.routeState ?? null;
}

function SegmentedControl<TValue extends string>(props: {
  value: TValue;
  values: readonly TValue[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border/60 p-1">
      {props.values.map((value) => (
        <Button
          key={value}
          size="sm"
          variant={value === props.value ? "default" : "ghost"}
          onClick={() => props.onChange(value)}
        >
          {value}
        </Button>
      ))}
    </div>
  );
}

function SourceBadge(props: { source: "local" | "github" }) {
  return <Badge variant="outline">{props.source === "local" ? "Local note" : "GitHub"}</Badge>;
}

function Pill(props: { children: ReactNode }) {
  return <span className="rounded-full border border-border/60 px-2 py-1">{props.children}</span>;
}

function EmptyPanel(props: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
      {props.text}
    </div>
  );
}

function buildOverviewDiscussionItems(
  state: ReviewState | undefined,
): readonly OverviewDiscussionItem[] {
  if (!state) {
    return [];
  }

  const localItems = state.snapshot.overviewNoteIds
    .map((noteId) => state.snapshot.overviewNotesById[noteId] ?? null)
    .filter((note): note is ReviewOverviewNote => note !== null)
    .map((note) => ({
      source: "local" as const,
      note,
      updatedAt: note.updatedAt,
    }));

  const githubItems = state.snapshot.githubGeneralCommentIds
    .map((commentId) => state.snapshot.githubGeneralCommentsById[commentId] ?? null)
    .filter((comment): comment is GitHubReviewGeneralComment => comment !== null)
    .map((comment) => ({
      source: "github" as const,
      comment,
      updatedAt: comment.updatedAt,
    }));

  return [...localItems, ...githubItems].toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function buildChunkDiscussionItems(
  localThreads: readonly ReviewLocalAnnotationThread[],
  githubThreads: readonly GitHubReviewThread[],
): readonly ChunkDiscussionItem[] {
  return [
    ...localThreads.map((thread) => ({
      source: "local" as const,
      thread,
      updatedAt: thread.updatedAt,
    })),
    ...githubThreads.map((thread) => ({
      source: "github" as const,
      thread,
      updatedAt:
        thread.comments.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
          ?.updatedAt ?? "",
    })),
  ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterVisibleLocalThreads(
  state: ReviewState | undefined,
  fileId: string | null,
  chunkId: string | null,
) {
  if (!state) return [] as ReviewLocalAnnotationThread[];
  return state.snapshot.localThreadIds
    .map((threadId) => state.snapshot.localThreadsById[threadId] ?? null)
    .filter((thread): thread is ReviewLocalAnnotationThread => thread !== null)
    .filter((thread) =>
      chunkId ? thread.chunkId === chunkId : fileId ? thread.fileId === fileId : true,
    );
}

export function filterVisibleGitHubThreads(input: {
  state: ReviewState | undefined;
  normalizedPath: string | null;
  selectedAnchor: ReviewStableAnchor | null;
}) {
  if (!input.state || !input.normalizedPath) {
    return [] as GitHubReviewThread[];
  }

  return input.state.snapshot.githubThreadIds
    .map((threadId) => input.state!.snapshot.githubThreadsById[threadId] ?? null)
    .filter((thread): thread is GitHubReviewThread => thread !== null)
    .filter((thread) => thread.path === input.normalizedPath)
    .filter((thread) =>
      input.selectedAnchor ? anchorsOverlap(thread.anchor, input.selectedAnchor) : true,
    );
}

export function anchorsOverlap(left: ReviewStableAnchor, right: ReviewStableAnchor) {
  if (left.normalizedPath !== right.normalizedPath) {
    return false;
  }

  const leftRange = left.newRange ?? left.oldRange ?? null;
  const rightRange = right.newRange ?? right.oldRange ?? null;
  if (!leftRange || !rightRange) {
    return true;
  }

  return leftRange.startLine <= rightRange.endLine && rightRange.startLine <= leftRange.endLine;
}

export function deriveGitHubComposerAvailability(input: {
  state: ReviewState | undefined;
  summaryPullRequestNumber: number | null;
  selectedChunkAnchor: ReviewStableAnchor | null;
}) {
  if (input.summaryPullRequestNumber === null) {
    return {
      ready: false,
      detail: "No pull request is attached to this review session.",
      canCreateInlineComment: false,
      inlineDetail: "Attach a pull request before posting review comments to GitHub.",
    };
  }

  const github = input.state?.snapshot.github ?? null;
  if (!github) {
    return {
      ready: false,
      detail: "GitHub review state could not be loaded for this pull request.",
      canCreateInlineComment: false,
      inlineDetail: "GitHub review state could not be loaded for this pull request.",
    };
  }

  if (!github.writable) {
    return {
      ready: false,
      detail: "GitHub review is read-only. Check provider auth and repository access.",
      canCreateInlineComment: false,
      inlineDetail: "GitHub review is read-only. Check provider auth and repository access.",
    };
  }

  if (!input.selectedChunkAnchor) {
    return {
      ready: true,
      detail: "GitHub review is ready.",
      canCreateInlineComment: false,
      inlineDetail: "Select a diff chunk to queue an inline GitHub comment.",
    };
  }

  if (input.selectedChunkAnchor.provenance.lane !== "committed") {
    return {
      ready: true,
      detail: "GitHub review is ready.",
      canCreateInlineComment: false,
      inlineDetail: "Only committed PR diff chunks can be queued as GitHub inline comments.",
    };
  }

  return {
    ready: true,
    detail: "GitHub review is ready.",
    canCreateInlineComment: true,
    inlineDetail: "GitHub review is ready.",
  };
}

function formatChunkRange(chunk: {
  anchor: {
    newRange?: { startLine: number; endLine: number };
    oldRange?: { startLine: number; endLine: number };
  };
}) {
  const range = chunk.anchor.newRange ?? chunk.anchor.oldRange;
  return range ? `Lines ${range.startLine}-${range.endLine}` : "Anchored chunk";
}

function formatAnchorLabel(anchor: ReviewStableAnchor) {
  const range = anchor.newRange ?? anchor.oldRange;
  return range ? `Lines ${range.startLine}-${range.endLine}` : "Anchored";
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatDecisionLabel(decision: GitHubReviewDecision) {
  switch (decision) {
    case "comment":
      return "Comment";
    case "approve":
      return "Approve";
    case "request-changes":
      return "Request changes";
  }
}

function renderChunk(chunk: ReviewDiffChunk) {
  return [
    chunk.header,
    ...chunk.lines.map(
      (line) => `${line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}${line.text}`,
    ),
  ].join("\n");
}
