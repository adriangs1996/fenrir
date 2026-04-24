import { WebContentsView, type BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import type { TrafficLensTabSnapshot, TrafficLensTabEvent } from "@fenrir/contracts";

export interface TrafficLensManagerConfig {
  window: BrowserWindow;
  backendHttpUrl?: string;
  bootstrapToken?: string;
}

export interface TrafficLensManager {
  createTab(url?: string): TrafficLensTabSnapshot;
  navigateTab(tabId: string, url: string): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reloadTab(tabId: string): void;
  closeTab(tabId: string): void;
  setTabBounds(tabId: string, bounds: { x: number; y: number; width: number; height: number }): void;
  showTab(tabId: string): void;
  hideAllTabs(): void;
  getTabs(): TrafficLensTabSnapshot[];
  onTabEvent(listener: (event: TrafficLensTabEvent) => void): () => void;
  stop(): void;
}

interface TabEntry {
  view: WebContentsView;
  tabId: string;
}

const MAX_CAPTURE_BODY_BYTES = 10 * 1024 * 1024; // 10MB

export function createTrafficLensManager(config: TrafficLensManagerConfig): TrafficLensManager {
  const parentWindow: BrowserWindow = config.window;
  const activeTabs = new Map<string, TabEntry>();
  let stateListeners: Array<(event: TrafficLensTabEvent) => void> = [];
  const backendUrl = config.backendHttpUrl ?? "";
  const backendToken = config.bootstrapToken ?? "";

  const targetSession = session.fromPartition("persist:target-browsing");

  // Accept self-signed certs in target session (CTF boxes use them)
  targetSession.setCertificateVerifyProc((_request, callback) => {
    callback(0);
  });

  // Set a pentesting-appropriate user agent
  targetSession.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  );

  function emit(event: TrafficLensTabEvent): void {
    for (const listener of stateListeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  function getTabSnapshot(tabId: string): TrafficLensTabSnapshot {
    const entry = activeTabs.get(tabId);
    if (!entry) throw new Error(`Tab not found: ${tabId}`);

    const wc = entry.view.webContents;
    return {
      tabId: tabId as any,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  async function forwardTraffic(payload: {
    tabId: string;
    requestId: string;
    stage: "request" | "response";
    method: string;
    url: string;
    host: string;
    path: string;
    statusCode?: number;
    contentType?: string;
    contentLength?: number;
    requestHeadersJson?: string;
    requestBody?: string | null;
    responseHeadersJson?: string;
    responseBody?: string | null;
    bodyTruncated?: boolean;
    timestamp: string;
  }): Promise<void> {
    if (!backendUrl) return;
    try {
      await fetch(`${backendUrl}/api/traffic-lens/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${backendToken}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[trafficLensManager] Traffic forward failed:", err);
    }
  }

  async function handleFetchPaused(
    tabId: string,
    cdp: Electron.Debugger,
    params: any,
  ): Promise<void> {
    const { requestId, request, responseStatusCode, responseHeaders } = params;

    try {
      if (responseStatusCode !== undefined) {
        // ---- RESPONSE STAGE ----
        let responseBody: string | null = null;
        let bodyTruncated = false;

        try {
          const bodyResult = await cdp.sendCommand("Fetch.getResponseBody", { requestId });
          responseBody = bodyResult.base64Encoded
            ? bodyResult.body
            : Buffer.from(bodyResult.body).toString("base64");

          const bodyBytes = Buffer.byteLength(bodyResult.body, bodyResult.base64Encoded ? "base64" : "utf-8");
          if (responseBody && bodyBytes > MAX_CAPTURE_BODY_BYTES) {
            responseBody = responseBody.slice(0, MAX_CAPTURE_BODY_BYTES);
            bodyTruncated = true;
          }
        } catch {
          // Body might not be available (streaming, redirect, etc.)
        }

        const contentType = responseHeaders?.find(
          (h: any) => h.name.toLowerCase() === "content-type",
        )?.value;
        const contentLength = responseHeaders?.find(
          (h: any) => h.name.toLowerCase() === "content-length",
        )?.value;

        const parsedUrl = new URL(request.url);

        void forwardTraffic({
          tabId,
          requestId: params.networkId ?? requestId,
          stage: "response",
          method: request.method,
          url: request.url,
          host: parsedUrl.host,
          path: parsedUrl.pathname + parsedUrl.search,
          statusCode: responseStatusCode,
          contentType,
          ...(contentLength ? { contentLength: parseInt(String(contentLength), 10) } : {}),
          responseHeadersJson: JSON.stringify(
            Object.fromEntries(
              (responseHeaders ?? []).map((h: any) => [h.name, h.value]),
            ),
          ),
          responseBody,
          bodyTruncated,
          timestamp: new Date().toISOString(),
        });

        await cdp.sendCommand("Fetch.continueResponse", { requestId });
      } else {
        // ---- REQUEST STAGE ----
        let requestBody: string | null = null;

        if (request.hasPostData) {
          try {
            const postData = await cdp.sendCommand("Fetch.getRequestPostData", { requestId });
            requestBody = Buffer.from(postData.postData).toString("base64");
          } catch {
            // POST data might not be available
          }
        }

        const parsedUrl = new URL(request.url);

        void forwardTraffic({
          tabId,
          requestId: params.networkId ?? requestId,
          stage: "request",
          method: request.method,
          url: request.url,
          host: parsedUrl.host,
          path: parsedUrl.pathname + parsedUrl.search,
          requestHeadersJson: JSON.stringify(request.headers ?? {}),
          requestBody,
          timestamp: new Date().toISOString(),
        });

        await cdp.sendCommand("Fetch.continueRequest", { requestId });
      }
    } catch (err) {
      try {
        await cdp.sendCommand("Fetch.continueRequest", { requestId });
      } catch {
        // debugger might be detached
      }
      console.error("[trafficLensManager] handleFetchPaused error:", err);
    }
  }

  function createTab(url?: string): TrafficLensTabSnapshot {
    const tabId = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:target-browsing",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: false, // disable same-origin for pentesting
        allowRunningInsecureContent: true,
      },
    });

    const entry: TabEntry = { view, tabId };
    activeTabs.set(tabId, entry);

    // Wire navigation events
    const wc = view.webContents;

    wc.on("did-navigate", (_event, navUrl) => {
      emit({
        type: "tab.navigated",
        tabId: tabId as any,
        url: navUrl,
      });
    });

    wc.on("did-navigate-in-page", (_event, navUrl) => {
      emit({
        type: "tab.navigated",
        tabId: tabId as any,
        url: navUrl,
      });
    });

    wc.on("page-title-updated", (_event, title) => {
      emit({
        type: "tab.titleUpdated",
        tabId: tabId as any,
        title,
      });
    });

    wc.on("did-start-loading", () => {
      emit({
        type: "tab.loadingChanged",
        tabId: tabId as any,
        loading: true,
      });
    });

    wc.on("did-stop-loading", () => {
      emit({
        type: "tab.loadingChanged",
        tabId: tabId as any,
        loading: false,
      });
    });

    // Attach CDP debugger for traffic interception
    const cdp = wc.debugger;
    try {
      cdp.attach("1.3");

      cdp.sendCommand("Fetch.enable", {
        patterns: [
          { urlPattern: "*", requestStage: "Request" },
          { urlPattern: "*", requestStage: "Response" },
        ],
        handleAuthRequests: true,
      }).catch((err: unknown) => {
        console.error("[trafficLensManager] Fetch.enable failed:", err);
      });

      cdp.on("message", (_event: Electron.Event, method: string, params: any) => {
        if (method === "Fetch.requestPaused") {
          void handleFetchPaused(tabId, cdp, params);
        }
      });
    } catch (err) {
      console.error("[trafficLensManager] Debugger attach failed:", err);
    }

    // Load initial URL or blank page
    const initialUrl = url || "about:blank";
    void wc.loadURL(initialUrl);

    const snapshot = getTabSnapshot(tabId);
    emit({ type: "tab.created", snapshot });
    return snapshot;
  }

  function navigateTab(tabId: string, url: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) throw new Error(`Tab not found: ${tabId}`);
    void entry.view.webContents.loadURL(url);
  }

  function goBack(tabId: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) throw new Error(`Tab not found: ${tabId}`);
    entry.view.webContents.navigationHistory.goBack();
  }

  function goForward(tabId: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) throw new Error(`Tab not found: ${tabId}`);
    entry.view.webContents.navigationHistory.goForward();
  }

  function reloadTab(tabId: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) throw new Error(`Tab not found: ${tabId}`);
    entry.view.webContents.reload();
  }

  function closeTab(tabId: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) return;

    try {
      parentWindow.contentView.removeChildView(entry.view);
    } catch {
      // view might not be attached
    }

    entry.view.webContents.close();
    activeTabs.delete(tabId);
    emit({ type: "tab.closed", tabId: tabId as any });
  }

  function setTabBounds(
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const entry = activeTabs.get(tabId);
    if (!entry) return;
    entry.view.setBounds(bounds);
  }

  function showTab(tabId: string): void {
    const entry = activeTabs.get(tabId);
    if (!entry) return;

    // Hide all other tabs first
    for (const [id, other] of activeTabs) {
      if (id !== tabId) {
        try {
          parentWindow.contentView.removeChildView(other.view);
        } catch {
          // not attached
        }
      }
    }

    // Show the target tab
    try {
      parentWindow.contentView.addChildView(entry.view);
    } catch {
      // already attached — re-add to bring to front
      parentWindow.contentView.removeChildView(entry.view);
      parentWindow.contentView.addChildView(entry.view);
    }
  }

  function hideAllTabs(): void {
    for (const entry of activeTabs.values()) {
      try {
        parentWindow.contentView.removeChildView(entry.view);
      } catch {
        // not attached
      }
    }
  }

  function getTabs(): TrafficLensTabSnapshot[] {
    return Array.from(activeTabs.keys()).map(getTabSnapshot);
  }

  function onTabEvent(
    listener: (event: TrafficLensTabEvent) => void,
  ): () => void {
    stateListeners.push(listener);
    return () => {
      stateListeners = stateListeners.filter((l) => l !== listener);
    };
  }

  function stop(): void {
    for (const [tabId] of activeTabs) {
      closeTab(tabId);
    }
    activeTabs.clear();
    stateListeners = [];
  }

  return {
    createTab,
    navigateTab,
    goBack,
    goForward,
    reloadTab,
    closeTab,
    setTabBounds,
    showTab,
    hideAllTabs,
    getTabs,
    onTabEvent,
    stop,
  };
}
