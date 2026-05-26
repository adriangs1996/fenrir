import { describe, expect, it } from "vitest";

import {
  deriveProviderSettingsFields,
  getProviderDriverDefinition,
  getProviderDriverLabel,
  PROVIDER_DRIVER_DEFINITIONS,
} from "./providerDriverMeta";

describe("providerDriverMeta", () => {
  it("derives provider settings fields from schema annotations", () => {
    expect(getProviderDriverDefinition("codex")?.settingsFields).toEqual([
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the Codex binary used by this instance.",
        placeholder: "codex",
      },
      {
        key: "homePath",
        label: "CODEX_HOME path",
        description: "Optional custom Codex home and config directory.",
        placeholder: "CODEX_HOME",
      },
    ]);

    expect(getProviderDriverDefinition("opencode")?.settingsFields).toEqual([
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the OpenCode binary.",
        placeholder: "opencode",
      },
      {
        key: "serverUrl",
        label: "Server URL",
        description: "Leave blank to let Fenrir spawn the server when needed.",
        placeholder: "http://127.0.0.1:4096",
      },
      {
        key: "serverPassword",
        label: "Server password",
        description: "Stored in plain text on disk.",
        placeholder: "Optional",
        control: "password",
      },
    ]);
  });

  it("keeps hidden settings out of the UI field list", () => {
    for (const definition of PROVIDER_DRIVER_DEFINITIONS) {
      const fields = deriveProviderSettingsFields(definition.settingsSchema);
      expect(fields.some((field) => field.key === "enabled")).toBe(false);
      expect(fields.some((field) => field.key === "customModels")).toBe(false);
    }
  });

  it("falls back to raw driver labels for unknown provider drivers", () => {
    expect(getProviderDriverDefinition("forked-provider")).toBeUndefined();
    expect(getProviderDriverLabel("forked-provider")).toBe("forked-provider");
  });
});
