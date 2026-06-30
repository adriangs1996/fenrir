import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  TmuxKernelError,
  TmuxKernelEvent,
  TmuxNeovimPaneInput,
  TmuxOperationalPaneStatusResult,
  TmuxPane,
  TmuxPaneAttachMetadataInput,
  TmuxPaneCreateInput,
  TmuxPaneResizeInput,
  TmuxPaneStreamEvent,
  TmuxPaneStreamSubscribeInput,
  TmuxPaneWriteInput,
  TmuxPaneWriteResult,
  TmuxWorkspaceListResult,
  TmuxWorkspaceSnapshot,
} from "./terminalKernel";
import { ProviderSession } from "./provider";

const decodeWorkspaceSnapshot = Schema.decodeUnknownEffect(TmuxWorkspaceSnapshot);
const decodeWorkspaceListResult = Schema.decodeUnknownEffect(TmuxWorkspaceListResult);
const decodePane = Schema.decodeUnknownEffect(TmuxPane);
const decodePaneAttachMetadataInput = Schema.decodeUnknownEffect(TmuxPaneAttachMetadataInput);
const decodeOperationalPaneStatusResult = Schema.decodeUnknownEffect(
  TmuxOperationalPaneStatusResult,
);
const decodePaneCreateInput = Schema.decodeUnknownEffect(TmuxPaneCreateInput);
const decodeNeovimPaneInput = Schema.decodeUnknownEffect(TmuxNeovimPaneInput);
const decodePaneResizeInput = Schema.decodeUnknownEffect(TmuxPaneResizeInput);
const decodePaneWriteInput = Schema.decodeUnknownEffect(TmuxPaneWriteInput);
const decodePaneWriteResult = Schema.decodeUnknownEffect(TmuxPaneWriteResult);
const decodePaneStreamSubscribeInput = Schema.decodeUnknownEffect(TmuxPaneStreamSubscribeInput);
const decodePaneStreamEvent = Schema.decodeUnknownEffect(TmuxPaneStreamEvent);
const decodeKernelEvent = Schema.decodeUnknownEffect(TmuxKernelEvent);
const decodeProviderSession = Schema.decodeUnknownEffect(ProviderSession);

const now = "2026-01-01T00:00:00.000Z";

const workspace = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  tmuxSessionName: "fenrir-project-1",
  cwd: "/workspace/project-1",
  status: "running" as const,
  activeWindowId: "window-1",
  grants: [
    {
      actor: {
        sessionId: "auth-session-1",
        subject: "owner",
      },
      permissions: [
        "workspace:read",
        "workspace:control",
        "window:control",
        "pane:read",
        "pane:write",
        "pane:control",
        "process:spawn",
        "neovim:launch",
        "session:destroy",
        "permissions:admin",
      ] as const,
      grantedAt: now,
      expiresAt: null,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

const window = {
  windowId: "window-1",
  workspaceId: "workspace-1",
  tmuxWindowId: "@1",
  tmuxWindowIndex: 0,
  name: "editor",
  cwd: "/workspace/project-1",
  status: "active" as const,
  activePaneId: "pane-1",
  createdAt: now,
  updatedAt: now,
};

const stream = {
  streamId: "stream-1",
  paneId: "pane-1",
  encoding: "utf8" as const,
  lowSeq: 10,
  highSeq: 20,
  droppedCount: 2,
  backfillAvailable: true,
  maxChunkBytes: 65536,
};

const shellPane = {
  paneId: "pane-1",
  workspaceId: "workspace-1",
  windowId: "window-1",
  tmuxPaneId: "%1",
  cwd: "/workspace/project-1",
  cols: 120,
  rows: 40,
  status: "running" as const,
  metadata: {
    kind: "shell" as const,
    title: "shell",
    process: {
      command: "zsh",
      argv: ["zsh", "-l"],
      envKeys: ["SHELL"],
      pid: 1234,
      startedAt: now,
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
    },
    neovim: null,
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
    labels: { purpose: "interactive" },
  },
  stream,
  createdAt: now,
  updatedAt: now,
};

const neovimPane = {
  ...shellPane,
  paneId: "pane-nvim",
  tmuxPaneId: "%2",
  metadata: {
    kind: "neovim" as const,
    title: "nvim",
    process: {
      command: "nvim README.md",
      argv: ["nvim", "README.md"],
      envKeys: ["FENRIR_WORKSPACE_ID", "FENRIR_PANE_ID"],
      pid: 2345,
      startedAt: now,
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
    },
    neovim: {
      bootstrapId: "nvim-bootstrap-1",
      workspaceId: "workspace-1",
      windowId: "window-1",
      cwd: "/workspace/project-1",
      profileId: "fenrir-dark",
      files: ["/workspace/project-1/README.md"],
      line: 12,
      column: 4,
      launchSource: "user" as const,
      bootstrapEnvKeys: ["FENRIR_WORKSPACE_ID", "FENRIR_PANE_ID"],
    },
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
    labels: { surface: "editor" },
  },
  stream: {
    ...stream,
    paneId: "pane-nvim",
    streamId: "stream-nvim",
  },
};

it.effect("decodes a workspace snapshot with windows, panes, grants, and stream descriptors", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWorkspaceSnapshot({
      workspace,
      windows: [window],
      panes: [shellPane],
      revision: 7,
    });

    assert.strictEqual(parsed.workspace.projectId, "project-1");
    assert.strictEqual(parsed.windows[0]?.tmuxWindowId, "@1");
    assert.strictEqual(parsed.panes[0]?.stream.lowSeq, 10);
    assert.deepStrictEqual(parsed.workspace.grants[0]?.permissions, [
      "workspace:read",
      "workspace:control",
      "window:control",
      "pane:read",
      "pane:write",
      "pane:control",
      "process:spawn",
      "neovim:launch",
      "session:destroy",
      "permissions:admin",
    ]);
  }),
);

