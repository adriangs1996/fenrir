/**
 * ManagedProcessManager - Layer implementation.
 *
 * Orchestrates the in-memory instance map, ticks the state machine, drives the
 * chosen executor, persists records via InstanceStore, manages LogBuffer
 * subscriptions, and emits lifecycle events through a Stream.
 *
 * Boot reconciliation runs before the service is available:
 * - Direct mode: clears stale persisted records (processes die with server).
 * - Tmux mode: re-attaches surviving windows, drops dead ones.
 *
 * @module ManagedProcess/Layers/Manager
 */
import crypto from "node:crypto";

import { Deferred, Effect, Exit, Layer, Queue, Result, Stream } from "effect";
import { ManagedProcessRpcError } from "@fenrir/contracts";
import type {
  ManagedProcess,
  ManagedProcessExecutorKind,
  ManagedProcessInstance,
  ManagedProcessInstanceStatus,
  ProjectId,
} from "@fenrir/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { Executor, type ExecutorHandle } from "../Services/Executor.ts";
import { InstanceStore, type PersistedInstanceRecord } from "../Services/InstanceStore.ts";
import { LogBuffer } from "../Services/LogBuffer.ts";
import {
  ManagedProcessManager,
  type ManagerLifecycleEvent,
  type ManagedProcessManagerShape,
} from "../Services/Manager.ts";
import { PortlessWrapper } from "../Services/PortlessWrapper.ts";
import { ReadinessProbe, type ReadinessProbeHandle } from "../Services/ReadinessProbe.ts";
import { projectScriptRuntimeEnv, resolveManagedProcessCwd } from "@fenrir/shared/projectScripts";

