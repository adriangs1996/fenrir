import type { TrafficLensEntry } from "@fenrir/contracts";

export type TrafficLensTrafficFilterMode =
  | "all"
  | "focus"
  | "api"
  | "documents"
  | "errors"
  | "websockets";

export const TRAFFIC_LENS_FILTER_OPTIONS: ReadonlyArray<{
  id: TrafficLensTrafficFilterMode;
  label: string;
}> = [
  { id: "focus", label: "Focus" },
  { id: "all", label: "All" },
  { id: "api", label: "API" },
  { id: "documents", label: "Docs" },
  { id: "errors", label: "Errors" },
  { id: "websockets", label: "WS" },
];

const STATIC_ASSET_PATH_PATTERN =
  /\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|jsonld|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|ttf|txt|wav|webm|webp|woff2?|xml)$/i;

const TRACKING_HOST_MARKERS = [
  "analytics",
  "rudderstack",
  "segment",
  "sentry",
  "mixpanel",
  "posthog",
  "hotjar",
  "fullstory",
  "doubleclick",
  "googletagmanager",
  "google-analytics",
  "clarity",
  "datadog",
  "newrelic",
];

const TRACKING_PATH_MARKERS = [
  "/track",
  "/tracking",
  "/collect",
  "/analytics",
  "/identify",
  "/telemetry",
  "/events",
];

function normalizeContentType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function includesMarker(candidate: string, markers: readonly string[]): boolean {
  const lower = candidate.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function isStaticAssetRequest(entry: TrafficLensEntry): boolean {
  if (entry.isWebSocket) {
    return false;
  }

  const contentType = normalizeContentType(entry.contentType);
  if (
    contentType.startsWith("image/") ||
    contentType.startsWith("font/") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/") ||
    contentType === "text/css" ||
    contentType.includes("javascript")
  ) {
    return true;
  }

  return STATIC_ASSET_PATH_PATTERN.test(entry.path);
}

function isTrackingRequest(entry: TrafficLensEntry): boolean {
  return (
    includesMarker(entry.host, TRACKING_HOST_MARKERS) ||
    includesMarker(entry.path, TRACKING_PATH_MARKERS)
  );
}

function isDocumentRequest(entry: TrafficLensEntry): boolean {
  if (entry.isWebSocket) {
    return false;
  }

  const contentType = normalizeContentType(entry.contentType);
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return true;
  }

  return (
    entry.method.toUpperCase() === "GET" &&
    !STATIC_ASSET_PATH_PATTERN.test(entry.path) &&
    !entry.path.startsWith("/api") &&
    !entry.path.includes("/graphql")
  );
}

function isLikelyApiRequest(entry: TrafficLensEntry): boolean {
  if (entry.isWebSocket) {
    return false;
  }

  const method = entry.method.toUpperCase();
  const contentType = normalizeContentType(entry.contentType);

  return (
    !["GET", "HEAD", "OPTIONS"].includes(method) ||
    entry.host.startsWith("api.") ||
    entry.path.startsWith("/api") ||
    entry.path.includes("/graphql") ||
    contentType.includes("json") ||
    contentType.includes("protobuf") ||
    contentType.includes("xml")
  );
}

function matchesTrafficSearch(entry: TrafficLensEntry, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    entry.method,
    entry.url,
    entry.host,
    entry.path,
    entry.contentType ?? "",
    entry.statusCode ? String(entry.statusCode) : "",
  ]
    .join("\n")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

export function matchesTrafficEntryFilter(
  entry: TrafficLensEntry,
  options: {
    mode: TrafficLensTrafficFilterMode;
    query: string;
  },
): boolean {
  if (!matchesTrafficSearch(entry, options.query.trim())) {
    return false;
  }

  switch (options.mode) {
    case "all":
      return true;
    case "api":
      return isLikelyApiRequest(entry);
    case "documents":
      return isDocumentRequest(entry);
    case "errors":
      return (entry.statusCode ?? 0) >= 400;
    case "websockets":
      return entry.isWebSocket;
    case "focus":
      if (isTrackingRequest(entry) || isStaticAssetRequest(entry)) {
        return false;
      }
      return (
        isLikelyApiRequest(entry) ||
        isDocumentRequest(entry) ||
        entry.isWebSocket ||
        (entry.statusCode ?? 0) >= 400
      );
    default:
      return true;
  }
}
