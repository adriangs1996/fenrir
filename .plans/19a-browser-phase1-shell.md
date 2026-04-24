# Phase 1: Browser Shell — Tabbed Browser That Navigates

**Parent plan:** `19-embedded-security-browser.md`
**Depends on:** Nothing (first phase)
**Delivers:** User can open browser tabs in hack workspace, navigate URLs, see pages render. No traffic interception yet.

---

## Goal

Wire the full lifecycle: contracts → IPC bridge → main process browser manager → React UI. After this phase, user clicks "New Tab" in hack sidebar, types a URL, and sees a real Chromium page rendered inside the hack workspace panel. Multiple tabs, back/forward/reload, proper bounds sync, session isolation.

---

## Step 1: Contracts — `packages/contracts/src/browser.ts`

Create the browser contract module. Phase 1 only needs tab-related schemas.

**Pattern reference:** Follow `packages/contracts/src/metasploit.ts` and `packages/contracts/src/vpn.ts` for branded ID and Schema patterns.

### Branded IDs

```typescript
import { Schema } from "effect";

// Use the same makeEntityId pattern as metasploit.ts
export const BrowserTabId = Schema.String.pipe(Schema.brand("BrowserTabId"));
export type BrowserTabId = typeof BrowserTabId.Type;
```

> **Note:** Check exact `makeEntityId` helper used in metasploit.ts. If it's a custom helper, use the same one. If it's direct `Schema.brand`, match that.

### Tab Snapshot Schema

```typescript
export const BrowserTabSnapshot = Schema.Struct({
  tabId: BrowserTabId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
});
export type BrowserTabSnapshot = typeof BrowserTabSnapshot.Type;
```

### Input Schemas

```typescript
export const BrowserCreateTabInput = Schema.Struct({
  url: Schema.optional(Schema.String),
});
export type BrowserCreateTabInput = typeof BrowserCreateTabInput.Type;

export const BrowserNavigateInput = Schema.Struct({
  tabId: BrowserTabId,
  url: Schema.String,
});
export type BrowserNavigateInput = typeof BrowserNavigateInput.Type;

export const BrowserBoundsInput = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type BrowserBoundsInput = typeof BrowserBoundsInput.Type;
```

### Tab Events (Phase 1 subset)

```typescript
export const BrowserTabCreatedEvent = Schema.Struct({
  type: Schema.Literal("tab.created"),
  snapshot: BrowserTabSnapshot,
});

export const BrowserTabClosedEvent = Schema.Struct({
  type: Schema.Literal("tab.closed"),
  tabId: BrowserTabId,
});

export const BrowserTabNavigatedEvent = Schema.Struct({
  type: Schema.Literal("tab.navigated"),
  tabId: BrowserTabId,
  url: Schema.String,
});

export const BrowserTabTitleUpdatedEvent = Schema.Struct({
  type: Schema.Literal("tab.titleUpdated"),
  tabId: BrowserTabId,
  title: Schema.String,
});

export const BrowserTabLoadingChangedEvent = Schema.Struct({
  type: Schema.Literal("tab.loadingChanged"),
  tabId: BrowserTabId,
  loading: Schema.Boolean,
});

export const BrowserTabEvent = Schema.Union([
  BrowserTabCreatedEvent,
  BrowserTabClosedEvent,
  BrowserTabNavigatedEvent,
  BrowserTabTitleUpdatedEvent,
  BrowserTabLoadingChangedEvent,
]);
export type BrowserTabEvent = typeof BrowserTabEvent.Type;
```

### Error Classes

```typescript
export class BrowserTabNotFoundError extends Schema.TaggedError<BrowserTabNotFoundError>()(
  "BrowserTabNotFoundError",
  { tabId: Schema.String, message: Schema.String },
) {}
```

### Export from index

Add to `packages/contracts/src/index.ts`:
```typescript
export * from "./browser";
```

---

## Step 2: IPC Contract — Modify `packages/contracts/src/ipc.ts`

Add browser methods to `DesktopBridge` interface. Follow VPN method pattern exactly.

```typescript
// Add to DesktopBridge interface:

// Browser tab lifecycle
browserCreateTab: (url?: string) => Promise<BrowserTabSnapshot>;
browserCloseTab: (tabId: string) => Promise<void>;
browserNavigate: (tabId: string, url: string) => Promise<void>;
browserGoBack: (tabId: string) => Promise<void>;
browserGoForward: (tabId: string) => Promise<void>;
browserReload: (tabId: string) => Promise<void>;
browserGetTabs: () => Promise<readonly BrowserTabSnapshot[]>;

// Browser view management
browserSetBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
browserShowTab: (tabId: string) => Promise<void>;
browserHideAllTabs: () => Promise<void>;

// Browser events
onBrowserTabEvent: (listener: (event: BrowserTabEvent) => void) => () => void;
```

