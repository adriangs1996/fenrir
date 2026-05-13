import { Effect, Fiber, Layer, Result, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { ManagedProcess, ManagedProcessExecutorKind, ProjectId } from "@fenrir/contracts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  Executor,
  ExecutorError,
  type ExecutorHandle,
  type ExecutorShape,
  type ExecutorSpawnInput,
} from "../Services/Executor.ts";
import {
  InstanceStore,
  type InstanceStoreShape,
  type PersistedInstanceRecord,
} from "../Services/InstanceStore.ts";
import { LogBuffer, type LogBufferShape } from "../Services/LogBuffer.ts";
import { ManagedProcessManager, type ManagerLifecycleEvent } from "../Services/Manager.ts";
import { ManagedProcessManagerLive } from "./Manager.ts";

// ── Constants ──

const DUMMY_PROJECT_ID = "test-project" as ProjectId;

const DUMMY_DEFINITION: ManagedProcess = {
  id: "dev-server",
  name: "Dev Server",
  command: "npm run dev",
  icon: "play",
  scope: "project",
  cwd: null,
  env: {},
  proxy: null,
  readiness: { kind: "none" },
  autoRestart: null,
} as ManagedProcess;

// ── Mock handle ──

class MockHandle implements ExecutorHandle {
  readonly executor: ManagedProcessExecutorKind;
  readonly pid = 1234;
  readonly nativeKey: string;

  private _userInitiated = false;
  private readonly _dataHandlers = new Set<(chunk: string) => void>();
  private readonly _exitHandlers = new Set<
    (event: { exitCode: number | null; signal: string | null; userInitiated: boolean }) => void
  >();

  constructor(instanceId: string, kind: ManagedProcessExecutorKind = "direct") {
    this.executor = kind;
    this.nativeKey = `mock-${instanceId}`;
  }

  write(_data: string): Effect.Effect<void, ExecutorError> {
    return Effect.void;
  }

  resize(_cols: number, _rows: number): Effect.Effect<void, ExecutorError> {
    return Effect.void;
  }

  stop(): Effect.Effect<void, ExecutorError> {
    return Effect.sync(() => {
      this._userInitiated = true;
    });
  }

  forceKill(): Effect.Effect<void, ExecutorError> {
    return Effect.sync(() => {
      this._userInitiated = true;
    });
  }

  onData(handler: (chunk: string) => void) {
    this._dataHandlers.add(handler);
    return { unsubscribe: () => this._dataHandlers.delete(handler) };
  }

  onExit(
    handler: (event: {
      exitCode: number | null;
      signal: string | null;
      userInitiated: boolean;
    }) => void,
  ) {
    this._exitHandlers.add(handler);
    return { unsubscribe: () => this._exitHandlers.delete(handler) };
  }

  // Test controls ──

  triggerData(chunk: string): void {
    for (const h of this._dataHandlers) h(chunk);
  }

  triggerExit(exitCode: number | null, signal: string | null): void {
    const event = {
      exitCode,
      signal,
      userInitiated: this._userInitiated,
    };
    for (const h of this._exitHandlers) h(event);
  }
}

// ── Mock factories ──

interface MockExecutorState {
  handles: Map<string, MockHandle>;
  spawnCalls: ExecutorSpawnInput[];
}

function createMockExecutor(
  kind: ManagedProcessExecutorKind = "direct",
  reattachHandles: Map<string, MockHandle> = new Map(),
): {
  layer: Layer.Layer<Executor>;
  state: MockExecutorState;
} {
  const state: MockExecutorState = {
    handles: new Map(),
    spawnCalls: [],
  };

  const shape: ExecutorShape = {
    kind,
    spawn: (input: ExecutorSpawnInput) =>
      Effect.sync(() => {
        state.spawnCalls.push(input);
        const handle = new MockHandle(input.instanceId, kind);
        state.handles.set(input.instanceId, handle);
        return handle as unknown as ExecutorHandle;
      }),
    reattach: (input) => {
      if (kind === "tmux") {
        const handle = reattachHandles.get(input.nativeKey);
        if (handle) {
          state.handles.set(input.instanceId, handle);
          return Effect.succeed(handle as unknown as ExecutorHandle);
        }
      }
      return Effect.fail(new ExecutorError("not-running", "not available"));
    },
  };

  return { layer: Layer.succeed(Executor, shape), state };
}

interface MockInstanceStoreState {
  records: Map<string, PersistedInstanceRecord>;
}

