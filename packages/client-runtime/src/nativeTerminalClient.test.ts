import {
  AuthSessionId,
  ProjectId,
  TmuxPaneId,
  TmuxPaneStreamId,
  TmuxWindowId,
  TmuxWorkspaceId,
} from "@fenrir/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  applyNativePaneStreamEvent,
  applyNativePaneWriteResult,
  createNativePaneStreamReconnectInput,
  createNativePaneStreamState,
  createNativePaneWriteState,
  createNativeTerminalActor,
  createNativeTerminalClient,
  discoverNativeTerminalCapabilities,
  type NativeTerminalRpcTransport,
} from "./nativeTerminalClient";

const actor = {
  sessionId: AuthSessionId.make("auth-session-native-1"),
  subject: "native-user",
};
const workspaceId = TmuxWorkspaceId.make("workspace-native-1");
const windowId = TmuxWindowId.make("window-native-1");
const paneId = TmuxPaneId.make("pane-native-1");
const streamId = TmuxPaneStreamId.make("stream-native-1");
const projectId = ProjectId.make("project-native-1");
const now = "2026-01-01T00:00:00.000Z";

const stream = {
  streamId,
  paneId,
  encoding: "utf8" as const,
  lowSeq: 0,
  highSeq: 10,
  droppedCount: 0,
  backfillAvailable: true,
  maxChunkBytes: 65_536,
};

const pane = {
  paneId,
  workspaceId,
  windowId,
  tmuxPaneId: "%1",
  cwd: "/workspace/project",
  cols: 120,
  rows: 40,
  status: "running" as const,
  metadata: {
    kind: "shell" as const,
    title: "Shell",
    process: null,
    labels: {},
    neovim: null,
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
  },
  stream,
  createdAt: now,
  updatedAt: now,
};

const snapshot = {
  workspace: {
    workspaceId,
    projectId,
    tmuxSessionName: "fenrir-project-native",
    cwd: "/workspace/project",
    status: "running" as const,
    activeWindowId: windowId,
    grants: [],
    createdAt: now,
    updatedAt: now,
  },
  windows: [
    {
      windowId,
      workspaceId,
      tmuxWindowId: "@1",
      tmuxWindowIndex: 0,
      name: "main",
      cwd: "/workspace/project",
      status: "active" as const,
      activePaneId: paneId,
      createdAt: now,
      updatedAt: now,
    },
  ],
  panes: [pane],
  revision: 1,
};

function makeTransport(): NativeTerminalRpcTransport {
  return {
    listWorkspaces: vi.fn(async () => ({ workspaces: [snapshot.workspace], revision: 1 })),
    ensureWorkspace: vi.fn(async () => snapshot),
    getWorkspaceSnapshot: vi.fn(async () => snapshot),
    reconnectWorkspace: vi.fn(async () => snapshot),
    subscribeWorkspace: vi.fn(() => () => undefined),
    createWindow: vi.fn(async () => snapshot),
    closeWindow: vi.fn(async () => snapshot),
    createPane: vi.fn(async () => snapshot),
    createNeovimPane: vi.fn(async () => snapshot),
    reconnectNeovimPane: vi.fn(async () => snapshot),
    attachPaneMetadata: vi.fn(async () => pane),
    listOperationalPaneStatuses: vi.fn(async () => ({
      workspaceId,
      panes: [],
      revision: 1,
    })),
    closePane: vi.fn(async () => snapshot),
    resizePane: vi.fn(async () => pane),
    writePane: vi.fn(async (input) => ({
      type: "accepted" as const,
      workspaceId: input.workspaceId,
      paneId: input.paneId,
      requestId: input.requestId,
      inputSeq: 11,
      acceptedAt: now,
    })),
    subscribePaneStream: vi.fn((_input, listener) => {
      listener({
        type: "chunk",
        descriptor: { ...stream, highSeq: 11 },
        seq: 11,
        data: "ok",
        emittedAt: now,
      });
      return () => undefined;
    }),
  };
}

