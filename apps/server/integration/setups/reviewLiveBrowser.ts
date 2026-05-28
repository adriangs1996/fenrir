import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
  type ClientOrchestrationCommand,
} from "@fenrir/contracts";
import { Effect, Exit, FileSystem, Layer, Path, Schema, Scope } from "effect";
import { HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { ServerConfig as ServerConfigTag } from "../../src/config";
import { makeServerApplicationLayer } from "../../src/server";
import { makeRealServerConfig } from "./realServer";

interface ReviewLiveWorkspace {
  readonly rootDir: string;
  readonly repoDir: string;
}

interface ReviewLiveScenario {
  readonly branchName: string;
  readonly chunkFilePath: string;
  readonly chunkTopChangeText: string;
}

interface ReviewLiveServerHandle {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly dispose: Effect.Effect<void, never>;
}

interface ReviewLiveAuthSession {
  readonly sessionCookieHeader: string;
  readonly wsUrl: string;
}

interface ReviewLiveThreadHandle {
  readonly projectId: string;
  readonly threadId: string;
}

export interface ReviewLiveBrowserEnvironment {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly bootstrapToken: string;
  readonly expectedFilePath: string;
  readonly expectedChunkText: string;
}

class ReviewLiveCommandError extends Schema.TaggedErrorClass<ReviewLiveCommandError>()(
  "ReviewLiveCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

function runGit(
  cwd: string,
  args: readonly string[],
): Effect.Effect<string, ReviewLiveCommandError> {
  return Effect.try({
    try: () =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    catch: (cause) =>
      new ReviewLiveCommandError({
        operation: `git ${args.join(" ")}`,
        message: `git ${args.join(" ")} failed`,
        cause,
      }),
  });
}

function appendSessionCookieToWsUrl(url: string, sessionCookieHeader: string): string {
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
  const next = new URL(url, "http://localhost");
  next.hash = `cookie=${encodeURIComponent(sessionCookieHeader)}`;
  return isAbsoluteUrl ? next.toString() : `${next.pathname}${next.search}${next.hash}`;
}

function writeRepoFile(repoDir: string, relativePath: string, contents: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(repoDir, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), {
      recursive: true,
    });
    yield* fileSystem.writeFileString(absolutePath, contents);
  });
}

function removeRepoFile(repoDir: string, relativePath: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(repoDir, relativePath));
  });
}

const createReviewLiveWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = yield* fileSystem.makeTempDirectory({
    prefix: "fenrir-review-live-browser-",
  });
  const repoDir = path.join(rootDir, "repo");
  yield* fileSystem.makeDirectory(repoDir, { recursive: true });
  return {
    rootDir,
    repoDir,
  } satisfies ReviewLiveWorkspace;
});

function initializeGitRepository(repoDir: string) {
  return Effect.gen(function* () {
    yield* runGit(repoDir, ["init", "--initial-branch=main"]);
    yield* runGit(repoDir, ["config", "user.email", "review-e2e@example.com"]);
    yield* runGit(repoDir, ["config", "user.name", "Review E2E"]);

    yield* writeRepoFile(
      repoDir,
      ".gitignore",
      ["node_modules/", ".fenrir/", "ignored-artifacts/", ""].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      "src/committed-only.ts",
      ["export function committedOnly(): string {", '  return "before";', "}", ""].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      "src/staged-only.ts",
      ["export function stagedOnly(): string {", '  return "before";', "}", ""].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      "src/unstaged-only.ts",
      ["export function unstagedOnly(): string {", '  return "before";', "}", ""].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      "src/chunk-target.ts",
      [
        "export const chunkLines = [",
        '  "line-01",',
        '  "line-02",',
        '  "line-03",',
        '  "line-04",',
        '  "line-05",',
        '  "line-06",',
        '  "line-07",',
        '  "line-08",',
        '  "line-09",',
        '  "line-10",',
        '  "line-11",',
        '  "line-12",',
        '  "line-13",',
        "];",
        "",
      ].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      "src/deleted-unstaged.ts",
      ["export function deletedUnstaged(): string {", '  return "delete me";', "}", ""].join("\n"),
    );

    yield* runGit(repoDir, ["add", "."]);
    yield* runGit(repoDir, ["commit", "-m", "Initial review fixture"]);
  });
}

