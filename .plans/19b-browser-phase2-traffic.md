# Phase 2: Traffic Interception & History

**Parent plan:** `19-embedded-security-browser.md`
**Depends on:** Phase 1 (browser shell)
**Delivers:** CDP Fetch domain captures all HTTP traffic. Real-time traffic table in UI. Server stores traffic in SQLite.

---

## Goal

Every HTTP request and response flowing through the embedded browser gets intercepted via CDP Fetch domain, forwarded to the server for SQLite storage, and streamed to the web UI in real-time. User sees a Burp-style HTTP History table below the browser view.

---

## Step 1: SQLite Migration — `apps/server/src/persistence/Migrations/024_BrowserTraffic.ts` (NEW FILE)

Follow migration pattern from `023_GlobalScriptDefaults.ts`: Effect.gen, yield SqlClient, execute SQL.

```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_traffic (
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
      request_headers_json TEXT NOT NULL DEFAULT '{}',
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
    )
  `;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_tab ON browser_traffic(tab_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_host ON browser_traffic(host)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_method ON browser_traffic(method)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_status ON browser_traffic(status_code)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_bt_created ON browser_traffic(created_at DESC)`;
});
```

### Register migration

Modify `apps/server/src/persistence/Migrations.ts`:

```typescript
import Migration0024 from "./Migrations/024_BrowserTraffic";

// Add to migrationEntries array:
[24, "BrowserTraffic", Migration0024],
```

---

## Step 2: Contracts — Extend `packages/contracts/src/browser.ts`

### Traffic schemas

```typescript
export const BrowserTrafficEntry = Schema.Struct({
  id: Schema.Number,
  tabId: Schema.String,
  requestId: Schema.String,
  method: Schema.String,
  url: Schema.String,
  host: Schema.String,
  path: Schema.String,
  statusCode: Schema.NullOr(Schema.Number),
  contentType: Schema.NullOr(Schema.String),
  contentLength: Schema.NullOr(Schema.Number),
  bodyTruncated: Schema.Boolean,
  isWebSocket: Schema.Boolean,
  timingStartedAt: Schema.String,
  timingResponseAt: Schema.NullOr(Schema.String),
  timingCompletedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type BrowserTrafficEntry = typeof BrowserTrafficEntry.Type;

export const BrowserTrafficDetail = Schema.Struct({
  ...BrowserTrafficEntry.fields,
  requestHeadersJson: Schema.String,
  requestBody: Schema.NullOr(Schema.String), // base64-encoded
  responseHeadersJson: Schema.NullOr(Schema.String),
  responseBody: Schema.NullOr(Schema.String), // base64-encoded
  notes: Schema.NullOr(Schema.String),
});
export type BrowserTrafficDetail = typeof BrowserTrafficDetail.Type;
```

### Query input

```typescript
export const BrowserTrafficQueryInput = Schema.Struct({
  tabId: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});
export type BrowserTrafficQueryInput = typeof BrowserTrafficQueryInput.Type;
```

### Traffic events

```typescript
export const BrowserTrafficCapturedEvent = Schema.Struct({
  type: Schema.Literal("traffic.captured"),
  entry: BrowserTrafficEntry,
});

// Extend BrowserEvent union to include traffic events:
export const BrowserEvent = Schema.Union([
  BrowserTabCreatedEvent,
  BrowserTabClosedEvent,
  BrowserTabNavigatedEvent,
  BrowserTabTitleUpdatedEvent,
  BrowserTabLoadingChangedEvent,
  BrowserTrafficCapturedEvent,
]);
export type BrowserEvent = typeof BrowserEvent.Type;
```

### Error classes

```typescript
export class BrowserTrafficNotFoundError extends Schema.TaggedError<BrowserTrafficNotFoundError>()(
  "BrowserTrafficNotFoundError",
  { trafficId: Schema.Number, message: Schema.String },
) {}
```

### Traffic ingest payload (used by main process → server HTTP POST)

```typescript
export const BrowserTrafficIngestPayload = Schema.Struct({
  tabId: Schema.String,
  requestId: Schema.String,
  stage: Schema.Literal("request", "response"),
  method: Schema.String,
  url: Schema.String,
  host: Schema.String,
  path: Schema.String,
  statusCode: Schema.optional(Schema.Number),
  contentType: Schema.optional(Schema.String),
  contentLength: Schema.optional(Schema.Number),
  requestHeadersJson: Schema.optional(Schema.String),
  requestBody: Schema.optional(Schema.NullOr(Schema.String)), // base64
  responseHeadersJson: Schema.optional(Schema.String),
  responseBody: Schema.optional(Schema.NullOr(Schema.String)), // base64
  bodyTruncated: Schema.optional(Schema.Boolean),
  timestamp: Schema.String,
});
export type BrowserTrafficIngestPayload = typeof BrowserTrafficIngestPayload.Type;
```

---

## Step 3: RPC Definitions — Modify `packages/contracts/src/rpc.ts`

### Add to `WS_METHODS`

```typescript
browserGetTraffic: "browser.getTraffic",
browserGetTrafficDetail: "browser.getTrafficDetail",
browserClearTraffic: "browser.clearTraffic",
subscribeBrowserEvents: "subscribeBrowserEvents",
```

### Add RPC definitions

```typescript
export const WsBrowserGetTrafficRpc = Rpc.make(WS_METHODS.browserGetTraffic, {
  payload: BrowserTrafficQueryInput,
  success: Schema.Array(BrowserTrafficEntry),
  error: BrowserError,
});

export const WsBrowserGetTrafficDetailRpc = Rpc.make(WS_METHODS.browserGetTrafficDetail, {
  payload: Schema.Struct({ id: Schema.Number }),
  success: BrowserTrafficDetail,
  error: Schema.Union([BrowserError, BrowserTrafficNotFoundError]),
});

export const WsBrowserClearTrafficRpc = Rpc.make(WS_METHODS.browserClearTraffic, {
  payload: Schema.Struct({ tabId: Schema.optional(Schema.String) }),
  error: BrowserError,
});

export const WsSubscribeBrowserEventsRpc = Rpc.make(WS_METHODS.subscribeBrowserEvents, {
  payload: Schema.Struct({}),
  success: BrowserEvent,
  stream: true,
});
```

### Add to `WsRpcGroup`

```typescript
export const WsRpcGroup = RpcGroup.make(
  // ... existing RPCs ...
  WsBrowserGetTrafficRpc,
  WsBrowserGetTrafficDetailRpc,
  WsBrowserClearTrafficRpc,
  WsSubscribeBrowserEventsRpc,
);
```

---

## Step 4: Server Service — `apps/server/src/browser/Services/BrowserTrafficService.ts` (NEW FILE)

Effect.js service interface following metasploit pattern.

```typescript
import { Effect, type Stream } from "effect";
import type {
  BrowserTrafficEntry,
  BrowserTrafficDetail,
  BrowserTrafficQueryInput,
  BrowserTrafficIngestPayload,
  BrowserEvent,
} from "@t3/contracts";

export class BrowserTrafficService extends Effect.Service<BrowserTrafficService>()(
  "t3/browser/Services/BrowserTrafficService",
) {
  // Ingest from main process HTTP POST
  declare ingestTraffic: (payload: BrowserTrafficIngestPayload) => Effect.Effect<void>;

  // Query for UI
  declare queryTraffic: (input: BrowserTrafficQueryInput) => Effect.Effect<readonly BrowserTrafficEntry[]>;
  declare getTrafficDetail: (id: number) => Effect.Effect<BrowserTrafficDetail>;
  declare clearTraffic: (tabId?: string) => Effect.Effect<void>;

  // Event subscription for streaming to UI
  declare subscribe: (listener: (event: BrowserEvent) => void) => Effect.Effect<() => void>;
}
```

> **Note:** Verify exact Effect.Service pattern used in codebase. If metasploit uses a different service definition pattern (e.g., `Context.Tag` + separate interface), match that instead.

---

## Step 5: Server Layer — `apps/server/src/browser/Layers/BrowserTrafficService.ts` (NEW FILE)

SQLite implementation.

```typescript
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { BrowserTrafficService } from "../Services/BrowserTrafficService";
import type {
  BrowserTrafficEntry,
  BrowserTrafficDetail,
  BrowserTrafficQueryInput,
  BrowserTrafficIngestPayload,
  BrowserEvent,
} from "@t3/contracts";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

export const BrowserTrafficServiceLive = Layer.effect(
  BrowserTrafficService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let eventListeners: Array<(event: BrowserEvent) => void> = [];

    function emitEvent(event: BrowserEvent): void {
      for (const listener of eventListeners) {
        try {
          listener(event);
        } catch {
          // swallow
        }
      }
    }

    return BrowserTrafficService.of({
      ingestTraffic: (payload) =>
        Effect.gen(function* () {
          if (payload.stage === "request") {
            // INSERT new row
            yield* sql`
              INSERT OR IGNORE INTO browser_traffic (
                tab_id, request_id, method, url, host, path,
                request_headers_json, request_body,
                timing_started_at, created_at
              ) VALUES (
                ${payload.tabId},
                ${payload.requestId},
                ${payload.method},
                ${payload.url},
                ${payload.host},
                ${payload.path},
                ${payload.requestHeadersJson ?? "{}"},
                ${payload.requestBody ?? null},
                ${payload.timestamp},
                datetime('now')
              )
            `;
          } else if (payload.stage === "response") {
            // Check body size, truncate if needed
            let responseBody = payload.responseBody ?? null;
            let bodyTruncated = payload.bodyTruncated ?? false;
            if (responseBody && Buffer.byteLength(responseBody, "base64") > MAX_BODY_SIZE) {
              responseBody = responseBody.slice(0, MAX_BODY_SIZE);
              bodyTruncated = true;
            }

            // UPDATE existing row
            yield* sql`
              UPDATE browser_traffic SET
                status_code = ${payload.statusCode ?? null},
                content_type = ${payload.contentType ?? null},
                content_length = ${payload.contentLength ?? null},
                response_headers_json = ${payload.responseHeadersJson ?? null},
                response_body = ${responseBody},
                body_truncated = ${bodyTruncated ? 1 : 0},
                timing_response_at = ${payload.timestamp},
                timing_completed_at = ${payload.timestamp}
              WHERE request_id = ${payload.requestId}
            `;
          }

          // Fetch the row to emit event
          const rows = yield* sql<BrowserTrafficEntry>`
            SELECT
              id, tab_id as "tabId", request_id as "requestId",
              method, url, host, path,
              status_code as "statusCode",
              content_type as "contentType",
              content_length as "contentLength",
              body_truncated as "bodyTruncated",
              is_websocket as "isWebSocket",
              timing_started_at as "timingStartedAt",
              timing_response_at as "timingResponseAt",
              timing_completed_at as "timingCompletedAt",
              created_at as "createdAt"
            FROM browser_traffic
            WHERE request_id = ${payload.requestId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            emitEvent({
              type: "traffic.captured",
              entry: {
                ...rows[0],
                bodyTruncated: Boolean(rows[0].bodyTruncated),
                isWebSocket: Boolean(rows[0].isWebSocket),
              },
            } as any);
          }
        }),

      queryTraffic: (input) =>
        Effect.gen(function* () {
          const limit = input.limit ?? 100;
          const offset = input.offset ?? 0;

          // Build WHERE clauses
          const conditions: string[] = ["1=1"];
          if (input.tabId) conditions.push(`tab_id = '${input.tabId}'`);
          if (input.host) conditions.push(`host LIKE '%${input.host}%'`);
          if (input.method) conditions.push(`method = '${input.method}'`);
          if (input.statusCode) conditions.push(`status_code = ${input.statusCode}`);
          if (input.search) conditions.push(`url LIKE '%${input.search}%'`);

          // Note: In production, use parameterized queries for SQL injection safety.
          // This is a local-only tool, but still worth doing properly.
          const rows = yield* sql<BrowserTrafficEntry>`
            SELECT
              id, tab_id as "tabId", request_id as "requestId",
              method, url, host, path,
              status_code as "statusCode",
              content_type as "contentType",
              content_length as "contentLength",
              body_truncated as "bodyTruncated",
              is_websocket as "isWebSocket",
              timing_started_at as "timingStartedAt",
              timing_response_at as "timingResponseAt",
              timing_completed_at as "timingCompletedAt",
              created_at as "createdAt"
            FROM browser_traffic
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `;

          return rows.map((r) => ({
            ...r,
            bodyTruncated: Boolean(r.bodyTruncated),
            isWebSocket: Boolean(r.isWebSocket),
          }));
        }),

      getTrafficDetail: (id) =>
        Effect.gen(function* () {
          const rows = yield* sql<BrowserTrafficDetail>`
            SELECT
              id, tab_id as "tabId", request_id as "requestId",
              method, url, host, path,
              status_code as "statusCode",
              content_type as "contentType",
              content_length as "contentLength",
              request_headers_json as "requestHeadersJson",
              request_body as "requestBody",
              response_headers_json as "responseHeadersJson",
              response_body as "responseBody",
              body_truncated as "bodyTruncated",
              is_websocket as "isWebSocket",
              timing_started_at as "timingStartedAt",
              timing_response_at as "timingResponseAt",
              timing_completed_at as "timingCompletedAt",
              notes,
              created_at as "createdAt"
            FROM browser_traffic
            WHERE id = ${id}
            LIMIT 1
          `;

          if (rows.length === 0) {
            return yield* Effect.fail(
              new BrowserTrafficNotFoundError({ trafficId: id, message: `Traffic entry ${id} not found` }),
            );
          }

          return {
            ...rows[0],
            bodyTruncated: Boolean(rows[0].bodyTruncated),
            isWebSocket: Boolean(rows[0].isWebSocket),
          };
        }),

      clearTraffic: (tabId) =>
        Effect.gen(function* () {
          if (tabId) {
            yield* sql`DELETE FROM browser_traffic WHERE tab_id = ${tabId}`;
          } else {
            yield* sql`DELETE FROM browser_traffic`;
          }
        }),

      subscribe: (listener) =>
        Effect.sync(() => {
          eventListeners.push(listener);
          return () => {
            eventListeners = eventListeners.filter((l) => l !== listener);
          };
        }),
    });
  }),
);
```

> **Important:** The `queryTraffic` method above uses string interpolation for WHERE clauses as a placeholder. Check how existing services handle dynamic queries with `@effect/sql-sqlite-bun`. The proper approach may use SQL template tag parameters or a query builder. Match the existing codebase pattern.

---

## Step 6: HTTP Ingest Endpoint — Modify `apps/server/src/http.ts`

Add new route layer for traffic ingest from main process.

```typescript
import { BrowserTrafficService } from "./browser/Services/BrowserTrafficService";

