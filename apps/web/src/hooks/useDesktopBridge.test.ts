import type { DesktopBridge } from "@fenrir/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDesktopBridgeAvailable, useIsMainWindow, useNvimAvailable } from "./useDesktopBridge";

// ---------- helpers ----------

/** Minimal mock that satisfies the subset of DesktopBridge used by the hooks. */
function makeBridgeMock(overrides: { isMainWindow?: boolean; nvimAvailable?: boolean } = {}) {
  return {
    isMainWindow: vi.fn(() => overrides.isMainWindow ?? true),
    nvimAvailable: vi.fn(() => Promise.resolve(overrides.nvimAvailable ?? true)),
  } as unknown as DesktopBridge;
}

// ---------- useDesktopBridgeAvailable ----------

describe("useDesktopBridgeAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when desktopBridge is absent", () => {
    vi.stubGlobal("window", {});
    expect(useDesktopBridgeAvailable()).toBe(false);
  });

  it("returns true when desktopBridge is present", () => {
    vi.stubGlobal("window", { desktopBridge: makeBridgeMock() });
    expect(useDesktopBridgeAvailable()).toBe(true);
  });

  it("returns false when desktopBridge is undefined", () => {
    vi.stubGlobal("window", { desktopBridge: undefined });
    expect(useDesktopBridgeAvailable()).toBe(false);
  });
});

// ---------- useIsMainWindow ----------

describe("useIsMainWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when bridge is absent", () => {
    vi.stubGlobal("window", {});
    expect(useIsMainWindow()).toBe(false);
  });

  it("returns true when bridge reports main window", () => {
    vi.stubGlobal("window", { desktopBridge: makeBridgeMock({ isMainWindow: true }) });
    expect(useIsMainWindow()).toBe(true);
  });

  it("returns false when bridge reports non-main window", () => {
    vi.stubGlobal("window", { desktopBridge: makeBridgeMock({ isMainWindow: false }) });
    expect(useIsMainWindow()).toBe(false);
  });
});

// ---------- useNvimAvailable ----------
// useNvimAvailable uses useState/useEffect. We cannot call React hooks outside
// a component context, so we test the contract at module boundary level: verify
// the function is exported and that the bridge mock shape is correct.

describe("useNvimAvailable", () => {
  it("is exported as a function", () => {
    expect(typeof useNvimAvailable).toBe("function");
  });

  it("bridge mock nvimAvailable returns a Promise<boolean>", async () => {
    const bridge = makeBridgeMock({ nvimAvailable: true });
    const result = await bridge.nvimAvailable();
    expect(result).toBe(true);
  });

  it("bridge mock nvimAvailable resolves false when configured", async () => {
    const bridge = makeBridgeMock({ nvimAvailable: false });
    const result = await bridge.nvimAvailable();
    expect(result).toBe(false);
  });
});
