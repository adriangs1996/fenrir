import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@fenrir/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  resolveCursorInstanceSettings,
  resolveEffectiveClaudeSettings,
  resolveEffectiveCodexSettings,
} from "./providerSettings";

describe("providerSettings", () => {
  it("merges default codex instance config overrides into effective settings", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: {
            binaryPath: "/tmp/codex-custom",
            homePath: "~/.codex-custom",
          },
        },
      },
    };

    const resolved = Effect.runSync(resolveEffectiveCodexSettings(settings));
    expect(resolved.binaryPath).toBe("/tmp/codex-custom");
    expect(resolved.homePath).toBe("~/.codex-custom");
  });

  it("merges default claude instance enabled overrides into effective settings", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("claudeAgent")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: false,
          config: {
            binaryPath: "/tmp/claude-custom",
          },
        },
      },
    };

    const resolved = Effect.runSync(resolveEffectiveClaudeSettings(settings));
    expect(resolved.enabled).toBe(false);
    expect(resolved.binaryPath).toBe("/tmp/claude-custom");
  });

  it("ignores invalid default instance config overrides and falls back to base settings", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          binaryPath: "/tmp/codex-base",
        },
      },
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: {
            customModels: "not-an-array",
          },
        },
      },
    };

    const resolved = Effect.runSync(resolveEffectiveCodexSettings(settings));
    expect(resolved.binaryPath).toBe("/tmp/codex-base");
    expect(resolved.customModels).toEqual([]);
  });

  it("resolves non-default built-in instance overrides when instance id is provided", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_work")]: {
          driver: ProviderDriverKind.make("codex"),
          config: {
            binaryPath: "/tmp/codex-work",
          },
        },
      },
    };

    const resolved = Effect.runSync(
      resolveEffectiveCodexSettings(settings, ProviderInstanceId.make("codex_work")),
    );
    expect(resolved.binaryPath).toBe("/tmp/codex-work");
  });

  it("resolves cursor instance overrides", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("cursor_work")]: {
          driver: ProviderDriverKind.make("cursor"),
          enabled: true,
          config: {
            binaryPath: "/tmp/cursor-agent",
            apiEndpoint: "https://cursor.internal",
            customModels: ["gpt-5"],
          },
        },
      },
    };

    const resolved = Effect.runSync(
      resolveCursorInstanceSettings(settings, ProviderInstanceId.make("cursor_work")),
    );
    expect(resolved.enabled).toBe(true);
    expect(resolved.binaryPath).toBe("/tmp/cursor-agent");
    expect(resolved.apiEndpoint).toBe("https://cursor.internal");
    expect(resolved.customModels).toEqual(["gpt-5"]);
  });
});