export const browserTrafficIngestRouteLayer = HttpRouter.add(
  "POST",
  "/api/browser/traffic",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const service = yield* BrowserTrafficService;
    yield* service.ingestTraffic(body as any);
    return HttpServerResponse.empty({ status: 204 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
```

Then add this to the route composition where other routes are merged (find the `HttpRouter.concat` or `Layer.merge` calls in `server.ts` or `http.ts`).

---

## Step 7: Server Wiring — Modify `apps/server/src/server.ts`

### Import and add to layer composition

```typescript
import { BrowserTrafficServiceLive } from "./browser/Layers/BrowserTrafficService";
```

Add `BrowserTrafficServiceLive` to `RuntimeDependenciesLive` (or wherever `MetasploitLayerLive` is added):

```typescript
Layer.provideMerge(BrowserTrafficServiceLive),
```

Add `browserTrafficIngestRouteLayer` to the route composition.

---

## Step 8: RPC Handlers — Modify `apps/server/src/ws.ts`

Add browser traffic handlers following metasploit block pattern exactly.

```typescript
import { BrowserTrafficService } from "./browser/Services/BrowserTrafficService";

// Add alongside metasploit handlers:

[WS_METHODS.browserGetTraffic]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserGetTraffic,
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      return yield* service.queryTraffic(input);
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.browserGetTrafficDetail]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserGetTrafficDetail,
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      return yield* service.getTrafficDetail(input.id);
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.browserClearTraffic]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserClearTraffic,
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.clearTraffic(input.tabId);
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.subscribeBrowserEvents]: (_input) =>
  observeRpcStream(
    WS_METHODS.subscribeBrowserEvents,
    Stream.callback<BrowserEvent>((queue) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const service = yield* BrowserTrafficService;
          return yield* service.subscribe((event) => {
            Effect.runFork(Queue.offer(queue, event));
          });
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ),
    { "rpc.aggregate": "browser" },
  ),
