import { useMemo } from "react";
import type { ServerProviderSkill } from "@fenrir/contracts";
import { cn } from "~/lib/utils";

interface SkillTagFilterProps {
  skills: readonly ServerProviderSkill[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

export function SkillTagFilter({ skills, activeTag, onTagChange }: SkillTagFilterProps) {
  const tags = useMemo(() => {
    const seen = new Set<string>();
    for (const skill of skills) {
      for (const tag of skill.tags) {
        seen.add(tag);
      }
    }
    return Array.from(seen).toSorted();
  }, [skills]);

  if (tags.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TagChip label="All" active={activeTag === null} onClick={() => onTagChange(null)} />
      {tags.map((tag) => (
        <TagChip
          key={tag}
          label={tag}
          active={activeTag === tag}
          onClick={() => onTagChange(activeTag === tag ? null : tag)}
        />
      ))}
    </div>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-blue-400/60 bg-blue-500/10 text-blue-400"
          : "border-border/50 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
