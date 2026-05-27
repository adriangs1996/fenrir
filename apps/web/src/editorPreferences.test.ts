import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openInEmbeddedEditor,
  openInEmbeddedVSCode,
  openInPreferredEditor,
  parseTargetPath,
} from "./editorPreferences";
import { __resetLocalApiForTests } from "./localApi";
import { useEditorStore } from "~/modules/neovim-editor";

function createLocalStorageStub(storedLastEditor: string | null = null) {
  return {
    getItem: vi.fn((key: string) =>
      key === "fenrir:last-editor" && storedLastEditor ? JSON.stringify(storedLastEditor) : null,
    ),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}

function createClientSettingsBridge() {
  return {
    getClientSettings: vi.fn(async () => null),
    setClientSettings: vi.fn(async () => undefined),
  };
}

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

  afterEach(async () => {
    openFileMock.mockClear();
    vi.unstubAllGlobals();
    useEditorStore.getState().setActiveChatTab("thread");
    await __resetLocalApiForTests();
  });

  function stubBridge() {
    const clientSettingsBridge = createClientSettingsBridge();
    vi.stubGlobal("window", {
      desktopBridge: { ...clientSettingsBridge, editor: { openFile: openFileMock } },
      nativeApi: { persistence: clientSettingsBridge },
      localStorage: createLocalStorageStub(),
    });
    return clientSettingsBridge;
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

  it("persists embedded editor preference to neovim", async () => {
    const bridge = stubBridge();

    await openInEmbeddedEditor("/src/index.ts");

    expect(bridge.setClientSettings).toHaveBeenCalledWith(
      expect.objectContaining({ embeddedEditor: "neovim" }),
    );
  });

  it("throws when desktop bridge unavailable", async () => {
    vi.stubGlobal("window", {});

    await expect(openInEmbeddedEditor("/src/index.ts")).rejects.toThrow(
      "desktop bridge unavailable",
    );
  });
});

describe("openInEmbeddedVSCode", () => {
  const vscodeOpenFileMock = vi.fn(async () => ({
    cwd: "/src",
    url: "http://127.0.0.1:49152",
    serverKind: "code-server" as const,
    command: "code-server",
  }));

  afterEach(async () => {
    vscodeOpenFileMock.mockClear();
    vi.unstubAllGlobals();
    useEditorStore.getState().setActiveChatTab("thread");
    await __resetLocalApiForTests();
  });

  it("opens target through embedded VS Code bridge", async () => {
    const clientSettingsBridge = createClientSettingsBridge();
    vi.stubGlobal("window", {
      desktopBridge: { ...clientSettingsBridge, vscodeOpenFile: vscodeOpenFileMock },
      nativeApi: { persistence: clientSettingsBridge },
      localStorage: createLocalStorageStub(),
    });

    await openInEmbeddedVSCode("/src/index.ts:10:5");

    expect(vscodeOpenFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
      line: 10,
      col: 5,
    });
    expect(clientSettingsBridge.setClientSettings).toHaveBeenCalledWith(
      expect.objectContaining({ embeddedEditor: "vscode" }),
    );
    expect(useEditorStore.getState().activeChatTab).toBe("editor");
  });

  it("throws when embedded VS Code bridge unavailable", async () => {
    vi.stubGlobal("window", {});

    await expect(openInEmbeddedVSCode("/src/index.ts")).rejects.toThrow(
      "embedded VS Code bridge unavailable",
    );
  });
});

describe("openInPreferredEditor", () => {
  const openFileMock = vi.fn(async () => undefined);
  const shellOpenInEditorMock = vi.fn(async () => undefined);

  afterEach(async () => {
    openFileMock.mockClear();
    shellOpenInEditorMock.mockClear();
    vi.unstubAllGlobals();
    useEditorStore.getState().setActiveChatTab("thread");
    await __resetLocalApiForTests();
  });

  it("routes embedded-editor preference through the editor tab switch", async () => {
    const clientSettingsBridge = createClientSettingsBridge();
    vi.stubGlobal("window", {
      desktopBridge: { ...clientSettingsBridge, editor: { openFile: openFileMock } },
      nativeApi: { persistence: clientSettingsBridge },
      localStorage: createLocalStorageStub("fenrir-embedded"),
    });

    const api = {
      server: { getConfig: vi.fn(async () => ({ availableEditors: ["fenrir-embedded"] })) },
      shell: { openInEditor: shellOpenInEditorMock },
    } as const;

    expect(useEditorStore.getState().activeChatTab).toBe("thread");
    await expect(openInPreferredEditor(api as never, "/src/index.ts:12")).resolves.toBe(
      "fenrir-embedded",
    );

    expect(openFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
      line: 12,
    });
    expect(shellOpenInEditorMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeChatTab).toBe("editor");
  });

  it("falls back to a non-embedded editor when embedded launches are disabled", async () => {
    const clientSettingsBridge = createClientSettingsBridge();
    vi.stubGlobal("window", {
      desktopBridge: { ...clientSettingsBridge, editor: { openFile: openFileMock } },
      nativeApi: { persistence: clientSettingsBridge },
      localStorage: createLocalStorageStub("fenrir-embedded"),
    });

    const api = {
      server: {
        getConfig: vi.fn(async () => ({
          availableEditors: ["fenrir-embedded", "vscode"],
        })),
      },
      shell: { openInEditor: shellOpenInEditorMock },
    } as const;

    await expect(
      openInPreferredEditor(api as never, "/src/index.ts:12", { allowEmbedded: false }),
    ).resolves.toBe("vscode");

    expect(openFileMock).not.toHaveBeenCalled();
    expect(shellOpenInEditorMock).toHaveBeenCalledWith("/src/index.ts:12", "vscode");
  });

  it("routes embedded VS Code preference through the editor tab switch", async () => {
    const vscodeOpenFileMock = vi.fn(async () => ({
      cwd: "/src",
      url: "http://127.0.0.1:49152",
      serverKind: "code-server" as const,
      command: "code-server",
    }));
    const clientSettingsBridge = createClientSettingsBridge();
    vi.stubGlobal("window", {
      desktopBridge: { ...clientSettingsBridge, vscodeOpenFile: vscodeOpenFileMock },
      nativeApi: { persistence: clientSettingsBridge },
      localStorage: createLocalStorageStub(),
    });

    const api = {
      server: {
        getConfig: vi.fn(async () => ({
          availableEditors: ["fenrir-embedded-vscode"],
        })),
      },
      shell: { openInEditor: shellOpenInEditorMock },
    } as const;

    await expect(openInPreferredEditor(api as never, "/src/index.ts:12")).resolves.toBe(
      "fenrir-embedded-vscode",
    );

    expect(vscodeOpenFileMock).toHaveBeenCalledWith({
      path: "/src/index.ts",
      line: 12,
    });
    expect(shellOpenInEditorMock).not.toHaveBeenCalled();
    expect(clientSettingsBridge.setClientSettings).toHaveBeenCalledWith(
      expect.objectContaining({ embeddedEditor: "vscode" }),
    );
    expect(useEditorStore.getState().activeChatTab).toBe("editor");
  });
});
