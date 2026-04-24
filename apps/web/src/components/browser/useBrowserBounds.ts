import { useEffect, useRef, useCallback } from "react";
import { useBrowserStore } from "../../browserStore";

export function useBrowserBounds() {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
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
      void window.desktopBridge?.browserSetBounds(activeTabId, bounds);
    }
  }, [activeTabId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activeTabId) return;

    // Show tab in main process
    void window.desktopBridge?.browserShowTab(activeTabId);

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateBounds);
    });

    observer.observe(el);
    updateBounds();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [activeTabId, updateBounds]);

  // Hide all tabs on unmount
  useEffect(() => {
    return () => {
      void window.desktopBridge?.hideAllTabs();
    };
  }, []);

  return containerRef;
}
