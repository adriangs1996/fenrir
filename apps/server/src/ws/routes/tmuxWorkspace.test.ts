import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  ProjectId,
  TmuxPaneId,
  TmuxPaneStreamId,
  TmuxWindowId,
  TmuxWorkspaceId,
  WS_METHODS,
  type TmuxActor,
  type TmuxKernelEvent,
  type TmuxPane,
  type TmuxPaneStreamEvent,
  type TmuxWorkspaceSnapshot,
} from "@fenrir/contracts";
import { Effect, Layer, Stream } from "effect";

import { TmuxWorkspaceService } from "../../terminal/Services/TmuxWorkspaceService";
import { makeTmuxWorkspaceRoutes } from "./tmuxWorkspace";

const sessionId = AuthSessionId.make("auth-session-route");
const actor: TmuxActor = { sessionId, subject: "owner" };
const otherActor: TmuxActor = {
  sessionId: AuthSessionId.make("auth-session-other"),
  subject: "owner",
};
const workspaceId = TmuxWorkspaceId.make("workspace-route");
const windowId = TmuxWindowId.make("window-route");
const paneId = TmuxPaneId.make("pane-route");
const now = "2026-01-01T00:00:00.000Z";

const pane: TmuxPane = {
  paneId,
  workspaceId,
  windowId,
  tmuxPaneId: "%1",
  cwd: "/tmp/project",
  cols: 120,
  rows: 40,
  status: "running",
  metadata: {
    kind: "shell",
    title: "shell",
    process: null,
    labels: {},
    neovim: null,
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
  },
  stream: {
    streamId: TmuxPaneStreamId.make("stream-route"),
    paneId,
    encoding: "utf8",
    lowSeq: 1,
    highSeq: 1,
    droppedCount: 0,
    backfillAvailable: true,
    maxChunkBytes: 256 * 1024,
  },
  createdAt: now,
  updatedAt: now,
};

