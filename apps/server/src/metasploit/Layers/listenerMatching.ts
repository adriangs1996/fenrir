/**
 * Session ↔ Listener matching logic.
 *
 * Pure function — no side effects, no service dependencies.
 */
import type { ListenerSnapshot } from "@fenrir/contracts";
import type { RawTcpListenerHandle } from "./RawTcpListener";

// ─── Internal State Type ───────────────────────────────────────────────────

export interface ListenerState {
  snapshot: ListenerSnapshot;
  jobId: string | null;
  transport: "msfrpc" | "direct-tcp";
  /** Non-null only when transport === "direct-tcp". */
  tcpHandle?: RawTcpListenerHandle;
}

// ─── Matching ──────────────────────────────────────────────────────────────

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
export function findListenerForSession(
  s: { via_exploit?: unknown; tunnel_local?: unknown },
  listeners: ReadonlyMap<string, ListenerState>,
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
