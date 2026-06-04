import type { SourceControlStackStreamEvent } from "@fenrir/contracts";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

interface StackConflictBannerProps {
  readonly conflict: Extract<SourceControlStackStreamEvent, { _tag: "operationConflict" }> | null;
  readonly onContinue: () => void;
  readonly onAbort: () => void;
  readonly disabled?: boolean;
}

export function StackConflictBanner({
  conflict,
  onContinue,
  onAbort,
  disabled,
}: StackConflictBannerProps) {
  if (!conflict) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <div className="truncate font-medium">Rebase conflict on {conflict.branchName}</div>
          <div className="truncate text-xs text-muted-foreground">{conflict.message}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="outline" disabled={disabled} onClick={onContinue}>
          Continue
        </Button>
        <Button size="xs" variant="ghost" disabled={disabled} onClick={onAbort}>
          Abort
        </Button>
      </div>
    </div>
  );
}
