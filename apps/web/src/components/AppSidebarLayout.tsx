import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ActivityBar } from "./ActivityBar";
import ThreadSidebar from "./Sidebar";
import { HackSidebar } from "./hack/HackSidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useUiStateStore } from "../uiStateStore";

const THREAD_SIDEBAR_COLLAPSED_KEY = "thread_sidebar_collapsed";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const ACTIVITY_BAR_WIDTH = 3 * 16; // w-12 = 48px
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const activeWorkspace = useUiStateStore((state) => state.activeWorkspace);
  const setActiveWorkspace = useUiStateStore(
    (state) => state.setActiveWorkspace,
  );
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

  const toggleThreadSidebar = useCallback(() => {
    setThreadSidebarOpenRaw((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(THREAD_SIDEBAR_COLLAPSED_KEY, next ? "false" : "true");
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider className="!h-svh" defaultOpen={threadSidebarOpen} open={threadSidebarOpen} onOpenChange={setThreadSidebarOpen}>
      <Sidebar
        side="left"
        collapsible="icon"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: ACTIVITY_BAR_WIDTH + THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <div className="flex h-full">
          <ActivityBar
            activeWorkspace={activeWorkspace}
            onWorkspaceChange={setActiveWorkspace}
            sidebarOpen={threadSidebarOpen}
            onToggleSidebar={toggleThreadSidebar}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-200 group-data-[state=collapsed]:hidden">
            {activeWorkspace === "hack" ? <HackSidebar /> : <ThreadSidebar />}
          </div>
        </div>
        <SidebarRail />
      </Sidebar>
      <main className="flex-1 overflow-hidden min-h-0 min-w-0">
        {children}
      </main>
    </SidebarProvider>
  );
}
