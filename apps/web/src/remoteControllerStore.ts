import type {
  RemoteCommandRunSnapshot,
  RemoteConnectionSnapshot,
  RemoteControllerEvent,
  RemoteHostSnapshot,
} from "@fenrir/contracts";
import { create } from "zustand";

const MAX_COMMAND_RUNS = 500;

interface RemoteControllerState {
  hosts: Record<string, RemoteHostSnapshot>;
  connections: Record<string, RemoteConnectionSnapshot>;
  commandRuns: Record<string, RemoteCommandRunSnapshot>;
  selectedHostId: string | null;

  setSelectedHostId: (hostId: string | null) => void;
  resetHosts: (hosts: readonly RemoteHostSnapshot[]) => void;
  resetConnections: (connections: readonly RemoteConnectionSnapshot[]) => void;
  resetCommandRuns: (runs: readonly RemoteCommandRunSnapshot[]) => void;
  applyEvent: (event: RemoteControllerEvent) => void;
}

const indexBy = <T>(items: readonly T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(items.map((item) => [key(item), item]));

const trimRuns = (
  runs: Record<string, RemoteCommandRunSnapshot>,
): Record<string, RemoteCommandRunSnapshot> => {
  const entries = Object.entries(runs);
  if (entries.length <= MAX_COMMAND_RUNS) return runs;

  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => left.startedAt.localeCompare(right.startedAt))
      .slice(entries.length - MAX_COMMAND_RUNS),
  );
};

export const useRemoteControllerStore = create<RemoteControllerState>((set) => ({
  hosts: {},
  connections: {},
  commandRuns: {},
  selectedHostId: null,

  setSelectedHostId: (hostId) => set({ selectedHostId: hostId }),

  resetHosts: (hosts) =>
    set((state) => ({
      hosts: indexBy(hosts, (host) => host.hostId),
      selectedHostId:
        state.selectedHostId && hosts.some((host) => host.hostId === state.selectedHostId)
          ? state.selectedHostId
          : (hosts[0]?.hostId ?? null),
    })),

  resetConnections: (connections) =>
    set(() => ({
      connections: indexBy(connections, (connection) => connection.connectionId),
    })),

  resetCommandRuns: (runs) =>
    set(() => ({
      commandRuns: trimRuns(indexBy(runs, (run) => run.runId)),
    })),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "host.upserted":
          return {
            hosts: { ...state.hosts, [event.snapshot.hostId]: event.snapshot },
            selectedHostId: state.selectedHostId ?? event.snapshot.hostId,
          };
        case "host.deleted": {
          const { [event.hostId]: _removed, ...hosts } = state.hosts;
          return {
            hosts,
            selectedHostId:
              state.selectedHostId === event.hostId
                ? (Object.keys(hosts)[0] ?? null)
                : state.selectedHostId,
          };
        }
        case "connection.updated":
          return {
            connections: {
              ...state.connections,
              [event.snapshot.connectionId]: event.snapshot,
            },
          };
        case "commandRun.updated":
          return {
            commandRuns: trimRuns({
              ...state.commandRuns,
              [event.snapshot.runId]: event.snapshot,
            }),
          };
      }
    }),
}));