it.effect("decodes workspace list results without requiring pane data", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWorkspaceListResult({
      workspaces: [workspace],
      revision: 8,
    });

    assert.strictEqual(parsed.workspaces.length, 1);
    assert.strictEqual(parsed.revision, 8);
  }),
);

it.effect("decodes Neovim as a real pane process with bootstrap metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePane(neovimPane);

    assert.strictEqual(parsed.metadata.kind, "neovim");
    assert.strictEqual(parsed.metadata.process?.command, "nvim README.md");
    assert.strictEqual(parsed.metadata.neovim?.bootstrapId, "nvim-bootstrap-1");
    assert.strictEqual(parsed.metadata.neovim?.workspaceId, "workspace-1");
    assert.strictEqual(parsed.metadata.neovim?.profileId, "fenrir-dark");
    assert.deepStrictEqual(parsed.metadata.neovim?.files, ["/workspace/project-1/README.md"]);
  }),
);

it.effect("decodes provider-neutral agent, workflow, managed-process, and custom pane kinds", () =>
  Effect.gen(function* () {
    const panes = [
      {
        kind: "agent" as const,
        agent: { providerId: "codex", providerInstanceId: "default", threadId: "thread-1" },
        workflow: null,
        managedProcess: null,
        remoteProcess: null,
        browserLab: null,
      },
      {
        kind: "workflow" as const,
        agent: null,
        workflow: {
          workflowId: "workflow-1",
          runId: "run-1",
          stepId: "step-1",
          threadId: "thread-1",
        },
        managedProcess: null,
        remoteProcess: null,
        browserLab: null,
      },
      {
        kind: "managed-process" as const,
        agent: null,
        workflow: null,
        managedProcess: { instanceId: "instance-1", processDefId: "dev-server" },
        remoteProcess: null,
        browserLab: null,
      },
      {
        kind: "remote-process" as const,
        agent: null,
        workflow: null,
        managedProcess: null,
        remoteProcess: {
          hostId: "host-1",
          connectionId: "connection-1",
          commandRunId: "run-1",
        },
        browserLab: null,
      },
      {
        kind: "browser-lab" as const,
        agent: null,
        workflow: null,
        managedProcess: null,
        remoteProcess: null,
        browserLab: {
          profileId: "profile-1",
          tabId: "tab-1",
          origin: "https://example.test",
        },
      },
      {
        kind: "custom" as const,
        agent: null,
        workflow: null,
        managedProcess: null,
        remoteProcess: null,
        browserLab: null,
      },
    ];

    for (const pane of panes) {
      const parsed = yield* decodePane({
        ...shellPane,
        metadata: {
          ...shellPane.metadata,
          kind: pane.kind,
          agent: pane.agent,
          workflow: pane.workflow,
          managedProcess: pane.managedProcess,
          remoteProcess: pane.remoteProcess,
          browserLab: pane.browserLab,
        },
      });
      assert.strictEqual(parsed.metadata.kind, pane.kind);
    }
  }),
);

