import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  McpServerId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type ManagedProcess,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationProposedPlan,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@fenrir/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";

const now = new Date().toISOString();

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);

const modelSelection = {
  provider: "codex",
  model: "gpt-5-codex",
} as const;

const managedProcessDefinition: ManagedProcess = {
  id: "proc-1",
  name: "Dev Server",
  command: "bun run dev",
  icon: "play",
  scope: "project",
  cwd: null,
  env: {},
  proxy: null,
  readiness: { kind: "none" },
  autoRestart: null,
};

const proposedPlan: OrchestrationProposedPlan = {
  id: "plan-1",
  turnId: null,
  planMarkdown: "## Plan",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: now,
  updatedAt: now,
};

function makeProject(
  id: string,
  overrides: Partial<OrchestrationProject> = {},
): OrchestrationProject {
  return {
    id: asProjectId(id),
    title: `Project ${id}`,
    workspaceRoot: `/tmp/${id}`,
    defaultModelSelection: modelSelection,
    scripts: [],
    globalScriptDefaults: [],
    managedProcesses: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(
  id: string,
  projectId: string,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread {
  return {
    id: asThreadId(id),
    projectId: asProjectId(projectId),
    title: `Thread ${id}`,
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    latestTurn: null,
    messages: [],
    session: null,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    deletedAt: null,
    ...overrides,
  };
}

const readModel: OrchestrationReadModel = {
  snapshotSequence: 5,
  updatedAt: now,
  projects: [
    makeProject("project-a", { managedProcesses: [managedProcessDefinition] }),
    makeProject("project-b"),
    makeProject("project-empty"),
  ],
  threads: [
    makeThread("thread-1", "project-a", { proposedPlans: [proposedPlan] }),
    makeThread("thread-2", "project-b"),
    makeThread("thread-archived", "project-a", { archivedAt: now }),
    makeThread("thread-deleted", "project-empty", { deletedAt: now }),
  ],
  managedProcessInstances: [],
};

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function decide(
  command: OrchestrationCommand,
): Promise<PlannedEvent | ReadonlyArray<PlannedEvent>> {
  return Effect.runPromise(decideOrchestrationCommand({ command, readModel }));
}

async function decideSingle(command: OrchestrationCommand): Promise<PlannedEvent> {
  const result = await decide(command);
  const events = Array.isArray(result) ? result : [result as PlannedEvent];
  expect(events).toHaveLength(1);
  return events[0] as PlannedEvent;
}

describe("decideOrchestrationCommand", () => {
  describe("project.create", () => {
    it("emits project.created with payload defaults", async () => {
      const event = await decideSingle({
        type: "project.create",
        commandId: asCommandId("cmd-1"),
        projectId: asProjectId("project-new"),
        title: "New Project",
        workspaceRoot: "/tmp/new",
        createdAt: now,
      });

      expect(event.type).toBe("project.created");
      expect(event.aggregateKind).toBe("project");
      expect(event.aggregateId).toBe("project-new");
      expect(event.commandId).toBe("cmd-1");
      expect(event.correlationId).toBe("cmd-1");
      expect(event.causationEventId).toBeNull();
      expect(event.occurredAt).toBe(now);
      expect(event.payload).toEqual({
        projectId: "project-new",
        title: "New Project",
        workspaceRoot: "/tmp/new",
        defaultModelSelection: null,
        scripts: [],
        globalScriptDefaults: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    it("passes through an explicit defaultModelSelection", async () => {
      const event = await decideSingle({
        type: "project.create",
        commandId: asCommandId("cmd-2"),
        projectId: asProjectId("project-new"),
        title: "New Project",
        workspaceRoot: "/tmp/new",
        defaultModelSelection: modelSelection,
        createdAt: now,
      });

      expect(
        (event.payload as { defaultModelSelection: typeof modelSelection }).defaultModelSelection,
      ).toEqual(modelSelection);
    });

    it("rejects creating an existing project", async () => {
      await expect(
        decide({
          type: "project.create",
          commandId: asCommandId("cmd-3"),
          projectId: asProjectId("project-a"),
          title: "Duplicate",
          workspaceRoot: "/tmp/dup",
          createdAt: now,
        }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("project.meta.update", () => {
    it("includes only the provided fields in the payload", async () => {
      const event = await decideSingle({
        type: "project.meta.update",
        commandId: asCommandId("cmd-4"),
        projectId: asProjectId("project-a"),
        title: "Renamed",
      });

      expect(event.type).toBe("project.meta-updated");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.projectId).toBe("project-a");
      expect(payload.title).toBe("Renamed");
      expect(payload).not.toHaveProperty("workspaceRoot");
      expect(payload).not.toHaveProperty("defaultModelSelection");
      expect(payload).not.toHaveProperty("scripts");
      expect(payload).not.toHaveProperty("globalScriptDefaults");
      expect(typeof payload.updatedAt).toBe("string");
    });

    it("rejects updating a missing project", async () => {
      await expect(
        decide({
          type: "project.meta.update",
          commandId: asCommandId("cmd-5"),
          projectId: asProjectId("project-missing"),
          title: "Nope",
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("project.delete", () => {
    it("emits a single project.deleted for an empty project", async () => {
      const event = await decideSingle({
        type: "project.delete",
        commandId: asCommandId("cmd-6"),
        projectId: asProjectId("project-empty"),
      });

      expect(event.type).toBe("project.deleted");
      expect(event.aggregateId).toBe("project-empty");
      expect((event.payload as { projectId: string }).projectId).toBe("project-empty");
    });

    it("ignores already-deleted threads when checking emptiness", async () => {
      // project-empty contains thread-deleted (deletedAt set); deletion must
      // not require force and must not emit thread.deleted events for it.
      const result = await decide({
        type: "project.delete",
        commandId: asCommandId("cmd-7"),
        projectId: asProjectId("project-empty"),
      });
      const events = Array.isArray(result) ? result : [result as PlannedEvent];
      expect(events.map((event) => event.type)).toEqual(["project.deleted"]);
    });

    it("rejects deleting a missing project", async () => {
      await expect(
        decide({
          type: "project.delete",
          commandId: asCommandId("cmd-8"),
          projectId: asProjectId("project-missing"),
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("thread.create", () => {
    it("emits thread.created with mcpServerIds defaulting to []", async () => {
      const event = await decideSingle({
        type: "thread.create",
        commandId: asCommandId("cmd-9"),
        threadId: asThreadId("thread-new"),
        projectId: asProjectId("project-a"),
        title: "New Thread",
        modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });

      expect(event.type).toBe("thread.created");
      expect(event.aggregateKind).toBe("thread");
      expect(event.aggregateId).toBe("thread-new");
      expect(event.payload).toEqual({
        threadId: "thread-new",
        projectId: "project-a",
        title: "New Thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        mcpServerIds: [],
        branch: null,
        worktreePath: null,
        visibility: "normal",
        owner: null,
        deleteOnSettled: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    it("emits thread.created with visibility metadata", async () => {
      const event = await decideSingle({
        type: "thread.create",
        commandId: asCommandId("cmd-9b"),
        threadId: asThreadId("thread-editor-worker"),
        projectId: asProjectId("project-a"),
        title: "Editor Worker",
        modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: "/tmp/project-a-worktree",
        visibility: "editorTransient",
        owner: { kind: "editorPrompt", parentThreadId: asThreadId("thread-a") },
        deleteOnSettled: true,
        createdAt: now,
      });

      expect(event.type).toBe("thread.created");
      expect(event.payload).toMatchObject({
        threadId: "thread-editor-worker",
        visibility: "editorTransient",
        owner: { kind: "editorPrompt", parentThreadId: "thread-a" },
        deleteOnSettled: true,
      });
    });

    it("rejects creating a thread in a missing project", async () => {
      await expect(
        decide({
          type: "thread.create",
          commandId: asCommandId("cmd-10"),
          threadId: asThreadId("thread-new"),
          projectId: asProjectId("project-missing"),
          title: "New Thread",
          modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      ).rejects.toThrow("does not exist");
    });

    it("rejects creating a duplicate thread", async () => {
      await expect(
        decide({
          type: "thread.create",
          commandId: asCommandId("cmd-11"),
          threadId: asThreadId("thread-1"),
          projectId: asProjectId("project-a"),
          title: "Duplicate",
          modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("thread.delete", () => {
    it("emits thread.deleted", async () => {
      const event = await decideSingle({
        type: "thread.delete",
        commandId: asCommandId("cmd-12"),
        threadId: asThreadId("thread-1"),
      });

      expect(event.type).toBe("thread.deleted");
      const payload = event.payload as { threadId: string; deletedAt: string };
      expect(payload.threadId).toBe("thread-1");
      expect(typeof payload.deletedAt).toBe("string");
    });

    it("rejects deleting a missing thread", async () => {
      await expect(
        decide({
          type: "thread.delete",
          commandId: asCommandId("cmd-13"),
          threadId: asThreadId("thread-missing"),
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("thread.archive / thread.unarchive", () => {
    it("archives an active thread", async () => {
      const event = await decideSingle({
        type: "thread.archive",
        commandId: asCommandId("cmd-14"),
        threadId: asThreadId("thread-1"),
      });

      expect(event.type).toBe("thread.archived");
      const payload = event.payload as { threadId: string; archivedAt: string };
      expect(payload.threadId).toBe("thread-1");
      expect(typeof payload.archivedAt).toBe("string");
    });

    it("rejects archiving an already-archived thread", async () => {
      await expect(
        decide({
          type: "thread.archive",
          commandId: asCommandId("cmd-15"),
          threadId: asThreadId("thread-archived"),
        }),
      ).rejects.toThrow("already archived");
    });

    it("unarchives an archived thread", async () => {
      const event = await decideSingle({
        type: "thread.unarchive",
        commandId: asCommandId("cmd-16"),
        threadId: asThreadId("thread-archived"),
      });

      expect(event.type).toBe("thread.unarchived");
      expect((event.payload as { threadId: string }).threadId).toBe("thread-archived");
    });

    it("rejects unarchiving a non-archived thread", async () => {
      await expect(
        decide({
          type: "thread.unarchive",
          commandId: asCommandId("cmd-17"),
          threadId: asThreadId("thread-1"),
        }),
      ).rejects.toThrow("is not archived");
    });
  });

  describe("thread.meta.update", () => {
    it("includes only the provided fields in the payload", async () => {
      const event = await decideSingle({
        type: "thread.meta.update",
        commandId: asCommandId("cmd-18"),
        threadId: asThreadId("thread-1"),
        branch: "feature/x",
      });

      expect(event.type).toBe("thread.meta-updated");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.threadId).toBe("thread-1");
      expect(payload.branch).toBe("feature/x");
      expect(payload).not.toHaveProperty("title");
      expect(payload).not.toHaveProperty("modelSelection");
      expect(payload).not.toHaveProperty("worktreePath");
    });
  });

  describe("thread setting commands", () => {
    it("emits thread.mcp-servers-set", async () => {
      const event = await decideSingle({
        type: "thread.mcp-servers.set",
        commandId: asCommandId("cmd-19"),
        threadId: asThreadId("thread-1"),
        mcpServerIds: [McpServerId.make("mcp-1")],
        createdAt: now,
      });

      expect(event.type).toBe("thread.mcp-servers-set");
      expect((event.payload as { mcpServerIds: readonly string[] }).mcpServerIds).toEqual([
        "mcp-1",
      ]);
    });

    it("emits thread.runtime-mode-set", async () => {
      const event = await decideSingle({
        type: "thread.runtime-mode.set",
        commandId: asCommandId("cmd-20"),
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
        createdAt: now,
      });

      expect(event.type).toBe("thread.runtime-mode-set");
      expect((event.payload as { runtimeMode: string }).runtimeMode).toBe("full-access");
    });

    it("emits thread.interaction-mode-set", async () => {
      const event = await decideSingle({
        type: "thread.interaction-mode.set",
        commandId: asCommandId("cmd-21"),
        threadId: asThreadId("thread-1"),
        interactionMode: "plan",
        createdAt: now,
      });

      expect(event.type).toBe("thread.interaction-mode-set");
      expect((event.payload as { interactionMode: string }).interactionMode).toBe("plan");
    });
  });

  describe("thread.turn.start", () => {
    const baseTurnStart = {
      type: "thread.turn.start",
      commandId: asCommandId("cmd-22"),
      threadId: asThreadId("thread-1"),
      message: {
        messageId: asMessageId("msg-1"),
        role: "user",
        text: "hello",
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      createdAt: now,
    } satisfies OrchestrationCommand;

    it("emits message-sent and turn-start-requested linked by causation", async () => {
      const result = await decide(baseTurnStart);
      const events = Array.isArray(result) ? result : [result as PlannedEvent];
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);

      const [messageEvent, turnEvent] = events as [PlannedEvent, PlannedEvent];
      expect(messageEvent.payload).toEqual({
        threadId: "thread-1",
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      });
      expect(turnEvent.causationEventId).toBe(messageEvent.eventId);

      const turnPayload = turnEvent.payload as Record<string, unknown>;
      // Runtime and interaction modes come from the target thread, not the command.
      expect(turnPayload.runtimeMode).toBe("approval-required");
      expect(turnPayload.interactionMode).toBe(DEFAULT_PROVIDER_INTERACTION_MODE);
      expect(turnPayload).not.toHaveProperty("modelSelection");
      expect(turnPayload).not.toHaveProperty("providerInstanceId");
      expect(turnPayload).not.toHaveProperty("titleSeed");
      expect(turnPayload).not.toHaveProperty("mcpServerIds");
      expect(turnPayload).not.toHaveProperty("sourceProposedPlan");
    });

    it("forwards optional overrides into turn-start-requested", async () => {
      const result = await decide({
        ...baseTurnStart,
        modelSelection,
        titleSeed: "Seed title",
        mcpServerIds: [McpServerId.make("mcp-1")],
      });
      const events = Array.isArray(result) ? result : [result as PlannedEvent];
      const turnPayload = events[1]?.payload as Record<string, unknown>;
      expect(turnPayload.modelSelection).toEqual(modelSelection);
      expect(turnPayload.titleSeed).toBe("Seed title");
      expect(turnPayload.mcpServerIds).toEqual(["mcp-1"]);
    });

    it("accepts a sourceProposedPlan from a thread in the same project", async () => {
      const result = await decide({
        ...baseTurnStart,
        sourceProposedPlan: {
          threadId: asThreadId("thread-1"),
          planId: "plan-1",
        },
      });
      const events = Array.isArray(result) ? result : [result as PlannedEvent];
      const turnPayload = events[1]?.payload as Record<string, unknown>;
      expect(turnPayload.sourceProposedPlan).toEqual({
        threadId: "thread-1",
        planId: "plan-1",
      });
    });

    it("rejects a sourceProposedPlan that does not exist on the source thread", async () => {
      await expect(
        decide({
          ...baseTurnStart,
          sourceProposedPlan: {
            threadId: asThreadId("thread-1"),
            planId: "plan-missing",
          },
        }),
      ).rejects.toThrow("does not exist on thread");
    });

    it("rejects a sourceProposedPlan from a thread in another project", async () => {
      await expect(
        decide({
          ...baseTurnStart,
          threadId: asThreadId("thread-2"),
          sourceProposedPlan: {
            threadId: asThreadId("thread-1"),
            planId: "plan-1",
          },
        }),
      ).rejects.toThrow("different project");
    });

    it("rejects a missing target thread", async () => {
      await expect(
        decide({
          ...baseTurnStart,
          threadId: asThreadId("thread-missing"),
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("thread.turn.interrupt", () => {
    it("omits turnId when not provided", async () => {
      const event = await decideSingle({
        type: "thread.turn.interrupt",
        commandId: asCommandId("cmd-23"),
        threadId: asThreadId("thread-1"),
        createdAt: now,
      });

      expect(event.type).toBe("thread.turn-interrupt-requested");
      expect(event.payload).not.toHaveProperty("turnId");
    });

    it("includes turnId when provided", async () => {
      const event = await decideSingle({
        type: "thread.turn.interrupt",
        commandId: asCommandId("cmd-24"),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      });

      expect((event.payload as { turnId: string }).turnId).toBe("turn-1");
    });
  });

  describe("thread.approval.respond", () => {
    it("emits approval-response-requested with requestId metadata", async () => {
      const event = await decideSingle({
        type: "thread.approval.respond",
        commandId: asCommandId("cmd-25"),
        threadId: asThreadId("thread-1"),
        requestId: ApprovalRequestId.make("req-1"),
        decision: "accept",
        createdAt: now,
      });

      expect(event.type).toBe("thread.approval-response-requested");
      expect(event.metadata).toEqual({ requestId: "req-1" });
      expect(event.payload).toEqual({
        threadId: "thread-1",
        requestId: "req-1",
        decision: "accept",
        createdAt: now,
      });
    });
  });

  describe("thread.user-input.respond", () => {
    it("emits user-input-response-requested with answers", async () => {
      const event = await decideSingle({
        type: "thread.user-input.respond",
        commandId: asCommandId("cmd-26"),
        threadId: asThreadId("thread-1"),
        requestId: ApprovalRequestId.make("req-2"),
        answers: { color: "blue" },
        createdAt: now,
      });

      expect(event.type).toBe("thread.user-input-response-requested");
      expect(event.metadata).toEqual({ requestId: "req-2" });
      expect((event.payload as { answers: unknown }).answers).toEqual({ color: "blue" });
    });
  });

  describe("thread.checkpoint.revert", () => {
    it("emits checkpoint-revert-requested", async () => {
      const event = await decideSingle({
        type: "thread.checkpoint.revert",
        commandId: asCommandId("cmd-27"),
        threadId: asThreadId("thread-1"),
        turnCount: 3,
        createdAt: now,
      });

      expect(event.type).toBe("thread.checkpoint-revert-requested");
      expect((event.payload as { turnCount: number }).turnCount).toBe(3);
    });
  });

  describe("thread.session.stop / thread.session.set", () => {
    it("emits session-stop-requested", async () => {
      const event = await decideSingle({
        type: "thread.session.stop",
        commandId: asCommandId("cmd-28"),
        threadId: asThreadId("thread-1"),
        createdAt: now,
      });

      expect(event.type).toBe("thread.session-stop-requested");
      expect((event.payload as { threadId: string }).threadId).toBe("thread-1");
    });

    it("emits session-set with the session payload", async () => {
      const session: OrchestrationSession = {
        threadId: asThreadId("thread-1"),
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: asTurnId("turn-1"),
        lastError: null,
        updatedAt: now,
      };
      const event = await decideSingle({
        type: "thread.session.set",
        commandId: asCommandId("cmd-29"),
        threadId: asThreadId("thread-1"),
        session,
        createdAt: now,
      });

      expect(event.type).toBe("thread.session-set");
      expect((event.payload as { session: OrchestrationSession }).session).toEqual(session);
    });
  });

  describe("assistant message commands", () => {
    it("emits a streaming message for thread.message.assistant.delta", async () => {
      const event = await decideSingle({
        type: "thread.message.assistant.delta",
        commandId: asCommandId("cmd-30"),
        threadId: asThreadId("thread-1"),
        messageId: asMessageId("msg-2"),
        delta: "partial",
        createdAt: now,
      });

      expect(event.type).toBe("thread.message-sent");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.role).toBe("assistant");
      expect(payload.text).toBe("partial");
      expect(payload.streaming).toBe(true);
      expect(payload.turnId).toBeNull();
      expect(payload).not.toHaveProperty("attachments");
    });

    it("emits a final message for thread.message.assistant.complete", async () => {
      const event = await decideSingle({
        type: "thread.message.assistant.complete",
        commandId: asCommandId("cmd-31"),
        threadId: asThreadId("thread-1"),
        messageId: asMessageId("msg-2"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      });

      expect(event.type).toBe("thread.message-sent");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.role).toBe("assistant");
      // Missing text defaults to the empty string.
      expect(payload.text).toBe("");
      expect(payload.streaming).toBe(false);
      expect(payload.turnId).toBe("turn-1");
    });
  });

  describe("thread.proposed-plan.upsert", () => {
    it("emits proposed-plan-upserted", async () => {
      const event = await decideSingle({
        type: "thread.proposed-plan.upsert",
        commandId: asCommandId("cmd-32"),
        threadId: asThreadId("thread-1"),
        proposedPlan,
        createdAt: now,
      });

      expect(event.type).toBe("thread.proposed-plan-upserted");
      expect((event.payload as { proposedPlan: OrchestrationProposedPlan }).proposedPlan).toEqual(
        proposedPlan,
      );
    });
  });

  describe("thread.turn.diff.complete", () => {
    it("defaults assistantMessageId to null", async () => {
      const event = await decideSingle({
        type: "thread.turn.diff.complete",
        commandId: asCommandId("cmd-33"),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        completedAt: now,
        checkpointRef: CheckpointRef.make("ref-1"),
        status: "ready",
        files: [{ path: "src/a.ts", kind: "modified", additions: 1, deletions: 2 }],
        checkpointTurnCount: 1,
        createdAt: now,
      });

      expect(event.type).toBe("thread.turn-diff-completed");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.assistantMessageId).toBeNull();
      expect(payload.checkpointRef).toBe("ref-1");
      expect(payload.status).toBe("ready");
      expect(payload.files).toEqual([
        { path: "src/a.ts", kind: "modified", additions: 1, deletions: 2 },
      ]);
    });
  });

  describe("thread.revert.complete", () => {
    it("emits thread.reverted", async () => {
      const event = await decideSingle({
        type: "thread.revert.complete",
        commandId: asCommandId("cmd-34"),
        threadId: asThreadId("thread-1"),
        turnCount: 2,
        createdAt: now,
      });

      expect(event.type).toBe("thread.reverted");
      expect(event.payload).toEqual({ threadId: "thread-1", turnCount: 2 });
    });
  });

  describe("thread.activity.append", () => {
    function makeActivity(payload: unknown): OrchestrationThreadActivity {
      return {
        id: asEventId("evt-activity"),
        tone: "tool",
        kind: "tool-call",
        summary: "Ran a tool",
        payload,
        turnId: null,
        createdAt: now,
      };
    }

    it("lifts a string requestId from the activity payload into metadata", async () => {
      const activity = makeActivity({ requestId: "req-9" });
      const event = await decideSingle({
        type: "thread.activity.append",
        commandId: asCommandId("cmd-35"),
        threadId: asThreadId("thread-1"),
        activity,
        createdAt: now,
      });

      expect(event.type).toBe("thread.activity-appended");
      expect(event.metadata).toEqual({ requestId: "req-9" });
      expect((event.payload as { activity: OrchestrationThreadActivity }).activity).toEqual(
        activity,
      );
    });

    it("keeps metadata empty when the payload has no string requestId", async () => {
      const event = await decideSingle({
        type: "thread.activity.append",
        commandId: asCommandId("cmd-36"),
        threadId: asThreadId("thread-1"),
        activity: makeActivity({ requestId: 42 }),
        createdAt: now,
      });

      expect(event.metadata).toEqual({});
    });
  });

  describe("project.managedProcess.upsert / delete", () => {
    it("emits definition-upserted for an existing project", async () => {
      const event = await decideSingle({
        type: "project.managedProcess.upsert",
        commandId: asCommandId("cmd-37"),
        projectId: asProjectId("project-a"),
        definition: managedProcessDefinition,
      });

      expect(event.type).toBe("managed-process.definition-upserted");
      expect((event.payload as { definition: ManagedProcess }).definition).toEqual(
        managedProcessDefinition,
      );
    });

    it("rejects upserting on a missing project", async () => {
      await expect(
        decide({
          type: "project.managedProcess.upsert",
          commandId: asCommandId("cmd-38"),
          projectId: asProjectId("project-missing"),
          definition: managedProcessDefinition,
        }),
      ).rejects.toThrow("does not exist");
    });

    it("emits definition-deleted for an existing definition", async () => {
      const event = await decideSingle({
        type: "project.managedProcess.delete",
        commandId: asCommandId("cmd-39"),
        projectId: asProjectId("project-a"),
        processDefId: "proc-1",
      });

      expect(event.type).toBe("managed-process.definition-deleted");
      expect((event.payload as { processDefId: string }).processDefId).toBe("proc-1");
    });

    it("rejects deleting an unknown definition", async () => {
      await expect(
        decide({
          type: "project.managedProcess.delete",
          commandId: asCommandId("cmd-40"),
          projectId: asProjectId("project-a"),
          processDefId: "proc-missing",
        }),
      ).rejects.toThrow("does not exist on project");
    });
  });
});
