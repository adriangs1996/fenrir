import { describe, expect, it } from "vitest";

import { shouldReserveDesktopTitlebarLeadingInset } from "./desktopTitleBar";

describe("shouldReserveDesktopTitlebarLeadingInset", () => {
  it("reserves the leading inset on macOS when the desktop sidebar is collapsed", () => {
    expect(
      shouldReserveDesktopTitlebarLeadingInset({
        isElectron: true,
        isMobile: false,
        platform: "MacIntel",
        sidebarOpen: false,
      }),
    ).toBe(true);
  });

  it("does not reserve the leading inset when the sidebar is open", () => {
    expect(
      shouldReserveDesktopTitlebarLeadingInset({
        isElectron: true,
        isMobile: false,
        platform: "MacIntel",
        sidebarOpen: true,
      }),
    ).toBe(false);
  });

  it("does not reserve the leading inset on non-macOS platforms", () => {
    expect(
      shouldReserveDesktopTitlebarLeadingInset({
        isElectron: true,
        isMobile: false,
        platform: "Win32",
        sidebarOpen: false,
      }),
    ).toBe(false);
  });
});
