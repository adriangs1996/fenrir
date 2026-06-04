import type {
  ReviewApplyRawMutationInput,
  ReviewChunkId,
  ReviewDiffChunk,
  ReviewDiffChunkLine,
  ReviewDiffFilePatch,
  ReviewFileId,
  ReviewProgressState,
} from "@fenrir/contracts";
import { Columns2Icon, Rows3Icon, TextWrapIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ReviewChunkToolbar } from "./ReviewChunkToolbar";
import type { DiffViewMode } from "./stackUiState";

interface ReviewDiffViewerProps {
  readonly patch: ReviewDiffFilePatch | null;
  readonly isLoading: boolean;
  readonly viewMode: DiffViewMode;
  readonly wrap: boolean;
  readonly mutationPending?: boolean;
  readonly onViewModeChange: (viewMode: DiffViewMode) => void;
  readonly onWrapChange: (wrap: boolean) => void;
  readonly onRawMutation: (input: ReviewApplyRawMutationInput) => void;
  readonly onProgress: (input: {
    readonly fileId?: ReviewFileId;
    readonly chunkId?: ReviewChunkId;
    readonly progressState: ReviewProgressState;
  }) => void;
}

function lineClass(kind: ReviewDiffChunkLine["kind"]) {
  switch (kind) {
    case "add":
      return "bg-emerald-500/10 text-emerald-950 dark:text-emerald-100";
    case "delete":
      return "bg-red-500/10 text-red-950 dark:text-red-100";
    case "context":
      return "text-muted-foreground";
  }
}

function linePrefix(kind: ReviewDiffChunkLine["kind"]) {
  switch (kind) {
    case "add":
      return "+";
    case "delete":
      return "-";
    case "context":
      return " ";
  }
}

function lineKey(line: ReviewDiffChunkLine): string {
  return `${line.kind}:${line.oldLineNumber ?? "n"}:${line.newLineNumber ?? "n"}:${line.text}`;
}

