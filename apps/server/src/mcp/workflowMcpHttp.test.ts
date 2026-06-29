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
  type WorkflowCollaborationProposeTaskInput,
  type WorkflowCollaborationStatePatchInput,
  type WorkflowServiceShape,
} from "../workflows/Services/Workflow.ts";
import { callWorkflowMcpTool } from "./workflowMcpHttp.ts";
import {
  issueWorkflowReferenceReceipt,
  WORKFLOW_REFERENCE_TOKEN_TTL_MS,
  WORKFLOW_REFERENCE_VERSION,
  WORKFLOW_RUNTIME_API_REGISTRY,
} from "./workflowReference.ts";

const projectId = ProjectId.make("project-1");
const originThreadId = ThreadId.make("thread-1");
const tn = TrimmedNonEmptyString.make;

interface ReferenceReceipt {
  readonly referenceVersion: string;
  readonly readToken: string;
}

function requireReferenceReceipt(value: unknown): ReferenceReceipt {
  if (
    typeof value === "object" &&
    value !== null &&
    "referenceVersion" in value &&
    "readToken" in value &&
    typeof value.referenceVersion === "string" &&
    typeof value.readToken === "string"
  ) {
    return {
      referenceVersion: value.referenceVersion,
      readToken: value.readToken,
    };
  }
  throw new Error(`Invalid reference receipt: ${JSON.stringify(value)}`);
}

