# Phase 5: Site Map, Cookies, WebSocket Viewer

**Parent plan:** `19-embedded-security-browser.md`
**Depends on:** Phase 2 (traffic storage), Phase 1 (session/cookies)
**Delivers:** Passive site map from traffic. Cookie manager. WebSocket frame viewer.

---

## Goal

Complete the Burp-essential feature set. Site map auto-builds a tree from captured traffic. Cookie manager gives full control over target session cookies. WebSocket viewer shows individual frames for WS connections.

---

## Step 1: SQLite Migration — `apps/server/src/persistence/Migrations/026_BrowserWsFrames.ts` (NEW FILE)

```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_ws_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traffic_id INTEGER NOT NULL REFERENCES browser_traffic(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
      opcode INTEGER NOT NULL,
      payload BLOB,
      payload_length INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_bwf_traffic ON browser_ws_frames(traffic_id)`;
});
```

Register in `Migrations.ts`:
```typescript
import Migration0026 from "./Migrations/026_BrowserWsFrames";
[26, "BrowserWsFrames", Migration0026],
```

---

## Step 2: Contracts — Extend `packages/contracts/src/browser.ts`

### Site map schema

```typescript
export const BrowserSiteMapNode = Schema.Struct({
  host: Schema.String,
  path: Schema.String,
  children: Schema.Array(Schema.suspend(() => BrowserSiteMapNode)),
  methods: Schema.Array(Schema.String),       // ["GET", "POST"] observed
  statusCodes: Schema.Array(Schema.Number),   // [200, 301, 404] observed
  requestCount: Schema.Number,
});
export type BrowserSiteMapNode = typeof BrowserSiteMapNode.Type;
```

> **Note:** `Schema.suspend` for recursive type — verify this works with Effect Schema. If not, flatten to non-recursive:

```typescript
// Flat alternative (simpler):
export const BrowserSiteMapEntry = Schema.Struct({
  host: Schema.String,
  path: Schema.String,
  methods: Schema.Array(Schema.String),
  statusCodes: Schema.Array(Schema.Number),
  requestCount: Schema.Number,
});
export type BrowserSiteMapEntry = typeof BrowserSiteMapEntry.Type;
```

The UI builds the tree client-side from flat entries. Simpler and avoids recursive schema issues.

### Cookie schema

```typescript
export const BrowserCookieEntry = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  httpOnly: Schema.Boolean,
  secure: Schema.Boolean,
  sameSite: Schema.String,
  expirationDate: Schema.optional(Schema.Number),
  session: Schema.Boolean,
});
export type BrowserCookieEntry = typeof BrowserCookieEntry.Type;

export const BrowserCookieSetInput = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
  value: Schema.String,
  domain: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  httpOnly: Schema.optional(Schema.Boolean),
  secure: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.Literal("unspecified", "no_restriction", "lax", "strict")),
  expirationDate: Schema.optional(Schema.Number),
});
export type BrowserCookieSetInput = typeof BrowserCookieSetInput.Type;
```

### WebSocket frame schema

```typescript
export const BrowserWebSocketFrame = Schema.Struct({
  id: Schema.Number,
  trafficId: Schema.Number,
  direction: Schema.Literal("sent", "received"),
  opcode: Schema.Number,
  payload: Schema.NullOr(Schema.String), // base64
  payloadLength: Schema.Number,
  timestamp: Schema.String,
});
export type BrowserWebSocketFrame = typeof BrowserWebSocketFrame.Type;
```

### WebSocket frame event

```typescript
export const BrowserWebSocketFrameEvent = Schema.Struct({
  type: Schema.Literal("ws.frame"),
  trafficId: Schema.Number,
  frame: BrowserWebSocketFrame,
});
```

Add to `BrowserEvent` union.

---

## Step 3: RPC Definitions

### Add to `WS_METHODS`

```typescript
browserGetSiteMap: "browser.getSiteMap",
browserGetCookies: "browser.getCookies",
browserSetCookie: "browser.setCookie",
browserDeleteCookie: "browser.deleteCookie",
browserExportCookies: "browser.exportCookies",
browserGetWsFrames: "browser.getWsFrames",
```

### Add RPC definitions

```typescript
export const WsBrowserGetSiteMapRpc = Rpc.make(WS_METHODS.browserGetSiteMap, {
  payload: Schema.Struct({ tabId: Schema.optional(Schema.String) }),
  success: Schema.Array(BrowserSiteMapEntry),
  error: BrowserError,
});

export const WsBrowserGetCookiesRpc = Rpc.make(WS_METHODS.browserGetCookies, {
  payload: Schema.Struct({
    url: Schema.optional(Schema.String),
    domain: Schema.optional(Schema.String),
  }),
  success: Schema.Array(BrowserCookieEntry),
  error: BrowserError,
});

export const WsBrowserSetCookieRpc = Rpc.make(WS_METHODS.browserSetCookie, {
  payload: BrowserCookieSetInput,
  error: BrowserError,
});

export const WsBrowserDeleteCookieRpc = Rpc.make(WS_METHODS.browserDeleteCookie, {
  payload: Schema.Struct({ url: Schema.String, name: Schema.String }),
  error: BrowserError,
});

