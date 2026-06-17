import type {
  DiscoveredLocalServer,
  EnvironmentId,
  LocalServersSnapshot,
  ThreadId,
} from "@fenrir/contracts";
import { create } from "zustand";

import type { WsRpcClient } from "./rpc/wsRpcClient";

type LocalServersStatus = "idle" | "connecting" | "connected" | "error";

export interface LocalServersEnvironmentState {
  readonly status: LocalServersStatus;
  readonly snapshot: LocalServersSnapshot | null;
  readonly error: string | null;
}

export interface LocalServersStoreState {
  readonly byEnvironmentId: Record<string, LocalServersEnvironmentState>;
  readonly setStatus: (environmentId: EnvironmentId, status: LocalServersStatus) => void;
  readonly setSnapshot: (environmentId: EnvironmentId, snapshot: LocalServersSnapshot) => void;
  readonly setError: (environmentId: EnvironmentId, error: string) => void;
}

interface LocalServersSubscription {
  readonly unsubscribe: () => void;
  refCount: number;
}

const idleState: LocalServersEnvironmentState = {
  status: "idle",
  snapshot: null,
  error: null,
};
const emptyLocalServers: readonly DiscoveredLocalServer[] = Object.freeze([]);
const activeSubscriptions = new Map<string, LocalServersSubscription>();

function getEnvironmentState(
  state: LocalServersStoreState,
  environmentId: EnvironmentId,
): LocalServersEnvironmentState {
  return state.byEnvironmentId[environmentId] ?? idleState;
}

export const useLocalServersStore = create<LocalServersStoreState>((set) => ({
  byEnvironmentId: {},

  setStatus: (environmentId, status) =>
    set((state) => {
      const current = getEnvironmentState(state, environmentId);
      return {
        byEnvironmentId: {
          ...state.byEnvironmentId,
          [environmentId]: {
            ...current,
            status,
            error: status === "error" ? current.error : null,
          },
        },
      };
    }),

  setSnapshot: (environmentId, snapshot) =>
    set((state) => ({
      byEnvironmentId: {
        ...state.byEnvironmentId,
        [environmentId]: {
          status: "connected",
          snapshot,
          error: null,
        },
      },
    })),

  setError: (environmentId, error) =>
    set((state) => {
      const current = getEnvironmentState(state, environmentId);
      return {
        byEnvironmentId: {
          ...state.byEnvironmentId,
          [environmentId]: {
            ...current,
            status: "error",
            error,
          },
        },
      };
    }),
}));

export function selectLocalServersForThread(
  state: LocalServersStoreState,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): readonly DiscoveredLocalServer[] {
  const snapshot = state.byEnvironmentId[environmentId]?.snapshot;
  if (!snapshot) return emptyLocalServers;
  return snapshot.servers.filter((server) => server.terminal?.threadId === threadId);
}

export function selectLocalServersForTerminal(
  state: LocalServersStoreState,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  terminalId: string,
): readonly DiscoveredLocalServer[] {
  const snapshot = state.byEnvironmentId[environmentId]?.snapshot;
  if (!snapshot) return emptyLocalServers;
  return snapshot.servers.filter(
    (server) => server.terminal?.threadId === threadId && server.terminal.terminalId === terminalId,
  );
}

export function selectPreferredLocalServer(
  servers: readonly DiscoveredLocalServer[],
): DiscoveredLocalServer | null {
  return servers[0] ?? null;
}

export function formatLocalServerShortLabel(server: DiscoveredLocalServer): string {
  return `:${server.port}`;
}

export function subscribeToLocalServers(input: {
  readonly environmentId: EnvironmentId;
  readonly client: WsRpcClient;
}): () => void {
  const subscriptionKey = input.environmentId;
  const activeSubscription = activeSubscriptions.get(subscriptionKey);
  if (activeSubscription) {
    activeSubscription.refCount += 1;
    return () => {
      activeSubscription.refCount -= 1;
      if (activeSubscription.refCount > 0) return;
      activeSubscriptions.delete(subscriptionKey);
      activeSubscription.unsubscribe();
    };
  }

  const store = useLocalServersStore.getState();
  store.setStatus(input.environmentId, "connecting");

  try {
    const unsubscribe = input.client.localServers.subscribe(
      (snapshot) => {
        useLocalServersStore.getState().setSnapshot(input.environmentId, snapshot);
      },
      {
        onResubscribe: () => {
          useLocalServersStore.getState().setStatus(input.environmentId, "connecting");
        },
      },
    );
    const subscription: LocalServersSubscription = {
      unsubscribe,
      refCount: 1,
    };
    activeSubscriptions.set(subscriptionKey, subscription);
    return () => {
      subscription.refCount -= 1;
      if (subscription.refCount > 0) return;
      activeSubscriptions.delete(subscriptionKey);
      unsubscribe();
    };
  } catch (error) {
    useLocalServersStore
      .getState()
      .setError(input.environmentId, error instanceof Error ? error.message : String(error));
    return () => undefined;
  }
}