const snapshot: TmuxWorkspaceSnapshot = {
  workspace: {
    workspaceId,
    projectId: ProjectId.make("project-route"),
    tmuxSessionName: "fenrir-ws-project-route",
    cwd: "/tmp/project",
    status: "running",
    activeWindowId: windowId,
    grants: [
      {
        actor,
        permissions: ["workspace:read", "pane:read", "pane:write", "pane:control"],
        grantedAt: now,
        expiresAt: null,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  windows: [
    {
      windowId,
      workspaceId,
      tmuxWindowId: "@1",
      tmuxWindowIndex: 0,
      name: "shell",
      cwd: "/tmp/project",
      status: "active",
      activePaneId: paneId,
      createdAt: now,
      updatedAt: now,
    },
  ],
  panes: [pane],
  revision: 1,
};

function makeRoutesLayer(calls: string[] = []) {
  return Layer.mock(TmuxWorkspaceService)({
    listWorkspaces: (input) => {
      calls.push(`list:${input.projectId ?? "all"}`);
      return Effect.succeed({ workspaces: [snapshot.workspace], revision: 1 });
    },
    ensureWorkspace: (input) => {
      calls.push(`ensure:${input.projectId}`);
      return Effect.succeed(snapshot);
    },
    reconnectWorkspace: (input) => {
      calls.push(`reconnect:${input.workspaceId}`);
      return Effect.succeed(snapshot);
    },
    getSnapshot: (input) => {
      calls.push(`snapshot:${input.workspaceId}`);
      return Effect.succeed(snapshot);
    },
    createWindow: () => {
      calls.push("window.create");
      return Effect.succeed(snapshot);
    },
    renameWindow: () => Effect.succeed(snapshot.windows[0]!),
    focusWindow: () => Effect.succeed(snapshot),
    closeWindow: () => {
      calls.push("window.close");
      return Effect.succeed(snapshot);
    },
    createPane: () => {
      calls.push("pane.create");
      return Effect.succeed(snapshot);
    },
    createNeovimPane: () => {
      calls.push("neovim.create");
      return Effect.succeed(snapshot);
    },
    reconnectNeovimPane: () => {
      calls.push("neovim.reconnect");
      return Effect.succeed(snapshot);
    },
    attachPaneMetadata: () => {
      calls.push("pane.attachMetadata");
      return Effect.succeed({
        ...pane,
        metadata: {
          kind: "workflow" as const,
          title: "Workflow run",
          process: null,
          labels: { surface: "workflow" },
          neovim: null,
          agent: null,
          workflow: {
            workflowId: "workflow-1",
            runId: "run-1",
            stepId: null,
            threadId: null,
          },
          managedProcess: null,
          remoteProcess: null,
          browserLab: null,
        },
      });
    },
    listOperationalPaneStatuses: () => {
      calls.push("pane.statuses");
      return Effect.succeed({
        workspaceId,
        revision: snapshot.revision,
        panes: [],
      });
    },
    focusPane: () => {
      calls.push("pane.focus");
      return Effect.succeed(snapshot);
    },
    resizePane: () => {
      calls.push("pane.resize");
      return Effect.succeed(pane);
    },
    closePane: () => {
      calls.push("pane.close");
      return Effect.succeed(snapshot);
    },
    writePane: (input) => {
      calls.push(`pane.write:${input.requestId}`);
      return Effect.succeed({
        type: "accepted" as const,
        workspaceId: input.workspaceId,
        paneId: input.paneId,
        requestId: input.requestId,
        inputSeq: 1,
        acceptedAt: now,
      });
    },
    subscribePaneStream: () => {
      calls.push("pane.stream");
      const event: TmuxPaneStreamEvent = {
        type: "chunk",
        descriptor: pane.stream,
        seq: 1,
        data: "hello",
        emittedAt: now,
      };
      return Effect.succeed(Stream.make(event));
    },
    subscribe: (_input, listener) => {
      calls.push("workspace.subscribe");
      const event: TmuxKernelEvent = {
        type: "workspace.snapshot",
        workspaceId,
        revision: 1,
        occurredAt: now,
        snapshot,
      };
      return listener(event).pipe(Effect.as(() => calls.push("workspace.unsubscribe")));
    },
    sessionNameForProject: (projectId) => `fenrir-ws-${projectId}`,
  });
}

it.effect("routes workspace list, ensure, snapshot, and subscribe to TmuxWorkspaceService", () => {
  const calls: string[] = [];
  return Effect.gen(function* () {
    const routes = yield* makeTmuxWorkspaceRoutes({ currentSessionId: sessionId });

    const list = yield* routes[WS_METHODS.tmuxWorkspaceList]({ actor });
    const ensured = yield* routes[WS_METHODS.tmuxWorkspaceEnsure]({
      actor,
      projectId: snapshot.workspace.projectId,
      cwd: snapshot.workspace.cwd,
      initialGrants: snapshot.workspace.grants,
    });
    const loaded = yield* routes[WS_METHODS.tmuxWorkspaceGetSnapshot]({ actor, workspaceId });
    const reconnected = yield* routes[WS_METHODS.tmuxWorkspaceReconnect]({ actor, workspaceId });
    const events = Array.from(
      yield* routes[WS_METHODS.tmuxWorkspaceSubscribe]({ actor, workspaceId }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    );

    expect(list.workspaces).toHaveLength(1);
    expect(ensured.workspace.workspaceId).toBe(workspaceId);
    expect(loaded.revision).toBe(1);
    expect(reconnected.workspace.workspaceId).toBe(workspaceId);
    expect(events[0]).toMatchObject({ type: "workspace.snapshot", workspaceId });
    expect(calls).toEqual([
      "list:all",
      `ensure:${snapshot.workspace.projectId}`,
      `snapshot:${workspaceId}`,
      `reconnect:${workspaceId}`,
      "workspace.subscribe",
      "workspace.unsubscribe",
    ]);
  }).pipe(Effect.provide(makeRoutesLayer(calls)));
});

it.effect("routes window and pane mutations plus pane write acknowledgements", () => {
  const calls: string[] = [];
  return Effect.gen(function* () {
    const routes = yield* makeTmuxWorkspaceRoutes({ currentSessionId: sessionId });

    yield* routes[WS_METHODS.tmuxWindowCreate]({ actor, workspaceId, name: "ops" });
    yield* routes[WS_METHODS.tmuxWindowClose]({ actor, workspaceId, windowId, mode: "detach" });
    yield* routes[WS_METHODS.tmuxPaneCreate]({
      actor,
      workspaceId,
      windowId,
      kind: "shell",
      split: "horizontal",
    });
    yield* routes[WS_METHODS.tmuxNeovimPaneCreate]({
      actor,
      workspaceId,
      windowId,
      cwd: "/tmp/project",
      files: ["/tmp/project/README.md"],
      line: 12,
      column: 4,
      profileId: "fenrir-dark",
      split: "vertical",
      launchSource: "user",
    });
    yield* routes[WS_METHODS.tmuxNeovimPaneReconnect]({
      actor,
      workspaceId,
      windowId,
      cwd: "/tmp/project",
      files: ["/tmp/project/README.md"],
      profileId: "fenrir-dark",
      launchSource: "restore",
    });
    yield* routes[WS_METHODS.tmuxPaneAttachMetadata]({
      actor,
      workspaceId,
      paneId,
      metadata: {
        kind: "workflow",
        title: "Workflow run",
        process: null,
        labels: { surface: "workflow" },
        neovim: null,
        agent: null,
        workflow: {
          workflowId: "workflow-1",
          runId: "run-1",
          stepId: null,
          threadId: null,
        },
        managedProcess: null,
        remoteProcess: null,
        browserLab: null,
      },
    });
    yield* routes[WS_METHODS.tmuxOperationalPaneStatuses]({ actor, workspaceId });
    yield* routes[WS_METHODS.tmuxPaneFocus]({ actor, workspaceId, paneId });
    yield* routes[WS_METHODS.tmuxPaneResize]({ actor, workspaceId, paneId, cols: 120, rows: 40 });
    yield* routes[WS_METHODS.tmuxPaneClose]({ actor, workspaceId, paneId, mode: "detach" });
    const write = yield* routes[WS_METHODS.tmuxPaneWrite]({
      workspaceId,
      paneId,
      actor,
      requestId: "write-1",
      data: "echo hello\n",
    });

    expect(write).toMatchObject({ type: "accepted", inputSeq: 1 });
    expect(calls).toEqual([
      "window.create",
      "window.close",
      "pane.create",
      "neovim.create",
      "neovim.reconnect",
      "pane.attachMetadata",
      "pane.statuses",
      "pane.focus",
      "pane.resize",
      "pane.close",
      "pane.write:write-1",
    ]);
  }).pipe(Effect.provide(makeRoutesLayer(calls)));
});

it.effect("routes pane data-plane stream subscriptions", () => {
  const calls: string[] = [];
  return Effect.gen(function* () {
    const routes = yield* makeTmuxWorkspaceRoutes({ currentSessionId: sessionId });

    const stream = routes[WS_METHODS.tmuxPaneSubscribeStream]({
      workspaceId,
      paneId,
      actor,
      afterSeq: 0,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 10,
    });
    const events = Array.from(yield* stream.pipe(Stream.runCollect));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "chunk", data: "hello" });
    expect(calls).toEqual(["pane.stream"]);
  }).pipe(Effect.provide(makeRoutesLayer(calls)));
});

it.effect("rejects tmux pane actor claims from another authenticated session", () =>
  Effect.gen(function* () {
    const routes = yield* makeTmuxWorkspaceRoutes({ currentSessionId: sessionId });

    const write = yield* Effect.exit(
      routes[WS_METHODS.tmuxPaneWrite]({
        workspaceId,
        paneId,
        actor: otherActor,
        requestId: "write-1",
        data: "echo denied\n",
      }),
    );
    const list = yield* Effect.exit(routes[WS_METHODS.tmuxWorkspaceList]({ actor: otherActor }));
    const snapshotRead = yield* Effect.exit(
      routes[WS_METHODS.tmuxWorkspaceGetSnapshot]({ actor: otherActor, workspaceId }),
    );
    const reconnect = yield* Effect.exit(
      routes[WS_METHODS.tmuxWorkspaceReconnect]({ actor: otherActor, workspaceId }),
    );
    const windowCreate = yield* Effect.exit(
      routes[WS_METHODS.tmuxWindowCreate]({ actor: otherActor, workspaceId, name: "denied" }),
    );
    const neovimCreate = yield* Effect.exit(
      routes[WS_METHODS.tmuxNeovimPaneCreate]({ actor: otherActor, workspaceId, windowId }),
    );
    const neovimReconnect = yield* Effect.exit(
      routes[WS_METHODS.tmuxNeovimPaneReconnect]({ actor: otherActor, workspaceId, windowId }),
    );
    const attachMetadata = yield* Effect.exit(
      routes[WS_METHODS.tmuxPaneAttachMetadata]({
        actor: otherActor,
        workspaceId,
        paneId,
        metadata: {
          kind: "custom",
          title: "Denied",
          process: null,
          labels: {},
          neovim: null,
          agent: null,
          workflow: null,
          managedProcess: null,
          remoteProcess: null,
          browserLab: null,
        },
      }),
    );
    const statuses = yield* Effect.exit(
      routes[WS_METHODS.tmuxOperationalPaneStatuses]({ actor: otherActor, workspaceId }),
    );
    const stream = yield* Effect.exit(
      routes[WS_METHODS.tmuxPaneSubscribeStream]({
        workspaceId,
        paneId,
        actor: otherActor,
        backfill: "latest",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 10,
      }).pipe(Stream.runCollect),
    );
    const ensure = yield* Effect.exit(
      routes[WS_METHODS.tmuxWorkspaceEnsure]({
        actor,
        projectId: snapshot.workspace.projectId,
        cwd: snapshot.workspace.cwd,
        initialGrants: [{ ...snapshot.workspace.grants[0]!, actor: otherActor }],
      }),
    );

    expect(write._tag).toBe("Failure");
    expect(list._tag).toBe("Failure");
    expect(snapshotRead._tag).toBe("Failure");
    expect(reconnect._tag).toBe("Failure");
    expect(windowCreate._tag).toBe("Failure");
    expect(neovimCreate._tag).toBe("Failure");
    expect(neovimReconnect._tag).toBe("Failure");
    expect(attachMetadata._tag).toBe("Failure");
    expect(statuses._tag).toBe("Failure");
    expect(stream._tag).toBe("Failure");
    expect(ensure._tag).toBe("Failure");
  }).pipe(Effect.provide(makeRoutesLayer())),
);
