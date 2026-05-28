import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { HackSidebar } from "./hack/HackSidebar";
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from "./ui/sidebar";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { isSidebarToggleShortcut } from "../keybindings";
import { useServerKeybindings } from "../rpc/serverState";
import { isTerminalFocused } from "../modules/terminal";

const THREAD_SIDEBAR_COLLAPSED_KEY = "thread_sidebar_collapsed";
const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function AppSidebarKeyboardShortcuts() {
  const { toggleSidebar } = useSidebar();
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const keybindings = useServerKeybindings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || commandPaletteOpen) {
        return;
      }
      if (
        !isSidebarToggleShortcut(event, keybindings, {
          context: {
            terminalFocus: isTerminalFocused(),
            terminalOpen: false,
            reviewFocus: false,
          },
        })
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused rich-text/contenteditable surfaces can consume the chord.
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [commandPaletteOpen, keybindings, toggleSidebar]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [threadSidebarOpen, setThreadSidebarOpenRaw] = useState(() => {
    try {
      return localStorage.getItem(THREAD_SIDEBAR_COLLAPSED_KEY) !== "true";
    } catch {
      return true;
    }
  });

  const setThreadSidebarOpen = useCallback((open: boolean) => {
    setThreadSidebarOpenRaw(open);
    try {
      localStorage.setItem(THREAD_SIDEBAR_COLLAPSED_KEY, open ? "false" : "true");
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
        return;
      }

      if (action === "toggle-sidebar") {
        setThreadSidebarOpenRaw((open) => {
          const nextOpen = !open;
          try {
            localStorage.setItem(THREAD_SIDEBAR_COLLAPSED_KEY, nextOpen ? "false" : "true");
          } catch {
            // Ignore storage errors
          }
          return nextOpen;
        });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      className="!h-svh"
      defaultOpen={threadSidebarOpen}
      open={threadSidebarOpen}
      onOpenChange={setThreadSidebarOpen}
    >
      <AppSidebarKeyboardShortcuts />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {pathname.startsWith("/hack") ? <HackSidebar /> : <ThreadSidebar />}
        <SidebarRail />
      </Sidebar>
      <main className="flex-1 overflow-hidden min-h-0 min-w-0">{children}</main>
    </SidebarProvider>
  );
}
