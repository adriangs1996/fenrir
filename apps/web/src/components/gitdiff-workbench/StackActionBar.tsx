import type { SourceControlStackCapability, SourceControlStackSnapshot } from "@fenrir/contracts";
import {
  GitPullRequestCreateIcon,
  GitPullRequestIcon,
  PlusIcon,
  RefreshCwIcon,
  Rows3Icon,
} from "lucide-react";

import { Button } from "~/components/ui/button";

interface StackActionBarProps {
  readonly snapshot: SourceControlStackSnapshot | null;
  readonly disabled?: boolean;
  readonly onCreateEntry: () => void;
  readonly onRestack: () => void;
  readonly onSync: () => void;
  readonly onPublish: () => void;
}

function hasCapability(
  snapshot: SourceControlStackSnapshot | null,
  capability: SourceControlStackCapability,
): boolean {
  return snapshot?.capabilities.includes(capability) ?? false;
}

export function StackActionBar({
  snapshot,
  disabled,
  onCreateEntry,
  onRestack,
  onSync,
  onPublish,
}: StackActionBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
      <Button
        size="xs"
        variant="outline"
        disabled={disabled || !hasCapability(snapshot, "create-entry")}
        onClick={onCreateEntry}
      >
        <PlusIcon />
        Entry
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled || !hasCapability(snapshot, "sync")}
        onClick={onSync}
      >
        <RefreshCwIcon />
        Sync
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled || !hasCapability(snapshot, "restack")}
        onClick={onRestack}
      >
        <Rows3Icon />
        Restack
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled || !hasCapability(snapshot, "publish")}
        onClick={onPublish}
      >
        {snapshot?.entries.some((entry) => entry.changeRequest === null) ? (
          <GitPullRequestCreateIcon />
        ) : (
          <GitPullRequestIcon />
        )}
        Publish
      </Button>
    </div>
  );
}
