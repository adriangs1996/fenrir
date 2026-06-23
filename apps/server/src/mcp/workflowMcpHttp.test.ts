import {
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type WorkflowDraft,
  WorkflowId,
  WorkflowRunId,
  type WorkflowRunSnapshot,
  type WorkflowThreadSummary,
} from "@fenrir/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  type WorkflowCollaborationStatePatchInput,
  type WorkflowServiceShape,
} from "../workflows/Services/Workflow.ts";
import { callWorkflowMcpTool } from "./workflowMcpHttp.ts";

const projectId = ProjectId.make("project-1");
const originThreadId = ThreadId.make("thread-1");
const tn = TrimmedNonEmptyString.make;

function makeWorkflow(
  input: {
    readonly workflowId?: string | undefined;
    readonly originThreadId?: ThreadId | undefined;
    readonly status?: WorkflowDraft["status"] | undefined;
    readonly archivedAt?: string | null | undefined;
  } = {},
): WorkflowDraft {
  const now = "2026-06-22T12:00:00.000Z";
  return {
    workflowId: WorkflowId.make(input.workflowId ?? "workflow-1"),
    projectId,
    originThreadId: input.originThreadId ?? originThreadId,
    name: tn("Workflow"),
    description: null,
    source: "export default async function run() {}",
    sourceHash: tn("source-hash"),
    status: input.status ?? "validated",
    validationStatus: "valid",
    validationError: null,
    createdAt: now as any,
    updatedAt: now as any,
    archivedAt: (input.archivedAt ?? null) as any,
  };
}

function makeSummary(workflow: WorkflowDraft): WorkflowThreadSummary {
  return {
    workflow,
    latestRun: null,
    activeRunCount: 0 as WorkflowThreadSummary["activeRunCount"],
    pendingInputCount: 0 as WorkflowThreadSummary["pendingInputCount"],
  };
}

function makeRun(input: {
  readonly runId: string;
  readonly projectId?: ProjectId | undefined;
  readonly originThreadId?: ThreadId | undefined;
}): WorkflowRunSnapshot {
  const now = "2026-06-22T12:00:00.000Z";
  return {
    runId: WorkflowRunId.make(input.runId),
    workflowId: WorkflowId.make("workflow-1"),
    projectId: input.projectId ?? projectId,
    originThreadId: input.originThreadId ?? originThreadId,
    name: "Workflow",
    args: null,
    sourceHash: "source-hash" as any,
    status: "running",
    summary: null,
    startedAt: now as any,
    completedAt: null,
    lastUpdatedAt: now as any,
    steps: [],
    agents: [],
    tasks: [],
    inputRequests: [],
    state: [],
  };
}

