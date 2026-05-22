import type { ScopedThreadRef } from "@fenrir/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";

import type { DraftId } from "../../composerDraftStore";
import {
  createSearchStateKey,
  deriveActiveReviewRouteState,
  shouldForceActiveReviewTab,
} from "../ChatView.logic";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../threadRoutes";
import type { ThreadRouteSearch } from "../../threadRouteSearch";
import { useEditorStore } from "~/modules/neovim-editor";
import {
  buildReviewRouteSearch,
  stripReviewSearchParams,
  type ReviewRouteState,
  resolveReviewRouteState,
} from "~/modules/review";

export type ChatViewTab = "thread" | "review" | "terminal" | "editor";
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
  activeReviewRouteState: ReviewRouteState | null;
  handleChatTabSelect: (tab: ChatViewTab) => void;
  lastNonTerminalChatTabRef: MutableRefObject<NonTerminalChatViewTab>;
  setActiveChatTab: (tab: ChatViewTab) => void;
  updateReviewRouteState: (nextState: ReviewRouteState) => void;
}

export function useChatViewTabs(input: UseChatViewTabsInput): UseChatViewTabsResult {
  const navigate = useNavigate();
  const activeChatTab = useEditorStore((state) => state.activeChatTab);
  const setActiveChatTab = useEditorStore((state) => state.setActiveChatTab);

  const lastNonTerminalChatTabRef = useRef<NonTerminalChatViewTab>("thread");
  const pendingReviewRouteExitRef = useRef(false);
  const pendingRouteSearchStateKeyRef = useRef<string | null>(null);

  const reviewRouteState = useMemo(
    () => resolveReviewRouteState(input.rawSearch),
    [input.rawSearch],
  );
  const rawSearchStateKey = useMemo(() => createSearchStateKey(input.rawSearch), [input.rawSearch]);
  const activeReviewRouteState = useMemo(
    () => deriveActiveReviewRouteState({ activeChatTab, reviewRouteState }),
    [activeChatTab, reviewRouteState],
  );

  useEffect(() => {
    if (pendingRouteSearchStateKeyRef.current === rawSearchStateKey) {
      pendingRouteSearchStateKeyRef.current = null;
    }
  }, [rawSearchStateKey]);

  const replaceCurrentRouteSearch = useCallback(
    (search: Record<string, unknown>) => {
      const nextSearchStateKey = createSearchStateKey(search);
      if (
        nextSearchStateKey === rawSearchStateKey ||
        pendingRouteSearchStateKeyRef.current === nextSearchStateKey
      ) {
        return;
      }

      pendingRouteSearchStateKeyRef.current = nextSearchStateKey;

      if (input.routeKind === "server") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(input.routeThreadRef),
          search,
          replace: true,
        }).catch(() => {
          if (pendingRouteSearchStateKeyRef.current === nextSearchStateKey) {
            pendingRouteSearchStateKeyRef.current = null;
          }
        });
        return;
      }

      if (!input.draftId) {
        pendingRouteSearchStateKeyRef.current = null;
        return;
      }

      void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(input.draftId),
        search,
        replace: true,
      }).catch(() => {
        if (pendingRouteSearchStateKeyRef.current === nextSearchStateKey) {
          pendingRouteSearchStateKeyRef.current = null;
        }
      });
    },
    [input.draftId, input.routeKind, input.routeThreadRef, navigate, rawSearchStateKey],
  );

  const updateReviewRouteState = useCallback(
    (nextState: ReviewRouteState) => {
      pendingReviewRouteExitRef.current = false;
      setActiveChatTab("review");
      replaceCurrentRouteSearch({
        ...stripReviewSearchParams(input.rawSearch),
        ...buildReviewRouteSearch(nextState),
      });
    },
    [input.rawSearch, replaceCurrentRouteSearch, setActiveChatTab],
  );

  const handleChatTabSelect = useCallback(
    (tab: ChatViewTab) => {
      pendingReviewRouteExitRef.current = tab !== "review" && reviewRouteState !== null;
      setActiveChatTab(tab);
    },
    [reviewRouteState, setActiveChatTab],
  );

  useEffect(() => {
    if (activeChatTab === "terminal") {
      return;
    }
    lastNonTerminalChatTabRef.current = activeChatTab;
  }, [activeChatTab]);

  useEffect(() => {
    if (!input.editorAvailable && activeChatTab === "editor") {
      setActiveChatTab("thread");
    }
  }, [activeChatTab, input.editorAvailable, setActiveChatTab]);

  useLayoutEffect(() => {
    if (
      shouldForceActiveReviewTab({
        activeChatTab,
        hasReviewRouteState: reviewRouteState !== null,
        pendingReviewRouteExit: pendingReviewRouteExitRef.current,
      })
    ) {
      setActiveChatTab("review");
    }
  }, [activeChatTab, reviewRouteState, setActiveChatTab]);

  useEffect(() => {
    if (activeChatTab === "review") {
      if (!activeReviewRouteState) {
        return;
      }

      replaceCurrentRouteSearch({
        ...stripReviewSearchParams(input.rawSearch),
        ...buildReviewRouteSearch(activeReviewRouteState),
      });
      return;
    }

    if (!reviewRouteState) {
      return;
    }

    if (
      shouldForceActiveReviewTab({
        activeChatTab,
        hasReviewRouteState: true,
        pendingReviewRouteExit: pendingReviewRouteExitRef.current,
      })
    ) {
      return;
    }

    replaceCurrentRouteSearch(stripReviewSearchParams(input.rawSearch));
  }, [
    activeChatTab,
    activeReviewRouteState,
    input.rawSearch,
    replaceCurrentRouteSearch,
    reviewRouteState,
  ]);

  useEffect(() => {
    if (reviewRouteState === null) {
      pendingReviewRouteExitRef.current = false;
    }
  }, [reviewRouteState]);

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
    activeReviewRouteState,
    handleChatTabSelect,
    lastNonTerminalChatTabRef,
    setActiveChatTab,
    updateReviewRouteState,
  };
}