**Import** `BrowserTabSnapshot` and `BrowserTabEvent` from `./browser` at top of file.

---

## Step 3: Desktop — `apps/desktop/src/browserManager.ts` (NEW FILE)

Follow `vpnManager.ts` pattern: module-level state, exported functions, event listener pattern.

### Module-level state

```typescript
import { WebContentsView, type BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import type { BrowserTabSnapshot, BrowserTabEvent } from "@t3/contracts";

interface TabEntry {
  view: WebContentsView;
  tabId: string;
}

let parentWindow: BrowserWindow | null = null;
const activeTabs = new Map<string, TabEntry>();
let targetSession: Electron.Session | null = null;
let stateListeners: Array<(event: BrowserTabEvent) => void> = [];
```

### Emit pattern (matches vpnManager `setState`)

```typescript
function emit(event: BrowserTabEvent): void {
  for (const listener of stateListeners) {
    try {
      listener(event);
    } catch {
      // listener errors must not crash the manager
    }
  }
}
```

### Init

```typescript
export function initBrowserManager(window: BrowserWindow): void {
  parentWindow = window;
  targetSession = session.fromPartition("persist:target-browsing");

  // Accept self-signed certs in target session (CTF boxes use them)
  targetSession.setCertificateVerifyProc((_request, callback) => {
    callback(0);
  });

  // Set a pentesting-appropriate user agent
  targetSession.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  );
}
```

### Create tab

```typescript
export function createTab(url?: string): BrowserTabSnapshot {
  if (!parentWindow || !targetSession) {
    throw new Error("Browser manager not initialized");
  }

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

  // Load initial URL or blank page
  const initialUrl = url || "about:blank";
  void wc.loadURL(initialUrl);

  const snapshot = getTabSnapshot(tabId);
  emit({ type: "tab.created", snapshot });
  return snapshot;
}
```

### Tab snapshot helper

```typescript
function getTabSnapshot(tabId: string): BrowserTabSnapshot {
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
```

### Navigation functions

```typescript
export function navigateTab(tabId: string, url: string): void {
  const entry = activeTabs.get(tabId);
  if (!entry) throw new Error(`Tab not found: ${tabId}`);
  void entry.view.webContents.loadURL(url);
}

export function goBack(tabId: string): void {
  const entry = activeTabs.get(tabId);
  if (!entry) throw new Error(`Tab not found: ${tabId}`);
  entry.view.webContents.navigationHistory.goBack();
}

export function goForward(tabId: string): void {
  const entry = activeTabs.get(tabId);
  if (!entry) throw new Error(`Tab not found: ${tabId}`);
  entry.view.webContents.navigationHistory.goForward();
}

export function reloadTab(tabId: string): void {
  const entry = activeTabs.get(tabId);
  if (!entry) throw new Error(`Tab not found: ${tabId}`);
  entry.view.webContents.reload();
}
```

### Close tab

```typescript
export function closeTab(tabId: string): void {
  const entry = activeTabs.get(tabId);
  if (!entry) return;

  if (parentWindow) {
    try {
      parentWindow.contentView.removeChildView(entry.view);
    } catch {
      // view might not be attached
    }
  }

  entry.view.webContents.close();
  activeTabs.delete(tabId);
  emit({ type: "tab.closed", tabId: tabId as any });
}
```

### View management

```typescript
export function setTabBounds(
  tabId: string,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const entry = activeTabs.get(tabId);
  if (!entry) return;
  entry.view.setBounds(bounds);
}

export function showTab(tabId: string): void {
  if (!parentWindow) return;
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

export function hideAllTabs(): void {
  if (!parentWindow) return;
  for (const entry of activeTabs.values()) {
    try {
      parentWindow.contentView.removeChildView(entry.view);
    } catch {
      // not attached
    }
  }
}
```

### Query functions

```typescript
export function getTabs(): BrowserTabSnapshot[] {
  return Array.from(activeTabs.keys()).map(getTabSnapshot);
}
```

### Event listener + cleanup

```typescript
export function onBrowserTabEvent(
  listener: (event: BrowserTabEvent) => void,
): () => void {
  stateListeners.push(listener);
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener);
  };
}

export function stopBrowser(): void {
  for (const [tabId] of activeTabs) {
    closeTab(tabId);
  }
  activeTabs.clear();
  stateListeners = [];
}
```

---

## Step 4: Preload Bridge — Modify `apps/desktop/src/preload.ts`

### Add channel constants