export const WsBrowserExportCookiesRpc = Rpc.make(WS_METHODS.browserExportCookies, {
  payload: Schema.Struct({}),
  success: Schema.Array(BrowserCookieEntry),
  error: BrowserError,
});

export const WsBrowserGetWsFramesRpc = Rpc.make(WS_METHODS.browserGetWsFrames, {
  payload: Schema.Struct({ trafficId: Schema.Number }),
  success: Schema.Array(BrowserWebSocketFrame),
  error: BrowserError,
});
```

Add all to `WsRpcGroup`.

---

## Step 4: Server — Site Map Aggregation

### Add to `BrowserTrafficService` interface

```typescript
declare getSiteMap: (tabId?: string) => Effect.Effect<readonly BrowserSiteMapEntry[]>;
declare ingestWsFrame: (frame: { trafficId: number; direction: string; opcode: number; payload?: string; payloadLength: number; timestamp: string }) => Effect.Effect<void>;
declare getWsFrames: (trafficId: number) => Effect.Effect<readonly BrowserWebSocketFrame[]>;
```

### Add to `BrowserTrafficServiceLive`

```typescript
getSiteMap: (tabId) =>
  Effect.gen(function* () {
    const whereClause = tabId ? sql`WHERE tab_id = ${tabId}` : sql``;
    const rows = yield* sql`
      SELECT
        host,
        path,
        GROUP_CONCAT(DISTINCT method) as methods,
        GROUP_CONCAT(DISTINCT status_code) as "statusCodes",
        COUNT(*) as "requestCount"
      FROM browser_traffic
      ${whereClause}
      GROUP BY host, path
      ORDER BY host, path
    `;

    return rows.map((r) => ({
      host: r.host,
      path: r.path,
      methods: r.methods ? r.methods.split(",") : [],
      statusCodes: r.statusCodes
        ? r.statusCodes.split(",").map(Number).filter(Boolean)
        : [],
      requestCount: Number(r.requestCount),
    }));
  }),

ingestWsFrame: (frame) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO browser_ws_frames (
        traffic_id, direction, opcode, payload, payload_length, timestamp
      ) VALUES (
        ${frame.trafficId},
        ${frame.direction},
        ${frame.opcode},
        ${frame.payload ?? null},
        ${frame.payloadLength},
        ${frame.timestamp}
      )
    `;
  }),

getWsFrames: (trafficId) =>
  Effect.gen(function* () {
    return yield* sql`
      SELECT
        id, traffic_id as "trafficId",
        direction, opcode,
        payload, payload_length as "payloadLength",
        timestamp
      FROM browser_ws_frames
      WHERE traffic_id = ${trafficId}
      ORDER BY timestamp ASC
    `;
  }),
```

---

## Step 5: Cookie Operations — Server Delegates to Desktop via IPC

Cookies live in Electron's session (main process), not in SQLite. Server RPC handlers need to delegate to main process. Two approaches:

### Approach A: Direct IPC from UI (simpler for Phase 5)

Cookie operations go directly from React → IPC → main process, bypassing server RPC entirely. This is the simpler approach and matches how tab lifecycle already works.

Add IPC methods already defined in Phase 1 contracts:
```typescript
browserGetCookies: (filter?) => Promise<BrowserCookieEntry[]>;
browserSetCookie: (cookie: BrowserCookieSetInput) => Promise<void>;
browserDeleteCookie: (url: string, name: string) => Promise<void>;
```

### Desktop implementation in `browserManager.ts`

```typescript
export async function getCookies(filter?: { url?: string; domain?: string }): Promise<BrowserCookieEntry[]> {
  if (!targetSession) return [];
  const electronCookies = await targetSession.cookies.get(filter ?? {});
  return electronCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? "",
    path: c.path ?? "/",
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? false,
    sameSite: c.sameSite ?? "unspecified",
    expirationDate: c.expirationDate,
    session: c.session ?? false,
  }));
}

export async function setCookie(input: {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
  expirationDate?: number;
}): Promise<void> {
  if (!targetSession) throw new Error("Browser not initialized");
  await targetSession.cookies.set(input);
}

export async function deleteCookie(url: string, name: string): Promise<void> {
  if (!targetSession) throw new Error("Browser not initialized");
  await targetSession.cookies.remove(url, name);
}
```

### IPC handlers in main.ts

```typescript
const BROWSER_GET_COOKIES_CHANNEL = "desktop:browser-get-cookies";
const BROWSER_SET_COOKIE_CHANNEL = "desktop:browser-set-cookie";
const BROWSER_DELETE_COOKIE_CHANNEL = "desktop:browser-delete-cookie";

ipcMain.removeHandler(BROWSER_GET_COOKIES_CHANNEL);
ipcMain.handle(BROWSER_GET_COOKIES_CHANNEL, async (_event, filter: unknown) => {
  return getCookies(filter as any);
});

ipcMain.removeHandler(BROWSER_SET_COOKIE_CHANNEL);
ipcMain.handle(BROWSER_SET_COOKIE_CHANNEL, async (_event, cookie: unknown) => {
  if (typeof cookie !== "object" || cookie === null) throw new Error("Invalid cookie.");
  await setCookie(cookie as any);
});

ipcMain.removeHandler(BROWSER_DELETE_COOKIE_CHANNEL);
ipcMain.handle(BROWSER_DELETE_COOKIE_CHANNEL, async (_event, url: unknown, name: unknown) => {
  if (typeof url !== "string" || typeof name !== "string") throw new Error("Invalid input.");
  await deleteCookie(url, name);
});
```

