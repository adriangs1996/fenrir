import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ActivityBar } from "./ActivityBar";
import ThreadSidebar from "./Sidebar";
import { HackSidebar } from "./hack/HackSidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useUiStateStore } from "../uiStateStore";

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
    <SidebarProvider defaultOpen>
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
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden group-data-[state=collapsed]:hidden">
            {activeWorkspace === "hack" ? <HackSidebar /> : <ThreadSidebar />}
          </div>
        </div>
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
