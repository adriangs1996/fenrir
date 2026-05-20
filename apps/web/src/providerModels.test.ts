import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import { getProviderModels, getProviderSnapshot } from "./providerModels";

function makeProvider(
  input: Partial<ServerProvider> & { provider?: ServerProvider["provider"]; driver?: string },
): ServerProvider {
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: input.version ?? "1.0.0",
    status: input.status ?? "ready",
    auth: input.auth ?? { status: "authenticated" },
    checkedAt: input.checkedAt ?? "2026-05-19T00:00:00.000Z",
    models: input.models ?? [],
    ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    ...(input.driver ? { driver: ProviderDriverKind.makeUnsafe(input.driver) } : {}),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.versionAdvisory ? { versionAdvisory: input.versionAdvisory } : {}),
  };
}

describe("providerModels", () => {
  it("prefers the default routed instance when multiple snapshots share a provider kind", () => {
    const shadow = makeProvider({
      provider: "codex",
      instanceId: ProviderInstanceId.makeUnsafe("codex_work"),
      displayName: "Codex Work",
      models: [{ slug: "shadow-model", name: "Shadow Model", isCustom: false, capabilities: null }],
    });
    const routed = makeProvider({
      provider: "codex",
      instanceId: defaultInstanceIdForDriver("codex"),
      displayName: "Codex",
      models: [
        { slug: "default-model", name: "Default Model", isCustom: false, capabilities: null },
      ],
    });

    expect(getProviderSnapshot([shadow, routed], "codex")).toBe(routed);
    expect(getProviderModels([shadow, routed], "codex")).toEqual(routed.models);
  });

  it("falls back to the first matching provider snapshot when the default instance id is missing", () => {
    const fallback = makeProvider({
      provider: "claudeAgent",
      displayName: "Claude",
      models: [{ slug: "claude-model", name: "Claude Model", isCustom: false, capabilities: null }],
    });

    expect(getProviderSnapshot([fallback], "claudeAgent")).toBe(fallback);
    expect(getProviderModels([fallback], "claudeAgent")).toEqual(fallback.models);
  });
});
