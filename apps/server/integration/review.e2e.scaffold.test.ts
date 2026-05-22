import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type ClientOrchestrationCommand,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@fenrir/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Path, Schema, Scope } from "effect";
import { HttpServer } from "effect/unstable/http";
import { makeServerApplicationLayer } from "../src/server";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { ServerConfig } from "../src/config";
import { makeRealServerConfig } from "./setups/realServer";

interface ReviewE2eWorkspace {
  readonly rootDir: string;
  readonly repoDir: string;
}

interface ReviewE2ePreparedWorkspace {
  readonly workspace: ReviewE2eWorkspace;
  readonly scenario: ReviewE2eScenario;
  readonly dispose: Effect.Effect<void>;
}

interface ReviewE2eScenario {
  readonly branchName: string;
  readonly baseRef: string;
  readonly committedFilePath: string;
  readonly stagedFilePath: string;
  readonly unstagedFilePath: string;
  readonly ignoredFilePath: string;
}

interface ReviewE2eServerHandle {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly dispose: Effect.Effect<void, never>;
}

interface ReviewE2eAuthSession {
  readonly sessionCookieHeader: string;
  readonly wsUrl: string;
}

interface ReviewE2eThreadHandle {
  readonly projectId: string;
  readonly threadId: string;
}

interface ReviewE2eSuiteHandle {
  readonly workspace: ReviewE2eWorkspace;
  readonly scenario: ReviewE2eScenario;
  readonly server: ReviewE2eServerHandle;
  readonly session: ReviewE2eAuthSession;
}

class ReviewE2eCommandError extends Schema.TaggedErrorClass<ReviewE2eCommandError>()(
  "ReviewE2eCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

function runGit(cwd: string, args: readonly string[]) {
  return Effect.try({
    try: () =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    catch: (cause) =>
      new ReviewE2eCommandError({
        operation: `git ${args.join(" ")}`,
        message: `git ${args.join(" ")} failed`,
        cause,
      }),
  });
}

function appendSessionCookieToWsUrl(url: string, sessionCookieHeader: string) {
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

const createReviewE2eWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = yield* fileSystem.makeTempDirectory({
    prefix: "fenrir-review-e2e-",
  });
  const repoDir = path.join(rootDir, "repo");
  yield* fileSystem.makeDirectory(repoDir, { recursive: true });
  return {
    rootDir,
    repoDir,
  } satisfies ReviewE2eWorkspace;
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

    yield* runGit(repoDir, ["add", "."]);
    yield* runGit(repoDir, ["commit", "-m", "Initial review fixture"]);
  });
}

function seedReviewScenario(repoDir: string) {
  return Effect.gen(function* () {
    const branchName = "feature/review-e2e";
    const committedFilePath = "src/committed-only.ts";
    const stagedFilePath = "src/staged-only.ts";
    const unstagedFilePath = "src/unstaged-only.ts";
    const ignoredFilePath = "ignored-artifacts/debug.log";

    yield* runGit(repoDir, ["checkout", "-b", branchName]);

    yield* writeRepoFile(
      repoDir,
      committedFilePath,
      [
        "export function committedOnly(): string {",
        '  return "after committed change";',
        "}",
        "",
      ].join("\n"),
    );
    yield* runGit(repoDir, ["add", committedFilePath]);
    yield* runGit(repoDir, ["commit", "-m", "Committed review change"]);

    yield* writeRepoFile(
      repoDir,
      stagedFilePath,
      ["export function stagedOnly(): string {", '  return "after staged change";', "}", ""].join(
        "\n",
      ),
    );
    yield* runGit(repoDir, ["add", stagedFilePath]);

    yield* writeRepoFile(
      repoDir,
      unstagedFilePath,
      [
        "export function unstagedOnly(): string {",
        '  return "after unstaged change";',
        "}",
        "",
      ].join("\n"),
    );

    yield* writeRepoFile(repoDir, ignoredFilePath, "ignored runtime artifact\n");

    return {
      branchName,
      baseRef: "main",
      committedFilePath,
      stagedFilePath,
      unstagedFilePath,
      ignoredFilePath,
    } satisfies ReviewE2eScenario;
  });
}

