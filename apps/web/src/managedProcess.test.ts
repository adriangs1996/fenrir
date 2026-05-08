import type { ManagedProcessInstance } from "@fenrir/contracts";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  displayBranchSlug,
  isSameHostAsServer,
  urlForDisplay,
  STATUS_DOT_COLOR,
} from "./managedProcess";

describe("displayBranchSlug", () => {
  it("returns empty string for null", () => {
    expect(displayBranchSlug(null)).toBe("");
  });

  it("lowercases and replaces slashes with dashes", () => {
    expect(displayBranchSlug("feature/Add-Login")).toBe("feature-add-login");
  });

  it("replaces non-alphanumeric characters with dashes", () => {
    expect(displayBranchSlug("feature/foo_bar.baz")).toBe("feature-foo-bar-baz");
  });

  it("collapses consecutive dashes", () => {
    expect(displayBranchSlug("feature//double---dash")).toBe("feature-double-dash");
  });

  it("strips leading and trailing dashes", () => {
    expect(displayBranchSlug("-leading-and-trailing-")).toBe("leading-and-trailing");
  });

  it("handles a simple branch name", () => {
    expect(displayBranchSlug("main")).toBe("main");
  });

  it("handles complex branch with multiple separators", () => {
    expect(displayBranchSlug("refs/heads/feature/JIRA-123_my.branch")).toBe(
      "refs-heads-feature-jira-123-my-branch",
    );
  });
});

describe("isSameHostAsServer", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Provide a minimal window mock
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "localhost" } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  });

  it("returns false for null serverHost", () => {
    expect(isSameHostAsServer(null)).toBe(false);
  });

  it("returns true when hostname matches exactly", () => {
    Object.defineProperty(globalThis.window, "location", {
      value: { hostname: "myserver.local" },
      writable: true,
      configurable: true,
    });
    expect(isSameHostAsServer("myserver.local")).toBe(true);
  });

  it("returns true for localhost fallback", () => {
    Object.defineProperty(globalThis.window, "location", {
      value: { hostname: "localhost" },
      writable: true,
      configurable: true,
    });
    expect(isSameHostAsServer("anything")).toBe(true);
  });

  it("returns false when hostnames differ", () => {
    Object.defineProperty(globalThis.window, "location", {
      value: { hostname: "other.host" },
      writable: true,
      configurable: true,
    });
    expect(isSameHostAsServer("different.host")).toBe(false);
  });
});

describe("urlForDisplay", () => {
  it("returns confirmed url when available", () => {
    const instance = {
      url: { confirmed: "http://localhost:3000", estimate: "http://localhost:3001" },
    } as ManagedProcessInstance;
    expect(urlForDisplay(instance)).toBe("http://localhost:3000");
  });

  it("falls back to estimate when confirmed is null", () => {
    const instance = {
      url: { confirmed: null, estimate: "http://localhost:3001" },
    } as ManagedProcessInstance;
    expect(urlForDisplay(instance)).toBe("http://localhost:3001");
  });

  it("returns null when both are null", () => {
    const instance = {
      url: { confirmed: null, estimate: null },
    } as ManagedProcessInstance;
    expect(urlForDisplay(instance)).toBeNull();
  });
});

describe("STATUS_DOT_COLOR", () => {
  it("covers all expected statuses", () => {
    expect(STATUS_DOT_COLOR).toHaveProperty("idle");
    expect(STATUS_DOT_COLOR).toHaveProperty("starting");
    expect(STATUS_DOT_COLOR).toHaveProperty("running");
    expect(STATUS_DOT_COLOR).toHaveProperty("stopping");
    expect(STATUS_DOT_COLOR).toHaveProperty("stopped");
    expect(STATUS_DOT_COLOR).toHaveProperty("crashed");
  });
});
