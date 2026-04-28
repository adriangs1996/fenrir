# Module: Traffic Lens (Web)

> UI state management, tab/traffic display, and lifecycle orchestration for the embedded pentesting browser.

## Public API

### Stores

#### `useTrafficLensStore` (Zustand)

| Selector/Action  | Input                    | Output                                   | Description                              |
| ---------------- | ------------------------ | ---------------------------------------- | ---------------------------------------- |
| `tabs`           | —                        | `Record<string, TrafficLensTabSnapshot>` | All open tab snapshots                   |
| `activeTabId`    | —                        | `string \| null`                         | Currently selected tab                   |
| `trafficEntries` | —                        | `TrafficLensEntry[]`                     | Captured traffic (newest first)          |
| `upsertTab`      | `TrafficLensTabSnapshot` | `void`                                   | Add or update tab snapshot               |
| `removeTab`      | `tabId: string`          | `void`                                   | Remove tab, clear activeTabId if matches |
| `setActiveTab`   | `tabId: string \| null`  | `void`                                   | Switch active tab                        |
| `applyEvent`     | `TrafficLensTabEvent`    | `void`                                   | Apply tab lifecycle event to state       |
| `appendTraffic`  | `TrafficLensEntry`       | `void`                                   | Upsert traffic entry by requestId        |
| `clearTraffic`   | —                        | `void`                                   | Wipe all traffic entries                 |

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

## Dependencies

### Services Consumed

| Service                 | From Module / Package  | Why                                  |
| ----------------------- | ---------------------- | ------------------------------------ |
| `rpcClient.trafficLens` | `@/rpc/wsRpcClient`    | Traffic queries + event subscription |
| `window.desktopBridge`  | Electron preload (IPC) | Tab lifecycle + bounds sync          |

### Packages

- `@fenrir/contracts` — `TrafficLensTabSnapshot`, `TrafficLensTabEvent`, `TrafficLensEntry`
- `zustand` — State management
- `react` — Components + hooks

## Error Taxonomy

| Error scenario         | Source        | Recovery                                     |
| ---------------------- | ------------- | -------------------------------------------- |
| IPC call fails         | desktopBridge | Silently ignore (desktop may not be running) |
| WS subscription drops  | rpcClient     | Auto-reconnect handled by transport layer    |
| Tab not found in store | applyEvent    | No-op (stale event, tab already removed)     |

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
  __tests__/
```

## Integration Points

- **Upstream**: `routes/hack.tsx` calls `useTrafficLensLifecycle` on mount
- **Upstream**: `HackSidebar.tsx` renders `TrafficLensSidebarSection`
- **Downstream**: IPC to desktop `TrafficLensManager` for tab control
- **Downstream**: WebSocket RPC to server `TrafficLensService` for traffic data
- **Events**: Tab events flow IPC → store. Traffic events flow WS → store.

## Working On This Module

### For implementers (working INSIDE this module):

- Components in `components/` are internal — rearrange freely
- `useTrafficLensSync` is internal — only `useTrafficLensLifecycle` uses it
- Store shape changes affect all internal components — update together
- Tests for store in `stores/`, component tests in `__tests__/`

### For consumers (working in OTHER modules):

- Import ONLY from `modules/traffic-lens/index.ts`
- Use `useTrafficLensLifecycle` in route — do NOT manually subscribe to events
- Use `useTrafficLensStore` for reading state (tabs, traffic, activeTabId)
- Use `TrafficLensSidebarSection` for sidebar integration
- Never import from `hooks/`, `stores/`, or `components/` directly

## Extension Points (Future Phases)

### Phase 3 — Inspector & Repeater

- New component: `TrafficLensInspector.tsx` — request/response detail viewer
- New component: `TrafficLensRepeater.tsx` — edit + resend requests
- Store extension: `selectedTrafficId`, `repeaterState`

### Phase 4 — Header Rules

- New component: `TrafficLensHeaderRules.tsx` — rule CRUD UI
- Store extension: `headerRules` state slice

### Phase 5 — Sitemap, Cookies, WebSocket Frames

- New components: `TrafficLensSitemap.tsx`, `TrafficLensCookieManager.tsx`, `TrafficLensWebSocketViewer.tsx`
- Store extension: computed sitemap from traffic entries, cookie state, WS frame state
