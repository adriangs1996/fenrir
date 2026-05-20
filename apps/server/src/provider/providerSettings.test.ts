import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@fenrir/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { resolveEffectiveClaudeSettings, resolveEffectiveCodexSettings } from "./providerSettings";

describe("providerSettings", () => {
  it("merges default codex instance config overrides into effective settings", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.makeUnsafe("codex")]: {
          driver: ProviderDriverKind.makeUnsafe("codex"),
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
        [ProviderInstanceId.makeUnsafe("claudeAgent")]: {
          driver: ProviderDriverKind.makeUnsafe("claudeAgent"),
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
        [ProviderInstanceId.makeUnsafe("codex")]: {
          driver: ProviderDriverKind.makeUnsafe("codex"),
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
        [ProviderInstanceId.makeUnsafe("codex_work")]: {
          driver: ProviderDriverKind.makeUnsafe("codex"),
          config: {
            binaryPath: "/tmp/codex-work",
          },
        },
      },
    };

    const resolved = Effect.runSync(
      resolveEffectiveCodexSettings(settings, ProviderInstanceId.makeUnsafe("codex_work")),
    );
    expect(resolved.binaryPath).toBe("/tmp/codex-work");
  });
});
