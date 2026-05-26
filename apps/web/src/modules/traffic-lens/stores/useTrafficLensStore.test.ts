import { beforeEach, describe, expect, it } from "vitest";
import { useTrafficLensStore } from "./useTrafficLensStore";
import type {
  TrafficLensEntry,
  TrafficLensPausedRequest,
  TrafficLensTabEvent,
  TrafficLensTabSnapshot,
} from "@fenrir/contracts";

const makeTab = (overrides?: Partial<TrafficLensTabSnapshot>): TrafficLensTabSnapshot => ({
  tabId: "tab-1" as any,
  profileId: "default" as any,
  profileName: "Default",
  url: "https://target.htb",
  title: "Target",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  viewMode: "desktop",
  mobilePreset: "iphone-15-pro",
  ...overrides,
});

const makePaused = (overrides?: Partial<TrafficLensPausedRequest>): TrafficLensPausedRequest => ({
  pauseId: "pause-1" as any,
  tabId: "tab-1",
  requestId: "request-1",
  phase: "beforeRequest",
  method: "POST",
  url: "https://target.htb/api",
  headers: { accept: "application/json" },
  body: null,
  createdAt: "2026-05-25T12:00:00.000Z",
  ...overrides,
});

const makeEntry = (overrides?: Partial<TrafficLensEntry>): TrafficLensEntry => ({
  id: 1,
  tabId: "tab-1",
  requestId: "request-1",
  method: "GET",
  url: "https://target.htb/api",
  host: "target.htb",
  path: "/api",
  statusCode: null,
  contentType: null,
  contentLength: null,
  bodyTruncated: false,
  isWebSocket: false,
  timingStartedAt: "2026-05-25T12:00:00.000Z",
  timingResponseAt: null,
  timingCompletedAt: null,
  createdAt: "2026-05-25T12:00:00.000Z",
  ...overrides,
});

