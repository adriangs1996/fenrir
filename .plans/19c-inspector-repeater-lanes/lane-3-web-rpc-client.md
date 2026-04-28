---
depends_on: [lane-1-contracts]
---

# Lane 3: Web RPC Client

**Parent**: `19c-browser-phase3-inspector-repeater.md`
**Depends on**: Lane 1 (contracts)
**Parallelizable with**: Lanes 2, 4 (after Lane 1 complete)
**Estimated time**: ~5 min

---

## Goal

Add `replayRequest` method to web RPC client so UI components can call the server replay endpoint.

---

## Tasks

### 1. Add to interface — `apps/web/src/rpc/wsRpcClient.ts`

In the `trafficLens` section of `WsRpcClient` interface (after line 190, before `onEvent`):

```typescript
readonly replayRequest: RpcUnaryMethod<typeof WS_METHODS.trafficLensReplayRequest>;
```

Full trafficLens block becomes:

```typescript
readonly trafficLens: {
  readonly getTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTraffic>;
  readonly getTrafficDetail: RpcUnaryMethod<typeof WS_METHODS.trafficLensGetTrafficDetail>;
  readonly clearTraffic: RpcUnaryMethod<typeof WS_METHODS.trafficLensClearTraffic>;
  readonly replayRequest: RpcUnaryMethod<typeof WS_METHODS.trafficLensReplayRequest>;  // NEW
  readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTrafficLensEvents>;
};
```

### 2. Add implementation — `apps/web/src/rpc/wsRpcClient.ts`

In the `trafficLens` section of `createWsRpcClient` (after `clearTraffic` impl, before `onEvent`):

```typescript
replayRequest: (input) =>
  transport.request((client) =>
    client[WS_METHODS.trafficLensReplayRequest](input),
  ),
```

Full trafficLens impl block becomes:

```typescript
trafficLens: {
  getTraffic: (input) =>
    transport.request((client) =>
      client[WS_METHODS.trafficLensGetTraffic](input),
    ),
  getTrafficDetail: (input) =>
    transport.request((client) =>
      client[WS_METHODS.trafficLensGetTrafficDetail](input),
    ),
  clearTraffic: (input) =>
    transport.request((client) =>
      client[WS_METHODS.trafficLensClearTraffic](input),
    ),
  replayRequest: (input) =>                                    // NEW
    transport.request((client) =>                               // NEW
      client[WS_METHODS.trafficLensReplayRequest](input),       // NEW
    ),                                                          // NEW
  onEvent: (listener, options) =>
    transport.subscribe(
      (client) => client[WS_METHODS.subscribeTrafficLensEvents]({}),
      listener,
      options,
    ),
},
```

---

## Notes

- No new imports needed — `WS_METHODS` already imported
- Type safety comes from `RpcUnaryMethod<typeof WS_METHODS.trafficLensReplayRequest>` which resolves to `(input: TrafficLensReplayInput) => Promise<TrafficLensReplayResponse>` via the RPC group types
- No tests needed for this file — it's pure type-safe wiring. Type errors caught by `bun typecheck`.

---

## Verification

```bash
bun typecheck
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/rpc/wsRpcClient.ts` | Add `replayRequest` to interface + implementation |
