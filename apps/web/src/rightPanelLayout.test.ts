import { describe, expect, it } from "vitest";

import {
  RIGHT_PANEL_DEFAULT_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
  resolveDefaultRightPanelWidth,
  resolveRightPanelMaxWidth,
} from "./rightPanelLayout";

describe("rightPanelLayout", () => {
  it("keeps enough room for the main chat column", () => {
    expect(resolveRightPanelMaxWidth(1400)).toBe(760);
    expect(clampRightPanelWidth(900, 1400)).toBe(760);
  });

  it("never shrinks below the panel minimum width", () => {
    expect(clampRightPanelWidth(240, 1400)).toBe(RIGHT_PANEL_MIN_WIDTH);
  });

  it("gives the main chat column priority when space is tight", () => {
    expect(resolveRightPanelMaxWidth(800)).toBe(160);
    expect(clampRightPanelWidth(240, 800)).toBe(160);
  });

  it("uses the existing desktop width as the default before any manual resize", () => {
    expect(resolveDefaultRightPanelWidth(2000)).toBe(RIGHT_PANEL_DEFAULT_MAX_WIDTH);
    expect(resolveDefaultRightPanelWidth(1200)).toBe(504);
  });
});
