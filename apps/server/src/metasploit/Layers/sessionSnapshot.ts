/**
 * Session snapshot builder — deduplicates the raw-RPC-to-snapshot mapping
 * used during hydration, session polling, and upgrade.
 */
import type { MsfSessionSnapshot } from "@fenrir/contracts";
import type { ListenerState } from "./listenerMatching";
import { findListenerForSession } from "./listenerMatching";

/**
 * Build a `MsfSessionSnapshot` from raw MSFRPC session data.
 *
 * @param sessionId   - The MSFRPC session ID (string key from `session.list`).
 * @param raw         - The raw session object from MSFRPC.
 * @param listeners   - Current listener map for session→listener matching.
 */
export function buildSessionSnapshot(
  sessionId: string,
  raw: Record<string, any>,
  listeners: ReadonlyMap<string, ListenerState>,
): MsfSessionSnapshot {
  const matchedListenerId = findListenerForSession(
    raw as { via_exploit?: unknown; tunnel_local?: unknown },
    listeners,
  );

  return {
    sessionId,
    type: raw.type === "meterpreter" ? "meterpreter" : "shell",
    info: String(raw.info ?? ""),
    targetHost: String(raw.session_host ?? "unknown"),
    platform: String(raw.platform ?? "unknown"),
    via: String(raw.via_exploit ?? ""),
    listenerId: matchedListenerId,
    openedAt: new Date().toISOString(),
  };
}
