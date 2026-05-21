import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  isTerminalFocused,
  selectThreadTerminalState,
  useTerminalStateStore,
} from "~/modules/terminal";
import { usePlanRunnerLifecycle } from "~/modules/plan-runner";
import { useEditorStore } from "~/modules/neovim-editor";
import { readReviewCommandRegistration } from "~/modules/review/commandStore";
import { resolveShortcutCommand } from "../keybindings";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useCommandPaletteStore } from "~/commandPaletteStore";
import { useSettings } from "~/hooks/useSettings";
import { startNewLocalThreadFromContext, startNewThreadFromContext } from "~/lib/chatThreadActions";
import { useServerKeybindings } from "~/rpc/serverState";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const appSettings = useSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (commandPaletteOpen) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          reviewFocus: useEditorStore.getState().activeChatTab === "review",
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultProjectRef,
          defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultProjectRef,
          defaultThreadEnvMode: appSettings.defaultThreadEnvMode,
          handleNewThread,
        });
        return;
      }

      if (command === "editor.sendSelection") {
        const activeTab = useEditorStore.getState().activeChatTab;
        if (activeTab !== "editor") return;
        event.preventDefault();
        event.stopPropagation();
        void window.desktopBridge?.editor.invokeBridge("send_selection");
        return;
      }

      if (String(command).startsWith("review.")) {
        const registration = readReviewCommandRegistration();
        if (!registration || !registration.availableCommands.has(command as never)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void registration.runCommand(command as never);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    commandPaletteOpen,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    routeThreadRef,
    selectedThreadKeysSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  usePlanRunnerLifecycle();

  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    if (authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