### Preload bridge additions

```typescript
browserGetCookies: (filter?: { url?: string; domain?: string }) =>
  ipcRenderer.invoke(BROWSER_GET_COOKIES_CHANNEL, filter),
browserSetCookie: (cookie: Record<string, unknown>) =>
  ipcRenderer.invoke(BROWSER_SET_COOKIE_CHANNEL, cookie),
browserDeleteCookie: (url: string, name: string) =>
  ipcRenderer.invoke(BROWSER_DELETE_COOKIE_CHANNEL, url, name),
```

---

## Step 6: WebSocket Frame Capture in Desktop

### Modify `browserManager.ts` — CDP event handler

In the `cdp.on("message", ...)` handler (already set up in Phase 2):

```typescript
if (method === "Network.webSocketCreated") {
  // Mark the traffic entry as WebSocket
  const { requestId, url } = params;
  // Could forward a special marker to server
}

if (method === "Network.webSocketFrameSent") {
  const { requestId, timestamp, response } = params;
  void forwardWsFrame({
    requestId,
    direction: "sent",
    opcode: response.opcode,
    payload: response.payloadData
      ? Buffer.from(response.payloadData).toString("base64")
      : null,
    payloadLength: response.payloadData?.length ?? 0,
    timestamp: new Date(timestamp * 1000).toISOString(),
  });
}

if (method === "Network.webSocketFrameReceived") {
  const { requestId, timestamp, response } = params;
  void forwardWsFrame({
    requestId,
    direction: "received",
    opcode: response.opcode,
    payload: response.payloadData
      ? Buffer.from(response.payloadData).toString("base64")
      : null,
    payloadLength: response.payloadData?.length ?? 0,
    timestamp: new Date(timestamp * 1000).toISOString(),
  });
}
```

### Add `forwardWsFrame` function

```typescript
async function forwardWsFrame(frame: {
  requestId: string;
  direction: string;
  opcode: number;
  payload: string | null;
  payloadLength: number;
  timestamp: string;
}): Promise<void> {
  try {
    await fetch(`${backendUrl}/api/browser/ws-frame`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
      body: JSON.stringify(frame),
    });
  } catch {
    // swallow
  }
}
```

### Add HTTP endpoint for WS frame ingest

In `apps/server/src/http.ts`:

```typescript
export const browserWsFrameIngestRouteLayer = HttpRouter.add(
  "POST",
  "/api/browser/ws-frame",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const service = yield* BrowserTrafficService;
    // Need to resolve requestId → trafficId
    // The frame comes with CDP requestId, need to look up traffic row
    yield* service.ingestWsFrame(body as any);
    return HttpServerResponse.empty({ status: 204 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
```

> **Note:** WS frame ingest needs requestId → trafficId resolution. May need to add a lookup method to BrowserTrafficService or include trafficId in the forward payload.

---

## Step 7: UI Components

### `apps/web/src/components/browser/SiteMapTree.tsx` (NEW FILE)

Tree view built client-side from flat site map entries.

```typescript
import { useEffect, useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Globe, Folder, FileText } from "lucide-react";
import { useEnvironmentApi } from "../../environmentApi";
import { cn } from "../../lib/utils";
import type { BrowserSiteMapEntry } from "@t3/contracts";

interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  methods?: string[];
  statusCodes?: number[];
  requestCount?: number;
  isLeaf: boolean;
}

function buildTree(entries: BrowserSiteMapEntry[]): TreeNode[] {
  const hosts = new Map<string, BrowserSiteMapEntry[]>();
  for (const entry of entries) {
    const list = hosts.get(entry.host) ?? [];
    list.push(entry);
    hosts.set(entry.host, list);
  }

  return Array.from(hosts.entries()).map(([host, hostEntries]) => {
    const root: TreeNode = {
      name: host,
      fullPath: host,
      children: [],
      isLeaf: false,
    };

    for (const entry of hostEntries) {
      const segments = entry.path.split("/").filter(Boolean);
      let current = root;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let child = current.children.find((c) => c.name === seg);
        if (!child) {
          child = {
            name: seg,
            fullPath: "/" + segments.slice(0, i + 1).join("/"),
            children: [],
            isLeaf: i === segments.length - 1,
            methods: i === segments.length - 1 ? entry.methods : undefined,
            statusCodes: i === segments.length - 1 ? entry.statusCodes : undefined,
            requestCount: i === segments.length - 1 ? entry.requestCount : undefined,
          };
          current.children.push(child);
        }
        current = child;
      }
    }

    return root;
  });
}

export function SiteMapTree() {
  const api = useEnvironmentApi();
  const [entries, setEntries] = useState<BrowserSiteMapEntry[]>([]);

  useEffect(() => {
    api?.rpc.browser.getSiteMap({}).then(setEntries).catch(() => {});
    // Refresh periodically or on traffic events
    const interval = setInterval(() => {
      api?.rpc.browser.getSiteMap({}).then(setEntries).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [api]);

  const tree = useMemo(() => buildTree(entries), [entries]);

  return (
    <div className="overflow-auto text-xs">
      {tree.map((node) => (
        <TreeNodeView key={node.name} node={node} depth={0} />
      ))}
      {tree.length === 0 && (
        <div className="p-2 text-muted-foreground">No traffic captured yet</div>
      )}
    </div>
  );
}

function TreeNodeView({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 px-1 py-0.5 hover:bg-muted/50"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setExpanded(!expanded)}
      >
        {node.children.length > 0 ? (
          expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
        ) : (
          <span className="w-3" />
        )}
        {depth === 0 ? (
          <Globe className="h-3 w-3 text-blue-400" />
        ) : node.isLeaf ? (
          <FileText className="h-3 w-3 text-muted-foreground" />
        ) : (
          <Folder className="h-3 w-3 text-yellow-400" />
        )}
        <span className="truncate">{node.name}</span>
        {node.methods && (
          <span className="ml-auto text-muted-foreground">
            {node.methods.join(", ")} ({node.requestCount})
          </span>
        )}
      </div>
      {expanded && node.children.map((child) => (
        <TreeNodeView key={child.fullPath} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
```

