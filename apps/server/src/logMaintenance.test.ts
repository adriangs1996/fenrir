import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { ServerConfig } from "./config";
import { LogMaintenance, LogMaintenanceLive } from "./logMaintenance";

const makeLogMaintenanceLayer = () =>
  LogMaintenanceLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "fenrir-log-maintenance-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("log maintenance", (it) => {
  it.effect("clears log directory entries and recreates known log directories", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const logMaintenance = yield* LogMaintenance;

      yield* fileSystem.writeFileString(config.serverTracePath, "trace\n");
      yield* fileSystem.writeFileString(path.join(config.logsDir, "desktop-main.log.1"), "desktop");
      yield* fileSystem.writeFileString(
        path.join(config.providerLogsDir, "events.log"),
        "provider",
      );
      yield* fileSystem.writeFileString(
        path.join(config.terminalLogsDir, "thread-1.default.log"),
        "terminal",
      );

      const result = yield* logMaintenance.clearAllLogs;

      assert.equal(result.logsDirectoryPath, config.logsDir);
      assert.equal(result.removedEntryCount, 4);
      assert.isTrue(yield* fileSystem.exists(config.logsDir));
      assert.isTrue(yield* fileSystem.exists(config.providerLogsDir));
      assert.isTrue(yield* fileSystem.exists(config.terminalLogsDir));
      assert.isFalse(yield* fileSystem.exists(config.serverTracePath));
      assert.deepEqual(yield* fileSystem.readDirectory(config.providerLogsDir), []);
      assert.deepEqual(yield* fileSystem.readDirectory(config.terminalLogsDir), []);
    }).pipe(Effect.provide(makeLogMaintenanceLayer())),
  );
});
