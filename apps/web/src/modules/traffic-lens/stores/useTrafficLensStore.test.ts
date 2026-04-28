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
});
