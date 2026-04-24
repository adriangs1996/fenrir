# Phase 4: Header Rules & CSP Stripping

**Parent plan:** `19-embedded-security-browser.md`
**Depends on:** Phase 2 (traffic interception)
**Delivers:** Toggle to strip CSP/CORS/X-Frame-Options. User-defined header manipulation rules.

---

## Goal

User toggles CSP stripping ON → pages load without content security policy restrictions, cross-origin requests work freely, iframes load without X-Frame-Options blocks. User creates custom header rules (add/modify/remove headers) that apply to all traffic through the embedded browser.

---

## Step 1: SQLite Migration — `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.ts` (NEW FILE)

```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_header_rules (
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
    )
  `;
});
```

Register in `Migrations.ts`:
```typescript
import Migration0025 from "./Migrations/025_BrowserHeaderRules";
[25, "BrowserHeaderRules", Migration0025],
```

---

## Step 2: Contracts — Extend `packages/contracts/src/browser.ts`

### Header rule schemas

```typescript
export const BrowserHeaderRule = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  direction: Schema.Literal("request", "response"),
  action: Schema.Literal("add", "modify", "remove"),
  headerName: Schema.String,
  headerValue: Schema.NullOr(Schema.String),
  urlPattern: Schema.NullOr(Schema.String),
  priority: Schema.Number,
});
export type BrowserHeaderRule = typeof BrowserHeaderRule.Type;

export const BrowserHeaderRuleInput = Schema.Struct({
  name: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  direction: Schema.Literal("request", "response"),
  action: Schema.Literal("add", "modify", "remove"),
  headerName: Schema.String,
  headerValue: Schema.optional(Schema.NullOr(Schema.String)),
  urlPattern: Schema.optional(Schema.NullOr(Schema.String)),
  priority: Schema.optional(Schema.Number),
});
export type BrowserHeaderRuleInput = typeof BrowserHeaderRuleInput.Type;
```

### Add to BrowserEvent union

```typescript
export const BrowserHeaderRuleChangedEvent = Schema.Struct({
  type: Schema.Literal("headerRule.changed"),
});
```

Add to `BrowserEvent` union.

---

## Step 3: RPC Definitions — Modify `packages/contracts/src/rpc.ts`

### Add to `WS_METHODS`

```typescript
browserGetHeaderRules: "browser.getHeaderRules",
browserCreateHeaderRule: "browser.createHeaderRule",
browserUpdateHeaderRule: "browser.updateHeaderRule",
browserDeleteHeaderRule: "browser.deleteHeaderRule",
```

### Add RPC definitions + add to WsRpcGroup

```typescript
export const WsBrowserGetHeaderRulesRpc = Rpc.make(WS_METHODS.browserGetHeaderRules, {
  payload: Schema.Struct({}),
  success: Schema.Array(BrowserHeaderRule),
  error: BrowserError,
});

export const WsBrowserCreateHeaderRuleRpc = Rpc.make(WS_METHODS.browserCreateHeaderRule, {
  payload: BrowserHeaderRuleInput,
  success: BrowserHeaderRule,
  error: BrowserError,
});

export const WsBrowserUpdateHeaderRuleRpc = Rpc.make(WS_METHODS.browserUpdateHeaderRule, {
  payload: Schema.Struct({
    id: Schema.String,
    ...BrowserHeaderRuleInput.fields,
  }),
  success: BrowserHeaderRule,
  error: BrowserError,
});

export const WsBrowserDeleteHeaderRuleRpc = Rpc.make(WS_METHODS.browserDeleteHeaderRule, {
  payload: Schema.Struct({ id: Schema.String }),
  error: BrowserError,
});
```

---

## Step 4: Server — Header Rule Service

### `apps/server/src/browser/Services/BrowserHeaderRuleService.ts` (NEW FILE)

```typescript
import { Effect } from "effect";
import type { BrowserHeaderRule, BrowserHeaderRuleInput } from "@t3/contracts";

export class BrowserHeaderRuleService extends Effect.Service<BrowserHeaderRuleService>()(
  "t3/browser/Services/BrowserHeaderRuleService",
) {
  declare listRules: () => Effect.Effect<readonly BrowserHeaderRule[]>;
  declare createRule: (input: BrowserHeaderRuleInput) => Effect.Effect<BrowserHeaderRule>;
  declare updateRule: (id: string, input: BrowserHeaderRuleInput) => Effect.Effect<BrowserHeaderRule>;
  declare deleteRule: (id: string) => Effect.Effect<void>;
}
```

### `apps/server/src/browser/Layers/BrowserHeaderRuleService.ts` (NEW FILE)

```typescript
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { BrowserHeaderRuleService } from "../Services/BrowserHeaderRuleService";
import { randomUUID } from "node:crypto";

