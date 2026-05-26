import { useRef } from "react";
import { useTrafficLensBounds } from "../hooks/useTrafficLensBounds";
import { getTrafficLensMobilePreset } from "../mobilePresets";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

function ViewportStage(props: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-auto bg-background">
      <div className="flex min-h-full w-full items-start justify-center px-8 py-10">
        {props.children}
      </div>
    </div>
  );
}

export function TrafficLensViewContainer() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) =>
    s.activeTabId ? s.tabs[s.activeTabId] : null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);

  useTrafficLensBounds(viewportRef);

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
        <div ref={viewportRef} className="h-full min-h-0 w-full flex-1" />
      </div>
    );
  }

  const mobilePreset = getTrafficLensMobilePreset(activeTab.mobilePreset);

  return (
    <ViewportStage>
      <div className="flex max-w-full flex-none flex-col items-center gap-3">
        <div className="rounded-full border border-border/70 bg-background/65 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase backdrop-blur-sm">
          {mobilePreset.label}
          <span className="mx-2 text-border">•</span>
          {mobilePreset.screenWidth} × {mobilePreset.screenHeight}
        </div>
      </div>
    </ViewportStage>
  );
}
