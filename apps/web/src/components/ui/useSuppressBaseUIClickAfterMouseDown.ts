"use client";

import { useCallback, useEffect, useRef, type MouseEventHandler } from "react";

type BaseUIPreventableMouseEvent<Element extends HTMLElement> = Parameters<
  MouseEventHandler<Element>
>[0] & {
  baseUIHandlerPrevented?: boolean;
  preventBaseUIHandler?: () => void;
};

interface SuppressBaseUIClickOptions<Element extends HTMLElement> {
  shouldSuppressClickAfterMouseDown?: (event: BaseUIPreventableMouseEvent<Element>) => boolean;
}

const CLICK_SUPPRESSION_RESET_MS = 1000;

/**
 * Base UI mousedown-open controls rely on pointerdown to ignore the following
 * click. Some embedded WebViews can miss that pointerdown, so suppress Base
 * UI's fallback click handler after a primary-button mousedown has already
 * opened or closed the popup.
 */
export function useSuppressBaseUIClickAfterMouseDown<Element extends HTMLElement>(
  onMouseDown: MouseEventHandler<Element> | undefined,
  onClick: MouseEventHandler<Element> | undefined,
  options: SuppressBaseUIClickOptions<Element> = {},
) {
  const suppressNextClickRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldSuppressClickAfterMouseDown = options.shouldSuppressClickAfterMouseDown;

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const handleMouseDown = useCallback<MouseEventHandler<Element>>(
    (event) => {
      const preventableEvent = event as BaseUIPreventableMouseEvent<Element>;
      const shouldSuppress =
        event.button === 0 && (shouldSuppressClickAfterMouseDown?.(preventableEvent) ?? true);

      onMouseDown?.(event);

      if (!shouldSuppress || preventableEvent.baseUIHandlerPrevented === true) {
        return;
      }

      suppressNextClickRef.current = true;
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        suppressNextClickRef.current = false;
        resetTimerRef.current = null;
      }, CLICK_SUPPRESSION_RESET_MS);
    },
    [clearResetTimer, onMouseDown, shouldSuppressClickAfterMouseDown],
  );

  const handleClick = useCallback<MouseEventHandler<Element>>(
    (event) => {
      onClick?.(event);

      if (!suppressNextClickRef.current) {
        return;
      }

      suppressNextClickRef.current = false;
      clearResetTimer();

      if (event.detail === 0) {
        return;
      }

      (event as BaseUIPreventableMouseEvent<Element>).preventBaseUIHandler?.();
    },
    [clearResetTimer, onClick],
  );

  return {
    onClick: handleClick,
    onMouseDown: handleMouseDown,
  };
}