export const BrowserHeaderRuleServiceLive = Layer.effect(
  BrowserHeaderRuleService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return BrowserHeaderRuleService.of({
      listRules: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              id, name,
              enabled, direction, action,
              header_name as "headerName",
              header_value as "headerValue",
              url_pattern as "urlPattern",
              priority
            FROM browser_header_rules
            ORDER BY priority DESC, created_at ASC
          `;
          return rows.map((r) => ({
            ...r,
            enabled: Boolean(r.enabled),
          }));
        }),

      createRule: (input) =>
        Effect.gen(function* () {
          const id = randomUUID();
          yield* sql`
            INSERT INTO browser_header_rules (
              id, name, enabled, direction, action,
              header_name, header_value, url_pattern, priority
            ) VALUES (
              ${id},
              ${input.name},
              ${input.enabled !== false ? 1 : 0},
              ${input.direction},
              ${input.action},
              ${input.headerName},
              ${input.headerValue ?? null},
              ${input.urlPattern ?? null},
              ${input.priority ?? 0}
            )
          `;
          const rows = yield* sql`SELECT * FROM browser_header_rules WHERE id = ${id}`;
          return {
            ...rows[0],
            enabled: Boolean(rows[0].enabled),
            headerName: rows[0].header_name,
            headerValue: rows[0].header_value,
            urlPattern: rows[0].url_pattern,
          };
        }),

      updateRule: (id, input) =>
        Effect.gen(function* () {
          yield* sql`
            UPDATE browser_header_rules SET
              name = ${input.name},
              enabled = ${input.enabled !== false ? 1 : 0},
              direction = ${input.direction},
              action = ${input.action},
              header_name = ${input.headerName},
              header_value = ${input.headerValue ?? null},
              url_pattern = ${input.urlPattern ?? null},
              priority = ${input.priority ?? 0}
            WHERE id = ${id}
          `;
          const rows = yield* sql`SELECT * FROM browser_header_rules WHERE id = ${id}`;
          return {
            ...rows[0],
            enabled: Boolean(rows[0].enabled),
            headerName: rows[0].header_name,
            headerValue: rows[0].header_value,
            urlPattern: rows[0].url_pattern,
          };
        }),

      deleteRule: (id) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM browser_header_rules WHERE id = ${id}`;
        }),
    });
  }),
);
```

### Wire into server.ts

```typescript
import { BrowserHeaderRuleServiceLive } from "./browser/Layers/BrowserHeaderRuleService";
// Add to layer composition:
Layer.provideMerge(BrowserHeaderRuleServiceLive),
```

### Add RPC handlers in ws.ts

```typescript
[WS_METHODS.browserGetHeaderRules]: (_input) =>
  observeRpcEffect(
    WS_METHODS.browserGetHeaderRules,
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      return yield* service.listRules();
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.browserCreateHeaderRule]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserCreateHeaderRule,
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      return yield* service.createRule(input);
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.browserUpdateHeaderRule]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserUpdateHeaderRule,
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      return yield* service.updateRule(input.id, input);
    }),
    { "rpc.aggregate": "browser" },
  ),

[WS_METHODS.browserDeleteHeaderRule]: (input) =>
  observeRpcEffect(
    WS_METHODS.browserDeleteHeaderRule,
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      yield* service.deleteRule(input.id);
    }),
    { "rpc.aggregate": "browser" },
  ),
