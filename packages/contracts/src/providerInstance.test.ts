import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ProviderInstanceConfig,
  ProviderInstanceConfigMap,
  ProviderInstanceId,
  ProviderInstanceRef,
} from "./providerInstance";

const decodeProviderInstanceId = Schema.decodeUnknownSync(ProviderInstanceId);
const decodeProviderInstanceRef = Schema.decodeUnknownSync(ProviderInstanceRef);
const decodeProviderInstanceConfig = Schema.decodeUnknownSync(ProviderInstanceConfig);
const decodeProviderInstanceConfigMap = Schema.decodeUnknownSync(ProviderInstanceConfigMap);

describe("ProviderInstanceId", () => {
  it("accepts legacy provider-kind slugs as instance ids", () => {
    expect(decodeProviderInstanceId("codex")).toBe("codex");
    expect(decodeProviderInstanceId("claudeAgent")).toBe("claudeAgent");
  });

  it("rejects invalid instance slugs", () => {
    expect(() => decodeProviderInstanceId("1codex")).toThrow();
    expect(() => decodeProviderInstanceId("has spaces")).toThrow();
  });
});

describe("ProviderInstanceRef", () => {
  it("accepts open driver kinds", () => {
    const ref = decodeProviderInstanceRef({
      instanceId: "cursor_local",
      driver: "cursor",
    });

    expect(ref.instanceId).toBe("cursor_local");
    expect(ref.driver).toBe("cursor");
  });
});

describe("ProviderInstanceConfigMap", () => {
  it("preserves opaque config payloads for known and unknown drivers", () => {
    const configMap = decodeProviderInstanceConfigMap({
      codex_personal: {
        driver: "codex",
        displayName: "Codex Personal",
        config: { homePath: "~/.codex-personal" },
      },
      opencode_local: {
        driver: "opencode",
        displayName: "OpenCode Local",
        config: { endpoint: "http://localhost:4096" },
      },
    });
    const codexPersonalId = ProviderInstanceId.makeUnsafe("codex_personal");
    const openCodeLocalId = ProviderInstanceId.makeUnsafe("opencode_local");

    expect(configMap[codexPersonalId]).toEqual({
      driver: "codex",
      displayName: "Codex Personal",
      config: { homePath: "~/.codex-personal" },
    });
    expect(configMap[openCodeLocalId]).toEqual({
      driver: "opencode",
      displayName: "OpenCode Local",
      config: { endpoint: "http://localhost:4096" },
    });
  });

  it("rejects invalid instance ids", () => {
    expect(() =>
      decodeProviderInstanceConfigMap({
        "1bad": { driver: "codex" },
      }),
    ).toThrow();
  });
});

describe("ProviderInstanceConfig", () => {
  it("accepts a minimal config envelope", () => {
    expect(decodeProviderInstanceConfig({ driver: "codex" })).toEqual({
      driver: "codex",
    });
  });
});
