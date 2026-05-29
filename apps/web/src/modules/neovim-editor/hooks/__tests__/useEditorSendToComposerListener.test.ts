import { describe, expect, it } from "vitest";
import { scopeThreadRef } from "@fenrir/client-runtime";
import { DraftId } from "~/composerDraftStore";
import {
  composerTargetIdFromRouteTarget,
  handleSendToComposer,
  shouldSubscribe,
} from "../useEditorSendToComposerListener";

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

    it("creates a draft when draftId is present", () => {
      const result = handleSendToComposer(validEvent, "draft-1");
      expect(result).not.toBeNull();
      expect(result!.threadId).toBe("draft-1");
      expect(result!.text).toBe("const x = 1;");
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

  describe("composerTargetIdFromRouteTarget", () => {
    it("returns server thread ids", () => {
      expect(
        composerTargetIdFromRouteTarget({
          kind: "server",
          threadRef: scopeThreadRef("env-1" as never, "thread-1" as never),
        }),
      ).toBe("thread-1");
    });

    it("returns draft ids", () => {
      expect(
        composerTargetIdFromRouteTarget({
          kind: "draft",
          draftId: DraftId.make("draft-1"),
        }),
      ).toBe("draft-1");
    });

    it("returns null without a route target", () => {
      expect(composerTargetIdFromRouteTarget(null)).toBeNull();
    });
  });
});
