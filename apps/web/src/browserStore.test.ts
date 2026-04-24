import { describe, expect, it, beforeEach } from "vitest";
import { useBrowserStore } from "./browserStore";
import type { BrowserTabSnapshot, BrowserTabEvent } from "@fenrir/contracts";

const makeTab = (
  overrides?: Partial<BrowserTabSnapshot>,
): BrowserTabSnapshot => ({
  tabId: "tab-1" as any,
  url: "https://target.htb",
  title: "Target",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...overrides,
});

describe("browserStore", () => {
  beforeEach(() => {
    useBrowserStore.setState({
      tabs: {},
      activeTabId: null,
    });
  });

  describe("upsertTab", () => {
    it("adds new tab", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      expect(useBrowserStore.getState().tabs["tab-1"]).toBeDefined();
    });

    it("updates existing tab", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().upsertTab(makeTab({ title: "Updated" }));
      expect(useBrowserStore.getState().tabs["tab-1"].title).toBe("Updated");
    });
  });

  describe("removeTab", () => {
    it("removes tab from record", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().removeTab("tab-1");
      expect(useBrowserStore.getState().tabs["tab-1"]).toBeUndefined();
    });

    it("clears activeTabId if removed tab was active", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().setActiveTab("tab-1");
      useBrowserStore.getState().removeTab("tab-1");
      expect(useBrowserStore.getState().activeTabId).toBeNull();
    });

    it("preserves activeTabId if different tab removed", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore
        .getState()
        .upsertTab(makeTab({ tabId: "tab-2" as any }));
      useBrowserStore.getState().setActiveTab("tab-1");
      useBrowserStore.getState().removeTab("tab-2");
      expect(useBrowserStore.getState().activeTabId).toBe("tab-1");
    });
  });

  describe("applyEvent", () => {
    it("handles tab.created", () => {
      useBrowserStore.getState().applyEvent({
        type: "tab.created",
        snapshot: makeTab(),
      } as BrowserTabEvent);
      expect(useBrowserStore.getState().tabs["tab-1"]).toBeDefined();
    });

    it("handles tab.closed", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().applyEvent({
        type: "tab.closed",
        tabId: "tab-1",
      } as any);
      expect(useBrowserStore.getState().tabs["tab-1"]).toBeUndefined();
    });

    it("handles tab.navigated", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().applyEvent({
        type: "tab.navigated",
        tabId: "tab-1",
        url: "https://new-url.htb",
      } as any);
      expect(useBrowserStore.getState().tabs["tab-1"].url).toBe(
        "https://new-url.htb",
      );
    });

    it("handles tab.titleUpdated", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().applyEvent({
        type: "tab.titleUpdated",
        tabId: "tab-1",
        title: "New Title",
      } as any);
      expect(useBrowserStore.getState().tabs["tab-1"].title).toBe("New Title");
    });

    it("handles tab.loadingChanged", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore.getState().applyEvent({
        type: "tab.loadingChanged",
        tabId: "tab-1",
        loading: true,
      } as any);
      expect(useBrowserStore.getState().tabs["tab-1"].loading).toBe(true);
    });

    it("ignores events for nonexistent tabs without crashing", () => {
      expect(() =>
        useBrowserStore.getState().applyEvent({
          type: "tab.navigated",
          tabId: "nonexistent",
          url: "https://x.com",
        } as any),
      ).not.toThrow();
    });

    it("does not mutate other tabs when updating one", () => {
      useBrowserStore.getState().upsertTab(makeTab());
      useBrowserStore
        .getState()
        .upsertTab(makeTab({ tabId: "tab-2" as any, title: "Tab 2" }));
      useBrowserStore.getState().applyEvent({
        type: "tab.titleUpdated",
        tabId: "tab-1",
        title: "Changed",
      } as any);
      expect(useBrowserStore.getState().tabs["tab-2"].title).toBe("Tab 2");
    });
  });
});
