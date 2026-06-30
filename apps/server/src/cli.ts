import { NetService } from "@fenrir/shared/Net";
import { parsePersistedServerObservabilitySettings } from "@fenrir/shared/serverSettings";
import {
  AuthWebSocketTokenResult,
  AuthSessionId,
  ProjectId,
  TmuxWorkspaceId,
  WS_METHODS,
  WsRpcGroup,
  type RemoteConnectionSnapshot,
  type RemoteHostSnapshot,
  type TmuxActor,
  type TmuxKernelError,
  type TmuxOperationalPaneStatusResult,
  type TmuxWorkspaceListResult,
  type TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";
import {
  Config,
  Console,
  Duration,
  Effect,
  FileSystem,
  Layer,
  LogLevel,
  Option,
  Path,
  References,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import * as Socket from "effect/unstable/socket/Socket";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import {
  DEFAULT_PORT,
  deriveServerPaths,
  ensureServerDirectories,
  resolveStaticDir,
  ServerConfig,
  RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { readBootstrapEnvelope } from "./bootstrap";
import { expandHomePath, resolveBaseDir } from "./os-jank";
import { runServer } from "./server";
import { AuthControlPlaneRuntimeLive } from "./auth/Layers/AuthControlPlane.ts";
import {
  formatIssuedPairingCredential,
  formatIssuedSession,
  formatPairingCredentialList,
  formatSessionList,
} from "./cliAuthFormat";
import { AuthControlPlane, AuthControlPlaneShape } from "./auth/Services/AuthControlPlane.ts";
import { TmuxControlModeAdapterLive } from "./terminal/Layers/TmuxControlMode.ts";
import { TmuxPaneStreamServiceLive } from "./terminal/Layers/TmuxPaneStreamService.ts";
import { TmuxWorkspaceServiceLive } from "./terminal/Layers/TmuxWorkspaceService.ts";
import {
  TmuxWorkspaceService,
  type TmuxWorkspaceServiceShape,
} from "./terminal/Services/TmuxWorkspaceService.ts";

const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(() => import("./terminal/Layers/BunPTY.ts"));
      return BunPTY.layer;
    }
    const NodePTY = yield* Effect.promise(() => import("./terminal/Layers/NodePTY.ts"));
    return NodePTY.layer;
  }),
);

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const BootstrapEnvelopeSchema = Schema.Struct({
  mode: Schema.optional(RuntimeMode),
  port: Schema.optional(PortSchema),
  host: Schema.optional(Schema.String),
  fenrirHome: Schema.optional(Schema.String),
  devUrl: Schema.optional(Schema.URLFromString),
  noBrowser: Schema.optional(Schema.Boolean),
  desktopBootstrapToken: Schema.optional(Schema.String),
  autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
  logWebSocketEvents: Schema.optional(Schema.Boolean),
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
});

