import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { FileEditIcon, GitCompareIcon, MessageSquareIcon, TerminalSquareIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { ChatTab } from "../stores/editorStore";

interface Props {
  activeTab: ChatTab;
  editorAvailable: boolean;
  gitDiffAvailable: boolean;
  onTabSelect: (tab: ChatTab) => void;
}

interface ChatViewOption {
  tab: ChatTab;
  label: string;
  Icon: LucideIcon;
}

const CHAT_VIEW_OPTIONS: ChatViewOption[] = [
  {
    tab: "thread",
    label: "Thread",
    Icon: MessageSquareIcon,
  },
  {
    tab: "gitdiff",
    label: "Git Diff",
    Icon: GitCompareIcon,
  },
  {
    tab: "editor",
    label: "Editor",
    Icon: FileEditIcon,
  },
  {
    tab: "terminal",
    label: "Terminal",
    Icon: TerminalSquareIcon,
  },
];

/**
 * Compact titlebar switch for the chat workspace. The selected view expands
 * to show its label, while inactive views stay icon-sized to avoid spending a
 * full horizontal row on Thread / Editor / Terminal navigation.
 */
export const ChatViewSwitcher = memo(function ChatViewSwitcher({
  activeTab,
  editorAvailable,
  gitDiffAvailable,
  onTabSelect,
}: Props) {
  const visibleOptions = CHAT_VIEW_OPTIONS.filter((option) => {
    if (option.tab === "editor") return editorAvailable;
    if (option.tab === "gitdiff") return gitDiffAvailable;
    return true;
  });
  const selectedTab = visibleOptions.some((option) => option.tab === activeTab)
    ? activeTab
    : "thread";
  const widthClass =
    visibleOptions.length >= 4
      ? "w-[180px]"
      : visibleOptions.length === 3
        ? "w-[148px]"
        : "w-[116px]";

  return (
    <div
      role="tablist"
      aria-label="Workspace view"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5",
        widthClass,
      )}
    >
      {visibleOptions.map((option) => (
        <SwitcherButton
          key={option.tab}
          option={option}
          active={selectedTab === option.tab}
          onClick={() => onTabSelect(option.tab)}
        />
      ))}
    </div>
  );
});

interface SwitcherButtonProps {
  option: ChatViewOption;
  active: boolean;
  onClick: () => void;
}

function SwitcherButton({ option, active, onClick }: SwitcherButtonProps) {
  const { Icon, label, tab } = option;

  return (
    <button
      type="button"
      role="tab"
      aria-label={label}
      aria-selected={active}
      data-tab={tab}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-transparent text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "min-w-0 flex-1 gap-1.5 bg-input/64 px-2 text-primary"
          : "w-7 px-0 text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground/85",
      )}
    >
      <Icon className="size-3.5" />
      <span className={active ? "min-w-0 truncate" : "sr-only"}>{label}</span>
    </button>
  );
}
