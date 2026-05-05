import { ArrowLeftIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react";
import { useCallback } from "react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useFilteredSkills } from "~/hooks/useSkills";
import { useRightPanelStore } from "~/rightPanelStore";
import { SkillListItem } from "./SkillListItem";
import { SkillSearchBar } from "./SkillSearchBar";
import { SkillTagFilter } from "./SkillTagFilter";
import { useSkillPanelStore } from "./stores/skillPanelStore";

interface SkillsPanelProps {
  onInsert: (skillName: string) => void;
}

export function SkillsPanel({ onInsert }: SkillsPanelProps) {
  const { view } = useSkillPanelStore();

  switch (view.kind) {
    case "list":
      return <SkillsListView onInsert={onInsert} />;
    case "inspect":
      return <SkillDetailPlaceholder title={`/${view.skillName}`} />;
    case "create":
      return <SkillDetailPlaceholder title="New Skill" />;
    case "edit":
      return <SkillDetailPlaceholder title={`Edit /${view.skillName}`} />;
  }
}

// ─── List view ───────────────────────────────────────────────────────────────

function SkillsListView({ onInsert }: { onInsert: (skillName: string) => void }) {
  const { searchQuery, activeTagFilter, setSearchQuery, setActiveTagFilter, setView } =
    useSkillPanelStore();
  const { close } = useRightPanelStore();

  const skills = useFilteredSkills(searchQuery, activeTagFilter ?? undefined);
  const allSkills = useFilteredSkills("", undefined);

  const handleInsert = useCallback(
    (skillName: string) => {
      onInsert(skillName);
      close();
    },
    [onInsert, close],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground">Skills</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setView({ kind: "create" })}
            className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
            aria-label="Create skill"
          >
            <PlusIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={close}
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            aria-label="Close panel"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Search + tag filters */}
      <div className="shrink-0 space-y-2 px-3 py-2">
        <SkillSearchBar value={searchQuery} onChange={setSearchQuery} />
        <SkillTagFilter
          skills={allSkills}
          activeTag={activeTagFilter}
          onTagChange={setActiveTagFilter}
        />
      </div>

      {/* Skill list or empty state */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {skills.length === 0 ? (
          <SkillsEmptyState
            hasQuery={searchQuery.length > 0 || activeTagFilter !== null}
            onCreate={() => setView({ kind: "create" })}
          />
        ) : (
          <ScrollArea className="h-full">
            <div className="divide-y divide-border/40">
              {skills.map((skill) => (
                <SkillListItem key={skill.name} skill={skill} onInsert={handleInsert} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function SkillsEmptyState({ hasQuery, onCreate }: { hasQuery: boolean; onCreate: () => void }) {
  if (hasQuery) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ZapIcon className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">No skills match your search.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ZapIcon className="size-7 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/60">No skills yet.</p>
        <Button variant="outline" size="sm" type="button" onClick={onCreate} className="gap-1.5">
          <PlusIcon className="size-3.5" />
          Create a skill
        </Button>
      </div>
    </div>
  );
}

// ─── Placeholder for future detail views ─────────────────────────────────────

function SkillDetailPlaceholder({ title }: { title: string }) {
  const { goBack } = useSkillPanelStore();
  const { close } = useRightPanelStore();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goBack}
          className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={close}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground/60">Coming soon.</p>
      </div>
    </div>
  );
}