### `apps/web/src/components/browser/CookieManager.tsx` (NEW FILE)

Table with add/edit/delete. Communicates via IPC directly.

```typescript
import { useEffect, useState } from "react";
import { Trash2, Plus, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { BrowserCookieEntry } from "@t3/contracts";

export function CookieManager() {
  const [cookies, setCookies] = useState<BrowserCookieEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await window.desktopBridge?.browserGetCookies();
      setCookies(result ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleDelete = async (cookie: BrowserCookieEntry) => {
    const protocol = cookie.secure ? "https" : "http";
    const url = `${protocol}://${cookie.domain}${cookie.path}`;
    await window.desktopBridge?.browserDeleteCookie(url, cookie.name);
    void refresh();
  };

  const handleExport = () => {
    const json = JSON.stringify(cookies, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cookies.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <span className="text-xs font-medium">Cookies</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void refresh()}>
          <RefreshCw className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleExport}>
          Export
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50">
            <tr className="border-b">
              <th className="px-2 py-1 text-left font-medium">Name</th>
              <th className="px-2 py-1 text-left font-medium">Value</th>
              <th className="px-2 py-1 text-left font-medium">Domain</th>
              <th className="px-2 py-1 text-left font-medium">Path</th>
              <th className="px-2 py-1 text-left font-medium">Flags</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {cookies.map((cookie, i) => (
              <tr key={`${cookie.domain}-${cookie.name}-${i}`} className="border-b hover:bg-muted/30">
                <td className="px-2 py-0.5 font-mono">{cookie.name}</td>
                <td className="max-w-48 truncate px-2 py-0.5 font-mono">{cookie.value}</td>
                <td className="px-2 py-0.5">{cookie.domain}</td>
                <td className="px-2 py-0.5">{cookie.path}</td>
                <td className="px-2 py-0.5">
                  {cookie.httpOnly && <span className="mr-1 rounded bg-muted px-1">HttpOnly</span>}
                  {cookie.secure && <span className="mr-1 rounded bg-muted px-1">Secure</span>}
                  {cookie.sameSite !== "unspecified" && (
                    <span className="rounded bg-muted px-1">{cookie.sameSite}</span>
                  )}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => void handleDelete(cookie)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cookies.length === 0 && !loading && (
          <div className="p-4 text-center text-muted-foreground">No cookies</div>
        )}
      </div>

      <div className="border-t px-2 py-0.5 text-xs text-muted-foreground">
        {cookies.length} cookies
      </div>
    </div>
  );
}
```

### `apps/web/src/components/browser/WebSocketViewer.tsx` (NEW FILE)

Frame table for a specific WS connection.

```typescript
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { useEnvironmentApi } from "../../environmentApi";
import { cn } from "../../lib/utils";
import type { BrowserWebSocketFrame } from "@t3/contracts";

interface WebSocketViewerProps {
  trafficId: number;
}

const OPCODE_LABELS: Record<number, string> = {
  0: "Continuation",
  1: "Text",
  2: "Binary",
  8: "Close",
  9: "Ping",
  10: "Pong",
};

