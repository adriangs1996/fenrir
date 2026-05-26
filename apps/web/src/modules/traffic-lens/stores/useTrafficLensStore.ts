import { create } from "zustand";
import type {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensCookieEntry,
  TrafficLensDetail,
  TrafficLensDomStorageEntry,
  TrafficLensEntry,
  TrafficLensFinding,
  TrafficLensOverride,
  TrafficLensPausedEvent,
  TrafficLensPausedRequest,
  TrafficLensProfile,
  TrafficLensRule,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageEvent,
  TrafficLensStorageOriginSummary,
  TrafficLensStorageEntry,
  TrafficLensTabEvent,
  TrafficLensTabSnapshot,
} from "@fenrir/contracts";
import { mergeTrafficEntriesForTab } from "../trafficEntryMerge";
import type { TrafficLensTrafficFilterMode } from "../trafficFilters";

export type TrafficLensDockTab =
  | "traffic"
  | "inspector"
  | "repeater"
  | "intercept"
  | "overrides"
  | "storage"
  | "profiles"
  | "findings";

export type TrafficLensStoragePanelArea = "cookies" | "localStorage" | "sessionStorage" | "history";

type TrafficLensStorageSyncState = "idle" | "refreshing" | "unsynced" | "error";

interface TrafficLensState {
  tabs: Record<string, TrafficLensTabSnapshot>;
  activeTabId: string | null;
  trafficEntries: TrafficLensEntry[];
  trafficFilterQuery: string;
  trafficFilterMode: TrafficLensTrafficFilterMode;
  selectedTrafficId: number | null;
  repeaterDetail: TrafficLensDetail | null;
  dockTab: TrafficLensDockTab;
  pausedRequests: Record<string, TrafficLensPausedRequest>;
  selectedPausedId: string | null;
  rules: Record<string, TrafficLensRule>;
  overrides: Record<string, TrafficLensOverride>;
  profiles: Record<string, TrafficLensProfile>;
  selectedProfileId: string;
  findings: TrafficLensFinding[];
  cookies: TrafficLensCookieEntry[];
  storageEntries: TrafficLensStorageEntry[];
  storageOrigins: TrafficLensStorageOriginSummary[];
  selectedStorageOrigin: string | null;
  selectedStorageArea: TrafficLensStoragePanelArea;
  cookieEntries: TrafficLensCookieEntry[];
  localStorageEntries: TrafficLensDomStorageEntry[];
  liveSessionStorageEntries: TrafficLensDomStorageEntry[];
  archivedSessionSnapshots: TrafficLensArchivedSessionStorageSummary[];
  selectedSessionSnapshotId: number | null;
  storageHistory: TrafficLensStorageAreaVersion[];
  storageSyncStateByOrigin: Record<string, TrafficLensStorageSyncState>;
  dockHeight: number;
  dockCollapsed: boolean;

