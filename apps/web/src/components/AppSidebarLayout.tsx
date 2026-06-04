import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { RemoteHostSidebar } from "./remote-host/RemoteHostSidebar";
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from "./ui/sidebar";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { isGlobalTerminalOpenShortcut, isSidebarToggleShortcut } from "../keybindings";
import { useServerKeybindings } from "../rpc/serverState";
import {
  isTerminalFocused,
  resolveGlobalTerminalToggleHref,
  shouldStoreGlobalTerminalReturnHref,
} from "../modules/terminal";

const THREAD_SIDEBAR_COLLAPSED_KEY = "thread_sidebar_collapsed";
const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function AppSidebarKeyboardShortcuts() {
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const returnHrefRef = useRef<string | null>(null);
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const keybindings = useServerKeybindings();

  useEffect(() => {
    if (shouldStoreGlobalTerminalReturnHref(location.pathname)) {
      returnHrefRef.current = location.href;
    }
  }, [location.href, location.pathname]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || commandPaletteOpen) {
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: false,
      };

      if (isGlobalTerminalOpenShortcut(event, keybindings, { context: shortcutContext })) {
        event.preventDefault();
        event.stopPropagation();
        if (shouldStoreGlobalTerminalReturnHref(location.pathname)) {
          returnHrefRef.current = location.href;
        }
        void navigate({
          href: resolveGlobalTerminalToggleHref({
            pathname: location.pathname,
            returnHref: returnHrefRef.current,
          }),
        });
        return;
      }

      if (isSidebarToggleShortcut(event, keybindings, { context: shortcutContext })) {
        event.preventDefault();
        event.stopPropagation();
        toggleSidebar();
      }
    };

    // Capture before focused rich-text/contenteditable surfaces can consume the chord.
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [commandPaletteOpen, keybindings, location.href, location.pathname, navigate, toggleSidebar]);

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
        {pathname.startsWith("/remote-host") ? <RemoteHostSidebar /> : <ThreadSidebar />}
        <SidebarRail />
      </Sidebar>
      <main className="flex-1 overflow-hidden min-h-0 min-w-0">{children}</main>
    </SidebarProvider>
  );
}
