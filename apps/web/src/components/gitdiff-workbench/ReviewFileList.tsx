import type { ReviewDiffFileEntry, ReviewDiffLane } from "@fenrir/contracts";
import { FileIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { changeKindLabel } from "./stackUiState";

interface ReviewFileListProps {
  readonly lane: ReviewDiffLane | null;
  readonly selectedPath: string | null;
  readonly onSelectFile: (file: ReviewDiffFileEntry) => void;
}

export function ReviewFileList({ lane, selectedPath, onSelectFile }: ReviewFileListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {lane && lane.files.length > 0 ? (
        <div className="space-y-1">
          {lane.files.map((file) => (
            <button
              key={`${file.lane}:${file.normalizedPath}`}
              type="button"
              className={cn(
                "grid w-full grid-cols-[1fr_auto] gap-2 rounded-md px-2 py-2 text-left text-sm",
                selectedPath === file.normalizedPath ? "bg-primary/10" : "hover:bg-accent/70",
              )}
              onClick={() => onSelectFile(file)}
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.displayPath}</span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {changeKindLabel(file.changeKind)}
                </span>
              </span>
              <span className="text-right text-xs tabular-nums">
                <span className="text-emerald-600">+{file.insertions}</span>
                <span className="ml-1 text-red-500">-{file.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2 py-8 text-sm text-muted-foreground">No files in this lane.</div>
      )}
    </div>
  );
}
