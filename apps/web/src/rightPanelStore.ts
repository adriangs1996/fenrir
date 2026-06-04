import { create } from "zustand";

export type RightPanelTab = "plan" | "diff";

interface RightPanelState {
  /** Currently active tab, or null if panel is closed */
  activeTab: RightPanelTab | null;

  /** Open the panel to a specific tab */
  openTab: (tab: RightPanelTab) => void;

  /** Close the panel entirely */
  close: () => void;

  /** Toggle a specific tab (open if closed or different tab, close if same tab) */
  toggleTab: (tab: RightPanelTab) => void;
}

export const useRightPanelStore = create<RightPanelState>((set, get) => ({
  activeTab: null,

  openTab: (tab) => set({ activeTab: tab }),

  close: () => set({ activeTab: null }),

  toggleTab: (tab) => {
    const current = get().activeTab;
    set({ activeTab: current === tab ? null : tab });
  },
}));
