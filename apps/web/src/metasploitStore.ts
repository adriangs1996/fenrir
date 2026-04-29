import { create } from "zustand";
import type { ListenerSnapshot, MsfSessionSnapshot, MetasploitEvent } from "@fenrir/contracts";

interface MetasploitState {
  connected: boolean;
  listeners: Record<string, ListenerSnapshot>;
  sessions: Record<string, MsfSessionSnapshot>;
  activeSessionId: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  upsertListener: (snapshot: ListenerSnapshot) => void;
  removeListener: (listenerId: string) => void;
  upsertSession: (snapshot: MsfSessionSnapshot) => void;
  removeSession: (sessionId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  applyEvent: (event: MetasploitEvent) => void;
}

export const useMetasploitStore = create<MetasploitState>((set) => ({
  connected: false,
  listeners: {},
  sessions: {},
  activeSessionId: null,

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
          // Defensive backstop: server emits session.closed for the old id, but if
          // we somehow miss that event, drop it here when the upgraded id differs.
          const remaining =
            event.previousSessionId && event.previousSessionId !== newSnapshot.sessionId
              ? Object.fromEntries(
                  Object.entries(state.sessions).filter(([id]) => id !== event.previousSessionId),
                )
              : state.sessions;
          return {
            sessions: {
              ...remaining,
              [newSnapshot.sessionId]: newSnapshot,
            },
            activeSessionId:
              event.previousSessionId && state.activeSessionId === event.previousSessionId
                ? newSnapshot.sessionId
                : state.activeSessionId,
          };
        }
        default:
          return state;
      }
    }),
}));
