# Fenrir Codebase Audit — 2026-06-12

Deep-read audit of core runtime paths. Every finding below was verified by reading the
surrounding code and tracing callers; one suspected critical (ACP JSON-RPC id collision)
was investigated and **ruled out** (see "Verified non-bugs").

**Coverage**: `apps/web/src/rpc/*` (full), `apps/web/src/environments/runtime/service.ts`
(partial), `apps/server/src/terminal/Layers/Manager.ts` (full),
`apps/server/src/managedProcess/Layers/LogBuffer.ts` (full),
`packages/effect-acp/src/protocol.ts` (full) + `client.ts` (partial),
`apps/desktop` (security-focused scan). **Not covered**: orchestration, git/vcs layers,
plan-runner, provider adapters, most web components — recommend a follow-up pass there.

---

## 1. Bugs

### BUG-1 (High) — `isHeartbeatFresh()` is a stub that always returns `false`

**File**: `apps/web/src/rpc/wsTransport.ts:205` → consumed at
`apps/web/src/environments/runtime/service.ts:745`

```ts
isHeartbeatFresh(_maxAgeMs = 15_000): boolean {
  return false;
}
```

**Cause / why**: The transport-level heartbeat tracking was never implemented; the method
unconditionally reports "stale". `reconnectEnvironmentConnectionsAfterBrowserResume()` uses
it as the guard to _skip_ healthy connections:

```ts
if (connection.client.isHeartbeatFresh()) { continue; }   // never continues
void connection.reconnect()...
```

So **every** environment connection is force-reconnected on every tab visibility resume /
pageshow (subject only to the cooldown), even when the socket is perfectly healthy.
`reconnect()` tears down the session: in-flight requests reject, all stream subscriptions
drop and resubscribe.

**Repro**: Connect to one or more environments. Hide the tab past the resume cooldown,
re-focus it. Observe full WS session teardown + resubscribe storm in the network panel
despite a healthy connection.

**Fix**: Track last server activity (pong / any inbound frame timestamp) in `WsTransport`
(the protocol layer already sees every response in `protocol.ts` `run` wrapper — stamp
`lastInboundAt` there) and implement `isHeartbeatFresh(maxAgeMs)` as
`Date.now() - lastInboundAt < maxAgeMs`. Also note the secondary bug in the caller:
`lastBrowserResumeReconnectAt = now` is only set _inside_ the loop, so with zero
connections the cooldown never arms (harmless today, surprising later).

---

### BUG-2 (High) — Stream subscription dies permanently and silently on non-transport errors

**File**: `apps/web/src/rpc/wsTransport.ts:160-166` (`subscribe` retry loop)

**Cause / why**: The retry loop only retries when the error message matches
`isTransportConnectionErrorMessage`. Any other failure (server-side stream defect, schema
decode mismatch after a server upgrade, RPC handler error) hits:

```ts
if (!isTransportConnectionErrorMessage(formattedError)) {
  console.warn("WebSocket RPC subscription failed", ...);
  return;   // subscription dead forever, UI never told
}
```

The UI keeps rendering stale data with no error state and no recovery — contrary to the
project's "predictable under failure / session restarts" priority. All long-lived
subscriptions (orchestration shell, terminal events, VCS status, traffic lens…) are
affected.

**Repro**: Make any subscribed server stream fail once with a non-connection error (e.g.
run a client against a newer/older server whose event schema drifted). The corresponding
UI surface freezes permanently until full reload.

**Fix**: Distinguish _fatal_ (e.g. unknown method) from _recoverable_ errors explicitly.
Recoverable → retry with backoff. Fatal → surface to a connection-health atom so the UI
can show a degraded state, instead of `console.warn` + silent death.

---

### BUG-3 (Medium) — `subscribe` hot-loops with zero delay when a stream completes cleanly

**File**: `apps/web/src/rpc/wsTransport.ts:121-177`

**Cause / why**: The `for (;;)` loop only sleeps in the transport-error branch. If the
server _completes_ a subscription stream (success exit — server restart draining streams,
finite stream, server-side scope close), `await runningStream.completed` resolves and the
loop immediately re-subscribes with **no delay**. If the server keeps completing the
stream (e.g. feature disabled, thread archived), client spins at full speed re-issuing the
RPC.

