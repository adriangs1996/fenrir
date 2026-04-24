import { create } from "zustand";
import type { BrowserTabSnapshot, BrowserTabEvent, BrowserTrafficEntry } from "@fenrir/contracts";

interface BrowserState {
  tabs: Record<string, BrowserTabSnapshot>;
  activeTabId: string | null;
  trafficEntries: BrowserTrafficEntry[];

  // Actions
  upsertTab: (snapshot: BrowserTabSnapshot) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  applyEvent: (event: BrowserTabEvent) => void;
  appendTraffic: (entry: BrowserTrafficEntry) => void;
  clearTraffic: () => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: {},
  activeTabId: null,
  trafficEntries: [],

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
            activeTabId:
              state.activeTabId === event.tabId ? null : state.activeTabId,
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
      const existingIndex = state.trafficEntries.findIndex(
        (e) => e.requestId === entry.requestId,
      );
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
}));
