import { Context, Effect, FileSystem, Layer, Path } from "effect";
import * as PlatformError from "effect/PlatformError";

import type { ServerClearLogsResult } from "@fenrir/contracts";

import { ServerConfig } from "./config";

export interface LogMaintenanceShape {
  readonly clearAllLogs: Effect.Effect<ServerClearLogsResult, PlatformError.PlatformError>;
}

export class LogMaintenance extends Context.Service<LogMaintenance, LogMaintenanceShape>()(
  "fenrir/logMaintenance/LogMaintenance",
) {}

export const makeLogMaintenance = Effect.fn("makeLogMaintenance")(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const clearAllLogs = Effect.gen(function* () {
    const logsDirExists = yield* fileSystem
      .exists(config.logsDir)
      .pipe(Effect.orElseSucceed(() => false));
    let removedEntryCount = 0;

    if (logsDirExists) {
      const entries = yield* fileSystem
        .readDirectory(config.logsDir)
        .pipe(
          Effect.catch((error) =>
            error instanceof PlatformError.PlatformError && error.reason._tag === "NotFound"
              ? Effect.succeed([])
              : Effect.fail(error),
          ),
        );

      for (const entry of entries) {
        yield* fileSystem.remove(path.join(config.logsDir, entry), {
          force: true,
          recursive: true,
        });
        removedEntryCount += 1;
      }
    }

    yield* Effect.all(
      [
        fileSystem.makeDirectory(config.logsDir, { recursive: true }),
        fileSystem.makeDirectory(config.providerLogsDir, { recursive: true }),
        fileSystem.makeDirectory(config.terminalLogsDir, { recursive: true }),
      ],
      { concurrency: "unbounded" },
    );

    return {
      logsDirectoryPath: config.logsDir,
      removedEntryCount,
    } satisfies ServerClearLogsResult;
  });

  return LogMaintenance.of({ clearAllLogs });
});

export const LogMaintenanceLive = Layer.effect(LogMaintenance, makeLogMaintenance());