it.effect("decodes operational pane metadata attachment and lifecycle status results", () =>
  Effect.gen(function* () {
    const attach = yield* decodePaneAttachMetadataInput({
      actor: workspace.grants[0]!.actor,
      workspaceId: "workspace-1",
      paneId: "pane-1",
      metadata: {
        kind: "browser-lab",
        title: "Browser Lab",
        process: null,
        labels: { surface: "browser-lab" },
        neovim: null,
        agent: null,
        workflow: null,
        managedProcess: null,
        remoteProcess: null,
        browserLab: {
          profileId: "profile-1",
          tabId: "tab-1",
          origin: "https://example.test",
        },
      },
    });
    const statuses = yield* decodeOperationalPaneStatusResult({
      workspaceId: "workspace-1",
      revision: 12,
      panes: [
        {
          workspaceId: "workspace-1",
          windowId: "window-1",
          paneId: "pane-1",
          kind: "browser-lab",
          status: "running",
          metadata: attach.metadata,
          stream,
          updatedAt: now,
        },
      ],
    });

    assert.strictEqual(attach.metadata.kind, "browser-lab");
    assert.strictEqual(statuses.panes[0]?.metadata.kind, "browser-lab");
    assert.strictEqual(statuses.panes[0]?.status, "running");
  }),
);

it.effect("keeps provider sessions free of terminal pane attachment fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProviderSession({
      provider: "codex",
      providerInstanceId: "codex",
      status: "running",
      runtimeMode: "full-access",
      cwd: "/workspace/project-1",
      threadId: "thread-1",
      createdAt: now,
      updatedAt: now,
    });

    assert.strictEqual("paneId" in parsed, false);
    assert.strictEqual("tmuxPaneId" in parsed, false);
    assert.strictEqual("operationalPane" in parsed, false);
  }),
);

it.effect("rejects Neovim pane metadata without Neovim bootstrap context", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePane({
        ...neovimPane,
        metadata: {
          ...neovimPane.metadata,
          neovim: null,
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects shell pane metadata carrying workflow ownership", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePane({
        ...shellPane,
        metadata: {
          ...shellPane.metadata,
          workflow: {
            workflowId: "workflow-1",
            runId: "run-1",
            stepId: null,
            threadId: "thread-1",
          },
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes pane creation input with explicit split and metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePaneCreateInput({
      actor: workspace.grants[0]!.actor,
      workspaceId: "workspace-1",
      windowId: "window-1",
      kind: "shell",
      cwd: "/workspace/project-1",
      command: "zsh -l",
      metadata: shellPane.metadata,
      split: "vertical",
    });

    assert.strictEqual(parsed.split, "vertical");
    assert.strictEqual(parsed.metadata?.kind, "shell");
  }),
);

it.effect("decodes native Neovim pane bridge input with bootstrap context fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeNeovimPaneInput({
      actor: workspace.grants[0]!.actor,
      workspaceId: "workspace-1",
      windowId: "window-1",
      cwd: "/workspace/project-1",
      files: ["/workspace/project-1/README.md"],
      line: 12,
      column: 4,
      profileId: "fenrir-dark",
      split: "vertical",
      launchSource: "restore",
    });

    assert.strictEqual(parsed.profileId, "fenrir-dark");
    assert.strictEqual(parsed.launchSource, "restore");
    assert.deepStrictEqual(parsed.files, ["/workspace/project-1/README.md"]);
  }),
);