```

### Add to WsRpcClient

```typescript
// Interface:
readonly getHeaderRules: RpcUnaryNoArgMethod<typeof WS_METHODS.browserGetHeaderRules>;
readonly createHeaderRule: RpcUnaryMethod<typeof WS_METHODS.browserCreateHeaderRule>;
readonly updateHeaderRule: RpcUnaryMethod<typeof WS_METHODS.browserUpdateHeaderRule>;
readonly deleteHeaderRule: RpcUnaryMethod<typeof WS_METHODS.browserDeleteHeaderRule>;
```

---

## Step 5: Desktop — CSP Stripping & Header Rules in `browserManager.ts`

### Add state

```typescript
let cspStrippingEnabled = true; // ON by default for pentesting
let headerRules: BrowserHeaderRule[] = [];
```

### Add IPC bridge for controls

Add to `DesktopBridge` in `ipc.ts`:
```typescript
browserSetCspStripping: (enabled: boolean) => Promise<void>;
browserUpdateHeaderRules: (rules: BrowserHeaderRule[]) => Promise<void>;
```

### CSP stripping implementation

```typescript
export function setCspStripping(enabled: boolean): void {
  cspStrippingEnabled = enabled;
  applyWebRequestHandlers();
}

export function updateHeaderRules(rules: BrowserHeaderRule[]): void {
  headerRules = rules;
  applyWebRequestHandlers();
}

function applyWebRequestHandlers(): void {
  if (!targetSession) return;

  // Response header manipulation (CSP stripping + response header rules)
  targetSession.webRequest.onHeadersReceived(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // CSP stripping
      if (cspStrippingEnabled) {
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
        // Override CORS
        headers["Access-Control-Allow-Origin"] = ["*"];
        headers["Access-Control-Allow-Methods"] = ["*"];
        headers["Access-Control-Allow-Headers"] = ["*"];
        headers["Access-Control-Allow-Credentials"] = ["true"];
      }

      // Apply response header rules
      const responseRules = headerRules.filter(
        (r) => r.enabled && r.direction === "response" && matchesUrl(r.urlPattern, details.url),
      );
      for (const rule of responseRules) {
        const headerKey = findHeaderKey(headers, rule.headerName) || rule.headerName;
        switch (rule.action) {
          case "add":
            if (!headers[headerKey]) {
              headers[headerKey] = [rule.headerValue ?? ""];
            }
            break;
          case "modify":
            headers[headerKey] = [rule.headerValue ?? ""];
            break;
          case "remove":
            delete headers[headerKey];
            break;
        }
      }

      callback({ responseHeaders: headers });
    },
  );

  // Request header manipulation
  targetSession.webRequest.onBeforeSendHeaders(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };

      const requestRules = headerRules.filter(
        (r) => r.enabled && r.direction === "request" && matchesUrl(r.urlPattern, details.url),
      );
      for (const rule of requestRules) {
        switch (rule.action) {
          case "add":
            if (!headers[rule.headerName]) {
              headers[rule.headerName] = rule.headerValue ?? "";
            }
            break;
          case "modify":
            headers[rule.headerName] = rule.headerValue ?? "";
            break;
          case "remove":
            delete headers[rule.headerName];
            break;
        }
      }

      callback({ requestHeaders: headers });
    },
  );
}

// URL pattern matching (simple glob)
function matchesUrl(pattern: string | null, url: string): boolean {
  if (!pattern) return true; // null pattern = match all
  try {
    // Convert glob to regex: * → .*, ? → .
    const regex = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    return regex.test(url);
  } catch {
    return true; // invalid pattern = match all
  }
}

// Case-insensitive header key lookup
function findHeaderKey(headers: Record<string, string[]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((k) => k.toLowerCase() === lower);
}
```

### Call `applyWebRequestHandlers()` in `initBrowserManager`

After creating the session, apply the default CSP stripping:
```typescript
applyWebRequestHandlers();
```

### Add IPC handlers in main.ts

```typescript
const BROWSER_SET_CSP_STRIPPING_CHANNEL = "desktop:browser-set-csp-stripping";
const BROWSER_UPDATE_HEADER_RULES_CHANNEL = "desktop:browser-update-header-rules";

ipcMain.removeHandler(BROWSER_SET_CSP_STRIPPING_CHANNEL);
ipcMain.handle(BROWSER_SET_CSP_STRIPPING_CHANNEL, async (_event, enabled: unknown) => {
  if (typeof enabled !== "boolean") throw new Error("Invalid input.");
  setCspStripping(enabled);
});

ipcMain.removeHandler(BROWSER_UPDATE_HEADER_RULES_CHANNEL);
ipcMain.handle(BROWSER_UPDATE_HEADER_RULES_CHANNEL, async (_event, rules: unknown) => {
  if (!Array.isArray(rules)) throw new Error("Invalid rules.");
  updateHeaderRules(rules);
});
```

### Add preload bridge methods

```typescript
browserSetCspStripping: (enabled: boolean) =>
  ipcRenderer.invoke(BROWSER_SET_CSP_STRIPPING_CHANNEL, enabled),
