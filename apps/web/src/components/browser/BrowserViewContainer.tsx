import { useBrowserBounds } from "./useBrowserBounds";
import { useBrowserStore } from "../../browserStore";

export function BrowserViewContainer() {
  const containerRef = useBrowserBounds();
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  if (!activeTabId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No tab selected. Open a new tab from the sidebar.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1"
      style={{ minHeight: 200 }}
    />
  );
}
