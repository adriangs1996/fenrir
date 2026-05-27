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
  type ReviewDiffFileEntry,
  type ReviewDiffFilePatch,
  type ReviewDiffSnapshot,
  type ReviewChunkPayload,
  type ReviewApplyRawMutationResult,
  type ReviewLocalAnnotationThread,
  type ReviewRawLaneKind,
  type ReviewSessionSnapshot,
  type ReviewSessionSummary,
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
  readonly stagedAddedFilePath: string;
  readonly chunkFilePath: string;
  readonly chunkTopChangeText: string;
  readonly chunkBottomChangeText: string;
  readonly unstagedFilePath: string;
  readonly unstagedDeletedFilePath: string;
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

function normalizeWorkspacePath(pathValue: string | null | undefined) {
  if (!pathValue) {
    return pathValue ?? null;
  }
  return pathValue.replace(/^\/private(?=\/(?:tmp|var)(?:\/|$))/, "");
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
    const branchName = "feature/review-e2e";
    const committedFilePath = "src/committed-only.ts";
    const stagedFilePath = "src/staged-only.ts";
    const stagedAddedFilePath = "src/staged-added.ts";
    const chunkFilePath = "src/chunk-target.ts";
    const chunkTopChangeText = '"TOP CHUNK CHANGE"';
    const chunkBottomChangeText = '"BOTTOM CHUNK CHANGE"';
    const unstagedFilePath = "src/unstaged-only.ts";
    const unstagedDeletedFilePath = "src/deleted-unstaged.ts";
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
      stagedAddedFilePath,
      [
        "export function stagedAdded(): string {",
        '  return "brand new staged file";',
        "}",
        "",
      ].join("\n"),
    );
    yield* runGit(repoDir, ["add", stagedAddedFilePath]);

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

    yield* removeRepoFile(repoDir, unstagedDeletedFilePath);

    yield* writeRepoFile(repoDir, ignoredFilePath, "ignored runtime artifact\n");

    return {
      branchName,
      baseRef: "main",
      committedFilePath,
      stagedFilePath,
      stagedAddedFilePath,
      chunkFilePath,
      chunkTopChangeText,
      chunkBottomChangeText,
      unstagedFilePath,
      unstagedDeletedFilePath,
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

function getOrCreateReviewSession(session: ReviewE2eAuthSession, threadId: string) {
  return callWsRpcMethod<ReviewSessionSummary>(session, WS_METHODS.reviewGetOrCreateSession, {
    threadId,
    mode: "raw",
    scope: "combined",
  });
}

function getReviewSessionSnapshot(session: ReviewE2eAuthSession, sessionId: string) {
  return callWsRpcMethod<ReviewSessionSnapshot>(session, WS_METHODS.reviewGetSessionSnapshot, {
    sessionId,
  });
}

function getReviewDiffSnapshot(session: ReviewE2eAuthSession, sessionId: string) {
  return callWsRpcMethod<ReviewDiffSnapshot>(session, WS_METHODS.reviewGetDiffSnapshot, {
    sessionId,
  });
}

function getReviewFilePatch(
  session: ReviewE2eAuthSession,
  sessionId: string,
  lane: ReviewRawLaneKind,
  normalizedPath: string,
) {
  return callWsRpcMethod<ReviewDiffFilePatch | null>(session, WS_METHODS.reviewGetFilePatch, {
    sessionId,
    lane,
    normalizedPath,
  });
}

function getReviewChunkPayload(
  session: ReviewE2eAuthSession,
  sessionId: string,
  lane: ReviewRawLaneKind,
  normalizedPath: string,
  chunkId: string,
) {
  return callWsRpcMethod<ReviewChunkPayload | null>(session, WS_METHODS.reviewGetChunkPayload, {
    sessionId,
    lane,
    normalizedPath,
    chunkId,
  });
}

function applyRawChunkMutation(
  session: ReviewE2eAuthSession,
  sessionId: string,
  action: "stage" | "unstage" | "undo",
  lane: ReviewRawLaneKind,
  normalizedPath: string,
  chunkId: string,
) {
  return callWsRpcMethod<ReviewApplyRawMutationResult>(session, WS_METHODS.reviewApplyRawMutation, {
    sessionId,
    action,
    target: {
      targetKind: "chunk",
      lane,
      normalizedPath,
      chunkId,
    },
  });
}

function createChunkComment(
  session: ReviewE2eAuthSession,
  sessionId: string,
  patch: ReviewDiffFilePatch,
  chunkId: string,
  body: string,
) {
  const chunk = patch.chunks.find((candidate) => candidate.chunkId === chunkId) ?? null;
  if (!chunk) {
    return Effect.fail(new Error(`Chunk ${chunkId} not found in patch ${patch.normalizedPath}`));
  }

  return callWsRpcMethod<ReviewLocalAnnotationThread>(session, WS_METHODS.reviewCreateLocalThread, {
    sessionId,
    groupId: patch.groupId,
    fileId: patch.fileId,
    chunkId,
    anchor: chunk.anchor,
    body,
    author: {
      authSessionId: "review-e2e-user",
      subject: "Review E2E User",
      role: "user",
    },
  });
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

function findLaneFile(
  snapshot: ReviewDiffSnapshot,
  lane: ReviewRawLaneKind,
  normalizedPath: string,
): ReviewDiffFileEntry | null {
  return (
    snapshot.lanes
      .find((entry) => entry.kind === lane)
      ?.files.find((file) => file.normalizedPath === normalizedPath) ?? null
  );
}

function requireFilePatchChunk(patch: ReviewDiffFilePatch | null, chunkIndex = 0) {
  assert.equal(patch !== null, true);
  if (!patch) {
    throw new Error("Expected a review file patch.");
  }

  const chunk = patch.chunks[chunkIndex] ?? null;
  assert.equal(chunk !== null, true);
  if (!chunk) {
    throw new Error(`Expected chunk index ${chunkIndex} in patch ${patch.normalizedPath}.`);
  }

  return chunk;
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
        assert.equal(
          normalizeWorkspacePath(projectedThread.worktreePath),
          normalizeWorkspacePath(workspace.repoDir),
        );
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
        assert.equal(
          normalizeWorkspacePath(projectedThreadSnapshot.worktreePath),
          normalizeWorkspacePath(workspace.repoDir),
        );
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("hydrates a real review session and exposes mixed diff lanes", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const reviewSnapshot = yield* getReviewSessionSnapshot(session, reviewSession.id);
      const diffSnapshot = yield* getReviewDiffSnapshot(session, reviewSession.id);

      assert.equal(reviewSession.mode, "raw");
      assert.equal(reviewSession.scope, "combined");
      assert.equal(reviewSession.target.threadId, thread.threadId);
      assert.equal(
        normalizeWorkspacePath(reviewSession.target.worktreePath),
        normalizeWorkspacePath(workspace.repoDir),
      );
      assert.equal(reviewSession.degradedReasons.includes("diff-unavailable"), false);
      assert.equal(reviewSnapshot.summary.id, reviewSession.id);

      assert.equal(
        reviewSnapshot.files.some((file) => file.normalizedPath === scenario.committedFilePath),
        true,
      );
      assert.equal(
        reviewSnapshot.files.some((file) => file.normalizedPath === scenario.stagedFilePath),
        true,
      );
      assert.equal(
        reviewSnapshot.files.some((file) => file.normalizedPath === scenario.stagedAddedFilePath),
        true,
      );
      assert.equal(
        reviewSnapshot.files.some((file) => file.normalizedPath === scenario.unstagedFilePath),
        true,
      );
      assert.equal(
        reviewSnapshot.files.some(
          (file) => file.normalizedPath === scenario.unstagedDeletedFilePath,
        ),
        true,
      );
      assert.equal(
        reviewSnapshot.files.some((file) => file.normalizedPath === scenario.ignoredFilePath),
        true,
      );

      assert.equal(
        diffSnapshot.lanes.some((lane) => lane.kind === "ignored"),
        true,
      );
      assert.equal(
        diffSnapshot.lanes.some((lane) => lane.kind === "unstaged"),
        true,
      );
      assert.equal(
        diffSnapshot.lanes.some((lane) => lane.kind === "staged"),
        true,
      );
      assert.equal(
        diffSnapshot.lanes.some((lane) => lane.kind === "committed"),
        true,
      );

      assert.equal(
        findLaneFile(diffSnapshot, "committed", scenario.committedFilePath) !== null,
        true,
      );
      assert.equal(findLaneFile(diffSnapshot, "staged", scenario.stagedFilePath) !== null, true);
      assert.equal(
        findLaneFile(diffSnapshot, "staged", scenario.stagedAddedFilePath) !== null,
        true,
      );
      assert.equal(
        findLaneFile(diffSnapshot, "unstaged", scenario.unstagedFilePath) !== null,
        true,
      );
      assert.equal(
        findLaneFile(diffSnapshot, "unstaged", scenario.unstagedDeletedFilePath) !== null,
        true,
      );
      assert.equal(findLaneFile(diffSnapshot, "ignored", scenario.ignoredFilePath) !== null, true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("extracts additions removals and modifications through review diff rpc", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const diffSnapshot = yield* getReviewDiffSnapshot(session, reviewSession.id);

      const committedFile = findLaneFile(diffSnapshot, "committed", scenario.committedFilePath);
      const stagedAddedFile = findLaneFile(diffSnapshot, "staged", scenario.stagedAddedFilePath);
      const unstagedDeletedFile = findLaneFile(
        diffSnapshot,
        "unstaged",
        scenario.unstagedDeletedFilePath,
      );

      assert.equal(committedFile !== null, true);
      assert.equal(stagedAddedFile !== null, true);
      assert.equal(unstagedDeletedFile !== null, true);

      if (!committedFile || !stagedAddedFile || !unstagedDeletedFile) {
        return;
      }

      assert.equal(committedFile.changeKind, "text");
      assert.equal(committedFile.insertions > 0, true);
      assert.equal(committedFile.deletions > 0, true);

      assert.equal(stagedAddedFile.changeKind, "text");
      assert.equal(stagedAddedFile.insertions > 0, true);
      assert.equal(stagedAddedFile.deletions, 0);

      assert.equal(unstagedDeletedFile.changeKind, "delete");
      assert.equal(unstagedDeletedFile.insertions, 0);
      assert.equal(unstagedDeletedFile.deletions > 0, true);

      const committedPatch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "committed",
        scenario.committedFilePath,
      );
      const stagedAddedPatch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "staged",
        scenario.stagedAddedFilePath,
      );
      const unstagedDeletedPatch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.unstagedDeletedFilePath,
      );

      assert.equal(committedPatch !== null, true);
      assert.equal(stagedAddedPatch !== null, true);
      assert.equal(unstagedDeletedPatch !== null, true);

      if (!committedPatch || !stagedAddedPatch || !unstagedDeletedPatch) {
        return;
      }

      const committedLineKinds = new Set(
        committedPatch.chunks.flatMap((chunk) => chunk.lines.map((line) => line.kind)),
      );
      const stagedAddedLineKinds = new Set(
        stagedAddedPatch.chunks.flatMap((chunk) => chunk.lines.map((line) => line.kind)),
      );
      const unstagedDeletedLineKinds = new Set(
        unstagedDeletedPatch.chunks.flatMap((chunk) => chunk.lines.map((line) => line.kind)),
      );

      assert.equal(committedLineKinds.has("add"), true);
      assert.equal(committedLineKinds.has("delete"), true);
      assert.equal(stagedAddedLineKinds.has("add"), true);
      assert.equal(stagedAddedLineKinds.has("delete"), false);
      assert.equal(unstagedDeletedLineKinds.has("delete"), true);
      assert.equal(unstagedDeletedLineKinds.has("add"), false);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("loads chunk patches and raw chunk payloads for multi-hunk review files", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const patch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
      );

      assert.equal(patch !== null, true);
      if (!patch) {
        return;
      }

      assert.equal(patch.chunks.length >= 2, true);
      const firstChunk = requireFilePatchChunk(patch, 0);
      const secondChunk = requireFilePatchChunk(patch, 1);

      const firstChunkPayload = yield* getReviewChunkPayload(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
        firstChunk.chunkId,
      );
      const secondChunkPayload = yield* getReviewChunkPayload(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
        secondChunk.chunkId,
      );

      assert.equal(firstChunkPayload !== null, true);
      assert.equal(secondChunkPayload !== null, true);

      if (!firstChunkPayload || !secondChunkPayload) {
        return;
      }

      assert.equal(firstChunkPayload.rawPatch.includes(scenario.chunkTopChangeText), true);
      assert.equal(firstChunkPayload.rawPatch.includes(scenario.chunkBottomChangeText), false);
      assert.equal(secondChunkPayload.rawPatch.includes(scenario.chunkBottomChangeText), true);
      assert.equal(secondChunkPayload.rawPatch.includes(scenario.chunkTopChangeText), false);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("stages a single chunk without touching the other hunk", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const patch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
      );
      const firstChunk = requireFilePatchChunk(patch, 0);

      const mutation = yield* applyRawChunkMutation(
        session,
        reviewSession.id,
        "stage",
        "unstaged",
        scenario.chunkFilePath,
        firstChunk.chunkId,
      );

      assert.equal(mutation.selectionStatus, "applied");
      assert.equal(mutation.targetKind, "chunk");
      assert.equal(mutation.confirmation, `Chunk staged: ${scenario.chunkFilePath}`);
      assert.equal(mutation.laneTransitions[0]?.fromLane, "unstaged");
      assert.equal(mutation.laneTransitions[0]?.toLane, "staged");

      const diffSnapshot = yield* getReviewDiffSnapshot(session, reviewSession.id);
      assert.equal(findLaneFile(diffSnapshot, "staged", scenario.chunkFilePath) !== null, true);
      assert.equal(findLaneFile(diffSnapshot, "unstaged", scenario.chunkFilePath) !== null, true);

      const cachedDiff = yield* runGit(workspace.repoDir, [
        "diff",
        "--cached",
        "--",
        scenario.chunkFilePath,
      ]);
      const worktreeDiff = yield* runGit(workspace.repoDir, ["diff", "--", scenario.chunkFilePath]);

      assert.equal(cachedDiff.includes(scenario.chunkTopChangeText), true);
      assert.equal(cachedDiff.includes(scenario.chunkBottomChangeText), false);
      assert.equal(worktreeDiff.includes(scenario.chunkTopChangeText), false);
      assert.equal(worktreeDiff.includes(scenario.chunkBottomChangeText), true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("discards a single unstaged chunk while preserving the other hunk", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const patch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
      );
      const firstChunk = requireFilePatchChunk(patch, 0);

      const mutation = yield* applyRawChunkMutation(
        session,
        reviewSession.id,
        "undo",
        "unstaged",
        scenario.chunkFilePath,
        firstChunk.chunkId,
      );

      assert.equal(mutation.selectionStatus, "applied");
      assert.equal(mutation.generatedInverseEdit, false);
      assert.equal(mutation.confirmation, `Chunk undone: ${scenario.chunkFilePath}`);
      assert.equal(mutation.laneTransitions[0]?.fromLane, "unstaged");
      assert.equal(mutation.laneTransitions[0]?.toLane, undefined);

      const refreshedPatch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
      );
      assert.equal(refreshedPatch !== null, true);
      if (!refreshedPatch) {
        return;
      }

      assert.equal(refreshedPatch.chunks.length, 1);
      const worktreeDiff = yield* runGit(workspace.repoDir, ["diff", "--", scenario.chunkFilePath]);

      assert.equal(worktreeDiff.includes(scenario.chunkTopChangeText), false);
      assert.equal(worktreeDiff.includes(scenario.chunkBottomChangeText), true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("adds a local comment thread anchored to a review chunk", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const patch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "unstaged",
        scenario.chunkFilePath,
      );
      const firstChunk = requireFilePatchChunk(patch, 0);
      const body = "Investigate this chunk before staging.";

      const localThread = yield* createChunkComment(
        session,
        reviewSession.id,
        patch!,
        firstChunk.chunkId,
        body,
      );

      assert.equal(localThread.chunkId, firstChunk.chunkId);
      assert.equal(localThread.body, body);
      assert.equal(localThread.anchor.normalizedPath, scenario.chunkFilePath);

      const snapshot = yield* getReviewSessionSnapshot(session, reviewSession.id);
      const persistedThread =
        snapshot.localThreads.find((entry) => entry.id === localThread.id) ?? null;

      assert.equal(persistedThread !== null, true);
      if (!persistedThread) {
        return;
      }

      assert.equal(persistedThread.chunkId, firstChunk.chunkId);
      assert.equal(persistedThread.body, body);
      assert.equal(persistedThread.anchor.patchFingerprint, firstChunk.anchor.patchFingerprint);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("undos committed chunks by creating inverse edits instead of rewriting history", () =>
  withReviewE2eSuite(({ scenario, session, workspace }) =>
    Effect.gen(function* () {
      const thread = yield* createProjectAndThreadForRepo(session, workspace, scenario);
      const reviewSession = yield* getOrCreateReviewSession(session, thread.threadId);
      const committedPatch = yield* getReviewFilePatch(
        session,
        reviewSession.id,
        "committed",
        scenario.committedFilePath,
      );
      const committedChunk = requireFilePatchChunk(committedPatch, 0);

      const mutation = yield* applyRawChunkMutation(
        session,
        reviewSession.id,
        "undo",
        "committed",
        scenario.committedFilePath,
        committedChunk.chunkId,
      );

      assert.equal(mutation.selectionStatus, "applied");
      assert.equal(mutation.generatedInverseEdit, true);
      assert.equal(mutation.laneTransitions[0]?.fromLane, "committed");
      assert.equal(mutation.laneTransitions[0]?.toLane, "inverse-edit");

      const diffSnapshot = yield* getReviewDiffSnapshot(session, reviewSession.id);
      assert.equal(
        findLaneFile(diffSnapshot, "committed", scenario.committedFilePath) !== null,
        true,
      );
      assert.equal(
        findLaneFile(diffSnapshot, "inverse-edit", scenario.committedFilePath) !== null,
        true,
      );

      const cachedDiff = yield* runGit(workspace.repoDir, [
        "diff",
        "--cached",
        "--",
        scenario.committedFilePath,
      ]);
      const worktreeDiff = yield* runGit(workspace.repoDir, [
        "diff",
        "--",
        scenario.committedFilePath,
      ]);

      assert.equal(cachedDiff, "");
      assert.equal(worktreeDiff.includes('return "before";'), true);
      assert.equal(worktreeDiff.includes('return "after committed change";'), true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
