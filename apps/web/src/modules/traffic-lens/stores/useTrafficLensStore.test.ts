import { describe, expect, it, beforeEach } from "vitest";
import { useTrafficLensStore } from "./useTrafficLensStore";
import type { TrafficLensTabSnapshot, TrafficLensTabEvent } from "@fenrir/contracts";

const makeTab = (overrides?: Partial<TrafficLensTabSnapshot>): TrafficLensTabSnapshot => ({
  tabId: "tab-1" as any,
  url: "https://target.htb",
  title: "Target",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...overrides,
});

describe("trafficLensStore", () => {
  beforeEach(() => {
    useTrafficLensStore.setState({
      tabs: {},
      activeTabId: null,
      selectedTrafficId: null,
      repeaterDetail: null,
      showRepeater: false,
      bottomTab: "traffic",
    });
  });

  describe("upsertTab", () => {
    it("adds new tab", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      expect(useTrafficLensStore.getState().tabs["tab-1"]).toBeDefined();
    });

    it("updates existing tab", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().upsertTab(makeTab({ title: "Updated" }));
      expect(useTrafficLensStore.getState().tabs["tab-1"]!.title).toBe("Updated");
    });
  });

  describe("removeTab", () => {
    it("removes tab from record", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().removeTab("tab-1");
      expect(useTrafficLensStore.getState().tabs["tab-1"]).toBeUndefined();
    });

    it("clears activeTabId if removed tab was active", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().setActiveTab("tab-1");
      useTrafficLensStore.getState().removeTab("tab-1");
      expect(useTrafficLensStore.getState().activeTabId).toBeNull();
    });

    it("preserves activeTabId if different tab removed", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any }));
      useTrafficLensStore.getState().setActiveTab("tab-1");
      useTrafficLensStore.getState().removeTab("tab-2");
      expect(useTrafficLensStore.getState().activeTabId).toBe("tab-1");
    });
  });

  describe("applyEvent", () => {
    it("handles tab.created", () => {
      useTrafficLensStore.getState().applyEvent({
        type: "tab.created",
        snapshot: makeTab(),
      } as TrafficLensTabEvent);
      expect(useTrafficLensStore.getState().tabs["tab-1"]).toBeDefined();
    });

    it("handles tab.closed", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().applyEvent({
        type: "tab.closed",
        tabId: "tab-1",
      } as any);
      expect(useTrafficLensStore.getState().tabs["tab-1"]).toBeUndefined();
    });

    it("handles tab.navigated", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().applyEvent({
        type: "tab.navigated",
        tabId: "tab-1",
        url: "https://new-url.htb",
      } as any);
      expect(useTrafficLensStore.getState().tabs["tab-1"]!.url).toBe("https://new-url.htb");
    });

    it("handles tab.titleUpdated", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().applyEvent({
        type: "tab.titleUpdated",
        tabId: "tab-1",
        title: "New Title",
      } as any);
      expect(useTrafficLensStore.getState().tabs["tab-1"]!.title).toBe("New Title");
    });

    it("handles tab.loadingChanged", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().applyEvent({
        type: "tab.loadingChanged",
        tabId: "tab-1",
        loading: true,
      } as any);
      expect(useTrafficLensStore.getState().tabs["tab-1"]!.loading).toBe(true);
    });

    it("ignores events for nonexistent tabs without crashing", () => {
      expect(() =>
        useTrafficLensStore.getState().applyEvent({
          type: "tab.navigated",
          tabId: "nonexistent",
          url: "https://x.com",
        } as any),
      ).not.toThrow();
    });

    it("does not mutate other tabs when updating one", () => {
      useTrafficLensStore.getState().upsertTab(makeTab());
      useTrafficLensStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any, title: "Tab 2" }));
      useTrafficLensStore.getState().applyEvent({
        type: "tab.titleUpdated",
        tabId: "tab-1",
        title: "Changed",
      } as any);
      expect(useTrafficLensStore.getState().tabs["tab-2"]!.title).toBe("Tab 2");
    });
  });

  describe("inspector/repeater state", () => {
    describe("setSelectedTraffic", () => {
      it("sets selectedTrafficId and switches to inspector tab", () => {
        useTrafficLensStore.getState().setSelectedTraffic(42);
        const state = useTrafficLensStore.getState();
        expect(state.selectedTrafficId).toBe(42);
        expect(state.bottomTab).toBe("inspector");
      });

      it("clears to traffic tab with null", () => {
        useTrafficLensStore.getState().setSelectedTraffic(42);
        useTrafficLensStore.getState().setSelectedTraffic(null);
        const state = useTrafficLensStore.getState();
        expect(state.selectedTrafficId).toBeNull();
        expect(state.bottomTab).toBe("traffic");
      });
    });

    describe("openRepeater", () => {
      it("sets repeater state and switches tab", () => {
        const detail = { id: 1, method: "GET", url: "https://x.com" } as any;
        useTrafficLensStore.getState().openRepeater(detail);
        const state = useTrafficLensStore.getState();
        expect(state.showRepeater).toBe(true);
        expect(state.repeaterDetail).toBe(detail);
        expect(state.bottomTab).toBe("repeater");
      });
    });

    describe("closeRepeater", () => {
      it("clears repeater state and returns to traffic", () => {
        useTrafficLensStore.getState().openRepeater({ id: 1 } as any);
        useTrafficLensStore.getState().closeRepeater();
        const state = useTrafficLensStore.getState();
        expect(state.showRepeater).toBe(false);
        expect(state.repeaterDetail).toBeNull();
        expect(state.bottomTab).toBe("traffic");
      });
    });

    describe("setBottomTab", () => {
      it("switches tab", () => {
        useTrafficLensStore.getState().setBottomTab("repeater");
        expect(useTrafficLensStore.getState().bottomTab).toBe("repeater");
      });
    });
  });
});
