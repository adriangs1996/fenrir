import { Effect } from "effect";
import { ServerConfigShape, deriveServerPaths, ensureServerDirectories } from "../../src/config";

export function makeRealServerConfig(input: { cwd: string; baseDir: string }) {
  return Effect.gen(function* () {
    const derivedPaths = yield* deriveServerPaths(input.baseDir, undefined);
    yield* ensureServerDirectories(derivedPaths);

    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "fenrir-server",
      mode: "desktop",
      port: 0,
      host: "127.0.0.1",
      cwd: input.cwd,
      baseDir: input.baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      noBrowser: true,
      desktopBootstrapToken: "test-desktop-bootstrap-token",
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
    } satisfies ServerConfigShape;
  });
}
