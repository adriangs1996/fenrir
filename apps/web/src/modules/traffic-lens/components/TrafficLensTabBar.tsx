import { X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useSidebar } from "../../../components/ui/sidebar";
import { isElectron } from "../../../env";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "../../../lib/desktopTitleBar";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import { cn } from "../../../lib/utils";

export function TrafficLensTabBar() {
  const tabs = useTrafficLensStore((s) => s.tabs);
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const setActiveTab = useTrafficLensStore((s) => s.setActiveTab);
  const { isMobile, open: sidebarOpen } = useSidebar();
  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });

  const tabList = Object.values(tabs);
  if (tabList.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto border-b bg-muted/30 px-1",
        reserveLeadingTitlebarInset && DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
      )}
    >
      {tabList.map((tab) => (
        <div
          key={tab.tabId}
          className={cn(
            "group flex max-w-48 cursor-pointer items-center gap-1 rounded-t px-2 py-1 text-xs",
            tab.tabId === activeTabId
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:bg-background/50",
          )}
          onClick={() => {
            setActiveTab(tab.tabId);
            void window.desktopBridge?.trafficLensShowTab(tab.tabId);
          }}
        >
          <span className="truncate">{tab.title || tab.url || "New Tab"}</span>
          {tab.loading && <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-4 w-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void window.desktopBridge?.trafficLensCloseTab(tab.tabId);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
