import { CheckIcon, ClockIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import type { SkillProviderSync } from "@fenrir/contracts";
import { cn } from "~/lib/utils";

interface SkillSyncBadgeProps {
  syncStatus: readonly SkillProviderSync[];
}

export function providerLabel(provider: SkillProviderSync["provider"]): string {
  switch (provider) {
    case "claudeAgent":
      return "Claude";
    case "codex":
      return "Codex";
  }
}

export function SkillSyncBadge({ syncStatus }: SkillSyncBadgeProps) {
  if (syncStatus.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2.5">
      {syncStatus.map((sync) => (
        <SyncProviderBadge key={sync.provider} sync={sync} />
      ))}
    </div>
  );
}

function SyncProviderBadge({ sync }: { sync: SkillProviderSync }) {
  const { state, provider } = sync;

  const Icon =
    state === "synced"
      ? CheckIcon
      : state === "pending"
        ? ClockIcon
        : state === "conflict"
          ? TriangleAlertIcon
          : MinusIcon;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        state === "synced" && "text-emerald-500",
        state === "pending" && "text-amber-500",
        state === "conflict" && "text-destructive",
        state === "unsupported" && "text-muted-foreground/50",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span>{providerLabel(provider)}</span>
    </span>
  );
}
