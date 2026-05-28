import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId, ThreadId } from "@fenrir/contracts";
import { it, assert } from "@effect/vitest";
import { assertSome } from "@effect/vitest/utils";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";

function makeDirectoryLayer<E, R>(persistenceLayer: Layer.Layer<SqlClient.SqlClient, E, R>) {
  const runtimeRepositoryLayer = ProviderSessionRuntimeRepositoryLive.pipe(
    Layer.provide(persistenceLayer),
  );
  return Layer.mergeAll(
    runtimeRepositoryLayer,
    ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer)),
    NodeServices.layer,
  );
}

it.layer(makeDirectoryLayer(SqlitePersistenceMemory))("ProviderSessionDirectoryLive", (it) => {
  it("upserts and reads thread bindings", () =>
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;

      const initialThreadId = ThreadId.make("thread-1");

      yield* directory.upsert({
        provider: "codex",
        threadId: initialThreadId,
      });

      const provider = yield* directory.getProvider(initialThreadId);
      assert.equal(provider, "codex");
      const resolvedBinding = yield* directory.getBinding(initialThreadId);
      assertSome(resolvedBinding, {
        threadId: initialThreadId,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      if (Option.isSome(resolvedBinding)) {
        assert.equal(resolvedBinding.value.threadId, initialThreadId);
      }

      const nextThreadId = ThreadId.make("thread-2");

      yield* directory.upsert({
        provider: "codex",
        threadId: nextThreadId,
      });
      const updatedBinding = yield* directory.getBinding(nextThreadId);
      assert.equal(Option.isSome(updatedBinding), true);
      if (Option.isSome(updatedBinding)) {
        assert.equal(updatedBinding.value.threadId, nextThreadId);
      }

      const runtime = yield* runtimeRepository.getByThreadId({ threadId: nextThreadId });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.threadId, nextThreadId);
        assert.equal(runtime.value.status, "running");
        assert.equal(runtime.value.providerName, "codex");
      }

      const threadIds = yield* directory.listThreadIds();
      assert.deepEqual(threadIds, [nextThreadId]);

      const bindings = yield* directory.listBindings();
      assert.equal(bindings.length, 1);
      const listedBinding = bindings[0];
      if (!listedBinding) {
        return;
      }
      assert.equal(listedBinding.threadId, nextThreadId);
      assert.equal(listedBinding.provider, "codex");
      assert.deepEqual(listedBinding.providerInstanceId, ProviderInstanceId.make("codex"));
      assert.equal(listedBinding.adapterKey, "codex");
      assert.equal(typeof listedBinding.lastSeenAt, "string");
      assert.equal(listedBinding.runtimeMode, "full-access");
      assert.equal(listedBinding.status, "running");
      assert.equal(listedBinding.resumeCursor, null);
      assert.equal(listedBinding.runtimePayload, null);
    }));

  it("persists runtime fields and merges payload updates", () =>
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;

      const threadId = ThreadId.make("thread-runtime");

      yield* directory.upsert({
        provider: "codex",
        threadId,
        status: "starting",
        resumeCursor: {
          threadId: "provider-thread-runtime",
        },
        runtimePayload: {
          cwd: "/tmp/project",
          model: "gpt-5-codex",
        },
      });

      yield* directory.upsert({
        provider: "codex",
        threadId,
        status: "running",
        runtimePayload: {
          activeTurnId: "turn-1",
        },
      });

      const runtime = yield* runtimeRepository.getByThreadId({ threadId });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.threadId, threadId);
        assert.equal(runtime.value.status, "running");
        assert.deepEqual(runtime.value.resumeCursor, {
          threadId: "provider-thread-runtime",
        });
        assert.deepEqual(runtime.value.runtimePayload, {
          cwd: "/tmp/project",
          model: "gpt-5-codex",
          activeTurnId: "turn-1",
        });
      }
    }));

  it("persists providerInstanceId through adapterKey for runtime routing", () =>
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;
      const threadId = ThreadId.make("thread-instance-id");

      yield* directory.upsert({
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        threadId,
      });

      const runtime = yield* runtimeRepository.getByThreadId({ threadId });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.adapterKey, "codex_work");
      }

      const binding = yield* directory.getBinding(threadId);
      assertSome(binding, {
        threadId,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      });
    }));

  it("resets adapterKey to the new provider when provider changes without an explicit adapter key", () =>
    Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory;
      const runtimeRepository = yield* ProviderSessionRuntimeRepository;
      const threadId = ThreadId.make("thread-provider-change");

      yield* runtimeRepository.upsert({
        threadId,
        providerName: "claudeAgent",
        adapterKey: "claudeAgent",
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt: new Date().toISOString(),
        resumeCursor: null,
        runtimePayload: null,
      });

      yield* directory.upsert({
        provider: "codex",
        threadId,
      });

      const runtime = yield* runtimeRepository.getByThreadId({ threadId });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.providerName, "codex");
        assert.equal(runtime.value.adapterKey, "codex");
      }
    }));

  it("rehydrates persisted mappings across layer restart", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-provider-directory-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const directoryLayer = makeDirectoryLayer(makeSqlitePersistenceLive(dbPath));

      const threadId = ThreadId.make("thread-restart");

      yield* Effect.gen(function* () {
        const directory = yield* ProviderSessionDirectory;
        yield* directory.upsert({
          provider: "codex",
          threadId,
        });
      }).pipe(Effect.provide(directoryLayer));

      yield* Effect.gen(function* () {
        const directory = yield* ProviderSessionDirectory;
        const sql = yield* SqlClient.SqlClient;
        const provider = yield* directory.getProvider(threadId);
        assert.equal(provider, "codex");

        const resolvedBinding = yield* directory.getBinding(threadId);
        assertSome(resolvedBinding, {
          threadId,
          provider: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
        });
        if (Option.isSome(resolvedBinding)) {
          assert.equal(resolvedBinding.value.threadId, threadId);
        }

        const legacyTableRows = yield* sql<{ readonly name: string }>`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'provider_sessions'
        `;
        assert.equal(legacyTableRows.length, 0);
      }).pipe(Effect.provide(directoryLayer));

      fs.rmSync(tempDir, { recursive: true, force: true });
    }));
});
