import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

// --- Fake WebContentsView and session ---
const { fakeSession, fakeWebContents, mockWebContentsView } = vi.hoisted(() => {
  const fakeWebContents = {
    loadURL: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve([])),
    setUserAgent: vi.fn(),
    getURL: vi.fn(() => "about:blank"),
    getTitle: vi.fn(() => ""),
    isLoading: vi.fn(() => false),
    close: vi.fn(),
    focus: vi.fn(),
    reload: vi.fn(),
    on: vi.fn(),
    sendInputEvent: vi.fn(),
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
});

vi.mock("electron", () => ({
  WebContentsView: mockWebContentsView,
  session: {
    fromPartition: vi.fn(() => fakeSession),
  },
}));

import { createTrafficLensManager, type TrafficLensManager } from "./trafficLensManager";

function makeTempPath(fileName: string): string {
  return Path.join(FS.mkdtempSync(Path.join(OS.tmpdir(), "fenrir-traffic-lens-")), fileName);
}

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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createTrafficLensManager", () => {
    it("creates isolated session partition", async () => {
      manager.createTab();
      const electron = await import("electron");
      expect(electron.session.fromPartition).toHaveBeenCalledWith("persist:traffic-lens:default");
    });

    it("accepts all certificates in target session", () => {
      manager.createTab();
      expect(fakeSession.setCertificateVerifyProc).toHaveBeenCalledWith(expect.any(Function));
      // Call the proc and verify it accepts (calls callback with 0)
      const proc = fakeSession.setCertificateVerifyProc.mock.calls[0]![0];
      const callback = vi.fn();
      proc({}, callback);
      expect(callback).toHaveBeenCalledWith(0);
    });

    it("sets a non-default user agent", () => {
      manager.createTab();
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
      expect(snapshot.profileId).toBe("default");
      expect(snapshot.viewMode).toBe("desktop");
      expect(snapshot.mobilePreset).toBe("iphone-15-pro");
    });

    it("creates WebContentsView with correct preferences", () => {
      manager.createTab();
      expect(mockWebContentsView).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            partition: "persist:traffic-lens:default",
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
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://10.10.10.1");
    });

    it("loads about:blank when no URL provided", () => {
      manager.createTab();
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("about:blank");
    });

    it("emits tab.created event", () => {
      const listener = vi.fn();
      manager.onTabEvent(listener);
      manager.createTab();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "tab.created" }));
    });

    it("registers navigation event listeners on webContents", () => {
      manager.createTab();
      const eventNames = fakeWebContents.on.mock.calls.map((c: any) => c[0]);
      expect(eventNames).toContain("did-navigate");
      expect(eventNames).toContain("did-navigate-in-page");
      expect(eventNames).toContain("page-title-updated");
      expect(eventNames).toContain("did-start-loading");
      expect(eventNames).toContain("did-stop-loading");
    });
  });

  describe("tab session persistence", () => {
    it("persists open tabs with the latest requested URL", () => {
      const tabSessionPath = makeTempPath("browser-lab-tabs.json");
      manager = createTrafficLensManager({ window: fakeWindow, tabSessionPath });

      const snapshot = manager.createTab("https://example.test");
      manager.navigateTab(snapshot.tabId, "https://target.test/path");

      const persisted = JSON.parse(FS.readFileSync(tabSessionPath, "utf8"));
      expect(persisted).toMatchObject({
        version: 1,
        activeTabId: snapshot.tabId,
        tabs: [
          {
            tabId: snapshot.tabId,
            url: "https://target.test/path",
            profile: {
              id: "default",
              partitionKey: "persist:traffic-lens:default",
            },
            viewMode: "desktop",
            mobilePreset: "iphone-15-pro",
          },
        ],
      });
    });

    it("restores persisted tabs and returns the active tab first", () => {
      const tabSessionPath = makeTempPath("browser-lab-tabs.json");
      FS.writeFileSync(
        tabSessionPath,
        JSON.stringify({
          version: 1,
          activeTabId: "tab-two",
          tabs: [
            {
              tabId: "tab-one",
              url: "https://one.test",
              profile: {
                id: "default",
                name: "Default",
                partitionKey: "persist:traffic-lens:default",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              viewMode: "desktop",
              mobilePreset: "iphone-15-pro",
            },
            {
              tabId: "tab-two",
              url: "https://two.test",
              profile: {
                id: "default",
                name: "Default",
                partitionKey: "persist:traffic-lens:default",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              viewMode: "mobile",
              mobilePreset: "pixel-8",
            },
          ],
        }),
        "utf8",
      );

      manager = createTrafficLensManager({ window: fakeWindow, tabSessionPath });

      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://one.test");
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://two.test");
      expect(manager.getTabs().map((tab) => tab.tabId)).toEqual(["tab-two", "tab-one"]);
      expect(manager.getTabs().map((tab) => tab.url)).toEqual([
        "https://two.test",
        "https://one.test",
      ]);
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
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://target.htb");
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

  describe("setTabViewMode", () => {
    it("switches the tab snapshot to mobile and reloads the page", () => {
      const snapshot = manager.createTab("https://target.htb");
      fakeWebContents.reload.mockClear();
      fakeWebContents.setUserAgent.mockClear();

      const updated = manager.setTabViewMode({ tabId: snapshot.tabId, viewMode: "mobile" });

      expect(updated.viewMode).toBe("mobile");
      expect(fakeWebContents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining("iPhone"));
      expect(fakeWebContents.reload).toHaveBeenCalledTimes(1);
    });

    it("switches back to desktop mode and emits a tab event", () => {
      const listener = vi.fn();
      manager.onTabEvent(listener);
      const snapshot = manager.createTab("https://target.htb");
      listener.mockClear();
      manager.setTabViewMode({ tabId: snapshot.tabId, viewMode: "mobile" });
      fakeWebContents.setUserAgent.mockClear();
      listener.mockClear();

      const updated = manager.setTabViewMode({ tabId: snapshot.tabId, viewMode: "desktop" });

      expect(updated.viewMode).toBe("desktop");
      expect(fakeWebContents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining("Chrome"));
      expect(listener).toHaveBeenCalledWith({
        type: "tab.viewModeChanged",
        tabId: snapshot.tabId,
        viewMode: "desktop",
      });
    });
  });

  describe("setTabMobilePreset", () => {
    it("switches the mobile preset, updates UA, and reloads while mobile", () => {
      const snapshot = manager.createTab("https://target.htb");
      manager.setTabViewMode({ tabId: snapshot.tabId, viewMode: "mobile" });
      fakeWebContents.reload.mockClear();
      fakeWebContents.setUserAgent.mockClear();

      const updated = manager.setTabMobilePreset({
        tabId: snapshot.tabId,
        mobilePreset: "pixel-8",
      });

      expect(updated.mobilePreset).toBe("pixel-8");
      expect(fakeWebContents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining("Pixel 8"));
      expect(fakeWebContents.reload).toHaveBeenCalledTimes(1);
    });

    it("emits a mobile preset change event", () => {
      const listener = vi.fn();
      manager.onTabEvent(listener);
      const snapshot = manager.createTab("https://target.htb");
      listener.mockClear();

      manager.setTabMobilePreset({
        tabId: snapshot.tabId,
        mobilePreset: "ipad-mini",
      });

      expect(listener).toHaveBeenCalledWith({
        type: "tab.mobilePresetChanged",
        tabId: snapshot.tabId,
        mobilePreset: "ipad-mini",
      });
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

  describe("page input", () => {
    it("focuses the target page and moves the pointer before clicking coordinates", async () => {
      const snapshot = manager.createTab();

      await manager.clickPage({ tabId: snapshot.tabId, x: 50, y: 75 });

      expect(fakeWebContents.focus.mock.invocationCallOrder[0]).toBeLessThan(
        fakeWebContents.sendInputEvent.mock.invocationCallOrder[0]!,
      );
      expect(fakeWebContents.sendInputEvent).toHaveBeenNthCalledWith(1, {
        type: "mouseMove",
        x: 50,
        y: 75,
      });
      expect(fakeWebContents.sendInputEvent).toHaveBeenNthCalledWith(2, {
        type: "mouseDown",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
      expect(fakeWebContents.sendInputEvent).toHaveBeenNthCalledWith(3, {
        type: "mouseUp",
        x: 50,
        y: 75,
        button: "left",
        clickCount: 1,
      });
    });

    it("focuses the target page before typing", async () => {
      const snapshot = manager.createTab();

      await manager.typeIntoPage({ tabId: snapshot.tabId, text: "hello" });

      expect(fakeWebContents.focus.mock.invocationCallOrder[0]).toBeLessThan(
        fakeWebContents.sendInputEvent.mock.invocationCallOrder[0]!,
      );
      expect(fakeWebContents.sendInputEvent).toHaveBeenCalledWith({
        type: "char",
        keyCode: "hello",
      });
    });

    it("focuses the target page before pressing a key", async () => {
      const snapshot = manager.createTab();

      await manager.pressPage({ tabId: snapshot.tabId, key: "Enter" });

      expect(fakeWebContents.focus.mock.invocationCallOrder[0]).toBeLessThan(
        fakeWebContents.sendInputEvent.mock.invocationCallOrder[0]!,
      );
      expect(fakeWebContents.sendInputEvent).toHaveBeenNthCalledWith(1, {
        type: "keyDown",
        keyCode: "Enter",
      });
      expect(fakeWebContents.sendInputEvent).toHaveBeenNthCalledWith(2, {
        type: "keyUp",
        keyCode: "Enter",
      });
    });
  });

  describe("request interception", () => {
    it("continues a POST request when CDP post-data capture stalls", async () => {
      vi.useFakeTimers();
      const snapshot = manager.createTab("http://localhost:8082/");
      const messageHandler = fakeWebContents.debugger.on.mock.calls.find(
        ([eventName]: any[]) => eventName === "message",
      )?.[1];
      if (!messageHandler) {
        throw new Error("Debugger message handler was not registered.");
      }
      fakeWebContents.debugger.sendCommand.mockClear();
      fakeWebContents.debugger.sendCommand.mockImplementation((command: string) => {
        if (command === "Fetch.getRequestPostData") {
          return new Promise(() => {});
        }
        return Promise.resolve({});
      });

      messageHandler({}, "Fetch.requestPaused", {
        requestId: "request-1",
        networkId: "network-1",
        resourceType: "Document",
        request: {
          method: "POST",
          url: "http://localhost:3000/admin/impersonations?locale=en",
          headers: {},
          hasPostData: true,
        },
      });

      await vi.advanceTimersByTimeAsync(501);

      expect(fakeWebContents.debugger.sendCommand).toHaveBeenCalledWith("Fetch.continueRequest", {
        requestId: "request-1",
      });
      expect(snapshot.tabId).toBeDefined();
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