function seedReviewScenario(repoDir: string) {
  return Effect.gen(function* () {
    const branchName = "feature/review-live-browser";
    const chunkFilePath = "src/chunk-target.ts";
    const chunkTopChangeText = '"TOP CHUNK CHANGE"';
    const chunkBottomChangeText = '"BOTTOM CHUNK CHANGE"';

    yield* runGit(repoDir, ["checkout", "-b", branchName]);

    yield* writeRepoFile(
      repoDir,
      "src/committed-only.ts",
      [
        "export function committedOnly(): string {",
        '  return "after committed change";',
        "}",
        "",
      ].join("\n"),
    );
    yield* runGit(repoDir, ["add", "src/committed-only.ts"]);
    yield* runGit(repoDir, ["commit", "-m", "Committed review change"]);

    yield* writeRepoFile(
      repoDir,
      "src/staged-only.ts",
      ["export function stagedOnly(): string {", '  return "after staged change";', "}", ""].join(
        "\n",
      ),
    );
    yield* runGit(repoDir, ["add", "src/staged-only.ts"]);

    yield* writeRepoFile(
      repoDir,
      "src/staged-added.ts",
      [
        "export function stagedAdded(): string {",
        '  return "brand new staged file";',
        "}",
        "",
      ].join("\n"),
    );
    yield* runGit(repoDir, ["add", "src/staged-added.ts"]);

    yield* writeRepoFile(
      repoDir,
      "src/unstaged-only.ts",
      [
        "export function unstagedOnly(): string {",
        '  return "after unstaged change";',
        "}",
        "",
      ].join("\n"),
    );
    yield* writeRepoFile(
      repoDir,
      chunkFilePath,
      [
        "export const chunkLines = [",
        `  ${chunkTopChangeText},`,
        '  "line-02",',
        '  "line-03",',
        '  "line-04",',
        '  "line-05",',
        '  "line-06",',
        '  "line-07",',
        '  "line-08",',
        '  "line-09",',
        '  "line-10",',
        '  "line-11",',
        `  ${chunkBottomChangeText},`,
        '  "line-13",',
        "];",
        "",
      ].join("\n"),
    );

    yield* removeRepoFile(repoDir, "src/deleted-unstaged.ts");
    yield* writeRepoFile(repoDir, "ignored-artifacts/debug.log", "ignored runtime artifact\n");

    return {
      branchName,
      chunkFilePath,
      chunkTopChangeText,
    } satisfies ReviewLiveScenario;
  });
}

function startFenrirServerForReviewScenario(workspace: ReviewLiveWorkspace) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const scope = yield* Scope.make();

    const baseDir = yield* fileSystem
      .makeTempDirectoryScoped({
        prefix: "fenrir-review-server-",
      })
      .pipe(Scope.provide(scope));

    const config = yield* makeRealServerConfig({
      cwd: workspace.repoDir,
      baseDir,
    });

    const serverContext = yield* Layer.build(
      makeServerApplicationLayer.pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(Layer.succeed(ServerConfigTag, config)),
      ),
    ).pipe(Scope.provide(scope));

    const server = yield* Effect.gen(function* () {
      return yield* HttpServer.HttpServer;
    }).pipe(Effect.provide(serverContext));
    const address = server.address as HttpServer.TcpAddress;

    return {
      httpBaseUrl: `http://127.0.0.1:${address.port}`,
      wsBaseUrl: `ws://127.0.0.1:${address.port}/ws`,
      dispose: Scope.close(scope, Exit.void),
    } satisfies ReviewLiveServerHandle;
  });
}

function withFenrirServer<A, E, R>(
  workspace: ReviewLiveWorkspace,
  use: (server: ReviewLiveServerHandle) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    startFenrirServerForReviewScenario(workspace),
    use,
    function disposeServer(server): Effect.Effect<void, never> {
      return server.dispose;
    },
  );
}

function bootstrapAuthenticatedSession(server: ReviewLiveServerHandle) {
  const defaultDesktopBootstrapToken = "test-desktop-bootstrap-token";

  return Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      fetch(`${server.httpBaseUrl}/api/auth/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential: defaultDesktopBootstrapToken,
        }),
      }),
    );

    if (!response.ok) {
      return yield* Effect.fail(new Error(`Bootstrap failed with status ${response.status}.`));
    }

    const sessionCookieHeader = response.headers.get("set-cookie");
    if (!sessionCookieHeader) {
      return yield* Effect.fail(new Error("Expected a bootstrapped session cookie."));
    }

    return {
      sessionCookieHeader,
      wsUrl: appendSessionCookieToWsUrl(server.wsBaseUrl, sessionCookieHeader),
    } satisfies ReviewLiveAuthSession;
  });
}

function createBrowserPairingCredential(
  server: ReviewLiveServerHandle,
  session: ReviewLiveAuthSession,
) {
  return Effect.gen(function* () {
    const sessionCookie = session.sessionCookieHeader.split(";")[0] ?? session.sessionCookieHeader;
    const response = yield* Effect.promise(() =>
      fetch(`${server.httpBaseUrl}/api/auth/pairing-token`, {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Pairing credential bootstrap failed with status ${response.status}.`),
      );
    }

    const body = (yield* Effect.promise(() => response.json())) as {
      readonly credential?: string;
    };

    if (!body.credential || body.credential.length === 0) {
      return yield* Effect.fail(
        new Error("Pairing credential response was missing its credential."),
      );
    }

    return body.credential;
  });
}

type ParsedCookieSession = {
  readonly cookie: string | null;
  readonly url: string;
};

function parseSessionCookieFromWsUrl(wsUrl: string): ParsedCookieSession {
  const next = new URL(wsUrl);
  const cookie = next.hash.startsWith("#cookie=")
    ? decodeURIComponent(next.hash.slice("#cookie=".length))
    : null;
  next.hash = "";
  return {
    cookie,
    url: next.toString(),
  };
}

