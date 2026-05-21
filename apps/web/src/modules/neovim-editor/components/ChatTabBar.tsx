import { memo } from "react";
import type { ReactNode } from "react";
import { FileEditIcon, MessageSquareIcon, SearchIcon, TerminalSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ChatTab } from "../stores/editorStore";

interface Props {
  /** Whether the editor tab is available (bridge + main window + nvim ready). */
  activeTab: ChatTab;
  editorAvailable: boolean;
  onTabSelect: (tab: ChatTab) => void;
  terminalOpen: boolean;
}

/**
 * Tab bar above the chat main area: Thread | Review | Terminal | Editor.
 * Terminal tab only appears while the current thread has an open terminal.
 * Editor tab remains gated by bridge / main-window / nvim availability.
 */
export const ChatTabBar = memo(function ChatTabBar({
  activeTab,
  editorAvailable,
  onTabSelect,
  terminalOpen,
}: Props) {
  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-end border-b border-border/60 bg-background px-1"
    >
      <TabButton
        tab="thread"
        active={activeTab === "thread"}
        onClick={() => onTabSelect("thread")}
        icon={<MessageSquareIcon className="size-3.5" />}
        label="Thread"
      />
      <TabButton
        tab="review"
        active={activeTab === "review"}
        onClick={() => onTabSelect("review")}
        icon={<SearchIcon className="size-3.5" />}
        label="Review"
      />
      {terminalOpen && (
        <TabButton
          tab="terminal"
          active={activeTab === "terminal"}
          onClick={() => onTabSelect("terminal")}
          icon={<TerminalSquareIcon className="size-3.5" />}
          label="Terminal"
        />
      )}
      {editorAvailable && (
        <TabButton
          tab="editor"
          active={activeTab === "editor"}
          onClick={() => onTabSelect("editor")}
          icon={<FileEditIcon className="size-3.5" />}
          label="Editor"
        />
      )}
    </div>
  );
});

interface TabButtonProps {
  tab: ChatTab;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}

function TabButton({ tab, active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tab={tab}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground/70 hover:text-foreground/80",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
