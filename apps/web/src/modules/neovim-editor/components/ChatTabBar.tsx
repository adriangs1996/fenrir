import { memo } from "react";
import type { ReactNode } from "react";
import { FileEditIcon, MessageSquareIcon, TerminalSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { type ChatTab, useEditorStore } from "../stores/editorStore";

interface Props {
  /** Whether the editor tab is available (bridge + main window + nvim ready). */
  editorAvailable: boolean;
  terminalOpen: boolean;
}

/**
 * Tab bar above the chat main area: Thread | Terminal | Editor.
 * Terminal tab only appears while the current thread has an open terminal.
 * Editor tab remains gated by bridge / main-window / nvim availability.
 */
export const ChatTabBar = memo(function ChatTabBar({ editorAvailable, terminalOpen }: Props) {
  const activeTab = useEditorStore((s) => s.activeChatTab);
  const setActiveTab = useEditorStore((s) => s.setActiveChatTab);

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-end border-b border-border/60 bg-background px-1"
    >
      <TabButton
        tab="thread"
        active={activeTab === "thread"}
        onClick={() => setActiveTab("thread")}
        icon={<MessageSquareIcon className="size-3.5" />}
        label="Thread"
      />
      {terminalOpen && (
        <TabButton
          tab="terminal"
          active={activeTab === "terminal"}
          onClick={() => setActiveTab("terminal")}
          icon={<TerminalSquareIcon className="size-3.5" />}
          label="Terminal"
        />
      )}
      {editorAvailable && (
        <TabButton
          tab="editor"
          active={activeTab === "editor"}
          onClick={() => setActiveTab("editor")}
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
          ? "border-blue-400 text-blue-400"
          : "border-transparent text-muted-foreground/70 hover:text-foreground/80",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