Related: the retry delay for the error path is a fixed 250 ms
(`DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS`) with no backoff. When the server is down past the
protocol's own retry budget, every active subscription polls a dead session at 4 Hz —
dozens of subscriptions × 4 Hz = constant CPU + console spam until reload.

**Repro**: Stop the server for >2 min (exhaust protocol retries) with a busy workspace
open; profile the renderer. Or have any server stream `Stream.empty`-complete.

**Fix**: Sleep on the success-completion path too; use exponential backoff with jitter and
a cap for both paths; reset backoff on first received value (the `hasReceivedValue` hook
already exists).

---

### BUG-4 (Medium) — `RequestOptions.timeout` accepted but ignored; unary RPCs can hang forever

**File**: `apps/web/src/rpc/wsTransport.ts:69-80`

```ts
async request<TSuccess>(execute, _options?: RequestOptions) // _options never read
```

**Cause / why**: The signature advertises a timeout, no caller gets one. If the socket
wedges in a half-open state (no FIN, e.g. network path drop without RST — the exact
"partial stream" failure mode the project prioritizes), `await session.clientPromise` /
the request effect waits indefinitely; UI actions appear to do nothing.

**Repro**: Drop network at the OS level (no RST) mid-session, then trigger any unary
action (e.g. terminal open). The promise never settles until reconnect happens for other
reasons.

**Fix**: Honor the option: `Effect.timeout` around `execute(client)` with a sane default
(e.g. 30 s), mapped to a typed transport error so callers/toasts can react.

---

### BUG-5 (Medium) — Terminal: early PTY output can be dropped at spawn

**File**: `apps/server/src/terminal/Layers/Manager.ts:580-611` + `enqueueProcessEvent`
(141-157)

**Cause / why**: `onData`/`onExit` listeners are attached to the PTY _before_ the session
is transitioned to `running` (`session.pid = processPid; session.status = "running"` only
happens inside the subsequent `modifyManagerState` effect). `enqueueProcessEvent` rejects
events unless `session.status === "running" && session.pid === expectedPid`:

```ts
if (!session.process || session.status !== "running" || session.pid !== expectedPid) {
  return false; // event silently dropped
}
```

Any data the shell emits in the window between listener attachment and the state
transition (fast prompt/banner, `node-pty` flushing buffered output on attach) is silently
discarded. Same window exists for an ultra-fast `onExit` (spawn-fail shells): the exit
event is dropped, leaving the session stuck in `running` with a dead PID until something
else pokes it.

**Repro**: Shell with heavy instant output in rc file (or a candidate shell that exits
immediately); observe missing first chunk in history / a session that claims `running`
with no live process. Timing-dependent — easiest to show by inserting a `yield*
Effect.sleep(10)` before the `modifyManagerState` that flips status.

**Fix**: Set `session.process/pid/status = "running"` _before_ attaching listeners (state
is mutated in place anyway and the whole block runs under the thread lock), or buffer
events unconditionally keyed on `expectedPid` and let the drain validate.

---

### BUG-6 (Medium) — Terminal `write`/`resize` bypass the per-thread lock

**File**: `apps/server/src/terminal/Layers/Manager.ts:946-974`

**Cause / why**: `open`, `restart`, `clear`, `close` all serialize through
`withThreadLock(threadId, …)`. `write` and `resize` do not. During a `restart` (old
process being kill-escalated, new one spawning), a concurrent `write` can:

- land on the _old_ `session.process` reference (input swallowed by a dying PTY), or
- observe `status !== "running"` and fail with `TerminalNotRunningError` even though the
  terminal is "restarting" from the user's perspective.

`resize` additionally mutates `session.cols/rows` mid-restart, racing the restart's own
assignment of `targetCols/targetRows`.

**Repro**: Hold a key down in a terminal while triggering restart; occasionally keystrokes
vanish or an error event fires.