function createMockInstanceStore(initialRecords: PersistedInstanceRecord[] = []): {
  layer: Layer.Layer<InstanceStore>;
  state: MockInstanceStoreState;
} {
  const state: MockInstanceStoreState = {
    records: new Map(initialRecords.map((r) => [r.instanceId, r])),
  };

  const shape: InstanceStoreShape = {
    list: (projectId) =>
      Effect.succeed([...state.records.values()].filter((r) => r.projectId === projectId)),
    upsert: (record) =>
      Effect.sync(() => {
        state.records.set(record.instanceId, record);
      }),
    remove: (instanceId) =>
      Effect.sync(() => {
        state.records.delete(instanceId);
      }),
    listAll: () => Effect.succeed([...state.records.values()]),
  };

  return { layer: Layer.succeed(InstanceStore, shape), state };
}

interface MockLogBufferState {
  openCalls: string[];
  closeCalls: string[];
}

function createMockLogBuffer(): {
  layer: Layer.Layer<LogBuffer>;
  state: MockLogBufferState;
} {
  const bufferState: MockLogBufferState = {
    openCalls: [],
    closeCalls: [],
  };

  const shape: LogBufferShape = {
    open: (input) =>
      Effect.sync(() => {
        bufferState.openCalls.push(input.instanceId);
      }),
    append: () => Effect.void,
    read: () =>
      Effect.succeed({
        bytes: "",
        ringBufferBytes: 0,
        truncated: false,
        sequenceNumber: 0,
      }),
    subscribe: (_instanceId, _handler) => Effect.succeed({ unsubscribe: () => {} }),
    closeAndRotate: (instanceId) =>
      Effect.sync(() => {
        bufferState.closeCalls.push(instanceId);
      }),
  };

  return { layer: Layer.succeed(LogBuffer, shape), state: bufferState };
}

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DUMMY_PROJECT_ID,
    title: "Test Project",
    workspaceRoot: process.cwd(),
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    managedProcesses: [DUMMY_DEFINITION],
    globalScriptDefaults: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockOrchestrationEngine(
  initialProjects: Record<string, unknown>[] = [makeProject()],
): {
  layer: Layer.Layer<OrchestrationEngineService>;
  setProjects: (projects: Record<string, unknown>[]) => void;
} {
  let projects = initialProjects;

  const shape = {
    getReadModel: () =>
      Effect.succeed({
        snapshotSequence: 0,
        projects,
        threads: [],
        managedProcessInstances: [],
        updatedAt: new Date().toISOString(),
      }),
    readEvents: () => Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 0 }),
    streamDomainEvents: Stream.empty,
  } as unknown as OrchestrationEngineShape;

  return {
    layer: Layer.succeed(OrchestrationEngineService, shape),
    setProjects: (p) => {
      projects = p;
    },
  };
}

// ── Test layer builder ──

function buildTestLayer(opts: {
  executorKind?: ManagedProcessExecutorKind;
  projects?: Record<string, unknown>[];
  initialRecords?: PersistedInstanceRecord[];
  reattachHandles?: Map<string, MockHandle>;
}) {
  const executorMock = createMockExecutor(
    opts.executorKind ?? "direct",
    opts.reattachHandles ?? new Map(),
  );
  const storeMock = createMockInstanceStore(opts.initialRecords);
  const logMock = createMockLogBuffer();
  const orchMock = createMockOrchestrationEngine(opts.projects);

  const deps = Layer.mergeAll(executorMock.layer, storeMock.layer, logMock.layer, orchMock.layer);
  const layer = Layer.provide(ManagedProcessManagerLive, deps);

  return {
    layer,
    executor: executorMock,
    store: storeMock,
    log: logMock,
    orch: orchMock,
  };
}

// ── Tests ──

