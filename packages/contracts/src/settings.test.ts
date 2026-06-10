import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  ClientSettingsSchema,
  CursorSettings,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  OpenCodeSettings,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings";
import { ProviderInstanceId } from "./providerInstance";

const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const decodeServerSettings = Schema.decodeSync(ServerSettings);
const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);
const decodeServerSettingsPatch = Schema.decodeSync(ServerSettingsPatch);

describe("ClientSettings font defaults", () => {
  it("defaults favorites to an empty array", () => {
    expect(DEFAULT_CLIENT_SETTINGS.favorites).toEqual([]);
  });

  it("defaults embeddedEditor to neovim", () => {
    expect(DEFAULT_CLIENT_SETTINGS.embeddedEditor).toBe("neovim");
  });

  it("decodes embeddedEditor when provided", () => {
    const result = decodeClientSettings({ embeddedEditor: "vscode" });
    expect(result.embeddedEditor).toBe("vscode");
  });

  it("has correct default uiFontFamily", () => {
    expect(DEFAULT_CLIENT_SETTINGS.uiFontFamily).toBe("Geist Mono");
  });

  it("has correct default uiFontSize", () => {
    expect(DEFAULT_CLIENT_SETTINGS.uiFontSize).toBe(14);
  });

  it("has correct default terminalFontFamily", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalFontFamily).toBe("GeistMono Nerd Font");
  });

  it("has correct default terminalFontSize", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalFontSize).toBe(12);
  });

  it("has correct default terminalLineHeight", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalLineHeight).toBe(1.2);
  });
});

describe("ClientSettings font-size clamping", () => {
  it("clamps uiFontSize below minimum to 10", () => {
    const result = decodeClientSettings({ uiFontSize: 5 });
    expect(result.uiFontSize).toBe(10);
  });

  it("clamps uiFontSize above maximum to 24", () => {
    const result = decodeClientSettings({ uiFontSize: 50 });
    expect(result.uiFontSize).toBe(24);
  });

  it("clamps terminalFontSize below minimum to 8", () => {
    const result = decodeClientSettings({ terminalFontSize: 3 });
    expect(result.terminalFontSize).toBe(8);
  });

  it("clamps terminalFontSize above maximum to 24", () => {
    const result = decodeClientSettings({ terminalFontSize: 99 });
    expect(result.terminalFontSize).toBe(24);
  });

  it("clamps terminalLineHeight below minimum to 1.0", () => {
    const result = decodeClientSettings({ terminalLineHeight: 0.5 });
    expect(result.terminalLineHeight).toBe(1.0);
  });

  it("clamps terminalLineHeight above maximum to 2.0", () => {
    const result = decodeClientSettings({ terminalLineHeight: 3.0 });
    expect(result.terminalLineHeight).toBe(2.0);
  });

  it("passes through valid font sizes and line height unchanged", () => {
    const result = decodeClientSettings({
      uiFontSize: 16,
      terminalFontSize: 14,
      terminalLineHeight: 1.5,
    });
    expect(result.uiFontSize).toBe(16);
    expect(result.terminalFontSize).toBe(14);
    expect(result.terminalLineHeight).toBe(1.5);
  });
});

describe("ServerSettings.providerInstances", () => {
  it("defaults providerInstances to an empty map", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes multi-instance provider maps and preserves unknown drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex Personal",
          config: { homePath: "~/.codex-personal" },
        },
        cursor_local: {
          driver: "cursor",
          displayName: "Cursor Local",
          config: { workspace: "/tmp/cursor" },
        },
      },
    });

    expect(decoded.providerInstances[ProviderInstanceId.make("codex_personal")]).toEqual({
      driver: "codex",
      displayName: "Codex Personal",
      config: { homePath: "~/.codex-personal" },
    });
    expect(decoded.providerInstances[ProviderInstanceId.make("cursor_local")]).toEqual({
      driver: "cursor",
      displayName: "Cursor Local",
      config: { workspace: "/tmp/cursor" },
    });
  });
});

describe("additional provider settings schemas", () => {
  it("decodes CursorSettings defaults", () => {
    const decoded = decodeCursorSettings({});
    expect(decoded).toEqual({
      enabled: false,
      binaryPath: "agent",
      apiEndpoint: "",
      customModels: [],
    });
  });

  it("decodes OpenCodeSettings defaults", () => {
    const decoded = decodeOpenCodeSettings({});
    expect(decoded).toEqual({
      enabled: true,
      binaryPath: "opencode",
      serverUrl: "",
      serverPassword: "",
      customModels: [],
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_work: { driver: "codex", config: { homePath: "~/.codex-work" } },
      },
    });

    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_work")]).toEqual({
      driver: "codex",
      config: { homePath: "~/.codex-work" },
    });
  });
});
