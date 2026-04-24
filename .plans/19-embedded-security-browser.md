# Plan: Embedded Security Browser (Proxy Browser)

## Purpose

Add an embedded Chromium browser to the hack workspace for interactive web security testing. Primary use case: CTFs (Hack The Box, TryHackMe) where the user needs to browse targets, intercept traffic, inspect requests/responses, replay modified requests, and map site structure — all without leaving Fenrir.

The browser lives inside the hack workspace alongside metasploit and terminal, not as a separate workspace. A CTF workflow demands simultaneous access to browser + traffic + terminal + metasploit.

## Primary goals

- Embedded tabbed browser inside hack workspace using `WebContentsView`.
- Full HTTP traffic interception (headers + bodies) via CDP Fetch domain.
- Traffic history table with request/response inspector (Burp HTTP History equivalent).
- Request replay and modification (Burp Repeater equivalent).
- Passive site map from captured traffic.
- Cookie management (view, edit, export, import).
- CSP/CORS/X-Frame-Options stripping for pentesting.
- User-defined header manipulation rules.
- WebSocket frame observation.
- Zero external dependencies — pure TypeScript, no Rust proxy, no certificate management.

## Non-goals

- External proxy mode (intercepting traffic from curl, sqlmap, scripts outside Fenrir).
- Active scanning or fuzzing engine (could be a future plugin).
- Full Burp Suite feature parity (Intruder, Scanner, Collaborator).
- Browser extension support.
- Multi-user shared proxy sessions.
- Recording/playback macros.

## Core decisions

### 1. Lives in hack workspace, not a separate workspace

The browser is a pentesting tool. Splitting it into a third workspace fragments the CTF workflow where users constantly switch between browsing a target, watching traffic, running terminal commands, and managing metasploit sessions.

The hack workspace layout gains a new mode/view for the browser. The sidebar gains a "Browser" section alongside Listeners and Sessions.

### 2. All interception via CDP Fetch domain — no external proxy

Since the browser only lives inside Fenrir, we use `webContents.debugger` with the CDP Fetch domain for interception. This gives us:

- Full request interception (URL, method, headers, POST data modification).
- Full response interception (status, headers, body read and modification).
- HTTP auth challenge handling.
- Zero certificate management — CDP intercepts after TLS termination inside Chromium.
- Zero proxy configuration — no ports, no system proxy settings.

The `session.webRequest` API handles header-level manipulation (CSP stripping, custom rules) because it's simpler for that use case and doesn't conflict with the CDP debugger.

### 3. Isolated session partition

All browser tabs use `session.fromPartition("persist:target-browsing")` — completely isolated cookies, cache, storage from the Fenrir app UI session. Target site cookies never leak into Fenrir. Fenrir auth cookies never leak into target browsing.

Future enhancement: per-tab partitions for testing as different users simultaneously.

### 4. Traffic storage in server SQLite, capture in main process

The main process owns the `WebContentsView` and CDP debugger (Electron constraint). It captures traffic and forwards it to the server via authenticated HTTP POST to `/api/browser/traffic`. The server stores traffic in SQLite and serves it to the web UI via WebSocket RPC.

```
WebContentsView (main process)
  → CDP Fetch domain captures req/res
  → HTTP POST to server /api/browser/traffic
Server (apps/server)
  → SQLite storage
  → WebSocket RPC → web UI
Web UI (apps/web)
  → Real-time traffic table, inspector, repeater
```

This keeps the server authoritative over storage (existing pattern) and avoids complex IPC piping.

### 5. Body size limits to prevent OOM

CDP `Fetch.getResponseBody` returns the full body as base64. Large downloads (images, binaries, streams) would cause memory spikes. Default 10MB body capture limit. Bodies exceeding limit store only headers + first N bytes with `bodyTruncated: true` flag. Binary content types optionally excluded.

### 6. Browser view bounds synchronized via ResizeObserver

`WebContentsView` is a native Electron view positioned over the web content via `setBounds()`. React renders an empty placeholder div, measures it with `ResizeObserver` + `getBoundingClientRect()`, and sends the rect to the main process via IPC. The main process positions the view to match.

When user navigates away from the browser view, all views are hidden (removed from parent but kept alive).

---

## Data model

### Migration: `024_BrowserTraffic.ts`

