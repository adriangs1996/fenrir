import { describe, expect, it } from "vitest";
import { handleSendToComposer, shouldSubscribe } from "../useEditorSendToComposerListener";

describe("useEditorSendToComposerListener", () => {
  describe("shouldSubscribe", () => {
    it("returns true when both bridge and main window", () => {
      expect(shouldSubscribe(true, true)).toBe(true);
    });

    it("returns false when bridge unavailable", () => {
      expect(shouldSubscribe(false, true)).toBe(false);
    });

    it("returns false when not main window", () => {
      expect(shouldSubscribe(true, false)).toBe(false);
    });
  });

  describe("handleSendToComposer", () => {
    const validEvent = {
      file: "/src/main.ts",
      lineStart: 10,
      lineEnd: 15,
      text: "const x = 1;",
    };

    it("creates a draft when threadId is present", () => {
      const result = handleSendToComposer(validEvent, "thread-1");
      expect(result).not.toBeNull();
      expect(result!.file).toBe("/src/main.ts");
      expect(result!.lineStart).toBe(10);
      expect(result!.lineEnd).toBe(15);
      expect(result!.text).toBe("const x = 1;");
      expect(result!.id).toBeTruthy();
      expect(result!.createdAt).toBeTruthy();
    });

    it("returns null when threadId is null", () => {
      expect(handleSendToComposer(validEvent, null)).toBeNull();
    });

    it("returns null when text is empty", () => {
      expect(handleSendToComposer({ ...validEvent, text: "" }, "thread-1")).toBeNull();
    });

    it("returns null when text is whitespace only", () => {
      expect(handleSendToComposer({ ...validEvent, text: "   " }, "thread-1")).toBeNull();
    });

    it("returns null when file is empty", () => {
      expect(handleSendToComposer({ ...validEvent, file: "" }, "thread-1")).toBeNull();
    });
  });
});
