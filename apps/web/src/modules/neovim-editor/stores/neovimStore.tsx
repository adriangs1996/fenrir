import { create } from "zustand";

interface NeovimState {
  rows: number;
  cols: number;
  cursor: { row: number; col: number };

  setGridSize: (rows: number, cols: number) => void;
  moveCursor: (row: number, col: number) => void;
}

export const useNeovimStore = create<NeovimState>((set) => ({
  rows: 0,
  cols: 0,
  cursor: { row: 0, col: 0 },

  setGridSize: (rows, cols) => {
    set({ rows, cols });
  },

  moveCursor: (row, col) => {
    set({ cursor: { row, col } });
  },
}));