describe("callWorkflowMcpTool", () => {
  it("rejects workflow_get_status for runs outside the MCP thread context", async () => {
    const run = makeRun({
      runId: "run-other-thread",
      originThreadId: ThreadId.make("thread-other"),
    });
    const workflows = {
      getRun: () => Effect.succeed(run),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_get_status",
          { projectId, originThreadId },
          { workflowRunId: run.runId },
        ),
      ),
    ).rejects.toThrow("Workflow run does not belong to the current MCP thread context.");
  });

  it("verifies ownership before workflow_stop", async () => {
    const run = makeRun({ runId: "run-owned" });
    let stopCount = 0;
    const workflows = {
      getRun: () => Effect.succeed(run),
      stop: () =>
        Effect.sync(() => {
          stopCount += 1;
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_stop",
          { projectId, originThreadId },
          { workflowRunId: run.runId },
        ),
      ),
    ).resolves.toEqual({ stopped: true });
    expect(stopCount).toBe(1);
  });

  it("verifies ownership before workflow_archive_draft", async () => {
    let archiveCount = 0;
    const workflows = {
      listThread: () => Effect.succeed({ workflows: [], runs: [] }),
      archive: () =>
        Effect.sync(() => {
          archiveCount += 1;
          return { workflow: makeWorkflow({ status: "archived" }) };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_archive_draft",
          { projectId, originThreadId },
          { workflowId: WorkflowId.make("workflow-other") },
        ),
      ),
    ).rejects.toThrow("Workflow draft does not belong to the current MCP thread context.");
    expect(archiveCount).toBe(0);
  });

  it("archives owned workflow drafts from the management MCP context", async () => {
    const owned = makeWorkflow({ workflowId: "workflow-owned" });
    let archivedWorkflowId: WorkflowId | null = null;
    const workflows = {
      listThread: () => Effect.succeed({ workflows: [makeSummary(owned)], runs: [] }),
      archive: (input: { workflowId: WorkflowId }) =>
        Effect.sync(() => {
          archivedWorkflowId = input.workflowId;
          return {
            workflow: makeWorkflow({
              workflowId: input.workflowId,
              status: "archived",
              archivedAt: "2026-06-22T12:05:00.000Z",
            }),
          };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_archive_draft",
          { projectId, originThreadId },
          { workflowId: owned.workflowId },
        ),
      ),
    ).resolves.toMatchObject({
      workflow: {
        workflowId: owned.workflowId,
        status: "archived",
      },
    });
    expect(archivedWorkflowId).toBe(owned.workflowId);
  });

  it("verifies ownership before workflow_update_draft", async () => {
    let syncCount = 0;
    let validateCount = 0;
    const workflows = {
      listThread: () => Effect.succeed({ workflows: [], runs: [] }),
      syncSource: () =>
        Effect.sync(() => {
          syncCount += 1;
          return { workflow: makeWorkflow() };
        }),
      validate: () =>
        Effect.sync(() => {
          validateCount += 1;
          return { workflow: makeWorkflow() };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_update_draft",
          { projectId, originThreadId },
          {
            workflowId: WorkflowId.make("workflow-other"),
            source: "export default async function run() {}",
          },
        ),
      ),
    ).rejects.toThrow("Workflow draft does not belong to the current MCP thread context.");
    expect(syncCount).toBe(0);
    expect(validateCount).toBe(0);
  });

  it("updates and revalidates owned workflow drafts from the management MCP context", async () => {
    const owned = makeWorkflow({
      workflowId: "workflow-owned",
      status: "invalid",
    });
    const replacementSource = "export default async function run() { return true; }";
    const calls: string[] = [];
    const workflows = {
      listThread: () => Effect.succeed({ workflows: [makeSummary(owned)], runs: [] }),
      syncSource: (input: { workflowId: WorkflowId; source: string }) =>
        Effect.sync(() => {
          calls.push(`sync:${input.workflowId}:${input.source}`);
          return {
            workflow: {
              ...owned,
              source: input.source,
              status: "draft",
              validationStatus: "pending",
            },
          };
        }),
      validate: (input: { workflowId: WorkflowId }) =>
        Effect.sync(() => {
          calls.push(`validate:${input.workflowId}`);
          return {
            workflow: {
              ...owned,
              source: replacementSource,
              status: "validated",
              validationStatus: "valid",
            },
          };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_update_draft",
          { projectId, originThreadId },
          {
            workflowId: owned.workflowId,
            source: replacementSource,
          },
        ),
      ),
    ).resolves.toMatchObject({
      workflow: {
        workflowId: owned.workflowId,
        source: replacementSource,
        status: "validated",
        validationStatus: "valid",
      },
    });
    expect(calls).toEqual([
      `sync:${owned.workflowId}:${replacementSource}`,
      `validate:${owned.workflowId}`,
    ]);
  });

  it("rejects collaboration tools in management mode before calling the service", async () => {
    let patchCount = 0;
    const workflows = {
      collaborationStatePatch: () =>
        Effect.sync(() => {
          patchCount += 1;
          return makeRun({ runId: "run-unreachable" });
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_state_patch",
          {
            projectId,
            originThreadId,
            workflowRunId: WorkflowRunId.make("run-1"),
            agentName: "planner",
          },
          { patch: { ready: true } },
        ),
      ),
    ).rejects.toThrow("Workflow tool workflow_state_patch is not available in management mode.");
    expect(patchCount).toBe(0);
  });

  it("rejects management tools in collaboration mode before calling the service", async () => {
    let createCount = 0;
    const workflows = {
      createDraft: () =>
        Effect.sync(() => {
          createCount += 1;
          throw new Error("createDraft should not be called");
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_create_draft",
          {
            projectId,
            originThreadId,
            mode: "collaboration",
            workflowRunId: WorkflowRunId.make("run-1"),
            agentName: "planner",
          },
          {},
        ),
      ),
    ).rejects.toThrow(
      "Workflow tool workflow_create_draft is not available in collaboration mode.",
    );
    expect(createCount).toBe(0);
  });

  it("defaults collaboration state patches to the workflow-readable state scope", async () => {
    let capturedScope: string | null = null;
    const runIdValue = "run-collaboration";
    const runId = WorkflowRunId.make(runIdValue);
    const workflows = {
      collaborationStatePatch: (input: WorkflowCollaborationStatePatchInput) =>
        Effect.sync(() => {
          capturedScope = input.scope;
          return makeRun({ runId: runIdValue });
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_state_patch",
          {
            projectId,
            originThreadId,
            mode: "collaboration",
            workflowRunId: runId,
            agentName: "planner",
          },
          { patch: { ready: true } },
        ),
      ),
    ).resolves.toMatchObject({ runId });
    expect(capturedScope).toBe("workflow");
  });
});