function startFenrirServerForReviewScenario(workspace: ReviewE2eWorkspace) {
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
        Layer.provide(Layer.succeed(ServerConfig, config)),
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
    } satisfies ReviewE2eServerHandle;
  });
}

function withFenrirServer<A, E, R>(
  workspace: ReviewE2eWorkspace,
  use: (server: ReviewE2eServerHandle) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    startFenrirServerForReviewScenario(workspace),
    use,
    (server) => server.dispose,
  );
}

function bootstrapAuthenticatedSession(server: ReviewE2eServerHandle) {
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

    assert.equal(response.ok, true);

    const sessionCookieHeader = response.headers.get("set-cookie");
    if (!sessionCookieHeader) {
      return yield* Effect.fail(new Error("Expected a boostraped session cookie"));
    }

    return {
      sessionCookieHeader,
      wsUrl: appendSessionCookieToWsUrl(server.wsBaseUrl, sessionCookieHeader),
    } satisfies ReviewE2eAuthSession;
  });
}

function createProjectAndThreadForRepo(
  session: ReviewE2eAuthSession,
  workspace: ReviewE2eWorkspace,
  scenario: ReviewE2eScenario,
) {
  return Effect.gen(function* () {
    const provider = "codex";
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    const idSuffix = randomUUID();
    const projectId = ProjectId.makeUnsafe(`review-e2e-project-${idSuffix}`);
    const threadId = ThreadId.makeUnsafe(`review-e2e-thread-${idSuffix}`);
    const createdAt = new Date().toISOString();

    yield* dispatchOrchestrationCommand(session, {
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-review-e2e-project-create-${idSuffix}`),
      projectId,
      title: "Review E2E Project",
      workspaceRoot: workspace.repoDir,
      defaultModelSelection: {
        provider,
        model: defaultModel,
      },
      createdAt,
    });

    yield* dispatchOrchestrationCommand(session, {
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-review-e2e-thread-create-${idSuffix}`),
      threadId,
      projectId,
      title: "Review E2E Thread",
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
    } satisfies ReviewE2eThreadHandle;
  });
}

function callWsRpcMethod<T>(session: ReviewE2eAuthSession, method: string, input: unknown) {
  return withWsRpcClient(session.wsUrl, (client) =>
    (
      client as unknown as Record<
        string,
        ((value: unknown) => Effect.Effect<T, Error, never>) | undefined
      >
    )[method]!(input),
  );
}

const makePreparedWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const workspace = yield* createReviewE2eWorkspace;
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
  } satisfies ReviewE2ePreparedWorkspace;
});

function withPreparedWorkspace<A, E, R>(
  use: (preparedWorkspace: ReviewE2ePreparedWorkspace) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    makePreparedWorkspace,
    use,
    (preparedWorkspace) => preparedWorkspace.dispose,
  );
}

function withReviewE2eSuite<A, E, R>(use: (suite: ReviewE2eSuiteHandle) => Effect.Effect<A, E, R>) {
  return withPreparedWorkspace(({ workspace, scenario }) =>
    withFenrirServer(workspace, (server) =>
      Effect.gen(function* () {
        const session = yield* bootstrapAuthenticatedSession(server);
        return yield* use({
          workspace,
          scenario,
          server,
          session,
        });
      }),
    ),
  );
}

type ParsedCookieSession = {
  readonly cookie: string | null;
  readonly url: string;
};

const parseSessionCookieFromWsUrl = (wsUrl: string): ParsedCookieSession => {
  const next = new URL(wsUrl);
  const cookie = next.hash.startsWith("#cookie=")
    ? decodeURIComponent(next.hash.slice("#cookie=".length))
    : null;
  next.hash = "";
  return {
    cookie,
    url: next.toString(),
  };
};

