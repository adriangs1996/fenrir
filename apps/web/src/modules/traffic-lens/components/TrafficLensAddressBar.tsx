import type { TrafficLensMobilePreset } from "@fenrir/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ExternalLinkIcon, RotateCw, X as StopIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { normalizeBrowserAddressInput } from "../browserNavigation";
import { TRAFFIC_LENS_MOBILE_PRESET_OPTIONS } from "../mobilePresets";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function TrafficLensAddressBar(props: {
  className?: string;
  leadingContent?: ReactNode;
  onOpenExternal?: () => void;
}) {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  const [urlInput, setUrlInput] = useState("");
  const activeUrl = activeTab?.url;
  const activeViewMode = activeTab?.viewMode ?? "desktop";
  const activeMobilePreset = activeTab?.mobilePreset ?? "iphone-15-pro";

  useEffect(() => {
    if (activeUrl !== undefined) {
      setUrlInput(activeUrl);
    }
  }, [activeUrl]);

  const containerClassName = cn(
    "flex items-center gap-1 border-b bg-background/90 px-2 py-1.5 backdrop-blur-sm",
    props.className,
  );

  if (!activeTabId || !activeTab) {
    return props.leadingContent ? (
      <div className={containerClassName}>
        {props.leadingContent}
        <div className="min-w-0 flex-1" />
      </div>
    ) : null;
  }

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeBrowserAddressInput(urlInput);
    if (!url) return;
    void window.desktopBridge?.trafficLensNavigate(activeTabId, url);
  };

  const handleSetViewMode = (viewMode: "desktop" | "mobile") => {
    if (viewMode === activeViewMode) {
      return;
    }
    const request = window.desktopBridge?.trafficLensSetTabViewMode({
      tabId: activeTabId as any,
      viewMode,
    });
    void request?.then((snapshot) => {
      if (snapshot) {
        useTrafficLensStore.getState().upsertTab(snapshot);
      }
    });
  };

  const handleSetMobilePreset = (mobilePreset: TrafficLensMobilePreset) => {
    if (mobilePreset === activeMobilePreset) {
      return;
    }
    const request = window.desktopBridge?.trafficLensSetTabMobilePreset({
      tabId: activeTabId as any,
      mobilePreset,
    });
    void request?.then((snapshot) => {
      if (snapshot) {
        useTrafficLensStore.getState().upsertTab(snapshot);
      }
    });
  };

  return (
    <div className={containerClassName}>
      {props.leadingContent}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!activeTab.canGoBack}
        onClick={() => void window.desktopBridge?.trafficLensGoBack(activeTabId)}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!activeTab.canGoForward}
        onClick={() => void window.desktopBridge?.trafficLensGoForward(activeTabId)}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => void window.desktopBridge?.trafficLensReload(activeTabId)}
      >
        {activeTab.loading ? <StopIcon className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
      </Button>
      <form onSubmit={handleNavigate} className="flex-1">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Enter URL..."
          className="h-8 text-sm"
        />
      </form>
      <div className="flex items-center rounded-full border border-border/70 bg-muted/[0.18] p-0.5">
        {(["desktop", "mobile"] as const).map((viewMode) => {
          const active = activeViewMode === viewMode;
          return (
            <button
              key={viewMode}
              type="button"
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleSetViewMode(viewMode)}
            >
              {viewMode === "desktop" ? "Desktop" : "Mobile"}
            </button>
          );
        })}
      </div>
      {activeViewMode === "mobile" ? (
        <Select
          value={activeMobilePreset}
          onValueChange={(value) => handleSetMobilePreset(value as TrafficLensMobilePreset)}
          items={TRAFFIC_LENS_MOBILE_PRESET_OPTIONS}
        >
          <SelectTrigger
            variant="ghost"
            size="xs"
            className="h-8 rounded-full border border-border/70 bg-muted/[0.18] px-3 text-[11px] font-medium"
            aria-label="Mobile device preset"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {TRAFFIC_LENS_MOBILE_PRESET_OPTIONS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {activeTab.profileName ? (
        <div className="rounded-full border border-border/70 px-2 py-1 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {activeTab.profileName}
        </div>
      ) : null}
      {props.onOpenExternal ? (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={props.onOpenExternal}>
          <ExternalLinkIcon className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
