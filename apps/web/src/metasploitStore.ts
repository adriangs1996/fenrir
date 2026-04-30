import { create } from "zustand";
import type { ListenerSnapshot, MsfSessionSnapshot, MetasploitEvent } from "@fenrir/contracts";

interface MetasploitState {
  connected: boolean;
  listeners: Record<string, ListenerSnapshot>;
  sessions: Record<string, MsfSessionSnapshot>;
  activeSessionId: string | null;
  /** Maps previousSessionId → newSessionId after upgrade. Used for auto-navigation. */
  upgradeRedirects: Record<string, string>;

  // Actions
  setConnected: (connected: boolean) => void;
  upsertListener: (snapshot: ListenerSnapshot) => void;
  removeListener: (listenerId: string) => void;
  upsertSession: (snapshot: MsfSessionSnapshot) => void;
  removeSession: (sessionId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  applyEvent: (event: MetasploitEvent) => void;
  /** Consume and clear a redirect entry. Returns new sessionId or null. */
  consumeUpgradeRedirect: (previousSessionId: string) => string | null;
}

export const useMetasploitStore = create<MetasploitState>((set, get) => ({
  connected: false,
  listeners: {},
  sessions: {},
  activeSessionId: null,
  upgradeRedirects: {},

  setConnected: (connected) => set({ connected }),
  upsertListener: (snapshot) =>
    set((state) => ({
      listeners: { ...state.listeners, [snapshot.listenerId]: snapshot },
    })),
  removeListener: (listenerId) =>
    set((state) => {
      const { [listenerId]: _, ...rest } = state.listeners;
      return { listeners: rest };
    }),
  upsertSession: (snapshot) =>
    set((state) => ({
      sessions: { ...state.sessions, [snapshot.sessionId]: snapshot },
    })),
  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),
  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  consumeUpgradeRedirect: (previousSessionId) => {
    const newId = get().upgradeRedirects[previousSessionId] ?? null;
    if (newId) {
      set((state) => {
        const { [previousSessionId]: _, ...rest } = state.upgradeRedirects;
        return { upgradeRedirects: rest };
      });
    }
    return newId;
  },
  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "listener.created":
          return {
            listeners: {
              ...state.listeners,
              [event.snapshot.listenerId]: event.snapshot,
            },
          };
        case "listener.stopped": {
          const { [event.listenerId]: _, ...rest } = state.listeners;
          return { listeners: rest };
        }
        case "listener.updated":
          return {
            listeners: {
              ...state.listeners,
              [event.snapshot.listenerId]: event.snapshot,
            },
          };
        case "session.opened":
          return {
            sessions: {
              ...state.sessions,
              [event.snapshot.sessionId]: event.snapshot,
            },
          };
        case "session.closed": {
          const { [event.sessionId]: _, ...rest } = state.sessions;
          return {
            sessions: rest,
            activeSessionId:
              state.activeSessionId === event.sessionId ? null : state.activeSessionId,
          };
        }
        case "session.output":
          return state; // Output handled by terminal store
        case "connection.changed":
          return { connected: event.connected };
        case "session.upgraded": {
          const newSnapshot = event.snapshot;
          const remaining =
            event.previousSessionId && event.previousSessionId !== newSnapshot.sessionId
              ? Object.fromEntries(
                  Object.entries(state.sessions).filter(([id]) => id !== event.previousSessionId),
                )
              : state.sessions;
          // Track redirect so TargetWorkspace can auto-navigate.
          const redirects =
            event.previousSessionId && event.previousSessionId !== newSnapshot.sessionId
              ? {
                  ...state.upgradeRedirects,
                  [event.previousSessionId]: newSnapshot.sessionId,
                }
              : state.upgradeRedirects;
          return {
            sessions: {
              ...remaining,
              [newSnapshot.sessionId]: newSnapshot,
            },
            activeSessionId:
              event.previousSessionId && state.activeSessionId === event.previousSessionId
                ? newSnapshot.sessionId
                : state.activeSessionId,
            upgradeRedirects: redirects,
          };
        }
        default:
          return state;
      }
    }),
}));
