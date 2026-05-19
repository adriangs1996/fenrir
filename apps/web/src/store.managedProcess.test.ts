import {
  EnvironmentId,
  EventId,
  ProjectId,
  type ManagedProcessInstance,
  type OrchestrationEvent,
} from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  selectEnvironmentState,
  selectInstanceForDefinition,
  selectManagedProcessInstanceById,
  selectManagedProcessInstancesForProject,
  type AppState,
  type EnvironmentState,
} from "./store";

const envId = EnvironmentId.makeUnsafe("env-1");
const projectId = ProjectId.makeUnsafe("project-1");

function makeEmptyState(): AppState {
  const environmentState: EnvironmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: {
        id: projectId,
        environmentId: envId,
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        scripts: [],
        managedProcesses: [],
        globalScriptDefaults: [],
      },
    },
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    threadDetailsHydratedById: {},
    sidebarThreadSummaryById: {},
    managedProcessInstanceById: {},
    managedProcessInstanceIdsByProjectId: {},
    bootstrapComplete: true,
  };
  return {
    activeEnvironmentId: envId,
    environmentStateById: { [envId]: environmentState },
  };
}

function makeInstance(overrides: Partial<ManagedProcessInstance> = {}): ManagedProcessInstance {
  return {
    instanceId: "inst-1",
    projectId,
    processDefId: "dev-server",
    worktreePath: null,
    scope: "project",
    status: "running",
    ready: false,
    executor: "direct",
    url: { estimate: null, confirmed: null },
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: null,
    exitCode: null,
    exitSignal: null,
    restartAttempt: 0,
    lastError: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ManagedProcessInstance;
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: "2026-01-01T00:00:01.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

function envState(state: AppState): EnvironmentState {
  return selectEnvironmentState(state, envId);
}

describe("managed process store", () => {
  describe("instance-started", () => {
    it("adds instance to state", () => {
      const instance = makeInstance();
      const state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      expect(envState(state).managedProcessInstanceById["inst-1"]).toEqual(instance);
      expect(envState(state).managedProcessInstanceIdsByProjectId[projectId]).toEqual(["inst-1"]);
    });

    it("does not duplicate instance id in project index", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );
      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-started", {
          instance: makeInstance({ status: "starting" }),
        }),
        envId,
      );

      expect(envState(state).managedProcessInstanceIdsByProjectId[projectId]).toEqual(["inst-1"]);
    });
  });

  describe("instance-state-changed", () => {
    it("updates status, exitCode, exitSignal, lastError, updatedAt", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-state-changed", {
          instanceId: "inst-1",
          prev: "running",
          next: "stopping",
          exitCode: null,
          exitSignal: null,
          lastError: null,
          occurredAt: "2026-01-01T00:00:02.000Z",
        } as Extract<
          OrchestrationEvent,
          { type: "managed-process.instance-state-changed" }
        >["payload"]),
        envId,
      );

      const updated = envState(state).managedProcessInstanceById["inst-1"]!;
      expect(updated.status).toBe("stopping");
      expect(updated.updatedAt).toBe("2026-01-01T00:00:02.000Z");
    });

    it("records lastError on crash", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-state-changed", {
          instanceId: "inst-1",
          prev: "running",
          next: "crashed",
          exitCode: 1,
          exitSignal: null,
          lastError: "ECONNREFUSED",
          occurredAt: "2026-01-01T00:00:03.000Z",
        } as Extract<
          OrchestrationEvent,
          { type: "managed-process.instance-state-changed" }
        >["payload"]),
        envId,
      );

      const updated = envState(state).managedProcessInstanceById["inst-1"]!;
      expect(updated.status).toBe("crashed");
      expect(updated.exitCode).toBe(1);
      expect(updated.lastError).toBe("ECONNREFUSED");
    });

    it("is a no-op for unknown instanceId", () => {
      const state = makeEmptyState();
      const next = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-state-changed", {
          instanceId: "nonexistent",
          prev: "running",
          next: "stopping",
          exitCode: null,
          exitSignal: null,
          lastError: null,
          occurredAt: "2026-01-01T00:00:02.000Z",
        } as Extract<
          OrchestrationEvent,
          { type: "managed-process.instance-state-changed" }
        >["payload"]),
        envId,
      );
      expect(next).toBe(state);
    });
  });

  describe("instance-ready-changed", () => {
    it("updates ready state and url", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-ready-changed", {
          instanceId: "inst-1",
          ready: true,
          url: {
            estimate: "http://localhost:3000",
            confirmed: "http://localhost:3000",
          },
          occurredAt: "2026-01-01T00:00:04.000Z",
        } as Extract<
          OrchestrationEvent,
          { type: "managed-process.instance-ready-changed" }
        >["payload"]),
        envId,
      );

      const updated = envState(state).managedProcessInstanceById["inst-1"]!;
      expect(updated.ready).toBe(true);
      expect(updated.url.confirmed).toBe("http://localhost:3000");
      expect(updated.updatedAt).toBe("2026-01-01T00:00:04.000Z");
    });
  });

  describe("instance-exited", () => {
    it("sets stopped status and exit details", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-exited", {
          instanceId: "inst-1",
          exitCode: 0,
          exitSignal: null,
          userInitiated: true,
          occurredAt: "2026-01-01T00:00:05.000Z",
        } as Extract<OrchestrationEvent, { type: "managed-process.instance-exited" }>["payload"]),
        envId,
      );

      const updated = envState(state).managedProcessInstanceById["inst-1"]!;
      expect(updated.status).toBe("stopped");
      expect(updated.exitCode).toBe(0);
      expect(updated.stoppedAt).toBe("2026-01-01T00:00:05.000Z");
    });

    it("preserves exit signal", () => {
      const instance = makeInstance();
      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );

      state = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.instance-exited", {
          instanceId: "inst-1",
          exitCode: null,
          exitSignal: "SIGKILL",
          userInitiated: false,
          occurredAt: "2026-01-01T00:00:06.000Z",
        } as Extract<OrchestrationEvent, { type: "managed-process.instance-exited" }>["payload"]),
        envId,
      );

      const updated = envState(state).managedProcessInstanceById["inst-1"]!;
      expect(updated.exitSignal).toBe("SIGKILL");
    });
  });

  describe("definition events are no-ops", () => {
    it("definition-upserted does not change state shape", () => {
      const state = makeEmptyState();
      const next = applyOrchestrationEvent(
        state,
        makeEvent("managed-process.definition-upserted", {
          projectId,
          definition: {
            id: "dev-server",
            name: "Dev Server",
            command: "npm start",
            icon: "play",
            scope: "project",
            cwd: null,
            env: {},
            proxy: null,
            readiness: { kind: "none" },
            autoRestart: null,
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as Extract<
          OrchestrationEvent,
          { type: "managed-process.definition-upserted" }
        >["payload"]),
        envId,
      );
      expect(envState(next).managedProcessInstanceById).toEqual({});
    });
  });
});

