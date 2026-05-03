import { useEffect, useRef, useState } from "react";

const RESIZE_DEBOUNCE_MS = 100;

export function useContainerSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;

      // Debounce: coalesce rapid resize events (sidebar animation, scrollbar, etc.)
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setSize({ width, height });
      }, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [ref]);

  return size;
}