export function WebSocketViewer({ trafficId }: WebSocketViewerProps) {
  const api = useEnvironmentApi();
  const [frames, setFrames] = useState<BrowserWebSocketFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<BrowserWebSocketFrame | null>(null);

  useEffect(() => {
    api?.rpc.browser.getWsFrames({ trafficId }).then(setFrames).catch(() => {});
    // Poll for new frames
    const interval = setInterval(() => {
      api?.rpc.browser.getWsFrames({ trafficId }).then(setFrames).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [trafficId, api]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-2 py-1 text-xs font-medium">
        WebSocket Frames ({frames.length})
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Frame list */}
        <div className="flex w-1/2 flex-col overflow-auto border-r">
          {frames.map((frame) => (
            <div
              key={frame.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2 py-0.5 text-xs hover:bg-muted/50",
                selectedFrame?.id === frame.id && "bg-accent",
              )}
              onClick={() => setSelectedFrame(frame)}
            >
              {frame.direction === "sent" ? (
                <ArrowUp className="h-3 w-3 text-green-500" />
              ) : (
                <ArrowDown className="h-3 w-3 text-blue-500" />
              )}
              <span className="text-muted-foreground">
                {OPCODE_LABELS[frame.opcode] ?? `op:${frame.opcode}`}
              </span>
              <span className="truncate font-mono">
                {frame.payload ? atob(frame.payload).slice(0, 100) : "(empty)"}
              </span>
              <span className="ml-auto text-muted-foreground">
                {frame.payloadLength}B
              </span>
            </div>
          ))}
        </div>

        {/* Frame detail */}
        <div className="flex w-1/2 flex-col overflow-auto p-2">
          {selectedFrame ? (
            <>
              <div className="text-xs text-muted-foreground">
                {selectedFrame.direction === "sent" ? "Sent" : "Received"} at{" "}
                {new Date(selectedFrame.timestamp).toLocaleTimeString()} —{" "}
                {OPCODE_LABELS[selectedFrame.opcode]} —{" "}
                {selectedFrame.payloadLength} bytes
              </div>
              <pre className="mt-1 flex-1 overflow-auto whitespace-pre-wrap rounded border bg-muted/20 p-2 font-mono text-xs">
                {selectedFrame.payload ? atob(selectedFrame.payload) : "(empty)"}
              </pre>
            </>
          ) : (
            <div className="flex items-center justify-center text-xs text-muted-foreground">
              Select a frame
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Step 8: Sidebar Integration — Site Map

Add `SiteMapTree` to `HackSidebar.tsx` as a new sidebar group:

```typescript
import { SiteMapTree } from "../browser/SiteMapTree";

// Inside HackSidebar, after BrowserSidebarSection:
<SidebarGroup>
  <SidebarGroupLabel>Site Map</SidebarGroupLabel>
  <SidebarGroupContent>
    <SiteMapTree />
  </SidebarGroupContent>
</SidebarGroup>
```

---

## Step 9: Bottom Panel Integration

The bottom panel (from Phase 3) gains tabs for Cookies and WebSocket viewer:

```typescript
// Tab options in bottom panel:
// [Traffic] [Inspector] [Repeater] [Cookies] [WS Frames]

// When traffic entry is a WebSocket connection and user clicks it:
{selectedEntry?.isWebSocket ? (
  <WebSocketViewer trafficId={selectedEntry.id} />
) : selectedTrafficId ? (
  <TrafficInspector ... />
) : (
  <TrafficTable ... />
)}

// Cookies accessible via a tab button:
{activeBottomTab === "cookies" && <CookieManager />}
```

---

## Acceptance Criteria

### Site Map
- [ ] Site map auto-builds from captured traffic
- [ ] Tree organized: host → path segments → leaf
- [ ] Leaf nodes show observed methods and status codes
- [ ] Request count per endpoint visible
- [ ] Tree refreshes as new traffic captured
- [ ] Expandable/collapsible nodes

### Cookies
- [ ] Cookie manager shows all cookies from target session
- [ ] Cookies display: name, value, domain, path, flags (HttpOnly, Secure, SameSite)
- [ ] Delete individual cookies
- [ ] Export all cookies as JSON file
- [ ] Refresh button reloads cookie list
- [ ] Cookie operations go via IPC to Electron session API

### WebSocket
- [ ] WebSocket connections identified in traffic table (isWebSocket flag)
- [ ] Clicking WS traffic entry shows frame viewer
- [ ] Frames show direction (sent ↑ green, received ↓ blue)
- [ ] Frames show opcode label (Text, Binary, Close, Ping, Pong)
- [ ] Frame payload displayed (text for Text frames)
- [ ] Frame size and timestamp shown
- [ ] CDP Network.webSocketFrameSent/Received events captured
- [ ] Frames stored in browser_ws_frames table

---

## Files Summary

**New files (4):**
1. `apps/server/src/persistence/Migrations/026_BrowserWsFrames.ts`
2. `apps/web/src/components/browser/SiteMapTree.tsx`
3. `apps/web/src/components/browser/CookieManager.tsx`
4. `apps/web/src/components/browser/WebSocketViewer.tsx`

**Modified files (11):**
1. `packages/contracts/src/browser.ts` — site map, cookie, WS frame schemas
2. `packages/contracts/src/ipc.ts` — cookie IPC methods
3. `packages/contracts/src/rpc.ts` — site map, cookie, WS frame RPCs
4. `apps/desktop/src/browserManager.ts` — cookie functions, WS frame capture via CDP Network domain
5. `apps/desktop/src/preload.ts` — cookie bridge methods
6. `apps/desktop/src/main.ts` — cookie IPC handlers
7. `apps/server/src/persistence/Migrations.ts` — register migration 026
8. `apps/server/src/http.ts` — WS frame ingest endpoint
9. `apps/server/src/browser/Layers/BrowserTrafficService.ts` — getSiteMap, ingestWsFrame, getWsFrames
10. `apps/server/src/ws.ts` — site map + WS frame RPC handlers
11. `apps/web/src/rpc/wsRpcClient.ts` — site map, cookie, WS frame methods
12. `apps/web/src/components/hack/HackSidebar.tsx` — site map tree in sidebar
13. `apps/web/src/routes/hack.tsx` — cookie + WS viewer tabs in bottom panel

---

## Test Plan

### Test File: `apps/server/src/persistence/Migrations/026_BrowserWsFrames.test.ts`

Migration schema test.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient";
import { runMigrations } from "../Migrations";

const layer = it.layer(NodeSqliteClient.layerMemory());

layer("026_BrowserWsFrames", (it) => {
  it.effect("creates browser_ws_frames table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 26 });

      const columns = yield* sql<{ name: string }>`PRAGMA table_info(browser_ws_frames)`;
      const colNames = columns.map((c) => c.name);

      assert.include(colNames, "id");
      assert.include(colNames, "traffic_id");
      assert.include(colNames, "direction");
      assert.include(colNames, "opcode");
      assert.include(colNames, "payload");
      assert.include(colNames, "payload_length");
      assert.include(colNames, "timestamp");
    }),
  );

  it.effect("enforces direction CHECK constraint", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 26 });

      // First create a parent traffic row
      yield* sql`
        INSERT INTO browser_traffic (tab_id, request_id, method, url, host, path, request_headers_json, timing_started_at, is_websocket)
        VALUES ('t1', 'ws-1', 'GET', 'wss://target.htb/ws', 'target.htb', '/ws', '{}', '2026-01-01T00:00:00Z', 1)
      `;

      const result = yield* Effect.either(sql`
        INSERT INTO browser_ws_frames (traffic_id, direction, opcode, payload_length, timestamp)
        VALUES (1, 'invalid_direction', 1, 0, '2026-01-01T00:00:00Z')
      `);
      assert.isTrue(result._tag === "Left");
    }),
  );

  it.effect("cascades delete from parent traffic row", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 26 });

      yield* sql`
        INSERT INTO browser_traffic (tab_id, request_id, method, url, host, path, request_headers_json, timing_started_at, is_websocket)
        VALUES ('t1', 'ws-2', 'GET', 'wss://target.htb/ws', 'target.htb', '/ws', '{}', '2026-01-01T00:00:00Z', 1)
      `;
      yield* sql`
        INSERT INTO browser_ws_frames (traffic_id, direction, opcode, payload_length, timestamp)
        VALUES (1, 'sent', 1, 5, '2026-01-01T00:00:01Z')
      `;

      yield* sql`DELETE FROM browser_traffic WHERE request_id = 'ws-2'`;

      const frames = yield* sql`SELECT * FROM browser_ws_frames WHERE traffic_id = 1`;
      assert.equal(frames.length, 0);
    }),
  );
});
```

---

### Test File: `apps/server/src/browser/Layers/BrowserTrafficService.sitemap.test.ts`

Site map aggregation test.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient";
import { runMigrations } from "../../persistence/Migrations";
import { BrowserTrafficService } from "../Services/BrowserTrafficService";
import { BrowserTrafficServiceLive } from "./BrowserTrafficService";

const TestLayer = BrowserTrafficServiceLive.pipe(
  Layer.provide(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(
  Layer.effectDiscard(runMigrations()).pipe(Layer.provide(TestLayer)),
);

layer("BrowserTrafficService — getSiteMap", (it) => {
  const ingestRequest = (service: any, reqId: string, method: string, url: string) =>
    service.ingestTraffic({
      tabId: "t1", requestId: reqId, stage: "request",
      method, url, host: new URL(url).host, path: new URL(url).pathname,
      requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
    });

  const ingestResponse = (service: any, reqId: string, method: string, url: string, statusCode: number) =>
    service.ingestTraffic({
      tabId: "t1", requestId: reqId, stage: "response",
      method, url, host: new URL(url).host, path: new URL(url).pathname,
      statusCode, timestamp: "2026-01-01T00:00:01Z",
    });

  it.effect("groups entries by host and path", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* ingestRequest(service, "r1", "GET", "https://target.htb/");
      yield* ingestResponse(service, "r1", "GET", "https://target.htb/", 200);
      yield* ingestRequest(service, "r2", "GET", "https://target.htb/api/users");
      yield* ingestResponse(service, "r2", "GET", "https://target.htb/api/users", 200);
      yield* ingestRequest(service, "r3", "POST", "https://target.htb/api/users");
      yield* ingestResponse(service, "r3", "POST", "https://target.htb/api/users", 201);

      const siteMap = yield* service.getSiteMap();
      assert.isTrue(siteMap.length >= 2); // at least / and /api/users

      const apiUsers = siteMap.find((e: any) => e.path === "/api/users");
      assert.isDefined(apiUsers);
      assert.include(apiUsers!.methods, "GET");
      assert.include(apiUsers!.methods, "POST");
      assert.include(apiUsers!.statusCodes, 200);
      assert.include(apiUsers!.statusCodes, 201);
    }),
  );

  it.effect("counts requests per endpoint", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* ingestRequest(service, "r1", "GET", "https://target.htb/api");
      yield* ingestRequest(service, "r2", "GET", "https://target.htb/api");
      yield* ingestRequest(service, "r3", "GET", "https://target.htb/api");

      const siteMap = yield* service.getSiteMap();
      const api = siteMap.find((e: any) => e.path === "/api");
      assert.equal(api!.requestCount, 3);
    }),
  );

  it.effect("returns empty for no traffic", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const siteMap = yield* service.getSiteMap();
      assert.equal(siteMap.length, 0);
    }),
  );

  it.effect("separates entries by host", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* ingestRequest(service, "r1", "GET", "https://host-a.htb/path");
      yield* ingestRequest(service, "r2", "GET", "https://host-b.htb/path");

      const siteMap = yield* service.getSiteMap();
      const hosts = [...new Set(siteMap.map((e: any) => e.host))];
      assert.equal(hosts.length, 2);
    }),
  );
});
```

