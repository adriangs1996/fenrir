import type { ReviewLocalAnnotationThread, ReviewSessionSnapshot } from "@fenrir/contracts";
import { MessageSquareIcon } from "lucide-react";

interface ReviewAnnotationPanelProps {
  readonly snapshot: ReviewSessionSnapshot | null;
  readonly selectedPath: string | null;
}

function isThreadForPath(thread: ReviewLocalAnnotationThread, selectedPath: string | null) {
  return selectedPath !== null && thread.anchor.normalizedPath === selectedPath;
}

export function ReviewAnnotationPanel({ snapshot, selectedPath }: ReviewAnnotationPanelProps) {
  const threads =
    snapshot?.localThreads.filter((thread) => isThreadForPath(thread, selectedPath)) ?? [];
  return (
    <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-l border-border bg-background xl:flex">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareIcon className="size-4" />
          Local Notes
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {threads.length > 0 ? (
          <div className="space-y-2">
            {threads.map((thread) => (
              <article key={thread.id} className="rounded-md border border-border p-2 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{thread.author.subject}</span>
                  <span>{thread.progressState}</span>
                </div>
                <p className="whitespace-pre-wrap">{thread.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-sm text-muted-foreground">
            No local notes for the selected file.
          </div>
        )}
      </div>
    </aside>
  );
}
