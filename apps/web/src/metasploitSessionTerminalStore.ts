import { create } from "zustand";

interface SessionTerminalEntry {
  id: number;
  sessionId: string;
  data: string;
}

const MAX_BUFFER = 500;

interface MetasploitSessionTerminalState {
  entries: SessionTerminalEntry[];
  nextId: number;

  appendOutput: (sessionId: string, data: string) => void;
  clearSession: (sessionId: string) => void;
  getSessionEntries: (sessionId: string) => SessionTerminalEntry[];
}

export const useMetasploitSessionTerminalStore =
  create<MetasploitSessionTerminalState>((set, get) => ({
    entries: [],
    nextId: 1,

    appendOutput: (sessionId, data) =>
      set((state) => {
        const entry: SessionTerminalEntry = {
          id: state.nextId,
          sessionId,
          data,
        };
        const entries = [...state.entries, entry].slice(-MAX_BUFFER);
        return { entries, nextId: state.nextId + 1 };
      }),

    clearSession: (sessionId) =>
      set((state) => ({
        entries: state.entries.filter((e) => e.sessionId !== sessionId),
      })),

    getSessionEntries: (sessionId) =>
      get().entries.filter((e) => e.sessionId === sessionId),
  }));