---

### Test File: `apps/server/src/browser/Layers/BrowserTrafficService.ws.test.ts`

WebSocket frame storage test.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient";
import { runMigrations } from "../../persistence/Migrations";
import { BrowserTrafficService } from "../Services/BrowserTrafficService";
import { BrowserTrafficServiceLive } from "./BrowserTrafficService";

const TestLayer = BrowserTrafficServiceLive.pipe(
  Layer.provide(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(
  Layer.effectDiscard(runMigrations()).pipe(Layer.provide(TestLayer)),
);

layer("BrowserTrafficService — WebSocket frames", (it) => {
  it.effect("ingestWsFrame — stores frame linked to traffic", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const sql = yield* SqlClient.SqlClient;

      // Create parent WS traffic entry
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "ws-1", stage: "request",
        method: "GET", url: "wss://target.htb/ws",
        host: "target.htb", path: "/ws",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });

      // Get the traffic row id
      const rows = yield* sql<{ id: number }>`
        SELECT id FROM browser_traffic WHERE request_id = 'ws-1'
      `;
      const trafficId = rows[0].id;

      yield* service.ingestWsFrame({
        trafficId,
        direction: "sent",
        opcode: 1, // text
        payload: Buffer.from("hello server").toString("base64"),
        payloadLength: 12,
        timestamp: "2026-01-01T00:00:01Z",
      });

      yield* service.ingestWsFrame({
        trafficId,
        direction: "received",
        opcode: 1,
        payload: Buffer.from("hello client").toString("base64"),
        payloadLength: 12,
        timestamp: "2026-01-01T00:00:02Z",
      });

      const frames = yield* service.getWsFrames(trafficId);
      assert.equal(frames.length, 2);
      assert.equal(frames[0].direction, "sent");
      assert.equal(frames[1].direction, "received");
    }),
  );

  it.effect("getWsFrames — returns frames in timestamp order", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const sql = yield* SqlClient.SqlClient;

      yield* service.ingestTraffic({
        tabId: "t1", requestId: "ws-order", stage: "request",
        method: "GET", url: "wss://target.htb/ws",
        host: "target.htb", path: "/ws",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });

      const rows = yield* sql<{ id: number }>`
        SELECT id FROM browser_traffic WHERE request_id = 'ws-order'
      `;
      const trafficId = rows[0].id;

      yield* service.ingestWsFrame({
        trafficId, direction: "received", opcode: 1,
        payload: Buffer.from("second").toString("base64"),
        payloadLength: 6, timestamp: "2026-01-01T00:00:02Z",
      });
      yield* service.ingestWsFrame({
        trafficId, direction: "sent", opcode: 1,
        payload: Buffer.from("first").toString("base64"),
        payloadLength: 5, timestamp: "2026-01-01T00:00:01Z",
      });

      const frames = yield* service.getWsFrames(trafficId);
      assert.equal(frames[0].timestamp, "2026-01-01T00:00:01Z"); // first by time
    }),
  );

  it.effect("getWsFrames — returns empty for non-WS traffic", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const frames = yield* service.getWsFrames(99999);
      assert.equal(frames.length, 0);
    }),
  );
});
```

---

### Test File: `apps/web/src/components/browser/SiteMapTree.test.ts`

Tree building logic test (pure function).

```typescript
import { describe, expect, it } from "vitest";

