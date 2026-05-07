import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTargetPath, openInEmbeddedEditor } from "./editorPreferences";
import { useEditorStore } from "~/modules/neovim-editor";

describe("parseTargetPath", () => {
  it("parses plain path", () => {
    expect(parseTargetPath("/foo/bar.ts")).toEqual({
      path: "/foo/bar.ts",
      line: null,
      col: null,
    });
  });

  it("parses path with line", () => {
    expect(parseTargetPath("/foo/bar.ts:10")).toEqual({
      path: "/foo/bar.ts",
      line: 10,
      col: null,
    });
  });

  it("parses path with line and col", () => {
    expect(parseTargetPath("/foo/bar.ts:10:5")).toEqual({
      path: "/foo/bar.ts",
      line: 10,
      col: 5,
    });
  });

  it("handles empty string", () => {
    expect(parseTargetPath("")).toEqual({
      path: "",
      line: null,
      col: null,
    });
  });

  it("handles relative path", () => {
    expect(parseTargetPath("src/main.rs:42:1")).toEqual({
      path: "src/main.rs",
      line: 42,
      col: 1,
    });
  });
});

describe("openInEmbeddedEditor", () => {
  const openFileMock = vi.fn(async () => undefined);

  afterEach(() => {
    openFileMock.mockClear();
    vi.unstubAllGlobals();
    useEditorStore.getState().setActiveChatTab("thread");
  });

  function stubBridge() {
    vi.stubGlobal("window", {
      desktopBridge: { editor: { openFile: openFileMock } },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  }

  it("calls bridge.editor.openFile with parsed path/line/col", async () => {
    stubBridge();
    await openInEmbeddedEditor("/src/index.ts:10:5");

    expect(openFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
      line: 10,
      col: 5,
    });
  });

  it("calls bridge.editor.openFile with path only", async () => {
    stubBridge();
    await openInEmbeddedEditor("/src/index.ts");

    expect(openFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
    });
  });

  it("calls bridge.editor.openFile with path and line", async () => {
    stubBridge();
    await openInEmbeddedEditor("/src/index.ts:42");

    expect(openFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
      line: 42,
    });
  });

  it("switches active chat tab to editor", async () => {
    stubBridge();
    expect(useEditorStore.getState().activeChatTab).toBe("thread");

    await openInEmbeddedEditor("/src/index.ts");

    expect(useEditorStore.getState().activeChatTab).toBe("editor");
  });

  it("throws when desktop bridge unavailable", async () => {
    vi.stubGlobal("window", {});

    await expect(openInEmbeddedEditor("/src/index.ts")).rejects.toThrow(
      "desktop bridge unavailable",
    );
  });
});