  upsertTab: (snapshot: TrafficLensTabSnapshot) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  applyEvent: (event: TrafficLensTabEvent) => void;
  appendTraffic: (entry: TrafficLensEntry) => void;
  hydrateTraffic: (tabId: string, entries: readonly TrafficLensEntry[]) => void;
  clearTraffic: () => void;
  setTrafficFilterQuery: (query: string) => void;
  setTrafficFilterMode: (mode: TrafficLensTrafficFilterMode) => void;
  setSelectedTraffic: (id: number | null) => void;
  openRepeater: (detail: TrafficLensDetail) => void;
  closeRepeater: () => void;
  setDockTab: (tab: TrafficLensDockTab) => void;
  upsertPausedRequest: (paused: TrafficLensPausedRequest) => void;
  removePausedRequest: (pauseId: string) => void;
  applyPausedEvent: (event: TrafficLensPausedEvent) => void;
  setSelectedPausedRequest: (pauseId: string | null) => void;
  setRules: (rules: readonly TrafficLensRule[]) => void;
  setOverrides: (overrides: readonly TrafficLensOverride[]) => void;
  setProfiles: (profiles: readonly TrafficLensProfile[]) => void;
  setFindings: (findings: readonly TrafficLensFinding[]) => void;
  appendFinding: (finding: TrafficLensFinding) => void;
  setSelectedProfile: (profileId: string) => void;
  setCookies: (cookies: readonly TrafficLensCookieEntry[]) => void;
  setStorageEntries: (entries: readonly TrafficLensStorageEntry[]) => void;
  setStorageOrigins: (origins: readonly TrafficLensStorageOriginSummary[]) => void;
  setSelectedStorageOrigin: (origin: string | null) => void;
  setSelectedStorageArea: (area: TrafficLensStoragePanelArea) => void;
  setCookieEntries: (entries: readonly TrafficLensCookieEntry[]) => void;
  setLocalStorageEntries: (entries: readonly TrafficLensDomStorageEntry[]) => void;
  setLiveSessionStorageEntries: (entries: readonly TrafficLensDomStorageEntry[]) => void;
  setArchivedSessionSnapshots: (
    snapshots: readonly TrafficLensArchivedSessionStorageSummary[],
  ) => void;
  setSelectedSessionSnapshotId: (versionId: number | null) => void;
  setStorageHistory: (versions: readonly TrafficLensStorageAreaVersion[]) => void;
  applyStorageEvent: (event: TrafficLensStorageEvent) => void;
  setDockHeight: (height: number) => void;
  setDockCollapsed: (collapsed: boolean) => void;
}

