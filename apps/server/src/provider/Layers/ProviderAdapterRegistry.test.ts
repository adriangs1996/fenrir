import {
  defaultInstanceIdForDriver,
  ProviderInstanceId,
  type ProviderKind,
} from "@fenrir/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { ClaudeAdapter, ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter, CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSettingsService } from "../../serverSettings.ts";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: "claudeAgent",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const layer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      ProviderAdapterRegistryLive,
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        ServerSettingsService.layerTest(),
      ),
    ),
    NodeServices.layer,
  ),
);

const configuredLayer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      ProviderAdapterRegistryLive,
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        ServerSettingsService.layerTest({
          providerInstances: {
            [ProviderInstanceId.makeUnsafe("codex_work")]: {
              driver: "codex",
            },
          },
        }),
      ),
    ),
    NodeServices.layer,
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codexDefaultInstance = defaultInstanceIdForDriver("codex");
      const claudeDefaultInstance = defaultInstanceIdForDriver("claudeAgent");
      const codexByInstance = yield* registry.getByInstance(codexDefaultInstance);
      const claudeByInstance = yield* registry.getByInstance(claudeDefaultInstance);
      const codex = yield* registry.getByProvider("codex");
      const claude = yield* registry.getByProvider("claudeAgent");
      assert.equal(codexByInstance, fakeCodexAdapter);
      assert.equal(claudeByInstance, fakeClaudeAdapter);
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);

      const instances = yield* registry.listInstances();
      const providers = yield* registry.listProviders();
      assert.deepEqual(instances, [codexDefaultInstance, claudeDefaultInstance]);
      assert.deepEqual(providers, ["codex", "claudeAgent"]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const byInstance = yield* registry.getByInstance("unknown" as never).pipe(Effect.result);
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(byInstance, new ProviderUnsupportedError({ provider: "unknown" }));
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

configuredLayer("ProviderAdapterRegistryLive configured instances", (it) => {
  it.effect("routes configured built-in instance ids to the matching adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codexWork = yield* registry.getByInstance("codex_work" as never);
      assert.equal(codexWork, fakeCodexAdapter);

      const instances = yield* registry.listInstances();
      assert.deepEqual(instances, [
        defaultInstanceIdForDriver("codex"),
        defaultInstanceIdForDriver("claudeAgent"),
        ProviderInstanceId.makeUnsafe("codex_work"),
      ]);
    }),
  );
});
