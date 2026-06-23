import { create } from "zustand";

export type RightPanelTab = "plan" | "workflows" | "diff";

interface RightPanelState {
  /** Thread-scoped active tab. Missing entries are closed. */
  activeTabByThreadKey: Record<string, RightPanelTab | null>;

  /** Open the panel to a specific tab */
  openTab: (threadKey: string, tab: RightPanelTab) => void;

  /** Close the panel entirely */
  close: (threadKey: string) => void;

  /** Toggle a specific tab (open if closed or different tab, close if same tab) */
  toggleTab: (threadKey: string, tab: RightPanelTab) => void;

  /** Clear all thread-scoped state. Primarily for tests. */
  reset: () => void;
}

export function selectRightPanelActiveTab(
  state: Pick<RightPanelState, "activeTabByThreadKey">,
  threadKey: string | null | undefined,
): RightPanelTab | null {
  if (!threadKey) {
    return null;
  }
  return state.activeTabByThreadKey[threadKey] ?? null;
}

export const useRightPanelStore = create<RightPanelState>((set, get) => ({
  activeTabByThreadKey: {},

  openTab: (threadKey, tab) =>
    set((state) => ({
      activeTabByThreadKey: {
        ...state.activeTabByThreadKey,
        [threadKey]: tab,
      },
    })),

  close: (threadKey) =>
    set((state) => ({
      activeTabByThreadKey: {
        ...state.activeTabByThreadKey,
        [threadKey]: null,
      },
    })),

  toggleTab: (threadKey, tab) => {
    const current = selectRightPanelActiveTab(get(), threadKey);
    set((state) => ({
      activeTabByThreadKey: {
        ...state.activeTabByThreadKey,
        [threadKey]: current === tab ? null : tab,
      },
    }));
  },

  reset: () => set({ activeTabByThreadKey: {} }),
}));
