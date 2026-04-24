# Phase 3: Request Inspector & Repeater

**Parent plan:** `19-embedded-security-browser.md`
**Depends on:** Phase 2 (traffic interception & history)
**Delivers:** Click any traffic row to inspect full request/response. "Send to Repeater" to modify and replay requests.

---

## Goal

User clicks a row in the traffic table, sees full request/response detail (headers, body in multiple formats). Can send any captured request to a Repeater panel, modify method/URL/headers/body, and re-send it. Response displayed in same inspector format.

---

## Step 1: Contracts — Extend `packages/contracts/src/browser.ts`

### Replay input schema

```typescript
export const BrowserReplayRequestInput = Schema.Struct({
  trafficId: Schema.optional(Schema.Number),
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  body: Schema.optional(Schema.NullOr(Schema.String)), // base64
});
export type BrowserReplayRequestInput = typeof BrowserReplayRequestInput.Type;

export const BrowserReplayResponse = Schema.Struct({
  statusCode: Schema.Number,
  statusText: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  body: Schema.NullOr(Schema.String), // base64
  timing: Schema.Number, // ms
});
export type BrowserReplayResponse = typeof BrowserReplayResponse.Type;
```

---

## Step 2: RPC Definitions — Modify `packages/contracts/src/rpc.ts`

### Add to `WS_METHODS`

```typescript
browserReplayRequest: "browser.replayRequest",
```

### Add RPC definition

```typescript
export const WsBrowserReplayRequestRpc = Rpc.make(WS_METHODS.browserReplayRequest, {
  payload: BrowserReplayRequestInput,
  success: BrowserReplayResponse,
  error: BrowserError,
});
```

### Add to `WsRpcGroup`

```typescript
WsBrowserReplayRequestRpc,
```

---

## Step 3: Server — Replay Implementation

### Add to `BrowserTrafficService` interface

```typescript
declare replayRequest: (input: BrowserReplayRequestInput) => Effect.Effect<BrowserReplayResponse>;
```

### Add to `BrowserTrafficServiceLive` (Layer)

```typescript
replayRequest: (input) =>
  Effect.gen(function* () {
    const startTime = Date.now();

    // Build fetch options
    const fetchHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.headers)) {
      fetchHeaders[key] = value;
    }

    let fetchBody: string | Buffer | undefined;
    if (input.body) {
      fetchBody = Buffer.from(input.body, "base64");
    }

    // Execute request from server process (bypasses CORS entirely)
    const response = yield* Effect.tryPromise({
      try: async () => {
        const resp = await fetch(input.url, {
          method: input.method,
          headers: fetchHeaders,
          body: ["GET", "HEAD"].includes(input.method.toUpperCase()) ? undefined : fetchBody,
          redirect: "manual", // Don't follow redirects — let user see them
        });

        const bodyBuffer = await resp.arrayBuffer();
        const bodyBase64 = Buffer.from(bodyBuffer).toString("base64");

        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((value, key) => {
          respHeaders[key] = value;
        });

        return {
          statusCode: resp.status,
          statusText: resp.statusText,
          headers: respHeaders,
          body: bodyBase64,
          timing: Date.now() - startTime,
        };
      },
      catch: (error) =>
        new BrowserError({
          message: `Replay request failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });

    return response;
  }),
```

### Add RPC handler in `apps/server/src/ws.ts`

```typescript
[WS_METHODS.browserReplayRequest]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserReplayRequest,
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      return yield* service.replayRequest(input);
    }),
    { "rpc.aggregate": "browser" },
  ),
```

### Add to `WsRpcClient` interface and implementation

In `apps/web/src/rpc/wsRpcClient.ts`:

```typescript
// Interface:
readonly replayRequest: RpcUnaryMethod<typeof WS_METHODS.browserReplayRequest>;

// Implementation:
replayRequest: (input) =>
  transport.request((client) =>
    client[WS_METHODS.browserReplayRequest](input),
  ),
```

---

## Step 4: Traffic Inspector — `apps/web/src/components/browser/TrafficInspector.tsx` (NEW FILE)

Split view showing request and response details.

```typescript
import { useState, useEffect } from "react";
import { useBrowserStore } from "../../browserStore";
import { useEnvironmentApi } from "../../environmentApi";
import { BodyViewer } from "./BodyViewer";
import type { BrowserTrafficDetail } from "@t3/contracts";

