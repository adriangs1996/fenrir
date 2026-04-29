import { create } from "zustand";
import type {
  TrafficLensTabSnapshot,
  TrafficLensTabEvent,
  TrafficLensEntry,
  TrafficLensDetail,
} from "@fenrir/contracts";

interface TrafficLensState {
  tabs: Record<string, TrafficLensTabSnapshot>;
  activeTabId: string | null;
  trafficEntries: TrafficLensEntry[];

  // Inspector/Repeater state
  selectedTrafficId: number | null;
  repeaterDetail: TrafficLensDetail | null;
  showRepeater: boolean;
  bottomTab: "traffic" | "inspector" | "repeater";

  // Actions
  upsertTab: (snapshot: TrafficLensTabSnapshot) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  applyEvent: (event: TrafficLensTabEvent) => void;
  appendTraffic: (entry: TrafficLensEntry) => void;
  clearTraffic: () => void;

  // Inspector/Repeater actions
  setSelectedTraffic: (id: number | null) => void;
  openRepeater: (detail: TrafficLensDetail) => void;
  closeRepeater: () => void;
  setBottomTab: (tab: "traffic" | "inspector" | "repeater") => void;
}

export const useTrafficLensStore = create<TrafficLensState>((set) => ({
  tabs: {},
  activeTabId: null,
  trafficEntries: [],

  selectedTrafficId: null,
  repeaterDetail: null,
  showRepeater: false,
  bottomTab: "traffic" as const,

  upsertTab: (snapshot) =>
    set((state) => ({
      tabs: { ...state.tabs, [snapshot.tabId]: snapshot },
    })),

  removeTab: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.tabs;
      return {
        tabs: rest,
        activeTabId: state.activeTabId === tabId ? null : state.activeTabId,
      };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "tab.created":
          return {
            tabs: {
              ...state.tabs,
              [event.snapshot.tabId]: event.snapshot,
            },
          };
        case "tab.closed": {
          const { [event.tabId]: _, ...rest } = state.tabs;
          return {
            tabs: rest,
            activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
          };
        }
        case "tab.navigated": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: {
              ...state.tabs,
              [event.tabId]: { ...existing, url: event.url },
            },
          };
        }
        case "tab.titleUpdated": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: {
              ...state.tabs,
              [event.tabId]: { ...existing, title: event.title },
            },
          };
        }
        case "tab.loadingChanged": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: {
              ...state.tabs,
              [event.tabId]: { ...existing, loading: event.loading },
            },
          };
        }
        default:
          return state;
      }
    }),

  appendTraffic: (entry) =>
    set((state) => {
      const existingIndex = state.trafficEntries.findIndex((e) => e.requestId === entry.requestId);
      if (existingIndex >= 0) {
        const updated = [...state.trafficEntries];
        updated[existingIndex] = entry;
        return { trafficEntries: updated };
      }
      return {
        trafficEntries: [entry, ...state.trafficEntries],
      };
    }),

  clearTraffic: () => set({ trafficEntries: [] }),

  setSelectedTraffic: (id) =>
    set({
      selectedTrafficId: id,
      bottomTab: id ? "inspector" : "traffic",
    }),

  openRepeater: (detail) =>
    set({
      repeaterDetail: detail,
      showRepeater: true,
      bottomTab: "repeater",
    }),

  closeRepeater: () =>
    set({
      showRepeater: false,
      repeaterDetail: null,
      bottomTab: "traffic",
    }),

  setBottomTab: (tab) => set({ bottomTab: tab }),
}));
