import { describe, expect, it } from "vitest";
import { isAppShortcut } from "../RenderSurface";

/** Helper to build a minimal keyboard-event-like object. */
function kbd(mods: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey"> {
  return {
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  };
}

describe("isAppShortcut", () => {
  // ── macOS (mac = true) ──────────────────────────────────────────────

  describe("macOS", () => {
    const mac = true;

    it("treats Cmd+E as app shortcut", () => {
      expect(isAppShortcut(kbd({ metaKey: true }), mac)).toBe(true);
    });

    it("treats Cmd+Shift+P as app shortcut", () => {
      expect(isAppShortcut(kbd({ metaKey: true, shiftKey: true }), mac)).toBe(true);
    });

    it("forwards plain key to nvim", () => {
      expect(isAppShortcut(kbd({}), mac)).toBe(false);
    });

    it("forwards Ctrl+C to nvim (Ctrl is vim's, not app's on mac)", () => {
      expect(isAppShortcut(kbd({ ctrlKey: true }), mac)).toBe(false);
    });

    it("forwards Shift-only to nvim", () => {
      expect(isAppShortcut(kbd({ shiftKey: true }), mac)).toBe(false);
    });
  });

  // ── Linux / Windows (mac = false) ───────────────────────────────────

  describe("Linux/Windows", () => {
    const mac = false;

    it("treats Ctrl+Shift+P as app shortcut", () => {
      expect(isAppShortcut(kbd({ ctrlKey: true, shiftKey: true }), mac)).toBe(true);
    });

    it("treats Ctrl+Meta as app shortcut", () => {
      expect(isAppShortcut(kbd({ ctrlKey: true, metaKey: true }), mac)).toBe(true);
    });

    it("forwards Ctrl+C (bare) to nvim", () => {
      expect(isAppShortcut(kbd({ ctrlKey: true }), mac)).toBe(false);
    });

    it("forwards Ctrl+D (bare) to nvim", () => {
      expect(isAppShortcut(kbd({ ctrlKey: true }), mac)).toBe(false);
    });

    it("forwards plain key to nvim", () => {
      expect(isAppShortcut(kbd({}), mac)).toBe(false);
    });

    it("forwards Shift-only to nvim", () => {
      expect(isAppShortcut(kbd({ shiftKey: true }), mac)).toBe(false);
    });

    it("forwards Meta-only (no Ctrl) to nvim", () => {
      expect(isAppShortcut(kbd({ metaKey: true }), mac)).toBe(false);
    });
  });
});
