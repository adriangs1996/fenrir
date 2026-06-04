import type { SourceControlStackEntry, SourceControlStackSnapshot } from "@fenrir/contracts";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface StackSidebarProps {
  readonly snapshot: SourceControlStackSnapshot | null;
  readonly selectedEntryId: string | null;
  readonly onSelectEntry: (entry: SourceControlStackEntry) => void;
  readonly onSwitchEntry: (entry: SourceControlStackEntry) => void;
}

function publicationLabel(entry: SourceControlStackEntry): string {
  switch (entry.publication) {
    case "published":
      return entry.changeRequest ? `PR #${entry.changeRequest.number}` : "Published";
    case "draft-local":
      return "Draft";
    case "orphaned-provider":
      return "Provider only";
    case "stale-local":
      return "Reconcile";
  }
}

export function StackSidebar({
  snapshot,
  selectedEntryId,
  onSelectEntry,
  onSwitchEntry,
}: StackSidebarProps) {
  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GitBranchIcon className="size-4" />
          Stack
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {snapshot?.rootBaseRef ?? "Resolving repository"}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {snapshot?.entries.length ? (
          <div className="space-y-1">
            {snapshot.entries.map((entry) => (
              <button
                key={entry.id}
                className={cn(
                  "grid w-full grid-cols-[1fr_auto] gap-2 rounded-md border px-2 py-2 text-left text-sm",
                  selectedEntryId === entry.id
                    ? "border-primary/50 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-accent/60",
                )}
                type="button"
                onClick={() => onSelectEntry(entry)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{entry.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {entry.headRefName}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {entry.changeRequest ? (
                      <GitPullRequestIcon className="size-3" />
                    ) : (
                      <GitBranchIcon className="size-3" />
                    )}
                    {publicationLabel(entry)}
                  </span>
                  {entry.isCurrent ? (
                    <CheckCircle2Icon className="size-3.5 text-primary" />
                  ) : entry.problems.length > 0 ? (
                    <AlertTriangleIcon className="size-3.5 text-amber-500" />
                  ) : null}
                </span>
                <span className="col-span-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    +{entry.aheadCount} / -{entry.behindCount}
                  </span>
                  {!entry.isCurrent ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSwitchEntry(entry);
                      }}
                    >
                      Switch
                    </Button>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-sm text-muted-foreground">
            No stack entries were discovered for this thread.
          </div>
        )}
      </div>
    </aside>
  );
}
