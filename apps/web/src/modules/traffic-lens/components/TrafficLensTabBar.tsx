import { PlusIcon, X } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { useSidebar } from "../../../components/ui/sidebar";
import { isElectron } from "../../../env";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "../../../lib/desktopTitleBar";
import { cn } from "../../../lib/utils";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function TrafficLensTabBar(props: { onCreateTab?: () => void }) {
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
  if (tabList.length === 0 && !props.onCreateTab) return null;

  return (
    <div
      className={cn(
        "flex items-center border-b bg-background/95 px-1.5 py-1 backdrop-blur-sm",
        reserveLeadingTitlebarInset && DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabList.map((tab) => (
          <div
            key={tab.tabId}
            className={cn(
              "group flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs",
              tab.tabId === activeTabId
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-card/70 hover:text-foreground",
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
              className="ml-auto h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void window.desktopBridge?.trafficLensCloseTab(tab.tabId);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {props.onCreateTab ? (
          <button
            type="button"
            aria-label="New tab"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-card/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            onClick={props.onCreateTab}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
