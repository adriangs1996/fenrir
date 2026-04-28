import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  TrafficLensTabSnapshot,
  TrafficLensCreateTabInput,
  TrafficLensTabEvent,
} from "./trafficLens";

const decodeTabSnapshot = Schema.decodeUnknownSync(TrafficLensTabSnapshot);
const decodeCreateTabInput = Schema.decodeUnknownSync(TrafficLensCreateTabInput);
const decodeTabEvent = Schema.decodeUnknownSync(TrafficLensTabEvent);

describe("TrafficLensTabSnapshot", () => {
  it("accepts a valid tab snapshot", () => {
    const parsed = decodeTabSnapshot({
      tabId: "abc-123",
      url: "https://target.htb",
      title: "Target",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    expect(parsed.tabId).toBe("abc-123");
    expect(parsed.loading).toBe(false);
  });

  it("rejects snapshot missing required fields", () => {
    expect(() => decodeTabSnapshot({ tabId: "abc" })).toThrow();
  });

  it("rejects snapshot with wrong field types", () => {
    expect(() =>
      decodeTabSnapshot({
        tabId: "abc",
        url: 123,
        title: "T",
        loading: "no",
        canGoBack: true,
        canGoForward: false,
      }),
    ).toThrow();
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
      },
    });
    expect(event.type).toBe("tab.created");
  });

  it("decodes tab.closed event", () => {
    const event = decodeTabEvent({ type: "tab.closed", tabId: "t1" });
    expect(event.type).toBe("tab.closed");
  });

  it("decodes tab.navigated event", () => {
    const event = decodeTabEvent({
      type: "tab.navigated",
      tabId: "t1",
      url: "https://x.com",
    });
    expect(event.type).toBe("tab.navigated");
  });

  it("decodes tab.titleUpdated event", () => {
    const event = decodeTabEvent({
      type: "tab.titleUpdated",
      tabId: "t1",
      title: "New Title",
    });
    expect(event.type).toBe("tab.titleUpdated");
  });

  it("decodes tab.loadingChanged event", () => {
    const event = decodeTabEvent({
      type: "tab.loadingChanged",
      tabId: "t1",
      loading: true,
    });
    expect(event.type).toBe("tab.loadingChanged");
  });

  it("rejects unknown event type", () => {
    expect(() => decodeTabEvent({ type: "tab.unknown", tabId: "t1" })).toThrow();
  });
});
