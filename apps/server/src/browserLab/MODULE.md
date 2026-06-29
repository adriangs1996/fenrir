# Module: Browser Lab (Server)

> Server-side control bridge for Browser Lab host-browser automation and MCP
> artifact materialization.

## Terminal Adapter Boundary

Browser Lab has two distinct capability classes:

- **Terminal-renderable metadata/artifacts**: tab snapshots, active-tab state,
  sanitized DOM snapshots, screenshots persisted as `fenrir-image://...`
  handles, Traffic Lens request summaries/details, findings, rules, overrides,
  profiles, cookies, and storage snapshots.
- **Visual browser host view**: tab creation/display, navigation, clicking,
  typing, keypresses, live storage capture, paused-request continuation, and
  screenshot capture. These require an attached desktop/browser host because the
  server routes commands through `/api/browser-lab/control/ws`.

Terminal clients should consume the first class as structured metadata or
artifacts. They should not assume they can render or own the embedded browser
view unless a host adapter is connected. If future native terminal work adds a
browser data plane, it should sit beside this control bridge rather than passing
browser pixels or terminal byte streams through orchestration paths.

## Integration Points

- `browserLabControlHttp.ts` owns the desktop-host control WebSocket and MCP
  call endpoint.
- `browser_lab_screenshot` results are persisted through
  `mcpImageArtifactStore` and returned as Fenrir image handles.
- Traffic request metadata is served by `TrafficLensService`; the browser host
  remains responsible for visual tab state and CDP-backed interactions.