const modeFlag = Flag.choice("mode", RuntimeMode.literals).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const baseDirFlag = Flag.string("base-dir").pipe(
  Flag.withDescription("Base directory path (equivalent to FENRIR_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to FENRIR_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

const EnvServerConfig = Config.all({
  logLevel: Config.logLevel("FENRIR_LOG_LEVEL").pipe(Config.withDefault("Info")),
  traceMinLevel: Config.logLevel("FENRIR_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
  traceTimingEnabled: Config.boolean("FENRIR_TRACE_TIMING_ENABLED").pipe(Config.withDefault(true)),
  traceFile: Config.string("FENRIR_TRACE_FILE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  traceMaxBytes: Config.int("FENRIR_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
  traceMaxFiles: Config.int("FENRIR_TRACE_MAX_FILES").pipe(Config.withDefault(10)),
  traceBatchWindowMs: Config.int("FENRIR_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(200)),
  otlpTracesUrl: Config.string("FENRIR_OTLP_TRACES_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpMetricsUrl: Config.string("FENRIR_OTLP_METRICS_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpExportIntervalMs: Config.int("FENRIR_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  otlpServiceName: Config.string("FENRIR_OTLP_SERVICE_NAME").pipe(
    Config.withDefault("fenrir-server"),
  ),
  mode: Config.schema(RuntimeMode, "FENRIR_MODE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  port: Config.port("FENRIR_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("FENRIR_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  fenrirHome: Config.string("FENRIR_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("FENRIR_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  bootstrapFd: Config.int("FENRIR_BOOTSTRAP_FD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("FENRIR_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("FENRIR_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

interface CliServerFlags {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly baseDir: Option.Option<string>;
  readonly cwd: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly bootstrapFd: Option.Option<number>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

interface CliAuthLocationFlags {
  readonly baseDir: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
}

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

const loadPersistedObservabilitySettings = Effect.fn(function* (settingsPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }

  const raw = yield* fs.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => ""));
  return parsePersistedServerObservabilitySettings(raw);
});

export const resolveServerConfig = (
  flags: CliServerFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
) =>
  Effect.gen(function* () {
    const { findAvailablePort } = yield* NetService;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const env = yield* EnvServerConfig;
    const bootstrapFd = Option.getOrUndefined(flags.bootstrapFd) ?? env.bootstrapFd;
    const bootstrapEnvelope =
      bootstrapFd !== undefined
        ? yield* readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd)
        : Option.none();

    const mode: RuntimeMode = Option.getOrElse(
      resolveOptionPrecedence(
        flags.mode,
        Option.fromUndefinedOr(env.mode),
        Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.mode)),
      ),
      () => "web",
    );

    const port = yield* Option.match(
      resolveOptionPrecedence(
        flags.port,
        Option.fromUndefinedOr(env.port),
        Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.port)),
      ),
      {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      },
    );
    const devUrl = Option.getOrElse(
      resolveOptionPrecedence(
        flags.devUrl,
        Option.fromUndefinedOr(env.devUrl),
        Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.devUrl)),
      ),
      () => undefined,
    );
    const baseDir = yield* resolveBaseDir(
      Option.getOrUndefined(
        resolveOptionPrecedence(
          flags.baseDir,
          Option.fromUndefinedOr(env.fenrirHome),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.fenrirHome),
          ),
        ),
      ),
    );
    const rawCwd = Option.getOrElse(flags.cwd, () => process.cwd());
    const cwd = path.resolve(yield* expandHomePath(rawCwd.trim()));
    yield* fs.makeDirectory(cwd, { recursive: true });
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
    yield* ensureServerDirectories(derivedPaths);
    const persistedObservabilitySettings = yield* loadPersistedObservabilitySettings(
      derivedPaths.settingsPath,
    );
    const serverTracePath = env.traceFile ?? derivedPaths.serverTracePath;
    yield* fs.makeDirectory(path.dirname(serverTracePath), { recursive: true });
    const noBrowser = resolveBooleanFlag(
      flags.noBrowser,
      Option.getOrElse(
        resolveOptionPrecedence(
          Option.fromUndefinedOr(env.noBrowser),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.noBrowser),
          ),
        ),
        () => mode === "desktop",
      ),
    );
    const desktopBootstrapToken = Option.getOrUndefined(
      Option.flatMap(bootstrapEnvelope, (bootstrap) =>
        Option.fromUndefinedOr(bootstrap.desktopBootstrapToken),
      ),
    );
    const autoBootstrapProjectFromCwd = resolveBooleanFlag(
      flags.autoBootstrapProjectFromCwd,
      Option.getOrElse(
        resolveOptionPrecedence(
          Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.autoBootstrapProjectFromCwd),
          ),
        ),
        () => mode === "web",
      ),
    );
    const logWebSocketEvents = resolveBooleanFlag(
      flags.logWebSocketEvents,
      Option.getOrElse(
        resolveOptionPrecedence(
          Option.fromUndefinedOr(env.logWebSocketEvents),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.logWebSocketEvents),
          ),
        ),
        () => Boolean(devUrl),
      ),
    );
    const staticDir = devUrl ? undefined : yield* resolveStaticDir();
    const host = Option.getOrElse(
      resolveOptionPrecedence(
        flags.host,
        Option.fromUndefinedOr(env.host),
        Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.host)),
      ),
      () => (mode === "desktop" ? "127.0.0.1" : undefined),
    );
    const logLevel = Option.getOrElse(cliLogLevel, () => env.logLevel);

    const config: ServerConfigShape = {
      logLevel,
      traceMinLevel: env.traceMinLevel,
      traceTimingEnabled: env.traceTimingEnabled,
      traceBatchWindowMs: env.traceBatchWindowMs,
      traceMaxBytes: env.traceMaxBytes,
      traceMaxFiles: env.traceMaxFiles,
      otlpTracesUrl:
        env.otlpTracesUrl ??
        Option.getOrUndefined(
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.otlpTracesUrl),
          ),
        ) ??
        persistedObservabilitySettings.otlpTracesUrl,
      otlpMetricsUrl:
        env.otlpMetricsUrl ??
        Option.getOrUndefined(
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.otlpMetricsUrl),
          ),
        ) ??
        persistedObservabilitySettings.otlpMetricsUrl,
      otlpExportIntervalMs: env.otlpExportIntervalMs,
      otlpServiceName: env.otlpServiceName,
      mode,
      port,
      cwd,
      baseDir,
      ...derivedPaths,
      serverTracePath,
      host,
      staticDir,
      devUrl,
      noBrowser,
      desktopBootstrapToken,
      autoBootstrapProjectFromCwd,
      logWebSocketEvents,
    };

    return config;
  });