```sql
CREATE TABLE browser_traffic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  content_type TEXT,
  content_length INTEGER,
  request_headers_json TEXT NOT NULL,
  request_body BLOB,
  response_headers_json TEXT,
  response_body BLOB,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  timing_started_at TEXT NOT NULL,
  timing_response_at TEXT,
  timing_completed_at TEXT,
  is_websocket INTEGER NOT NULL DEFAULT 0,
  remote_address TEXT,
  tls_version TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bt_tab ON browser_traffic(tab_id);
CREATE INDEX idx_bt_host ON browser_traffic(host);
CREATE INDEX idx_bt_method ON browser_traffic(method);
CREATE INDEX idx_bt_status ON browser_traffic(status_code);
CREATE INDEX idx_bt_created ON browser_traffic(created_at DESC);
```

### Migration: `025_BrowserHeaderRules.ts`

```sql
CREATE TABLE browser_header_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  direction TEXT NOT NULL CHECK (direction IN ('request', 'response')),
  action TEXT NOT NULL CHECK (action IN ('add', 'modify', 'remove')),
  header_name TEXT NOT NULL,
  header_value TEXT,
  url_pattern TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration: `026_BrowserWsFrames.ts`

```sql
CREATE TABLE browser_ws_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traffic_id INTEGER NOT NULL REFERENCES browser_traffic(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  opcode INTEGER NOT NULL,
  payload BLOB,
  payload_length INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bwf_traffic ON browser_ws_frames(traffic_id);
```

---

## Contracts (`packages/contracts/src/browser.ts`)

### Branded IDs

```typescript
export const BrowserTabId = makeEntityId("BrowserTabId");
export type BrowserTabId = typeof BrowserTabId.Type;

export const BrowserTrafficId = makeEntityId("BrowserTrafficId");
export type BrowserTrafficId = typeof BrowserTrafficId.Type;

export const BrowserHeaderRuleId = makeEntityId("BrowserHeaderRuleId");
export type BrowserHeaderRuleId = typeof BrowserHeaderRuleId.Type;
```

### Key schemas

- `BrowserTabSnapshot` — id, url, title, loading, canGoBack, canGoForward, partition
- `BrowserTrafficEntry` — list-level row (no bodies): id, tabId, method, url, host, path, statusCode, contentType, contentLength, timing, isWebSocket
- `BrowserTrafficDetail` — full detail with bodies, requestHeaders, responseHeaders
- `BrowserHeaderRule` — id, name, enabled, direction, action, headerName, headerValue, urlPattern, priority
- `BrowserSiteMapNode` — host, path, children, methods, statusCodes (aggregated)
- `BrowserWebSocketFrame` — id, trafficId, direction, opcode, payload, payloadLength, timestamp
- `BrowserCookieEntry` — name, value, domain, path, httpOnly, secure, sameSite, expirationDate

### Input schemas

- `BrowserCreateTabInput` — `{ url?: string }`
- `BrowserNavigateInput` — `{ tabId, url }`
- `BrowserTrafficQueryInput` — `{ tabId?, host?, method?, statusCode?, search?, limit, offset }`
- `BrowserReplayRequestInput` — `{ trafficId, method?, url?, headers?, body? }`
- `BrowserHeaderRuleInput` — creation/update shape
- `BrowserCookieSetInput` — `{ url, name, value, domain?, path?, httpOnly?, secure?, sameSite?, expirationDate? }`
- `BrowserCookieDeleteInput` — `{ url, name }`

### Error classes

- `BrowserError` — general
- `BrowserTabNotFoundError` — tab-specific
- `BrowserTrafficNotFoundError` — traffic query

### Events (streaming subscription)

```typescript
export const BrowserEvent = Schema.Union([
  TabCreated, TabClosed, TabNavigated, TabTitleUpdated, TabLoadingChanged,
  TrafficCaptured, WebSocketFrame, HeaderRuleChanged,
]);
```

---

## RPC additions (`packages/contracts/src/rpc.ts`)

Add to `WS_METHODS`:

```typescript
// Traffic
browserGetTraffic: "browser.getTraffic",
browserGetTrafficDetail: "browser.getTrafficDetail",
browserReplayRequest: "browser.replayRequest",
browserClearTraffic: "browser.clearTraffic",
browserGetSiteMap: "browser.getSiteMap",

// Header rules
browserGetHeaderRules: "browser.getHeaderRules",
browserCreateHeaderRule: "browser.createHeaderRule",
browserUpdateHeaderRule: "browser.updateHeaderRule",
browserDeleteHeaderRule: "browser.deleteHeaderRule",

// Cookies (server delegates to main process via IPC)
browserGetCookies: "browser.getCookies",
browserSetCookie: "browser.setCookie",
browserDeleteCookie: "browser.deleteCookie",
browserExportCookies: "browser.exportCookies",

// WebSocket frames
browserGetWsFrames: "browser.getWsFrames",

// Streaming
subscribeBrowserEvents: "subscribeBrowserEvents",
```

Each gets `Rpc.make(...)` definition, added to `WsRpcGroup`.

---

## IPC additions (`packages/contracts/src/ipc.ts`)

Add to `DesktopBridge`:

```typescript
// Tab lifecycle
browserCreateTab(input: BrowserCreateTabInput): Promise<BrowserTabSnapshot>;
browserCloseTab(tabId: string): Promise<void>;
browserNavigate(tabId: string, url: string): Promise<void>;
browserGoBack(tabId: string): Promise<void>;
browserGoForward(tabId: string): Promise<void>;
browserReload(tabId: string): Promise<void>;
browserGetTabs(): Promise<BrowserTabSnapshot[]>;

// View management
browserSetBounds(tabId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
browserShowTab(tabId: string): Promise<void>;
browserHideAllTabs(): Promise<void>;

// Interception controls
browserSetInterception(enabled: boolean): Promise<void>;
browserSetCspStripping(enabled: boolean): Promise<void>;
browserUpdateHeaderRules(rules: BrowserHeaderRule[]): Promise<void>;

// Cookies (direct Electron session API access)
browserGetCookies(filter?: { url?: string; domain?: string }): Promise<BrowserCookieEntry[]>;
browserSetCookie(cookie: BrowserCookieSetInput): Promise<void>;
browserDeleteCookie(url: string, name: string): Promise<void>;

// Events
onBrowserEvent(callback: (event: BrowserEvent) => void): () => void;
```

---

## Desktop main process module: `apps/desktop/src/browserManager.ts`

Follows `vpnManager.ts` pattern. Module-level state, exported functions, event listeners.

### State

```typescript
const activeTabs = new Map<string, {
  view: WebContentsView;
  debugger: Electron.Debugger;
  session: Electron.Session;
}>();

let parentWindow: BrowserWindow | null = null;
let backendUrl: string = "";
let backendToken: string = "";
let interceptionEnabled = true;
let cspStrippingEnabled = true;
let headerRules: HeaderRule[] = [];
const stateListeners: Array<(event: BrowserEvent) => void> = [];
```

### Key functions

- `initBrowserManager(window, url, token)` — store refs, set up shared session partition
- `createTab(input)` — create `WebContentsView`, attach CDP debugger, enable Fetch domain, wire navigation events (`did-navigate`, `page-title-updated`, `did-start-loading`, `did-stop-loading`), return snapshot
- `closeTab(tabId)` — detach debugger, remove view from window, delete from map
- `navigateTab(tabId, url)` / `goBack` / `goForward` / `reloadTab`
- `setTabBounds(tabId, bounds)` — `view.setBounds(bounds)`
- `showTab(tabId)` — `parentWindow.contentView.addChildView(view)`, bring to front
- `hideAllTabs()` — `parentWindow.contentView.removeChildView(view)` for all tabs
- `setInterception(enabled)` — toggle Fetch domain enable/disable on all tabs
- `setCspStripping(enabled)` — toggle `session.webRequest.onHeadersReceived` handler
- `updateHeaderRules(rules)` — update rules applied in `onBeforeSendHeaders`/`onHeadersReceived`
- `getTabs()` — return snapshots
- `getCookies(filter)` / `setCookie(cookie)` / `deleteCookie(url, name)` — delegate to `session.cookies`
- `onBrowserEvent(listener)` — register listener, return unsubscribe
- `stopBrowser()` — cleanup all tabs and debuggers

### CDP interception inside `createTab`

```typescript
const cdp = view.webContents.debugger;
cdp.attach("1.3");

await cdp.sendCommand("Fetch.enable", {
  patterns: [
    { urlPattern: "*", requestStage: "Request" },
    { urlPattern: "*", requestStage: "Response" },
  ],
  handleAuthRequests: true,
});

// Also enable Network domain for WebSocket frame observation
await cdp.sendCommand("Network.enable");

cdp.on("message", async (_event, method, params) => {
  if (method === "Fetch.requestPaused") {
    await handleFetchPaused(tabId, cdp, params);
  }
  if (method === "Network.webSocketFrameSent") {
    await handleWsFrame(tabId, "sent", params);
  }
  if (method === "Network.webSocketFrameReceived") {
    await handleWsFrame(tabId, "received", params);
  }
});
```

### Traffic forwarding

```typescript
async function forwardTraffic(entry: TrafficCapturePayload): Promise<void> {
  try {
    await fetch(`${backendUrl}/api/browser/traffic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    // Buffer and retry, or drop silently — main process must not block
  }
}
```

### CSP stripping via `session.webRequest`

```typescript
function applyCspStripping(targetSession: Electron.Session): void {
  targetSession.webRequest.onHeadersReceived(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      if (!cspStrippingEnabled) return callback({});

      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (
          lower === "content-security-policy" ||
          lower === "content-security-policy-report-only" ||
          lower === "x-frame-options" ||
          lower === "x-content-type-options"
        ) {
          delete headers[key];
        }
      }
      headers["Access-Control-Allow-Origin"] = ["*"];
      headers["Access-Control-Allow-Methods"] = ["*"];
      headers["Access-Control-Allow-Headers"] = ["*"];
      callback({ responseHeaders: headers });
    },
  );
}
```

### Self-signed cert handling

```typescript
function configureTargetSession(targetSession: Electron.Session): void {
  // Accept self-signed certs in target session only (CTF boxes often use them)
  targetSession.setCertificateVerifyProc((_request, callback) => {
    callback(0); // Accept all certs in target browsing session
  });
}
```

---

## Server-side implementation

### HTTP endpoint: `/api/browser/traffic` (in `apps/server/src/http.ts`)

New route layer alongside existing routes:

```typescript
export const browserTrafficIngestRouteLayer = HttpRouter.add(
  "POST",
  "/api/browser/traffic",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const service = yield* BrowserTrafficService;
    yield* service.ingestTraffic(body);
    return HttpServerResponse.empty({ status: 204 });
  }),
);
```

### Service interface: `apps/server/src/browser/Services/BrowserTrafficService.ts`

```typescript
export class BrowserTrafficService extends Effect.Service<BrowserTrafficService>()(
  "t3/browser/Services/BrowserTrafficService",
  {
    effect: Effect.gen(function* () {
      // ...implementation
    }),
  },
) {}
```

Methods:
- `ingestTraffic(entry)` — upsert to SQLite (request stage creates row, response stage updates it)
- `queryTraffic(input)` — paginated query, no bodies
- `getTrafficDetail(id)` — full row with bodies
- `replayRequest(input)` — send HTTP request from server process, return response
- `clearTraffic(tabId?)` — delete rows
- `getSiteMap(tabId?)` — aggregate URLs into tree
- `getWsFrames(trafficId)` — query frames table

### Service interface: `apps/server/src/browser/Services/BrowserHeaderRuleService.ts`

CRUD for header rules, persisted in SQLite.

### Layer implementations: `apps/server/src/browser/Layers/`

SQLite implementations using `@effect/sql-sqlite-bun`, following existing persistence patterns.

### RPC handlers in `apps/server/src/ws.ts`

Following metasploit block pattern:

```typescript
// Browser traffic
observeRpcEffect(handlers, rpc.browserGetTraffic, (input) =>
  Effect.gen(function* () {
    const service = yield* BrowserTrafficService;
    return yield* service.queryTraffic(input);
  }),
);
// ... same for all browser RPC methods

// Browser events streaming subscription
observeRpcStream(handlers, rpc.subscribeBrowserEvents, () =>
  Effect.gen(function* () {
    const service = yield* BrowserTrafficService;
    return service.subscribe();
  }),
);
```

### Wire into `apps/server/src/server.ts`

Add `BrowserLayerLive` to `RuntimeDependenciesLive` alongside `MetasploitLayerLive`.

---

## Web UI implementation

### Hack workspace layout change

Current hack layout:
```
HackSidebar → Main: TargetWorkspace (per session)
```

New hack layout:
```
HackSidebar
  ├─ Browser section (tabs, controls)
  ├─ Listeners section (existing)
  └─ Sessions section (existing)

Main area:
  ├─ Browser mode (when sidebar browser tab/item selected)
  │   ├─ BrowserAddressBar + BrowserTabBar
  │   ├─ BrowserViewContainer (WebContentsView overlay)
  │   └─ Bottom panel: TrafficTable + TrafficInspector (resizable split)
  │
  └─ Session mode (when sidebar session selected, existing)
      └─ TargetWorkspace (unchanged)
```

The main content area switches based on what's selected in the sidebar. Selecting a browser tab shows the browser view. Selecting a metasploit session shows TargetWorkspace. This mirrors how code workspace switches between threads.

### Zustand store: `apps/web/src/browserStore.ts`

Following `metasploitStore.ts` pattern:

```typescript
interface BrowserState {
  // Tabs
  tabs: Record<string, BrowserTabSnapshot>;
  activeTabId: string | null;

  // Traffic
  trafficEntries: BrowserTrafficEntry[];
  selectedTrafficId: number | null;
  trafficDetail: BrowserTrafficDetail | null;

  // Site map
  siteMap: BrowserSiteMapNode[];

  // Header rules
  headerRules: BrowserHeaderRule[];

  // Controls
  interceptionEnabled: boolean;
  cspStrippingEnabled: boolean;

  // View mode
  browserVisible: boolean;

  // Actions
  upsertTab(tab: BrowserTabSnapshot): void;
  removeTab(tabId: string): void;
  setActiveTab(tabId: string | null): void;
  appendTraffic(entry: BrowserTrafficEntry): void;
  setTrafficDetail(detail: BrowserTrafficDetail | null): void;
  setSiteMap(nodes: BrowserSiteMapNode[]): void;
  setHeaderRules(rules: BrowserHeaderRule[]): void;
  setInterception(enabled: boolean): void;
  setCspStripping(enabled: boolean): void;
  setBrowserVisible(visible: boolean): void;
}
```

### New components: `apps/web/src/components/browser/`

| Component | Purpose | Est. lines |
|---|---|---|
| `BrowserSidebarSection.tsx` | Sidebar section: tab list, new tab button, browser controls | ~120 |
| `BrowserViewContainer.tsx` | Empty div + ResizeObserver → IPC bounds sync | ~80 |
| `BrowserTabBar.tsx` | Horizontal tab strip with close buttons | ~70 |
| `BrowserAddressBar.tsx` | URL input + back/forward/reload + interception toggle | ~90 |
| `BrowserToolbar.tsx` | CSP stripping toggle, clear traffic, export | ~50 |
| `TrafficTable.tsx` | Virtual-scrolled HTTP history (method, URL, status, type, size, time) | ~200 |
| `TrafficInspector.tsx` | Split view: request tab / response tab, each with headers + body | ~250 |
| `BodyViewer.tsx` | Multi-format body display: JSON (pretty), text, hex, image preview | ~130 |
| `RequestRepeater.tsx` | Method selector, URL input, headers editor, body editor, send button, response view | ~180 |
| `SiteMapTree.tsx` | Tree view: host → path segments → leaf with methods/statuses | ~120 |
| `CookieManager.tsx` | Table with edit/add/delete, export as JSON/Netscape format | ~130 |
| `HeaderRulesManager.tsx` | CRUD table for header manipulation rules | ~150 |
| `WebSocketViewer.tsx` | Table of WS frames for selected connection | ~90 |
| `useBrowserSync.ts` | Hook: subscribes to `subscribeBrowserEvents`, updates store | ~40 |
| `useBrowserBounds.ts` | Hook: ResizeObserver + IPC for view positioning | ~40 |

### Route changes

No new top-level routes needed. The browser view mounts within the existing hack route layout. The hack route's main content area conditionally renders either `TargetWorkspace` (when a session is selected) or the browser view (when a browser tab is active).

Modify: `apps/web/src/routes/hack.tsx` or `apps/web/src/routes/hack.index.tsx` to render the browser when `browserStore.browserVisible && browserStore.activeTabId`.

### HackSidebar modification

Add `BrowserSidebarSection` as a new `SidebarGroup` at the top of `HackSidebar`:

```
SidebarGroup: "Browser"
  ├─ New Tab button (+)
  ├─ Tab list (clickable, shows title/url)
  ├─ Interception toggle
  └─ CSP stripping toggle

SidebarGroup: "Listeners" (existing)
SidebarGroup: "Sessions" (existing)
```

---

## Phased Implementation — Detailed Sub-Plans

Each phase has its own detailed plan file with exact code patterns, file-by-file implementation steps, and acceptance criteria:

| Phase | Plan File | Delivers |
|---|---|---|
| 1 | `19a-browser-phase1-shell.md` | Tabbed browser in hack workspace, navigation, bounds sync |
| 2 | `19b-browser-phase2-traffic.md` | CDP Fetch interception, SQLite storage, real-time traffic table |
| 3 | `19c-browser-phase3-inspector-repeater.md` | Request/response inspector, body viewer, request repeater |
| 4 | `19d-browser-phase4-headers-csp.md` | CSP/CORS stripping toggle, user-defined header rules |
| 5 | `19e-browser-phase5-sitemap-cookies-ws.md` | Passive site map, cookie manager, WebSocket frame viewer |

---

## Phased implementation (summary)

### Phase 1: Browser shell — tabbed browser that navigates

**Goal:** User can open browser tabs, navigate to URLs, see pages render inside hack workspace.

**New files:**
- `packages/contracts/src/browser.ts` — tab schemas, IPC types (branded IDs, BrowserTabSnapshot, inputs)
- `apps/desktop/src/browserManager.ts` — tab lifecycle only (create, close, navigate, bounds, show/hide)
- `apps/web/src/browserStore.ts` — Zustand store (tabs only)
- `apps/web/src/components/browser/BrowserSidebarSection.tsx`
- `apps/web/src/components/browser/BrowserViewContainer.tsx`
- `apps/web/src/components/browser/BrowserTabBar.tsx`
- `apps/web/src/components/browser/BrowserAddressBar.tsx`
- `apps/web/src/components/browser/useBrowserBounds.ts`

**Modified files:**
- `packages/contracts/src/ipc.ts` — add browser methods to DesktopBridge
- `packages/contracts/src/index.ts` — export browser module
- `apps/desktop/src/main.ts` — IPC handlers, initBrowserManager call, quit cleanup
- `apps/desktop/src/preload.ts` — bridge methods
- `apps/web/src/components/hack/HackSidebar.tsx` — add BrowserSidebarSection
- `apps/web/src/routes/hack.tsx` or `hack.index.tsx` — conditional browser view rendering

**Acceptance criteria:**
- [ ] "New Tab" button in hack sidebar creates a browser tab
- [ ] URL bar navigates to entered URL
- [ ] Back/forward/reload buttons work
- [ ] Multiple tabs manageable from sidebar and tab bar
- [ ] Browser view correctly positioned over placeholder div
- [ ] Resizing panels updates browser view bounds
- [ ] Navigating away from hack workspace hides browser views
- [ ] Self-signed certs accepted in target session
- [ ] Target session isolated from Fenrir session

### Phase 2: Traffic interception and history

**Goal:** All HTTP traffic captured and displayed in real-time traffic table.

**New files:**
- `apps/server/src/persistence/Migrations/024_BrowserTraffic.ts`
- `apps/server/src/browser/Services/BrowserTrafficService.ts`
- `apps/server/src/browser/Layers/BrowserTrafficService.ts`
- `apps/web/src/components/browser/TrafficTable.tsx`
- `apps/web/src/components/browser/useBrowserSync.ts`

**Modified files:**
- `packages/contracts/src/browser.ts` — traffic schemas, event schemas, error classes
- `packages/contracts/src/rpc.ts` — browser RPC methods, WsRpcGroup additions
- `apps/desktop/src/browserManager.ts` — CDP Fetch domain, traffic forwarding to server
- `apps/server/src/http.ts` — `/api/browser/traffic` POST endpoint
- `apps/server/src/ws.ts` — browser RPC handlers
- `apps/server/src/server.ts` — wire BrowserLayerLive
- `apps/server/src/persistence/Migrations.ts` — register migration 024
- `apps/web/src/rpc/wsRpcClient.ts` — add browser RPC namespace

**Acceptance criteria:**
- [ ] CDP Fetch domain enabled on all browser tabs
- [ ] Every HTTP request/response captured with headers and body
- [ ] Traffic table shows real-time entries (method, URL, status, type, size, time)
- [ ] Virtual scrolling handles hundreds of entries without lag
- [ ] Body size limit (10MB) prevents OOM
- [ ] Traffic persisted in SQLite across app restarts
- [ ] Clear traffic button works

### Phase 3: Request inspector and repeater

**Goal:** User can inspect any captured request in detail and replay modified requests.

**New files:**
- `apps/web/src/components/browser/TrafficInspector.tsx`
- `apps/web/src/components/browser/BodyViewer.tsx`
- `apps/web/src/components/browser/RequestRepeater.tsx`

**Modified files:**
- `packages/contracts/src/browser.ts` — replay input schema
- `packages/contracts/src/rpc.ts` — browserReplayRequest
- `apps/server/src/browser/Layers/BrowserTrafficService.ts` — replayRequest implementation
- `apps/server/src/ws.ts` — replay RPC handler

**Acceptance criteria:**
- [ ] Clicking a traffic row opens inspector panel
- [ ] Inspector shows request headers, response headers in formatted view
- [ ] Body viewer supports JSON (pretty-printed), raw text, hex dump, image preview
- [ ] "Send to Repeater" button opens repeater with pre-filled request
- [ ] Repeater allows editing method, URL, headers, body
- [ ] Repeater sends request from server process (bypasses CORS)
- [ ] Repeater response displayed in same format as inspector

### Phase 4: Header rules and CSP stripping

**Goal:** User can strip security headers and define custom header manipulation rules.

**New files:**
- `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.ts`
- `apps/server/src/browser/Services/BrowserHeaderRuleService.ts`
- `apps/server/src/browser/Layers/BrowserHeaderRuleService.ts`
- `apps/web/src/components/browser/HeaderRulesManager.tsx`
- `apps/web/src/components/browser/BrowserToolbar.tsx`

**Modified files:**
- `packages/contracts/src/browser.ts` — header rule schemas
- `packages/contracts/src/rpc.ts` — header rule CRUD methods
- `apps/desktop/src/browserManager.ts` — session.webRequest handlers for rules + CSP
- `apps/server/src/persistence/Migrations.ts` — register migration 025
- `apps/server/src/ws.ts` — header rule RPC handlers
- `apps/web/src/components/browser/BrowserSidebarSection.tsx` — CSP toggle control

**Acceptance criteria:**
- [ ] CSP stripping toggle removes content-security-policy, x-frame-options, x-content-type-options
- [ ] CSP stripping also overrides CORS headers to be fully permissive
- [ ] User can create header rules: add, modify, or remove headers
- [ ] Rules can target request or response direction
- [ ] Rules support URL pattern matching (glob)
- [ ] Rules have priority ordering
- [ ] Rules persist across app restarts

### Phase 5: Site map, cookies, WebSocket viewer

**Goal:** Full Burp-essential feature parity for CTF workflows.

**New files:**
- `apps/server/src/persistence/Migrations/026_BrowserWsFrames.ts`
- `apps/web/src/components/browser/SiteMapTree.tsx`
- `apps/web/src/components/browser/CookieManager.tsx`
- `apps/web/src/components/browser/WebSocketViewer.tsx`

**Modified files:**
- `packages/contracts/src/browser.ts` — site map, cookie, WS frame schemas
- `packages/contracts/src/rpc.ts` — getSiteMap, cookie CRUD, getWsFrames
- `apps/desktop/src/browserManager.ts` — CDP Network domain for WS frames
- `apps/server/src/persistence/Migrations.ts` — register migration 026
- `apps/server/src/browser/Layers/BrowserTrafficService.ts` — site map aggregation, WS frame storage
- `apps/server/src/ws.ts` — new RPC handlers
- `apps/web/src/components/hack/HackSidebar.tsx` — site map tree in sidebar

**Acceptance criteria:**
- [ ] Site map auto-builds from captured traffic
- [ ] Tree organized: host → path segments → leaf with observed methods/statuses
- [ ] Cookie manager shows all cookies for target session
- [ ] Cookies editable (name, value, domain, path, flags)
- [ ] Cookie export as JSON
- [ ] WebSocket connections identified in traffic table
- [ ] Clicking WS entry shows frame-level viewer
- [ ] WS frames show direction (sent/received), opcode, payload, timestamp

---

## Risks and mitigations

### Bounds sync lag
WebContentsView is native — position updates may lag behind React panel resizing.
**Mitigation:** ResizeObserver + requestAnimationFrame at 16ms. IntersectionObserver for visibility. Immediate hide on route change.

### Memory pressure from body capture
CDP getResponseBody returns full body as base64.
**Mitigation:** 10MB cap, `bodyTruncated` flag, optional binary content type exclusion. Bodies stored as BLOB in SQLite (not in memory).

### CDP single debugger attachment
Only one debugger client per webContents. If user opens DevTools, interception stops.
**Mitigation:** Detect debugger detach, show UI warning, allow re-attach. Consider using DevTools protocol via remote debugging port instead of electron debugger API as a future alternative.

### Traffic volume vs SQLite performance
Active browsing = hundreds of requests per page.
**Mitigation:** Virtual scrolling (TanStack Virtual already in deps), LIMIT/OFFSET pagination, DESC index on created_at, configurable auto-cleanup (delete traffic older than N hours).

### Main process blocking
CDP handlers + HTTP POST must not block Electron's main process.
**Mitigation:** Async forwarding. Buffer entries and batch-POST every 100ms under high load. Use `setImmediate` to yield between captures.

### Request/response correlation
CDP Fetch fires separately for request stage and response stage. Need to correlate them into one traffic row.
**Mitigation:** Use `networkId` (or `requestId`) as the correlation key. Request stage creates the row (INSERT), response stage updates it (UPDATE WHERE request_id = ?).

---

## Integration with existing features

### VPN
When connected to HTB VPN via vpnManager, browser traffic automatically routes through VPN tunnel. Zero additional work — Chromium uses OS network stack.

### Terminal
User browses target in browser view, spots a path, switches to terminal to run gobuster/sqlmap against it. Both visible in hack workspace.

### Metasploit
After finding a vulnerability via browser inspection, user can switch to a metasploit session in the same workspace. Future enhancement: "Send to Metasploit" context menu on captured requests.

### Agent
Captured traffic and site map could feed context to the coding agent. Future enhancement: "Analyze with Agent" sends traffic/sitemap as context to Claude.

---

## File inventory

### New files (25 total)

**Contracts (1):**
- `packages/contracts/src/browser.ts`

**Desktop (1):**
- `apps/desktop/src/browserManager.ts`

**Server (6):**
- `apps/server/src/browser/Services/BrowserTrafficService.ts`
- `apps/server/src/browser/Services/BrowserHeaderRuleService.ts`
- `apps/server/src/browser/Layers/BrowserTrafficService.ts`
- `apps/server/src/browser/Layers/BrowserHeaderRuleService.ts`
- `apps/server/src/persistence/Migrations/024_BrowserTraffic.ts`
- `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.ts`
- `apps/server/src/persistence/Migrations/026_BrowserWsFrames.ts`

**Web UI (15):**
- `apps/web/src/browserStore.ts`
- `apps/web/src/components/browser/BrowserSidebarSection.tsx`
- `apps/web/src/components/browser/BrowserViewContainer.tsx`
- `apps/web/src/components/browser/BrowserTabBar.tsx`
- `apps/web/src/components/browser/BrowserAddressBar.tsx`
- `apps/web/src/components/browser/BrowserToolbar.tsx`
- `apps/web/src/components/browser/TrafficTable.tsx`
- `apps/web/src/components/browser/TrafficInspector.tsx`
- `apps/web/src/components/browser/BodyViewer.tsx`
- `apps/web/src/components/browser/RequestRepeater.tsx`
- `apps/web/src/components/browser/SiteMapTree.tsx`
- `apps/web/src/components/browser/CookieManager.tsx`
- `apps/web/src/components/browser/HeaderRulesManager.tsx`
- `apps/web/src/components/browser/WebSocketViewer.tsx`
- `apps/web/src/components/browser/useBrowserSync.ts`
- `apps/web/src/components/browser/useBrowserBounds.ts`

### Modified files (14 total)

- `packages/contracts/src/index.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/rpc.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- `apps/server/src/http.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/server.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/web/src/rpc/wsRpcClient.ts`
- `apps/web/src/components/hack/HackSidebar.tsx`
- `apps/web/src/routes/hack.tsx`

### Estimated total new code: ~3,200 lines
