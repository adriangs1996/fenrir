import { describe, expect, it } from "vitest";

import { resolveTerminalCloseFocusTarget } from "../focus";

describe("resolveTerminalCloseFocusTarget", () => {
  it("restores editor focus when the editor tab is active and available", () => {
    expect(
      resolveTerminalCloseFocusTarget({
        activeChatTab: "editor",
        editorAvailable: true,
      }),
    ).toBe("editor");
  });

  it("falls back to the composer when the thread tab is active", () => {
    expect(
      resolveTerminalCloseFocusTarget({
        activeChatTab: "thread",
        editorAvailable: true,
      }),
    ).toBe("composer");
  });

  it("falls back to the composer when the editor is unavailable", () => {
    expect(
      resolveTerminalCloseFocusTarget({
        activeChatTab: "editor",
        editorAvailable: false,
      }),
    ).toBe("composer");
  });
});
