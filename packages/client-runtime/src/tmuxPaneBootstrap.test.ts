import {
  AuthSessionId,
  ProjectId,
  TmuxPaneId,
  TmuxPaneStreamId,
  TmuxWindowId,
  TmuxWorkspaceId,
} from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import {
  NEOVIM_BOOTSTRAP_ENV_KEYS,
  createNeovimOpenFileInput,
  createNeovimPaneBootstrapInput,
  createPaneStreamSubscribeInput,
  findRunningNeovimPane,
  isMatchingNeovimPane,
} from "./tmuxPaneBootstrap";

const actor = {
  sessionId: AuthSessionId.make("auth-session-1"),
  subject: "owner",
};
const workspaceId = TmuxWorkspaceId.make("workspace-1");
const windowId = TmuxWindowId.make("window-1");
const paneId = TmuxPaneId.make("pane-1");
const now = "2026-01-01T00:00:00.000Z";

const neovimPane = {
  paneId,
  workspaceId,
  windowId,
  tmuxPaneId: "%1",
  cwd: "/workspace/project",
  cols: 120,
  rows: 40,
  status: "running" as const,
  metadata: {
    kind: "neovim" as const,
    title: "Neovim",
    process: {
      command: "env FENRIR_WORKSPACE_ID='workspace-1' nvim -- README.md",
      argv: ["nvim", "/workspace/project/README.md"],
      envKeys: [...NEOVIM_BOOTSTRAP_ENV_KEYS],
      pid: null,
      startedAt: now,
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
    },
    labels: {
      "fenrir.process.kind": "neovim",
      "fenrir.neovim.bootstrapId": "nvim-bootstrap-1",
      "fenrir.neovim.profileId": "fenrir-dark",
      "fenrir.neovim.themeId": "fenrir-dark",
      "fenrir.neovim.keybindingProfileId": "native-compatible",
      "fenrir.neovim.bridge": "nvim-listen-address",
      "fenrir.neovim.bridgeSocketPath": "/tmp/fenrir-nvim-bootstrap-1.sock",
    },
    neovim: {
      bootstrapId: "nvim-bootstrap-1",
      workspaceId,
      windowId,
      cwd: "/workspace/project",
      profileId: "fenrir-dark",
      themeId: "fenrir-dark",
      keybindingProfileId: "native-compatible",
      bridgeSocketPath: "/tmp/fenrir-nvim-bootstrap-1.sock",
      files: ["/workspace/project/README.md"],
      line: 12,
      column: 4,
      launchSource: "user" as const,
      bootstrapEnvKeys: [...NEOVIM_BOOTSTRAP_ENV_KEYS],
    },
    agent: null,
    workflow: null,
    managedProcess: null,
    remoteProcess: null,
    browserLab: null,
  },
  stream: {
    streamId: TmuxPaneStreamId.make("stream-1"),
    paneId,
    encoding: "utf8" as const,
    lowSeq: 10,
    highSeq: 20,
    droppedCount: 0,
    backfillAvailable: true,
    maxChunkBytes: 65_536,
  },
  createdAt: now,
  updatedAt: now,
};

describe("tmux pane bootstrap helpers", () => {
  it("creates explicit Neovim bootstrap inputs for native clients", () => {
    expect(
      createNeovimPaneBootstrapInput({
        actor,
        workspaceId,
        windowId,
        cwd: "/workspace/project",
        files: ["/workspace/project/README.md"],
      }),
    ).toEqual({
      actor,
      workspaceId,
      windowId,
      cwd: "/workspace/project",
      files: ["/workspace/project/README.md"],
      profileId: "default",
      themeId: "fenrir-dark",
      keybindingProfileId: "native-compatible",
      split: "horizontal",
      launchSource: "user",
    });
  });

  it("creates open file requests with cursor and native metadata defaults", () => {
    expect(
      createNeovimOpenFileInput({
        actor,
        workspaceId,
        windowId,
        cwd: "/workspace/project",
        file: "/workspace/project/src/App.tsx",
        line: 40,
        column: 8,
        profileId: "fenrir-dark",
        themeId: "fenrir-dark-high-contrast",
        keybindingProfileId: "vim-tmux-navigator",
      }),
    ).toEqual({
      actor,
      workspaceId,
      windowId,
      cwd: "/workspace/project",
      files: ["/workspace/project/src/App.tsx"],
      line: 40,
      column: 8,
      profileId: "fenrir-dark",
      themeId: "fenrir-dark-high-contrast",
      keybindingProfileId: "vim-tmux-navigator",
      split: "horizontal",
      launchSource: "user",
    });
  });

  it("finds the running Neovim pane that matches bootstrap context", () => {
    const input = {
      actor,
      workspaceId,
      windowId,
      files: ["/workspace/project/README.md"],
      line: 12,
      column: 4,
      profileId: "fenrir-dark",
    };

    expect(isMatchingNeovimPane(neovimPane, input)).toBe(true);
    expect(
      findRunningNeovimPane(
        {
          workspace: {
            workspaceId,
            projectId: ProjectId.make("project-1"),
            tmuxSessionName: "fenrir-ws-project-1",
            cwd: "/workspace/project",
            status: "running",
            activeWindowId: windowId,
            grants: [],
            createdAt: now,
            updatedAt: now,
          },
          windows: [],
          panes: [neovimPane],
          revision: 1,
        },
        input,
      ),
    ).toBe(neovimPane);
    expect(
      isMatchingNeovimPane(neovimPane, {
        ...input,
        files: ["/workspace/project/other.ts"],
      }),
    ).toBe(false);
  });

  it("builds pane stream subscribe inputs with replay and slow-client defaults", () => {
    expect(
      createPaneStreamSubscribeInput({
        actor,
        pane: neovimPane,
        afterSeq: 12,
      }),
    ).toEqual({
      actor,
      workspaceId,
      paneId,
      afterSeq: 12,
      backfill: "from-seq",
      slowClientPolicy: "fast-forward",
      maxBufferedChunks: 512,
    });
  });
});