const resolveCliAuthConfig = (
  flags: CliAuthLocationFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
) =>
  resolveServerConfig(
    {
      mode: Option.none(),
      port: Option.none(),
      host: Option.none(),
      baseDir: flags.baseDir,
      cwd: Option.none(),
      devUrl: flags.devUrl,
      noBrowser: Option.none(),
      bootstrapFd: Option.none(),
      autoBootstrapProjectFromCwd: Option.none(),
      logWebSocketEvents: Option.none(),
    },
    cliLogLevel,
  );

const DurationShorthandPattern = /^(?<value>\d+)(?<unit>ms|s|m|h|d|w)$/i;

const parseDurationInput = (value: string): Duration.Duration | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const shorthand = DurationShorthandPattern.exec(trimmed);
  const normalizedInput = shorthand?.groups
    ? (() => {
        const amountText = shorthand.groups.value;
        const unitText = shorthand.groups.unit;
        if (typeof amountText !== "string" || typeof unitText !== "string") {
          return null;
        }

        const amount = Number.parseInt(amountText, 10);
        if (!Number.isFinite(amount)) return null;

        switch (unitText.toLowerCase()) {
          case "ms":
            return `${amount} millis`;
          case "s":
            return `${amount} seconds`;
          case "m":
            return `${amount} minutes`;
          case "h":
            return `${amount} hours`;
          case "d":
            return `${amount} days`;
          case "w":
            return `${amount} weeks`;
          default:
            return null;
        }
      })()
    : (trimmed as Duration.Input);

  if (normalizedInput === null) return null;

  const decoded = Duration.fromInput(normalizedInput as Duration.Input);
  return Option.isSome(decoded) ? decoded.value : null;
};

const DurationFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Duration,
    SchemaTransformation.transformOrFail({
      decode: (value) => {
        const duration = parseDurationInput(value);
        if (duration !== null) {
          return Effect.succeed(duration);
        }
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: "Invalid duration. Use values like 5m, 1h, 30d, or 15 minutes.",
          }),
        );
      },
      encode: (duration) => Effect.succeed(Duration.format(duration)),
    }),
  ),
);

const runWithAuthControlPlane = <A, E>(
  flags: CliAuthLocationFlags,
  run: (authControlPlane: AuthControlPlaneShape) => Effect.Effect<A, E>,
  options?: {
    readonly quietLogs?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = options?.quietLogs ? "Error" : config.logLevel;
    return yield* Effect.gen(function* () {
      const authControlPlane = yield* AuthControlPlane;
      return yield* run(authControlPlane);
    }).pipe(
      Effect.provide(AuthControlPlaneRuntimeLive),
      Effect.provideService(ServerConfig, config),
      Effect.provideService(References.MinimumLogLevel, minimumLogLevel),
    );
  });

interface CliTmuxKernelAdminFlags extends CliAuthLocationFlags {
  readonly actorSessionId: AuthSessionId;
  readonly actorSubject: string;
}

interface CliTmuxKernelLiveFlags {
  readonly serverUrl: Option.Option<URL>;
  readonly bearerToken: Option.Option<string>;
}

interface CliTmuxKernelJsonFlag {
  readonly json: boolean;
}

export interface TmuxKernelMetadataStorageSnapshot {
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number | null;
}

export interface TmuxKernelRemoteTargetsSnapshot {
  readonly hosts: readonly RemoteHostSnapshot[];
  readonly connections: readonly RemoteConnectionSnapshot[];
}

const TmuxKernelAdminLayerLive = Layer.mergeAll(
  TmuxControlModeAdapterLive,
  TmuxPaneStreamServiceLive,
  TmuxWorkspaceServiceLive.pipe(
    Layer.provide(Layer.mergeAll(TmuxControlModeAdapterLive, TmuxPaneStreamServiceLive)),
  ),
).pipe(Layer.provide(PtyAdapterLive));

const tmuxWorkspaceMetadataPath = (path: Path.Path, stateDir: string): string =>
  path.join(stateDir, "tmux-workspaces", "metadata.json");

const makeTmuxKernelActor = (flags: CliTmuxKernelAdminFlags): TmuxActor => ({
  sessionId: flags.actorSessionId,
  subject: flags.actorSubject,
});

const decodeAuthWebSocketTokenResult = Schema.decodeUnknownSync(AuthWebSocketTokenResult);
const makeWsRpcClient = RpcClient.make(WsRpcGroup);
type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

