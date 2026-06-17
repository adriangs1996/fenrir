import type { TrafficLensProfileId, TrafficLensTabSnapshot } from "@fenrir/contracts";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

import { toastManager } from "~/components/ui/toast";
import { useTrafficLensStore } from "~/modules/traffic-lens";

export async function createBrowserLabTab(url: string): Promise<TrafficLensTabSnapshot> {
  const bridge = window.desktopBridge;
  if (!bridge) {
    throw new Error("Browser Lab requires the Electron desktop app.");
  }

  const selectedProfileId = useTrafficLensStore.getState().selectedProfileId;
  const snapshot =
    selectedProfileId && selectedProfileId !== "default"
      ? await bridge.trafficLensCreateTabInProfile({
          profileId: selectedProfileId as TrafficLensProfileId,
          url,
        })
      : await bridge.trafficLensCreateTab(url);

  const store = useTrafficLensStore.getState();
  store.upsertTab(snapshot);
  store.setActiveTab(snapshot.tabId);
  return snapshot;
}

export function useOpenBrowserLabUrl(): (url: string) => Promise<void> {
  const navigate = useNavigate();

  return useCallback(
    async (url: string) => {
      try {
        await createBrowserLabTab(url);
        await navigate({ to: "/browser-lab" });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not open Browser Lab",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [navigate],
  );
}
