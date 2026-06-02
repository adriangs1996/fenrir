import { scopeProjectRef } from "@fenrir/client-runtime";
import { EnvironmentId, ProjectId, ThreadId } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import {
  selectActionRunsForProject,
  stripActionRunControlSequences,
  type ActionRun,
} from "./actionRunStore";
import { buildTmuxActionCommand } from "./actionRunCommand";

const environmentId = EnvironmentId.make("environment-1");
const otherEnvironmentId = EnvironmentId.make("environment-2");
const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");

function makeRun(input: {
  id: string;
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  threadId: ThreadId;
  createdAt: string;
}): ActionRun {
  return {
    id: input.id,
    threadKey: `${input.environmentId ?? environmentId}:${input.threadId}`,
    environmentId: input.environmentId ?? environmentId,
    threadId: input.threadId,
    projectId: input.projectId ?? projectId,
    source: "project",
    scriptId: "script-1",
    scriptName: "Script",
    command: "echo ok",
    cwd: "/workspace/project",
    tmuxProjectId: `action-run-${input.id}`,
    status: "running",
    createdAt: input.createdAt,
    startedAt: input.createdAt,
    completedAt: null,
    exitCode: null,
    outputTail: "",
    errorMessage: null,
    placeholderNames: [],
    cancelRequested: false,
    receiptDismissed: false,
    updatedAt: input.createdAt,
  };
}

describe("stripActionRunControlSequences", () => {
  it("removes ANSI control sequences from compact action output", () => {
    expect(stripActionRunControlSequences("\u001b[32mPassed\u001b[0m\u001b[K\rDone")).toBe(
      "Passed\nDone",
    );
  });
});

describe("buildTmuxActionCommand", () => {
  it("clears inherited tmux environment before running the action", () => {
    const command = buildTmuxActionCommand({
      runId: "run-1",
      name: "Quit Projects",
      command: "./projects down",
    });

    expect(command).toContain("unset TMUX TMUX_PANE");
    expect(command.indexOf("unset TMUX TMUX_PANE")).toBeLessThan(command.indexOf("sh -lc"));
  });
});

describe("selectActionRunsForProject", () => {
  it("selects runs across threads in the same project and environment", () => {
    const runs = [
      makeRun({
        id: "same-project-newer",
        threadId: ThreadId.make("thread-2"),
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
      makeRun({
        id: "same-project-older",
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
      makeRun({
        id: "other-project",
        projectId: otherProjectId,
        threadId: ThreadId.make("thread-3"),
        createdAt: "2026-01-01T00:00:03.000Z",
      }),
      makeRun({
        id: "other-environment",
        environmentId: otherEnvironmentId,
        threadId: ThreadId.make("thread-4"),
        createdAt: "2026-01-01T00:00:04.000Z",
      }),
    ];

    const selected = selectActionRunsForProject(
      { runsById: Object.fromEntries(runs.map((run) => [run.id, run])) },
      scopeProjectRef(environmentId, projectId),
    );

    expect(selected.map((run) => run.id)).toEqual(["same-project-newer", "same-project-older"]);
  });
});
