import type { ReviewDiffChunk, ReviewDiffFilePatch, ReviewProgressState } from "@fenrir/contracts";
import { CheckIcon, RotateCcwIcon, Undo2Icon } from "lucide-react";

import { Button } from "~/components/ui/button";

interface ReviewChunkToolbarProps {
  readonly patch: ReviewDiffFilePatch;
  readonly chunk?: ReviewDiffChunk;
  readonly disabled?: boolean;
  readonly onStage?: () => void;
  readonly onUnstage?: () => void;
  readonly onUndo?: () => void;
  readonly onProgress: (progressState: ReviewProgressState) => void;
}

export function ReviewChunkToolbar({
  patch,
  chunk,
  disabled,
  onStage,
  onUnstage,
  onUndo,
  onProgress,
}: ReviewChunkToolbarProps) {
  const noun = chunk ? "Chunk" : "File";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {patch.lane === "unstaged" ? (
        <Button size="xs" variant="outline" disabled={disabled || !onStage} onClick={onStage}>
          <CheckIcon />
          Stage {noun}
        </Button>
      ) : null}
      {patch.lane === "staged" ? (
        <Button size="xs" variant="outline" disabled={disabled || !onUnstage} onClick={onUnstage}>
          <RotateCcwIcon />
          Unstage {noun}
        </Button>
      ) : null}
      {patch.lane !== "ignored" ? (
        <Button size="xs" variant="ghost" disabled={disabled || !onUndo} onClick={onUndo}>
          <Undo2Icon />
          Undo {noun}
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onProgress("reviewed")}>
        Reviewed
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => onProgress("needs-follow-up")}
      >
        Follow up
      </Button>
    </div>
  );
}