const wsRpcProtocolLayer = (wsUrl: string) => {
  const { cookie, url } = parseSessionCookieFromWsUrl(wsUrl);
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) =>
      new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols,
        cookie ? { headers: { cookie } } : undefined,
      ) as unknown as globalThis.WebSocket,
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const makeWsRpcClient = RpcClient.make(WsRpcGroup);
type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

const withWsRpcClient = <A, E, R>(
  wsUrl: string,
  f: (client: WsRpcClient) => Effect.Effect<A, E, R>,
) => makeWsRpcClient.pipe(Effect.flatMap(f), Effect.provide(wsRpcProtocolLayer(wsUrl)));

function dispatchOrchestrationCommand(
  session: ReviewE2eAuthSession,
  command: ClientOrchestrationCommand,
) {
  return withWsRpcClient(session.wsUrl, (client) =>
    client[ORCHESTRATION_WS_METHODS.dispatchCommand](command),
  );
}

function getBootstrapSnapshot(session: ReviewE2eAuthSession) {
  return withWsRpcClient(session.wsUrl, (client) =>
    client[ORCHESTRATION_WS_METHODS.getBootstrapSnapshot]({}),
  );
}

function waitForProjectedThread(session: ReviewE2eAuthSession, threadId: string) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 10_000;

    while (true) {
      const snapshot = yield* getBootstrapSnapshot(session);
      const projectedThread = snapshot.threads.find((thread) => thread.id === threadId) ?? null;

      if (projectedThread) {
        return projectedThread;
      }

      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error(`Timed out waiting for projected thread ${threadId}`));
      }

      yield* Effect.sleep("50 millis");
    }
  });
}

it.live("bootstraps a real authenticated websocket session", () =>
  withReviewE2eSuite(({ session, server }) =>
    Effect.gen(function* () {
      const sessionProbe = yield* Effect.promise(() =>
        fetch(`${server.httpBaseUrl}/api/auth/session`, {
          redirect: "manual",
        }),
      );

      assert.equal(sessionProbe.status === 200 || sessionProbe.status === 401, true);
      assert.equal(session.wsUrl.startsWith("ws://127.0.0.1:"), true);

      const config = yield* withWsRpcClient(session.wsUrl, (client) =>
        client[WS_METHODS.serverGetConfig]({}),
      );

      assert.equal(config.environment.label.length > 0, true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("creates a real project and thread through orchestration rpc", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);

      const bootstrapSnapshot = yield* getBootstrapSnapshot(session);
      const projectedProject =
        bootstrapSnapshot.projects.find((project) => project.id === thread.projectId) ?? null;
      const projectedThread =
        bootstrapSnapshot.threads.find((entry) => entry.id === thread.threadId) ?? null;

      assert.equal(projectedProject !== null, true);
      assert.equal(projectedThread !== null, true);

      if (projectedProject) {
        assert.equal(projectedProject.workspaceRoot, workspace.repoDir);
      }

      if (projectedThread) {
        assert.equal(projectedThread.projectId, thread.projectId);
        assert.equal(projectedThread.branch, scenario.branchName);
        assert.equal(projectedThread.worktreePath, workspace.repoDir);
      }

      const projectedThreadSnapshot = yield* callWsRpcMethod<{
        readonly id: string;
        readonly projectId: string;
        readonly branch: string | null;
        readonly worktreePath: string | null;
      } | null>(session, ORCHESTRATION_WS_METHODS.getThreadSnapshot, {
        threadId: thread.threadId,
      });

      assert.equal(projectedThreadSnapshot !== null, true);

      if (projectedThreadSnapshot) {
        assert.equal(projectedThreadSnapshot.projectId, thread.projectId);
        assert.equal(projectedThreadSnapshot.branch, scenario.branchName);
        assert.equal(projectedThreadSnapshot.worktreePath, workspace.repoDir);
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