```typescript
const BROWSER_CREATE_TAB_CHANNEL = "desktop:browser-create-tab";
const BROWSER_CLOSE_TAB_CHANNEL = "desktop:browser-close-tab";
const BROWSER_NAVIGATE_CHANNEL = "desktop:browser-navigate";
const BROWSER_GO_BACK_CHANNEL = "desktop:browser-go-back";
const BROWSER_GO_FORWARD_CHANNEL = "desktop:browser-go-forward";
const BROWSER_RELOAD_CHANNEL = "desktop:browser-reload";
const BROWSER_GET_TABS_CHANNEL = "desktop:browser-get-tabs";
const BROWSER_SET_BOUNDS_CHANNEL = "desktop:browser-set-bounds";
const BROWSER_SHOW_TAB_CHANNEL = "desktop:browser-show-tab";
const BROWSER_HIDE_ALL_TABS_CHANNEL = "desktop:browser-hide-all-tabs";
const BROWSER_TAB_EVENT_CHANNEL = "desktop:browser-tab-event";
```

### Add to `contextBridge.exposeInMainWorld("desktopBridge", { ... })`

```typescript
browserCreateTab: (url?: string) =>
  ipcRenderer.invoke(BROWSER_CREATE_TAB_CHANNEL, url),
browserCloseTab: (tabId: string) =>
  ipcRenderer.invoke(BROWSER_CLOSE_TAB_CHANNEL, tabId),
browserNavigate: (tabId: string, url: string) =>
  ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, tabId, url),
browserGoBack: (tabId: string) =>
  ipcRenderer.invoke(BROWSER_GO_BACK_CHANNEL, tabId),
browserGoForward: (tabId: string) =>
  ipcRenderer.invoke(BROWSER_GO_FORWARD_CHANNEL, tabId),
browserReload: (tabId: string) =>
  ipcRenderer.invoke(BROWSER_RELOAD_CHANNEL, tabId),
browserGetTabs: () =>
  ipcRenderer.invoke(BROWSER_GET_TABS_CHANNEL),
browserSetBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
  ipcRenderer.invoke(BROWSER_SET_BOUNDS_CHANNEL, tabId, bounds),
browserShowTab: (tabId: string) =>
  ipcRenderer.invoke(BROWSER_SHOW_TAB_CHANNEL, tabId),
browserHideAllTabs: () =>
  ipcRenderer.invoke(BROWSER_HIDE_ALL_TABS_CHANNEL),
onBrowserTabEvent: (listener: (event: unknown) => void) => {
  const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
    if (typeof data !== "object" || data === null) return;
    listener(data);
  };
  ipcRenderer.on(BROWSER_TAB_EVENT_CHANNEL, wrappedListener);
  return () => {
    ipcRenderer.removeListener(BROWSER_TAB_EVENT_CHANNEL, wrappedListener);
  };
},
```

---

## Step 5: Main Process IPC Handlers — Modify `apps/desktop/src/main.ts`

### Import browserManager

```typescript
import {
  initBrowserManager,
  createTab,
  closeTab,
  navigateTab,
  goBack,
  goForward,
  reloadTab,
  getTabs,
  setTabBounds,
  showTab,
  hideAllTabs,
  onBrowserTabEvent,
  stopBrowser,
} from "./browserManager";
```

### Add channel constants (same as preload)

```typescript
const BROWSER_CREATE_TAB_CHANNEL = "desktop:browser-create-tab";
const BROWSER_CLOSE_TAB_CHANNEL = "desktop:browser-close-tab";
const BROWSER_NAVIGATE_CHANNEL = "desktop:browser-navigate";
const BROWSER_GO_BACK_CHANNEL = "desktop:browser-go-back";
const BROWSER_GO_FORWARD_CHANNEL = "desktop:browser-go-forward";
const BROWSER_RELOAD_CHANNEL = "desktop:browser-reload";
const BROWSER_GET_TABS_CHANNEL = "desktop:browser-get-tabs";
const BROWSER_SET_BOUNDS_CHANNEL = "desktop:browser-set-bounds";
const BROWSER_SHOW_TAB_CHANNEL = "desktop:browser-show-tab";
const BROWSER_HIDE_ALL_TABS_CHANNEL = "desktop:browser-hide-all-tabs";
const BROWSER_TAB_EVENT_CHANNEL = "desktop:browser-tab-event";
```

### Register handlers in `app.whenReady()` (after VPN handlers)

Follow exact VPN pattern: `removeHandler` then `handle`, type-validate all inputs.