const STOP_FORCE_KILL_GRACE_MS = 1_500;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface RuntimeInstance {
  instanceId: string;
  projectId: ProjectId;
  processDefId: string;
  worktreePath: string | null;
  scope: "worktree" | "project";
  definitionSnapshot: ManagedProcess;
  status: ManagedProcessInstanceStatus;
  ready: boolean;
  url: { estimate: string | null; confirmed: string | null };
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  restartAttempt: number;
  lastError: string | null;
  handle: ExecutorHandle | null;
  readinessProbe: ReadinessProbeHandle | null;
  unsubscribeReady: (() => void) | null;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
  /** Resolved by onExit handler; used by restart to await process termination. */
  _exitDeferred: Deferred.Deferred<void> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function instanceKey(
  projectId: ProjectId,
  processDefId: string,
  worktreePath: string | null,
): string {
  return `${projectId}::${processDefId}::${worktreePath ?? "__project__"}`;
}

function rpcError(code: ManagedProcessRpcError["code"], message: string): ManagedProcessRpcError {
  return new ManagedProcessRpcError({ code, message });
}

function toPublicInstance(
  inst: RuntimeInstance,
  executorKind: ManagedProcessExecutorKind,
): ManagedProcessInstance {
  return {
    instanceId: inst.instanceId,
    projectId: inst.projectId,
    processDefId: inst.processDefId,
    worktreePath: inst.worktreePath,
    scope: inst.scope,
    status: inst.status,
    ready: inst.ready,
    executor: executorKind,
    url: { estimate: inst.url.estimate, confirmed: inst.url.confirmed },
    startedAt: inst.startedAt,
    stoppedAt: inst.stoppedAt,
    exitCode: inst.exitCode,
    exitSignal: inst.exitSignal,
    restartAttempt: inst.restartAttempt,
    lastError: inst.lastError,
    updatedAt: new Date().toISOString(),
  } as ManagedProcessInstance;
}

function toPersistedRecord(
  inst: RuntimeInstance,
  executorKind: ManagedProcessExecutorKind,
): PersistedInstanceRecord {
  return {
    instanceId: inst.instanceId,
    processDefId: inst.processDefId,
    projectId: inst.projectId,
    worktreePath: inst.worktreePath,
    startedAt: inst.startedAt ?? new Date().toISOString(),
    definitionSnapshot: inst.definitionSnapshot,
    executor: executorKind,
    tmuxWindow: inst.handle?.executor === "tmux" ? inst.handle.nativeKey : null,
    pid: inst.handle?.pid ?? null,
  };
}

function stopReadinessProbe(inst: RuntimeInstance): void {
  inst.readinessProbe?.stop();
  inst.unsubscribeReady?.();
  inst.readinessProbe = null;
  inst.unsubscribeReady = null;
}

// ---------------------------------------------------------------------------
// Layer constructor
// ---------------------------------------------------------------------------

const makeManagedProcessManager = Effect.gen(function* () {
  const executor = yield* Executor;
  const instanceStore = yield* InstanceStore;
  const logBuffer = yield* LogBuffer;
  const portlessWrapper = yield* PortlessWrapper;
  const readinessProbe = yield* ReadinessProbe;
  const orchestrationEngine = yield* OrchestrationEngineService;

  const executorKind = executor.kind;

  // Capture service context so fire-and-forget effects can be spawned from callbacks.
  const services = yield* Effect.context();
  const runFork = Effect.runForkWith(services);

  // ── In-memory state ────────────────────────────────────────────────────

  const byId = new Map<string, RuntimeInstance>();
  /** Secondary index: instanceKey → instanceId (for idempotency). */
  const byKey = new Map<string, string>();

  // ── Event fan-out ──────────────────────────────────────────────────────

  const eventListeners = new Set<(event: ManagerLifecycleEvent) => void>();

  function emitEvent(event: ManagerLifecycleEvent): void {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch {
        /* swallow – listener errors must not crash the manager */
      }
    }
  }

  function setReady(inst: RuntimeInstance, ready: boolean): void {
    if (inst.ready === ready) return;
    inst.ready = ready;
    emitEvent({
      type: "readyChanged",
      instanceId: inst.instanceId,
      ready,
      url: { estimate: inst.url.estimate, confirmed: inst.url.confirmed },
    });
  }

  function attachReadinessProbe(inst: RuntimeInstance): void {
    stopReadinessProbe(inst);

    const probe = readinessProbe.create({
      instanceId: inst.instanceId,
      definition: inst.definitionSnapshot,
      urlEstimate: inst.url.estimate,
      urlConfirmed: () => inst.url.confirmed,
    });
    const readySub = probe.onReady(() => {
      if (inst.status !== "running" && inst.status !== "starting") return;
      setReady(inst, true);
    });

    inst.readinessProbe = probe;
    inst.unsubscribeReady = readySub.unsubscribe;
    probe.start();
  }

  const events: Stream.Stream<ManagerLifecycleEvent> = Stream.callback<ManagerLifecycleEvent>(
    (queue) => {
      const handler = (event: ManagerLifecycleEvent) => {
        runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
      };
      eventListeners.add(handler);
      return Effect.addFinalizer(() =>
        Effect.sync(() => {
          eventListeners.delete(handler);
        }),
      );
    },
  );

  // ── onExit handler ─────────────────────────────────────────────────────

  function handleExit(
    id: string,
    event: { exitCode: number | null; signal: string | null; userInitiated: boolean },
  ): void {
    const inst = byId.get(id);
    if (!inst) return;

    const prevStatus = inst.status;
    inst.exitCode = event.exitCode;
    inst.exitSignal = event.signal;
    inst.stoppedAt = new Date().toISOString();
    stopReadinessProbe(inst);
    inst.unsubscribeData?.();
    inst.unsubscribeExit?.();
    inst.unsubscribeData = null;
    inst.unsubscribeExit = null;
    inst.handle = null;

    const nextStatus: ManagedProcessInstanceStatus =
      event.userInitiated || event.exitCode === 0 ? "stopped" : "crashed";
    inst.status = nextStatus;
    setReady(inst, false);

    emitEvent({
      type: "exited",
      instanceId: id,
      exitCode: event.exitCode,
      exitSignal: event.signal,
      userInitiated: event.userInitiated,
    });
    emitEvent({
      type: "stateChanged",
      instanceId: id,
      prev: prevStatus,
      next: nextStatus,
      exitCode: event.exitCode,
      exitSignal: event.signal,
      lastError: inst.lastError,
    });

    // Resolve exit deferred if pending (used by restart to await termination).
    if (inst._exitDeferred) {
      Deferred.doneUnsafe(inst._exitDeferred, Exit.void);
      inst._exitDeferred = null;
    }

    // Persist + rotate logs (fire-and-forget).
    runFork(logBuffer.closeAndRotate(id));
    runFork(
      instanceStore
        .upsert(toPersistedRecord(inst, executorKind))
        .pipe(Effect.catchCause(() => Effect.void)),
    );

    // autoRestart
    if (nextStatus === "crashed" && inst.definitionSnapshot.autoRestart?.onCrash) {
      scheduleAutoRestart(inst);
    }
  }

  // ── autoRestart scheduler ──────────────────────────────────────────────

  function scheduleAutoRestart(inst: RuntimeInstance): void {
    const policy = inst.definitionSnapshot.autoRestart!;
    const next = inst.restartAttempt + 1;
    if (next > policy.maxAttempts) {
      inst.lastError = `autoRestart gave up after ${policy.maxAttempts} attempts`;
      emitEvent({
        type: "stateChanged",
        instanceId: inst.instanceId,
        prev: inst.status,
        next: inst.status,
        exitCode: inst.exitCode,
        exitSignal: inst.exitSignal,
        lastError: inst.lastError,
      });
      return;
    }
    const delay = Math.min(policy.backoffMs * 2 ** (next - 1), 30_000);
    setTimeout(() => {
      if (inst.status !== "crashed") return; // user intervened
      inst.restartAttempt = next;
      runFork(
        startImpl({
          projectId: inst.projectId,
          processDefId: inst.processDefId,
          worktreePath: inst.worktreePath,
          _isAutoRestart: true,
        }).pipe(Effect.catchCause(() => Effect.void)),
      );
    }, delay);
  }

  // ── start ──────────────────────────────────────────────────────────────

  const startImpl = (input: {
    projectId: ProjectId;
    processDefId: string;
    worktreePath: string | null;
    _isAutoRestart?: boolean;
  }): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError> =>
    Effect.gen(function* () {
      // 1. Look up project and definition.
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find((p) => p.id === input.projectId);
      if (!project) {
        return yield* rpcError("not-found", `project ${input.projectId} not found`);
      }
      const definition = project.managedProcesses.find((d) => d.id === input.processDefId);
      if (!definition) {
        return yield* rpcError("not-found", `process definition ${input.processDefId} not found`);
      }

      // 2. Compute instance key.
      const key = instanceKey(input.projectId, input.processDefId, input.worktreePath);

      // 3. Idempotency: running / starting / stopping → return existing.
      const existingId = byKey.get(key);
      let inheritedRestartAttempt = 0;
      if (existingId) {
        const existing = byId.get(existingId);
        if (
          existing &&
          (existing.status === "running" ||
            existing.status === "starting" ||
            existing.status === "stopping")
        ) {
          return toPublicInstance(existing, executorKind);
        }
        // 4. stopped / crashed → carry restart counter if auto-restart, then replace.
        if (existing) {
          if (input._isAutoRestart) {
            inheritedRestartAttempt = existing.restartAttempt;
          }
          byId.delete(existingId);
          byKey.delete(key);
        }
      }

      // 5. Validate cwd.
      const scopeRoot =
        definition.scope === "worktree" && input.worktreePath
          ? input.worktreePath
          : project.workspaceRoot;
      const cwdResult = resolveManagedProcessCwd({ scopeRoot, cwd: definition.cwd });
      if (!cwdResult.ok) {
        const instanceId = crypto.randomUUID();
        const now = new Date().toISOString();
        const inst: RuntimeInstance = {
          instanceId,
          projectId: input.projectId,
          processDefId: input.processDefId,
          worktreePath: input.worktreePath,
          scope: definition.scope,
          definitionSnapshot: definition,
          status: "crashed",
          ready: false,
          url: { estimate: null, confirmed: null },
          startedAt: now,
          stoppedAt: now,
          exitCode: null,
          exitSignal: null,
          restartAttempt: inheritedRestartAttempt,
          lastError: cwdResult.reason,
          handle: null,
          readinessProbe: null,
          unsubscribeReady: null,
          unsubscribeData: null,
          unsubscribeExit: null,
          _exitDeferred: null,
        };
        byId.set(instanceId, inst);
        byKey.set(key, instanceId);
        emitEvent({
          type: "stateChanged",
          instanceId,
          prev: "starting",
          next: "crashed",
          exitCode: null,
          exitSignal: null,
          lastError: cwdResult.reason,
        });
        runFork(
          instanceStore
            .upsert(toPersistedRecord(inst, executorKind))
            .pipe(Effect.catchCause(() => Effect.void)),
        );
        return toPublicInstance(inst, executorKind);
      }

      // 6. Wrap command if a proxy integration is configured.
      const wrapResult = yield* portlessWrapper
        .wrap({
          definition,
          worktreePath: input.worktreePath,
          branchName: null,
        })
        .pipe(
          Effect.mapError((err) =>
            rpcError(
              err.code === "portless-not-found" ? "portless-not-found" : "io-error",
              err.message,
            ),
          ),
        );
      const wrappedCommand = wrapResult.command;
      const urlEstimate = wrapResult.urlEstimate;
      const urlObserver = portlessWrapper.observeUrlConfirmation({ definition });

      // 7. Build env.
      const baseEnv = projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: input.worktreePath,
      });
      const env: Record<string, string> = { ...baseEnv, ...definition.env };

      // 8. Allocate instance.
      const instanceId = crypto.randomUUID();
      const now = new Date().toISOString();
      const inst: RuntimeInstance = {
        instanceId,
        projectId: input.projectId,
        processDefId: input.processDefId,
        worktreePath: input.worktreePath,
        scope: definition.scope,
        definitionSnapshot: definition,
        status: "starting",
        ready: false,
        url: { estimate: urlEstimate, confirmed: null },
        startedAt: now,
        stoppedAt: null,
        exitCode: null,
        exitSignal: null,
        restartAttempt: inheritedRestartAttempt,
        lastError: null,
        handle: null,
        readinessProbe: null,
        unsubscribeReady: null,
        unsubscribeData: null,
        unsubscribeExit: null,
        _exitDeferred: null,
      };
      byId.set(instanceId, inst);
      byKey.set(key, instanceId);

      // 9. Open log buffer.
      yield* logBuffer.open({
        instanceId,
        projectId: input.projectId,
        worktreePath: input.worktreePath,
        processDefId: input.processDefId,
      });

      // Emit started event.
      emitEvent({ type: "started", instance: toPublicInstance(inst, executorKind) });

      // 10. Persist.
      yield* instanceStore
        .upsert(toPersistedRecord(inst, executorKind))
        .pipe(Effect.catchCause(() => Effect.void));

      // 11. Spawn.
      const spawnResult = yield* executor
        .spawn({
          instanceId,
          command: wrappedCommand,
          cwd: cwdResult.absolute,
          env,
          cols: 120,
          rows: 40,
        })
        .pipe(Effect.result);

      if (Result.isFailure(spawnResult)) {
        // 12. Spawn failure.
        const err = spawnResult.failure;
        inst.status = "crashed";
        inst.lastError = err.message;
        inst.stoppedAt = new Date().toISOString();
        emitEvent({
          type: "stateChanged",
          instanceId,
          prev: "starting",
          next: "crashed",
          exitCode: null,
          exitSignal: null,
          lastError: err.message,
        });
        runFork(
          instanceStore
            .upsert(toPersistedRecord(inst, executorKind))
            .pipe(Effect.catchCause(() => Effect.void)),
        );
        return yield* rpcError("spawn-failed", err.message);
      }

      // 13. Spawn success — wire handlers.
      const handle = spawnResult.success;
      inst.handle = handle;

      const dataSub = handle.onData((chunk) => {
        runFork(logBuffer.append(instanceId, chunk));
        const confirmedUrl = urlObserver.observe(chunk);
        if (confirmedUrl !== null && inst.url.confirmed === null) {
          inst.url.confirmed = confirmedUrl;
          emitEvent({
            type: "readyChanged",
            instanceId,
            ready: inst.ready,
            url: { estimate: inst.url.estimate, confirmed: inst.url.confirmed },
          });
        }
        inst.readinessProbe?.observe(chunk);
      });
      inst.unsubscribeData = dataSub.unsubscribe;

      const exitSub = handle.onExit((ev) => {
        handleExit(instanceId, ev);
      });
      inst.unsubscribeExit = exitSub.unsubscribe;

      // Transition to running.
      inst.status = "running";
      emitEvent({
        type: "stateChanged",
        instanceId,
        prev: "starting",
        next: "running",
        exitCode: null,
        exitSignal: null,
        lastError: null,
      });

      // Update persisted record with handle info (pid, nativeKey).
      runFork(
        instanceStore
          .upsert(toPersistedRecord(inst, executorKind))
          .pipe(Effect.catchCause(() => Effect.void)),
      );

      attachReadinessProbe(inst);

      return toPublicInstance(inst, executorKind);
    });

  // ── stop ───────────────────────────────────────────────────────────────

  const stopImpl = (
    instanceId: string,
  ): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError> =>
    Effect.gen(function* () {
      const inst = byId.get(instanceId);
      if (!inst) {
        return yield* rpcError("not-found", "instance not found");
      }
      if (inst.status === "idle" || inst.status === "stopped" || inst.status === "crashed") {
        return yield* rpcError("invalid-state", `cannot stop instance in ${inst.status} state`);
      }
      if (!inst.handle) {
        return yield* rpcError("invalid-state", "instance has no active handle");
      }

      const prevStatus = inst.status;
      inst.status = "stopping";
      stopReadinessProbe(inst);
      setReady(inst, false);
      emitEvent({
        type: "stateChanged",
        instanceId,
        prev: prevStatus,
        next: "stopping",
        exitCode: null,
        exitSignal: null,
        lastError: null,
      });

      yield* inst.handle.stop().pipe(Effect.mapError((err) => rpcError("io-error", err.message)));

      setTimeout(() => {
        if (inst.status !== "stopping" || !inst.handle) return;
        runFork(inst.handle.forceKill().pipe(Effect.catchCause(() => Effect.void)));
      }, STOP_FORCE_KILL_GRACE_MS);

      return toPublicInstance(inst, executorKind);
    });

  // ── forceKill ──────────────────────────────────────────────────────────

  const forceKillImpl = (
    instanceId: string,
  ): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError> =>
    Effect.gen(function* () {
      const inst = byId.get(instanceId);
      if (!inst) {
        return yield* rpcError("not-found", "instance not found");
      }
      if (
        !inst.handle ||
        inst.status === "stopped" ||
        inst.status === "crashed" ||
        inst.status === "idle"
      ) {
        return yield* rpcError(
          "invalid-state",
          `cannot force-kill instance in ${inst.status} state`,
        );
      }

      // Keep in "stopping" until exit fires; set it if not already.
      if (inst.status !== "stopping") {
        const prevStatus = inst.status;
        inst.status = "stopping";
        stopReadinessProbe(inst);
        setReady(inst, false);
        emitEvent({
          type: "stateChanged",
          instanceId,
          prev: prevStatus,
          next: "stopping",
          exitCode: null,
          exitSignal: null,
          lastError: null,
        });
      }

      yield* inst.handle
        .forceKill()
        .pipe(Effect.mapError((err) => rpcError("io-error", err.message)));

      return toPublicInstance(inst, executorKind);
    });

  // ── restart ────────────────────────────────────────────────────────────

  const restartImpl = (
    instanceId: string,
  ): Effect.Effect<ManagedProcessInstance, ManagedProcessRpcError> =>
    Effect.gen(function* () {
      const inst = byId.get(instanceId);
      if (!inst) {
        return yield* rpcError("not-found", "instance not found");
      }

      const needsStop =
        inst.status === "running" || inst.status === "starting" || inst.status === "stopping";

      if (needsStop) {
        if (inst.status === "starting" && !inst.handle) {
          return yield* rpcError(
            "invalid-state",
            "cannot restart instance while it is starting without an active handle",
          );
        }

        const exitDeferred = yield* Deferred.make<void>();
        inst._exitDeferred = exitDeferred;

        if (inst.status !== "stopping") {
          const stopResult = yield* stopImpl(instanceId).pipe(Effect.result);
          if (Result.isFailure(stopResult)) {
            inst._exitDeferred = null;
            return yield* stopResult.failure;
          }
        }

        yield* Deferred.await(exitDeferred);
      }

      // Re-read definition from current project state (design §9).
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find((p) => p.id === inst.projectId);
      if (!project) {
        return yield* rpcError("not-found", "project not found after stop");
      }
      const newDef = project.managedProcesses.find((d) => d.id === inst.processDefId);
      if (!newDef) {
        return yield* rpcError("not-found", "process definition deleted");
      }

      // User-initiated restart: counter resets (via _isAutoRestart = false).
      return yield* startImpl({
        projectId: inst.projectId,
        processDefId: inst.processDefId,
        worktreePath: inst.worktreePath,
      });
    });

  // ── writeStdin ─────────────────────────────────────────────────────────

  const writeStdinImpl = (input: {
    instanceId: string;
    data: string;
  }): Effect.Effect<void, ManagedProcessRpcError> =>
    Effect.gen(function* () {
      const inst = byId.get(input.instanceId);
      if (!inst) {
        return yield* rpcError("not-found", "instance not found");
      }
      if (inst.status !== "running" && inst.status !== "starting") {
        return yield* rpcError("invalid-state", `cannot write to ${inst.status}`);
      }
      if (!inst.handle) {
        return yield* rpcError("invalid-state", "instance has no active handle");
      }
      yield* inst.handle
        .write(input.data)
        .pipe(Effect.mapError((err) => rpcError("io-error", err.message)));
    });

  // ── list ───────────────────────────────────────────────────────────────

  const listImpl = (projectId: ProjectId): Effect.Effect<ManagedProcessInstance[], never> =>
    Effect.sync(() => {
      const out: ManagedProcessInstance[] = [];
      for (const inst of byId.values()) {
        if (inst.projectId === projectId) {
          out.push(toPublicInstance(inst, executorKind));
        }
      }
      return out;
    });

  const listAllImpl: ManagedProcessManagerShape["listAll"] = () =>
    Effect.sync(() => Array.from(byId.values(), (inst) => toPublicInstance(inst, executorKind)));

  // ── subscribeLog ───────────────────────────────────────────────────────

  const subscribeLogImpl = (
    instanceId: string,
  ): Effect.Effect<
    {
      backfill: {
        bytes: string;
        ringBufferBytes: number;
        truncated: boolean;
        sequenceNumber: number;
      };
      stream: Stream.Stream<{ bytes: string; sequenceNumber: number }>;
    },
    ManagedProcessRpcError
  > =>
    Effect.gen(function* () {
      if (!byId.has(instanceId)) {
        return yield* rpcError("not-found", "instance not found");
      }

      const backfill = yield* logBuffer.read(instanceId);

      const stream = Stream.callback<{ bytes: string; sequenceNumber: number }>((queue) => {
        let unsubscribeFn: (() => void) | undefined;
        runFork(
          logBuffer
            .subscribe(instanceId, (chunk) => {
              runFork(Queue.offer(queue, chunk).pipe(Effect.asVoid));
            })
            .pipe(
              Effect.tap(({ unsubscribe }) =>
                Effect.sync(() => {
                  unsubscribeFn = unsubscribe;
                }),
              ),
            ),
        );
        return Effect.addFinalizer(() =>
          Effect.sync(() => {
            unsubscribeFn?.();
          }),
        );
      });

      return { backfill, stream };
    });

  // ── Boot reconciliation ────────────────────────────────────────────────

  yield* Effect.gen(function* () {
    const allRecords = yield* instanceStore
      .listAll()
      .pipe(Effect.catch(() => Effect.succeed([] as PersistedInstanceRecord[])));

    if (executorKind === "direct") {
      // Direct mode: no surviving processes. Clear stale records.
      yield* Effect.all(
        allRecords.map((r) => instanceStore.remove(r.instanceId)),
        { concurrency: "unbounded" },
      ).pipe(Effect.catchCause(() => Effect.void));
    } else {
      // Tmux mode: re-attach surviving windows; drop dead ones.
      for (const record of allRecords) {
        if (!executor.reattach || !record.tmuxWindow) {
          yield* instanceStore.remove(record.instanceId).pipe(Effect.catchCause(() => Effect.void));
          continue;
        }

        const reattachResult = yield* executor
          .reattach({
            instanceId: record.instanceId,
            nativeKey: record.tmuxWindow,
            cols: 120,
            rows: 40,
          })
          .pipe(Effect.result);

        if (Result.isSuccess(reattachResult)) {
          const handle = reattachResult.success;
          const urlObserver = portlessWrapper.observeUrlConfirmation({
            definition: record.definitionSnapshot,
          });
          const inst: RuntimeInstance = {
            instanceId: record.instanceId,
            projectId: record.projectId,
            processDefId: record.processDefId,
            worktreePath: record.worktreePath,
            scope: record.definitionSnapshot.scope,
            definitionSnapshot: record.definitionSnapshot,
            status: "running",
            ready: false,
            url: { estimate: null, confirmed: null },
            startedAt: record.startedAt,
            stoppedAt: null,
            exitCode: null,
            exitSignal: null,
            restartAttempt: 0,
            lastError: null,
            handle,
            readinessProbe: null,
            unsubscribeReady: null,
            unsubscribeData: null,
            unsubscribeExit: null,
            _exitDeferred: null,
          };

          const dataSub = handle.onData((chunk) => {
            runFork(logBuffer.append(record.instanceId, chunk));
            const confirmedUrl = urlObserver.observe(chunk);
            if (confirmedUrl !== null && inst.url.confirmed === null) {
              inst.url.confirmed = confirmedUrl;
              emitEvent({
                type: "readyChanged",
                instanceId: record.instanceId,
                ready: inst.ready,
                url: { estimate: inst.url.estimate, confirmed: inst.url.confirmed },
              });
            }
            inst.readinessProbe?.observe(chunk);
          });
          inst.unsubscribeData = dataSub.unsubscribe;

          const exitSub = handle.onExit((ev) => {
            handleExit(record.instanceId, ev);
          });
          inst.unsubscribeExit = exitSub.unsubscribe;

          // Re-open log buffer (append continues, no rotation).
          yield* logBuffer.open({
            instanceId: record.instanceId,
            projectId: record.projectId,
            worktreePath: record.worktreePath,
            processDefId: record.processDefId,
          });

          byId.set(record.instanceId, inst);
          byKey.set(
            instanceKey(record.projectId, record.processDefId, record.worktreePath),
            record.instanceId,
          );

          emitEvent({
            type: "started",
            instance: toPublicInstance(inst, executorKind),
          });
          emitEvent({
            type: "stateChanged",
            instanceId: record.instanceId,
            prev: "starting",
            next: "running",
            exitCode: null,
            exitSignal: null,
            lastError: null,
          });
          attachReadinessProbe(inst);
        } else {
          // Dead tmux window — drop persisted record.
          yield* instanceStore.remove(record.instanceId).pipe(Effect.catchCause(() => Effect.void));
        }
      }
    }
  });

  // ── Shutdown hooks ─────────────────────────────────────────────────────

  const shutdownHandler = () => {
    if (executorKind === "direct") {
      for (const inst of byId.values()) {
        if (inst.handle && (inst.status === "running" || inst.status === "starting")) {
          runFork(inst.handle.forceKill().pipe(Effect.catchCause(() => Effect.void)));
        }
      }
    } else {
      // Tmux: windows outlive Fenrir. Just flush in-flight log writes.
      for (const inst of byId.values()) {
        if (inst.status === "running" || inst.status === "starting") {
          runFork(logBuffer.closeAndRotate(inst.instanceId));
        }
      }
    }
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      process.removeListener("SIGINT", shutdownHandler);
      process.removeListener("SIGTERM", shutdownHandler);
      for (const inst of byId.values()) {
        stopReadinessProbe(inst);
      }
    }),
  );

  // ── Return shape ───────────────────────────────────────────────────────

  return {
    executorKind,
    start: (input) => startImpl(input),
    stop: stopImpl,
    forceKill: forceKillImpl,
    restart: restartImpl,
    writeStdin: writeStdinImpl,
    list: listImpl,
    listAll: listAllImpl,
    events,
    subscribeLog: subscribeLogImpl,
  } satisfies ManagedProcessManagerShape;
});

export const ManagedProcessManagerLive: Layer.Layer<
  ManagedProcessManager,
  never,
  | Executor
  | InstanceStore
  | LogBuffer
  | PortlessWrapper
  | ReadinessProbe
  | OrchestrationEngineService
> = Layer.effect(ManagedProcessManager, makeManagedProcessManager);