export const useTrafficLensStore = create<TrafficLensState>((set) => ({
  tabs: {},
  activeTabId: null,
  trafficEntries: [],
  trafficFilterQuery: "",
  trafficFilterMode: "focus",
  selectedTrafficId: null,
  repeaterDetail: null,
  dockTab: "traffic",
  pausedRequests: {},
  selectedPausedId: null,
  rules: {},
  overrides: {},
  profiles: {},
  selectedProfileId: "default",
  findings: [],
  cookies: [],
  storageEntries: [],
  storageOrigins: [],
  selectedStorageOrigin: null,
  selectedStorageArea: "cookies",
  cookieEntries: [],
  localStorageEntries: [],
  liveSessionStorageEntries: [],
  archivedSessionSnapshots: [],
  selectedSessionSnapshotId: null,
  storageHistory: [],
  storageSyncStateByOrigin: {},
  dockHeight: 320,
  dockCollapsed: false,

  upsertTab: (snapshot) =>
    set((state) => ({
      tabs: { ...state.tabs, [snapshot.tabId]: snapshot },
      activeTabId: state.activeTabId ?? snapshot.tabId,
    })),

  removeTab: (tabId) =>
    set((state) => {
      const { [tabId]: _removedTab, ...restTabs } = state.tabs;
      return {
        tabs: restTabs,
        activeTabId:
          state.activeTabId === tabId ? (Object.keys(restTabs)[0] ?? null) : state.activeTabId,
      };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "tab.created":
          return {
            tabs: { ...state.tabs, [event.snapshot.tabId]: event.snapshot },
            activeTabId: state.activeTabId ?? event.snapshot.tabId,
          };
        case "tab.closed": {
          const { [event.tabId]: _closedTab, ...restTabs } = state.tabs;
          return {
            tabs: restTabs,
            activeTabId:
              state.activeTabId === event.tabId
                ? (Object.keys(restTabs)[0] ?? null)
                : state.activeTabId,
          };
        }
        case "tab.navigated": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return { tabs: { ...state.tabs, [event.tabId]: { ...existing, url: event.url } } };
        }
        case "tab.titleUpdated": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return { tabs: { ...state.tabs, [event.tabId]: { ...existing, title: event.title } } };
        }
        case "tab.loadingChanged": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: { ...state.tabs, [event.tabId]: { ...existing, loading: event.loading } },
          };
        }
        case "tab.viewModeChanged": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: { ...state.tabs, [event.tabId]: { ...existing, viewMode: event.viewMode } },
          };
        }
        case "tab.mobilePresetChanged": {
          const existing = state.tabs[event.tabId];
          if (!existing) return state;
          return {
            tabs: {
              ...state.tabs,
              [event.tabId]: { ...existing, mobilePreset: event.mobilePreset },
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
        (candidate) => candidate.id === entry.id,
      );
      if (existingIndex >= 0) {
        const nextEntries = [...state.trafficEntries];
        nextEntries[existingIndex] = entry;
        return { trafficEntries: nextEntries };
      }
      return { trafficEntries: [entry, ...state.trafficEntries] };
    }),

  hydrateTraffic: (tabId, entries) =>
    set((state) => {
      if (state.activeTabId !== tabId) {
        return state;
      }

      const mergedEntries = mergeTrafficEntriesForTab(tabId, state.trafficEntries, entries);
      return {
        trafficEntries: mergedEntries,
        selectedTrafficId:
          state.selectedTrafficId !== null &&
          mergedEntries.some((entry) => entry.id === state.selectedTrafficId)
            ? state.selectedTrafficId
            : null,
      };
    }),

  clearTraffic: () => set({ trafficEntries: [], selectedTrafficId: null, findings: [] }),

  setTrafficFilterQuery: (query) => set({ trafficFilterQuery: query }),

  setTrafficFilterMode: (mode) => set({ trafficFilterMode: mode }),

  setSelectedTraffic: (id) =>
    set({
      selectedTrafficId: id,
      dockTab: id === null ? "traffic" : "inspector",
    }),

  openRepeater: (detail) =>
    set({
      repeaterDetail: detail,
      dockTab: "repeater",
    }),

  closeRepeater: () =>
    set({
      repeaterDetail: null,
      dockTab: "traffic",
    }),

  setDockTab: (tab) => set({ dockTab: tab }),

  upsertPausedRequest: (paused) =>
    set((state) => ({
      pausedRequests: { ...state.pausedRequests, [paused.pauseId]: paused },
      selectedPausedId: state.selectedPausedId ?? paused.pauseId,
    })),

  removePausedRequest: (pauseId) =>
    set((state) => {
      const { [pauseId]: _removedPause, ...restPaused } = state.pausedRequests;
      return {
        pausedRequests: restPaused,
        selectedPausedId:
          state.selectedPausedId === pauseId
            ? (Object.keys(restPaused)[0] ?? null)
            : state.selectedPausedId,
      };
    }),

  applyPausedEvent: (event) =>
    set((state) => {
      if (event.type === "paused.created") {
        return {
          pausedRequests: { ...state.pausedRequests, [event.paused.pauseId]: event.paused },
          selectedPausedId: state.selectedPausedId ?? event.paused.pauseId,
          dockTab: "intercept",
        };
      }

      const { [event.pauseId]: _resolvedPause, ...restPaused } = state.pausedRequests;
      return {
        pausedRequests: restPaused,
        selectedPausedId:
          state.selectedPausedId === event.pauseId
            ? (Object.keys(restPaused)[0] ?? null)
            : state.selectedPausedId,
      };
    }),

  setSelectedPausedRequest: (pauseId) => set({ selectedPausedId: pauseId, dockTab: "intercept" }),

  setRules: (rules) =>
    set({
      rules: Object.fromEntries(rules.map((rule) => [rule.id, rule])),
    }),

  setOverrides: (overrides) =>
    set({
      overrides: Object.fromEntries(overrides.map((override) => [override.id, override])),
    }),

  setProfiles: (profiles) =>
    set((state) => ({
      profiles: Object.fromEntries(profiles.map((profile) => [profile.id, profile])),
      selectedProfileId:
        state.selectedProfileId &&
        profiles.some((profile) => profile.id === state.selectedProfileId)
          ? state.selectedProfileId
          : (profiles[0]?.id ?? "default"),
    })),

  setFindings: (findings) => set({ findings: [...findings] }),

  appendFinding: (finding) =>
    set((state) => ({
      findings: [finding, ...state.findings.filter((candidate) => candidate.id !== finding.id)],
    })),

  setSelectedProfile: (profileId) => set({ selectedProfileId: profileId }),

  setCookies: (cookies) => set({ cookies: [...cookies] }),

  setStorageEntries: (entries) => set({ storageEntries: [...entries] }),

  setStorageOrigins: (origins) =>
    set((state) => ({
      storageOrigins: [...origins],
      selectedStorageOrigin:
        state.selectedStorageOrigin &&
        origins.some((origin) => origin.origin === state.selectedStorageOrigin)
          ? state.selectedStorageOrigin
          : (origins[0]?.origin ?? null),
    })),

  setSelectedStorageOrigin: (origin) => set({ selectedStorageOrigin: origin }),

  setSelectedStorageArea: (area) => set({ selectedStorageArea: area }),

  setCookieEntries: (entries) => set({ cookieEntries: [...entries] }),

  setLocalStorageEntries: (entries) => set({ localStorageEntries: [...entries] }),

  setLiveSessionStorageEntries: (entries) => set({ liveSessionStorageEntries: [...entries] }),

  setArchivedSessionSnapshots: (snapshots) =>
    set((state) => ({
      archivedSessionSnapshots: [...snapshots],
      selectedSessionSnapshotId:
        state.selectedSessionSnapshotId !== null &&
        snapshots.some((snapshot) => snapshot.versionId === state.selectedSessionSnapshotId)
          ? state.selectedSessionSnapshotId
          : (snapshots[0]?.versionId ?? null),
    })),

  setSelectedSessionSnapshotId: (versionId) => set({ selectedSessionSnapshotId: versionId }),

  setStorageHistory: (versions) => set({ storageHistory: [...versions] }),

  applyStorageEvent: (event) =>
    set((state) => {
      const storageKey = `${event.profileId}:${event.origin}`;
      const matchingOriginIndex = state.storageOrigins.findIndex(
        (origin) => origin.profileId === event.profileId && origin.origin === event.origin,
      );
      const nextOrigins =
        event.type === "origin.discovered" && matchingOriginIndex === -1
          ? [
              {
                profileId: event.profileId,
                origin: event.origin,
                lastDocumentUrl: null,
                firstSeenAt: event.timestamp,
                lastSeenAt: event.timestamp,
                latestCookieVersionId: null,
                latestLocalStorageVersionId: null,
                latestSessionStorageVersionId: null,
                hasLiveSessionStorage: false,
                liveSessionTabIds: [],
              },
              ...state.storageOrigins,
            ]
          : matchingOriginIndex >= 0
            ? state.storageOrigins.map((origin, index) =>
                index === matchingOriginIndex
                  ? {
                      ...origin,
                      lastSeenAt: event.timestamp,
                      hasLiveSessionStorage:
                        event.type === "sessionStorage.liveUpdated"
                          ? true
                          : origin.hasLiveSessionStorage,
                      liveSessionTabIds:
                        event.type === "sessionStorage.liveUpdated" && event.tabId
                          ? Array.from(new Set([...origin.liveSessionTabIds, event.tabId]))
                          : origin.liveSessionTabIds,
                    }
                  : origin,
              )
            : state.storageOrigins;

      return {
        storageOrigins: nextOrigins,
        storageSyncStateByOrigin: {
          ...state.storageSyncStateByOrigin,
          [storageKey]: event.type === "origin.persistenceSyncFailed" ? "unsynced" : "idle",
        },
      };
    }),

  setDockHeight: (height) => set({ dockHeight: height }),

  setDockCollapsed: (collapsed) => set({ dockCollapsed: collapsed }),
}));
