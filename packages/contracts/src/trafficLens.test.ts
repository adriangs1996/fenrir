import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensCookieSnapshot,
  TrafficLensDomStorageEntry,
  TrafficLensDomStorageSnapshot,
  TrafficLensCreateTabInput,
  TrafficLensPausedEvent,
  TrafficLensPausedRequest,
  TrafficLensProfile,
  TrafficLensRule,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageEvent,
  TrafficLensStorageEntry,
  TrafficLensStorageOriginSummary,
  TrafficLensTabEvent,
  TrafficLensSetTabMobilePresetInput,
  TrafficLensTabSnapshot,
  TrafficLensMobilePreset,
  TrafficLensSetTabViewModeInput,
  TrafficLensViewMode,
  TrafficLensOverride,
  TrafficLensFinding,
} from "./trafficLens";

const decodeTabSnapshot = Schema.decodeUnknownSync(TrafficLensTabSnapshot);
const decodeCreateTabInput = Schema.decodeUnknownSync(TrafficLensCreateTabInput);
const decodeTabEvent = Schema.decodeUnknownSync(TrafficLensTabEvent);
const decodeProfile = Schema.decodeUnknownSync(TrafficLensProfile);
const decodeRule = Schema.decodeUnknownSync(TrafficLensRule);
const decodePausedRequest = Schema.decodeUnknownSync(TrafficLensPausedRequest);
const decodePausedEvent = Schema.decodeUnknownSync(TrafficLensPausedEvent);
const decodeStorageEntry = Schema.decodeUnknownSync(TrafficLensStorageEntry);
const decodeOverride = Schema.decodeUnknownSync(TrafficLensOverride);
const decodeFinding = Schema.decodeUnknownSync(TrafficLensFinding);
const decodeStorageOriginSummary = Schema.decodeUnknownSync(TrafficLensStorageOriginSummary);
const decodeDomStorageEntry = Schema.decodeUnknownSync(TrafficLensDomStorageEntry);
const decodeCookieSnapshot = Schema.decodeUnknownSync(TrafficLensCookieSnapshot);
const decodeDomStorageSnapshot = Schema.decodeUnknownSync(TrafficLensDomStorageSnapshot);
const decodeStorageAreaVersion = Schema.decodeUnknownSync(TrafficLensStorageAreaVersion);
const decodeArchivedSessionStorageSummary = Schema.decodeUnknownSync(
  TrafficLensArchivedSessionStorageSummary,
);
const decodeStorageEvent = Schema.decodeUnknownSync(TrafficLensStorageEvent);
const decodeSetTabViewModeInput = Schema.decodeUnknownSync(TrafficLensSetTabViewModeInput);
const decodeSetTabMobilePresetInput = Schema.decodeUnknownSync(TrafficLensSetTabMobilePresetInput);
const decodeMobilePreset = Schema.decodeUnknownSync(TrafficLensMobilePreset);
const decodeViewMode = Schema.decodeUnknownSync(TrafficLensViewMode);

describe("TrafficLensTabSnapshot", () => {
  it("accepts a valid tab snapshot", () => {
    const parsed = decodeTabSnapshot({
      tabId: "abc-123",
      url: "https://target.htb",
      title: "Target",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      profileId: "default",
      profileName: "Default",
      viewMode: "desktop",
      mobilePreset: "iphone-15-pro",
    });
    expect(parsed.tabId).toBe("abc-123");
    expect(parsed.profileName).toBe("Default");
    expect(parsed.viewMode).toBe("desktop");
  });

  it("rejects snapshot missing required fields", () => {
    expect(() => decodeTabSnapshot({ tabId: "abc" })).toThrow();
  });
});

describe("TrafficLensCreateTabInput", () => {
  it("accepts empty object (url is optional)", () => {
    const parsed = decodeCreateTabInput({});
    expect(parsed.url).toBeUndefined();
  });

  it("accepts object with url", () => {
    const parsed = decodeCreateTabInput({ url: "https://10.10.10.1" });
    expect(parsed.url).toBe("https://10.10.10.1");
  });
});

