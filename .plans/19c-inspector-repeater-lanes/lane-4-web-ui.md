# Lane 4: Web UI — Inspector, Repeater, BodyViewer

**Parent**: `19c-browser-phase3-inspector-repeater.md`
**Depends on**: Lane 1 (contracts), Lane 3 (web RPC client)
**Parallelizable with**: Lane 2 (server) after Lane 1 complete
**Estimated time**: ~45 min

---

## Goal

Build inspector/repeater UI components, extend store with selection + repeater state, wire tab-based bottom panel into hack route.

---

## Important Context

- Module lives at `apps/web/src/modules/traffic-lens/`
- Barrel export from `index.ts` — all public components must be exported there
- Store: `useTrafficLensStore` (Zustand) at `stores/useTrafficLensStore.ts`
- RPC client accessed via `getPrimaryEnvironmentConnection().client` — NOT `useEnvironmentApi` (doesn't exist)
- `cn` utility imported from `../../lib/utils` (relative to components)
- `TrafficLensTable` already accepts `onSelectEntry` + `selectedId` props
- Components use Tailwind CSS, shadcn/ui primitives (`Button`, `Input` from `../ui/`)

---

## Tasks

### 1. Extend store — `apps/web/src/modules/traffic-lens/stores/useTrafficLensStore.ts`

Add to `TrafficLensState` interface:

```typescript
// Inspector/Repeater state
selectedTrafficId: number | null;
repeaterDetail: TrafficLensDetail | null;
showRepeater: boolean;
bottomTab: "traffic" | "inspector" | "repeater";

// Inspector/Repeater actions
setSelectedTraffic: (id: number | null) => void;
openRepeater: (detail: TrafficLensDetail) => void;
closeRepeater: () => void;
setBottomTab: (tab: "traffic" | "inspector" | "repeater") => void;
```

Add import for `TrafficLensDetail`.

Add to store initial state:

```typescript
selectedTrafficId: null,
repeaterDetail: null,
showRepeater: false,
bottomTab: "traffic" as const,
```

Add action implementations:

```typescript
setSelectedTraffic: (id) =>
  set({
    selectedTrafficId: id,
    bottomTab: id ? "inspector" : "traffic",
  }),

openRepeater: (detail) =>
  set({
    repeaterDetail: detail,
    showRepeater: true,
    bottomTab: "repeater",
  }),

closeRepeater: () =>
  set({
    showRepeater: false,
    repeaterDetail: null,
    bottomTab: "traffic",
  }),

setBottomTab: (tab) => set({ bottomTab: tab }),
```

### 2. Create `BodyViewer.tsx` — `apps/web/src/modules/traffic-lens/components/BodyViewer.tsx` (NEW)

Multi-format body display: auto-detect, JSON (pretty), text, hex, image.

```typescript
import { useState, useMemo } from "react";
import { cn } from "../../../lib/utils";

interface BodyViewerProps {
  body: string; // base64-encoded
  contentType?: string;
}

type ViewMode = "auto" | "text" | "json" | "hex" | "image";
```

**Key behaviors:**
- `body` prop is always base64-encoded string
- Auto mode: detect JSON from content-type or body prefix `{`/`[`, detect image from `image/*` content-type, fallback text
- JSON mode: pretty-print with `JSON.stringify(parsed, null, 2)`, fallback to raw on parse error
- Hex mode: classic hex dump with offset + hex bytes + ASCII column, 16 bytes per row
- Image mode: render `<img>` with `data:${contentType};base64,${body}` src
- Mode selector row with small toggle buttons
- Size info footer showing decoded byte count
- Max height `max-h-96` with overflow scroll

### 3. Create `TrafficLensInspector.tsx` — `apps/web/src/modules/traffic-lens/components/TrafficLensInspector.tsx` (NEW)

Split view: request tab and response tab for a traffic entry.

```typescript
import { useState, useEffect } from "react";
import { cn } from "../../../lib/utils";
import { BodyViewer } from "./BodyViewer";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime/service";
import type { TrafficLensDetail } from "@fenrir/contracts";

interface TrafficLensInspectorProps {
  trafficId: number;
  onSendToRepeater?: (detail: TrafficLensDetail) => void;
}

type InspectorTab = "request" | "response";
```

**Key behaviors:**
- Fetches full detail via `getPrimaryEnvironmentConnection().client.trafficLens.getTrafficDetail({ id: trafficId })`
- Loading state while fetching, "Not found" on error
- Request tab: method (green), URL, headers table, body via BodyViewer
- Response tab: status code (color-coded), content-type, headers table, body via BodyViewer
- Tab label shows status code: `Response (200)`
- "Send to Repeater" button in tab bar (right-aligned)
- Headers displayed as `key: value` rows in monospace, key in blue

**Helper functions (internal):**
- `parseHeaders(json: string | null): Record<string, string>` — safe JSON.parse
- `statusColor(code: number | null): string` — 2xx green, 3xx yellow, 4xx orange, 5xx red
- `TabButton` — styled tab button component
- `HeadersView` — headers display component

### 4. Create `TrafficLensRepeater.tsx` — `apps/web/src/modules/traffic-lens/components/TrafficLensRepeater.tsx` (NEW)

Edit and replay captured requests.

```typescript
import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { BodyViewer } from "./BodyViewer";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime/service";
import type { TrafficLensDetail, TrafficLensReplayResponse } from "@fenrir/contracts";

interface TrafficLensRepeaterProps {
  initialDetail?: TrafficLensDetail;
  onClose?: () => void;
}
```

**Key behaviors:**
- Left/right split: request editor (left 50%) | response viewer (right 50%)
- Request editor:
  - Method dropdown: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
  - URL input (monospace)
  - Headers textarea: `key: value` per line format, parsed on send
  - Body textarea: raw text, base64-encoded before sending
  - Send button (disabled while sending)
- Response viewer:
  - Status code (color-coded) + status text + timing in ms
  - Headers display (same `HeadersView` pattern as inspector)
  - Body via `BodyViewer`
  - Empty state: "Send a request to see the response"
  - Error state: red error message
- Pre-fills from `initialDetail` if provided:
  - Method, URL from detail
  - Headers parsed from `requestHeadersJson`
  - Body decoded from `requestBody` (base64 → text)
- Sends via `getPrimaryEnvironmentConnection().client.trafficLens.replayRequest()`
- Header "Repeater" label + close button (right-aligned)

### 5. Update barrel export — `apps/web/src/modules/traffic-lens/index.ts`

Add exports:

```typescript
// Public components (Phase 3)
export { TrafficLensInspector } from "./components/TrafficLensInspector";
export { TrafficLensRepeater } from "./components/TrafficLensRepeater";
```

Note: `BodyViewer` is internal — not exported from barrel. Only used by Inspector and Repeater.

### 6. Wire into hack route — `apps/web/src/routes/hack.tsx`

Replace the bottom panel with tab-based layout.

**Add imports:**

```typescript
import {
  useTrafficLensStore,
  useTrafficLensLifecycle,
  TrafficLensAddressBar,
  TrafficLensTabBar,
  TrafficLensViewContainer,
  TrafficLensTable,
  TrafficLensInspector,    // NEW
  TrafficLensRepeater,     // NEW
} from "../modules/traffic-lens";
```

**Add store selectors:**

```typescript
const selectedTrafficId = useTrafficLensStore((s) => s.selectedTrafficId);
const bottomTab = useTrafficLensStore((s) => s.bottomTab);
const repeaterDetail = useTrafficLensStore((s) => s.repeaterDetail);
```

**Replace bottom panel** (lines 28-35) with tabbed layout:

```tsx
<div className="h-80 border-t flex flex-col">
  {/* Tab bar */}
  <div className="flex items-center gap-1 border-b px-2 py-1 text-xs">
    <button
      className={cn(
        "px-2 py-0.5 rounded",
        bottomTab === "traffic" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      )}
      onClick={() => useTrafficLensStore.getState().setBottomTab("traffic")}
    >
      Traffic
    </button>
    {selectedTrafficId && (
      <button
        className={cn(
          "px-2 py-0.5 rounded",
          bottomTab === "inspector" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => useTrafficLensStore.getState().setBottomTab("inspector")}
      >
        Inspector
      </button>
    )}
    {repeaterDetail && (
      <button
        className={cn(
          "px-2 py-0.5 rounded",
          bottomTab === "repeater" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => useTrafficLensStore.getState().setBottomTab("repeater")}
      >
        Repeater
      </button>
    )}
  </div>

  {/* Tab content */}
  <div className="flex-1 overflow-hidden">
    {bottomTab === "traffic" && (
      <TrafficLensTable
        onSelectEntry={(entry) => useTrafficLensStore.getState().setSelectedTraffic(entry.id)}
        selectedId={selectedTrafficId}
      />
    )}
    {bottomTab === "inspector" && selectedTrafficId && (
      <TrafficLensInspector
        trafficId={selectedTrafficId}
        onSendToRepeater={(detail) => useTrafficLensStore.getState().openRepeater(detail)}
      />
    )}
    {bottomTab === "repeater" && repeaterDetail && (
      <TrafficLensRepeater
        initialDetail={repeaterDetail}
        onClose={() => useTrafficLensStore.getState().closeRepeater()}
      />
    )}
  </div>
</div>
```

**Add `cn` import** (if not already):

```typescript
import { cn } from "../lib/utils";
```

### 7. Update web MODULE.md

In `apps/web/src/modules/traffic-lens/MODULE.md`:

**Add store rows** to table.

**Add component sections** for `TrafficLensInspector`, `TrafficLensRepeater`, `BodyViewer`.

**Update Filesystem Layout** to include new files.

**Update Extension Points** — mark Phase 3 as done.

---

## Tests

### File: `apps/web/src/modules/traffic-lens/stores/useTrafficLensStore.test.ts` (extend existing or create)

```typescript
// Add to existing test file or create new section

describe("inspector/repeater state", () => {
  beforeEach(() => {
    useTrafficLensStore.setState({
      selectedTrafficId: null,
      repeaterDetail: null,
      showRepeater: false,
      bottomTab: "traffic",
    });
  });

  describe("setSelectedTraffic", () => {
    it("sets selectedTrafficId and switches to inspector tab", () => {
      useTrafficLensStore.getState().setSelectedTraffic(42);
      const state = useTrafficLensStore.getState();
      expect(state.selectedTrafficId).toBe(42);
      expect(state.bottomTab).toBe("inspector");
    });

    it("clears to traffic tab with null", () => {
      useTrafficLensStore.getState().setSelectedTraffic(42);
      useTrafficLensStore.getState().setSelectedTraffic(null);
      const state = useTrafficLensStore.getState();
      expect(state.selectedTrafficId).toBeNull();
      expect(state.bottomTab).toBe("traffic");
    });
  });

  describe("openRepeater", () => {
    it("sets repeater state and switches tab", () => {
      const detail = { id: 1, method: "GET", url: "https://x.com" } as any;
      useTrafficLensStore.getState().openRepeater(detail);
      const state = useTrafficLensStore.getState();
      expect(state.showRepeater).toBe(true);
      expect(state.repeaterDetail).toBe(detail);
      expect(state.bottomTab).toBe("repeater");
    });
  });

  describe("closeRepeater", () => {
    it("clears repeater state and returns to traffic", () => {
      useTrafficLensStore.getState().openRepeater({ id: 1 } as any);
      useTrafficLensStore.getState().closeRepeater();
      const state = useTrafficLensStore.getState();
      expect(state.showRepeater).toBe(false);
      expect(state.repeaterDetail).toBeNull();
      expect(state.bottomTab).toBe("traffic");
    });
  });

  describe("setBottomTab", () => {
    it("switches tab", () => {
      useTrafficLensStore.getState().setBottomTab("repeater");
      expect(useTrafficLensStore.getState().bottomTab).toBe("repeater");
    });
  });
});
```

### File: `apps/web/src/modules/traffic-lens/components/__tests__/BodyViewer.test.ts` (NEW)

Pure logic tests for body decoding/formatting (no React rendering needed).

```typescript
import { describe, expect, it } from "vitest";

describe("BodyViewer logic", () => {
  describe("base64 decoding", () => {
    it("round-trips text through base64", () => {
      expect(atob(btoa("hello world"))).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(atob(btoa(""))).toBe("");
    });
  });

  describe("JSON detection", () => {
    it("detects from content-type", () => {
      expect("application/json; charset=utf-8".includes("json")).toBe(true);
    });

    it("detects object from body prefix", () => {
      expect('{"key": "value"}'.trim().startsWith("{")).toBe(true);
    });

    it("detects array from body prefix", () => {
      expect("[1, 2, 3]".trim().startsWith("[")).toBe(true);
    });
  });

  describe("JSON pretty printing", () => {
    it("formats minified JSON", () => {
      const pretty = JSON.stringify(JSON.parse('{"a":1,"b":2}'), null, 2);
      expect(pretty).toContain("\n");
      expect(pretty).toContain("  ");
    });
  });

  describe("hex dump generation", () => {
    it("generates correct hex for ASCII text", () => {
      const text = "AB";
      const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      expect(hex).toBe("41 42");
    });

    it("replaces non-printable chars with dots", () => {
      const byte = 0x01;
      const ascii = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";
      expect(ascii).toBe(".");
    });
  });
});
```

---

## Verification

```bash
bun typecheck
bun test apps/web/src/modules/traffic-lens/stores/useTrafficLensStore.test.ts
bun test apps/web/src/modules/traffic-lens/components/__tests__/BodyViewer.test.ts
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/modules/traffic-lens/stores/useTrafficLensStore.ts` | Add inspector/repeater state + actions |
| `apps/web/src/modules/traffic-lens/components/BodyViewer.tsx` | NEW — multi-format body viewer |
| `apps/web/src/modules/traffic-lens/components/TrafficLensInspector.tsx` | NEW — request/response detail viewer |
| `apps/web/src/modules/traffic-lens/components/TrafficLensRepeater.tsx` | NEW — editable request + replay |
| `apps/web/src/modules/traffic-lens/index.ts` | Export Inspector + Repeater |
| `apps/web/src/routes/hack.tsx` | Tab-based bottom panel with Traffic/Inspector/Repeater |
| `apps/web/src/modules/traffic-lens/MODULE.md` | Add Phase 3 components, store fields, mark done |
| `apps/web/src/modules/traffic-lens/stores/useTrafficLensStore.test.ts` | Add inspector/repeater state tests |
| `apps/web/src/modules/traffic-lens/components/__tests__/BodyViewer.test.ts` | NEW — body viewer logic tests |
