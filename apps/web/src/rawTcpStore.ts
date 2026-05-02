import { create } from "zustand";
import type { RawTcpEvent, RawTcpListenerSnapshot, RawTcpSessionSnapshot } from "@fenrir/contracts";

const MAX_OUTPUT_BYTES = 1_000_000;

interface RawTcpState {
  listeners: Record<string, RawTcpListenerSnapshot>;
  sessions: Record<string, RawTcpSessionSnapshot>;
  sessionOutput: Record<string, string>;
  activeSessionId: string | null;

  upsertListener: (snapshot: RawTcpListenerSnapshot) => void;
  removeListener: (listenerId: string) => void;
  upsertSession: (snapshot: RawTcpSessionSnapshot) => void;
  removeSession: (sessionId: string) => void;
  appendOutput: (sessionId: string, data: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  applyEvent: (event: RawTcpEvent) => void;
  resetForListeners: (listeners: readonly RawTcpListenerSnapshot[]) => void;
  resetForSessions: (sessions: readonly RawTcpSessionSnapshot[]) => void;
}

const truncateOutput = (existing: string | undefined, chunk: string): string => {
  const next = (existing ?? "") + chunk;
  if (next.length <= MAX_OUTPUT_BYTES) return next;
  return next.slice(next.length - MAX_OUTPUT_BYTES);
};

export const useRawTcpStore = create<RawTcpState>((set) => ({
  listeners: {},
  sessions: {},
  sessionOutput: {},
  activeSessionId: null,

  upsertListener: (snapshot) =>
    set((state) => ({
      listeners: { ...state.listeners, [snapshot.listenerId]: snapshot },
    })),

  removeListener: (listenerId) =>
    set((state) => {
      const { [listenerId]: _removed, ...rest } = state.listeners;
      return { listeners: rest };
    }),

  upsertSession: (snapshot) =>
    set((state) => ({
      sessions: { ...state.sessions, [snapshot.sessionId]: snapshot },
    })),

  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removedSession, ...sessionRest } = state.sessions;
      const { [sessionId]: _removedOutput, ...outputRest } = state.sessionOutput;
      return {
        sessions: sessionRest,
        sessionOutput: outputRest,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),

  appendOutput: (sessionId, data) =>
    set((state) => ({
      sessionOutput: {
        ...state.sessionOutput,
        [sessionId]: truncateOutput(state.sessionOutput[sessionId], data),
      },
    })),

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

  resetForListeners: (listeners) =>
    set(() => ({
      listeners: Object.fromEntries(listeners.map((l) => [l.listenerId, l])),
    })),

  resetForSessions: (sessions) =>
    set(() => ({
      sessions: Object.fromEntries(sessions.map((s) => [s.sessionId, s])),
    })),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "listener.created":
          return {
            listeners: { ...state.listeners, [event.snapshot.listenerId]: event.snapshot },
          };
        case "listener.stopped": {
          const { [event.listenerId]: _removed, ...rest } = state.listeners;
          return { listeners: rest };
        }
        case "session.connected":
          return {
            sessions: { ...state.sessions, [event.snapshot.sessionId]: event.snapshot },
          };
        case "session.updated":
          return {
            sessions: { ...state.sessions, [event.snapshot.sessionId]: event.snapshot },
          };
        case "session.closed": {
          const { [event.sessionId]: _removedSession, ...sessionRest } = state.sessions;
          return {
            sessions: sessionRest,
            activeSessionId:
              state.activeSessionId === event.sessionId ? null : state.activeSessionId,
          };
        }
        case "session.data":
          return {
            sessionOutput: {
              ...state.sessionOutput,
              [event.sessionId]: truncateOutput(state.sessionOutput[event.sessionId], event.data),
            },
          };
        default:
          return state;
      }
    }),
}));
