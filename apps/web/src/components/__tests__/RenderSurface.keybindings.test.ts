import { describe, expect, it } from "vitest";
import type {
  KeybindingCommand,
  KeybindingShortcut,
  ResolvedKeybindingsConfig,
} from "@fenrir/contracts";
import {
  isAppShortcut,
  isNativePasteShortcut,
  resolveViewportSize,
  shouldResyncViewportOnVisibleTransition,
} from "../RenderSurface";

/** Helper to build a minimal keyboard-event-like object. */
function kbd(mods: {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"> {
  return {
    key: mods.key ?? "j",
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  };
}

function modShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function compile(
  bindings: Array<{ command: KeybindingCommand; shortcut: KeybindingShortcut; whenAst?: unknown }>,
): ResolvedKeybindingsConfig {
  return bindings as ResolvedKeybindingsConfig;
}

const DEFAULT_BINDINGS = compile([
  { shortcut: modShortcut("j"), command: "terminal.toggle" },
  { shortcut: modShortcut("d"), command: "diff.toggle" },
  { shortcut: modShortcut("b"), command: "sidebar.toggle" },
  { shortcut: modShortcut("n"), command: "chat.new" },
  { shortcut: modShortcut("c", { shiftKey: true }), command: "editor.sendSelection" },
  { shortcut: modShortcut("e"), command: "editor.toggleChatTab" },
  { shortcut: modShortcut("1"), command: "thread.jump.1" },
  { shortcut: modShortcut("o", { shiftKey: true }), command: "chat.new" },
]);

describe("isAppShortcut", () => {
  describe("editor app shortcuts", () => {
    it("treats Cmd+E as app shortcut on macOS when bound", () => {
      expect(isAppShortcut(kbd({ key: "e", metaKey: true }), DEFAULT_BINDINGS)).toBe(true);
    });

    it("treats Cmd+Shift+O as app shortcut on macOS when bound", () => {
      expect(
        isAppShortcut(kbd({ key: "O", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS),
      ).toBe(true);
    });

    it("treats Cmd+Shift+C as app shortcut on macOS when bound", () => {
      expect(
        isAppShortcut(kbd({ key: "C", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS),
      ).toBe(true);
    });

    it("treats Ctrl+D as app shortcut on non-mac platforms when bound", () => {
      expect(
        isAppShortcut(kbd({ key: "d", ctrlKey: true }), DEFAULT_BINDINGS, {
          platform: "Win32",
        }),
      ).toBe(true);
    });

    it("treats Cmd+B as an app shortcut on macOS when bound", () => {
      expect(isAppShortcut(kbd({ key: "b", metaKey: true }), DEFAULT_BINDINGS)).toBe(true);
    });
  });

  describe("editor passthrough", () => {
    it("does not treat Cmd+V as an app shortcut", () => {
      expect(isAppShortcut(kbd({ key: "v", metaKey: true }), DEFAULT_BINDINGS)).toBe(false);
    });

    it("detects Cmd+V as the native paste shortcut on macOS", () => {
      expect(isNativePasteShortcut(kbd({ key: "v", metaKey: true }), "MacIntel")).toBe(true);
    });

    it("forwards Alt+key to nvim", () => {
      expect(isAppShortcut(kbd({ key: "v", altKey: true }), DEFAULT_BINDINGS)).toBe(false);
    });

    it("forwards plain key to nvim", () => {
      expect(isAppShortcut(kbd({}), DEFAULT_BINDINGS)).toBe(false);
    });

    it("forwards unbound Cmd+letter to nvim", () => {
      expect(isAppShortcut(kbd({ key: "v", metaKey: true }), compile([]))).toBe(false);
    });

    it("forwards Ctrl+C to nvim when it is not bound", () => {
      expect(isAppShortcut(kbd({ key: "c", ctrlKey: true }), DEFAULT_BINDINGS)).toBe(false);
    });
  });
});

describe("RenderSurface visibility helpers", () => {
  it("drops zero-sized hidden viewport measurements", () => {
    expect(resolveViewportSize(0, 600)).toBeNull();
    expect(resolveViewportSize(800, 0)).toBeNull();
    expect(resolveViewportSize(800.9, 599.1)).toEqual({ w: 800, h: 599 });
  });

  it("requests a viewport resync only when the editor becomes visible again", () => {
    expect(shouldResyncViewportOnVisibleTransition(true, true)).toBe(false);
    expect(shouldResyncViewportOnVisibleTransition(true, false)).toBe(false);
    expect(shouldResyncViewportOnVisibleTransition(false, false)).toBe(false);
    expect(shouldResyncViewportOnVisibleTransition(false, true)).toBe(true);
  });
});
