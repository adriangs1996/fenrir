import { useTrafficLensBounds } from "../hooks/useTrafficLensBounds";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function TrafficLensViewContainer() {
  const containerRef = useTrafficLensBounds();
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);

  if (!activeTabId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No tab selected. Open a new tab from the sidebar.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full min-h-0 w-full flex-1" />;
}
