---
depends_on:
  - 01-contracts
---

# Plan 05: Server — Associate New Sessions with Their Listener

## Goal

Bug #8: every new session is created with `listenerId: null` because `startSessionPolling` doesn't try to match the discovered session against any of the registered listeners. This breaks listener-keyed UI grouping and (critically) breaks the upgrade flow (plan 06) which needs `listenerId` to look up real LHOST/LPORT.

Implement `findListenerForSession(sessionData, listeners)` and use it during session-discovery in `startSessionPolling`.

## Scope

- Modify: `apps/server/src/metasploit/Layers/MetasploitService.ts`:
  - Add module-private `findListenerForSession` helper.
  - Use it in the session-discovery branch of `startSessionPolling` (around L188–198 originally).
  - Log unmatched-orphan first-seen for diagnostics.

## Background — Match algorithm

A new session is associated with a listener when ALL of the following hold:

1. The session has `via_exploit` populated (msfrpcd reports the exploit module that handled the connection — for our listeners this is the payload string, e.g. `linux/x86/meterpreter/reverse_tcp`).
2. The candidate listener's `payload` equals `session.via_exploit`.
3. The candidate listener's `lport` equals the port part of `session.tunnel_local` (when parseable). If `tunnel_local` is unparseable, port matching is skipped (permissive).
4. Listener LHOST is one of: equal to the host part of `tunnel_local`, OR `0.0.0.0` / `::` / `""` (wildcard accepts any session host).

Tie-break (multiple candidates): prefer the listener with an exact host match over a wildcard.

IPv6 safety: parse the host:port via `lastIndexOf(":")` (IPv6 addresses contain colons). msfrpcd does NOT bracket IPv6 hosts in `tunnel_local` for this format — basic `last-colon` split is correct in practice.

## Steps

### Step 1. Add the helper near the top of the Layer file

In `apps/server/src/metasploit/Layers/MetasploitService.ts`, **before** the `MetasploitServiceLive = Layer.effect(...)` declaration (after the `// ─── Layer ──────────────...` divider, around L81), add:

```typescript
/**
 * Match a discovered session to a registered listener.
 *
 * Returns the listenerId on match, or null if no candidate qualifies.
 * Match rules:
 *   - listener.payload === session.via_exploit
 *   - listener.lport === port(session.tunnel_local) (when parseable)
 *   - listener.lhost is wildcard ("0.0.0.0" / "::" / "") OR equal to host(session.tunnel_local)
 * Tie-break: exact host match wins over wildcard match.
 */
function findListenerForSession(
  s: { via_exploit?: unknown; tunnel_local?: unknown },
  listeners: ReadonlyMap<string, { snapshot: ListenerSnapshot; jobId: string | null }>,
): string | null {
  const payload = typeof s.via_exploit === "string" ? s.via_exploit : "";
  if (!payload) return null;

  const tunnel = typeof s.tunnel_local === "string" ? s.tunnel_local : "";
  // IPv6-safe host:port split via last colon.
  const lastColon = tunnel.lastIndexOf(":");
  const sessionHost = lastColon > 0 ? tunnel.slice(0, lastColon) : "";
  const sessionPortRaw = lastColon > 0 ? tunnel.slice(lastColon + 1) : "";
  const sessionPort = sessionPortRaw === "" ? NaN : Number(sessionPortRaw);
  const havePort = Number.isFinite(sessionPort);

  const candidates: string[] = [];
  for (const [id, state] of listeners) {
    const L = state.snapshot;
    if (L.payload !== payload) continue;
    if (havePort && Number(L.lport) !== sessionPort) continue;

    const wildcard = L.lhost === "0.0.0.0" || L.lhost === "::" || L.lhost === "";
    if (!wildcard && sessionHost && L.lhost !== sessionHost) continue;

    candidates.push(id);
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Multiple candidates — prefer exact host match.
  const exact = candidates.find((id) => listeners.get(id)?.snapshot.lhost === sessionHost);
  return exact ?? candidates[0]!;
}
```

> ⚠️ Generic-typed second param so the helper is testable in isolation but works directly with the existing `listeners` map.

### Step 2. Use the helper in session discovery

In `startSessionPolling`, find the session-first-seen branch (around L188–198 — the `if (!knownSessions.has(sessionId))` block). Replace the snapshot construction so `listenerId` calls the helper instead of being hardcoded `null`:

Before:
```typescript
            if (!knownSessions.has(sessionId)) {
              const snapshot: MsfSessionSnapshot = {
                sessionId,
                type: (sessionData as any).type === "meterpreter" ? "meterpreter" : "shell",
                info: String((sessionData as any).info ?? ""),
                targetHost: String((sessionData as any).session_host ?? "unknown"),
                platform: String((sessionData as any).platform ?? "unknown"),
                via: String((sessionData as any).via_exploit ?? ""),
                listenerId: null,
                openedAt: new Date().toISOString(),
              };
              knownSessions.set(sessionId, snapshot);
              emitEvent({
                type: "session.opened",
                snapshot,
                createdAt: new Date().toISOString(),
              });
            }
```

After:
```typescript
            if (!knownSessions.has(sessionId)) {
              const matchedListenerId = findListenerForSession(
                sessionData as { via_exploit?: unknown; tunnel_local?: unknown },
                listeners,
              );

              if (matchedListenerId === null) {
                // Diagnostic: first-seen orphan session.
                yield* Effect.logInfo(
                  `[metasploit] orphan session ${sessionId} (via=${String(
                    (sessionData as any).via_exploit ?? "?",
                  )}, tunnel_local=${String((sessionData as any).tunnel_local ?? "?")})`,
                );
              }

              const snapshot: MsfSessionSnapshot = {
                sessionId,
                type: (sessionData as any).type === "meterpreter" ? "meterpreter" : "shell",
                info: String((sessionData as any).info ?? ""),
                targetHost: String((sessionData as any).session_host ?? "unknown"),
                platform: String((sessionData as any).platform ?? "unknown"),
                via: String((sessionData as any).via_exploit ?? ""),
                listenerId: matchedListenerId,
                openedAt: new Date().toISOString(),
              };
              knownSessions.set(sessionId, snapshot);
              emitEvent({
                type: "session.opened",
                snapshot,
                createdAt: new Date().toISOString(),
              });
            }
```

### Step 3. Export the helper for tests (optional, recommended)

If tests need to import it directly (plan 08 mock can use it), append at the end of `apps/server/src/metasploit/Layers/MetasploitService.ts`:

```typescript
// Test-only export.
export { findListenerForSession as __findListenerForSessionForTests };
```

## Validation

```bash
bun typecheck
bun lint
bun fmt
bun run test apps/server/src/server.test.ts
```

Grep checks:

```bash
grep -n "findListenerForSession" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 declaration, 1 invocation in startSessionPolling, 1 test export.

grep -n "listenerId: null" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: ZERO matches in the session-discovery branch (was the bug).

grep -n "orphan session" apps/server/src/metasploit/Layers/MetasploitService.ts
# Expect: 1 logInfo site.
```

## Done Criteria

- [ ] `findListenerForSession` helper defined at module scope (file-private) with full match algorithm including IPv6-safe parsing and exact-host tie-break.
- [ ] `startSessionPolling` discovery branch calls `findListenerForSession` and uses the result as `listenerId` (no more hardcoded `null`).
- [ ] Orphan first-seen logs to `Effect.logInfo` for debugging.
- [ ] Helper exported under `__findListenerForSessionForTests` for unit testing in plan 08.
- [ ] `bun typecheck` clean; existing `server.test.ts` still green.