**Fix**: Wrap `write`/`resize` in `withThreadLock` (they're cheap; the lock is per-thread),
or at minimum re-read the session after lock acquisition like the other ops do.

---

### BUG-7 (High, robustness) — One malformed ACP notification tears down the whole agent session

**File**: `packages/effect-acp/src/protocol.ts:259-306` + stdin pump 374-441

**Cause / why**: `handleRequestEncoded` decodes `session/update` /
`session_elicitation_complete` payloads and **fails the effect** on decode error
(`AcpProtocolParseError`). That error propagates out of `routeDecodedMessage` →
`Effect.forEach` → `Stream.runForEach` of the stdin pump → `matchEffect.onFailure` →
`handleTermination`, which fails all pending requests, emits a client protocol error and
terminates the protocol. A single schema-drifted or malformed _notification_ from an agent
(Claude/Codex/etc. shipping a new update variant) kills the entire session mid-turn —
exactly the partial-stream failure mode the project says must stay graceful.

**Repro**: Send one `session/update` notification with an unknown `sessionUpdate` variant
over stdio to a running session; the whole connection terminates instead of skipping the
event.

**Fix**: Treat per-message decode failures as data-plane errors: log via the existing
`decode_failed` logger and drop (or dispatch as `ExtNotification`), reserving stream
termination for transport-level failures only. Same for unknown-variant decode errors.

---

### BUG-8 (High, leak) — `closedSnapshots` retains up to 2 MiB per stopped managed-process instance, forever

**File**: `apps/server/src/managedProcess/Layers/LogBuffer.ts:137, 255-283`

**Cause / why**: `closeAndRotate` stores the full ring-buffer text
(`buf.chunks.map(c => c.bytes).join("")`, capped at 2 MiB / 10k lines) into
`closedSnapshots` keyed by `instanceId`. The only deletion path is `open()` _for the same
instanceId_ — but instance ids are `crypto.randomUUID()` per start
(`managedProcess/Layers/Manager.ts:320,374`), so the key is never reused. Every
stop/restart of a managed process leaks its final log snapshot for the lifetime of the
server.

**Repro**: Restart a chatty managed process N times; heap grows ~N × (ring size). Visible
in a heap snapshot as retained strings under `closedSnapshots`.

**Fix**: Evict by policy — keep only the latest snapshot per `processDefId` (that's what
the "previous logs" UI can show anyway; the on-disk `.log.previous` already persists the
rest), or LRU-cap the map (count + total bytes).

---

### BUG-9 (Low) — `vcs.onStatus` fabricates a `isRepo: false` snapshot when `remoteUpdated` arrives first

**File**: `apps/web/src/rpc/wsRpcClient.ts:115-135`

**Cause / why**: The client-side reducer for the VCS status stream synthesizes a fake
local state (`isRepo: false, refName: null, …`) if a `remoteUpdated` event arrives before
any `snapshot`. After a server-side resubscribe the server presumably re-sends `snapshot`
first, but nothing in the client enforces ordering; one out-of-order event renders
"not a repo" UI for a real repo until the next local update.

**Fix**: Buffer/ignore `remoteUpdated`/`localUpdated` until the first `snapshot` arrives
(`current !== null` gate), rather than synthesizing defaults.

---

### BUG-10 (Low, leak) — Per-thread semaphore map grows without bound

**File**: `apps/server/src/terminal/Layers/Manager.ts:208, 226-242`

**Cause / why**: `threadLocksRef` adds a `Semaphore` per `threadId` and never removes
entries — not even when all sessions of the thread are closed and evicted. Long-running
servers with many threads accumulate dead semaphores.

**Fix**: Drop the entry in `close()` when `sessionsForThread` becomes empty (guarded by the
same lock), or key eviction alongside `evictInactiveSessionsIfNeeded`.

---

### BUG-11 (Medium, security posture) — Browser Lab webviews run with `webSecurity: false` + `allowRunningInsecureContent: true`

**File**: `apps/desktop/src/trafficLensManager.ts:1619-1626`

**Cause / why**: Presumably required for Traffic Lens interception/replay. But these
`WebContentsView`s load _arbitrary external web content_ with same-origin policy disabled
inside the app. `sandbox: true` + `contextIsolation: true` + window-open deny are good
mitigations, but SOP-off means any visited page can read responses from any origin the
session can reach (including localhost services and the Fenrir server itself if reachable
over HTTP).

**Fix**: If interception is the goal, prefer keeping `webSecurity: true` and doing
manipulation at the proxy/CDP layer; if SOP-off is truly required, isolate these views in
a dedicated session partition with a restrictive `webRequest` blocklist for
localhost/private ranges, and document the tradeoff next to the flag.

(For contrast: main app windows at `DesktopApp.ts:1172-1174` are correctly configured —
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; `openExternal` is
validated via `getSafeExternalUrl` on both IPC and window-open paths.)

---

## 2. Performance

### PERF-1 (High) — Terminal history recap is O(history) per output chunk

**File**: `apps/server/src/terminal/Layers/Manager.ts:361-381` (`drainProcessEvents`)

Every output chunk does ``capHistory(`${session.history}${visibleText}`, 5000)`` —
re-concatenating and re-capping the entire history string (potentially hundreds of KB) on
_every_ PTY data event. A `cat large-file` or compile spew produces thousands of chunks
→ quadratic total work on the server hot path, plus GC churn.

**Fix**: Keep history as a line-deque (like LogBuffer's chunk deque: append chunk, track
line counts, evict from front), materializing the string only on `snapshot()`/persist.

### PERF-2 (Medium) — Subscription retry storm (see BUG-3)

Fixed 250 ms retry, no backoff, multiplied by every active subscription when the server is
unreachable. Backoff fixes both correctness and CPU.

### PERF-3 (Medium) — Forced reconnects on tab resume (see BUG-1)

Every resume rebuilds the WS session, re-runs every subscription's initial snapshot query
(orchestration bootstrap, terminal histories, VCS status…). With the heartbeat check
implemented, the common resume becomes a no-op.

### PERF-4 (Low) — `effect-acp` outgoing queue is unbounded with no backpressure

**File**: `packages/effect-acp/src/protocol.ts:84` (`Queue.unbounded`), writer at 443-446.
If the agent process stops draining stdin (wedged), `outgoing` accumulates encoded frames
indefinitely. Bound it (e.g. `Queue.dropping`/`suspend` with a high-water mark) so a stuck
agent surfaces as backpressure → timeout instead of memory growth.

### PERF-5 (Low) — `LogBuffer.read` re-joins the whole ring on every call

**File**: `LogBuffer.ts:231`. Fine at current call frequency; becomes a problem if any
poller calls `read` per tick. Consider caching the joined string until next append/evict
if subscription patterns change.

---

## 3. Refactoring opportunities

### REF-1 — `wsRpcClient.ts` is ~900 lines of mechanically identical passthrough

**File**: `apps/web/src/rpc/wsRpcClient.ts`

~140 methods all reduce to one of three shapes:
`transport.request(c => c[METHOD](input))`, the `{}`-input variant, and
`transport.subscribe(c => c[METHOD](input), listener, options)`. This is exactly the
duplication the project guidelines flag. A small generic factory driven by the
`WS_METHODS` map (`unary(METHOD)`, `unaryNoArg(METHOD)`, `stream(METHOD)`) collapses the
file to the interface + a table, removes copy-paste risk (wrong constant for a method),
and keeps types via the existing `RpcUnaryMethod<...>` machinery.

### REF-2 — `StackRpcClient` abandons the typed contract layer

**File**: `wsRpcClient.ts:59-78, 417-469`

All sourceControl.stack methods are `(input: unknown) => Promise<unknown>` resolved by
string lookup with `as unknown as Record<string, ...>` casts. Every other namespace is
fully typed through `@fenrir/contracts`. Provider-agnostic interface discipline (a core
project rule) is lost here — schema drift between client and server compiles fine. Type it
like the rest (the contracts exist; `STACK_WS_METHODS` values mirror `WS_METHODS` keys).

### REF-3 — Terminal session-state reset block duplicated 7×

**File**: `terminal/Layers/Manager.ts` (≈ lines 457-465, 555-560, 644-649, 893-897,
905-910, 983-987, 1053-1057)

The same 5-7 field reset (`pendingHistoryControlSequence`, `pendingProcessEvents`,
`pendingProcessEventIndex`, `processEventDrainRunning`, sometimes `history`,
`hasRunningSubprocess`, `updatedAt`) is hand-copied with slight variations — BUG-5/BUG-6
class mistakes breed here. Extract `resetSessionBuffers(session)` /
`markSessionStopped(session)` helpers. Likewise the two near-identical
`TerminalSessionState` literal constructors in `open()` (833-855) and `restart()`
(1012-1034) → one `createSessionState(input)` factory.

### REF-4 — Terminal manager mixes `SynchronizedRef` discipline with in-place mutation

**File**: `terminal/Layers/Manager.ts` throughout

`managerStateRef` is a `SynchronizedRef`, but the actual `TerminalSessionState` objects are
mutated freely both inside and _outside_ `modifyManagerState` (e.g. `open()` mutates
`liveSession.cwd/history/...` directly at 890-915; `resize` at 970-972). The ref provides
no real isolation — it's a Map of shared mutable objects — yet the code pays the
ceremony cost and _implies_ a guarantee it doesn't have. Either make session state
immutable (replace map entries) or drop to a plain `Ref<Map>` + thread locks and document
that the lock is the actual synchronization mechanism.

### REF-5 — ACP request-id space is partitioned by convention in three files

**Files**: `packages/effect-acp/src/protocol.ts:85` (`nextRequestId = 1n`),
`client.ts:456` and `agent.ts:365` (`nextRpcRequestId = 1n << 32n`)

Ext requests allocate ids from 1; the typed RpcClient is given `generateRequestId`
starting at 2^32 to avoid colliding on the shared JSON-RPC wire. It works, but the
invariant lives in three places with no comment linking them — a future caller using
`RpcClient.make` without the override collides silently (effect's default counter starts
at 0). Move id allocation into `makeAcpPatchedProtocol` and hand the generator to
consumers, with a comment stating the partition.

### REF-6 — `WsTransport.subscribe`'s reconnect loop reimplements Effect retry

**File**: `wsTransport.ts:105-183`

Hand-rolled `for(;;)` + manual cancel bookkeeping + ad-hoc error classification duplicates
what `Stream.retry(Schedule.exponential ∘ Schedule.jittered)` + `Stream.tapError` provide,
and the manual version is where BUG-2/BUG-3 live. Rebuilding on Effect combinators gets
backoff, interruption and classification declaratively.

### REF-7 — `effect-acp` `incoming` getter hands the same queue to every caller

**File**: `protocol.ts:516-518`

`get incoming() { return Stream.fromQueue(notificationQueue) }` — two consumers will
_steal_ notifications from each other nondeterministically. Today there's presumably one
consumer; make that contract explicit (memoize the stream, or use `PubSub` if fan-out is
ever intended).

---

## Verified non-bugs (checked, ruled out)

- **ACP JSON-RPC id collision** between ext requests and typed RpcClient requests:
  _not_ a bug — `client.ts`/`agent.ts` offset the RpcClient generator to `1n << 32n`
  (kept as REF-5 because the invariant is fragile).
- **`ChatView.tsx` vs `ChatView.browser.tsx`** is not duplication — `.browser.tsx` is a
  vitest browser-mode test harness.
- **MessagesTimeline virtualization** — already virtualized via `@legendapp/list`.
- **WS reconnect schedule off-by-one** (`Schedule.recurs(7)` vs delay table) — indices
  0-6 all resolve to valid delays; behaves as intended.

## Suggested priority order

1. BUG-7 (ACP session death on malformed notification) — direct hit on core reliability.
2. BUG-1 + PERF-3 (heartbeat stub / forced reconnects) — small fix, large UX effect.
3. BUG-2/BUG-3 + REF-6 (subscription retry rewrite) — one change fixes three findings.
4. BUG-8 (managed-process log leak) — trivial eviction policy.
5. BUG-5/BUG-6 + REF-3/REF-4 (terminal manager hardening) — do together in one pass.
6. PERF-1 (terminal history deque) — measurable server CPU win on chatty terminals.
7. REF-1/REF-2 (wsRpcClient generation + typed stack client) — large maintainability win.
