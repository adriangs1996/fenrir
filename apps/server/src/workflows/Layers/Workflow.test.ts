import { existsSync, readdirSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type WorkflowDraft,
  type WorkflowRunId,
  type WorkflowRunSnapshot,
} from "@fenrir/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkflowRepositoryLive } from "../../persistence/Layers/WorkflowRepository.ts";
import { WorkflowRepository } from "../../persistence/Services/WorkflowRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { WorkflowService, type WorkflowServiceShape } from "../Services/Workflow.ts";
import { WorkflowLive } from "./Workflow.ts";

const projectId = ProjectId.make("workflow-runtime-project");
const originThreadId = ThreadId.make("workflow-runtime-thread");
const tn = TrimmedNonEmptyString.make;

function makeWorkflowRuntime() {
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "fenrir-workflow-runtime-test-",
  });
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  );
  const layer = WorkflowLive.pipe(
    Layer.provideMerge(WorkflowRepositoryLive),
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  return ManagedRuntime.make(layer);
}

function resolveElectronBinaryForWorkflowTest(): string | null {
  const binaryRelativePath =
    process.platform === "darwin"
      ? nodePath.join("dist", "Electron.app", "Contents", "MacOS", "Electron")
      : process.platform === "win32"
        ? nodePath.join("dist", "electron.exe")
        : nodePath.join("dist", "electron");
  const directCandidate = nodePath.join(
    process.cwd(),
    "node_modules",
    "electron",
    binaryRelativePath,
  );
  if (existsSync(directCandidate)) {
    return directCandidate;
  }
  const bunStore = nodePath.join(process.cwd(), "node_modules", ".bun");
  if (!existsSync(bunStore)) {
    return null;
  }
  for (const entry of readdirSync(bunStore)) {
    if (!entry.startsWith("electron@")) {
      continue;
    }
    const candidate = nodePath.join(
      bunStore,
      entry,
      "node_modules",
      "electron",
      binaryRelativePath,
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function restoreEnvVar(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(
  workflow: WorkflowServiceShape,
  runId: WorkflowRunId,
  predicate: (run: WorkflowRunSnapshot) => boolean,
  label: string,
) {
  let lastRun: WorkflowRunSnapshot | null = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const run = await Effect.runPromise(workflow.getRun({ runId }));
    lastRun = run;
    if (predicate(run)) {
      return run;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for workflow run ${label}: ${JSON.stringify(lastRun)}`);
}

async function waitForWorkflow(
  workflow: WorkflowServiceShape,
  workflowId: WorkflowDraft["workflowId"],
  predicate: (workflow: WorkflowDraft) => boolean,
  label: string,
) {
  let lastWorkflow: WorkflowDraft | null = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const snapshot = await Effect.runPromise(workflow.listThread({ projectId, originThreadId }));
    const current = snapshot.workflows.find(
      (summary) => summary.workflow.workflowId === workflowId,
    )?.workflow;
    lastWorkflow = current ?? null;
    if (current && predicate(current)) {
      return current;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for workflow ${label}: ${JSON.stringify(lastWorkflow)}`);
}

function getStateValue(run: WorkflowRunSnapshot, key: string, scope = "workflow") {
  return run.state.find((entry) => entry.scope === scope && entry.key === key)?.value;
}

describe("WorkflowLive runtime integration", () => {
  it("requires persisted validation before running an explicitly selected workflow", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Validated Gate"),
          source: `
export default async function run(ctx) {
  await ctx.log("initial");
}
`,
        }),
      );

      const synced = await Effect.runPromise(
        workflow.syncSource({
          workflowId: draft.workflow.workflowId,
          source: `
export default async function run(ctx) {
  await ctx.state.set("ran", true);
}
`,
        }),
      );

      expect(synced.workflow.validationStatus).toBe("pending");
      await expect(
        Effect.runPromise(
          workflow.run({
            projectId,
            originThreadId,
            workflowId: draft.workflow.workflowId,
          }),
        ),
      ).rejects.toThrow("Workflow must be validated before running.");

      const validated = await Effect.runPromise(
        workflow.validate({ workflowId: draft.workflow.workflowId }),
      );
      expect(validated.workflow.validationStatus).toBe("valid");

      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const completed = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "completed",
        "validated workflow completion",
      );
      expect(getStateValue(completed, "ran")).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("starts the isolated workflow runtime in Electron Node mode", async () => {
    const electronBinary = resolveElectronBinaryForWorkflowTest();
    if (!electronBinary) {
      return;
    }
    const previousWorkflowNodePath = process.env.FENRIR_WORKFLOW_NODE_PATH;
    const previousElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    process.env.FENRIR_WORKFLOW_NODE_PATH = electronBinary;
    process.env.ELECTRON_RUN_AS_NODE = "1";

    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Electron Node Runtime"),
          source: `
export default async function run(ctx) {
  await ctx.state.set("electron-node-runtime", true);
}
`,
        }),
      );

      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const completed = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "completed",
        "electron node runtime completion",
      );
      expect(getStateValue(completed, "electron-node-runtime")).toBe(true);
    } finally {
      await runtime.dispose();
      restoreEnvVar("FENRIR_WORKFLOW_NODE_PATH", previousWorkflowNodePath);
      restoreEnvVar("ELECTRON_RUN_AS_NODE", previousElectronRunAsNode);
    }
  });

  it("passes an empty args object to workflow JavaScript when run args are omitted", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Default Args"),
          source: `
export default async function run(ctx, args) {
  const maxIterations = args.maxIterations ?? 3;
  await ctx.state.set("maxIterations", maxIterations);
}
`,
        }),
      );

      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const completed = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "completed",
        "default args completion",
      );
      expect(completed.args).toBeNull();
      expect(getStateValue(completed, "maxIterations")).toBe(3);
    } finally {
      await runtime.dispose();
    }
  });

  it("links workflows created from a thread and runs them manually without an active thread", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const repo = await runtime.runPromise(Effect.service(WorkflowRepository));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Project Manual Run"),
          source: `
export default async function run(ctx) {
  await ctx.state.set("project-run", true);
}
`,
        }),
      );

      const links = await Effect.runPromise(
        repo.listThreadLinks({ projectId, threadId: originThreadId }),
      );
      expect(links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflowId: draft.workflow.workflowId,
            relation: "created_from",
            threadId: originThreadId,
          }),
        ]),
      );

      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const completed = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "completed",
        "project manual run completion",
      );

      expect(completed.trigger).toBe("manual");
      expect(completed.requestedByThreadId).toBeNull();
      expect(completed.originThreadId).toBe(originThreadId);
      expect(getStateValue(completed, "project-run")).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("archives invalid workflow drafts and removes them from the thread list", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Invalid Draft"),
          source: `
export default function run(ctx) {
  return ctx;
}
`,
        }),
      );

      expect(draft.workflow.validationStatus).toBe("invalid");

      const archived = await Effect.runPromise(
        workflow.archive({ workflowId: draft.workflow.workflowId }),
      );
      expect(archived.workflow.status).toBe("archived");
      expect(archived.workflow.archivedAt).not.toBeNull();

      const listed = await Effect.runPromise(workflow.listThread({ projectId, originThreadId }));
      expect(
        listed.workflows.some(
          (summary) => summary.workflow.workflowId === draft.workflow.workflowId,
        ),
      ).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("updates invalid draft source in place instead of creating duplicate workflow entries", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Iterated Draft"),
          source: `
export default function run(ctx) {
  return ctx;
}
`,
        }),
      );
      expect(draft.workflow.validationStatus).toBe("invalid");

      const replacementSource = `
export default async function run(ctx) {
  await ctx.log("fixed");
}
`;
      const synced = await Effect.runPromise(
        workflow.syncSource({
          workflowId: draft.workflow.workflowId,
          source: replacementSource,
        }),
      );
      expect(synced.workflow.workflowId).toBe(draft.workflow.workflowId);
      expect(synced.workflow.validationStatus).toBe("pending");

      const validated = await Effect.runPromise(
        workflow.validate({ workflowId: draft.workflow.workflowId }),
      );
      expect(validated.workflow.workflowId).toBe(draft.workflow.workflowId);
      expect(validated.workflow.status).toBe("validated");

      const listed = await Effect.runPromise(workflow.listThread({ projectId, originThreadId }));
      expect(listed.workflows.map((summary) => summary.workflow.workflowId)).toEqual([
        draft.workflow.workflowId,
      ]);
      expect(listed.workflows[0]?.workflow.validationStatus).toBe("valid");
    } finally {
      await runtime.dispose();
    }
  });

  it("revalidates opened workflow source automatically after editor saves", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Open And Save"),
          source: `
export default function run(ctx) {
  return ctx;
}
`,
        }),
      );
      expect(draft.workflow.validationStatus).toBe("invalid");

      const opened = await Effect.runPromise(
        workflow.openSource({ workflowId: draft.workflow.workflowId }),
      );
      const replacementSource = `
export default async function run(ctx) {
  await ctx.log("saved");
}
`;
      await nodeFs.writeFile(opened.path, replacementSource, "utf8");

      const validated = await waitForWorkflow(
        workflow,
        draft.workflow.workflowId,
        (current) =>
          current.source === replacementSource &&
          current.status === "validated" &&
          current.validationStatus === "valid",
        "opened source revalidation",
      );
      expect(validated.workflowId).toBe(draft.workflow.workflowId);
      expect(validated.validationError).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("runs workflow JavaScript in the isolated runtime and preserves parallel step provenance", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Parallel Provenance"),
          description: "Exercises runtime ctx calls from parallel steps.",
          source: `
export default async function run(ctx, args) {
  await ctx.parallel(["alpha", "beta"], async (name) => {
    await ctx.step(name, async () => {
      await ctx.log("step:" + name);
      await ctx.state.set(name, { name, marker: args.marker });
      await ctx.state.set("scoped-" + name, name, { scope: "shared" });
      const scopedValue = await ctx.state.get("scoped-" + name, { scope: "shared" });
      await ctx.state.set("scoped-read-" + name, scopedValue);
      const task = await ctx.tasks.propose({
        title: "Task " + name,
        kind: "analysis",
        prompt: "Inspect " + name
      });
      await ctx.tasks.accept(task.taskId);
      await ctx.tasks.run(task.taskId);
      await ctx.notify({ title: "Done " + name });
      return name;
    });
  }, { concurrency: 2 });
}
`,
        }),
      );

      expect(draft.workflow.validationStatus).toBe("valid");

      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
          args: { marker: "from-test" },
        }),
      );
      const completed = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "completed",
        "completion",
      );
      const timeline = await Effect.runPromise(workflow.getTimeline({ runId: completed.runId }));

      expect(completed.steps.map((step) => [step.stepKey, step.status])).toEqual(
        expect.arrayContaining([
          ["alpha", "completed"],
          ["beta", "completed"],
        ]),
      );
      expect(getStateValue(completed, "alpha")).toEqual({
        name: "alpha",
        marker: "from-test",
      });
      expect(getStateValue(completed, "beta")).toEqual({
        name: "beta",
        marker: "from-test",
      });
      expect(getStateValue(completed, "scoped-alpha", "shared")).toBe("alpha");
      expect(getStateValue(completed, "scoped-beta", "shared")).toBe("beta");
      expect(getStateValue(completed, "scoped-read-alpha")).toBe("alpha");
      expect(getStateValue(completed, "scoped-read-beta")).toBe("beta");
      expect(completed.tasks).toHaveLength(2);
      expect(completed.tasks.every((task) => task.status === "completed")).toBe(true);

      const stepsByKey = new Map(completed.steps.map((step) => [step.stepKey, step]));
      for (const stepKey of ["alpha", "beta"] as const) {
        const step = stepsByKey.get(stepKey);
        expect(step).toBeDefined();
        const stateEvent = timeline.events.find(
          (event) =>
            event.kind === "workflow.state.updated" && event.title === `State updated: ${stepKey}`,
        );
        const notificationEvent = timeline.events.find(
          (event) =>
            event.kind === "workflow.notification.emitted" && event.title === `Done ${stepKey}`,
        );
        expect(stateEvent?.stepId).toBe(step?.stepId);
        expect(notificationEvent?.stepId).toBe(step?.stepId);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("pauses on ctx.ui.ask, resumes from persisted input, and completes the run", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Ask And Resume"),
          source: `
export default async function run(ctx) {
  const answer = await ctx.step("ask", () =>
    ctx.ui.ask({
      title: "Choose path",
      body: "The workflow needs a decision.",
      fields: [{ type: "text", name: "decision", label: "Decision" }]
    })
  );
  await ctx.step("record", async () => {
    await ctx.state.set("answer", answer);
    return answer;
  });
}
`,
        }),
      );
      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const paused = await waitForRun(
        workflow,
        started.run.runId,
        (run) =>
          run.status === "paused" &&
          run.inputRequests.some((request) => request.status === "pending"),
        "pause",
      );
      const request = paused.inputRequests.find((entry) => entry.status === "pending");
      expect(request?.title).toBe("Choose path");

      await Effect.runPromise(
        workflow.respondToInput({
          runId: paused.runId,
          requestId: request!.requestId,
          response: { decision: "ship" },
        }),
      );

      const completed = await waitForRun(
        workflow,
        paused.runId,
        (run) => run.status === "completed",
        "resume completion",
      );
      const timeline = await Effect.runPromise(workflow.getTimeline({ runId: completed.runId }));

      expect(getStateValue(completed, "answer")).toEqual({ decision: "ship" });
      expect(completed.inputRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: request!.requestId,
            status: "resolved",
            response: { decision: "ship" },
          }),
        ]),
      );
      expect(timeline.events.map((event) => event.kind)).toEqual(
        expect.arrayContaining([
          "workflow.run.paused",
          "workflow.input.requested",
          "workflow.input.resolved",
          "workflow.run.resumed",
          "workflow.run.completed",
        ]),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("refuses to archive workflow drafts while a run is active", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Archive Active Guard"),
          source: `
export default async function run(ctx) {
  await ctx.ui.ask({
    title: "Still running",
    fields: [{ type: "confirm", name: "ok", label: "Continue" }]
  });
}
`,
        }),
      );
      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const paused = await waitForRun(
        workflow,
        started.run.runId,
        (run) => run.status === "paused",
        "pause before archive guard",
      );

      await expect(
        Effect.runPromise(workflow.archive({ workflowId: draft.workflow.workflowId })),
      ).rejects.toThrow("Stop active workflow runs before removing this workflow.");

      const listed = await Effect.runPromise(workflow.listThread({ projectId, originThreadId }));
      expect(
        listed.workflows.some(
          (summary) => summary.workflow.workflowId === draft.workflow.workflowId,
        ),
      ).toBe(true);

      await Effect.runPromise(workflow.stop({ runId: paused.runId }));
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels a paused workflow, resolves pending input, and marks active steps skipped", async () => {
    const runtime = makeWorkflowRuntime();
    try {
      const workflow = await runtime.runPromise(Effect.service(WorkflowService));
      const draft = await Effect.runPromise(
        workflow.createDraft({
          projectId,
          originThreadId,
          name: tn("Cancel Paused"),
          source: `
export default async function run(ctx) {
  await ctx.step("ask", () =>
    ctx.ui.ask({
      title: "Stop me",
      fields: [{ type: "confirm", name: "ok", label: "Continue" }]
    })
  );
  await ctx.step("after", () => ctx.state.set("should-not-run", true));
}
`,
        }),
      );
      const started = await Effect.runPromise(
        workflow.run({
          projectId,
          originThreadId,
          workflowId: draft.workflow.workflowId,
        }),
      );
      const paused = await waitForRun(
        workflow,
        started.run.runId,
        (run) =>
          run.status === "paused" &&
          run.inputRequests.some((request) => request.status === "pending"),
        "pause before cancellation",
      );

      await Effect.runPromise(workflow.stop({ runId: paused.runId }));

      const cancelled = await waitForRun(
        workflow,
        paused.runId,
        (run) => run.status === "cancelled",
        "cancellation",
      );
      const timeline = await Effect.runPromise(workflow.getTimeline({ runId: cancelled.runId }));

      expect(getStateValue(cancelled, "should-not-run")).toBeUndefined();
      expect(cancelled.inputRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Stop me",
            status: "cancelled",
          }),
        ]),
      );
      expect(cancelled.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepKey: "ask",
            status: "skipped",
            error: "Workflow cancelled.",
          }),
        ]),
      );
      expect(timeline.events.map((event) => event.kind)).toEqual(
        expect.arrayContaining([
          "workflow.step.skipped",
          "workflow.input.cancelled",
          "workflow.run.cancelled",
        ]),
      );
      expect(timeline.events.some((event) => event.kind === "workflow.run.completed")).toBe(false);
      expect(timeline.events.some((event) => event.kind === "workflow.run.failed")).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