const resolveRequiredLiveTarget = (
  flags: CliTmuxKernelLiveFlags,
): Effect.Effect<{ readonly serverUrl: URL; readonly bearerToken: string }, Error> => {
  const serverUrl = Option.getOrUndefined(flags.serverUrl);
  const bearerToken = Option.getOrUndefined(flags.bearerToken);
  if (!serverUrl || !bearerToken || bearerToken.trim().length === 0) {
    return Effect.fail(
      new Error(
        "Live tmux-kernel admin commands require --server-url and --bearer-token. Use `auth session issue --token-only` to create a bearer session.",
      ),
    );
  }
  return Effect.succeed({ serverUrl, bearerToken });
};

const websocketUrlForServer = (serverUrl: URL, wsToken: string): string => {
  const url = new URL("/ws", serverUrl);
  url.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("wsToken", wsToken);
  return url.toString();
};

const issueLiveWebSocketToken = Effect.fn(function* (target: {
  readonly serverUrl: URL;
  readonly bearerToken: string;
}) {
  const tokenUrl = new URL("/api/auth/ws-token", target.serverUrl);
  const response = yield* Effect.promise(() =>
    fetch(tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.bearerToken}`,
      },
    }),
  );
  if (!response.ok) {
    return yield* Effect.fail(
      new Error(`Failed to issue websocket token from ${tokenUrl}: HTTP ${response.status}`),
    );
  }
  const raw = yield* Effect.promise(() => response.json());
  return decodeAuthWebSocketTokenResult(raw);
});

const wsRpcProtocolLayer = (wsUrl: string) => {
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) =>
      new NodeSocket.NodeWS.WebSocket(socketUrl, protocols) as unknown as globalThis.WebSocket,
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const withLiveWsRpcClient = <A, E, R>(
  target: { readonly serverUrl: URL; readonly bearerToken: string },
  run: (client: WsRpcClient) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const websocketToken = yield* issueLiveWebSocketToken(target);
    return yield* Effect.scoped(
      makeWsRpcClient.pipe(
        Effect.flatMap(run),
        Effect.provide(
          wsRpcProtocolLayer(websocketUrlForServer(target.serverUrl, websocketToken.token)),
        ),
      ),
    );
  });

const readTmuxKernelMetadataStorage = Effect.fn(function* () {
  const serverConfig = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const metadataPath = tmuxWorkspaceMetadataPath(path, serverConfig.stateDir);
  const stat = yield* fs.stat(metadataPath).pipe(Effect.catch(() => Effect.succeed(null)));
  return {
    path: metadataPath,
    exists: stat !== null,
    bytes: stat === null ? null : Number(stat.size),
  } satisfies TmuxKernelMetadataStorageSnapshot;
});

const runWithTmuxKernelAdmin = <A, E>(
  flags: CliTmuxKernelAdminFlags,
  run: Effect.Effect<A, E, TmuxWorkspaceService | ServerConfig | FileSystem.FileSystem | Path.Path>,
  options?: {
    readonly quietLogs?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = options?.quietLogs ? "Error" : config.logLevel;
    return yield* run.pipe(
      Effect.provide(TmuxKernelAdminLayerLive),
      Effect.provideService(ServerConfig, config),
      Effect.provideService(References.MinimumLogLevel, minimumLogLevel),
    );
  });

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);

export const formatTmuxWorkspaceList = (
  result: TmuxWorkspaceListResult,
  options: { readonly json: boolean },
): string => {
  if (options.json) return formatJson(result);
  if (result.workspaces.length === 0) {
    return "No tmux kernel workspaces are visible to the selected actor.";
  }
  return result.workspaces
    .map(
      (workspace) =>
        `${workspace.workspaceId}  project=${workspace.projectId}  status=${workspace.status}  session=${workspace.tmuxSessionName}  updated=${workspace.updatedAt}`,
    )
    .join("\n");
};

export const formatTmuxWorkspaceSnapshot = (
  snapshot: TmuxWorkspaceSnapshot,
  options: { readonly json: boolean },
): string => {
  if (options.json) return formatJson(snapshot);
  const windows = snapshot.windows
    .map(
      (window) =>
        `  window ${window.windowId}  name=${window.name}  status=${window.status}  tmux=${window.tmuxWindowId}`,
    )
    .join("\n");
  const panes = snapshot.panes
    .map(
      (pane) =>
        `  pane ${pane.paneId}  kind=${pane.metadata.kind}  status=${pane.status}  tmux=${pane.tmuxPaneId}  window=${pane.windowId}`,
    )
    .join("\n");
  return [
    `workspace ${snapshot.workspace.workspaceId}`,
    `project: ${snapshot.workspace.projectId}`,
    `status: ${snapshot.workspace.status}`,
    `session: ${snapshot.workspace.tmuxSessionName}`,
    `revision: ${snapshot.revision}`,
    "windows:",
    windows.length > 0 ? windows : "  none",
    "panes:",
    panes.length > 0 ? panes : "  none",
  ].join("\n");
};

export const formatTmuxOperationalPaneStatuses = (
  result: TmuxOperationalPaneStatusResult,
  options: { readonly json: boolean },
): string => {
  if (options.json) return formatJson(result);
  if (result.panes.length === 0) {
    return `No operational panes are registered in workspace ${result.workspaceId}.`;
  }
  return result.panes
    .map(
      (pane) =>
        `${pane.paneId}  kind=${pane.kind}  status=${pane.status}  window=${pane.windowId}  stream=${pane.stream.streamId}  updated=${pane.updatedAt}`,
    )
    .join("\n");
};

export const formatTmuxKernelMetadataStorage = (
  snapshot: TmuxKernelMetadataStorageSnapshot,
  options: { readonly json: boolean },
): string => {
  if (options.json) return formatJson(snapshot);
  return [
    "tmux kernel metadata storage",
    `path: ${snapshot.path}`,
    `exists: ${snapshot.exists ? "yes" : "no"}`,
    `bytes: ${snapshot.bytes ?? "n/a"}`,
  ].join("\n");
};

export const formatTmuxKernelRemoteTargets = (
  snapshot: TmuxKernelRemoteTargetsSnapshot,
  options: { readonly json: boolean },
): string => {
  if (options.json) return formatJson(snapshot);
  const hosts =
    snapshot.hosts.length === 0
      ? "  none"
      : snapshot.hosts
          .map(
            (host) =>
              `  host ${host.hostId}  label=${host.label}  transport=${host.transport.type}`,
          )
          .join("\n");
  const connections =
    snapshot.connections.length === 0
      ? "  none"
      : snapshot.connections
          .map(
            (connection) =>
              `  connection ${connection.connectionId}  label=${connection.label}  status=${connection.status}  path=${connection.state.path}`,
          )
          .join("\n");
  return ["remote connection targets", "hosts:", hosts, "connections:", connections].join("\n");
};

interface TmuxKernelListFlags extends CliTmuxKernelAdminFlags, CliTmuxKernelJsonFlag {
  readonly projectId: Option.Option<ProjectId>;
}

interface TmuxKernelWorkspaceFlags extends CliTmuxKernelAdminFlags, CliTmuxKernelJsonFlag {
  readonly workspaceId: TmuxWorkspaceId;
}

interface TmuxKernelLiveWorkspaceFlags extends TmuxKernelWorkspaceFlags, CliTmuxKernelLiveFlags {}

interface TmuxKernelLiveRemoteTargetsFlags
  extends CliAuthLocationFlags, CliTmuxKernelJsonFlag, CliTmuxKernelLiveFlags {}

export interface TmuxKernelOfflineAdminHandlers {
  readonly listWorkspaces: (
    input: Parameters<TmuxWorkspaceServiceShape["listWorkspaces"]>[0],
  ) => Effect.Effect<TmuxWorkspaceListResult, TmuxKernelError | Error>;
  readonly getSnapshot: (
    input: Parameters<TmuxWorkspaceServiceShape["getSnapshot"]>[0],
  ) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError | Error>;
  readonly listOperationalPaneStatuses: (
    input: Parameters<TmuxWorkspaceServiceShape["listOperationalPaneStatuses"]>[0],
  ) => Effect.Effect<TmuxOperationalPaneStatusResult, TmuxKernelError | Error>;
}

export interface TmuxKernelLiveAdminHandlers {
  readonly reconnectWorkspace: (input: {
    readonly target: { readonly serverUrl: URL; readonly bearerToken: string };
    readonly actor: TmuxActor;
    readonly workspaceId: TmuxWorkspaceId;
  }) => Effect.Effect<TmuxWorkspaceSnapshot, TmuxKernelError | Error>;
  readonly listRemoteTargets: (input: {
    readonly target: { readonly serverUrl: URL; readonly bearerToken: string };
  }) => Effect.Effect<TmuxKernelRemoteTargetsSnapshot, Error>;
}

const serviceOfflineHandlers: Effect.Effect<
  TmuxKernelOfflineAdminHandlers,
  never,
  TmuxWorkspaceService
> = Effect.gen(function* () {
  const service = yield* TmuxWorkspaceService;
  return {
    listWorkspaces: (input) => service.listWorkspaces(input),
    getSnapshot: (input) => service.getSnapshot(input),
    listOperationalPaneStatuses: (input) => service.listOperationalPaneStatuses(input),
  };
});

const liveRpcHandlers: TmuxKernelLiveAdminHandlers = {
  reconnectWorkspace: (input) =>
    withLiveWsRpcClient(input.target, (client) =>
      client[WS_METHODS.tmuxWorkspaceReconnect]({
        actor: input.actor,
        workspaceId: input.workspaceId,
      }),
    ).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
  listRemoteTargets: (input) =>
    withLiveWsRpcClient(input.target, (client) =>
      Effect.gen(function* () {
        const hosts = yield* client[WS_METHODS.remoteControllerListHosts]({});
        const connections = yield* client[WS_METHODS.remoteControllerListConnections]({});
        return { hosts, connections };
      }),
    ).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
};

export const runTmuxKernelListAdminHandler = (
  flags: TmuxKernelListFlags,
  handlers: TmuxKernelOfflineAdminHandlers,
) =>
  Effect.gen(function* () {
    const actor = makeTmuxKernelActor(flags);
    const result = yield* handlers.listWorkspaces({
      actor,
      ...(Option.isSome(flags.projectId) ? { projectId: flags.projectId.value } : {}),
    });
    yield* Console.log(formatTmuxWorkspaceList(result, { json: flags.json }));
  });

export const runTmuxKernelInspectAdminHandler = (
  flags: TmuxKernelWorkspaceFlags,
  handlers: TmuxKernelOfflineAdminHandlers,
) =>
  Effect.gen(function* () {
    const snapshot = yield* handlers.getSnapshot({
      actor: makeTmuxKernelActor(flags),
      workspaceId: flags.workspaceId,
    });
    yield* Console.log(formatTmuxWorkspaceSnapshot(snapshot, { json: flags.json }));
  });

export const runTmuxKernelReconnectAdminHandler = (
  flags: TmuxKernelLiveWorkspaceFlags,
  handlers: TmuxKernelLiveAdminHandlers,
) =>
  Effect.gen(function* () {
    const target = yield* resolveRequiredLiveTarget(flags);
    const snapshot = yield* handlers.reconnectWorkspace({
      target,
      actor: makeTmuxKernelActor(flags),
      workspaceId: flags.workspaceId,
    });
    yield* Console.log(formatTmuxWorkspaceSnapshot(snapshot, { json: flags.json }));
  });

export const runTmuxKernelPanesAdminHandler = (
  flags: TmuxKernelWorkspaceFlags,
  handlers: TmuxKernelOfflineAdminHandlers,
) =>
  Effect.gen(function* () {
    const result = yield* handlers.listOperationalPaneStatuses({
      actor: makeTmuxKernelActor(flags),
      workspaceId: flags.workspaceId,
    });
    yield* Console.log(formatTmuxOperationalPaneStatuses(result, { json: flags.json }));
  });

export const runTmuxKernelMetadataAdminHandler = (flags: CliTmuxKernelJsonFlag) =>
  Effect.gen(function* () {
    const snapshot = yield* readTmuxKernelMetadataStorage();
    yield* Console.log(formatTmuxKernelMetadataStorage(snapshot, { json: flags.json }));
  });

export const runTmuxKernelRemoteTargetsAdminHandler = (
  flags: TmuxKernelLiveRemoteTargetsFlags,
  handlers: TmuxKernelLiveAdminHandlers,
) =>
  Effect.gen(function* () {
    const target = yield* resolveRequiredLiveTarget(flags);
    const snapshot = yield* handlers.listRemoteTargets({ target });
    yield* Console.log(formatTmuxKernelRemoteTargets(snapshot, { json: flags.json }));
  });

const commandFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  cwd: Argument.string("cwd").pipe(
    Argument.withDescription(
      "Working directory for provider sessions (defaults to the current directory).",
    ),
    Argument.optional,
  ),
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
} as const;

const authLocationFlags = {
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
} as const;

const ttlFlag = Flag.string("ttl").pipe(
  Flag.withSchema(DurationFromString),
  Flag.withDescription("TTL, for example `5m`, `1h`, `30d`, or `15 minutes`."),
  Flag.optional,
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const tmuxKernelActorSessionIdFlag = Flag.string("actor-session-id").pipe(
  Flag.withSchema(AuthSessionId),
  Flag.withDescription("Explicit tmux-kernel actor session id used for permission checks."),
  Flag.withDefault("auth-session-cli-admin" as AuthSessionId),
);

const tmuxKernelRequiredActorSessionIdFlag = Flag.string("actor-session-id").pipe(
  Flag.withSchema(AuthSessionId),
  Flag.withDescription(
    "Authenticated bearer session id for live tmux-kernel permission checks. Must match the bearer token session.",
  ),
);

const tmuxKernelActorSubjectFlag = Flag.string("actor-subject").pipe(
  Flag.withDescription("Explicit tmux-kernel actor subject used for permission checks."),
  Flag.withDefault("cli-admin"),
);

const tmuxKernelAdminFlags = {
  ...authLocationFlags,
  actorSessionId: tmuxKernelActorSessionIdFlag,
  actorSubject: tmuxKernelActorSubjectFlag,
  json: jsonFlag,
} as const;

const tmuxKernelLiveAdminFlags = {
  ...authLocationFlags,
  actorSessionId: tmuxKernelRequiredActorSessionIdFlag,
  actorSubject: tmuxKernelActorSubjectFlag,
  json: jsonFlag,
} as const;

const serverUrlFlag = Flag.string("server-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Running Fenrir server base URL for live admin commands."),
  Flag.optional,
);

const bearerTokenFlag = Flag.string("bearer-token").pipe(
  Flag.withDescription("Bearer session token used to authenticate live admin commands."),
  Flag.optional,
);

const tmuxKernelLiveFlags = {
  serverUrl: serverUrlFlag,
  bearerToken: bearerTokenFlag,
} as const;

const tmuxWorkspaceIdArgument = Argument.string("workspace-id").pipe(
  Argument.withDescription("Tmux kernel workspace id."),
  Argument.withSchema(TmuxWorkspaceId),
);

const tmuxProjectIdFlag = Flag.string("project-id").pipe(
  Flag.withDescription("Limit tmux kernel workspace listing to a project id."),
  Flag.withSchema(ProjectId),
  Flag.optional,
);

const sessionRoleFlag = Flag.choice("role", ["owner", "client"]).pipe(
  Flag.withDescription("Role for the issued bearer session."),
  Flag.withDefault("owner"),
);

const labelFlag = Flag.string("label").pipe(
  Flag.withDescription("Optional human-readable label."),
  Flag.optional,
);

const subjectFlag = Flag.string("subject").pipe(
  Flag.withDescription("Optional session subject."),
  Flag.optional,
);

const baseUrlFlag = Flag.string("base-url").pipe(
  Flag.withDescription("Optional public base URL used to print a ready `/pair#token=...` link."),
  Flag.optional,
);

const tokenOnlyFlag = Flag.boolean("token-only").pipe(
  Flag.withDescription("Print only the issued bearer token."),
  Flag.withDefault(false),
);

const pairingCreateCommand = Command.make("create", {
  ...authLocationFlags,
  ttl: ttlFlag,
  label: labelFlag,
  baseUrl: baseUrlFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Issue a new client pairing token."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const issued = yield* authControlPlane.createPairingLink({
            role: "client",
            subject: "one-time-token",
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
          });
          const output = formatIssuedPairingCredential(issued, {
            json: flags.json,
            ...(Option.isSome(flags.baseUrl) ? { baseUrl: flags.baseUrl.value } : {}),
          });
          yield* Console.log(output);
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List active client pairing tokens without revealing their secrets."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const pairingLinks = yield* authControlPlane.listPairingLinks({ role: "client" });
          yield* Console.log(formatPairingCredentialList(pairingLinks, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  id: Argument.string("id").pipe(Argument.withDescription("Pairing credential id to revoke.")),
}).pipe(
  Command.withDescription("Revoke an active client pairing token."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(flags, (authControlPlane) =>
      Effect.gen(function* () {
        const revoked = yield* authControlPlane.revokePairingLink(flags.id);
        yield* Console.log(
          revoked
            ? `Revoked pairing credential ${flags.id}.\n`
            : `No active pairing credential found for ${flags.id}.\n`,
        );
      }),
    ),
  ),
);

const pairingCommand = Command.make("pairing").pipe(
  Command.withDescription("Manage one-time client pairing tokens."),
  Command.withSubcommands([pairingCreateCommand, pairingListCommand, pairingRevokeCommand]),
);

const sessionIssueCommand = Command.make("issue", {
  ...authLocationFlags,
  ttl: ttlFlag,
  role: sessionRoleFlag,
  label: labelFlag,
  subject: subjectFlag,
  tokenOnly: tokenOnlyFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Issue a bearer session token for headless or remote clients."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const issued = yield* authControlPlane.issueSession({
            role: flags.role,
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
            ...(Option.isSome(flags.subject) ? { subject: flags.subject.value } : {}),
          });
          yield* Console.log(
            formatIssuedSession(issued, {
              json: flags.json,
              tokenOnly: flags.tokenOnly,
            }),
          );
        }),
      {
        quietLogs: flags.json || flags.tokenOnly,
      },
    ),
  ),
);

const sessionListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List active sessions without revealing bearer tokens."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const sessions = yield* authControlPlane.listSessions();
          yield* Console.log(formatSessionList(sessions, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const sessionRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  sessionId: Argument.string("session-id").pipe(
    Argument.withDescription("Session id to revoke."),
    Argument.withSchema(AuthSessionId),
  ),
}).pipe(
  Command.withDescription("Revoke an active session."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(flags, (authControlPlane) =>
      Effect.gen(function* () {
        const revoked = yield* authControlPlane.revokeSession(flags.sessionId);
        yield* Console.log(
          revoked
            ? `Revoked session ${flags.sessionId}.\n`
            : `No active session found for ${flags.sessionId}.\n`,
        );
      }),
    ),
  ),
);

const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Manage bearer sessions."),
  Command.withSubcommands([sessionIssueCommand, sessionListCommand, sessionRevokeCommand]),
);

const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage the local auth control plane for headless deployments."),
  Command.withSubcommands([pairingCommand, sessionCommand]),
);

const tmuxKernelListCommand = Command.make("list", {
  ...tmuxKernelAdminFlags,
  projectId: tmuxProjectIdFlag,
}).pipe(
  Command.withDescription("List tmux kernel workspaces visible to the explicit actor."),
  Command.withHandler((flags) =>
    runWithTmuxKernelAdmin(
      flags,
      Effect.gen(function* () {
        const handlers = yield* serviceOfflineHandlers;
        yield* runTmuxKernelListAdminHandler(flags, handlers);
      }),
      { quietLogs: flags.json },
    ),
  ),
);