// Extract buildTree from SiteMapTree.tsx for testability
interface SiteMapEntry {
  host: string;
  path: string;
  methods: string[];
  statusCodes: number[];
  requestCount: number;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  methods?: string[];
  statusCodes?: number[];
  requestCount?: number;
  isLeaf: boolean;
}

function buildTree(entries: SiteMapEntry[]): TreeNode[] {
  const hosts = new Map<string, SiteMapEntry[]>();
  for (const entry of entries) {
    const list = hosts.get(entry.host) ?? [];
    list.push(entry);
    hosts.set(entry.host, list);
  }

  return Array.from(hosts.entries()).map(([host, hostEntries]) => {
    const root: TreeNode = { name: host, fullPath: host, children: [], isLeaf: false };
    for (const entry of hostEntries) {
      const segments = entry.path.split("/").filter(Boolean);
      let current = root;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let child = current.children.find((c) => c.name === seg);
        if (!child) {
          child = {
            name: seg, fullPath: "/" + segments.slice(0, i + 1).join("/"),
            children: [], isLeaf: i === segments.length - 1,
            methods: i === segments.length - 1 ? entry.methods : undefined,
            statusCodes: i === segments.length - 1 ? entry.statusCodes : undefined,
            requestCount: i === segments.length - 1 ? entry.requestCount : undefined,
          };
          current.children.push(child);
        }
        current = child;
      }
    }
    return root;
  });
}

