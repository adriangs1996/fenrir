// @ts-nocheck
import * as os from "node:os";
import * as path from "node:path";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, ServiceMap, Stream } from "effect";

import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@fenrir/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { makeCursorAdapter } from "./CursorAdapter.ts";

class CursorAdapter extends ServiceMap.Service<CursorAdapter, CursorAdapterShape>()(
  "test/CursorAdapter",
) {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const bunExe = "bun";

async function makeMockAgentWrapper(extraEnv?: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fenrir-cursor-acp-mock-"));
  const wrapperPath = path.join(dir, "fake-agent.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(bunExe)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function waitForFileContent(filePath: string, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        return raw;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file content at ${filePath}`);
}

const cursorAdapterTestLayer = it.layer(
  Layer.effect(CursorAdapter, makeCursorAdapter()).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "fenrir-cursor-adapter-test-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

cursorAdapterTestLayer("CursorAdapter ACP", (it) => {
  it.effect("starts a session and maps mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const adapter = yield* CursorAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.makeUnsafe("cursor-mock-thread");
      const cursorInstanceId = ProviderInstanceId.makeUnsafe("cursor");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* settings.updateSettings({
        providerInstances: {
          [cursorInstanceId]: {
            driver: ProviderDriverKind.makeUnsafe("cursor"),
            enabled: true,
            config: {
              binaryPath: wrapperPath,
            },
          },
        },
      });

      const runtimeEventsRef = yield* Ref.make<ReadonlyArray<{ type: string }>>([]);
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Ref.update(runtimeEventsRef, (events) => [...events, { type: event.type }]),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.makeUnsafe("cursor"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "cursor", model: "default" },
      });

      assert.equal(session.provider, "cursor");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      yield* adapter.sendTurn({
        threadId,
        input: "hello mock",
        attachments: [],
      });

      yield* Effect.sleep("100 millis");
      yield* Fiber.interrupt(runtimeEventsFiber);
      const events = Array.from(yield* Ref.get(runtimeEventsRef));
      const types = events.map((event) => event.type);
      for (const expected of [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "turn.plan.updated",
        "item.started",
        "content.delta",
        "item.completed",
        "turn.completed",
      ] as const) {
        assert.include(types, expected);
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("closes the ACP child process when a session stops", () =>
    Effect.gen(function* () {
      const adapter = yield* CursorAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.makeUnsafe("cursor-stop-session-close");
      const cursorInstanceId = ProviderInstanceId.makeUnsafe("cursor");
      const tempDir = yield* Effect.promise(() =>
        mkdtemp(path.join(os.tmpdir(), "fenrir-cursor-exit-log-")),
      );
      const exitLogPath = path.join(tempDir, "exit.log");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EXIT_LOG_PATH: exitLogPath,
        }),
      );
      yield* settings.updateSettings({
        providerInstances: {
          [cursorInstanceId]: {
            driver: ProviderDriverKind.makeUnsafe("cursor"),
            enabled: true,
            config: {
              binaryPath: wrapperPath,
            },
          },
        },
      });

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.makeUnsafe("cursor"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "cursor", model: "default" },
      });

      yield* adapter.stopSession(threadId).pipe(Effect.forkChild);

      const exitLog = yield* Effect.promise(() => waitForFileContent(exitLogPath));
      assert.include(exitLog, "SIGTERM");
    }),
  );

  it.effect("issues ACP approval requests for approval-required turns", () =>
    Effect.gen(function* () {
      const adapter = yield* CursorAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.makeUnsafe("cursor-approval-roundtrip");
      const cursorInstanceId = ProviderInstanceId.makeUnsafe("cursor");
      const tempDir = yield* Effect.promise(() =>
        mkdtemp(path.join(os.tmpdir(), "fenrir-cursor-request-log-")),
      );
      const requestLogPath = path.join(tempDir, "requests.log");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EMIT_TOOL_CALLS: "1",
          T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        }),
      );
      yield* settings.updateSettings({
        providerInstances: {
          [cursorInstanceId]: {
            driver: ProviderDriverKind.makeUnsafe("cursor"),
            enabled: true,
            config: {
              binaryPath: wrapperPath,
            },
          },
        },
      });

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.makeUnsafe("cursor"),
        cwd: process.cwd(),
        runtimeMode: "approval-required",
        modelSelection: { provider: "cursor", model: "default" },
      });

      yield* adapter
        .sendTurn({
          threadId,
          input: "needs approval",
          attachments: [],
        })
        .pipe(Effect.forkChild);

      const requestLog = yield* Effect.promise(() => waitForFileContent(requestLogPath));
      assert.include(requestLog, '"method":"session/request_permission"');

      yield* adapter.stopSession(threadId).pipe(Effect.forkChild);
    }),
  );

  it.effect("rejects unknown approval request ids", () =>
    Effect.gen(function* () {
      const adapter = yield* CursorAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.makeUnsafe("cursor-unknown-approval");
      const cursorInstanceId = ProviderInstanceId.makeUnsafe("cursor");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EMIT_TOOL_CALLS: "1",
        }),
      );
      yield* settings.updateSettings({
        providerInstances: {
          [cursorInstanceId]: {
            driver: ProviderDriverKind.makeUnsafe("cursor"),
            enabled: true,
            config: {
              binaryPath: wrapperPath,
            },
          },
        },
      });

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.makeUnsafe("cursor"),
        cwd: process.cwd(),
        runtimeMode: "approval-required",
        modelSelection: { provider: "cursor", model: "default" },
      });

      const exit = yield* adapter
        .respondToRequest(threadId, ApprovalRequestId.makeUnsafe("missing"), "accept")
        .pipe(Effect.exit);
      assert.isTrue(exit._tag === "Failure");

      yield* adapter.stopSession(threadId).pipe(Effect.forkChild);
    }),
  );
});