const tmuxKernelInspectCommand = Command.make("inspect", {
  ...tmuxKernelAdminFlags,
  workspaceId: tmuxWorkspaceIdArgument,
}).pipe(
  Command.withDescription("Inspect a tmux kernel workspace snapshot, including windows and panes."),
  Command.withHandler((flags) =>
    runWithTmuxKernelAdmin(
      flags,
      Effect.gen(function* () {
        const handlers = yield* serviceOfflineHandlers;
        yield* runTmuxKernelInspectAdminHandler(flags, handlers);
      }),
      { quietLogs: flags.json },
    ),
  ),
);

const tmuxKernelReconnectCommand = Command.make("reconnect", {
  ...tmuxKernelLiveAdminFlags,
  ...tmuxKernelLiveFlags,
  workspaceId: tmuxWorkspaceIdArgument,
}).pipe(
  Command.withDescription("Reconnect and reconcile a live server-owned tmux kernel workspace."),
  Command.withHandler((flags) => runTmuxKernelReconnectAdminHandler(flags, liveRpcHandlers)),
);

const tmuxKernelPanesCommand = Command.make("panes", {
  ...tmuxKernelAdminFlags,
  workspaceId: tmuxWorkspaceIdArgument,
}).pipe(
  Command.withDescription("List registered operational pane metadata and lifecycle status."),
  Command.withHandler((flags) =>
    runWithTmuxKernelAdmin(
      flags,
      Effect.gen(function* () {
        const handlers = yield* serviceOfflineHandlers;
        yield* runTmuxKernelPanesAdminHandler(flags, handlers);
      }),
      { quietLogs: flags.json },
    ),
  ),
);