interface TrafficInspectorProps {
  trafficId: number;
  onSendToRepeater?: (detail: BrowserTrafficDetail) => void;
}

type InspectorTab = "request" | "response";

export function TrafficInspector({ trafficId, onSendToRepeater }: TrafficInspectorProps) {
  const api = useEnvironmentApi();
  const [detail, setDetail] = useState<BrowserTrafficDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<InspectorTab>("request");

  useEffect(() => {
    setLoading(true);
    api?.rpc.browser
      .getTrafficDetail({ id: trafficId })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [trafficId, api]);

  if (loading) {
    return <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">Not found</div>;
  }

  const requestHeaders = parseHeaders(detail.requestHeadersJson);
  const responseHeaders = parseHeaders(detail.responseHeadersJson);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b px-2">
        <TabButton active={activeTab === "request"} onClick={() => setActiveTab("request")}>
          Request
        </TabButton>
        <TabButton active={activeTab === "response"} onClick={() => setActiveTab("response")}>
          Response {detail.statusCode && `(${detail.statusCode})`}
        </TabButton>
        <div className="flex-1" />
        {onSendToRepeater && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onSendToRepeater(detail)}
          >
            Send to Repeater
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "request" ? (
          <div className="space-y-2 p-2">
            {/* Request line */}
            <div className="font-mono text-sm">
              <span className="text-green-500">{detail.method}</span>{" "}
              <span>{detail.url}</span>
            </div>

            {/* Request headers */}
            <HeadersView headers={requestHeaders} />

            {/* Request body */}
            {detail.requestBody && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Body</div>
                <BodyViewer
                  body={detail.requestBody}
                  contentType={requestHeaders["content-type"]}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {/* Status line */}
            <div className="font-mono text-sm">
              <span className={statusColor(detail.statusCode)}>
                {detail.statusCode}
              </span>{" "}
              <span className="text-muted-foreground">{detail.contentType}</span>
            </div>

            {/* Response headers */}
            <HeadersView headers={responseHeaders} />

            {/* Response body */}
            {detail.responseBody && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Body{detail.bodyTruncated && " (truncated)"}
                </div>
                <BodyViewer
                  body={detail.responseBody}
                  contentType={responseHeaders["content-type"]}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "border-b-2 px-2 py-1 text-xs",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> }) {
  return (
    <div className="rounded border bg-muted/20 p-1">
      {Object.entries(headers).map(([key, value]) => (
        <div key={key} className="font-mono text-xs">
          <span className="text-blue-400">{key}</span>
          <span className="text-muted-foreground">: </span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function statusColor(code: number | null): string {
  if (!code) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-green-500";
  if (code >= 300 && code < 400) return "text-yellow-500";
  if (code >= 400 && code < 500) return "text-orange-500";
  if (code >= 500) return "text-red-500";
  return "text-muted-foreground";
}
```

---

## Step 5: Body Viewer — `apps/web/src/components/browser/BodyViewer.tsx` (NEW FILE)

Multi-format body display: JSON (pretty), text, hex, image.

```typescript
import { useState, useMemo } from "react";
import { cn } from "../../lib/utils";

interface BodyViewerProps {
  body: string; // base64-encoded
  contentType?: string;
}

type ViewMode = "auto" | "text" | "json" | "hex" | "image";

export function BodyViewer({ body, contentType }: BodyViewerProps) {
  const [mode, setMode] = useState<ViewMode>("auto");

  const decoded = useMemo(() => {
    try {
      return atob(body);
    } catch {
      return "";
    }
  }, [body]);

  const isJson = contentType?.includes("json") || decoded.trim().startsWith("{") || decoded.trim().startsWith("[");
  const isImage = contentType?.startsWith("image/");
  const isHtml = contentType?.includes("html");

  const effectiveMode = mode === "auto"
    ? isJson ? "json" : isImage ? "image" : "text"
    : mode;

  const prettyJson = useMemo(() => {
    if (effectiveMode !== "json") return "";
    try {
      return JSON.stringify(JSON.parse(decoded), null, 2);
    } catch {
      return decoded;
    }
  }, [decoded, effectiveMode]);

  const hexDump = useMemo(() => {
    if (effectiveMode !== "hex") return "";
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const slice = bytes.slice(i, i + 16);
      const hex = Array.from(slice).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = Array.from(slice).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
      lines.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(48)}  ${ascii}`);
    }
    return lines.join("\n");
  }, [decoded, effectiveMode]);

  return (
    <div className="flex flex-col gap-1">
      {/* Mode selector */}
      <div className="flex gap-1">
        {(["auto", "text", "json", "hex", "image"] as ViewMode[]).map((m) => (
          <button
            key={m}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs",
              mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-auto rounded border bg-muted/20 p-2">
        {effectiveMode === "json" && (
          <pre className="whitespace-pre-wrap font-mono text-xs">{prettyJson}</pre>
        )}
        {effectiveMode === "text" && (
          <pre className="whitespace-pre-wrap font-mono text-xs">{decoded}</pre>
        )}
        {effectiveMode === "hex" && (
          <pre className="font-mono text-xs">{hexDump}</pre>
        )}
        {effectiveMode === "image" && (
          <img
            src={`data:${contentType};base64,${body}`}
            alt="Response body"
            className="max-w-full"
          />
        )}
      </div>

      {/* Size info */}
      <div className="text-xs text-muted-foreground">
        {decoded.length.toLocaleString()} bytes
      </div>
    </div>
  );
}
```

---

## Step 6: Request Repeater — `apps/web/src/components/browser/RequestRepeater.tsx` (NEW FILE)

Edit and replay captured requests.

```typescript
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useEnvironmentApi } from "../../environmentApi";
import { BodyViewer } from "./BodyViewer";
import type { BrowserTrafficDetail, BrowserReplayResponse } from "@t3/contracts";

interface RequestRepeaterProps {
  initialDetail?: BrowserTrafficDetail;
  onClose?: () => void;
}

export function RequestRepeater({ initialDetail, onClose }: RequestRepeaterProps) {
  const api = useEnvironmentApi();

  const initialHeaders = initialDetail?.requestHeadersJson
    ? JSON.parse(initialDetail.requestHeadersJson)
    : {};

  const [method, setMethod] = useState(initialDetail?.method ?? "GET");
  const [url, setUrl] = useState(initialDetail?.url ?? "");
  const [headersText, setHeadersText] = useState(
    Object.entries(initialHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  );
  const [bodyText, setBodyText] = useState(
    initialDetail?.requestBody ? atob(initialDetail.requestBody) : "",
  );
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<BrowserReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    setResponse(null);

    try {
      // Parse headers from text
      const headers: Record<string, string> = {};
      for (const line of headersText.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          headers[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
        }
      }

      const result = await api?.rpc.browser.replayRequest({
        trafficId: initialDetail?.id,
        method,
        url,
        headers,
        body: bodyText ? btoa(bodyText) : undefined,
      });

      if (result) setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <span className="text-xs font-medium">Repeater</span>
        <div className="flex-1" />
        {onClose && (
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Request side */}
        <div className="flex w-1/2 flex-col overflow-hidden border-r">
          {/* Method + URL */}
          <div className="flex items-center gap-1 border-b p-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded border bg-background px-1 py-0.5 font-mono text-xs"
            >
              {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-7 flex-1 font-mono text-xs"
              placeholder="https://target.htb/api/..."
            />
            <Button size="sm" className="h-7 text-xs" onClick={() => void handleSend()} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>

          {/* Headers */}
          <div className="border-b p-2">
            <div className="text-xs font-medium text-muted-foreground">Headers</div>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              className="mt-1 w-full rounded border bg-muted/20 p-1 font-mono text-xs"
              rows={6}
              placeholder="Content-Type: application/json&#10;Authorization: Bearer token..."
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-2">
            <div className="text-xs font-medium text-muted-foreground">Body</div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="mt-1 h-full w-full rounded border bg-muted/20 p-1 font-mono text-xs"
              placeholder='{"key": "value"}'
            />
          </div>
        </div>

        {/* Response side */}
        <div className="flex w-1/2 flex-col overflow-hidden">
          {response ? (
            <>
              <div className="border-b p-2">
                <div className="font-mono text-sm">
                  <span className={statusColor(response.statusCode)}>
                    {response.statusCode}
                  </span>{" "}
                  <span className="text-muted-foreground">{response.statusText}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{response.timing}ms</span>
                </div>
              </div>
              <div className="border-b p-2">
                <div className="text-xs font-medium text-muted-foreground">Headers</div>
                <div className="mt-1 rounded border bg-muted/20 p-1">
                  {Object.entries(response.headers).map(([key, value]) => (
                    <div key={key} className="font-mono text-xs">
                      <span className="text-blue-400">{key}</span>: {value}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {response.body && (
                  <BodyViewer
                    body={response.body}
                    contentType={response.headers["content-type"]}
                  />
                )}
              </div>
            </>
          ) : error ? (
            <div className="flex items-center justify-center p-4 text-sm text-red-500">{error}</div>
          ) : (
            <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
              Send a request to see the response
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-green-500";
  if (code >= 300 && code < 400) return "text-yellow-500";
  if (code >= 400 && code < 500) return "text-orange-500";
  if (code >= 500) return "text-red-500";
  return "text-muted-foreground";
}
```

---

## Step 7: Wire Inspector & Repeater into Layout

### Update browser store

Add to `browserStore.ts`:

```typescript
// State additions:
selectedTrafficId: number | null;
repeaterDetail: BrowserTrafficDetail | null;
showRepeater: boolean;

// Action additions:
setSelectedTraffic: (id: number | null) => void;
openRepeater: (detail: BrowserTrafficDetail) => void;
closeRepeater: () => void;
```

### Update hack route layout

The bottom panel becomes a tabbed view: Traffic Table | Inspector | Repeater.

```typescript
const selectedTrafficId = useBrowserStore((s) => s.selectedTrafficId);
const showRepeater = useBrowserStore((s) => s.showRepeater);
const repeaterDetail = useBrowserStore((s) => s.repeaterDetail);

// Bottom panel:
<div className="h-80 border-t">
  {showRepeater && repeaterDetail ? (
    <RequestRepeater
      initialDetail={repeaterDetail}
      onClose={() => useBrowserStore.getState().closeRepeater()}
    />
  ) : selectedTrafficId ? (
    <TrafficInspector
      trafficId={selectedTrafficId}
      onSendToRepeater={(detail) => useBrowserStore.getState().openRepeater(detail)}
    />
  ) : (
    <TrafficTable
      onSelectEntry={(entry) => useBrowserStore.getState().setSelectedTraffic(entry.id)}
      selectedId={selectedTrafficId}
    />
  )}
</div>
```

> **Better approach:** Use tabs to switch between Traffic/Inspector/Repeater views within the bottom panel, allowing user to keep all three accessible.

---

## Acceptance Criteria

- [ ] Clicking traffic row loads full detail from server (headers + body)
- [ ] Inspector shows request tab: method, URL, headers, body
- [ ] Inspector shows response tab: status, headers, body
- [ ] BodyViewer supports auto-detect, JSON (pretty), text, hex, image modes
- [ ] JSON bodies pretty-printed with syntax formatting
- [ ] Hex dump shows offset + hex + ASCII columns
- [ ] Image bodies rendered as `<img>` from base64 data URI
- [ ] "Send to Repeater" button opens repeater with pre-filled request data
- [ ] Repeater allows editing method via dropdown
- [ ] Repeater allows editing URL
- [ ] Repeater allows editing headers as text (key: value per line)
- [ ] Repeater allows editing body as text
- [ ] Send button fires request from server process (not browser)
- [ ] Replay response displayed with status, headers, body
- [ ] Replay timing shown in milliseconds
- [ ] CORS not an issue (request goes from server, not browser)
- [ ] Redirects shown as-is (manual redirect mode)

---

## Files Summary

**New files (3):**
1. `apps/web/src/components/browser/TrafficInspector.tsx`
2. `apps/web/src/components/browser/BodyViewer.tsx`
3. `apps/web/src/components/browser/RequestRepeater.tsx`

**Modified files (5):**
1. `packages/contracts/src/browser.ts` — replay input/response schemas
2. `packages/contracts/src/rpc.ts` — browserReplayRequest
3. `apps/server/src/browser/Layers/BrowserTrafficService.ts` — replayRequest implementation
4. `apps/server/src/ws.ts` — replay RPC handler
5. `apps/web/src/rpc/wsRpcClient.ts` — add replayRequest to browser namespace
6. `apps/web/src/browserStore.ts` — selectedTrafficId, repeater state
7. `apps/web/src/routes/hack.tsx` — wire inspector + repeater into bottom panel

---

## Test Plan

### Test File: `packages/contracts/src/browser.replay.test.ts`

Replay schema validation.

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BrowserReplayRequestInput, BrowserReplayResponse } from "./browser";

describe("BrowserReplayRequestInput", () => {
  const decode = Schema.decodeUnknownSync(BrowserReplayRequestInput);

  it("accepts minimal GET replay", () => {
    const input = decode({
      method: "GET",
      url: "https://target.htb/api",
      headers: { Accept: "application/json" },
    });
    expect(input.method).toBe("GET");
    expect(input.body).toBeUndefined();
  });

  it("accepts POST with body", () => {
    const input = decode({
      method: "POST",
      url: "https://target.htb/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: Buffer.from("user=admin").toString("base64"),
    });
    expect(input.body).toBeDefined();
  });

  it("accepts optional trafficId", () => {
    const input = decode({
      trafficId: 42,
      method: "GET",
      url: "https://target.htb/",
      headers: {},
    });
    expect(input.trafficId).toBe(42);
  });

  it("rejects missing method", () => {
    expect(() => decode({ url: "https://x.com", headers: {} })).toThrow();
  });

  it("rejects missing url", () => {
    expect(() => decode({ method: "GET", headers: {} })).toThrow();
  });
});

describe("BrowserReplayResponse", () => {
  const decode = Schema.decodeUnknownSync(BrowserReplayResponse);

  it("accepts valid response", () => {
    const resp = decode({
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>OK</html>").toString("base64"),
      timing: 150,
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.timing).toBe(150);
  });

  it("accepts null body", () => {
    const resp = decode({
      statusCode: 204,
      statusText: "No Content",
      headers: {},
      body: null,
      timing: 50,
    });
    expect(resp.body).toBeNull();
  });
});
```

---

### Test File: `apps/server/src/browser/Layers/BrowserTrafficService.replay.test.ts`

Replay request integration test. Needs network access (uses real fetch).

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

layer("BrowserTrafficService — replayRequest", (it) => {
  it.effect("sends GET request and returns response", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/get",
        headers: { Accept: "application/json" },
      });

      assert.equal(result.statusCode, 200);
      assert.isNotNull(result.body);
      assert.isTrue(result.timing > 0);
      assert.isDefined(result.headers["content-type"]);
    }),
  );

  it.effect("sends POST request with body", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const result = yield* service.replayRequest({
        method: "POST",
        url: "https://httpbin.org/post",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ test: true })).toString("base64"),
      });

      assert.equal(result.statusCode, 200);
      const body = JSON.parse(Buffer.from(result.body!, "base64").toString());
      assert.deepInclude(body.json, { test: true });
    }),
  );

  it.effect("does not follow redirects (manual mode)", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/redirect/1",
        headers: {},
      });

      assert.equal(result.statusCode, 302);
    }),
  );

  it.effect("returns error for unreachable host", () =>
    Effect.gen(function* () {
      const service = yield* BrowserTrafficService;
      const result = yield* Effect.either(
        service.replayRequest({
          method: "GET",
          url: "https://this-host-does-not-exist-12345.invalid/",
          headers: {},
        }),
      );

      assert.isTrue(result._tag === "Left");
    }),
  );
});
```

> **Note:** These tests hit real network. Mark with `describe.skipIf(!process.env.CI)` or use a local mock server if network tests are undesirable. Alternative: spin up a local httpbin via Docker in CI.

---

### Test File: `apps/web/src/components/browser/BodyViewer.test.ts`

Pure logic tests for body decoding/formatting.

```typescript
import { describe, expect, it } from "vitest";

// Extract and test the pure logic functions from BodyViewer
// These should be extracted into a separate util if not already

describe("BodyViewer logic", () => {
  describe("base64 decoding", () => {
    it("decodes valid base64 to text", () => {
      const decoded = atob(btoa("hello world"));
      expect(decoded).toBe("hello world");
    });

    it("handles empty string", () => {
      const decoded = atob(btoa(""));
      expect(decoded).toBe("");
    });
  });

  describe("JSON detection", () => {
    it("detects JSON from content-type", () => {
      const contentType = "application/json; charset=utf-8";
      expect(contentType.includes("json")).toBe(true);
    });

    it("detects JSON from body starting with {", () => {
      const body = '{"key": "value"}';
      expect(body.trim().startsWith("{")).toBe(true);
    });

    it("detects JSON array from body starting with [", () => {
      const body = '[1, 2, 3]';
      expect(body.trim().startsWith("[")).toBe(true);
    });
  });

  describe("JSON pretty printing", () => {
    it("formats minified JSON", () => {
      const pretty = JSON.stringify(JSON.parse('{"a":1,"b":2}'), null, 2);
      expect(pretty).toContain("\n");
      expect(pretty).toContain("  ");
    });

    it("returns raw string for invalid JSON", () => {
      const raw = "not json {";
      try {
        JSON.parse(raw);
      } catch {
        // Expected — fallback to raw display
        expect(raw).toBe("not json {");
      }
    });
  });

  describe("hex dump generation", () => {
    it("generates correct hex for ASCII text", () => {
      const text = "AB";
      const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      expect(hex).toBe("41 42");
    });

    it("replaces non-printable chars with dots in ASCII column", () => {
      const byte = 0x01; // non-printable
      const ascii = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";
      expect(ascii).toBe(".");
    });
  });
});
```

---

### Test File: `apps/web/src/browserStore.inspector.test.ts`

Inspector/repeater state transitions.

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useBrowserStore } from "./browserStore";

describe("browserStore — inspector/repeater", () => {
  beforeEach(() => {
    useBrowserStore.setState({
      selectedTrafficId: null,
      repeaterDetail: null,
      showRepeater: false,
    });
  });

  describe("setSelectedTraffic", () => {
    it("sets selectedTrafficId", () => {
      useBrowserStore.getState().setSelectedTraffic(42);
      expect(useBrowserStore.getState().selectedTrafficId).toBe(42);
    });

    it("clears selectedTrafficId with null", () => {
      useBrowserStore.getState().setSelectedTraffic(42);
      useBrowserStore.getState().setSelectedTraffic(null);
      expect(useBrowserStore.getState().selectedTrafficId).toBeNull();
    });
  });

  describe("openRepeater", () => {
    it("sets showRepeater and repeaterDetail", () => {
      const detail = { id: 1, method: "GET", url: "https://x.com" } as any;
      useBrowserStore.getState().openRepeater(detail);
      expect(useBrowserStore.getState().showRepeater).toBe(true);
      expect(useBrowserStore.getState().repeaterDetail).toBe(detail);
    });
  });

  describe("closeRepeater", () => {
    it("clears repeater state", () => {
      useBrowserStore.getState().openRepeater({ id: 1 } as any);
      useBrowserStore.getState().closeRepeater();
      expect(useBrowserStore.getState().showRepeater).toBe(false);
      expect(useBrowserStore.getState().repeaterDetail).toBeNull();
    });
  });
});
```

---

### Test Files Summary for Phase 3

| Test file | Tests | Pattern |
|---|---|---|
| `packages/contracts/src/browser.replay.test.ts` | Replay input/response schema validation | Schema decode |
| `apps/server/src/browser/Layers/BrowserTrafficService.replay.test.ts` | Replay GET, POST, redirect handling, error handling | Effect + real network (or mock server) |
| `apps/web/src/components/browser/BodyViewer.test.ts` | Base64 decode, JSON detection, pretty print, hex dump | Pure logic |
| `apps/web/src/browserStore.inspector.test.ts` | selectedTraffic, openRepeater, closeRepeater state | Pure Zustand state |

**Total new test files: 4**
**Estimated test count: ~20 test cases**
