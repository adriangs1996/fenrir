# Module: Traffic Lens (Web)

> UI state management, tab/traffic display, and lifecycle orchestration for the embedded pentesting browser.

## Public API

### Stores

#### `useTrafficLensStore` (Zustand)

| Selector/Action      | Input                                    | Output                                   | Description                                 |
| -------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `tabs`               | —                                        | `Record<string, TrafficLensTabSnapshot>` | All open tab snapshots                      |
| `activeTabId`        | —                                        | `string \| null`                         | Currently selected tab                      |
| `trafficEntries`     | —                                        | `TrafficLensEntry[]`                     | Captured traffic (newest first)             |
| `selectedTrafficId`  | —                                        | `number \| null`                         | Selected traffic row id (drives Inspector)  |
| `repeaterDetail`     | —                                        | `TrafficLensDetail \| null`              | Active Repeater seed detail                 |
| `showRepeater`       | —                                        | `boolean`                                | Whether the Repeater is visible             |
| `bottomTab`          | —                                        | `"traffic" \| "inspector" \| "repeater"` | Active bottom-panel tab                     |
| `upsertTab`          | `TrafficLensTabSnapshot`                 | `void`                                   | Add or update tab snapshot                  |
| `removeTab`          | `tabId: string`                          | `void`                                   | Remove tab, clear activeTabId if matches    |
| `setActiveTab`       | `tabId: string \| null`                  | `void`                                   | Switch active tab                           |
| `applyEvent`         | `TrafficLensTabEvent`                    | `void`                                   | Apply tab lifecycle event to state          |
| `appendTraffic`      | `TrafficLensEntry`                       | `void`                                   | Upsert traffic entry by requestId           |
| `clearTraffic`       | —                                        | `void`                                   | Wipe all traffic entries                    |
| `setSelectedTraffic` | `id: number \| null`                     | `void`                                   | Select traffic row, switch to Inspector tab |
| `openRepeater`       | `TrafficLensDetail`                      | `void`                                   | Seed Repeater + switch to Repeater tab      |
| `closeRepeater`      | —                                        | `void`                                   | Clear Repeater + return to Traffic tab      |
| `setBottomTab`       | `"traffic" \| "inspector" \| "repeater"` | `void`                                   | Switch bottom-panel tab                     |

### Hooks

#### `useTrafficLensLifecycle(rpcClient: RpcClient): void`

Mount-level orchestration hook. Call once in the route that hosts the browser.

- Subscribes to IPC tab events → `store.applyEvent`
- Restores existing tabs on mount → `store.upsertTab`
- Subscribes to WebSocket traffic stream → `store.appendTraffic`
- Cleans up all subscriptions on unmount

#### `useTrafficLensBounds(containerRef: RefObject<HTMLElement>): void`

Syncs container element bounds to Electron `WebContentsView` position via IPC.

- ResizeObserver tracks container size
- Calls `trafficLensSetBounds`, `trafficLensShowTab`, `trafficLensHideAllTabs`

### Components

#### `TrafficLensAddressBar`

URL input + navigation buttons (back, forward, reload). Reads active tab from store, sends IPC commands.

#### `TrafficLensTabBar`

Horizontal tab strip. Shows open tabs, handles tab switching and closing via store + IPC.

#### `TrafficLensSidebarSection`

Sidebar entry point with "+" button to create new tabs. Renders tab list for quick switching.

#### `TrafficLensViewContainer`

Wrapper div that hosts the Electron `WebContentsView` overlay. Uses `useTrafficLensBounds` to sync position.

#### `TrafficLensTable`

Virtual-scrolled table of captured HTTP traffic. Color-coded methods and status codes. Clear button.

#### `TrafficLensInspector`

Request/response detail viewer for a single traffic entry. Tabs for Request and Response, headers table, and embedded `BodyViewer`. Fetches detail via `client.trafficLens.getTrafficDetail`. "Send to Repeater" hands the detail off to `openRepeater`.

#### `TrafficLensRepeater`

Editable request + replay panel. Method dropdown, URL input, headers textarea (`key: value` per line), body textarea (encoded as base64 on send). Sends via `client.trafficLens.replayRequest` and renders the response (status, headers, body) using `BodyViewer`.

#### `BodyViewer` (internal)

Multi-format display for base64 bodies. Modes: `auto`, `text`, `json` (pretty-printed), `hex` (offset + bytes + ASCII), `image` (data URL). Auto-detects from content-type and body prefix. Used by `TrafficLensInspector` and `TrafficLensRepeater`. Not exported from the barrel.