describe("buildTree", () => {
  it("groups by host", () => {
    const tree = buildTree([
      { host: "a.com", path: "/", methods: ["GET"], statusCodes: [200], requestCount: 1 },
      { host: "b.com", path: "/", methods: ["GET"], statusCodes: [200], requestCount: 1 },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("a.com");
    expect(tree[1].name).toBe("b.com");
  });

  it("builds nested path segments", () => {
    const tree = buildTree([
      { host: "x.com", path: "/api/v1/users", methods: ["GET"], statusCodes: [200], requestCount: 5 },
    ]);
    expect(tree[0].children[0].name).toBe("api");
    expect(tree[0].children[0].children[0].name).toBe("v1");
    expect(tree[0].children[0].children[0].children[0].name).toBe("users");
    expect(tree[0].children[0].children[0].children[0].isLeaf).toBe(true);
  });

  it("merges shared path prefixes", () => {
    const tree = buildTree([
      { host: "x.com", path: "/api/users", methods: ["GET"], statusCodes: [200], requestCount: 1 },
      { host: "x.com", path: "/api/posts", methods: ["GET"], statusCodes: [200], requestCount: 1 },
    ]);
    // /api should have 2 children: users and posts
    const api = tree[0].children[0];
    expect(api.name).toBe("api");
    expect(api.children).toHaveLength(2);
  });

  it("attaches methods and statusCodes to leaf nodes only", () => {
    const tree = buildTree([
      { host: "x.com", path: "/api/data", methods: ["POST"], statusCodes: [201], requestCount: 3 },
    ]);
    const leaf = tree[0].children[0].children[0]; // /api/data
    expect(leaf.methods).toEqual(["POST"]);
    expect(leaf.statusCodes).toEqual([201]);
    expect(leaf.requestCount).toBe(3);

    const parent = tree[0].children[0]; // /api
    expect(parent.methods).toBeUndefined();
  });

  it("returns empty array for no entries", () => {
    expect(buildTree([])).toEqual([]);
  });
});
```

---

### Test File: `packages/contracts/src/browser.phase5.test.ts`

Schema validation for Phase 5 types.

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BrowserSiteMapEntry,
  BrowserCookieEntry,
  BrowserCookieSetInput,
  BrowserWebSocketFrame,
} from "./browser";

describe("BrowserCookieEntry", () => {
  const decode = Schema.decodeUnknownSync(BrowserCookieEntry);

  it("accepts valid cookie", () => {
    const cookie = decode({
      name: "session", value: "abc123",
      domain: ".target.htb", path: "/",
      httpOnly: true, secure: true,
      sameSite: "lax", session: false,
      expirationDate: 1700000000,
    });
    expect(cookie.name).toBe("session");
    expect(cookie.httpOnly).toBe(true);
  });

  it("accepts session cookie without expirationDate", () => {
    const cookie = decode({
      name: "temp", value: "xyz",
      domain: "target.htb", path: "/",
      httpOnly: false, secure: false,
      sameSite: "unspecified", session: true,
    });
    expect(cookie.session).toBe(true);
  });
});

describe("BrowserWebSocketFrame", () => {
  const decode = Schema.decodeUnknownSync(BrowserWebSocketFrame);

  it("accepts valid sent frame", () => {
    const frame = decode({
      id: 1, trafficId: 100,
      direction: "sent", opcode: 1,
      payload: btoa("hello"), payloadLength: 5,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(frame.direction).toBe("sent");
    expect(frame.opcode).toBe(1);
  });

  it("accepts null payload (ping/pong)", () => {
    const frame = decode({
      id: 2, trafficId: 100,
      direction: "received", opcode: 9,
      payload: null, payloadLength: 0,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(frame.payload).toBeNull();
  });

  it("rejects invalid direction", () => {
    expect(() => decode({
      id: 1, trafficId: 1, direction: "unknown",
      opcode: 1, payload: null, payloadLength: 0,
      timestamp: "2026-01-01T00:00:00Z",
    })).toThrow();
  });
});

describe("BrowserSiteMapEntry", () => {
  const decode = Schema.decodeUnknownSync(BrowserSiteMapEntry);

  it("accepts valid entry", () => {
    const entry = decode({
      host: "target.htb", path: "/api/users",
      methods: ["GET", "POST"],
      statusCodes: [200, 201],
      requestCount: 15,
    });
    expect(entry.methods).toContain("GET");
    expect(entry.requestCount).toBe(15);
  });
});
```

---

### Test Files Summary for Phase 5

| Test file | Tests | Pattern |
|---|---|---|
| `apps/server/src/persistence/Migrations/026_BrowserWsFrames.test.ts` | Schema, CHECK constraints, CASCADE delete | Effect + in-memory SQLite |
| `apps/server/src/browser/Layers/BrowserTrafficService.sitemap.test.ts` | Site map aggregation: grouping, counting, multi-host | Effect service layer |
| `apps/server/src/browser/Layers/BrowserTrafficService.ws.test.ts` | WS frame ingest, retrieval, ordering | Effect service layer |
| `apps/web/src/components/browser/SiteMapTree.test.ts` | Tree building: grouping, nesting, merging, leaf data | Pure function |
| `packages/contracts/src/browser.phase5.test.ts` | Cookie, WS frame, site map schema validation | Schema decode |

**Total new test files: 5**
**Estimated test count: ~30 test cases**