```typescript
// Browser Manager
initBrowserManager(mainWindow);

ipcMain.removeHandler(BROWSER_CREATE_TAB_CHANNEL);
ipcMain.handle(BROWSER_CREATE_TAB_CHANNEL, async (_event, url: unknown) => {
  const validUrl = typeof url === "string" ? url : undefined;
  return createTab(validUrl);
});

ipcMain.removeHandler(BROWSER_CLOSE_TAB_CHANNEL);
ipcMain.handle(BROWSER_CLOSE_TAB_CHANNEL, async (_event, tabId: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  closeTab(tabId);
});

ipcMain.removeHandler(BROWSER_NAVIGATE_CHANNEL);
ipcMain.handle(BROWSER_NAVIGATE_CHANNEL, async (_event, tabId: unknown, url: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  if (typeof url !== "string") throw new Error("Invalid URL.");
  navigateTab(tabId, url);
});

ipcMain.removeHandler(BROWSER_GO_BACK_CHANNEL);
ipcMain.handle(BROWSER_GO_BACK_CHANNEL, async (_event, tabId: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  goBack(tabId);
});

ipcMain.removeHandler(BROWSER_GO_FORWARD_CHANNEL);
ipcMain.handle(BROWSER_GO_FORWARD_CHANNEL, async (_event, tabId: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  goForward(tabId);
});

ipcMain.removeHandler(BROWSER_RELOAD_CHANNEL);
ipcMain.handle(BROWSER_RELOAD_CHANNEL, async (_event, tabId: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  reloadTab(tabId);
});

ipcMain.removeHandler(BROWSER_GET_TABS_CHANNEL);
ipcMain.handle(BROWSER_GET_TABS_CHANNEL, async () => getTabs());

ipcMain.removeHandler(BROWSER_SET_BOUNDS_CHANNEL);
ipcMain.handle(BROWSER_SET_BOUNDS_CHANNEL, async (_event, tabId: unknown, bounds: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  if (typeof bounds !== "object" || bounds === null) throw new Error("Invalid bounds.");
  const b = bounds as Record<string, unknown>;
  if (
    typeof b.x !== "number" ||
    typeof b.y !== "number" ||
    typeof b.width !== "number" ||
    typeof b.height !== "number"
  ) {
    throw new Error("Invalid bounds shape.");
  }
  setTabBounds(tabId, { x: b.x, y: b.y, width: b.width, height: b.height });
});

ipcMain.removeHandler(BROWSER_SHOW_TAB_CHANNEL);
ipcMain.handle(BROWSER_SHOW_TAB_CHANNEL, async (_event, tabId: unknown) => {
  if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
  showTab(tabId);
});

ipcMain.removeHandler(BROWSER_HIDE_ALL_TABS_CHANNEL);
ipcMain.handle(BROWSER_HIDE_ALL_TABS_CHANNEL, async () => hideAllTabs());

// Push browser tab events to renderer
onBrowserTabEvent((event) => {
  mainWindow?.webContents.send(BROWSER_TAB_EVENT_CHANNEL, event);
});
```

### Add cleanup in quit handler

Find the existing quit/before-quit handler (where `stopVpn()` is called) and add:

```typescript
stopBrowser();
```

---

## Step 6: Zustand Store — `apps/web/src/browserStore.ts` (NEW FILE)

Follow `metasploitStore.ts` pattern exactly.

```typescript
import { create } from "zustand";
import type { BrowserTabSnapshot, BrowserTabEvent } from "@t3/contracts";

interface BrowserState {
  tabs: Record<string, BrowserTabSnapshot>;
  activeTabId: string | null;

  // Actions
  upsertTab: (snapshot: BrowserTabSnapshot) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  applyEvent: (event: BrowserTabEvent) => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: {},
  activeTabId: null,

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
}));
```

---

## Step 7: React Components

### 7a. `apps/web/src/components/browser/useBrowserBounds.ts` (NEW FILE)

Hook that syncs a div's bounds to main process via IPC.

```typescript
import { useEffect, useRef, useCallback } from "react";
import { useBrowserStore } from "../../browserStore";

export function useBrowserBounds() {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const rafRef = useRef<number>(0);

  const updateBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el || !activeTabId) return;

    const rect = el.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // Only send if dimensions are valid
    if (bounds.width > 0 && bounds.height > 0) {
      void window.desktopBridge?.browserSetBounds(activeTabId, bounds);
    }
  }, [activeTabId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activeTabId) return;

    // Show tab in main process
    void window.desktopBridge?.browserShowTab(activeTabId);

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateBounds);
    });

    observer.observe(el);
    updateBounds();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [activeTabId, updateBounds]);

  // Hide all tabs on unmount
  useEffect(() => {
    return () => {
      void window.desktopBridge?.hideAllTabs();
    };
  }, []);

  return containerRef;
}
```

### 7b. `apps/web/src/components/browser/BrowserViewContainer.tsx` (NEW FILE)

Empty div that serves as the positioning target for WebContentsView.

```typescript
import { useBrowserBounds } from "./useBrowserBounds";
import { useBrowserStore } from "../../browserStore";

export function BrowserViewContainer() {
  const containerRef = useBrowserBounds();
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  if (!activeTabId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No tab selected. Open a new tab from the sidebar.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1"
      style={{ minHeight: 200 }}
    />
  );
}
```

### 7c. `apps/web/src/components/browser/BrowserAddressBar.tsx` (NEW FILE)

