import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderKind,
} from "@fenrir/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { ClaudeAdapter, type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter, type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { OpenCodeAdapter, type OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

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

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: ProviderDriverKind.make("opencode"),
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

const fakeCursorAdapter: CursorAdapterShape = {
  provider: ProviderDriverKind.make("cursor"),
  capabilities: { sessionModelSwitch: "restart-session" },
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

function makeInstanceRegistryLayer(options?: { includeCodexWork?: boolean }) {
  const instances = [
    {
      provider: "codex" as const,
      driverKind: ProviderDriverKind.make("codex"),
      instanceId: defaultInstanceIdForDriver("codex"),
      snapshot: {
        getSnapshot: Effect.die("unused"),
        refresh: Effect.die("unused"),
        streamChanges: Stream.empty,
      },
    },
    {
      provider: ProviderDriverKind.make("cursor"),
      driverKind: ProviderDriverKind.make("cursor"),
      instanceId: defaultInstanceIdForDriver("cursor"),
      snapshot: {
        getSnapshot: Effect.die("unused"),
        refresh: Effect.die("unused"),
        streamChanges: Stream.empty,
      },
    },
    {
      provider: "claudeAgent" as const,
      driverKind: ProviderDriverKind.make("claudeAgent"),
      instanceId: defaultInstanceIdForDriver("claudeAgent"),
      snapshot: {
        getSnapshot: Effect.die("unused"),
        refresh: Effect.die("unused"),
        streamChanges: Stream.empty,
      },
    },
    ...(options?.includeCodexWork
      ? [
          {
            provider: "codex" as const,
            driverKind: ProviderDriverKind.make("codex"),
            instanceId: ProviderInstanceId.make("codex_work"),
            displayName: "Codex Work",
            snapshot: {
              getSnapshot: Effect.die("unused"),
              refresh: Effect.die("unused"),
              streamChanges: Stream.empty,
            },
          },
        ]
      : []),
  ] as const;

  return Layer.succeed(ProviderInstanceRegistry, {
    getInstance: (instanceId) =>
      Effect.succeed(instances.find((instance) => instance.instanceId === instanceId)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
  });
}

function makeAdapterLayers() {
  return Layer.mergeAll(
    Layer.succeed(CodexAdapter, fakeCodexAdapter),
    Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
    Layer.succeed(CursorAdapter, fakeCursorAdapter),
    Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
  );
}

const layer = it.layer(
  Layer.mergeAll(
    ProviderAdapterRegistryLive.pipe(
      Layer.provideMerge(makeInstanceRegistryLayer()),
      Layer.provideMerge(makeAdapterLayers()),
    ),
    NodeServices.layer,
  ),
);

const configuredLayer = it.layer(
  Layer.mergeAll(
    ProviderAdapterRegistryLive.pipe(
      Layer.provideMerge(makeInstanceRegistryLayer({ includeCodexWork: true })),
      Layer.provideMerge(makeAdapterLayers()),
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
      const cursorDefaultInstance = defaultInstanceIdForDriver("cursor");
      const codexByInstance = yield* registry.getByInstance(codexDefaultInstance);
      const cursorByInstance = yield* registry.getByInstance(cursorDefaultInstance);
      const claudeByInstance = yield* registry.getByInstance(claudeDefaultInstance);
      const codex = yield* registry.getByProvider("codex");
      const cursor = yield* registry.getByProvider("cursor" as never);
      const claude = yield* registry.getByProvider("claudeAgent");
      assert.equal(codexByInstance, fakeCodexAdapter);
      assert.equal(cursorByInstance, fakeCursorAdapter);
      assert.equal(claudeByInstance, fakeClaudeAdapter);
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(cursor, fakeCursorAdapter);
      assert.equal(claude, fakeClaudeAdapter);

      const instances = yield* registry.listInstances();
      const providers = yield* registry.listProviders();
      assert.deepEqual(instances, [
        codexDefaultInstance,
        cursorDefaultInstance,
        claudeDefaultInstance,
      ]);
      assert.deepEqual(providers, ["codex", ProviderDriverKind.make("cursor"), "claudeAgent"]);
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
        defaultInstanceIdForDriver("cursor"),
        defaultInstanceIdForDriver("claudeAgent"),
        ProviderInstanceId.make("codex_work"),
      ]);
    }),
  );
});
