import { ThreadId } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import {
  appendEditorContextsToPrompt,
  buildEditorContextBlock,
  buildEditorContextPreviewTitle,
  extractTrailingEditorContexts,
  filterEditorContextsWithText,
  formatEditorContextLabel,
  formatEditorContextRange,
  formatInlineEditorContextLabel,
  hasEditorContextText,
  isEditorContextExpired,
  normalizeEditorContextSelection,
  normalizeEditorContextText,
  type EditorContextDraft,
} from "../editorContext";

function makeDraft(overrides?: Partial<EditorContextDraft>): EditorContextDraft {
  return {
    id: "ctx-1",
    threadId: ThreadId.make("thread-1"),
    createdAt: "2026-05-07T12:00:00.000Z",
    file: "/src/components/App.tsx",
    lineStart: 10,
    lineEnd: 15,
    text: "function App() {\n  return <div />;\n}",
    ...overrides,
  };
}

describe("editorContext", () => {
  describe("normalizeEditorContextText", () => {
    it("strips leading/trailing newlines and normalizes line endings", () => {
      expect(normalizeEditorContextText("\r\n\nfoo\r\nbar\n\n")).toBe("foo\nbar");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(normalizeEditorContextText("\n\n\n")).toBe("");
    });
  });

  describe("hasEditorContextText / isEditorContextExpired", () => {
    it("returns true for non-empty text", () => {
      expect(hasEditorContextText({ text: "code" })).toBe(true);
      expect(isEditorContextExpired({ text: "code" })).toBe(false);
    });

    it("returns false for empty/whitespace text", () => {
      expect(hasEditorContextText({ text: "" })).toBe(false);
      expect(isEditorContextExpired({ text: "" })).toBe(true);
      expect(hasEditorContextText({ text: "\n\n" })).toBe(false);
    });
  });

  describe("filterEditorContextsWithText", () => {
    it("filters out contexts with empty text", () => {
      const live = makeDraft();
      const expired = makeDraft({ id: "ctx-2", text: "" });
      expect(filterEditorContextsWithText([expired, live])).toEqual([live]);
    });
  });

  describe("normalizeEditorContextSelection", () => {
    it("normalizes valid selection", () => {
      const result = normalizeEditorContextSelection({
        file: " /src/main.ts ",
        lineStart: 5.7,
        lineEnd: 3.2,
        text: "code",
      });
      expect(result).toEqual({
        file: "/src/main.ts",
        lineStart: 5,
        lineEnd: 5,
        text: "code",
      });
    });

    it("returns null for empty file", () => {
      expect(
        normalizeEditorContextSelection({ file: "  ", lineStart: 1, lineEnd: 1, text: "x" }),
      ).toBeNull();
    });

    it("returns null for empty text", () => {
      expect(
        normalizeEditorContextSelection({ file: "a.ts", lineStart: 1, lineEnd: 1, text: "\n\n" }),
      ).toBeNull();
    });
  });

  describe("formatEditorContextRange", () => {
    it("formats single line", () => {
      expect(formatEditorContextRange({ lineStart: 5, lineEnd: 5 })).toBe("line 5");
    });

    it("formats line range", () => {
      expect(formatEditorContextRange({ lineStart: 10, lineEnd: 15 })).toBe("lines 10-15");
    });
  });

  describe("formatEditorContextLabel", () => {
    it("uses basename of file path with line range", () => {
      expect(formatEditorContextLabel(makeDraft())).toBe("App.tsx lines 10-15");
    });

    it("handles single line", () => {
      expect(formatEditorContextLabel(makeDraft({ lineStart: 5, lineEnd: 5 }))).toBe(
        "App.tsx line 5",
      );
    });

    it("handles file without path separator", () => {
      expect(formatEditorContextLabel({ file: "utils.ts", lineStart: 1, lineEnd: 3 })).toBe(
        "utils.ts lines 1-3",
      );
    });
  });

  describe("formatInlineEditorContextLabel", () => {
    it("formats as @basename:range", () => {
      expect(formatInlineEditorContextLabel(makeDraft())).toBe("@app.tsx:10-15");
    });

    it("formats single line", () => {
      expect(formatInlineEditorContextLabel(makeDraft({ lineStart: 5, lineEnd: 5 }))).toBe(
        "@app.tsx:5",
      );
    });
  });

  describe("buildEditorContextBlock", () => {
    it("builds a correctly formatted block", () => {
      expect(buildEditorContextBlock(makeDraft())).toBe(
        [
          '<editor_context file="/src/components/App.tsx" lineStart="10" lineEnd="15">',
          "- App.tsx lines 10-15:",
          "  10 | function App() {",
          "  11 |   return <div />;",
          "  12 | }",
          "</editor_context>",
        ].join("\n"),
      );
    });

    it("returns empty string for invalid draft", () => {
      expect(buildEditorContextBlock(makeDraft({ text: "" }))).toBe("");
    });

    it("escapes double quotes in file path", () => {
      const block = buildEditorContextBlock(makeDraft({ file: '/path/"quoted"/file.ts' }));
      expect(block).toContain('file="/path/\\"quoted\\"/file.ts"');
    });
  });

  describe("buildEditorContextPreviewTitle", () => {
    it("builds preview title from contexts", () => {
      const title = buildEditorContextPreviewTitle([makeDraft()]);
      expect(title).toContain("App.tsx lines 10-15");
      expect(title).toContain("function App()");
    });

    it("returns null for empty contexts", () => {
      expect(buildEditorContextPreviewTitle([])).toBeNull();
    });

    it("returns null when all contexts are invalid", () => {
      expect(buildEditorContextPreviewTitle([makeDraft({ text: "" })])).toBeNull();
    });
  });

  describe("appendEditorContextsToPrompt", () => {
    it("appends editor context blocks after prompt text", () => {
      const result = appendEditorContextsToPrompt("Investigate this", [makeDraft()]);
      expect(result).toContain("Investigate this\n\n<editor_context");
      expect(result).toContain("</editor_context>");
    });

    it("returns prompt unchanged when no contexts", () => {
      expect(appendEditorContextsToPrompt("hello", [])).toBe("hello");
    });

    it("skips invalid contexts", () => {
      expect(appendEditorContextsToPrompt("hello", [makeDraft({ text: "" })])).toBe("hello");
    });
  });

  describe("extractTrailingEditorContexts", () => {
    it("round-trips through append and extract", () => {
      const prompt = appendEditorContextsToPrompt("Investigate this", [makeDraft()]);
      const extracted = extractTrailingEditorContexts(prompt);
      expect(extracted.promptText).toBe("Investigate this");
      expect(extracted.contextCount).toBe(1);
      expect(extracted.contexts[0]!.file).toBe("/src/components/App.tsx");
      expect(extracted.contexts[0]!.lineStart).toBe(10);
      expect(extracted.contexts[0]!.lineEnd).toBe(15);
      expect(extracted.contexts[0]!.body).toContain("App.tsx lines 10-15");
    });

    it("returns original text when no editor context block present", () => {
      const result = extractTrailingEditorContexts("No attached context");
      expect(result).toEqual({
        promptText: "No attached context",
        contextCount: 0,
        previewTitle: null,
        contexts: [],
      });
    });

    it("extracts multiple trailing editor context blocks", () => {
      const draft1 = makeDraft();
      const draft2 = makeDraft({
        id: "ctx-2",
        file: "/src/utils.ts",
        lineStart: 1,
        lineEnd: 3,
        text: "export const x = 1;\nexport const y = 2;\nexport const z = 3;",
      });
      const prompt = appendEditorContextsToPrompt("Check these files", [draft1, draft2]);
      const extracted = extractTrailingEditorContexts(prompt);
      expect(extracted.promptText).toBe("Check these files");
      expect(extracted.contextCount).toBe(2);
      expect(extracted.contexts[0]!.file).toBe("/src/components/App.tsx");
      expect(extracted.contexts[1]!.file).toBe("/src/utils.ts");
    });

    it("handles file paths with escaped quotes", () => {
      const draft = makeDraft({ file: '/path/"quoted"/file.ts' });
      const prompt = appendEditorContextsToPrompt("Check", [draft]);
      const extracted = extractTrailingEditorContexts(prompt);
      expect(extracted.contexts[0]!.file).toBe('/path/"quoted"/file.ts');
    });
  });
});
