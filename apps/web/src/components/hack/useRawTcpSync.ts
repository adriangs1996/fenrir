import { useEffect } from "react";
import type { EnvironmentId } from "@fenrir/contracts";

import { readEnvironmentApi } from "../../environmentApi";
import { useRawTcpStore } from "../../rawTcpStore";

const rawTcpSyncRefs = new Map<EnvironmentId, number>();
const rawTcpSyncUnsubscribes = new Map<EnvironmentId, () => void>();

function acquireRawTcpSync(environmentId: EnvironmentId): () => void {
  const existingRefCount = rawTcpSyncRefs.get(environmentId) ?? 0;
  rawTcpSyncRefs.set(environmentId, existingRefCount + 1);

  if (existingRefCount === 0) {
    const api = readEnvironmentApi(environmentId);
    if (api) {
      let cancelled = false;
      const store = useRawTcpStore.getState();

      void api.rawTcp
        .listListeners()
        .then((list) => {
          if (!cancelled) {
            store.resetForListeners(list);
          }
        })
        .catch(() => {});
      void api.rawTcp
        .listSessions()
        .then((list) => {
          if (!cancelled) {
            store.resetForSessions(list);
          }
        })
        .catch(() => {});

      const unsubscribe = api.rawTcp.onEvent((event) => {
        useRawTcpStore.getState().applyEvent(event);
      });

      rawTcpSyncUnsubscribes.set(environmentId, () => {
        cancelled = true;
        unsubscribe();
      });
    }
  }

  return () => {
    const currentRefCount = rawTcpSyncRefs.get(environmentId);
    if (!currentRefCount) {
      return;
    }
    if (currentRefCount > 1) {
      rawTcpSyncRefs.set(environmentId, currentRefCount - 1);
      return;
    }
    rawTcpSyncRefs.delete(environmentId);
    rawTcpSyncUnsubscribes.get(environmentId)?.();
    rawTcpSyncUnsubscribes.delete(environmentId);
  };
}

export function useRawTcpSync(environmentId: EnvironmentId | null) {
  useEffect(() => {
    if (!environmentId) return;
    return acquireRawTcpSync(environmentId);
  }, [environmentId]);
}
