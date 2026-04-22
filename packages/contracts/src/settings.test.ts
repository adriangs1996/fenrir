import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "./settings";

describe("ClientSettings font defaults", () => {
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
});

describe("ClientSettings font-size clamping", () => {
  it("clamps uiFontSize below minimum to 10", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ uiFontSize: 5 });
    expect(result.uiFontSize).toBe(10);
  });

  it("clamps uiFontSize above maximum to 24", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ uiFontSize: 50 });
    expect(result.uiFontSize).toBe(24);
  });

  it("clamps terminalFontSize below minimum to 8", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ terminalFontSize: 3 });
    expect(result.terminalFontSize).toBe(8);
  });

  it("clamps terminalFontSize above maximum to 24", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({ terminalFontSize: 99 });
    expect(result.terminalFontSize).toBe(24);
  });

  it("passes through valid font sizes unchanged", () => {
    const result = Schema.decodeSync(ClientSettingsSchema)({
      uiFontSize: 16,
      terminalFontSize: 14,
    });
    expect(result.uiFontSize).toBe(16);
    expect(result.terminalFontSize).toBe(14);
  });
});
