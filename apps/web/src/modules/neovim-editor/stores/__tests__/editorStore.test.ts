import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    const store = useEditorStore.getState();
    store.setActiveChatTab("thread");
    store.resetVolatile();
  });

  describe("activeChatTab", () => {
    it("defaults to thread", () => {
      expect(useEditorStore.getState().activeChatTab).toBe("thread");
    });

    it("sets active tab", () => {
      useEditorStore.getState().setActiveChatTab("editor");
      expect(useEditorStore.getState().activeChatTab).toBe("editor");
    });
  });

  describe("toggleChatTab", () => {
    it("flips from thread to editor", () => {
      useEditorStore.getState().toggleChatTab();
      expect(useEditorStore.getState().activeChatTab).toBe("editor");
    });

    it("flips from editor to thread", () => {
      useEditorStore.getState().setActiveChatTab("editor");
      useEditorStore.getState().toggleChatTab();
      expect(useEditorStore.getState().activeChatTab).toBe("thread");
    });

    it("round-trips back to original", () => {
      useEditorStore.getState().toggleChatTab();
      useEditorStore.getState().toggleChatTab();
      expect(useEditorStore.getState().activeChatTab).toBe("thread");
    });
  });

  describe("currentFile", () => {
    it("defaults to null", () => {
      expect(useEditorStore.getState().currentFile).toBeNull();
    });

    it("sets current file", () => {
      useEditorStore.getState().setCurrentFile("/src/main.rs");
      expect(useEditorStore.getState().currentFile).toBe("/src/main.rs");
    });

    it("clears current file", () => {
      useEditorStore.getState().setCurrentFile("/src/main.rs");
      useEditorStore.getState().setCurrentFile(null);
      expect(useEditorStore.getState().currentFile).toBeNull();
    });
  });

  describe("dirtyFiles", () => {
    it("defaults to empty set", () => {
      expect(useEditorStore.getState().dirtyFiles.size).toBe(0);
    });

    it("adds file when marked dirty", () => {
      useEditorStore.getState().setDirty("/src/main.rs", true);
      expect(useEditorStore.getState().dirtyFiles.has("/src/main.rs")).toBe(true);
      expect(useEditorStore.getState().dirtyFiles.size).toBe(1);
    });

    it("removes file when marked clean", () => {
      useEditorStore.getState().setDirty("/src/main.rs", true);
      useEditorStore.getState().setDirty("/src/main.rs", false);
      expect(useEditorStore.getState().dirtyFiles.has("/src/main.rs")).toBe(false);
      expect(useEditorStore.getState().dirtyFiles.size).toBe(0);
    });

    it("tracks multiple dirty files", () => {
      const store = useEditorStore.getState();
      store.setDirty("/a.ts", true);
      store.setDirty("/b.ts", true);
      const state = useEditorStore.getState();
      expect(state.dirtyFiles.has("/a.ts")).toBe(true);
      expect(state.dirtyFiles.has("/b.ts")).toBe(true);
      expect(state.dirtyFiles.size).toBe(2);
    });

    it("no-ops when removing file not in set", () => {
      useEditorStore.getState().setDirty("/nope.ts", false);
      expect(useEditorStore.getState().dirtyFiles.size).toBe(0);
    });
  });

  describe("pendingContexts", () => {
    it("defaults to empty array", () => {
      expect(useEditorStore.getState().pendingContexts).toEqual([]);
    });

    it("adds a pending context", () => {
      const draft = {
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/main.ts",
        lineStart: 10,
        lineEnd: 15,
        text: "const x = 1;",
      };
      useEditorStore.getState().addPendingContext(draft);
      expect(useEditorStore.getState().pendingContexts).toEqual([draft]);
    });

    it("removes a pending context by id", () => {
      const draft1 = {
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/a.ts",
        lineStart: 1,
        lineEnd: 5,
        text: "line a",
      };
      const draft2 = {
        id: "ctx-2",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:01.000Z",
        file: "/src/b.ts",
        lineStart: 10,
        lineEnd: 12,
        text: "line b",
      };
      useEditorStore.getState().addPendingContext(draft1);
      useEditorStore.getState().addPendingContext(draft2);
      useEditorStore.getState().removePendingContext("ctx-1");
      expect(useEditorStore.getState().pendingContexts).toEqual([draft2]);
    });

    it("clears all pending contexts", () => {
      useEditorStore.getState().addPendingContext({
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/a.ts",
        lineStart: 1,
        lineEnd: 5,
        text: "code",
      });
      useEditorStore.getState().clearPendingContexts();
      expect(useEditorStore.getState().pendingContexts).toEqual([]);
    });

    it("no-ops when removing non-existent id", () => {
      const draft = {
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/main.ts",
        lineStart: 1,
        lineEnd: 1,
        text: "x",
      };
      useEditorStore.getState().addPendingContext(draft);
      useEditorStore.getState().removePendingContext("non-existent");
      expect(useEditorStore.getState().pendingContexts).toEqual([draft]);
    });
  });

  describe("resetVolatile", () => {
    it("clears currentFile, dirtyFiles, and pendingContexts", () => {
      const store = useEditorStore.getState();
      store.setCurrentFile("/src/main.rs");
      store.setDirty("/src/main.rs", true);
      store.setDirty("/src/lib.rs", true);
      store.addPendingContext({
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/main.rs",
        lineStart: 1,
        lineEnd: 1,
        text: "x",
      });

      store.resetVolatile();

      const state = useEditorStore.getState();
      expect(state.currentFile).toBeNull();
      expect(state.dirtyFiles.size).toBe(0);
      expect(state.pendingContexts).toEqual([]);
    });

    it("preserves activeChatTab", () => {
      const store = useEditorStore.getState();
      store.setActiveChatTab("editor");
      store.setCurrentFile("/src/main.rs");
      store.setDirty("/src/main.rs", true);

      store.resetVolatile();

      expect(useEditorStore.getState().activeChatTab).toBe("editor");
    });
  });

  describe("persistence partialize", () => {
    it("only includes activeChatTab in persisted state", () => {
      const store = useEditorStore.getState();
      store.setActiveChatTab("editor");
      store.setCurrentFile("/src/main.rs");
      store.setDirty("/src/main.rs", true);
      store.addPendingContext({
        id: "ctx-1",
        threadId: "thread-1" as never,
        createdAt: "2026-05-07T00:00:00.000Z",
        file: "/src/main.rs",
        lineStart: 1,
        lineEnd: 1,
        text: "x",
      });

      // Access the persist API to verify partialize output
      const persistOptions = useEditorStore.persist.getOptions();
      const partialized = persistOptions.partialize?.(useEditorStore.getState());

      expect(partialized).toEqual({ activeChatTab: "editor" });
      expect(partialized).not.toHaveProperty("currentFile");
      expect(partialized).not.toHaveProperty("dirtyFiles");
      expect(partialized).not.toHaveProperty("pendingContexts");
    });
  });
});
