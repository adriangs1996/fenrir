import { memo } from "react";
import type { ServerProviderSkill } from "@fenrir/contracts";
import { cn } from "~/lib/utils";
import { getSkillIcon } from "./skillIcons";
import { SkillSyncBadge } from "./SkillSyncBadge";

interface SkillListItemProps {
  skill: ServerProviderSkill;
  onInsert: (skillName: string) => void;
}

export const SkillListItem = memo(function SkillListItem({ skill, onInsert }: SkillListItemProps) {
  const Icon = getSkillIcon(skill.icon);

  return (
    <button
      type="button"
      className={cn(
        "group w-full cursor-pointer px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        !skill.enabled && "opacity-50",
      )}
      onClick={() => onInsert(skill.name)}
      title={`Insert /${skill.name}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-medium leading-5 text-foreground">
              {skill.displayName}
            </span>
            {!skill.enabled && (
              <span className="shrink-0 text-xs text-muted-foreground/50">disabled</span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
          {skill.syncStatus.length > 0 && (
            <div className="mt-1.5">
              <SkillSyncBadge syncStatus={skill.syncStatus} />
            </div>
          )}
        </div>
      </div>
    </button>
  );
});
