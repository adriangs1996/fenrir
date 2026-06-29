# Module: Browser Lab (Web)

> Browser Lab route, workbench chrome, and embedded host-browser coordination.

## Terminal Adapter Boundary

The route combines terminal-renderable data with a visual browser host:

- **Renderable in a terminal client**: local-server list, tab metadata, active
  URL/title/loading state, Traffic Lens request table, request/response detail,
  replay results, findings, profiles, rules, overrides, cookies, and storage
  snapshots.
- **Requires visual host adapter**: embedded browser viewport, tab show/hide,
  bounds synchronization, Browser Lab navigation buttons, clicking/typing in a
  page, live sessionStorage capture, and paused-request continuation.

Current web/Electron UX uses `window.desktopBridge` through the desktop host
adapter for the visual host. Future native terminal clients should render the
metadata/artifact surfaces and expose host-only actions only when a compatible
browser host adapter is present.

## Implementation Notes

- `BrowserLabRouteView.tsx` hydrates metadata from WebSocket/server RPC and
  synchronizes host runtime state through Traffic Lens desktop bridge methods.
- `openBrowserLabUrl.ts` creates a visual browser tab; terminal clients should
  treat this as host-adapter functionality, not a server control-plane call.
- Traffic details, replay, findings, profiles, rules, and overrides are stable
  metadata surfaces suitable for terminal rendering.