describe("native terminal client runtime boundary", () => {
  it("requires explicit bearer session identity and exposes tmux-kernel capabilities", () => {
    expect(
      createNativeTerminalActor({
        kind: "bearer",
        token: "secret",
        sessionId: actor.sessionId,
        subject: actor.subject,
      }),
    ).toEqual(actor);
    expect(() =>
      createNativeTerminalActor({
        kind: "bearer",
        token: "",
        sessionId: actor.sessionId,
        subject: actor.subject,
      }),
    ).toThrow("auth.token is required");
    expect(discoverNativeTerminalCapabilities()).toMatchObject({
      protocol: "tmux-kernel-v1",
      auth: {
        mode: "explicit-bearer-session",
        requiresActorSessionId: true,
      },
      paneStream: {
        sequenceBackfill: true,
        overflowEvents: true,
      },
      paneWrite: {
        acknowledgements: true,
      },
    });
  });

  it("attaches, detaches, and reconnects workspaces through the service transport", async () => {
    const transport = makeTransport();
    const client = createNativeTerminalClient(
      {
        serverUrl: "ws://localhost:3000",
        auth: {
          kind: "bearer",
          token: "secret",
          sessionId: actor.sessionId,
          subject: actor.subject,
        },
      },
      transport,
    );

    const attached = await client.attachWorkspace({
      mode: "ensure",
      projectId,
      cwd: "/workspace/project",
    });
    const detached = client.detachWorkspace(attached, "native-window-closed");
    const reconnected = await client.reconnectWorkspace(workspaceId);

    expect(transport.ensureWorkspace).toHaveBeenCalledWith({
      actor,
      projectId,
      cwd: "/workspace/project",
    });
    expect(detached).toMatchObject({
      status: "detached",
      detachReason: "native-window-closed",
    });
    expect(transport.reconnectWorkspace).toHaveBeenCalledWith({ actor, workspaceId });
    expect(reconnected.status).toBe("attached");
  });

  it("tracks stream backfill, gaps, overflow, and reconnect cursor semantics", () => {
    let state = createNativePaneStreamState({ descriptor: stream, lastSeq: 4 });

    state = applyNativePaneStreamEvent(state, {
      type: "backfill-started",
      descriptor: stream,
      fromSeq: 5,
      toSeq: 6,
    });
    state = applyNativePaneStreamEvent(state, {
      type: "chunk",
      descriptor: { ...stream, highSeq: 5 },
      seq: 5,
      data: "a",
      emittedAt: now,
    });
    state = applyNativePaneStreamEvent(state, {
      type: "chunk",
      descriptor: { ...stream, highSeq: 6 },
      seq: 6,
      data: "b",
      emittedAt: now,
    });
    state = applyNativePaneStreamEvent(state, {
      type: "gap",
      descriptor: { ...stream, lowSeq: 9, highSeq: 10, droppedCount: 2 },
      requestedAfterSeq: 6,
      resumedAtSeq: 9,
      reason: "buffer-overflow",
    });
    state = applyNativePaneStreamEvent(state, {
      type: "overflow",
      descriptor: { ...stream, lowSeq: 10, highSeq: 12, droppedCount: 4 },
      droppedCount: 2,
      policy: "fast-forward",
      reason: "slow-client",
    });

    expect(state).toMatchObject({
      lifecycle: "overflowed",
      lastSeq: 8,
      receivedChunkCount: 2,
      gapCount: 1,
      overflowCount: 1,
      droppedCount: 4,
      backfill: { active: false, fromSeq: 5, toSeq: 6 },
    });
    expect(
      createNativePaneStreamReconnectInput({
        actor,
        pane,
        state,
        maxBufferedChunks: 32,
      }),
    ).toEqual({
      actor,
      workspaceId,
      paneId,
      afterSeq: 8,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 32,
    });
  });

  it("subscribes pane streams with backfill state and write acknowledgements", async () => {
    const transport = makeTransport();
    const client = createNativeTerminalClient(
      {
        serverUrl: "ws://localhost:3000",
        auth: {
          kind: "bearer",
          token: "secret",
          sessionId: actor.sessionId,
          subject: actor.subject,
        },
      },
      transport,
    );
    const listener = vi.fn();

    const subscription = client.subscribePaneStream(
      {
        pane,
        afterSeq: 10,
      },
      listener,
    );
    const write = await client.writePane({
      workspaceId,
      paneId,
      requestId: "write-1",
      data: "ls\n",
    });
    const writeState = applyNativePaneWriteResult(createNativePaneWriteState(), write);

    expect(transport.subscribePaneStream).toHaveBeenCalledWith(
      {
        actor,
        workspaceId,
        paneId,
        afterSeq: 10,
        backfill: "from-seq",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 512,
      },
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chunk", seq: 11 }),
      expect.objectContaining({ lastSeq: 11, lifecycle: "live" }),
    );
    expect(subscription.createReconnectInput()).toMatchObject({ afterSeq: 11 });
    expect(transport.writePane).toHaveBeenCalledWith({
      actor,
      workspaceId,
      paneId,
      requestId: "write-1",
      data: "ls\n",
    });
    expect(writeState).toMatchObject({
      acceptedRequestIds: ["write-1"],
      lastAcceptedInputSeq: 11,
    });
  });

  it("uses latest backfill for initial pane stream subscriptions without a cursor", () => {
    const transport = makeTransport();
    const client = createNativeTerminalClient(
      {
        serverUrl: "ws://localhost:3000",
        auth: {
          kind: "bearer",
          token: "secret",
          sessionId: actor.sessionId,
          subject: actor.subject,
        },
      },
      transport,
    );

    client.subscribePaneStream({ pane }, vi.fn());

    expect(transport.subscribePaneStream).toHaveBeenCalledWith(
      {
        actor,
        workspaceId,
        paneId,
        backfill: "latest",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 512,
      },
      expect.any(Function),
    );
  });
});