async function readReferenceReceipt(mcpSessionId: string): Promise<ReferenceReceipt> {
  const result = await Effect.runPromise(
    callWorkflowMcpTool(
      {} as unknown as WorkflowServiceShape,
      "workflow_reference",
      { projectId, originThreadId, mcpSessionId },
      { format: "json" },
    ),
  );
  return requireReferenceReceipt(result);
}

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
  it("returns the workflow runtime API reference in markdown and JSON", async () => {
    const markdown = await Effect.runPromise(
      callWorkflowMcpTool(
        {} as unknown as WorkflowServiceShape,
        "workflow_reference",
        { projectId, originThreadId, mcpSessionId: "reference-markdown" },
        { format: "markdown", section: "ctx" },
      ),
    );
    expect(markdown).toMatchObject({
      referenceVersion: WORKFLOW_REFERENCE_VERSION,
    });
    expect(String((markdown as { content: unknown }).content)).toContain("ctx.step");
    expect(String((markdown as { content: unknown }).content)).toContain("ctx.context.build");

    const json = await Effect.runPromise(
      callWorkflowMcpTool(
        {} as unknown as WorkflowServiceShape,
        "workflow_reference",
        { projectId, originThreadId, mcpSessionId: "reference-json" },
        { format: "json", section: "ctx" },
      ),
    );
    const content = (json as { content: { ctx?: ReadonlyArray<{ name: string }> } }).content;
    expect(content.ctx?.map((entry) => entry.name)).toEqual(
      WORKFLOW_RUNTIME_API_REGISTRY.map((entry) => entry.name),
    );
  });

  it("rejects workflow_create without a workflow_reference receipt", async () => {
    let createCount = 0;
    const workflows = {
      createDraft: () =>
        Effect.sync(() => {
          createCount += 1;
          return { workflow: makeWorkflow() };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_create",
          { projectId, originThreadId, mcpSessionId: "create-without-reference" },
          {
            name: "Workflow",
            referenceVersion: WORKFLOW_REFERENCE_VERSION,
            readToken: "missing-token",
            source: "export default async function run() {}",
          },
        ),
      ),
    ).rejects.toThrow("Call workflow_reference before creating or updating workflow source.");
    expect(createCount).toBe(0);
  });

  it("creates workflows after reading workflow_reference in the same MCP session", async () => {
    const receipt = await readReferenceReceipt("create-with-reference");
    let capturedSource: string | null = null;
    const workflows = {
      createDraft: (input: { source: string }) =>
        Effect.sync(() => {
          capturedSource = input.source;
          return { workflow: makeWorkflow() };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_create",
          { projectId, originThreadId, mcpSessionId: "create-with-reference" },
          {
            name: "Workflow",
            ...receipt,
            source: "export default async function run(ctx) { await ctx.log('ok'); }",
          },
        ),
      ),
    ).resolves.toMatchObject({ workflow: { workflowId: WorkflowId.make("workflow-1") } });
    expect(capturedSource).toContain("ctx.log");
  });

  it("rejects workflow_update when the reference token belongs to another MCP session", async () => {
    const receipt = await readReferenceReceipt("reference-owner-session");
    let syncCount = 0;
    const workflows = {
      syncSource: () =>
        Effect.sync(() => {
          syncCount += 1;
          return { workflow: makeWorkflow() };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_update",
          { projectId, originThreadId, mcpSessionId: "reference-other-session" },
          {
            workflowId: WorkflowId.make("workflow-1"),
            ...receipt,
            source: "export default async function run() {}",
          },
        ),
      ),
    ).rejects.toThrow("Call workflow_reference before creating or updating workflow source.");
    expect(syncCount).toBe(0);
  });

  it("rejects expired workflow_reference tokens", async () => {
    const receipt = issueWorkflowReferenceReceipt(
      "expired-reference-session",
      new Date(Date.now() - WORKFLOW_REFERENCE_TOKEN_TTL_MS - 1_000),
    );
    let syncCount = 0;
    const workflows = {
      syncSource: () =>
        Effect.sync(() => {
          syncCount += 1;
          return { workflow: makeWorkflow() };
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_update",
          { projectId, originThreadId, mcpSessionId: "expired-reference-session" },
          {
            workflowId: WorkflowId.make("workflow-1"),
            referenceVersion: receipt.referenceVersion,
            readToken: receipt.readToken,
            source: "export default async function run() {}",
          },
        ),
      ),
    ).rejects.toThrow("Workflow reference token expired.");
    expect(syncCount).toBe(0);
  });

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
    const mcpSessionId = "update-ownership-reference";
    const receipt = await readReferenceReceipt(mcpSessionId);
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
          { projectId, originThreadId, mcpSessionId },
          {
            workflowId: WorkflowId.make("workflow-other"),
            ...receipt,
            source: "export default async function run() {}",
          },
        ),
      ),
    ).rejects.toThrow("Workflow draft does not belong to the current MCP thread context.");
    expect(syncCount).toBe(0);
    expect(validateCount).toBe(0);
  });

  it("updates and revalidates owned workflow drafts from the management MCP context", async () => {
    const mcpSessionId = "update-owned-reference";
    const receipt = await readReferenceReceipt(mcpSessionId);
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
          { projectId, originThreadId, mcpSessionId },
          {
            workflowId: owned.workflowId,
            ...receipt,
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

  it("accepts review task proposals from collaboration MCP tools", async () => {
    const runIdValue = "run-review-task";
    const runId = WorkflowRunId.make(runIdValue);
    let capturedKind: WorkflowCollaborationProposeTaskInput["kind"] | null = null;
    const workflows = {
      collaborationProposeTask: (input: WorkflowCollaborationProposeTaskInput) =>
        Effect.sync(() => {
          capturedKind = input.kind;
          return makeRun({ runId: runIdValue });
        }),
    } as unknown as WorkflowServiceShape;

    await expect(
      Effect.runPromise(
        callWorkflowMcpTool(
          workflows,
          "workflow_propose_task",
          {
            projectId,
            originThreadId,
            mode: "collaboration",
            workflowRunId: runId,
            agentName: "reviewer",
          },
          {
            title: "Review proposed changes",
            kind: "review",
            prompt: "Review the completed implementation.",
          },
        ),
      ),
    ).resolves.toMatchObject({ runId });
    expect(capturedKind).toBe("review");
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