```

---

## Step 9: WS RPC Client — Modify `apps/web/src/rpc/wsRpcClient.ts`

### Add browser namespace to `WsRpcClient` interface

```typescript
readonly browser: {
  readonly getTraffic: RpcUnaryMethod<typeof WS_METHODS.browserGetTraffic>;
  readonly getTrafficDetail: RpcUnaryMethod<typeof WS_METHODS.browserGetTrafficDetail>;
  readonly clearTraffic: RpcUnaryMethod<typeof WS_METHODS.browserClearTraffic>;
  readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeBrowserEvents>;
};
```

### Add implementation in `createWsRpcClient`

```typescript
browser: {
  getTraffic: (input) =>
    transport.request((client) =>
      client[WS_METHODS.browserGetTraffic](input),
    ),
  getTrafficDetail: (input) =>
    transport.request((client) =>
      client[WS_METHODS.browserGetTrafficDetail](input),
    ),
  clearTraffic: (input) =>
    transport.request((client) =>
      client[WS_METHODS.browserClearTraffic](input),
    ),
  onEvent: (listener, options) =>
    transport.subscribe(
      (client) => client[WS_METHODS.subscribeBrowserEvents]({}),
      listener,
      options,
    ),
},
```

---

## Step 10: CDP Interception — Modify `apps/desktop/src/browserManager.ts`

This is the core of Phase 2. Add CDP Fetch domain interception to `createTab`.

### Add module-level state for backend connection

```typescript
let backendUrl: string = "";
let backendToken: string = "";

