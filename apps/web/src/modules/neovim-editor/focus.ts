import type { ChatTab } from "./stores/editorStore";

export type TerminalCloseFocusTarget = "composer" | "editor";

export function resolveTerminalCloseFocusTarget(options: {
  activeChatTab: ChatTab;
  editorAvailable: boolean;
}): TerminalCloseFocusTarget {
  const { activeChatTab, editorAvailable } = options;
  return editorAvailable && activeChatTab === "editor" ? "editor" : "composer";
}