describe("ManagedProcessManager", () => {
  describe("start", () => {
    it("happy path: spawn → running, events emitted, record persisted", async () => {
      const ctx = buildTestLayer({});

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          // Collect events.
          const events: ManagerLifecycleEvent[] = [];
          const eventFiber = yield* Effect.forkScoped(
            Stream.runForEach(manager.events, (e) => Effect.sync(() => events.push(e))),
          );
          // Let forked stream register its listener before emitting events.
          yield* Effect.sleep("10 millis");

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });

          expect(instance.status).toBe("running");
          expect(instance.processDefId).toBe("dev-server");
          expect(instance.projectId).toBe(DUMMY_PROJECT_ID);
          expect(instance.executor).toBe("direct");
          expect(instance.restartAttempt).toBe(0);

          // Executor received spawn call.
          expect(ctx.executor.state.spawnCalls).toHaveLength(1);
          expect(ctx.executor.state.spawnCalls[0]!.command).toBe("npm run dev");

          // Record persisted.
          expect(ctx.store.state.records.size).toBeGreaterThan(0);

          // Log buffer opened.
          expect(ctx.log.state.openCalls).toContain(instance.instanceId);

          // Events emitted.
          yield* Effect.sleep("50 millis");
          expect(events.some((e) => e.type === "started")).toBe(true);
          expect(
            events.some(
              (e) => e.type === "stateChanged" && e.next === "running" && e.prev === "starting",
            ),
          ).toBe(true);

          yield* Fiber.interrupt(eventFiber);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });

    it("is idempotent for an already-running instance", async () => {
      const ctx = buildTestLayer({});

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const first = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });
          const second = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });

          expect(first.instanceId).toBe(second.instanceId);
          // Only one spawn call.
          expect(ctx.executor.state.spawnCalls).toHaveLength(1);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("stop", () => {
    it("running → stopping → stopped on exit, events fire, log rotated", async () => {
      const ctx = buildTestLayer({});

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const events: ManagerLifecycleEvent[] = [];
          const eventFiber = yield* Effect.forkScoped(
            Stream.runForEach(manager.events, (e) => Effect.sync(() => events.push(e))),
          );
          yield* Effect.sleep("10 millis");

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });

          const stopResult = yield* manager.stop(instance.instanceId);
          expect(stopResult.status).toBe("stopping");

          // Simulate process exit.
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          handle.triggerExit(0, null);

          // Let fire-and-forget effects settle.
          yield* Effect.sleep("50 millis");

          // Verify list shows stopped.
          const instances = yield* manager.list(DUMMY_PROJECT_ID);
          const stopped = instances.find((i) => i.instanceId === instance.instanceId);
          expect(stopped?.status).toBe("stopped");

          // Events.
          expect(events.some((e) => e.type === "exited")).toBe(true);
          expect(events.some((e) => e.type === "stateChanged" && e.next === "stopped")).toBe(true);

          // LogBuffer.closeAndRotate called.
          expect(ctx.log.state.closeCalls).toContain(instance.instanceId);

          yield* Fiber.interrupt(eventFiber);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("crash", () => {
    it("non-zero exit → crashed; no autoRestart when policy is null", async () => {
      const ctx = buildTestLayer({});

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });

          // Simulate crash.
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          handle.triggerExit(1, null);

          yield* Effect.sleep("50 millis");

          const instances = yield* manager.list(DUMMY_PROJECT_ID);
          const crashed = instances.find((i) => i.instanceId === instance.instanceId);
          expect(crashed?.status).toBe("crashed");
          expect(crashed?.exitCode).toBe(1);

          // No auto-restart spawn (autoRestart is null).
          expect(ctx.executor.state.spawnCalls).toHaveLength(1);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("autoRestart", () => {
    const AUTO_RESTART_DEFINITION: ManagedProcess = {
      ...DUMMY_DEFINITION,
      id: "auto-restart-proc",
      autoRestart: { onCrash: true, maxAttempts: 3, backoffMs: 1 },
    } as ManagedProcess;

    it("restarts after crash when policy is set", async () => {
      const ctx = buildTestLayer({
        projects: [
          makeProject({
            managedProcesses: [AUTO_RESTART_DEFINITION],
          }),
        ],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "auto-restart-proc",
            worktreePath: null,
          });

          // Simulate crash (non-zero, non-user-initiated).
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          handle.triggerExit(1, null);

          // Wait for auto-restart (backoffMs: 1).
          yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 200)));

          // A second spawn should have occurred.
          expect(ctx.executor.state.spawnCalls.length).toBeGreaterThanOrEqual(2);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });

    it("gives up after maxAttempts with lastError set", async () => {
      const exhaustDef: ManagedProcess = {
        ...DUMMY_DEFINITION,
        id: "exhaust-proc",
        autoRestart: { onCrash: true, maxAttempts: 0, backoffMs: 1 },
      } as ManagedProcess;

      const ctx = buildTestLayer({
        projects: [makeProject({ managedProcesses: [exhaustDef] })],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const events: ManagerLifecycleEvent[] = [];
          const eventFiber = yield* Effect.forkScoped(
            Stream.runForEach(manager.events, (e) => Effect.sync(() => events.push(e))),
          );
          yield* Effect.sleep("10 millis");

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "exhaust-proc",
            worktreePath: null,
          });

          // Crash.
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          handle.triggerExit(1, null);

          yield* Effect.sleep("100 millis");

          // maxAttempts = 0 → next (1) > 0 → give up immediately. No restart.
          expect(ctx.executor.state.spawnCalls).toHaveLength(1);

          // lastError set via stateChanged event.
          const gaveUp = events.find(
            (e) =>
              e.type === "stateChanged" && e.lastError !== null && e.lastError.includes("gave up"),
          );
          expect(gaveUp).toBeDefined();

          yield* Fiber.interrupt(eventFiber);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("restart", () => {
    it("stops and re-spawns using current definition", async () => {
      const defV1: ManagedProcess = {
        ...DUMMY_DEFINITION,
        id: "restart-proc",
        command: "cmd-v1",
      } as ManagedProcess;

      const defV2: ManagedProcess = {
        ...defV1,
        command: "cmd-v2",
      } as ManagedProcess;

      const ctx = buildTestLayer({
        projects: [makeProject({ managedProcesses: [defV1] })],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "restart-proc",
            worktreePath: null,
          });

          expect(ctx.executor.state.spawnCalls[0]!.command).toBe("cmd-v1");

          // Mutate definition before restart.
          ctx.orch.setProjects([makeProject({ managedProcesses: [defV2] })]);

          // Make mock handle auto-exit on stop for deterministic restart.
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          const origStop = handle.stop.bind(handle);
          handle.stop = () =>
            Effect.gen(function* () {
              yield* origStop();
              handle.triggerExit(0, null);
            });

          const restarted = yield* manager.restart(instance.instanceId);
          expect(restarted.status).toBe("running");

          // Second spawn uses the updated command.
          expect(ctx.executor.state.spawnCalls).toHaveLength(2);
          expect(ctx.executor.state.spawnCalls[1]!.command).toBe("cmd-v2");
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("writeStdin", () => {
    it("fails with invalid-state for non-running instance", async () => {
      const ctx = buildTestLayer({});

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          const instance = yield* manager.start({
            projectId: DUMMY_PROJECT_ID,
            processDefId: "dev-server",
            worktreePath: null,
          });

          // Stop and trigger exit.
          yield* manager.stop(instance.instanceId);
          const handle = ctx.executor.state.handles.get(instance.instanceId)!;
          handle.triggerExit(0, null);
          yield* Effect.sleep("50 millis");

          // writeStdin should fail.
          const result = yield* manager
            .writeStdin({ instanceId: instance.instanceId, data: "hello" })
            .pipe(Effect.result);

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe("invalid-state");
          }
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });

  describe("boot reconciliation", () => {
    it("direct mode: clears stale persisted records", async () => {
      const staleRecord: PersistedInstanceRecord = {
        instanceId: "stale-1",
        processDefId: "dev-server",
        projectId: DUMMY_PROJECT_ID,
        worktreePath: null,
        startedAt: new Date().toISOString(),
        definitionSnapshot: DUMMY_DEFINITION,
        executor: "direct",
        tmuxWindow: null,
        pid: 9999,
      };

      const ctx = buildTestLayer({
        executorKind: "direct",
        initialRecords: [staleRecord],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          // Layer construction runs reconciliation. Just access the service.
          yield* ManagedProcessManager;

          // Stale record should be removed.
          expect(ctx.store.state.records.size).toBe(0);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });

    it("tmux mode: restores live window, drops dead window", async () => {
      const liveHandle = new MockHandle("live-1", "tmux");
      const reattachHandles = new Map<string, MockHandle>();
      reattachHandles.set("live-window", liveHandle);

      const liveRecord: PersistedInstanceRecord = {
        instanceId: "live-1",
        processDefId: "dev-server",
        projectId: DUMMY_PROJECT_ID,
        worktreePath: null,
        startedAt: new Date().toISOString(),
        definitionSnapshot: DUMMY_DEFINITION,
        executor: "tmux",
        tmuxWindow: "live-window",
        pid: 1111,
      };

      const deadRecord: PersistedInstanceRecord = {
        instanceId: "dead-1",
        processDefId: "other-proc",
        projectId: DUMMY_PROJECT_ID,
        worktreePath: null,
        startedAt: new Date().toISOString(),
        definitionSnapshot: DUMMY_DEFINITION,
        executor: "tmux",
        tmuxWindow: "dead-window",
        pid: 2222,
      };

      const ctx = buildTestLayer({
        executorKind: "tmux",
        initialRecords: [liveRecord, deadRecord],
        reattachHandles,
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const manager = yield* ManagedProcessManager;

          // Live window should be restored.
          const instances = yield* manager.list(DUMMY_PROJECT_ID);
          const live = instances.find((i) => i.instanceId === "live-1");
          expect(live).toBeDefined();
          expect(live?.status).toBe("running");

          // Dead window's record should be dropped.
          const dead = instances.find((i) => i.instanceId === "dead-1");
          expect(dead).toBeUndefined();
          expect(ctx.store.state.records.has("dead-1")).toBe(false);
        }).pipe(Effect.scoped, Effect.provide(ctx.layer)),
      );
    });
  });
});
