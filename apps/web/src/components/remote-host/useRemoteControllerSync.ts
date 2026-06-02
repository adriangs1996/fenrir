import { useEffect } from "react";
import type { EnvironmentId } from "@fenrir/contracts";

import { readEnvironmentApi } from "../../environmentApi";
import { useRemoteControllerStore } from "../../remoteControllerStore";

const syncRefs = new Map<EnvironmentId, number>();
const syncUnsubscribes = new Map<EnvironmentId, () => void>();

function acquireRemoteControllerSync(environmentId: EnvironmentId): () => void {
  const existingRefCount = syncRefs.get(environmentId) ?? 0;
  syncRefs.set(environmentId, existingRefCount + 1);

  if (existingRefCount === 0) {
    const api = readEnvironmentApi(environmentId);
    if (api) {
      let cancelled = false;
      const store = useRemoteControllerStore.getState();

      void api.remoteController
        .listHosts()
        .then((hosts) => {
          if (!cancelled) store.resetHosts(hosts);
        })
        .catch(() => {});
      void api.remoteController
        .listConnections()
        .then((connections) => {
          if (!cancelled) store.resetConnections(connections);
        })
        .catch(() => {});
      void api.remoteController
        .listCommandRuns({})
        .then((runs) => {
          if (!cancelled) store.resetCommandRuns(runs);
        })
        .catch(() => {});

      const unsubscribe = api.remoteController.onEvent((event) => {
        useRemoteControllerStore.getState().applyEvent(event);
      });

      syncUnsubscribes.set(environmentId, () => {
        cancelled = true;
        unsubscribe();
      });
    }
  }

  return () => {
    const currentRefCount = syncRefs.get(environmentId);
    if (!currentRefCount) return;
    if (currentRefCount > 1) {
      syncRefs.set(environmentId, currentRefCount - 1);
      return;
    }
    syncRefs.delete(environmentId);
    syncUnsubscribes.get(environmentId)?.();
    syncUnsubscribes.delete(environmentId);
  };
}

export function useRemoteControllerSync(environmentId: EnvironmentId | null) {
  useEffect(() => {
    if (!environmentId) return;
    return acquireRemoteControllerSync(environmentId);
  }, [environmentId]);
}
