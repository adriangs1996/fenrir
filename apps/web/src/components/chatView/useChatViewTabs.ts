import type { ScopedThreadRef } from "@fenrir/contracts";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import type { DraftId } from "../../composerDraftStore";
import type { ThreadRouteSearch } from "../../threadRouteSearch";
import { useEditorStore } from "~/modules/neovim-editor";

export type ChatViewTab = "thread" | "terminal" | "editor";
export type NonTerminalChatViewTab = Exclude<ChatViewTab, "terminal">;

interface UseChatViewTabsInput {
  desktopBridgeAvailable: boolean;
  draftId: DraftId | null;
  editorAvailable: boolean;
  rawSearch: ThreadRouteSearch;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
}

interface UseChatViewTabsResult {
  activeChatTab: ChatViewTab;
  handleChatTabSelect: (tab: ChatViewTab) => void;
  lastNonTerminalChatTabRef: MutableRefObject<NonTerminalChatViewTab>;
  setActiveChatTab: (tab: ChatViewTab) => void;
}

export function useChatViewTabs(input: UseChatViewTabsInput): UseChatViewTabsResult {
  const activeChatTab = useEditorStore((state) => state.activeChatTab);
  const setActiveChatTab = useEditorStore((state) => state.setActiveChatTab);

  const lastNonTerminalChatTabRef = useRef<NonTerminalChatViewTab>("thread");

  useEffect(() => {
    if (activeChatTab === "terminal") {
      return;
    }
    lastNonTerminalChatTabRef.current = activeChatTab;
  }, [activeChatTab]);

  const handleChatTabSelect = useCallback(
    (tab: ChatViewTab) => {
      setActiveChatTab(tab);
    },
    [setActiveChatTab],
  );

  useEffect(() => {
    if (!input.editorAvailable && activeChatTab === "editor") {
      setActiveChatTab("thread");
    }
  }, [activeChatTab, input.editorAvailable, setActiveChatTab]);

  useEffect(() => {
    if (!input.desktopBridgeAvailable) {
      return;
    }
    const editor = window.desktopBridge?.editor;
    if (!editor?.onCmd) {
      return;
    }
    return editor.onCmd((event) => {
      if (event.subcommand === "focus-chat") {
        setActiveChatTab("thread");
      }
    });
  }, [input.desktopBridgeAvailable, setActiveChatTab]);

  return {
    activeChatTab,
    handleChatTabSelect,
    lastNonTerminalChatTabRef,
    setActiveChatTab,
  };
}
