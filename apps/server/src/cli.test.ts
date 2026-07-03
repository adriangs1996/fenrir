import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@fenrir/shared/Net";
import type {
  AuthSessionId,
  ProjectId,
  TmuxActor,
  TmuxKernelError,
  TmuxWorkspaceId,
  TmuxOperationalPaneStatusResult,
  TmuxWorkspaceListResult,
  TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import {
  cli,
  formatTmuxKernelMetadataStorage,
  formatTmuxKernelRemoteTargets,
  formatTmuxOperationalPaneStatuses,
  formatTmuxWorkspaceList,
  formatTmuxWorkspaceSnapshot,
  nativeControlRoutes,
  runTmuxKernelInspectAdminHandler,
  runTmuxKernelListAdminHandler,
  runTmuxKernelPanesAdminHandler,
  runTmuxKernelReconnectAdminHandler,
  runTmuxKernelRemoteTargetsAdminHandler,
  type TmuxKernelRemoteTargetsSnapshot,
  type TmuxKernelLiveAdminHandlers,
  type TmuxKernelOfflineAdminHandlers,
} from "./cli.ts";
import {
  NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
  NativeHostControlClientError,
  encodeNativeHostControlFrame,
  type NativeHostControlWireRequest,
  type NativeHostControlWireResponse,
} from "./nativeHostControlClient.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const runCli = (args: ReadonlyArray<string>): Effect.Effect<void, CliError.CliError | Error> =>
  Command.runWith(cli, { version: "0.0.0" })(args) as Effect.Effect<
    void,
    CliError.CliError | Error
  >;
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E extends Error | CliError.CliError | TmuxKernelError | void, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const makeNativeControlCliServer = async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "fenrir-native-cli-parse-"));
  const socketPath = join(directory, "native-control.sock");
  const requests: Array<NativeHostControlWireRequest> = [];
  const server = net.createServer((socket) => {
    socket.once("data", (data) => {
      const length = data.readUInt32BE(0);
      const request = JSON.parse(
        data.subarray(4, 4 + length).toString("utf8"),
      ) as NativeHostControlWireRequest;
      requests.push(request);
      const response: NativeHostControlWireResponse = {
        protocolVersion: NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
        requestID: request.requestID,
        command: request.command,
        ok: true,
        resultKind: "Parsed",
        payload: request.parameters ?? {},
      };
      socket.end(encodeNativeHostControlFrame(response));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  server.unref();
  return {
    socketPath,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
};

const waitForNativeControlSocket = async (socketPath: string, process: ChildProcess) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.exitCode !== null) {
      throw new Error(`FenrirNativeApp exited before creating ${socketPath}`);
    }
    try {
      const stat = await fs.stat(socketPath);
      if (stat.isSocket()) {
        return;
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for FenrirNativeApp socket at ${socketPath}`);
};

const launchFenrirNativeApp = async () => {
  const packageRoot = resolve(process.cwd(), "../../native/FenrirNative");
  const executable = join(packageRoot, ".build/debug/FenrirNativeApp");
  try {
    await fs.access(executable);
  } catch (cause) {
    throw new Error(`FenrirNativeApp executable is missing at ${executable}; run swift build.`, {
      cause,
    });
  }

  const directory = await fs.mkdtemp(join(tmpdir(), "fenrir-native-cli-e2e-"));
  const socketPath = join(directory, "native-control.sock");
  const app = spawn(executable, {
    cwd: packageRoot,
    env: {
      ...process.env,
      FENRIR_NATIVE_CONTROL_SOCKET: socketPath,
    },
    stdio: "ignore",
  });
  await waitForNativeControlSocket(socketPath, app);
  return {
    socketPath,
    close: async () => {
      if (app.exitCode === null) {
        app.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (app.exitCode === null) {
        app.kill("SIGKILL");
      }
      await fs.rm(dirname(socketPath), { recursive: true, force: true });
    },
  };
};

const nativeFlags = (socketPath: string) => [
  "--socket",
  socketPath,
  "--timeout-ms",
  "1500",
  "--json",
];

const runNativeCliJson = async (
  args: ReadonlyArray<string>,
): Promise<NativeHostControlWireResponse> => {
  const output = await Effect.runPromise(captureStdout(runCliWithRuntime(args)));
  return JSON.parse(output.output) as NativeHostControlWireResponse;
};

const workspaceIDsFromList = (response: NativeHostControlWireResponse): ReadonlyArray<string> =>
  response.payload?.workspaceIDs?.split(",").filter(Boolean) ?? [];

const makeTmuxWorkspaceSnapshotFixture = (): TmuxWorkspaceSnapshot =>
  ({
    workspace: {
      workspaceId: "tmux-workspace-alpha",
      projectId: "project-alpha",
      tmuxSessionName: "fenrir_project_alpha",
      cwd: "/repo",
      status: "running",
      activeWindowId: "tmux-window-main",
      grants: [],
      createdAt: "2026-06-30T10:00:00.000Z",
      updatedAt: "2026-06-30T10:00:00.000Z",
    },
    windows: [
      {
        windowId: "tmux-window-main",
        workspaceId: "tmux-workspace-alpha",
        tmuxWindowId: "@1",
        tmuxWindowIndex: 0,
        name: "main",
        cwd: "/repo",
        status: "active",
        activePaneId: "tmux-pane-shell",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T10:00:00.000Z",
      },
    ],
    panes: [
      {
        paneId: "tmux-pane-shell",
        workspaceId: "tmux-workspace-alpha",
        windowId: "tmux-window-main",
        tmuxPaneId: "%1",
        cwd: "/repo",
        cols: 120,
        rows: 40,
        status: "running",
        metadata: {
          kind: "custom",
          title: "Agent pane",
          process: null,
          labels: { owner: "workflow" },
          neovim: null,
          agent: null,
          workflow: null,
          managedProcess: null,
          remoteProcess: null,
          browserLab: null,
          custom: { kind: "workflow-surface", ownerId: "workflow-one" },
        },
        stream: {
          streamId: "tmux-pane-stream-one",
          paneId: "tmux-pane-shell",
          encoding: "utf8",
          lowSeq: 0,
          highSeq: 2,
          droppedCount: 0,
          backfillAvailable: true,
          maxChunkBytes: 262144,
        },
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T10:00:00.000Z",
      },
    ],
    revision: 3,
  }) as unknown as TmuxWorkspaceSnapshot;

it.layer(NodeServices.layer)("cli log-level parsing", (it) => {
  it.effect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("executes auth pairing subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "fenrir-cli-auth-pairing-test-"));

      const createdOutput = yield* captureStdout(
        runCli(["auth", "pairing", "create", "--base-dir", baseDir, "--json"]),
      );
      const created = JSON.parse(createdOutput.output) as {
        readonly id: string;
        readonly credential: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]),
      );
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly id: string;
        readonly credential?: string;
      }>;

      assert.equal(typeof created.id, "string");
      assert.equal(typeof created.credential, "string");
      assert.equal(created.credential.length > 0, true);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, created.id);
      assert.equal("credential" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("executes auth session subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "fenrir-cli-auth-session-test-"));

      const issuedOutput = yield* captureStdout(
        runCli(["auth", "session", "issue", "--base-dir", baseDir, "--json"]),
      );
      const issued = JSON.parse(issuedOutput.output) as {
        readonly sessionId: string;
        readonly token: string;
        readonly role: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "session", "list", "--base-dir", baseDir, "--json"]),
      );
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly sessionId: string;
        readonly token?: string;
        readonly role: string;
      }>;

      assert.equal(typeof issued.sessionId, "string");
      assert.equal(typeof issued.token, "string");
      assert.equal(issued.role, "owner");
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.sessionId, issued.sessionId);
      assert.equal(listed[0]?.role, "owner");
      assert.equal("token" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("rejects invalid ttl values before running auth commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["auth", "pairing", "create", "--ttl", "soon"]).pipe(
        Effect.flip,
      );

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "auth", "pairing", "create"]);
      const ttlError = error.errors[0] as CliError.CliError | undefined;
      if (!ttlError || ttlError._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${String(ttlError?._tag)}`);
      }
      assert.equal(ttlError.option, "ttl");
      assert.equal(ttlError.value, "soon");
      assert.isTrue(ttlError.message.includes("Invalid duration"));
      assert.isTrue(ttlError.message.includes("5m, 1h, 30d, or 15 minutes"));
    }),
  );

  it.effect("rejects invalid tmux-kernel workspace ids before running admin services", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["tmux-kernel", "inspect", ""]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "tmux-kernel", "inspect"]);
    }),
  );

  it("maps native product CLI commands to explicit NativeHost routes", () => {
    assert.deepEqual(nativeControlRoutes.open("workspace-a"), {
      command: "open",
      parameters: { workspaceID: "workspace-a" },
      launchIfMissing: true,
    });
    assert.deepEqual(nativeControlRoutes.switchWorkspace("workspace-a"), {
      command: "switch",
      parameters: { workspaceID: "workspace-a" },
    });
    assert.deepEqual(nativeControlRoutes.attach("workspace-a"), {
      command: "attach",
      parameters: { workspaceID: "workspace-a" },
      launchIfMissing: true,
    });
    assert.deepEqual(nativeControlRoutes.remove("workspace-a"), {
      command: "remove",
      parameters: { workspaceID: "workspace-a" },
    });
    assert.deepEqual(nativeControlRoutes.listWorkspaces(), {
      command: "list",
      parameters: {},
    });
    assert.deepEqual(nativeControlRoutes.paletteOpen("diag"), {
      command: "palette",
      parameters: { query: "diag" },
    });
    assert.deepEqual(nativeControlRoutes.paletteRun("action-diagnostics"), {
      command: "palette",
      parameters: { operation: "run", actionID: "action-diagnostics" },
    });
    assert.deepEqual(nativeControlRoutes.workflowOpen(), {
      command: "workflow",
      parameters: { operation: "open" },
    });
    assert.deepEqual(nativeControlRoutes.workflowTimeline("run-a"), {
      command: "workflow",
      parameters: { operation: "timeline", runID: "run-a" },
    });
    assert.deepEqual(nativeControlRoutes.diagnosticsOpen(), {
      command: "diagnostics",
      parameters: {},
    });
    assert.deepEqual(nativeControlRoutes.agentIntegrationStatus(), {
      command: "diagnostics",
      parameters: { operation: "agent-integration-status" },
    });
    assert.deepEqual(nativeControlRoutes.agentIntegrationStatus("codex"), {
      command: "diagnostics",
      parameters: { operation: "agent-integration-status", agentID: "codex" },
    });
    assert.deepEqual(nativeControlRoutes.agentIntegrationRepair("codex"), {
      command: "diagnostics",
      parameters: { operation: "agent-integration-repair", agentID: "codex" },
    });
    assert.deepEqual(nativeControlRoutes.agentIntegrationRemove("codex"), {
      command: "diagnostics",
      parameters: { operation: "agent-integration-remove", agentID: "codex" },
    });
  });

  it("parses native product CLI commands and sends explicit NativeHost requests", async () => {
    const server = await makeNativeControlCliServer();
    const nativeFlags = ["--socket", server.socketPath, "--timeout-ms", "200", "--json"];
    try {
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["open", ...nativeFlags, "workspace-a"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["switch", ...nativeFlags, "workspace-a"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["attach", ...nativeFlags, "workspace-a"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["remove", ...nativeFlags, "workspace-a"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["list", "workspaces", ...nativeFlags])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["palette", "open", ...nativeFlags, "diag"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["palette", "run", ...nativeFlags, "action-diagnostics"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["workflow", "open", ...nativeFlags])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["workflow", "timeline", ...nativeFlags, "run-a"])),
      );
      await Effect.runPromise(captureStdout(runCliWithRuntime(["diagnostics", ...nativeFlags])));
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["agent-integration", "status", ...nativeFlags])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["agent-integration", "status", ...nativeFlags, "codex"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["agent-integration", "repair", ...nativeFlags, "codex"])),
      );
      await Effect.runPromise(
        captureStdout(runCliWithRuntime(["agent-integration", "remove", ...nativeFlags, "codex"])),
      );

      assert.deepEqual(
        server.requests.map(({ command, parameters }) => ({ command, parameters })),
        [
          { command: "open", parameters: { workspaceID: "workspace-a" } },
          { command: "switch", parameters: { workspaceID: "workspace-a" } },
          { command: "attach", parameters: { workspaceID: "workspace-a" } },
          { command: "remove", parameters: { workspaceID: "workspace-a" } },
          { command: "list", parameters: {} },
          { command: "palette", parameters: { query: "diag" } },
          {
            command: "palette",
            parameters: { operation: "run", actionID: "action-diagnostics" },
          },
          { command: "workflow", parameters: { operation: "open" } },
          { command: "workflow", parameters: { operation: "timeline", runID: "run-a" } },
          { command: "diagnostics", parameters: {} },
          { command: "diagnostics", parameters: { operation: "agent-integration-status" } },
          {
            command: "diagnostics",
            parameters: { operation: "agent-integration-status", agentID: "codex" },
          },
          {
            command: "diagnostics",
            parameters: { operation: "agent-integration-repair", agentID: "codex" },
          },
          {
            command: "diagnostics",
            parameters: { operation: "agent-integration-remove", agentID: "codex" },
          },
        ],
      );
    } finally {
      await server.close();
    }
  });

  it.skipIf(process.env.FENRIR_NATIVE_CLI_E2E !== "1")(
    "runs no-mock native CLI workspace commands against the real native app (set FENRIR_NATIVE_CLI_E2E=1)",
    async () => {
      const app = await launchFenrirNativeApp();
      const flags = nativeFlags(app.socketPath);
      const suffix = `${process.pid}-${Date.now()}`;
      const workspaceA = `native-cli-a-${suffix}`;
      const workspaceB = `native-cli-b-${suffix}`;

      try {
        const initial = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.equal(initial.ok, true);
        assert.include(workspaceIDsFromList(initial), "local-workspace");

        const opened = await runNativeCliJson(["open", ...flags, workspaceA]);
        assert.equal(opened.resultKind, "WorkspaceOpened");
        assert.equal(opened.payload?.workspaceID, workspaceA);

        const afterOpen = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.include(workspaceIDsFromList(afterOpen), workspaceA);
        assert.equal(afterOpen.payload?.activeWorkspaceID, workspaceA);

        const attached = await runNativeCliJson(["attach", ...flags, workspaceB]);
        assert.equal(attached.resultKind, "WorkspaceAttached");
        assert.equal(attached.payload?.workspaceID, workspaceB);

        const afterAttach = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.include(workspaceIDsFromList(afterAttach), workspaceA);
        assert.include(workspaceIDsFromList(afterAttach), workspaceB);
        assert.equal(afterAttach.payload?.activeWorkspaceID, workspaceB);

        const switched = await runNativeCliJson(["switch", ...flags, workspaceA]);
        assert.equal(switched.resultKind, "WorkspaceSwitched");
        assert.equal(switched.payload?.workspaceID, workspaceA);

        const afterSwitch = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.equal(afterSwitch.payload?.activeWorkspaceID, workspaceA);

        const removedA = await runNativeCliJson(["remove", ...flags, workspaceA]);
        assert.equal(removedA.resultKind, "WorkspaceRemoved");
        assert.equal(removedA.payload?.workspaceID, workspaceA);

        const afterRemoveA = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.notInclude(workspaceIDsFromList(afterRemoveA), workspaceA);
        assert.include(workspaceIDsFromList(afterRemoveA), workspaceB);

        const removedB = await runNativeCliJson(["remove", ...flags, workspaceB]);
        assert.equal(removedB.resultKind, "WorkspaceRemoved");
        const afterRemoveB = await runNativeCliJson(["list", "workspaces", ...flags]);
        assert.notInclude(workspaceIDsFromList(afterRemoveB), workspaceB);
      } finally {
        await app.close();
      }
    },
  );

  it.effect("native CLI reports no app running when the socket is absent", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "fenrir-native-cli-missing-")),
      );
      const missingSocket = join(directory, "native-control.sock");

      const error = yield* runCliWithRuntime([
        "list",
        "workspaces",
        "--socket",
        missingSocket,
        "--timeout-ms",
        "50",
      ]).pipe(Effect.flip);

      assert.instanceOf(error, NativeHostControlClientError);
      assert.equal((error as NativeHostControlClientError).code, "no-app-running");
    }),
  );

  it.effect("native CLI reports stale socket when the endpoint is not a socket", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "fenrir-native-cli-stale-")),
      );
      const staleSocket = join(directory, "native-control.sock");
      yield* Effect.promise(() => fs.writeFile(staleSocket, ""));

      const error = yield* runCliWithRuntime([
        "list",
        "workspaces",
        "--socket",
        staleSocket,
        "--timeout-ms",
        "50",
      ]).pipe(Effect.flip);

      assert.instanceOf(error, NativeHostControlClientError);
      assert.equal((error as NativeHostControlClientError).code, "stale-socket");
    }),
  );

  it.effect("requires actor session id for live tmux-kernel reconnect commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime([
        "tmux-kernel",
        "reconnect",
        "tmux-workspace-alpha",
        "--server-url",
        "http://127.0.0.1:3000",
        "--bearer-token",
        "session-token",
      ]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "tmux-kernel", "reconnect"]);
    }),
  );

  it.effect("executes tmux-kernel offline handlers against injected services", () =>
    Effect.gen(function* () {
      const actor = {
        sessionId: "auth-session-cli-admin" as AuthSessionId,
        subject: "cli-admin",
      } satisfies TmuxActor;
      const workspaceId = "tmux-workspace-alpha" as TmuxWorkspaceId;
      const projectId = "project-alpha" as ProjectId;
      const snapshot = makeTmuxWorkspaceSnapshotFixture();
      const calls: string[] = [];
      const handlers: TmuxKernelOfflineAdminHandlers = {
        listWorkspaces: (input) =>
          Effect.sync(() => {
            calls.push(`list:${input.actor.sessionId}:${input.projectId}`);
            return { workspaces: [snapshot.workspace], revision: snapshot.revision };
          }),
        getSnapshot: (input) =>
          Effect.sync(() => {
            calls.push(`inspect:${input.actor.sessionId}:${input.workspaceId}`);
            return snapshot;
          }),
        listOperationalPaneStatuses: (input) =>
          Effect.sync(() => {
            calls.push(`panes:${input.actor.sessionId}:${input.workspaceId}`);
            return {
              workspaceId,
              panes: [
                {
                  workspaceId,
                  windowId: snapshot.windows[0]!.windowId,
                  paneId: snapshot.panes[0]!.paneId,
                  kind: "custom",
                  status: "running",
                  metadata: snapshot.panes[0]!.metadata,
                  stream: snapshot.panes[0]!.stream,
                  updatedAt: snapshot.panes[0]!.updatedAt,
                },
              ],
              revision: 3,
            } as TmuxOperationalPaneStatusResult;
          }),
      };

      yield* captureStdout(
        runTmuxKernelListAdminHandler(
          {
            baseDir: Option.none(),
            devUrl: Option.none(),
            actorSessionId: actor.sessionId,
            actorSubject: actor.subject,
            projectId: Option.some(projectId),
            json: true,
          },
          handlers,
        ),
      );
      yield* captureStdout(
        runTmuxKernelInspectAdminHandler(
          {
            baseDir: Option.none(),
            devUrl: Option.none(),
            actorSessionId: actor.sessionId,
            actorSubject: actor.subject,
            workspaceId,
            json: false,
          },
          handlers,
        ),
      );
      yield* captureStdout(
        runTmuxKernelPanesAdminHandler(
          {
            baseDir: Option.none(),
            devUrl: Option.none(),
            actorSessionId: actor.sessionId,
            actorSubject: actor.subject,
            workspaceId,
            json: false,
          },
          handlers,
        ),
      );

      assert.deepEqual(calls, [
        "list:auth-session-cli-admin:project-alpha",
        "inspect:auth-session-cli-admin:tmux-workspace-alpha",
        "panes:auth-session-cli-admin:tmux-workspace-alpha",
      ]);
    }),
  );

  it.effect("executes tmux-kernel live handlers against injected server client", () =>
    Effect.gen(function* () {
      const workspaceId = "tmux-workspace-alpha" as TmuxWorkspaceId;
      const snapshot = makeTmuxWorkspaceSnapshotFixture();
      const calls: string[] = [];
      const handlers: TmuxKernelLiveAdminHandlers = {
        reconnectWorkspace: (input) =>
          Effect.sync(() => {
            calls.push(
              `reconnect:${input.target.serverUrl.toString()}:${input.target.bearerToken}:${input.actor.sessionId}:${input.workspaceId}`,
            );
            return snapshot;
          }),
        listRemoteTargets: (input) =>
          Effect.sync(() => {
            calls.push(
              `remote-targets:${input.target.serverUrl.toString()}:${input.target.bearerToken}`,
            );
            return { hosts: [], connections: [] };
          }),
      };

      yield* captureStdout(
        runTmuxKernelReconnectAdminHandler(
          {
            baseDir: Option.none(),
            devUrl: Option.none(),
            actorSessionId: "auth-session-cli-admin" as AuthSessionId,
            actorSubject: "cli-admin",
            workspaceId,
            serverUrl: Option.some(new URL("http://127.0.0.1:3000")),
            bearerToken: Option.some("session-token"),
            json: false,
          },
          handlers,
        ),
      );
      yield* captureStdout(
        runTmuxKernelRemoteTargetsAdminHandler(
          {
            baseDir: Option.none(),
            devUrl: Option.none(),
            serverUrl: Option.some(new URL("http://127.0.0.1:3000")),
            bearerToken: Option.some("session-token"),
            json: true,
          },
          handlers,
        ),
      );

      assert.deepEqual(calls, [
        "reconnect:http://127.0.0.1:3000/:session-token:auth-session-cli-admin:tmux-workspace-alpha",
        "remote-targets:http://127.0.0.1:3000/:session-token",
      ]);
    }),
  );

  it.effect("requires live server target flags for tmux-kernel live handlers", () =>
    Effect.gen(function* () {
      const handlers: TmuxKernelLiveAdminHandlers = {
        reconnectWorkspace: () => Effect.die("should not call reconnect"),
        listRemoteTargets: () => Effect.die("should not call remote targets"),
      };
      const error = yield* runTmuxKernelRemoteTargetsAdminHandler(
        {
          baseDir: Option.none(),
          devUrl: Option.none(),
          serverUrl: Option.none(),
          bearerToken: Option.none(),
          json: true,
        },
        handlers,
      ).pipe(Effect.flip);

      assert.instanceOf(error, Error);
      assert.include(error.message, "--server-url");
      assert.include(error.message, "--bearer-token");
    }),
  );

  it("formats tmux-kernel workspace, pane, storage, and remote target output", () => {
    const now = "2026-06-30T10:00:00.000Z";
    const snapshot = makeTmuxWorkspaceSnapshotFixture();
    const workspace = snapshot.workspace;
    const pane = snapshot.panes[0]!;

    assert.include(
      formatTmuxWorkspaceList({ workspaces: [workspace] } as unknown as TmuxWorkspaceListResult, {
        json: false,
      }),
      "project-alpha",
    );
    assert.include(
      formatTmuxWorkspaceSnapshot(snapshot as unknown as TmuxWorkspaceSnapshot, { json: false }),
      "pane tmux-pane-shell",
    );
    assert.include(
      formatTmuxOperationalPaneStatuses(
        {
          workspaceId: workspace.workspaceId,
          panes: [
            {
              workspaceId: workspace.workspaceId,
              windowId: "tmux-window-main",
              paneId: "tmux-pane-shell",
              kind: "custom",
              status: "running",
              metadata: pane.metadata,
              stream: pane.stream,
              updatedAt: now,
            },
          ],
          revision: 3,
        } as unknown as TmuxOperationalPaneStatusResult,
        { json: false },
      ),
      "kind=custom",
    );
    assert.include(
      formatTmuxKernelMetadataStorage(
        { path: "/tmp/fenrir/tmux-workspaces/metadata.json", exists: true, bytes: 128 },
        { json: false },
      ),
      "exists: yes",
    );
    assert.deepEqual(
      JSON.parse(
        formatTmuxKernelRemoteTargets(
          {
            hosts: [
              {
                hostId: "host-alpha",
                label: "Lab host",
                transport: { type: "command-template", command: "ssh", args: ["lab"] },
                createdAt: now,
                updatedAt: now,
              },
            ],
            connections: [
              {
                connectionId: "connection-alpha",
                hostId: "host-alpha",
                label: "Lab shell",
                transportType: "command-template",
                status: "connected",
                state: { path: "/repo" },
                startedAt: now,
              },
            ],
          } as unknown as TmuxKernelRemoteTargetsSnapshot,
          { json: true },
        ),
      ).connections[0].status,
      "connected",
    );
  });
});