## Dependencies

### Services Consumed

| Service                 | From Module / Package  | Why                                  |
| ----------------------- | ---------------------- | ------------------------------------ |
| `rpcClient.trafficLens` | `@/rpc/wsRpcClient`    | Traffic queries + event subscription |
| `window.desktopBridge`  | Electron preload (IPC) | Tab lifecycle + bounds sync          |

### Packages

- `@fenrir/contracts` — `TrafficLensTabSnapshot`, `TrafficLensTabEvent`, `TrafficLensEntry`, `TrafficLensDetail`, `TrafficLensReplayResponse`
- `zustand` — State management
- `react` — Components + hooks

## Error Taxonomy

| Error scenario         | Source        | Recovery                                     |
| ---------------------- | ------------- | -------------------------------------------- |
| IPC call fails         | desktopBridge | Silently ignore (desktop may not be running) |
| WS subscription drops  | rpcClient     | Auto-reconnect handled by transport layer    |
| Tab not found in store | applyEvent    | No-op (stale event, tab already removed)     |
| Detail fetch fails     | Inspector     | Renders "Not found" / error message          |
| Replay request fails   | Repeater      | Renders error banner above response area     |

## Filesystem Layout

```
apps/web/src/modules/traffic-lens/
  MODULE.md
  index.ts                              # Barrel export (public API only)
  stores/
    useTrafficLensStore.ts              # Zustand store
    useTrafficLensStore.test.ts
  hooks/
    useTrafficLensBounds.ts             # ResizeObserver → IPC bounds sync
    useTrafficLensSync.ts               # WS subscription → store (internal)
    useTrafficLensLifecycle.ts          # Mount orchestration (public)
  components/
    TrafficLensAddressBar.tsx
    TrafficLensTabBar.tsx
    TrafficLensSidebarSection.tsx
    TrafficLensViewContainer.tsx
    TrafficLensTable.tsx
    TrafficLensInspector.tsx            # Phase 3
    TrafficLensRepeater.tsx             # Phase 3
    BodyViewer.tsx                      # Phase 3 (internal)
    __tests__/
      BodyViewer.test.ts
```

## Integration Points

- **Upstream**: `routes/hack.tsx` calls `useTrafficLensLifecycle` on mount
- **Upstream**: `routes/hack.tsx` renders `TrafficLensInspector` and `TrafficLensRepeater` as bottom-panel tabs
- **Upstream**: `HackSidebar.tsx` renders `TrafficLensSidebarSection`
- **Downstream**: IPC to desktop `TrafficLensManager` for tab control
- **Downstream**: WebSocket RPC to server `TrafficLensService` for traffic data + replay
- **Events**: Tab events flow IPC → store. Traffic events flow WS → store.

## Working On This Module

### For implementers (working INSIDE this module):

- Components in `components/` are internal — rearrange freely
- `useTrafficLensSync` is internal — only `useTrafficLensLifecycle` uses it
- `BodyViewer` is internal — only `TrafficLensInspector` and `TrafficLensRepeater` use it
- Store shape changes affect all internal components — update together
- Tests for store in `stores/`, component tests in `components/__tests__/`

### For consumers (working in OTHER modules):

- Import ONLY from `modules/traffic-lens/index.ts`
- Use `useTrafficLensLifecycle` in route — do NOT manually subscribe to events
- Use `useTrafficLensStore` for reading state (tabs, traffic, activeTabId, selected, repeater)
- Use `TrafficLensSidebarSection` for sidebar integration
- Use `TrafficLensInspector` and `TrafficLensRepeater` for inspection/replay UI
- Never import from `hooks/`, `stores/`, or `components/` directly

## Extension Points (Future Phases)

### Phase 3 — Inspector & Repeater ✅ done

- `TrafficLensInspector.tsx` — request/response detail viewer
- `TrafficLensRepeater.tsx` — edit + resend requests
- `BodyViewer.tsx` — multi-format body display (internal)
- Store extension: `selectedTrafficId`, `repeaterDetail`, `showRepeater`, `bottomTab`

### Phase 4 — Header Rules

- New component: `TrafficLensHeaderRules.tsx` — rule CRUD UI
- Store extension: `headerRules` state slice

### Phase 5 — Sitemap, Cookies, WebSocket Frames

- New components: `TrafficLensSitemap.tsx`, `TrafficLensCookieManager.tsx`, `TrafficLensWebSocketViewer.tsx`
- Store extension: computed sitemap from traffic entries, cookie state, WS frame state