it.effect("rejects pane creation input with mismatched top-level kind and metadata kind", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePaneCreateInput({
        actor: workspace.grants[0]!.actor,
        workspaceId: "workspace-1",
        windowId: "window-1",
        kind: "shell",
        cwd: "/workspace/project-1",
        metadata: {
          ...shellPane.metadata,
          kind: "workflow",
          workflow: {
            workflowId: "workflow-1",
            runId: "run-1",
            stepId: null,
            threadId: "thread-1",
          },
        },
        split: "vertical",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects pane resize below minimum dimensions", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePaneResizeInput({
        actor: workspace.grants[0]!.actor,
        workspaceId: "workspace-1",
        paneId: "pane-1",
        cols: 19,
        rows: 4,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects oversized pane writes so input is not an unbounded hot path", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePaneWriteInput({
        workspaceId: "workspace-1",
        paneId: "pane-1",
        requestId: "write-1",
        actor: workspace.grants[0]!.actor,
        data: "x".repeat(65_537),
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes pane write input with correlation id", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePaneWriteInput({
      workspaceId: "workspace-1",
      paneId: "pane-1",
      requestId: "write-1",
      actor: workspace.grants[0]!.actor,
      data: "echo hello\n",
    });

    assert.strictEqual(parsed.requestId, "write-1");
    assert.strictEqual(parsed.actor.subject, "owner");
    assert.strictEqual(parsed.data, "echo hello\n");
  }),
);

it.effect("decodes pane write accepted and rejected acknowledgements", () =>
  Effect.gen(function* () {
    const accepted = yield* decodePaneWriteResult({
      type: "accepted",
      workspaceId: "workspace-1",
      paneId: "pane-1",
      requestId: "write-1",
      inputSeq: 21,
      acceptedAt: now,
    });
    assert.strictEqual(accepted.type, "accepted");
    assert.strictEqual(accepted.inputSeq, 21);

    const rejected = yield* decodePaneWriteResult({
      type: "rejected",
      workspaceId: "workspace-1",
      paneId: "pane-1",
      requestId: "write-2",
      code: "backpressure",
      message: "pane input queue is full",
      rejectedAt: now,
    });
    assert.strictEqual(rejected.type, "rejected");
    assert.strictEqual(rejected.code, "backpressure");
  }),
);

it.effect("decodes pane stream subscription replay and slow-client policy", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePaneStreamSubscribeInput({
      workspaceId: "workspace-1",
      paneId: "pane-1",
      actor: workspace.grants[0]!.actor,
      afterSeq: 12,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 500,
    });

    assert.strictEqual(parsed.afterSeq, 12);
    assert.strictEqual(parsed.actor.subject, "owner");
    assert.strictEqual(parsed.slowClientPolicy, "fast-forward");
  }),
);

it.effect("decodes pane stream gap, overflow, and closed events", () =>
  Effect.gen(function* () {
    const gap = yield* decodePaneStreamEvent({
      type: "gap",
      descriptor: stream,
      requestedAfterSeq: 1,
      resumedAtSeq: 10,
      reason: "buffer-overflow",
    });
    assert.strictEqual(gap.type, "gap");

    const overflow = yield* decodePaneStreamEvent({
      type: "overflow",
      descriptor: stream,
      droppedCount: 3,
      policy: "close",
      reason: "slow-client",
    });
    assert.strictEqual(overflow.type, "overflow");

    const closed = yield* decodePaneStreamEvent({
      type: "closed",
      descriptor: stream,
      reason: "permission-revoked",
    });
    assert.strictEqual(closed.type, "closed");
  }),
);

it.effect("decodes kernel lifecycle events without carrying pane bytes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeKernelEvent({
      type: "pane.stream-overflow",
      revision: 9,
      workspaceId: "workspace-1",
      occurredAt: now,
      paneId: "pane-1",
      stream,
      reason: "slow-client",
    });

    assert.strictEqual(parsed.type, "pane.stream-overflow");
    assert.strictEqual(parsed.stream.highSeq, 20);
  }),
);

it("constructs typed tmux kernel errors with explicit permission failures", () => {
  const error = new TmuxKernelError({
    code: "permission-denied",
    message: "pane write is not permitted",
  });

  assert.strictEqual(error._tag, "TmuxKernelError");
  assert.strictEqual(error.code, "permission-denied");
  assert.strictEqual(error.message, "pane write is not permitted");
});