// Update initBrowserManager signature:
export function initBrowserManager(
  window: BrowserWindow,
  backendHttpUrl: string,
  bootstrapToken: string,
): void {
  parentWindow = window;
  backendUrl = backendHttpUrl;
  backendToken = bootstrapToken;
  // ... rest of init
}
```

### Add body size constant

```typescript
const MAX_CAPTURE_BODY_BYTES = 10 * 1024 * 1024; // 10MB
```

### Add traffic forwarding function

```typescript
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
  try {
    await fetch(`${backendUrl}/api/browser/traffic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Log but don't block — main process must not stall
    console.error("[browserManager] Traffic forward failed:", err);
  }
}
```

### Add CDP attachment in `createTab`

After creating the WebContentsView and wiring navigation events, add:

```typescript
// Attach CDP debugger for traffic interception
const cdp = view.webContents.debugger;
try {
  cdp.attach("1.3");
} catch (err) {
  console.error("[browserManager] Debugger attach failed:", err);
}

// Enable Fetch domain for request and response interception
try {
  await cdp.sendCommand("Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
    handleAuthRequests: true,
  });
} catch (err) {
  console.error("[browserManager] Fetch.enable failed:", err);
}

// Handle intercepted requests
cdp.on("message", (_event: Electron.Event, method: string, params: any) => {
  if (method === "Fetch.requestPaused") {
    void handleFetchPaused(tabId, cdp, params);
  }
});
```

### Add `handleFetchPaused` function

```typescript
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

        // Check size
        const bodyBytes = Buffer.byteLength(bodyResult.body, bodyResult.base64Encoded ? "base64" : "utf-8");
        if (bodyBytes > MAX_CAPTURE_BODY_BYTES) {
          responseBody = responseBody.slice(0, MAX_CAPTURE_BODY_BYTES);
          bodyTruncated = true;
        }
      } catch {
        // Body might not be available (e.g., streaming, redirect)
      }

      // Extract content-type from response headers
      const contentType = responseHeaders?.find(
        (h: any) => h.name.toLowerCase() === "content-type",
      )?.value;
      const contentLength = responseHeaders?.find(
        (h: any) => h.name.toLowerCase() === "content-length",
      )?.value;

      const parsedUrl = new URL(request.url);

      // Forward to server
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
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        responseHeadersJson: JSON.stringify(
          Object.fromEntries(
            (responseHeaders ?? []).map((h: any) => [h.name, h.value]),
          ),
        ),
        responseBody,
        bodyTruncated,
        timestamp: new Date().toISOString(),
      });

      // Continue the response to the browser
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

      // Forward to server
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

      // Continue the request
      await cdp.sendCommand("Fetch.continueRequest", { requestId });
    }
  } catch (err) {
    // If anything fails, make sure the request isn't left hanging
    try {
      await cdp.sendCommand("Fetch.continueRequest", { requestId });
    } catch {
      // debugger might be detached
    }
    console.error("[browserManager] handleFetchPaused error:", err);
  }
}
```

### Update `initBrowserManager` call in `main.ts`

Pass backend URL and token:

```typescript
initBrowserManager(mainWindow, backendHttpUrl, backendBootstrapToken);
```

> **Note:** Find where `backendHttpUrl` and `backendBootstrapToken` are available in main.ts. They should be accessible after backend readiness check.

---

## Step 11: Event Sync Hook — `apps/web/src/components/browser/useBrowserSync.ts` (NEW FILE)

Subscribes to server-side browser events via RPC stream and updates stores.

```typescript
import { useEffect } from "react";
import { useBrowserStore } from "../../browserStore";
import { useEnvironmentApi } from "../../environmentApi";

export function useBrowserSync() {
  const api = useEnvironmentApi();

  useEffect(() => {
    if (!api) return;

    const unsubscribe = api.rpc.browser.onEvent((event) => {
      const store = useBrowserStore.getState();

      switch (event.type) {
        case "traffic.captured":
          store.appendTraffic(event.entry);
          break;
        // Tab events are handled by IPC listener in Phase 1
        // Only traffic events come through RPC
      }
    });

    return () => unsubscribe?.();
  }, [api]);
}
```

### Add `appendTraffic` to browser store

Extend `browserStore.ts`:

```typescript
// Add to state interface:
trafficEntries: BrowserTrafficEntry[];

// Add to initial state:
trafficEntries: [],

// Add action:
appendTraffic: (entry) =>
  set((state) => {
    // Check if entry already exists (update case)
    const existingIndex = state.trafficEntries.findIndex(
      (e) => e.requestId === entry.requestId,
    );
    if (existingIndex >= 0) {
      const updated = [...state.trafficEntries];
      updated[existingIndex] = entry;
      return { trafficEntries: updated };
    }
    // New entry — prepend (newest first)
    return {
      trafficEntries: [entry, ...state.trafficEntries],
    };
  }),

clearTraffic: () => set({ trafficEntries: [] }),
```

---

## Step 12: Traffic Table Component — `apps/web/src/components/browser/TrafficTable.tsx` (NEW FILE)

Virtual-scrolled table of HTTP traffic. TanStack Virtual is already in deps.

```typescript
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBrowserStore } from "../../browserStore";
import { cn } from "../../lib/utils";
import type { BrowserTrafficEntry } from "@t3/contracts";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-500",
  POST: "text-blue-500",
  PUT: "text-yellow-500",
  DELETE: "text-red-500",
  PATCH: "text-purple-500",
  OPTIONS: "text-gray-500",
  HEAD: "text-gray-400",
};

const STATUS_COLORS = (code: number | null): string => {
  if (!code) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-green-500";
  if (code >= 300 && code < 400) return "text-yellow-500";
  if (code >= 400 && code < 500) return "text-orange-500";
  if (code >= 500) return "text-red-500";
  return "text-muted-foreground";
};

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function formatTime(started: string, completed: string | null): string {
  if (!completed) return "-";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TrafficTableProps {
  onSelectEntry?: (entry: BrowserTrafficEntry) => void;
  selectedId?: number | null;
}

export function TrafficTable({ onSelectEntry, selectedId }: TrafficTableProps) {
  const entries = useBrowserStore((s) => s.trafficEntries);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28, // row height
    overscan: 20,
  });

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex border-b bg-muted/30 px-2 py-1 text-xs font-medium text-muted-foreground">
        <div className="w-16">Method</div>
        <div className="flex-1">URL</div>
        <div className="w-14">Status</div>
        <div className="w-24">Type</div>
        <div className="w-16 text-right">Size</div>
        <div className="w-16 text-right">Time</div>
      </div>

      {/* Virtual rows */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = entries[virtualItem.index];
            if (!entry) return null;

            return (
              <div
                key={entry.requestId}
                className={cn(
                  "absolute left-0 right-0 flex cursor-pointer items-center px-2 text-xs hover:bg-muted/50",
                  selectedId === entry.id && "bg-accent",
                )}
                style={{
                  top: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                  height: `${virtualItem.size}px`,
                }}
                onClick={() => onSelectEntry?.(entry)}
              >
                <div className={cn("w-16 font-mono", METHOD_COLORS[entry.method])}>
                  {entry.method}
                </div>
                <div className="flex-1 truncate font-mono">{entry.url}</div>
                <div className={cn("w-14 font-mono", STATUS_COLORS(entry.statusCode))}>
                  {entry.statusCode ?? "..."}
                </div>
                <div className="w-24 truncate text-muted-foreground">
                  {entry.contentType?.split(";")[0] ?? "-"}
                </div>
                <div className="w-16 text-right text-muted-foreground">
                  {formatSize(entry.contentLength)}
                </div>
                <div className="w-16 text-right text-muted-foreground">
                  {formatTime(entry.timingStartedAt, entry.timingCompletedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer status */}
      <div className="flex items-center justify-between border-t px-2 py-0.5 text-xs text-muted-foreground">
        <span>{entries.length} requests</span>
        <button
          className="hover:text-foreground"
          onClick={() => {
            useBrowserStore.getState().clearTraffic();
            // Also clear on server
            // void api.rpc.browser.clearTraffic({});
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
```

---

## Step 13: Layout Integration

### Update hack route layout to include traffic table

Modify the browser view area in `apps/web/src/routes/hack.tsx` to include a resizable split: browser view on top, traffic table on bottom.

```typescript
{activeTabId ? (
  <div className="flex h-full flex-col">
    <BrowserTabBar />
    <BrowserAddressBar />
    {/* Resizable split: browser view + traffic */}
    <div className="flex flex-1 flex-col">
      <BrowserViewContainer />
      {/* Resizable divider would go here — use existing resize pattern */}
      <div className="h-64 border-t">
        <TrafficTable
          onSelectEntry={(entry) => {
            // Phase 3 will handle inspector
          }}
          selectedId={null}
        />
      </div>
    </div>
  </div>
) : (
  <Outlet />
)}
```

> **Enhancement:** Use a proper resizable panel component (check if project has one, e.g., from radix or custom). For Phase 2, a fixed-height bottom panel is acceptable.

### Add `useBrowserSync` call

In the hack route layout or a parent component, call the sync hook:

```typescript
import { useBrowserSync } from "../components/browser/useBrowserSync";

function HackRouteLayout() {
  useBrowserSync();
  // ...
}
```

---

## Acceptance Criteria

- [ ] CDP Fetch domain attached to every new browser tab
- [ ] Every HTTP request captured at request stage (method, URL, headers, POST body)
- [ ] Every HTTP response captured at response stage (status, headers, body)
- [ ] Request/response correlated by `requestId` into single traffic row
- [ ] Traffic forwarded from main process to server via HTTP POST
- [ ] Server stores traffic in SQLite `browser_traffic` table
- [ ] Traffic events streamed to web UI via `subscribeBrowserEvents` RPC
- [ ] Traffic table shows real-time entries (method, URL, status, type, size, time)
- [ ] Color coding: methods (green GET, blue POST, etc.), status codes (green 2xx, red 5xx)
- [ ] Virtual scrolling handles hundreds of entries without lag
- [ ] Response bodies larger than 10MB truncated with `bodyTruncated` flag
- [ ] Clear traffic button removes all entries
- [ ] Traffic persists in SQLite across app restarts
- [ ] Browser navigation not blocked or slowed by traffic capture
- [ ] Failed capture doesn't hang the browser (graceful fallback via try/catch)

---

## Files Summary

**New files (5):**
1. `apps/server/src/persistence/Migrations/024_BrowserTraffic.ts`
2. `apps/server/src/browser/Services/BrowserTrafficService.ts`
3. `apps/server/src/browser/Layers/BrowserTrafficService.ts`
4. `apps/web/src/components/browser/TrafficTable.tsx`
5. `apps/web/src/components/browser/useBrowserSync.ts`

**Modified files (8):**
1. `packages/contracts/src/browser.ts` — traffic schemas, events, errors, ingest payload
2. `packages/contracts/src/rpc.ts` — browser RPC methods + WsRpcGroup
3. `apps/desktop/src/browserManager.ts` — CDP Fetch domain, traffic forwarding, handleFetchPaused
4. `apps/desktop/src/main.ts` — pass backendUrl/token to initBrowserManager
5. `apps/server/src/http.ts` — `/api/browser/traffic` POST endpoint
6. `apps/server/src/ws.ts` — browser RPC handlers
7. `apps/server/src/server.ts` — wire BrowserTrafficServiceLive
8. `apps/server/src/persistence/Migrations.ts` — register migration 024
9. `apps/web/src/rpc/wsRpcClient.ts` — browser namespace
10. `apps/web/src/browserStore.ts` — add trafficEntries, appendTraffic, clearTraffic
11. `apps/web/src/routes/hack.tsx` — add TrafficTable + useBrowserSync

---

## Test Plan

### Test File: `apps/server/src/persistence/Migrations/024_BrowserTraffic.test.ts`

Migration test. Pattern: run migrations up to N-1, insert data, run migration N, assert schema.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient";
import { runMigrations } from "../Migrations";

const layer = it.layer(NodeSqliteClient.layerMemory());

layer("024_BrowserTraffic", (it) => {
  it.effect("creates browser_traffic table with all columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 24 });

      const columns = yield* sql<{ name: string; type: string }>`
        PRAGMA table_info(browser_traffic)
      `;
      const colNames = columns.map((c) => c.name);

      assert.include(colNames, "id");
      assert.include(colNames, "tab_id");
      assert.include(colNames, "request_id");
      assert.include(colNames, "method");
      assert.include(colNames, "url");
      assert.include(colNames, "host");
      assert.include(colNames, "path");
      assert.include(colNames, "status_code");
      assert.include(colNames, "request_headers_json");
      assert.include(colNames, "request_body");
      assert.include(colNames, "response_headers_json");
      assert.include(colNames, "response_body");
      assert.include(colNames, "body_truncated");
      assert.include(colNames, "timing_started_at");
    }),
  );

  it.effect("creates all expected indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 24 });

      const indexes = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'browser_traffic'
      `;
      const indexNames = indexes.map((i) => i.name);

      assert.include(indexNames, "idx_bt_tab");
      assert.include(indexNames, "idx_bt_host");
      assert.include(indexNames, "idx_bt_method");
      assert.include(indexNames, "idx_bt_status");
      assert.include(indexNames, "idx_bt_created");
    }),
  );

  it.effect("enforces request_id UNIQUE constraint", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 24 });

      yield* sql`
        INSERT INTO browser_traffic (tab_id, request_id, method, url, host, path, request_headers_json, timing_started_at)
        VALUES ('t1', 'req-1', 'GET', 'https://x.com', 'x.com', '/', '{}', '2026-01-01T00:00:00Z')
      `;

      const result = yield* Effect.either(sql`
        INSERT INTO browser_traffic (tab_id, request_id, method, url, host, path, request_headers_json, timing_started_at)
        VALUES ('t1', 'req-1', 'POST', 'https://x.com', 'x.com', '/', '{}', '2026-01-01T00:00:01Z')
      `);

      assert.isTrue(result._tag === "Left"); // should fail
    }),
  );
});
```

---

### Test File: `apps/server/src/browser/Layers/BrowserTrafficService.test.ts`

Service layer test with in-memory SQLite. Pattern: `it.layer()` with service + SQLite.

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

layer("BrowserTrafficService", (it) => {
  it.effect("ingestTraffic — request stage creates row", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1",
        requestId: "req-1",
        stage: "request",
        method: "GET",
        url: "https://target.htb/api/users",
        host: "target.htb",
        path: "/api/users",
        requestHeadersJson: '{"Accept":"application/json"}',
        timestamp: "2026-01-01T00:00:00Z",
      });

      const results = yield* service.queryTraffic({ limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0].method, "GET");
      assert.equal(results[0].host, "target.htb");
      assert.isNull(results[0].statusCode); // no response yet
    }),
  );

  it.effect("ingestTraffic — response stage updates existing row", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      // Insert request
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-2", stage: "request",
        method: "POST", url: "https://target.htb/login",
        host: "target.htb", path: "/login",
        requestHeadersJson: "{}",
        requestBody: Buffer.from("user=admin&pass=admin").toString("base64"),
        timestamp: "2026-01-01T00:00:00Z",
      });
      // Update with response
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-2", stage: "response",
        method: "POST", url: "https://target.htb/login",
        host: "target.htb", path: "/login",
        statusCode: 302,
        contentType: "text/html",
        responseHeadersJson: '{"Location":"/dashboard"}',
        responseBody: Buffer.from("<html>redirect</html>").toString("base64"),
        timestamp: "2026-01-01T00:00:01Z",
      });

      const results = yield* service.queryTraffic({});
      assert.equal(results.length, 1);
      assert.equal(results[0].statusCode, 302);
    }),
  );

  it.effect("getTrafficDetail — returns full row with bodies", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-3", stage: "request",
        method: "GET", url: "https://target.htb/",
        host: "target.htb", path: "/",
        requestHeadersJson: '{"Host":"target.htb"}',
        timestamp: "2026-01-01T00:00:00Z",
      });
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-3", stage: "response",
        method: "GET", url: "https://target.htb/",
        host: "target.htb", path: "/",
        statusCode: 200,
        responseHeadersJson: '{"Content-Type":"text/html"}',
        responseBody: Buffer.from("<html>hello</html>").toString("base64"),
        timestamp: "2026-01-01T00:00:01Z",
      });

      const results = yield* service.queryTraffic({});
      const detail = yield* service.getTrafficDetail(results[0].id);
      assert.equal(detail.requestHeadersJson, '{"Host":"target.htb"}');
      assert.isNotNull(detail.responseBody);
    }),
  );

  it.effect("getTrafficDetail — fails for nonexistent id", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const result = yield* Effect.either(service.getTrafficDetail(99999));
      assert.isTrue(result._tag === "Left");
    }),
  );

  it.effect("clearTraffic — removes all rows", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-a", stage: "request",
        method: "GET", url: "https://a.com", host: "a.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });
      yield* service.ingestTraffic({
        tabId: "t2", requestId: "req-b", stage: "request",
        method: "GET", url: "https://b.com", host: "b.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });

      yield* service.clearTraffic();
      const results = yield* service.queryTraffic({});
      assert.equal(results.length, 0);
    }),
  );

  it.effect("clearTraffic — scoped to tabId", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-x", stage: "request",
        method: "GET", url: "https://a.com", host: "a.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });
      yield* service.ingestTraffic({
        tabId: "t2", requestId: "req-y", stage: "request",
        method: "GET", url: "https://b.com", host: "b.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });

      yield* service.clearTraffic("t1");
      const results = yield* service.queryTraffic({});
      assert.equal(results.length, 1);
      assert.equal(results[0].host, "b.com");
    }),
  );

  it.effect("subscribe — emits traffic.captured events", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const events: any[] = [];
      yield* service.subscribe((e) => events.push(e));

      yield* service.ingestTraffic({
        tabId: "t1", requestId: "req-ev", stage: "request",
        method: "GET", url: "https://x.com", host: "x.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });

      assert.isTrue(events.length > 0);
      assert.equal(events[0].type, "traffic.captured");
    }),
  );

  it.effect("queryTraffic — returns newest first", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "older", stage: "request",
        method: "GET", url: "https://a.com", host: "a.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "newer", stage: "request",
        method: "GET", url: "https://b.com", host: "b.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:01Z",
      });

      const results = yield* service.queryTraffic({ limit: 10 });
      assert.equal(results[0].requestId, "newer");
    }),
  );

  it.effect("body truncation flag set for oversized responses", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "big", stage: "request",
        method: "GET", url: "https://big.com", host: "big.com", path: "/",
        requestHeadersJson: "{}", timestamp: "2026-01-01T00:00:00Z",
      });
      yield* service.ingestTraffic({
        tabId: "t1", requestId: "big", stage: "response",
        method: "GET", url: "https://big.com", host: "big.com", path: "/",
        statusCode: 200,
        bodyTruncated: true,
        responseBody: "dHJ1bmNhdGVk", // "truncated" in base64
        timestamp: "2026-01-01T00:00:01Z",
      });

      const results = yield* service.queryTraffic({});
      assert.isTrue(results[0].bodyTruncated);
    }),
  );
});
```

---

### Test File: `packages/contracts/src/browser.traffic.test.ts`

Traffic schema validation (extends browser.test.ts from Phase 1).

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BrowserTrafficEntry,
  BrowserTrafficDetail,
  BrowserTrafficQueryInput,
  BrowserTrafficIngestPayload,
  BrowserTrafficCapturedEvent,
} from "./browser";

describe("BrowserTrafficEntry", () => {
  const decode = Schema.decodeUnknownSync(BrowserTrafficEntry);

  it("accepts valid traffic entry", () => {
    const entry = decode({
      id: 1, tabId: "t1", requestId: "r1", method: "GET",
      url: "https://x.com", host: "x.com", path: "/",
      statusCode: 200, contentType: "text/html", contentLength: 1234,
      bodyTruncated: false, isWebSocket: false,
      timingStartedAt: "2026-01-01T00:00:00Z",
      timingResponseAt: "2026-01-01T00:00:01Z",
      timingCompletedAt: "2026-01-01T00:00:01Z",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(entry.method).toBe("GET");
  });

  it("accepts null statusCode (pending response)", () => {
    const entry = decode({
      id: 1, tabId: "t1", requestId: "r1", method: "GET",
      url: "https://x.com", host: "x.com", path: "/",
      statusCode: null, contentType: null, contentLength: null,
      bodyTruncated: false, isWebSocket: false,
      timingStartedAt: "2026-01-01T00:00:00Z",
      timingResponseAt: null, timingCompletedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(entry.statusCode).toBeNull();
  });
});

describe("BrowserTrafficIngestPayload", () => {
  const decode = Schema.decodeUnknownSync(BrowserTrafficIngestPayload);

  it("accepts request stage payload", () => {
    const p = decode({
      tabId: "t1", requestId: "r1", stage: "request",
      method: "POST", url: "https://x.com/api", host: "x.com", path: "/api",
      requestHeadersJson: '{"Content-Type":"application/json"}',
      requestBody: "eyJ0ZXN0IjoxfQ==",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(p.stage).toBe("request");
  });

  it("accepts response stage payload", () => {
    const p = decode({
      tabId: "t1", requestId: "r1", stage: "response",
      method: "POST", url: "https://x.com/api", host: "x.com", path: "/api",
      statusCode: 201,
      responseHeadersJson: "{}",
      responseBody: "b2s=",
      timestamp: "2026-01-01T00:00:01Z",
    });
    expect(p.stage).toBe("response");
    expect(p.statusCode).toBe(201);
  });

  it("rejects invalid stage value", () => {
    expect(() => decode({
      tabId: "t1", requestId: "r1", stage: "invalid",
      method: "GET", url: "https://x.com", host: "x.com", path: "/",
      timestamp: "2026-01-01T00:00:00Z",
    })).toThrow();
  });
});
```

