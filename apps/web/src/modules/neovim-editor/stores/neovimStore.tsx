// stores/neovimStore.ts
import { create } from "zustand";

export interface Cell {
  text: string;
  hlId?: number;
}

interface NeovimState {
  rows: number;
  cols: number;
  grid: Cell[][];
  cursor: { row: number; col: number };

  setGridSize: (rows: number, cols: number) => void;
  putText: (row: number, col: number, text: string) => void;
  moveCursor: (row: number, col: number) => void;
}

export const useNeovimStore = create<NeovimState>((set, get) => ({
  rows: 0,
  cols: 0,
  grid: [],
  cursor: { row: 0, col: 0 },

  setGridSize: (rows, cols) => {
    const grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ text: " " })),
    );
    set({ rows, cols, grid });
  },

  putText: (row, col, text) => {
    const grid = [...get().grid];
    if (!grid[row]) return;

    grid[row][col] = { text };
    set({ grid });
  },

  moveCursor: (row, col) => {
    set({ cursor: { row, col } });
  },
}));