describe("TrafficLensTabEvent", () => {
  it("decodes tab.created event", () => {
    const event = decodeTabEvent({
      type: "tab.created",
      snapshot: {
        tabId: "t1",
        url: "about:blank",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        profileId: "default",
        profileName: "Default",
        viewMode: "desktop",
        mobilePreset: "iphone-15-pro",
      },
    });
    expect(event.type).toBe("tab.created");
  });

  it("decodes tab.closed event", () => {
    const event = decodeTabEvent({ type: "tab.closed", tabId: "t1" });
    expect(event.type).toBe("tab.closed");
  });

  it("decodes tab.selected event", () => {
    const event = decodeTabEvent({ type: "tab.selected", tabId: "t1" });
    expect(event.type).toBe("tab.selected");
  });

  it("decodes tab.navigated event with navigation capabilities", () => {
    const event = decodeTabEvent({
      type: "tab.navigated",
      tabId: "t1",
      url: "https://target.htb",
      canGoBack: true,
      canGoForward: false,
    });
    expect(event.type).toBe("tab.navigated");
    if (event.type !== "tab.navigated") throw new Error("Expected tab.navigated event.");
    expect(event.canGoBack).toBe(true);
  });

  it("decodes tab.loadingChanged event with navigation capabilities", () => {
    const event = decodeTabEvent({
      type: "tab.loadingChanged",
      tabId: "t1",
      loading: false,
      canGoBack: true,
      canGoForward: true,
    });
    expect(event.type).toBe("tab.loadingChanged");
    if (event.type !== "tab.loadingChanged") throw new Error("Expected tab.loadingChanged event.");
    expect(event.canGoForward).toBe(true);
  });

  it("decodes tab.viewModeChanged event", () => {
    const event = decodeTabEvent({
      type: "tab.viewModeChanged",
      tabId: "t1",
      viewMode: "mobile",
    });
    expect(event.type).toBe("tab.viewModeChanged");
  });

  it("decodes tab.mobilePresetChanged event", () => {
    const event = decodeTabEvent({
      type: "tab.mobilePresetChanged",
      tabId: "t1",
      mobilePreset: "pixel-8",
    });
    expect(event.type).toBe("tab.mobilePresetChanged");
  });
});

describe("TrafficLensViewMode", () => {
  it("accepts valid view modes", () => {
    expect(decodeViewMode("desktop")).toBe("desktop");
    expect(decodeViewMode("mobile")).toBe("mobile");
  });
});

describe("TrafficLensMobilePreset", () => {
  it("accepts valid mobile presets", () => {
    expect(decodeMobilePreset("iphone-15-pro")).toBe("iphone-15-pro");
    expect(decodeMobilePreset("pixel-8")).toBe("pixel-8");
    expect(decodeMobilePreset("ipad-mini")).toBe("ipad-mini");
  });
});

describe("TrafficLensSetTabViewModeInput", () => {
  it("accepts valid tab view mode input", () => {
    const input = decodeSetTabViewModeInput({
      tabId: "tab-1",
      viewMode: "mobile",
    });
    expect(input.viewMode).toBe("mobile");
  });
});

describe("TrafficLensSetTabMobilePresetInput", () => {
  it("accepts valid tab mobile preset input", () => {
    const input = decodeSetTabMobilePresetInput({
      tabId: "tab-1",
      mobilePreset: "ipad-mini",
    });
    expect(input.mobilePreset).toBe("ipad-mini");
  });
});

describe("TrafficLensProfile", () => {
  it("accepts a valid profile", () => {
    const profile = decodeProfile({
      id: "default",
      name: "Default",
      partitionKey: "persist:traffic-lens:default",
      createdAt: "2026-05-25T12:00:00.000Z",
      updatedAt: "2026-05-25T12:00:00.000Z",
    });
    expect(profile.partitionKey).toContain("traffic-lens");
  });
});

describe("TrafficLensRule", () => {
  it("accepts a pause rule with scope and mutations", () => {
    const rule = decodeRule({
      id: "rule-1",
      name: "Pause API",
      enabled: true,
      phase: "beforeRequest",
      action: "pause",
      scope: {
        method: "POST",
        urlPattern: "*api*",
      },
      headerMutation: {
        set: { "x-debug": "1" },
        remove: ["cookie"],
      },
      createdAt: "2026-05-25T12:00:00.000Z",
      updatedAt: "2026-05-25T12:00:00.000Z",
    });
    expect(rule.scope.method).toBe("POST");
  });
});

describe("TrafficLensPausedRequest", () => {
  it("accepts a paused request payload", () => {
    const paused = decodePausedRequest({
      pauseId: "pause-1",
      tabId: "tab-1",
      requestId: "request-1",
      phase: "beforeRequest",
      method: "POST",
      url: "https://example.com/api",
      headers: { authorization: "Bearer token" },
      body: "Ym9keQ==",
      createdAt: "2026-05-25T12:00:00.000Z",
    });
    expect(paused.phase).toBe("beforeRequest");
  });

  it("decodes paused.created events", () => {
    const event = decodePausedEvent({
      type: "paused.created",
      paused: {
        pauseId: "pause-1",
        tabId: "tab-1",
        requestId: "request-1",
        phase: "beforeRequest",
        method: "GET",
        url: "https://example.com",
        headers: {},
        body: null,
        createdAt: "2026-05-25T12:00:00.000Z",
      },
    });
    expect(event.type).toBe("paused.created");
  });
});