describe("managed process selectors", () => {
  describe("selectManagedProcessInstancesForProject", () => {
    it("returns instances for project", () => {
      const instance = makeInstance();
      const state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );
      const instances = selectManagedProcessInstancesForProject(state, envId, projectId);
      expect(instances).toEqual([instance]);
    });

    it("returns empty array for unknown project", () => {
      const instances = selectManagedProcessInstancesForProject(
        makeEmptyState(),
        envId,
        ProjectId.makeUnsafe("nonexistent"),
      );
      expect(instances).toEqual([]);
    });
  });

  describe("selectManagedProcessInstanceById", () => {
    it("returns instance by id", () => {
      const instance = makeInstance();
      const state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );
      expect(selectManagedProcessInstanceById(state, envId, "inst-1")).toEqual(instance);
    });

    it("returns undefined for unknown id", () => {
      expect(
        selectManagedProcessInstanceById(makeEmptyState(), envId, "nonexistent"),
      ).toBeUndefined();
    });
  });

  describe("selectInstanceForDefinition", () => {
    it("matches by processDefId and worktreePath", () => {
      const instance = makeInstance({
        instanceId: "inst-1",
        processDefId: "dev-server",
        worktreePath: null,
      });
      const state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );
      const found = selectInstanceForDefinition(state, envId, projectId, "dev-server", null);
      expect(found).toEqual(instance);
    });

    it("distinguishes worktreePath null from a specific path", () => {
      const projectInstance = makeInstance({
        instanceId: "inst-project",
        processDefId: "dev-server",
        worktreePath: null,
      });
      const worktreeInstance = makeInstance({
        instanceId: "inst-wt",
        processDefId: "dev-server",
        worktreePath: "/tmp/worktree/feature-x",
      });

      let state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance: projectInstance }),
        envId,
      );
      state = applyOrchestrationEvent(
        state,
        makeEvent(
          "managed-process.instance-started",
          { instance: worktreeInstance },
          { sequence: 2 },
        ),
        envId,
      );

      const foundProject = selectInstanceForDefinition(state, envId, projectId, "dev-server", null);
      expect(foundProject?.instanceId).toBe("inst-project");

      const foundWorktree = selectInstanceForDefinition(
        state,
        envId,
        projectId,
        "dev-server",
        "/tmp/worktree/feature-x",
      );
      expect(foundWorktree?.instanceId).toBe("inst-wt");
    });

    it("returns undefined when processDefId does not match", () => {
      const instance = makeInstance({ processDefId: "other" });
      const state = applyOrchestrationEvent(
        makeEmptyState(),
        makeEvent("managed-process.instance-started", { instance }),
        envId,
      );
      expect(
        selectInstanceForDefinition(state, envId, projectId, "dev-server", null),
      ).toBeUndefined();
    });
  });
});
