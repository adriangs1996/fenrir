import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Fake WebContentsView and session ---
const { fakeSession, fakeWebContents, mockWebContentsView } = vi.hoisted(
  () => {
    const fakeWebContents = {
      loadURL: vi.fn(),
      getURL: vi.fn(() => "about:blank"),
      getTitle: vi.fn(() => ""),
      isLoading: vi.fn(() => false),
      close: vi.fn(),
      reload: vi.fn(),
      on: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
      debugger: {
        attach: vi.fn(),
        sendCommand: vi.fn(),
        on: vi.fn(),
      },
    };

    const fakeView = {
      webContents: fakeWebContents,
      setBounds: vi.fn(),
    };

    // Regular function (not arrow) so `new` works
    const mockWebContentsView = vi.fn(function (_opts: any) {
      return fakeView;
    });

    const fakeSession = {
      setCertificateVerifyProc: vi.fn(),
      setUserAgent: vi.fn(),
      cookies: {
        get: vi.fn(() => Promise.resolve([])),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      },
      webRequest: {
        onHeadersReceived: vi.fn(),
        onBeforeSendHeaders: vi.fn(),
      },
    };

    return { fakeSession, fakeWebContents, mockWebContentsView };
  },
);

vi.mock("electron", () => ({
  WebContentsView: mockWebContentsView,
  session: {
    fromPartition: vi.fn(() => fakeSession),
  },
}));

import { createTrafficLensManager, type TrafficLensManager } from "./trafficLensManager";