describe("trafficLensStore", () => {
  beforeEach(() => {
    useTrafficLensStore.setState({
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
    });
  });

  it("upserts and updates tabs", () => {
    useTrafficLensStore.getState().upsertTab(makeTab());
    useTrafficLensStore.getState().upsertTab(makeTab({ title: "Updated" }));
    expect(useTrafficLensStore.getState().tabs["tab-1"]!.title).toBe("Updated");
    expect(useTrafficLensStore.getState().activeTabId).toBe("tab-1");
  });

  it("removes tabs and falls back to another active tab", () => {
    useTrafficLensStore.getState().upsertTab(makeTab());
    useTrafficLensStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any, title: "Tab 2" }));
    useTrafficLensStore.getState().setActiveTab("tab-1");
    useTrafficLensStore.getState().removeTab("tab-1");
    expect(useTrafficLensStore.getState().tabs["tab-1"]).toBeUndefined();
    expect(useTrafficLensStore.getState().activeTabId).toBe("tab-2");
  });

  it("applies tab events without mutating unrelated tabs", () => {
    useTrafficLensStore.getState().upsertTab(makeTab());
    useTrafficLensStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any, title: "Tab 2" }));
    useTrafficLensStore.getState().applyEvent({
      type: "tab.titleUpdated",
      tabId: "tab-1",
      title: "Changed",
    } as TrafficLensTabEvent);
    expect(useTrafficLensStore.getState().tabs["tab-1"]!.title).toBe("Changed");
    expect(useTrafficLensStore.getState().tabs["tab-2"]!.title).toBe("Tab 2");
  });

  it("applies tab view mode events to the active tab snapshot", () => {
    useTrafficLensStore.getState().upsertTab(makeTab());

    useTrafficLensStore.getState().applyEvent({
      type: "tab.viewModeChanged",
      tabId: "tab-1",
      viewMode: "mobile",
    } as TrafficLensTabEvent);

    expect(useTrafficLensStore.getState().tabs["tab-1"]!.viewMode).toBe("mobile");
  });

  it("applies tab mobile preset events to the active tab snapshot", () => {
    useTrafficLensStore.getState().upsertTab(makeTab());

    useTrafficLensStore.getState().applyEvent({
      type: "tab.mobilePresetChanged",
      tabId: "tab-1",
      mobilePreset: "pixel-8",
    } as TrafficLensTabEvent);

    expect(useTrafficLensStore.getState().tabs["tab-1"]!.mobilePreset).toBe("pixel-8");
  });

  it("switches to inspector when selecting traffic", () => {
    useTrafficLensStore.getState().setSelectedTraffic(42);
    expect(useTrafficLensStore.getState().selectedTrafficId).toBe(42);
    expect(useTrafficLensStore.getState().dockTab).toBe("inspector");
  });

  it("stores traffic filter state independently from table rendering", () => {
    useTrafficLensStore.getState().setTrafficFilterQuery("graphql");
    useTrafficLensStore.getState().setTrafficFilterMode("api");

    expect(useTrafficLensStore.getState().trafficFilterQuery).toBe("graphql");
    expect(useTrafficLensStore.getState().trafficFilterMode).toBe("api");
  });

  it("hydrates traffic without wiping live entries for the active tab", () => {
    useTrafficLensStore.setState({
      activeTabId: "tab-1",
      trafficEntries: [makeEntry({ id: 42, requestId: "live-42" })],
      selectedTrafficId: 42,
    });

    useTrafficLensStore.getState().hydrateTraffic("tab-1", []);

    expect(useTrafficLensStore.getState().trafficEntries).toEqual([
      makeEntry({ id: 42, requestId: "live-42" }),
    ]);
    expect(useTrafficLensStore.getState().selectedTrafficId).toBe(42);
  });

  it("ignores hydrated traffic snapshots for an inactive tab", () => {
    useTrafficLensStore.setState({
      activeTabId: "tab-1",
      trafficEntries: [makeEntry({ id: 7, requestId: "tab-1-live" })],
    });

    useTrafficLensStore
      .getState()
      .hydrateTraffic("tab-2", [makeEntry({ id: 9, tabId: "tab-2", requestId: "tab-2-db" })]);

    expect(useTrafficLensStore.getState().trafficEntries).toEqual([
      makeEntry({ id: 7, requestId: "tab-1-live" }),
    ]);
  });

  it("prefers more complete hydrated entries when merging by id", () => {
    useTrafficLensStore.setState({
      activeTabId: "tab-1",
      trafficEntries: [makeEntry({ id: 5, requestId: "request-5" })],
    });

    useTrafficLensStore.getState().hydrateTraffic("tab-1", [
      makeEntry({
        id: 5,
        requestId: "request-5",
        statusCode: 200,
        contentType: "application/json",
        contentLength: 128,
        timingResponseAt: "2026-05-25T12:00:00.100Z",
        timingCompletedAt: "2026-05-25T12:00:00.200Z",
      }),
    ]);

    expect(useTrafficLensStore.getState().trafficEntries[0]?.statusCode).toBe(200);
    expect(useTrafficLensStore.getState().trafficEntries[0]?.timingCompletedAt).toBe(
      "2026-05-25T12:00:00.200Z",
    );
  });

  it("opens and closes repeater in the dock", () => {
    useTrafficLensStore
      .getState()
      .openRepeater({ id: 1, method: "GET", url: "https://x.com" } as any);
    expect(useTrafficLensStore.getState().repeaterDetail).not.toBeNull();
    expect(useTrafficLensStore.getState().dockTab).toBe("repeater");
    useTrafficLensStore.getState().closeRepeater();
    expect(useTrafficLensStore.getState().repeaterDetail).toBeNull();
    expect(useTrafficLensStore.getState().dockTab).toBe("traffic");
  });

  it("tracks paused interception requests", () => {
    useTrafficLensStore.getState().upsertPausedRequest(makePaused());
    expect(useTrafficLensStore.getState().selectedPausedId).toBe("pause-1");
    useTrafficLensStore.getState().applyPausedEvent({
      type: "paused.resolved",
      pauseId: "pause-1",
    } as any);
    expect(useTrafficLensStore.getState().pausedRequests["pause-1"]).toBeUndefined();
  });

  it("stores rules, profiles, overrides, and findings as keyed workbench metadata", () => {
    useTrafficLensStore.getState().setRules([
      {
        id: "rule-1",
        name: "Pause API",
        enabled: true,
        phase: "beforeRequest",
        action: "pause",
        scope: {},
        createdAt: "2026-05-25T12:00:00.000Z",
        updatedAt: "2026-05-25T12:00:00.000Z",
      } as any,
    ]);
    useTrafficLensStore.getState().setProfiles([
      {
        id: "default",
        name: "Default",
        partitionKey: "persist:traffic-lens:default",
        createdAt: "2026-05-25T12:00:00.000Z",
        updatedAt: "2026-05-25T12:00:00.000Z",
      } as any,
    ]);
    useTrafficLensStore.getState().setOverrides([
      {
        id: "override-1",
        name: "Mock",
        enabled: true,
        match: {},
        response: { statusCode: 200, headers: {}, body: null },
        createdAt: "2026-05-25T12:00:00.000Z",
        updatedAt: "2026-05-25T12:00:00.000Z",
      } as any,
    ]);
    useTrafficLensStore.getState().appendFinding({
      id: 1,
      kind: "missing-security-header",
      severity: "medium",
      title: "Missing CSP",
      description: "Missing Content-Security-Policy",
      evidenceJson: "{}",
      createdAt: "2026-05-25T12:00:00.000Z",
    } as any);

    const state = useTrafficLensStore.getState();
    expect(state.rules["rule-1"]).toBeDefined();
    expect(state.profiles.default?.name).toBe("Default");
    expect(state.overrides["override-1"]).toBeDefined();
    expect(state.findings).toHaveLength(1);
  });

  it("tracks storage origin metadata and sync state from storage events", () => {
    useTrafficLensStore.getState().applyStorageEvent({
      type: "origin.discovered",
      profileId: "default",
      origin: "https://example.com",
      areaKind: "localStorage",
      timestamp: "2026-05-25T12:00:00.000Z",
    } as any);
    useTrafficLensStore.getState().applyStorageEvent({
      type: "origin.persistenceSyncFailed",
      profileId: "default",
      origin: "https://example.com",
      areaKind: "localStorage",
      timestamp: "2026-05-25T12:00:01.000Z",
      message: "offline",
    } as any);

    const state = useTrafficLensStore.getState();
    expect(state.storageOrigins[0]?.origin).toBe("https://example.com");
    expect(state.storageSyncStateByOrigin["default:https://example.com"]).toBe("unsynced");
  });
});
