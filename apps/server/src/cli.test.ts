import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  runTmuxKernelInspectAdminHandler,
  runTmuxKernelListAdminHandler,
  runTmuxKernelPanesAdminHandler,
  runTmuxKernelReconnectAdminHandler,
  runTmuxKernelRemoteTargetsAdminHandler,
  type TmuxKernelRemoteTargetsSnapshot,
  type TmuxKernelLiveAdminHandlers,
  type TmuxKernelOfflineAdminHandlers,
} from "./cli.ts";

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