describe("trafficLensManager", () => {
  const fakeWindow = {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  } as any;

  let manager: TrafficLensManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createTrafficLensManager({ window: fakeWindow });
  });

  describe("createTrafficLensManager", () => {
    it("creates isolated session partition", async () => {
      const electron = await import("electron");
      expect(electron.session.fromPartition).toHaveBeenCalledWith(
        "persist:target-browsing",
      );
    });

    it("accepts all certificates in target session", () => {
      expect(fakeSession.setCertificateVerifyProc).toHaveBeenCalledWith(
        expect.any(Function),
      );
      // Call the proc and verify it accepts (calls callback with 0)
      const proc = fakeSession.setCertificateVerifyProc.mock.calls[0]![0];
      const callback = vi.fn();
      proc({}, callback);
      expect(callback).toHaveBeenCalledWith(0);
    });

    it("sets a non-default user agent", () => {
      expect(fakeSession.setUserAgent).toHaveBeenCalled();
      const ua = fakeSession.setUserAgent.mock.calls[0]![0];
      expect(ua).toContain("Chrome");
      expect(ua).not.toContain("Electron");
    });
  });

  describe("createTab", () => {
    it("returns a TrafficLensTabSnapshot with generated tabId", () => {
      const snapshot = manager.createTab();
      expect(snapshot.tabId).toBeDefined();
      expect(typeof snapshot.tabId).toBe("string");
      expect(snapshot.url).toBe("about:blank");
    });

    it("creates WebContentsView with correct preferences", () => {
      manager.createTab();
      expect(mockWebContentsView).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            partition: "persist:target-browsing",
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: false,
          }),
        }),
      );
    });

    it("loads provided URL", () => {
      manager.createTab("https://10.10.10.1");
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith(
        "https://10.10.10.1",
      );
    });

    it("loads about:blank when no URL provided", () => {
      manager.createTab();
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("about:blank");
    });

    it("emits tab.created event", () => {
      const listener = vi.fn();
      manager.onTabEvent(listener);
      manager.createTab();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tab.created" }),
      );
    });

    it("registers navigation event listeners on webContents", () => {
      manager.createTab();
      const eventNames = fakeWebContents.on.mock.calls.map(
        (c: any) => c[0],
      );
      expect(eventNames).toContain("did-navigate");
      expect(eventNames).toContain("did-navigate-in-page");
      expect(eventNames).toContain("page-title-updated");
      expect(eventNames).toContain("did-start-loading");
      expect(eventNames).toContain("did-stop-loading");
    });
  });

  describe("closeTab", () => {
    it("removes view from window and closes webContents", () => {
      const snapshot = manager.createTab();
      manager.closeTab(snapshot.tabId);
      expect(fakeWebContents.close).toHaveBeenCalled();
    });

    it("emits tab.closed event", () => {
      const listener = vi.fn();
      manager.onTabEvent(listener);
      const snapshot = manager.createTab();
      listener.mockClear();
      manager.closeTab(snapshot.tabId);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tab.closed", tabId: snapshot.tabId }),
      );
    });

    it("does not throw for unknown tabId", () => {
      expect(() => manager.closeTab("nonexistent")).not.toThrow();
    });
  });

  describe("navigateTab", () => {
    it("calls loadURL on the tab's webContents", () => {
      const snapshot = manager.createTab();
      manager.navigateTab(snapshot.tabId, "https://target.htb");
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith(
        "https://target.htb",
      );
    });

    it("throws for unknown tabId", () => {
      expect(() => manager.navigateTab("nonexistent", "https://x.com")).toThrow();
    });
  });

  describe("goBack / goForward / reloadTab", () => {
    it("calls navigationHistory.goBack", () => {
      const snapshot = manager.createTab();
      manager.goBack(snapshot.tabId);
      expect(fakeWebContents.navigationHistory.goBack).toHaveBeenCalled();
    });

    it("calls navigationHistory.goForward", () => {
      const snapshot = manager.createTab();
      manager.goForward(snapshot.tabId);
      expect(fakeWebContents.navigationHistory.goForward).toHaveBeenCalled();
    });

    it("calls webContents.reload", () => {
      const snapshot = manager.createTab();
      manager.reloadTab(snapshot.tabId);
      expect(fakeWebContents.reload).toHaveBeenCalled();
    });
  });

  describe("getTabs", () => {
    it("returns empty array when no tabs", () => {
      expect(manager.getTabs()).toEqual([]);
    });

    it("returns snapshots for all open tabs", () => {
      manager.createTab("https://a.com");
      manager.createTab("https://b.com");
      const tabs = manager.getTabs();
      expect(tabs).toHaveLength(2);
    });
  });

  describe("setTabBounds", () => {
    it("calls setBounds on the view", () => {
      const snapshot = manager.createTab();
      manager.setTabBounds(snapshot.tabId, { x: 10, y: 20, width: 800, height: 600 });
      const view = mockWebContentsView.mock.results[0]!.value;
      expect(view.setBounds).toHaveBeenCalledWith({
        x: 10,
        y: 20,
        width: 800,
        height: 600,
      });
    });

    it("silently ignores unknown tabId", () => {
      expect(() =>
        manager.setTabBounds("nope", { x: 0, y: 0, width: 100, height: 100 }),
      ).not.toThrow();
    });
  });

  describe("showTab / hideAllTabs", () => {
    it("adds view to parent window contentView", () => {
      const snapshot = manager.createTab();
      manager.showTab(snapshot.tabId);
      expect(fakeWindow.contentView.addChildView).toHaveBeenCalled();
    });

    it("removes all views on hideAllTabs", () => {
      manager.createTab();
      manager.createTab();
      manager.hideAllTabs();
      expect(fakeWindow.contentView.removeChildView).toHaveBeenCalled();
    });
  });

  describe("event listener management", () => {
    it("unsubscribe removes listener", () => {
      const listener = vi.fn();
      const unsub = manager.onTabEvent(listener);
      manager.createTab();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      listener.mockClear();
      manager.createTab();
      expect(listener).not.toHaveBeenCalled();
    });

    it("swallows listener errors without crashing", () => {
      manager.onTabEvent(() => {
        throw new Error("listener boom");
      });
      expect(() => manager.createTab()).not.toThrow();
    });
  });

  describe("stop", () => {
    it("closes all tabs and clears state", () => {
      manager.createTab();
      manager.createTab();
      manager.stop();
      expect(manager.getTabs()).toEqual([]);
    });
  });
});
