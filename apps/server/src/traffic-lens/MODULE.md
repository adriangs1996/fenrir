# Module: Traffic Lens (Server)

> HTTP traffic interception persistence, query, and real-time streaming for the embedded pentesting browser.

## Public API

### Services

#### `TrafficLensService`

| Method             | Input                        | Output                        | Errors                     | Description                                    |
| ------------------ | ---------------------------- | ----------------------------- | -------------------------- | ---------------------------------------------- |
| `ingestTraffic`    | `TrafficLensIngestPayload`   | `void`                        | —                          | Upsert request/response stage from CDP capture |
| `queryTraffic`     | `TrafficLensQueryInput`      | `readonly TrafficLensEntry[]` | —                          | Query entries with filters + pagination        |
| `getTrafficDetail` | `number` (id)                | `TrafficLensDetail`           | `TrafficLensNotFoundError` | Full request/response detail by row ID         |
| `clearTraffic`     | `string?` (tabId)            | `void`                        | —                          | Delete entries by tabId or all                 |
| `subscribe`        | `(TrafficLensEvent => void)` | `() => void`                  | —                          | Subscribe to real-time traffic events          |

### Events Emitted

| Event              | Schema                     | When                                 |
| ------------------ | -------------------------- | ------------------------------------ |
| `traffic.captured` | `TrafficLensCapturedEvent` | Request ingested or response updated |

### Contracts (from `@fenrir/contracts`)

- `TrafficLensTabId` — Branded tab identifier
- `TrafficLensEntry` — Summary row (id, method, url, host, path, status, timing)
- `TrafficLensDetail` — Full row with headers JSON + request/response bodies
- `TrafficLensQueryInput` — Optional filters: tabId, host, method, statusCode, search, limit, offset
- `TrafficLensIngestPayload` — CDP capture payload with stage flag (request/response)
- `TrafficLensCapturedEvent` — Event wrapper around `TrafficLensEntry`
- `TrafficLensEvent` — Union of all tab events + `TrafficLensCapturedEvent`
- `TrafficLensNotFoundError` — Tagged error for missing traffic entry
- `TrafficLensError` — Generic tagged error

## Dependencies

### Services Consumed

| Service     | From Module  | Why                |
| ----------- | ------------ | ------------------ |
| `SqlClient` | `effect/sql` | SQLite persistence |

### Packages

- `@fenrir/contracts` — All `TrafficLens*` schemas
- `effect` — Effect, Layer, ServiceMap

## Error Taxonomy

| Error                      | Tag                        | Recovery                            |
| -------------------------- | -------------------------- | ----------------------------------- |
| `TrafficLensNotFoundError` | `TrafficLensNotFoundError` | 404 to client, UI shows "not found" |
| `TrafficLensError`         | `TrafficLensError`         | Log + toast, non-fatal              |
| SQL errors                 | (die — unrecoverable)      | Crash path, indicates DB corruption |

## Filesystem Layout

```
apps/server/src/traffic-lens/
  MODULE.md
  Services/
    TrafficLensService.ts          # Public contract (Effect Service interface)
  Layers/
    TrafficLensService.ts          # Layer implementation (SQL + event pub-sub)
  __tests__/
    TrafficLensService.test.ts
```

## Integration Points

- **Upstream**: HTTP route `POST /api/traffic-lens/ingest` receives CDP payloads from desktop
- **Upstream**: WebSocket RPC handlers call `queryTraffic`, `getTrafficDetail`, `clearTraffic`
- **Downstream**: `SqlClient` for persistence
- **Events**: `traffic.captured` streamed to web clients via `subscribeTrafficLensEvents` RPC

## Working On This Module

### For implementers (working INSIDE this module):

- Layer implementation in `Layers/TrafficLensService.ts` — change freely without breaking consumers
- Service interface in `Services/TrafficLensService.ts` — changes here are BREAKING
- Tests must cover all 5 public methods
- Body truncation at 10MB is an implementation detail, not part of the contract

### For consumers (working in OTHER modules):

- Import ONLY from `Services/TrafficLensService.ts`
- Never import from `Layers/`
- Handle `TrafficLensNotFoundError` from `getTrafficDetail`
- Subscribe to events via `subscribe()` method, not by importing internals
- Ingest payloads come from desktop via HTTP, not from other server modules

## Extension Points (Future Phases)

### Phase 3 — Inspector & Repeater

- Add `replayRequest(input: TrafficLensReplayInput) => Effect<TrafficLensReplayResult, TrafficLensError>` to service
- New contract schemas: `TrafficLensReplayInput`, `TrafficLensReplayResult`
- New RPC method: `trafficLens.replayRequest`

### Phase 4 — Header Rules & CSP Stripping

- Add header rule CRUD methods to service (or extract separate `TrafficLensHeaderRuleService`)
- New migration for `traffic_lens_header_rules` table
- New contract schemas: `TrafficLensHeaderRule`, `TrafficLensHeaderRuleInput`

### Phase 5 — Sitemap, Cookies, WebSocket Frames

- Passive sitemap aggregation from captured traffic (computed from existing data, likely new service)
- Cookie manager may warrant separate module or service within traffic-lens
- WebSocket frame capture extends ingest pipeline