URL bar with back/forward/reload. Standard form pattern.

```typescript
import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, X as StopIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useBrowserStore } from "../../browserStore";

export function BrowserAddressBar() {
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const activeTab = useBrowserStore((s) =>
    s.activeTabId ? s.tabs[s.activeTabId] : null,
  );
  const [urlInput, setUrlInput] = useState("");

  // Sync URL input with active tab
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    }
  }, [activeTab?.url]);

  if (!activeTabId || !activeTab) return null;

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    // Auto-add protocol
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    void window.desktopBridge?.browserNavigate(activeTabId, url);
  };

  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!activeTab.canGoBack}
        onClick={() => void window.desktopBridge?.browserGoBack(activeTabId)}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!activeTab.canGoForward}
        onClick={() => void window.desktopBridge?.browserGoForward(activeTabId)}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => void window.desktopBridge?.browserReload(activeTabId)}
      >
        {activeTab.loading ? (
          <StopIcon className="h-4 w-4" />
        ) : (
          <RotateCw className="h-4 w-4" />
        )}
      </Button>
      <form onSubmit={handleNavigate} className="flex-1">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Enter URL..."
          className="h-7 text-sm"
        />
      </form>
    </div>
  );
}
```

### 7d. `apps/web/src/components/browser/BrowserTabBar.tsx` (NEW FILE)

Horizontal tab strip showing all open tabs.

```typescript
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { useBrowserStore } from "../../browserStore";
import { cn } from "../../lib/utils";

export function BrowserTabBar() {
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);

  const tabList = Object.values(tabs);
  if (tabList.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b bg-muted/30 px-1">
      {tabList.map((tab) => (
        <div
          key={tab.tabId}
          className={cn(
            "group flex max-w-48 cursor-pointer items-center gap-1 rounded-t px-2 py-1 text-xs",
            tab.tabId === activeTabId
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:bg-background/50",
          )}
          onClick={() => {
            setActiveTab(tab.tabId);
            void window.desktopBridge?.browserShowTab(tab.tabId);
          }}
        >
          <span className="truncate">
            {tab.title || tab.url || "New Tab"}
          </span>
          {tab.loading && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-4 w-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void window.desktopBridge?.browserCloseTab(tab.tabId);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
```

### 7e. `apps/web/src/components/browser/BrowserSidebarSection.tsx` (NEW FILE)

Sidebar section added to HackSidebar. Tab list + New Tab button.

```typescript
import { Globe, Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { useBrowserStore } from "../../browserStore";

export function BrowserSidebarSection() {
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);

  const handleNewTab = async () => {
    const snapshot = await window.desktopBridge?.browserCreateTab();
    if (snapshot) {
      setActiveTab(snapshot.tabId);
    }
  };

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between">
        <SidebarGroupLabel>Browser</SidebarGroupLabel>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => void handleNewTab()}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {Object.values(tabs).map((tab) => (
            <SidebarMenuItem key={tab.tabId}>
              <SidebarMenuButton
                isActive={tab.tabId === activeTabId}
                onClick={() => {
                  setActiveTab(tab.tabId);
                  void window.desktopBridge?.browserShowTab(tab.tabId);
                }}
              >
                <Globe className="h-4 w-4" />
                <span className="truncate">
                  {tab.title || tab.url || "New Tab"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {Object.keys(tabs).length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              No tabs open
            </div>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
```

---

## Step 8: Wire Into Hack Workspace

### 8a. Modify `apps/web/src/components/hack/HackSidebar.tsx`

Add `BrowserSidebarSection` as the first `SidebarGroup` (before Listeners):

```typescript
import { BrowserSidebarSection } from "../browser/BrowserSidebarSection";

// Inside the component JSX, before the Listeners SidebarGroup:
<BrowserSidebarSection />
```

### 8b. Modify `apps/web/src/routes/hack.tsx`

The hack route layout needs to conditionally render browser view when a browser tab is active vs TargetWorkspace when a metasploit session is active.

```typescript
import { useBrowserStore } from "../browserStore";
import { BrowserAddressBar } from "../components/browser/BrowserAddressBar";
import { BrowserTabBar } from "../components/browser/BrowserTabBar";
import { BrowserViewContainer } from "../components/browser/BrowserViewContainer";

function HackRouteLayout() {
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  return (
    <div className="flex h-full flex-1 flex-col">
      {activeTabId ? (
        <>
          <BrowserTabBar />
          <BrowserAddressBar />
          <BrowserViewContainer />
        </>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
```

> **Important:** When `activeTabId` is set, browser view takes over main area. When user clicks a metasploit session in sidebar, `activeTabId` should be set to `null` and `Outlet` renders TargetWorkspace. Wire this in HackSidebar session click handler:

In HackSidebar session click handler, add:
```typescript
useBrowserStore.getState().setActiveTab(null);
void window.desktopBridge?.hideAllTabs();
```

