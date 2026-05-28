import { useRef } from "react";
import { useTrafficLensBounds } from "../hooks/useTrafficLensBounds";
import { getTrafficLensMobilePreset } from "../mobilePresets";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

function ViewportStage(props: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      <div className="flex h-full min-h-0 w-full flex-col items-center gap-3 px-4 py-4 sm:px-8 sm:py-8">
        {props.children}
      </div>
    </div>
  );
}

export function TrafficLensViewContainer() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  const viewportRef = useRef<HTMLDivElement>(null);
  const boundsLayoutKey = activeTab
    ? `${activeTab.tabId}:${activeTab.viewMode}:${activeTab.mobilePreset}`
    : "empty";

  useTrafficLensBounds(viewportRef, boundsLayoutKey);

  if (!activeTabId || !activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No tab selected. Open a new tab from the sidebar.
      </div>
    );
  }

  const mobileMode = (activeTab.viewMode ?? "desktop") === "mobile";

  if (!mobileMode) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0)_18%)]">
        <div
          ref={viewportRef}
          className="h-full min-h-0 w-full flex-1"
          data-browser-lab-viewport="desktop"
        />
      </div>
    );
  }

  const mobilePreset = getTrafficLensMobilePreset(activeTab.mobilePreset);

  return (
    <ViewportStage>
      <div className="shrink-0 rounded-full border border-border/70 bg-background/65 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase backdrop-blur-sm">
        {mobilePreset.label}
        <span className="mx-2 text-border">•</span>
        {mobilePreset.screenWidth} × {mobilePreset.screenHeight}
      </div>
      <div
        className="flex min-h-0 max-w-full flex-1 overflow-hidden rounded-[28px] border border-border/80 bg-muted/30 p-2 shadow-[0_18px_54px_rgba(0,0,0,0.28)]"
        style={{
          maxHeight: mobilePreset.screenHeight + 18,
        }}
      >
        <div
          ref={viewportRef}
          className="h-full min-h-0 w-full overflow-hidden rounded-[20px] bg-background"
          data-browser-lab-viewport="mobile"
          style={{ width: mobilePreset.screenWidth }}
        />
      </div>
    </ViewportStage>
  );
}