browserUpdateHeaderRules: (rules: unknown[]) =>
  ipcRenderer.invoke(BROWSER_UPDATE_HEADER_RULES_CHANNEL, rules),
```

---

## Step 6: UI Components

### `apps/web/src/components/browser/BrowserToolbar.tsx` (NEW FILE)

Toggle buttons for CSP stripping and interception.

```typescript
import { Shield, ShieldOff } from "lucide-react";
import { Button } from "../ui/button";
import { useBrowserStore } from "../../browserStore";

export function BrowserToolbar() {
  const cspStripping = useBrowserStore((s) => s.cspStrippingEnabled);

  const toggleCsp = () => {
    const next = !cspStripping;
    useBrowserStore.getState().setCspStripping(next);
    void window.desktopBridge?.browserSetCspStripping(next);
  };

  return (
    <div className="flex items-center gap-1 border-b px-2 py-0.5">
      <Button
        variant={cspStripping ? "default" : "ghost"}
        size="sm"
        className="h-6 gap-1 text-xs"
        onClick={toggleCsp}
      >
        {cspStripping ? <ShieldOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
        CSP Strip {cspStripping ? "ON" : "OFF"}
      </Button>
    </div>
  );
}
```

### `apps/web/src/components/browser/HeaderRulesManager.tsx` (NEW FILE)

CRUD table for header manipulation rules. ~150 lines — standard table with add/edit/delete and toggle enabled. Fetches rules from server on mount via `api.rpc.browser.getHeaderRules()`, creates/updates/deletes via corresponding RPC methods, and after each mutation syncs rules to main process via `window.desktopBridge.browserUpdateHeaderRules(rules)`.

Key UI elements:
- Table: Name, Direction, Action, Header, Value, URL Pattern, Enabled toggle
- Add Rule button → inline form or dialog
- Delete button per row
- On any change: re-fetch rules, push to main process

---

## Step 7: Store Updates

Add to `browserStore.ts`:

```typescript
// State:
cspStrippingEnabled: boolean;
headerRules: BrowserHeaderRule[];

// Initial:
cspStrippingEnabled: true,
headerRules: [],

// Actions:
setCspStripping: (enabled) => set({ cspStrippingEnabled: enabled }),
setHeaderRules: (rules) => set({ headerRules: rules }),
```

---

## Acceptance Criteria

- [ ] CSP stripping ON by default
- [ ] Toggle strips: `content-security-policy`, `content-security-policy-report-only`, `x-frame-options`, `x-content-type-options`
- [ ] Toggle overrides CORS: `access-control-allow-origin: *`, methods, headers
- [ ] Pages that would normally block due to CSP now load scripts/styles freely
- [ ] Iframes that would block due to X-Frame-Options now render
- [ ] User can create header rules with: name, direction (request/response), action (add/modify/remove), header name, header value, URL pattern
- [ ] Rules with URL patterns only apply to matching URLs
- [ ] Rules without URL pattern apply to all URLs
- [ ] Rules can be enabled/disabled individually
- [ ] Rules applied in priority order
- [ ] Rules persist across app restarts (stored in SQLite)
- [ ] Rules synced to main process for runtime application
- [ ] CSP stripping and header rules don't affect Fenrir's own session

---

## Files Summary

**New files (4):**
1. `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.ts`
2. `apps/server/src/browser/Services/BrowserHeaderRuleService.ts`
3. `apps/server/src/browser/Layers/BrowserHeaderRuleService.ts`
4. `apps/web/src/components/browser/BrowserToolbar.tsx`
5. `apps/web/src/components/browser/HeaderRulesManager.tsx`

**Modified files (8):**
1. `packages/contracts/src/browser.ts` — header rule schemas
2. `packages/contracts/src/ipc.ts` — CSP/header rule IPC methods
3. `packages/contracts/src/rpc.ts` — header rule CRUD RPCs
4. `apps/desktop/src/browserManager.ts` — CSP stripping + header rule application via session.webRequest
5. `apps/desktop/src/preload.ts` — CSP/header rule bridge methods
6. `apps/desktop/src/main.ts` — CSP/header rule IPC handlers
7. `apps/server/src/persistence/Migrations.ts` — register migration 025
8. `apps/server/src/ws.ts` — header rule RPC handlers
9. `apps/server/src/server.ts` — wire BrowserHeaderRuleServiceLive
10. `apps/web/src/rpc/wsRpcClient.ts` — header rule methods
11. `apps/web/src/browserStore.ts` — cspStripping, headerRules state

---

## Test Plan

### Test File: `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.test.ts`

Migration schema test.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient";
import { runMigrations } from "../Migrations";

const layer = it.layer(NodeSqliteClient.layerMemory());

layer("025_BrowserHeaderRules", (it) => {
  it.effect("creates browser_header_rules table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 25 });

      const columns = yield* sql<{ name: string }>`PRAGMA table_info(browser_header_rules)`;
      const colNames = columns.map((c) => c.name);

      assert.include(colNames, "id");
      assert.include(colNames, "name");
      assert.include(colNames, "enabled");
      assert.include(colNames, "direction");
      assert.include(colNames, "action");
      assert.include(colNames, "header_name");
      assert.include(colNames, "header_value");
      assert.include(colNames, "url_pattern");
      assert.include(colNames, "priority");
    }),
  );

  it.effect("enforces direction CHECK constraint", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 25 });

      const result = yield* Effect.either(sql`
        INSERT INTO browser_header_rules (id, name, direction, action, header_name)
        VALUES ('r1', 'test', 'invalid', 'add', 'X-Test')
      `);
      assert.isTrue(result._tag === "Left");
    }),
  );

  it.effect("enforces action CHECK constraint", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 25 });

      const result = yield* Effect.either(sql`
        INSERT INTO browser_header_rules (id, name, direction, action, header_name)
        VALUES ('r1', 'test', 'request', 'invalid_action', 'X-Test')
      `);
      assert.isTrue(result._tag === "Left");
    }),
  );
});
```

---

### Test File: `apps/server/src/browser/Layers/BrowserHeaderRuleService.test.ts`

CRUD operations test.

```typescript
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient";
import { runMigrations } from "../../persistence/Migrations";
import { BrowserHeaderRuleService } from "../Services/BrowserHeaderRuleService";
import { BrowserHeaderRuleServiceLive } from "./BrowserHeaderRuleService";

const TestLayer = BrowserHeaderRuleServiceLive.pipe(
  Layer.provide(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(
  Layer.effectDiscard(runMigrations()).pipe(Layer.provide(TestLayer)),
);

layer("BrowserHeaderRuleService", (it) => {
  it.effect("createRule — creates and returns rule with generated id", () =>
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      const rule = yield* service.createRule({
        name: "Add Auth Header",
        direction: "request",
        action: "add",
        headerName: "Authorization",
        headerValue: "Bearer token123",
      });

      assert.isDefined(rule.id);
      assert.equal(rule.name, "Add Auth Header");
      assert.equal(rule.direction, "request");
      assert.equal(rule.action, "add");
      assert.equal(rule.headerName, "Authorization");
      assert.equal(rule.headerValue, "Bearer token123");
      assert.isTrue(rule.enabled);
    }),
  );

  it.effect("listRules — returns all rules ordered by priority", () =>
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      yield* service.createRule({
        name: "Low priority", direction: "request", action: "add",
        headerName: "X-Low", priority: 0,
      });
      yield* service.createRule({
        name: "High priority", direction: "request", action: "add",
        headerName: "X-High", priority: 10,
      });

      const rules = yield* service.listRules();
      assert.equal(rules.length, 2);
      assert.equal(rules[0].name, "High priority"); // higher priority first
    }),
  );

  it.effect("updateRule — modifies existing rule", () =>
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      const created = yield* service.createRule({
        name: "Original", direction: "request", action: "add",
        headerName: "X-Test", headerValue: "v1",
      });

      const updated = yield* service.updateRule(created.id, {
        name: "Updated", direction: "response", action: "modify",
        headerName: "X-Test", headerValue: "v2",
      });

      assert.equal(updated.name, "Updated");
      assert.equal(updated.direction, "response");
      assert.equal(updated.action, "modify");
      assert.equal(updated.headerValue, "v2");
    }),
  );

  it.effect("deleteRule — removes rule", () =>
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      const created = yield* service.createRule({
        name: "To Delete", direction: "request", action: "remove",
        headerName: "X-Remove",
      });

      yield* service.deleteRule(created.id);
      const rules = yield* service.listRules();
      assert.equal(rules.length, 0);
    }),
  );

  it.effect("createRule — disabled by default when explicitly set", () =>
    Effect.gen(function* () {
      const service = yield* BrowserHeaderRuleService;
      const rule = yield* service.createRule({
        name: "Disabled", direction: "request", action: "add",
        headerName: "X-Disabled", enabled: false,
      });
      assert.isFalse(rule.enabled);
    }),
  );
});
```

---

### Test File: `apps/desktop/src/browserManager.headers.test.ts`

Tests CSP stripping and header rule logic. Focus on `matchesUrl` and `applyWebRequestHandlers`.

```typescript
import { describe, expect, it } from "vitest";

// Extract matchesUrl as a testable pure function
// If it's not exported, test it indirectly or extract to a utils file

describe("matchesUrl", () => {
  // Import or inline the function for testing
  const matchesUrl = (pattern: string | null, url: string): boolean => {
    if (!pattern) return true;
    try {
      const regex = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      return regex.test(url);
    } catch {
      return true;
    }
  };

  it("null pattern matches everything", () => {
    expect(matchesUrl(null, "https://anything.com/path")).toBe(true);
  });

  it("exact URL match", () => {
    expect(matchesUrl("https://target.htb/api", "https://target.htb/api")).toBe(true);
  });

  it("wildcard matches any path", () => {
    expect(matchesUrl("https://target.htb/*", "https://target.htb/api/users")).toBe(true);
  });

  it("wildcard matches any host", () => {
    expect(matchesUrl("https://*.htb/*", "https://target.htb/login")).toBe(true);
  });

  it("rejects non-matching URL", () => {
    expect(matchesUrl("https://target.htb/api/*", "https://other.com/api/users")).toBe(false);
  });

  it("question mark matches single char", () => {
    expect(matchesUrl("https://target.htb/v?/api", "https://target.htb/v2/api")).toBe(true);
    expect(matchesUrl("https://target.htb/v?/api", "https://target.htb/v22/api")).toBe(false);
  });

  it("invalid regex pattern returns true (fail-open)", () => {
    expect(matchesUrl("[invalid", "https://anything.com")).toBe(true);
  });
});

describe("CSP header stripping", () => {
  // Test the header filtering logic as a pure function
  const stripCspHeaders = (headers: Record<string, string[]>): Record<string, string[]> => {
    const result = { ...headers };
    for (const key of Object.keys(result)) {
      const lower = key.toLowerCase();
      if (
        lower === "content-security-policy" ||
        lower === "content-security-policy-report-only" ||
        lower === "x-frame-options" ||
        lower === "x-content-type-options"
      ) {
        delete result[key];
      }
    }
    result["Access-Control-Allow-Origin"] = ["*"];
    result["Access-Control-Allow-Methods"] = ["*"];
    result["Access-Control-Allow-Headers"] = ["*"];
    return result;
  };

  it("removes Content-Security-Policy", () => {
    const result = stripCspHeaders({ "Content-Security-Policy": ["default-src 'self'"] });
    expect(result["Content-Security-Policy"]).toBeUndefined();
  });

  it("removes Content-Security-Policy-Report-Only", () => {
    const result = stripCspHeaders({ "Content-Security-Policy-Report-Only": ["default-src 'self'"] });
    expect(result["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("removes X-Frame-Options", () => {
    const result = stripCspHeaders({ "X-Frame-Options": ["DENY"] });
    expect(result["X-Frame-Options"]).toBeUndefined();
  });

  it("removes X-Content-Type-Options", () => {
    const result = stripCspHeaders({ "X-Content-Type-Options": ["nosniff"] });
    expect(result["X-Content-Type-Options"]).toBeUndefined();
  });

  it("handles case-insensitive header names", () => {
    const result = stripCspHeaders({ "content-security-policy": ["script-src 'none'"] });
    expect(result["content-security-policy"]).toBeUndefined();
  });

  it("adds permissive CORS headers", () => {
    const result = stripCspHeaders({});
    expect(result["Access-Control-Allow-Origin"]).toEqual(["*"]);
    expect(result["Access-Control-Allow-Methods"]).toEqual(["*"]);
    expect(result["Access-Control-Allow-Headers"]).toEqual(["*"]);
  });

  it("preserves non-security headers", () => {
    const result = stripCspHeaders({
      "Content-Type": ["text/html"],
      "Content-Security-Policy": ["default-src 'self'"],
    });
    expect(result["Content-Type"]).toEqual(["text/html"]);
  });
});

describe("Header rule application", () => {
  // Pure function test for rule application logic
  const applyRequestRules = (
    headers: Record<string, string>,
    rules: Array<{ action: string; headerName: string; headerValue?: string | null }>,
  ): Record<string, string> => {
    const result = { ...headers };
    for (const rule of rules) {
      switch (rule.action) {
        case "add":
          if (!result[rule.headerName]) result[rule.headerName] = rule.headerValue ?? "";
          break;
        case "modify":
          result[rule.headerName] = rule.headerValue ?? "";
          break;
        case "remove":
          delete result[rule.headerName];
          break;
      }
    }
    return result;
  };

  it("add — only adds if header not present", () => {
    const result = applyRequestRules(
      { "X-Existing": "original" },
      [{ action: "add", headerName: "X-Existing", headerValue: "new" }],
    );
    expect(result["X-Existing"]).toBe("original"); // not overwritten
  });

  it("add — adds missing header", () => {
    const result = applyRequestRules(
      {},
      [{ action: "add", headerName: "X-New", headerValue: "value" }],
    );
    expect(result["X-New"]).toBe("value");
  });

  it("modify — overwrites existing header", () => {
    const result = applyRequestRules(
      { "X-Target": "old" },
      [{ action: "modify", headerName: "X-Target", headerValue: "new" }],
    );
    expect(result["X-Target"]).toBe("new");
  });

  it("remove — deletes header", () => {
    const result = applyRequestRules(
      { "X-Remove": "value" },
      [{ action: "remove", headerName: "X-Remove" }],
    );
    expect(result["X-Remove"]).toBeUndefined();
  });

  it("applies rules in order (priority)", () => {
    const result = applyRequestRules(
      {},
      [
        { action: "add", headerName: "X-Test", headerValue: "first" },
        { action: "modify", headerName: "X-Test", headerValue: "second" },
      ],
    );
    expect(result["X-Test"]).toBe("second");
  });
});
```

---

### Test File: `packages/contracts/src/browser.headerRule.test.ts`

Header rule schema validation.

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BrowserHeaderRule, BrowserHeaderRuleInput } from "./browser";

