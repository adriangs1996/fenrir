import { describe, expect, it } from "vitest";

import {
  buildKeybindingCommandOptions,
  buildKeybindingRows,
  commandLabel,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  unknownWhenVariables,
} from "./KeybindingsSettings.logic";

describe("KeybindingsSettings.logic", () => {
  it("labels project and global script commands", () => {
    expect(commandLabel("script.deploy.run")).toBe("Run Script: Deploy");
    expect(commandLabel("global-script.fix.run")).toBe("Run Global Script: Fix");
  });

  it("uses user-facing labels for editor and git diff toggles", () => {
    expect(commandLabel("editor.toggleChatTab")).toBe("Editor: Toggle");
    expect(commandLabel("editor.runPrompt")).toBe("Editor: Run Prompt");
    expect(commandLabel("gitDiff.toggle")).toBe("Git Diff: Toggle");
    expect(commandLabel("settings.toggle")).toBe("Settings: Toggle");
    expect(commandLabel("thread.open")).toBe("Thread: Open");
  });

  it("marks default rows as default and custom rows as custom", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "commandPalette.toggle",
          shortcut: {
            key: "k",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
        {
          command: "chat.new",
          shortcut: {
            key: "p",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
        },
      ],
      "",
    );

    expect(rows.find((row) => row.command === "commandPalette.toggle")?.source).toBe("Default");
    expect(rows.find((row) => row.command === "chat.new" && row.key === "mod+p")?.source).toBe(
      "Custom",
    );
  });

  it("includes supported static commands even when they are unbound", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "commandPalette.toggle",
          shortcut: {
            key: "k",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
        },
      ],
      "",
    );

    const gitDiffRow = rows.find((row) => row.command === "gitDiff.toggle");
    expect(gitDiffRow?.source).toBe("Unbound");
    expect(gitDiffRow?.key).toBe("");
    expect(gitDiffRow?.defaultKey).toBe("mod+g");

    const threadOpenRow = rows.find((row) => row.command === "thread.open");
    expect(threadOpenRow?.source).toBe("Unbound");
    expect(threadOpenRow?.key).toBe("");
    expect(threadOpenRow?.defaultKey).toBe("meta+s");
  });

  it("offers supported static commands when adding a binding", () => {
    expect(buildKeybindingCommandOptions([])).toContain("editor.toggleChatTab");
    expect(buildKeybindingCommandOptions([])).toContain("editor.runPrompt");
    expect(buildKeybindingCommandOptions([])).toContain("gitDiff.toggle");
    expect(buildKeybindingCommandOptions([])).toContain("settings.toggle");
    expect(buildKeybindingCommandOptions([])).toContain("thread.open");
  });

  it("parses when expressions and reports unknown variables", () => {
    const parsed = parseWhenExpressionDraft("terminalFocus && featureFlag");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected when expression to parse");
    }
    expect(unknownWhenVariables(parsed.value)).toEqual(["featureFlag"]);
  });

  it("captures platform-specific shortcuts from keyboard events", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("mod+shift+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Linux x86_64",
      ),
    ).toBe("mod+k");
  });

  it("normalizes parsed shortcuts back into persisted input form", () => {
    const shortcut = {
      key: " ",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      modKey: true,
    };
    expect(shortcutToKeybindingInput(shortcut)).toBe("mod+alt+space");
  });
});