### 8c. Subscribe to browser events from main process

Add event subscription in hack route layout or a top-level component:

```typescript
import { useEffect } from "react";
import { useBrowserStore } from "../browserStore";

// Inside HackRouteLayout or a parent component:
useEffect(() => {
  const unsubscribe = window.desktopBridge?.onBrowserTabEvent((event) => {
    useBrowserStore.getState().applyEvent(event as any);
  });
  return () => unsubscribe?.();
}, []);
```

---

## Step 9: Restore tabs on mount

When hack route mounts, fetch existing tabs from main process:

```typescript
useEffect(() => {
  const loadTabs = async () => {
    const tabs = await window.desktopBridge?.browserGetTabs();
    if (tabs) {
      for (const tab of tabs) {
        useBrowserStore.getState().upsertTab(tab);
      }
    }
  };
  void loadTabs();
}, []);
```

---

## Acceptance Criteria

- [ ] "New Tab" button in hack sidebar creates browser tab via IPC
- [ ] Tab appears in sidebar list and tab bar
- [ ] Clicking tab in sidebar/tab bar activates it and shows WebContentsView
- [ ] URL bar shows current URL, updates on navigation
- [ ] Typing URL and pressing Enter navigates to that URL
- [ ] URLs without protocol auto-prefix with `http://`
- [ ] Back/forward/reload buttons work
- [ ] Page title updates in sidebar and tab bar
- [ ] Loading indicator shows during page load
- [ ] Close button on tab closes it via IPC
- [ ] WebContentsView bounds stay synced with placeholder div on resize
- [ ] Switching to metasploit session hides browser views
- [ ] Switching back to browser tab shows the view again
- [ ] Navigating away from hack workspace hides all browser views
- [ ] Self-signed certs accepted in target browsing session
- [ ] Target session cookies isolated from Fenrir session cookies
- [ ] Multiple tabs work independently
- [ ] App quit cleans up all browser views

---

## Files Summary

**New files (8):**
1. `packages/contracts/src/browser.ts`
2. `apps/desktop/src/browserManager.ts`
3. `apps/web/src/browserStore.ts`
4. `apps/web/src/components/browser/BrowserSidebarSection.tsx`
5. `apps/web/src/components/browser/BrowserViewContainer.tsx`
6. `apps/web/src/components/browser/BrowserTabBar.tsx`
7. `apps/web/src/components/browser/BrowserAddressBar.tsx`
8. `apps/web/src/components/browser/useBrowserBounds.ts`

**Modified files (6):**
1. `packages/contracts/src/index.ts` — add `export * from "./browser"`
2. `packages/contracts/src/ipc.ts` — add browser methods to `DesktopBridge`
3. `apps/desktop/src/preload.ts` — add browser bridge methods + channel constants
4. `apps/desktop/src/main.ts` — add IPC handlers, init call, quit cleanup
5. `apps/web/src/components/hack/HackSidebar.tsx` — add `BrowserSidebarSection`
6. `apps/web/src/routes/hack.tsx` — conditional browser/session rendering + event subscription

---

## Test Plan

### Test File: `packages/contracts/src/browser.test.ts`

Schema validation tests. Pattern: `Schema.decodeUnknownSync()` acceptance/rejection.

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BrowserTabSnapshot,
  BrowserCreateTabInput,
  BrowserTabCreatedEvent,
  BrowserTabClosedEvent,
  BrowserTabNavigatedEvent,
  BrowserTabTitleUpdatedEvent,
  BrowserTabLoadingChangedEvent,
  BrowserTabEvent,
  BrowserTabNotFoundError,
} from "./browser";

const decodeTabSnapshot = Schema.decodeUnknownSync(BrowserTabSnapshot);
const decodeCreateTabInput = Schema.decodeUnknownSync(BrowserCreateTabInput);
const decodeTabEvent = Schema.decodeUnknownSync(BrowserTabEvent);