describe("BrowserHeaderRule", () => {
  const decode = Schema.decodeUnknownSync(BrowserHeaderRule);

  it("accepts valid rule", () => {
    const rule = decode({
      id: "rule-1", name: "Add Auth", enabled: true,
      direction: "request", action: "add",
      headerName: "Authorization", headerValue: "Bearer token",
      urlPattern: "https://target.htb/*", priority: 10,
    });
    expect(rule.direction).toBe("request");
    expect(rule.action).toBe("add");
  });

  it("rejects invalid direction", () => {
    expect(() => decode({
      id: "r1", name: "Bad", enabled: true,
      direction: "sideways", action: "add",
      headerName: "X", headerValue: null, urlPattern: null, priority: 0,
    })).toThrow();
  });

  it("rejects invalid action", () => {
    expect(() => decode({
      id: "r1", name: "Bad", enabled: true,
      direction: "request", action: "destroy",
      headerName: "X", headerValue: null, urlPattern: null, priority: 0,
    })).toThrow();
  });

  it("accepts null headerValue (for remove action)", () => {
    const rule = decode({
      id: "r1", name: "Remove CSP", enabled: true,
      direction: "response", action: "remove",
      headerName: "Content-Security-Policy", headerValue: null,
      urlPattern: null, priority: 0,
    });
    expect(rule.headerValue).toBeNull();
  });
});
```

---

### Test Files Summary for Phase 4

| Test file | Tests | Pattern |
|---|---|---|
| `apps/server/src/persistence/Migrations/025_BrowserHeaderRules.test.ts` | Schema, CHECK constraints | Effect + in-memory SQLite |
| `apps/server/src/browser/Layers/BrowserHeaderRuleService.test.ts` | CRUD: create, list, update, delete, priority ordering | Effect service layer |
| `apps/desktop/src/browserManager.headers.test.ts` | URL matching, CSP stripping, header rule application logic | Pure function |
| `packages/contracts/src/browser.headerRule.test.ts` | Header rule schema validation | Schema decode |

**Total new test files: 4**
**Estimated test count: ~30 test cases**
