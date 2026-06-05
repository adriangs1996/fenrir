import { describe, expect, it, vi } from "vitest";

const { mockWebContentsView } = vi.hoisted(() => ({
  mockWebContentsView: vi.fn(function () {
    return {
      webContents: {
        close: vi.fn(),
        copy: vi.fn(),
        focus: vi.fn(),
        getTitle: vi.fn(() => "VS Code"),
        loadURL: vi.fn(),
        on: vi.fn(),
      },
      setBounds: vi.fn(),
    };
  }),
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: vi.fn(() => ""),
    writeText: vi.fn(),
  },
  WebContentsView: mockWebContentsView,
}));

import {
  buildVSCodeWebLaunch,
  createVSCodeServerEnv,
  extractVSCodeServerUrl,
  isPortBindInUseError,
  isVSCodeServerReadyOutput,
  resolveVSCodeFenrirShortcutCommand,
  resolveVSCodeWorkspacePath,
} from "./VSCodeWebManager";

describe("buildVSCodeWebLaunch", () => {
  it("builds code-server launch args with loopback auth disabled", () => {
    expect(
      buildVSCodeWebLaunch({
        command: "code-server",
        serverKind: "code-server",
        cwd: "/repo/project",
        host: "127.0.0.1",
        port: 49152,
      }),
    ).toEqual({
      args: [
        "--bind-addr",
        "127.0.0.1:0",
        "--auth",
        "none",
        "--disable-telemetry",
        "/repo/project",
      ],
      url: "http://127.0.0.1:49152/?folder=%2Frepo%2Fproject",
    });
  });

  it("builds openvscode-server launch args without a connection token", () => {
    expect(
      buildVSCodeWebLaunch({
        command: "openvscode-server",
        serverKind: "openvscode-server",
        cwd: "/repo/project",
        host: "127.0.0.1",
        port: 49153,
      }),
    ).toEqual({
      args: [
        "--host",
        "127.0.0.1",
        "--port",
        "49153",
        "--without-connection-token",
        "--accept-server-license-terms",
        "--telemetry-level",
        "off",
        "/repo/project",
      ],
      url: "http://127.0.0.1:49153",
    });
  });
});

describe("resolveVSCodeWorkspacePath", () => {
  it("uses the parent directory for file-like missing paths", () => {
    expect(resolveVSCodeWorkspacePath("/repo/project/src/main.ts")).toBe("/repo/project/src");
  });

  it("keeps folder-like missing paths as the workspace", () => {
    expect(resolveVSCodeWorkspacePath("/repo/project")).toBe("/repo/project");
  });
});

describe("isVSCodeServerReadyOutput", () => {
  it("detects code-server readiness logs", () => {
    expect(isVSCodeServerReadyOutput("HTTP server listening on http://127.0.0.1:59526/")).toBe(
      true,
    );
  });

  it("detects openvscode-server readiness logs", () => {
    expect(isVSCodeServerReadyOutput("Web UI available at http://127.0.0.1:3000")).toBe(true);
  });

  it("ignores unrelated output", () => {
    expect(isVSCodeServerReadyOutput("Extension host agent started.")).toBe(false);
  });
});

describe("isPortBindInUseError", () => {
  it("detects EADDRINUSE errors", () => {
    expect(isPortBindInUseError("listen EADDRINUSE: address already in use 127.0.0.1:5734")).toBe(
      true,
    );
  });

  it("ignores unrelated startup failures", () => {
    expect(isPortBindInUseError("spawn code-server ENOENT")).toBe(false);
  });
});

describe("extractVSCodeServerUrl", () => {
  it("extracts the bound code-server URL from startup logs", () => {
    expect(extractVSCodeServerUrl("HTTP server listening on http://127.0.0.1:61883/")).toBe(
      "http://127.0.0.1:61883/",
    );
  });

  it("returns null when no loopback URL is present", () => {
    expect(extractVSCodeServerUrl("Extension host agent started.")).toBeNull();
  });
});

describe("createVSCodeServerEnv", () => {
  it("removes desktop dev port variables that interfere with code-server binding", () => {
    expect(
      createVSCodeServerEnv({
        PATH: "/opt/homebrew/bin:/usr/bin",
        PORT: "5734",
        HOST: "127.0.0.1",
        FENRIR_PORT: "3774",
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5734",
        VITE_HTTP_URL: "http://127.0.0.1:3774",
        VITE_WS_URL: "ws://127.0.0.1:3774",
      }),
    ).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin",
    });
  });
});

describe("resolveVSCodeFenrirShortcutCommand", () => {
  const keybindings = [
    {
      command: "terminal.toggle",
      shortcut: {
        key: "j",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    },
    {
      command: "chat.new",
      shortcut: {
        key: "n",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    },
    {
      command: "gitDiff.toggle",
      shortcut: {
        key: "g",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    },
  ] as const;

  it("captures Fenrir editor-owned shortcuts inside VS Code", () => {
    expect(
      resolveVSCodeFenrirShortcutCommand(
        {
          key: "j",
          code: "KeyJ",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        {
          keybindings,
          platform: "MacIntel",
          context: { terminalFocus: false, terminalOpen: false },
        },
      ),
    ).toBe("terminal.toggle");

    expect(
      resolveVSCodeFenrirShortcutCommand(
        {
          key: "g",
          code: "KeyG",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        {
          keybindings,
          platform: "MacIntel",
          context: { terminalFocus: false, terminalOpen: false },
        },
      ),
    ).toBe("gitDiff.toggle");
  });

  it("leaves non-editor-owned app shortcuts to VS Code", () => {
    expect(
      resolveVSCodeFenrirShortcutCommand(
        {
          key: "n",
          code: "KeyN",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        {
          keybindings,
          platform: "MacIntel",
          context: { terminalFocus: false, terminalOpen: false },
        },
      ),
    ).toBeNull();
  });
});