describe("BrowserTabSnapshot", () => {
  it("accepts a valid tab snapshot", () => {
    const parsed = decodeTabSnapshot({
      tabId: "abc-123",
      url: "https://target.htb",
      title: "Target",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    expect(parsed.tabId).toBe("abc-123");
    expect(parsed.loading).toBe(false);
  });

  it("rejects snapshot missing required fields", () => {
    expect(() => decodeTabSnapshot({ tabId: "abc" })).toThrow();
  });

  it("rejects snapshot with wrong field types", () => {
    expect(() =>
      decodeTabSnapshot({
        tabId: "abc",
        url: 123,
        title: "T",
        loading: "no",
        canGoBack: true,
        canGoForward: false,
      }),
    ).toThrow();
  });
});

describe("BrowserCreateTabInput", () => {
  it("accepts empty object (url is optional)", () => {
    const parsed = decodeCreateTabInput({});
    expect(parsed.url).toBeUndefined();
  });

  it("accepts object with url", () => {
    const parsed = decodeCreateTabInput({ url: "https://10.10.10.1" });
    expect(parsed.url).toBe("https://10.10.10.1");
  });
});

describe("BrowserTabEvent", () => {
  it("decodes tab.created event", () => {
    const event = decodeTabEvent({
      type: "tab.created",
      snapshot: {
        tabId: "t1",
        url: "about:blank",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    expect(event.type).toBe("tab.created");
  });

  it("decodes tab.closed event", () => {
    const event = decodeTabEvent({ type: "tab.closed", tabId: "t1" });
    expect(event.type).toBe("tab.closed");
  });

  it("decodes tab.navigated event", () => {
    const event = decodeTabEvent({ type: "tab.navigated", tabId: "t1", url: "https://x.com" });
    expect(event.type).toBe("tab.navigated");
  });

  it("decodes tab.titleUpdated event", () => {
    const event = decodeTabEvent({ type: "tab.titleUpdated", tabId: "t1", title: "New Title" });
    expect(event.type).toBe("tab.titleUpdated");
  });

  it("decodes tab.loadingChanged event", () => {
    const event = decodeTabEvent({ type: "tab.loadingChanged", tabId: "t1", loading: true });
    expect(event.type).toBe("tab.loadingChanged");
  });

  it("rejects unknown event type", () => {
    expect(() => decodeTabEvent({ type: "tab.unknown", tabId: "t1" })).toThrow();
  });
});
```

---

### Test File: `apps/desktop/src/browserManager.test.ts`

Electron module mocking. Pattern: `vi.hoisted()` + `vi.mock("electron")`.

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Fake WebContentsView and session ---
const { fakeSession, fakeWebContents, mockWebContentsView } = vi.hoisted(() => {
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

  const mockWebContentsView = vi.fn(() => fakeView);

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

import {
  initBrowserManager,
  createTab,
  closeTab,
  navigateTab,
  goBack,
  goForward,
  reloadTab,
  getTabs,
  setTabBounds,
  showTab,
  hideAllTabs,
  onBrowserTabEvent,
  stopBrowser,
} from "./browserManager";

describe("browserManager", () => {
  const fakeWindow = {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    stopBrowser(); // reset state between tests
    initBrowserManager(fakeWindow);
  });

  describe("initBrowserManager", () => {
    it("creates isolated session partition", () => {
      const { session } = require("electron");
      expect(session.fromPartition).toHaveBeenCalledWith("persist:target-browsing");
    });

    it("accepts all certificates in target session", () => {
      expect(fakeSession.setCertificateVerifyProc).toHaveBeenCalledWith(expect.any(Function));
      // Call the proc and verify it accepts (calls callback with 0)
      const proc = fakeSession.setCertificateVerifyProc.mock.calls[0][0];
      const callback = vi.fn();
      proc({}, callback);
      expect(callback).toHaveBeenCalledWith(0);
    });

    it("sets a non-default user agent", () => {
      expect(fakeSession.setUserAgent).toHaveBeenCalled();
      const ua = fakeSession.setUserAgent.mock.calls[0][0];
      expect(ua).toContain("Chrome");
      expect(ua).not.toContain("Electron");
    });
  });

  describe("createTab", () => {
    it("returns a BrowserTabSnapshot with generated tabId", () => {
      const snapshot = createTab();
      expect(snapshot.tabId).toBeDefined();
      expect(typeof snapshot.tabId).toBe("string");
      expect(snapshot.url).toBe("about:blank");
    });

    it("creates WebContentsView with correct preferences", () => {
      createTab();
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
      createTab("https://10.10.10.1");
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://10.10.10.1");
    });

    it("loads about:blank when no URL provided", () => {
      createTab();
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("about:blank");
    });

    it("emits tab.created event", () => {
      const listener = vi.fn();
      onBrowserTabEvent(listener);
      createTab();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tab.created" }),
      );
    });

    it("registers navigation event listeners on webContents", () => {
      createTab();
      const eventNames = fakeWebContents.on.mock.calls.map((c: any) => c[0]);
      expect(eventNames).toContain("did-navigate");
      expect(eventNames).toContain("did-navigate-in-page");
      expect(eventNames).toContain("page-title-updated");
      expect(eventNames).toContain("did-start-loading");
      expect(eventNames).toContain("did-stop-loading");
    });
  });

  describe("closeTab", () => {
    it("removes view from window and closes webContents", () => {
      const snapshot = createTab();
      closeTab(snapshot.tabId);
      expect(fakeWebContents.close).toHaveBeenCalled();
    });

    it("emits tab.closed event", () => {
      const listener = vi.fn();
      onBrowserTabEvent(listener);
      const snapshot = createTab();
      listener.mockClear();
      closeTab(snapshot.tabId);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tab.closed", tabId: snapshot.tabId }),
      );
    });

    it("does not throw for unknown tabId", () => {
      expect(() => closeTab("nonexistent")).not.toThrow();
    });
  });

  describe("navigateTab", () => {
    it("calls loadURL on the tab's webContents", () => {
      const snapshot = createTab();
      navigateTab(snapshot.tabId, "https://target.htb");
      expect(fakeWebContents.loadURL).toHaveBeenCalledWith("https://target.htb");
    });

    it("throws for unknown tabId", () => {
      expect(() => navigateTab("nonexistent", "https://x.com")).toThrow();
    });
  });

  describe("goBack / goForward / reloadTab", () => {
    it("calls navigationHistory.goBack", () => {
      const snapshot = createTab();
      goBack(snapshot.tabId);
      expect(fakeWebContents.navigationHistory.goBack).toHaveBeenCalled();
    });

    it("calls navigationHistory.goForward", () => {
      const snapshot = createTab();
      goForward(snapshot.tabId);
      expect(fakeWebContents.navigationHistory.goForward).toHaveBeenCalled();
    });

    it("calls webContents.reload", () => {
      const snapshot = createTab();
      reloadTab(snapshot.tabId);
      expect(fakeWebContents.reload).toHaveBeenCalled();
    });
  });

  describe("getTabs", () => {
    it("returns empty array when no tabs", () => {
      expect(getTabs()).toEqual([]);
    });

    it("returns snapshots for all open tabs", () => {
      createTab("https://a.com");
      createTab("https://b.com");
      const tabs = getTabs();
      expect(tabs).toHaveLength(2);
    });
  });

  describe("setTabBounds", () => {
    it("calls setBounds on the view", () => {
      const snapshot = createTab();
      setTabBounds(snapshot.tabId, { x: 10, y: 20, width: 800, height: 600 });
      const view = mockWebContentsView.mock.results[0].value;
      expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 800, height: 600 });
    });

    it("silently ignores unknown tabId", () => {
      expect(() => setTabBounds("nope", { x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
    });
  });

  describe("showTab / hideAllTabs", () => {
    it("adds view to parent window contentView", () => {
      const snapshot = createTab();
      showTab(snapshot.tabId);
      expect(fakeWindow.contentView.addChildView).toHaveBeenCalled();
    });

    it("removes all views on hideAllTabs", () => {
      createTab();
      createTab();
      hideAllTabs();
      expect(fakeWindow.contentView.removeChildView).toHaveBeenCalled();
    });
  });

  describe("event listener management", () => {
    it("unsubscribe removes listener", () => {
      const listener = vi.fn();
      const unsub = onBrowserTabEvent(listener);
      createTab();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      listener.mockClear();
      createTab();
      expect(listener).not.toHaveBeenCalled();
    });

    it("swallows listener errors without crashing", () => {
      onBrowserTabEvent(() => {
        throw new Error("listener boom");
      });
      expect(() => createTab()).not.toThrow();
    });
  });

  describe("stopBrowser", () => {
    it("closes all tabs and clears state", () => {
      createTab();
      createTab();
      stopBrowser();
      expect(getTabs()).toEqual([]);
    });
  });
});
```

---

### Test File: `apps/web/src/browserStore.test.ts`

Pure state transition tests. Pattern: direct state manipulation, no store provider.

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useBrowserStore } from "./browserStore";
import type { BrowserTabSnapshot, BrowserTabEvent } from "@t3/contracts";

const makeTab = (overrides?: Partial<BrowserTabSnapshot>): BrowserTabSnapshot => ({
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
      useBrowserStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any }));
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
      expect(useBrowserStore.getState().tabs["tab-1"].url).toBe("https://new-url.htb");
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
      useBrowserStore.getState().upsertTab(makeTab({ tabId: "tab-2" as any, title: "Tab 2" }));
      useBrowserStore.getState().applyEvent({
        type: "tab.titleUpdated",
        tabId: "tab-1",
        title: "Changed",
      } as any);
      expect(useBrowserStore.getState().tabs["tab-2"].title).toBe("Tab 2");
    });
  });
});
```

---

### Test Files Summary for Phase 1

| Test file | Tests | Pattern |
|---|---|---|
| `packages/contracts/src/browser.test.ts` | Schema validation: accept valid, reject invalid, all event types | Effect Schema decode |
| `apps/desktop/src/browserManager.test.ts` | Tab lifecycle, view management, events, cleanup, cert handling | Electron mock via `vi.hoisted` + `vi.mock` |
| `apps/web/src/browserStore.test.ts` | State transitions: upsert, remove, activeTab, applyEvent, isolation | Pure Zustand state |

**Total new test files: 3**
**Estimated test count: ~40 test cases**