---

### Test File: `apps/web/src/browserStore.traffic.test.ts`

Traffic-related store state transitions (extends browserStore.test.ts from Phase 1).

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useBrowserStore } from "./browserStore";

const makeTrafficEntry = (overrides?: Record<string, any>) => ({
  id: 1,
  tabId: "t1",
  requestId: "req-1",
  method: "GET",
  url: "https://target.htb/",
  host: "target.htb",
  path: "/",
  statusCode: 200,
  contentType: "text/html",
  contentLength: 500,
  bodyTruncated: false,
  isWebSocket: false,
  timingStartedAt: "2026-01-01T00:00:00Z",
  timingResponseAt: "2026-01-01T00:00:01Z",
  timingCompletedAt: "2026-01-01T00:00:01Z",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("browserStore — traffic", () => {
  beforeEach(() => {
    useBrowserStore.setState({ trafficEntries: [] });
  });

  describe("appendTraffic", () => {
    it("prepends new entry (newest first)", () => {
      useBrowserStore.getState().appendTraffic(makeTrafficEntry({ requestId: "r1" }));
      useBrowserStore.getState().appendTraffic(makeTrafficEntry({ requestId: "r2", id: 2 }));
      const entries = useBrowserStore.getState().trafficEntries;
      expect(entries[0].requestId).toBe("r2");
      expect(entries[1].requestId).toBe("r1");
    });

    it("updates existing entry by requestId (response stage)", () => {
      useBrowserStore.getState().appendTraffic(makeTrafficEntry({ requestId: "r1", statusCode: null }));
      useBrowserStore.getState().appendTraffic(makeTrafficEntry({ requestId: "r1", statusCode: 200 }));
      const entries = useBrowserStore.getState().trafficEntries;
      expect(entries).toHaveLength(1);
      expect(entries[0].statusCode).toBe(200);
    });
  });

  describe("clearTraffic", () => {
    it("removes all entries", () => {
      useBrowserStore.getState().appendTraffic(makeTrafficEntry());
      useBrowserStore.getState().clearTraffic();
      expect(useBrowserStore.getState().trafficEntries).toHaveLength(0);
    });
  });
});
```

---

### Test Files Summary for Phase 2

| Test file | Tests | Pattern |
|---|---|---|
| `apps/server/src/persistence/Migrations/024_BrowserTraffic.test.ts` | Schema creation, indexes, constraints | Effect + in-memory SQLite |
| `apps/server/src/browser/Layers/BrowserTrafficService.test.ts` | Ingest, query, detail, clear, subscribe, ordering, truncation | Effect service layer + SQLite |
| `packages/contracts/src/browser.traffic.test.ts` | Traffic schema validation: entry, detail, ingest payload | Schema decode |
| `apps/web/src/browserStore.traffic.test.ts` | appendTraffic, clearTraffic, update-by-requestId | Pure Zustand state |

**Total new test files: 4**
**Estimated test count: ~30 test cases**
