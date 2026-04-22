import { create } from "zustand";
import type {
  ListenerSnapshot,
  MsfSessionSnapshot,
  MetasploitEvent,
} from "@fenrir/contracts";

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
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
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
              state.activeSessionId === event.sessionId
                ? null
                : state.activeSessionId,
          };
        }
        case "session.output":
          return state; // Output handled by terminal store
        case "session.upgraded":
          return {
            sessions: {
              ...state.sessions,
              [event.snapshot.sessionId]: event.snapshot,
            },
          };
        default:
          return state;
      }
    }),
}));
