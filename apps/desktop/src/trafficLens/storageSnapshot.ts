import type {
  TrafficLensCookieEntry,
  TrafficLensCookieSnapshot,
  TrafficLensDomStorageEntry,
  TrafficLensDomStorageSnapshot,
} from "@fenrir/contracts";

export function buildCookieSnapshot(
  origin: string,
  cookies: readonly TrafficLensCookieEntry[],
): TrafficLensCookieSnapshot {
  return {
    origin,
    cookies: [...cookies],
  };
}

export function buildDomStorageSnapshot(
  origin: string,
  kind: "localStorage" | "sessionStorage",
  entries: readonly TrafficLensDomStorageEntry[],
): TrafficLensDomStorageSnapshot {
  return {
    origin,
    kind,
    entries: [...entries],
  };
}
