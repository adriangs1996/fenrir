import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, X as StopIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function TrafficLensAddressBar() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const activeTab = useTrafficLensStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  const [urlInput, setUrlInput] = useState("");

  // Sync URL input with active tab
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    }
  }, [activeTab?.url]);

  if (!activeTabId || !activeTab) return null;

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    // Auto-add protocol
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    void window.desktopBridge?.trafficLensNavigate(activeTabId, url);
  };

  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
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
          className="h-7 text-sm"
        />
      </form>
    </div>
  );
}
