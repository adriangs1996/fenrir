import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AppMode } from "@t3tools/contracts";

const MODE_STORAGE_KEY = "t3code:mode:v1";

interface ModeState {
  activeMode: AppMode;
  switchMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      activeMode: "code",
      switchMode: (mode) => set({ activeMode: mode }),
      toggleMode: () =>
        set((state) => ({
          activeMode: state.activeMode === "code" ? "pentest" : "code",
        })),
    }),
    {
      name: MODE_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : undefined!,
      ),
      partialize: (state) => ({ activeMode: state.activeMode }),
    },
  ),
);
