import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

export function useTrafficLensBounds(
  containerRef: RefObject<HTMLDivElement | null>,
  layoutKey?: string,
) {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const rafRef = useRef<number>(0);

  const updateBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el || !activeTabId) return;

    const rect = el.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // Only send if dimensions are valid
    if (bounds.width > 0 && bounds.height > 0) {
      void window.desktopBridge?.trafficLensSetBounds(activeTabId, bounds);
    }
  }, [activeTabId, containerRef]);

  const scheduleUpdateBounds = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateBounds);
  }, [updateBounds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activeTabId) return;

    // Show tab in main process
    void window.desktopBridge?.trafficLensShowTab(activeTabId);

    const observer = new ResizeObserver(scheduleUpdateBounds);

    observer.observe(el);
    updateBounds();
    window.addEventListener("resize", scheduleUpdateBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdateBounds);
      cancelAnimationFrame(rafRef.current);
    };
  }, [activeTabId, containerRef, layoutKey, scheduleUpdateBounds, updateBounds]);

  // Hide all tabs on unmount
  useEffect(() => {
    return () => {
      void window.desktopBridge?.trafficLensHideAllTabs();
    };
  }, []);
}