describe("TrafficLensStorageEntry", () => {
  it("accepts localStorage entries", () => {
    const entry = decodeStorageEntry({
      tabId: "tab-1",
      origin: "https://example.com",
      kind: "localStorage",
      key: "token",
      value: "abc",
    });
    expect(entry.kind).toBe("localStorage");
  });
});

describe("TrafficLensOverride", () => {
  it("accepts static mock responses", () => {
    const override = decodeOverride({
      id: "override-1",
      name: "Mock flags",
      enabled: true,
      match: { urlPattern: "*feature-flags*" },
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: "eyJmbGFnIjp0cnVlfQ==",
      },
      createdAt: "2026-05-25T12:00:00.000Z",
      updatedAt: "2026-05-25T12:00:00.000Z",
    });
    expect(override.response.statusCode).toBe(200);
  });
});

describe("TrafficLensFinding", () => {
  it("accepts passive findings", () => {
    const finding = decodeFinding({
      id: 1,
      tabId: "tab-1",
      trafficId: 12,
      kind: "missing-security-header",
      severity: "medium",
      title: "Missing Content-Security-Policy",
      description: "The response did not include a CSP header.",
      evidenceJson: JSON.stringify({ header: "content-security-policy" }),
      createdAt: "2026-05-25T12:00:00.000Z",
    });
    expect(finding.severity).toBe("medium");
  });
});

describe("Traffic lens storage contracts", () => {
  it("accepts storage origin summaries", () => {
    const summary = decodeStorageOriginSummary({
      profileId: "default",
      origin: "https://example.com",
      lastDocumentUrl: "https://example.com/dashboard",
      firstSeenAt: "2026-05-25T12:00:00.000Z",
      lastSeenAt: "2026-05-25T12:00:01.000Z",
      latestCookieVersionId: 1,
      latestLocalStorageVersionId: 2,
      latestSessionStorageVersionId: 3,
      hasLiveSessionStorage: true,
      liveSessionTabIds: ["tab-1"],
    });
    expect(summary.liveSessionTabIds).toEqual(["tab-1"]);
  });

  it("accepts DOM storage snapshots and entries", () => {
    const entry = decodeDomStorageEntry({ key: "token", value: "abc" });
    const snapshot = decodeDomStorageSnapshot({
      origin: "https://example.com",
      kind: "localStorage",
      entries: [entry],
    });
    expect(snapshot.entries[0]?.key).toBe("token");
  });

  it("accepts cookie snapshots", () => {
    const snapshot = decodeCookieSnapshot({
      origin: "https://example.com",
      cookies: [
        {
          name: "session",
          value: "abc",
          domain: ".example.com",
          path: "/",
          secure: true,
          httpOnly: true,
        },
      ],
    });
    expect(snapshot.cookies).toHaveLength(1);
  });

  it("accepts storage version metadata and archived session summaries", () => {
    const version = decodeStorageAreaVersion({
      id: 7,
      profileId: "default",
      origin: "https://example.com",
      areaKind: "sessionStorage",
      scopeKey: "tab:tab-1",
      capturedAt: "2026-05-25T12:00:02.000Z",
      snapshotReason: "tabClose",
      sourceTabId: "tab-1",
      sourceUrl: "https://example.com/dashboard",
    });
    const summary = decodeArchivedSessionStorageSummary({
      versionId: 7,
      profileId: "default",
      origin: "https://example.com",
      sourceTabId: "tab-1",
      sourceUrl: "https://example.com/dashboard",
      capturedAt: "2026-05-25T12:00:02.000Z",
      snapshotReason: "tabClose",
    });
    expect(version.areaKind).toBe("sessionStorage");
    expect(summary.versionId).toBe(7);
  });

  it("accepts structured storage events", () => {
    const event = decodeStorageEvent({
      type: "sessionStorage.snapshotCaptured",
      profileId: "default",
      origin: "https://example.com",
      areaKind: "sessionStorage",
      tabId: "tab-1",
      versionId: 9,
      timestamp: "2026-05-25T12:00:03.000Z",
    });
    expect(event.type).toBe("sessionStorage.snapshotCaptured");
  });
});
