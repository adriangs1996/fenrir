import { describe, expect, it } from "vitest";
import type { TrafficLensEntry } from "@fenrir/contracts";
import { matchesTrafficEntryFilter } from "./trafficFilters";

function makeEntry(overrides?: Partial<TrafficLensEntry>): TrafficLensEntry {
  return {
    id: 1,
    tabId: "tab-1",
    requestId: "request-1",
    method: "GET",
    url: "https://target.htb/",
    host: "target.htb",
    path: "/",
    statusCode: 200,
    contentType: "text/html",
    contentLength: 1024,
    bodyTruncated: false,
    isWebSocket: false,
    timingStartedAt: "2026-05-25T12:00:00.000Z",
    timingResponseAt: "2026-05-25T12:00:00.100Z",
    timingCompletedAt: "2026-05-25T12:00:00.200Z",
    createdAt: "2026-05-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("matchesTrafficEntryFilter", () => {
  it("keeps app documents in focus mode", () => {
    expect(
      matchesTrafficEntryFilter(makeEntry(), {
        mode: "focus",
        query: "",
      }),
    ).toBe(true);
  });

  it("hides static asset noise in focus mode", () => {
    expect(
      matchesTrafficEntryFilter(
        makeEntry({
          url: "https://target.htb/_next/static/chunks/main.js",
          path: "/_next/static/chunks/main.js",
          contentType: "application/javascript",
        }),
        {
          mode: "focus",
          query: "",
        },
      ),
    ).toBe(false);
  });

  it("hides telemetry noise in focus mode", () => {
    expect(
      matchesTrafficEntryFilter(
        makeEntry({
          method: "POST",
          url: "https://rudderstack.guruwalk.com/v1/track",
          host: "rudderstack.guruwalk.com",
          path: "/v1/track",
          contentType: "application/json",
        }),
        {
          mode: "focus",
          query: "",
        },
      ),
    ).toBe(false);
  });

  it("keeps API calls in api mode", () => {
    expect(
      matchesTrafficEntryFilter(
        makeEntry({
          method: "POST",
          url: "https://target.htb/api/v1/search",
          path: "/api/v1/search",
          contentType: "application/json",
        }),
        {
          mode: "api",
          query: "",
        },
      ),
    ).toBe(true);
  });

  it("keeps websocket entries in websocket mode", () => {
    expect(
      matchesTrafficEntryFilter(
        makeEntry({
          url: "wss://target.htb/socket",
          path: "/socket",
          isWebSocket: true,
          contentType: null,
        }),
        {
          mode: "websockets",
          query: "",
        },
      ),
    ).toBe(true);
  });
});
