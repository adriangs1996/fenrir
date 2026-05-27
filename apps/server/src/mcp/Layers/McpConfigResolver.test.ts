import { DEFAULT_SERVER_SETTINGS, McpServerId, type ServerSettings } from "@fenrir/contracts";
import { it, expect } from "@effect/vitest";
import { Effect } from "effect";

import { McpConfigResolver } from "../Services/McpConfigResolver.ts";
import { McpConfigResolverLive } from "./McpConfigResolver.ts";

const serverId = (value: string): McpServerId => McpServerId.makeUnsafe(value);

function makeSettings(overrides: Partial<ServerSettings>): ServerSettings {
  return {
    ...DEFAULT_SERVER_SETTINGS,
    ...overrides,
  };
}

it.effect("McpConfigResolver resolves literals and env refs", () =>
  Effect.gen(function* () {
    const resolver = yield* McpConfigResolver;
    const resolved = yield* resolver.resolve({
      settings: makeSettings({
        mcpServers: {
          [serverId("user-tools")]: {
            id: serverId("user-tools"),
            name: "User tools",
            enabled: true,
            source: "user",
            transport: {
              type: "stdio",
              command: "node",
              args: ["server.js"],
              env: {
                TOKEN: { type: "env", name: "TOKEN" },
                MODE: { type: "literal", value: "readonly" },
              },
            },
          },
        },
      }),
      selectedServerIds: [serverId("user-tools")],
      environment: { TOKEN: "secret-token" },
    });

    expect(resolved.serverIds).toEqual([serverId("user-tools")]);
    expect(resolved.servers[0]?.transport).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: {
        TOKEN: "secret-token",
        MODE: "readonly",
      },
    });
  }).pipe(Effect.provide(McpConfigResolverLive)),
);

it.effect("McpConfigResolver rejects disabled and missing env refs", () =>
  Effect.gen(function* () {
    const resolver = yield* McpConfigResolver;
    const settings = makeSettings({
      mcpServers: {
        [serverId("disabled-tools")]: {
          id: serverId("disabled-tools"),
          name: "Disabled tools",
          enabled: false,
          source: "user",
          transport: {
            type: "http",
            url: "https://example.com/mcp",
            headers: {},
          },
        },
        [serverId("missing-env")]: {
          id: serverId("missing-env"),
          name: "Missing env",
          enabled: true,
          source: "user",
          transport: {
            type: "sse",
            url: "https://example.com/events",
            headers: {
              Authorization: { type: "env", name: "MISSING_TOKEN" },
            },
          },
        },
      },
    });

    const disabled = yield* Effect.flip(
      resolver.resolve({
        settings,
        selectedServerIds: [serverId("disabled-tools")],
        environment: {},
      }),
    );
    const missingEnv = yield* Effect.flip(
      resolver.resolve({
        settings,
        selectedServerIds: [serverId("missing-env")],
        environment: {},
      }),
    );

    expect(disabled.message).toContain("disabled");
    expect(missingEnv.message).toContain("MISSING_TOKEN");
  }).pipe(Effect.provide(McpConfigResolverLive)),
);

it.effect("McpConfigResolver produces a stable hash independent of key ordering", () =>
  Effect.gen(function* () {
    const resolver = yield* McpConfigResolver;
    const makeHttpSettings = (headers: Record<string, { type: "literal"; value: string }>) =>
      makeSettings({
        mcpServers: {
          [serverId("remote-tools")]: {
            id: serverId("remote-tools"),
            name: "Remote tools",
            enabled: true,
            source: "user",
            transport: {
              type: "http",
              url: "https://example.com/mcp",
              headers,
            },
          },
        },
      });

    const first = yield* resolver.resolve({
      settings: makeHttpSettings({
        A: { type: "literal", value: "one" },
        B: { type: "literal", value: "two" },
      }),
      selectedServerIds: [serverId("remote-tools")],
    });
    const second = yield* resolver.resolve({
      settings: makeHttpSettings({
        B: { type: "literal", value: "changed" },
        A: { type: "literal", value: "one" },
      }),
      selectedServerIds: [serverId("remote-tools")],
    });

    expect(first.configHash).toBe(second.configHash);
  }).pipe(Effect.provide(McpConfigResolverLive)),
);