const tmuxKernelMetadataCommand = Command.make("metadata", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show tmux kernel metadata storage location and file state."),
  Command.withHandler((flags) =>
    runWithTmuxKernelAdmin(
      {
        ...flags,
        actorSessionId: "auth-session-cli-admin" as AuthSessionId,
        actorSubject: "cli-admin",
      },
      runTmuxKernelMetadataAdminHandler(flags),
      { quietLogs: flags.json },
    ),
  ),
);

const tmuxKernelRemoteTargetsCommand = Command.make("remote-targets", {
  ...authLocationFlags,
  ...tmuxKernelLiveFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List remote host and connection targets from a live Fenrir server."),
  Command.withHandler((flags) => runTmuxKernelRemoteTargetsAdminHandler(flags, liveRpcHandlers)),
);

const tmuxKernelCommand = Command.make("tmux-kernel").pipe(
  Command.withDescription("Inspect and administer tmux session-kernel state."),
  Command.withSubcommands([
    tmuxKernelListCommand,
    tmuxKernelInspectCommand,
    tmuxKernelReconnectCommand,
    tmuxKernelPanesCommand,
    tmuxKernelMetadataCommand,
    tmuxKernelRemoteTargetsCommand,
  ]),
);

const startCommand = Command.make("start", commandFlags).pipe(
  Command.withDescription("Run the Fenrir server."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveServerConfig(flags, logLevel);
      return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
    }),
  ),
);

export const cli = Command.make("t3", commandFlags).pipe(
  Command.withDescription("Run the Fenrir server."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveServerConfig(flags, logLevel);
      return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
    }),
  ),
  Command.withSubcommands([startCommand, authCommand, tmuxKernelCommand]),
);