function wsRpcProtocolLayer(wsUrl: string) {
  const { cookie, url } = parseSessionCookieFromWsUrl(wsUrl);
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    function createWebSocket(
      socketUrl: string,
      protocols?: string | string[],
    ): globalThis.WebSocket {
      return new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols,
        cookie ? { headers: { cookie } } : undefined,
      ) as unknown as globalThis.WebSocket;
    },
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
}

const makeWsRpcClient = RpcClient.make(WsRpcGroup);
type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

function withWsRpcClient<A, E, R>(
  wsUrl: string,
  f: (client: WsRpcClient) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.scoped(
    makeWsRpcClient.pipe(Effect.flatMap(f), Effect.provide(wsRpcProtocolLayer(wsUrl))),
  );
}

function dispatchOrchestrationCommand(
  session: ReviewLiveAuthSession,
  command: ClientOrchestrationCommand,
) {
  return withWsRpcClient(session.wsUrl, (client) =>
    client[ORCHESTRATION_WS_METHODS.dispatchCommand](command),
  );
}

function getBootstrapSnapshot(session: ReviewLiveAuthSession) {
  return withWsRpcClient(session.wsUrl, (client) =>
    client[ORCHESTRATION_WS_METHODS.getBootstrapSnapshot]({}),
  );
}

function getServerConfig(session: ReviewLiveAuthSession) {
  return withWsRpcClient(session.wsUrl, (client) => client[WS_METHODS.serverGetConfig]({}));
}

function waitForProjectedThread(session: ReviewLiveAuthSession, threadId: string) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 10_000;

    while (true) {
      const snapshot = yield* getBootstrapSnapshot(session);
      const projectedThread = snapshot.threads.find((thread) => thread.id === threadId) ?? null;

      if (projectedThread) {
        return;
      }

      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error(`Timed out waiting for projected thread ${threadId}.`));
      }

      yield* Effect.sleep("50 millis");
    }
  });
}

function createProjectAndThreadForRepo(
  session: ReviewLiveAuthSession,
  workspace: ReviewLiveWorkspace,
  scenario: ReviewLiveScenario,
) {
  return Effect.gen(function* () {
    const provider = "codex";
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    const idSuffix = randomUUID();
    const projectId = ProjectId.make(`review-live-project-${idSuffix}`);
    const threadId = ThreadId.make(`review-live-thread-${idSuffix}`);
    const createdAt = new Date().toISOString();

    yield* dispatchOrchestrationCommand(session, {
      type: "project.create",
      commandId: CommandId.make(`cmd-review-live-project-create-${idSuffix}`),
      projectId,
      title: "Review Live Browser Project",
      workspaceRoot: workspace.repoDir,
      defaultModelSelection: {
        provider,
        model: defaultModel,
      },
      createdAt,
    });

    yield* dispatchOrchestrationCommand(session, {
      type: "thread.create",
      commandId: CommandId.make(`cmd-review-live-thread-create-${idSuffix}`),
      threadId,
      projectId,
      title: "Review Live Browser Thread",
      modelSelection: {
        provider,
        model: defaultModel,
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: scenario.branchName,
      worktreePath: workspace.repoDir,
      createdAt,
    });

    yield* waitForProjectedThread(session, threadId);

    return {
      projectId,
      threadId,
    } satisfies ReviewLiveThreadHandle;
  });
}

const makePreparedWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const workspace = yield* createReviewLiveWorkspace;
  yield* initializeGitRepository(workspace.repoDir);
  const scenario = yield* seedReviewScenario(workspace.repoDir);
  return {
    workspace,
    scenario,
    dispose: fileSystem
      .remove(workspace.rootDir, {
        recursive: true,
        force: true,
      })
      .pipe(Effect.catch(() => Effect.void)),
  } as const;
});

function withPreparedWorkspace<A, E, R>(
  use: (preparedWorkspace: {
    readonly workspace: ReviewLiveWorkspace;
    readonly scenario: ReviewLiveScenario;
    readonly dispose: Effect.Effect<void>;
  }) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    makePreparedWorkspace,
    use,
    function disposePreparedWorkspace(preparedWorkspace): Effect.Effect<void> {
      return preparedWorkspace.dispose;
    },
  );
}

export function withLiveReviewBrowserEnvironment<A, E, R>(
  use: (environment: ReviewLiveBrowserEnvironment) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return withPreparedWorkspace(({ workspace, scenario }) =>
    withFenrirServer(workspace, (server) =>
      Effect.gen(function* () {
        const session = yield* bootstrapAuthenticatedSession(server);
        const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
        const serverConfig = yield* getServerConfig(session);
        const browserBootstrapCredential = yield* createBrowserPairingCredential(server, session);

        return yield* use({
          httpBaseUrl: server.httpBaseUrl,
          wsBaseUrl: server.wsBaseUrl,
          environmentId: serverConfig.environment.environmentId,
          threadId: thread.threadId,
          bootstrapToken: browserBootstrapCredential,
          expectedFilePath: scenario.chunkFilePath,
          expectedChunkText: scenario.chunkTopChangeText.replaceAll('"', ""),
        });
      }).pipe(
        Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
      ),
    ),
  );
}
