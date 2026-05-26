import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLinkIcon, RotateCw, X as StopIcon } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function TrafficLensAddressBar(props: { onOpenExternal?: () => void }) {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  const [urlInput, setUrlInput] = useState("");
  const activeUrl = activeTab?.url;

  useEffect(() => {
    if (activeUrl !== undefined) {
      setUrlInput(activeUrl);
    }
  }, [activeUrl]);

  if (!activeTabId || !activeTab) return null;

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    void window.desktopBridge?.trafficLensNavigate(activeTabId, url);
  };

  return (
    <div className="flex items-center gap-1 border-b bg-background/90 px-2 py-1.5 backdrop-blur-sm">
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
