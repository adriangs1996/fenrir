import { useEffect, useMemo } from "react";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import { useTrafficLensSync } from "./useTrafficLensSync";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime";

/**
 * Manages the full Traffic Lens lifecycle:
 * - Subscribes to IPC tab events and applies them to the store
 * - Restores existing tabs on mount
 * - Subscribes to WS traffic stream via useTrafficLensSync
 * - Cleans up on unmount
 */
export function useTrafficLensLifecycle() {
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  useTrafficLensSync(rpcClient);

  // Subscribe to tab events from main process
  useEffect(() => {
    const unsubscribe = window.desktopBridge?.onTrafficLensTabEvent((event) => {
      useTrafficLensStore.getState().applyEvent(event as any);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopBridge?.onTrafficLensPausedEvent((event) => {
      useTrafficLensStore.getState().applyPausedEvent(event as any);
    });
    return () => unsubscribe?.();
  }, []);

  // Restore tabs on mount
  useEffect(() => {
    const loadDesktopState = async () => {
      const bridge = window.desktopBridge;
      if (!bridge) {
        return;
      }
      const [tabs, paused] = await Promise.all([
        bridge.trafficLensGetTabs(),
        bridge.trafficLensListPaused(),
      ]);
      if (tabs) {
        for (const tab of tabs) {
          useTrafficLensStore.getState().upsertTab(tab);
        }
      }
      if (paused) {
        for (const request of paused) {
          useTrafficLensStore.getState().upsertPausedRequest(request);
        }
      }
    };
    void loadDesktopState();
  }, []);
}