function UnifiedChunkLines({
  lines,
  wrap,
}: {
  readonly lines: ReadonlyArray<ReviewDiffChunkLine>;
  readonly wrap: boolean;
}) {
  return (
    <div className="font-mono text-xs leading-5">
      {lines.map((line) => (
        <div
          key={lineKey(line)}
          className={cn("grid grid-cols-[4rem_4rem_1rem_1fr]", lineClass(line.kind))}
        >
          <span className="select-none px-2 text-right text-muted-foreground/70">
            {line.oldLineNumber ?? ""}
          </span>
          <span className="select-none px-2 text-right text-muted-foreground/70">
            {line.newLineNumber ?? ""}
          </span>
          <span className="select-none">{linePrefix(line.kind)}</span>
          <span className={cn("min-w-0 px-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function SplitChunkLines({
  lines,
  wrap,
}: {
  readonly lines: ReadonlyArray<ReviewDiffChunkLine>;
  readonly wrap: boolean;
}) {
  return (
    <div className="grid grid-cols-2 font-mono text-xs leading-5">
      {lines.map((line) => {
        const key = lineKey(line);
        if (line.kind === "add") {
          return (
            <div key={key} className="contents">
              <div className="border-r border-border bg-background" />
              <div className={cn("grid grid-cols-[4rem_1rem_1fr]", lineClass(line.kind))}>
                <span className="select-none px-2 text-right text-muted-foreground/70">
                  {line.newLineNumber ?? ""}
                </span>
                <span className="select-none">+</span>
                <span
                  className={cn("min-w-0 px-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}
                >
                  {line.text}
                </span>
              </div>
            </div>
          );
        }
        if (line.kind === "delete") {
          return (
            <div key={key} className="contents">
              <div
                className={cn(
                  "grid grid-cols-[4rem_1rem_1fr] border-r border-border",
                  lineClass(line.kind),
                )}
              >
                <span className="select-none px-2 text-right text-muted-foreground/70">
                  {line.oldLineNumber ?? ""}
                </span>
                <span className="select-none">-</span>
                <span
                  className={cn("min-w-0 px-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}
                >
                  {line.text}
                </span>
              </div>
              <div className="bg-background" />
            </div>
          );
        }
        return (
          <div key={key} className="contents">
            <div
              className={cn(
                "grid grid-cols-[4rem_1rem_1fr] border-r border-border",
                lineClass(line.kind),
              )}
            >
              <span className="select-none px-2 text-right text-muted-foreground/70">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="select-none"> </span>
              <span className={cn("min-w-0 px-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
                {line.text}
              </span>
            </div>
            <div className={cn("grid grid-cols-[4rem_1rem_1fr]", lineClass(line.kind))}>
              <span className="select-none px-2 text-right text-muted-foreground/70">
                {line.newLineNumber ?? ""}
              </span>
              <span className="select-none"> </span>
              <span className={cn("min-w-0 px-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
                {line.text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function targetForPatch(
  patch: ReviewDiffFilePatch,
  chunk?: ReviewDiffChunk,
): ReviewApplyRawMutationInput["target"] {
  if (chunk) {
    return {
      targetKind: "chunk",
      lane: patch.lane,
      normalizedPath: patch.normalizedPath,
      chunkId: chunk.chunkId,
    };
  }
  return {
    targetKind: "file",
    lane: patch.lane,
    normalizedPath: patch.normalizedPath,
  };
}

export function ReviewDiffViewer({
  patch,
  isLoading,
  viewMode,
  wrap,
  mutationPending,
  onViewModeChange,
  onWrapChange,
  onRawMutation,
  onProgress,
}: ReviewDiffViewerProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {patch?.displayPath ?? (isLoading ? "Loading patch" : "Select a file")}
          </div>
          {patch ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              +{patch.insertions} / -{patch.deletions} · {patch.lane}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant={viewMode === "unified" ? "secondary" : "ghost"}
            title="Unified diff"
            onClick={() => onViewModeChange("unified")}
          >
            <Rows3Icon />
          </Button>
          <Button
            size="icon-xs"
            variant={viewMode === "split" ? "secondary" : "ghost"}
            title="Split diff"
            onClick={() => onViewModeChange("split")}
          >
            <Columns2Icon />
          </Button>
          <Button
            size="icon-xs"
            variant={wrap ? "secondary" : "ghost"}
            title="Toggle wrap"
            onClick={() => onWrapChange(!wrap)}
          >
            <TextWrapIcon />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading file patch…</div>
        ) : patch ? (
          <div className="min-w-max">
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
              <ReviewChunkToolbar
                patch={patch}
                disabled={mutationPending ?? false}
                onStage={() =>
                  onRawMutation({
                    sessionId: patch.sessionId,
                    action: "stage",
                    target: targetForPatch(patch),
                  })
                }
                onUnstage={() =>
                  onRawMutation({
                    sessionId: patch.sessionId,
                    action: "unstage",
                    target: targetForPatch(patch),
                  })
                }
                onUndo={() =>
                  onRawMutation({
                    sessionId: patch.sessionId,
                    action: "undo",
                    target: targetForPatch(patch),
                  })
                }
                onProgress={(progressState) => onProgress({ fileId: patch.fileId, progressState })}
              />
            </div>
            {patch.chunks.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No text hunks are available for this file.
              </div>
            ) : (
              patch.chunks.map((chunk) => (
                <section key={chunk.chunkId} className="border-b border-border">
                  <div className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2">
                    <div className="font-mono text-xs text-muted-foreground">{chunk.header}</div>
                    <ReviewChunkToolbar
                      patch={patch}
                      chunk={chunk}
                      disabled={mutationPending ?? false}
                      onStage={() =>
                        onRawMutation({
                          sessionId: patch.sessionId,
                          action: "stage",
                          target: targetForPatch(patch, chunk),
                        })
                      }
                      onUnstage={() =>
                        onRawMutation({
                          sessionId: patch.sessionId,
                          action: "unstage",
                          target: targetForPatch(patch, chunk),
                        })
                      }
                      onUndo={() =>
                        onRawMutation({
                          sessionId: patch.sessionId,
                          action: "undo",
                          target: targetForPatch(patch, chunk),
                        })
                      }
                      onProgress={(progressState) =>
                        onProgress({ chunkId: chunk.chunkId, progressState })
                      }
                    />
                  </div>
                  {viewMode === "split" ? (
                    <SplitChunkLines lines={chunk.lines} wrap={wrap} />
                  ) : (
                    <UnifiedChunkLines lines={chunk.lines} wrap={wrap} />
                  )}
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            Select a changed file to load its patch.
          </div>
        )}
      </div>
    </section>
  );
}
