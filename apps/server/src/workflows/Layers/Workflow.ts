import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type ChildProcess } from "node:child_process";
import vm from "node:vm";

import {
  CommandId,
  MessageId,
  NonNegativeInt,
  ThreadId,
  WorkflowAgentId,
  WorkflowError,
  WorkflowEventStreamItem,
  WorkflowId,
  WorkflowInputRequestId,
  WorkflowInputRequestSnapshot,
  WorkflowNotFoundError,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowStateEntry,
  WorkflowStepId,
  WorkflowTaskId,
  WorkflowTaskKind,
  WorkflowTaskSnapshot,
  type ModelSelection,
  type RuntimeMode,
  type WorkflowAgentSnapshot,
  type WorkflowDraft,
  type WorkflowStepSnapshot,
} from "@fenrir/contracts";
import {
  Deferred,
  Duration,
  Cause,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Scope,
  Stream,
} from "effect";

import { watchFileDebounced } from "../../fileWatcher.ts";
import { FENRIR_WORKFLOWS_MCP_ID, getSelectableMcpServers } from "@fenrir/shared/mcpBuiltIns";
import { getElectronNodeRunnerEnv } from "../../mcp/mcpRunnerRuntime.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { WorkflowRepository } from "../../persistence/Services/WorkflowRepository";
import type { WorkflowRunRow } from "../../persistence/Services/WorkflowRepository";
import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings.ts";
import { WorkflowService, type WorkflowServiceShape } from "../Services/Workflow";

const SOURCE_MAX_CHARS = 200_000;
const WORKFLOW_RUNTIME_SHUTDOWN_GRACE_MS = 2_000;
const FORBIDDEN_SOURCE_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: "fs", pattern: /\b(?:import|require)\s*(?:\(|[^;]*from\s*)["'](?:node:)?fs\b/ },
  {
    label: "child_process",
    pattern: /\b(?:import|require)\s*(?:\(|[^;]*from\s*)["'](?:node:)?child_process\b/,
  },
  { label: "net", pattern: /\b(?:import|require)\s*(?:\(|[^;]*from\s*)["'](?:node:)?net\b/ },
  { label: "http", pattern: /\b(?:import|require)\s*(?:\(|[^;]*from\s*)["'](?:node:)?https?\b/ },
  { label: "raw fetch", pattern: /\bfetch\s*\(/ },
  { label: "Bun.spawn", pattern: /\bBun\s*\.\s*spawn\b/ },
  { label: "Fenrir imports", pattern: /@fenrir\// },
];

interface ValidationResult {
  readonly valid: boolean;
  readonly error: string | null;
}

interface RuntimeAgentOptions {
  readonly role: string;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly mcpServerIds?: ReadonlyArray<string> | undefined;
}

interface RuntimeTaskFilter {
  readonly status?: WorkflowTaskSnapshot["status"] | undefined;
  readonly kind?: WorkflowTaskKind | undefined;
}

type WorkflowRuntimeCallHandler = (
  method: string,
  payload: unknown,
) => Effect.Effect<unknown, WorkflowError | WorkflowNotFoundError>;

type WorkflowRuntimeProcessMessage =
  | {
      readonly type: "ready";
    }
  | {
      readonly type: "ctx-call";
      readonly id: string;
      readonly method: string;
      readonly payload: unknown;
    }
  | {
      readonly type: "done";
    }
  | {
      readonly type: "error";
      readonly error?: {
        readonly message?: string;
        readonly stack?: string;
      };
    };

const WORKFLOW_RUNTIME_UNDEFINED = { __fenrirWorkflowUndefined: true } as const;

const WORKFLOW_RUNTIME_PROCESS_SOURCE = String.raw`
const vm = require("node:vm");
const { AsyncLocalStorage } = require("node:async_hooks");

const pending = new Map();
const stepScope = new AsyncLocalStorage();

function encode(value) {
  return value === undefined ? { __fenrirWorkflowUndefined: true } : value;
}

function decode(value) {
  return value && typeof value === "object" && value.__fenrirWorkflowUndefined === true
    ? undefined
    : value;
}

function safeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function send(message) {
  if (typeof process.send !== "function") {
    throw new Error("Workflow runtime IPC is unavailable.");
  }
  process.send(message);
}

function currentStepId() {
  return stepScope.getStore()?.stepId ?? null;
}

function call(method, payload) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({
      type: "ctx-call",
      id,
      method,
      payload: encode(payload),
    });
  });
}

function stateScope(options) {
  if (typeof options === "string" && options.trim().length > 0) {
    return options.trim();
  }
  if (
    options &&
    typeof options === "object" &&
    typeof options.scope === "string" &&
    options.scope.trim().length > 0
  ) {
    return options.scope.trim();
  }
  return undefined;
}

function makeCtx() {
  const ctx = Object.create(null);
  ctx.step = async (stepKey, fn) => {
    const started = await call("step.start", {
      stepKey,
      currentStepId: currentStepId(),
    });
    const stepId = started && typeof started === "object" ? started.stepId : null;
    if (typeof stepId !== "string" || stepId.length === 0) {
      throw new Error("Workflow runtime did not receive a step id.");
    }
    try {
      const result = await stepScope.run({ stepId }, async () => await fn());
      await call("step.finish", {
        stepId,
        stepKey,
        status: "completed",
        result,
      });
      return result;
    } catch (error) {
      await call("step.finish", {
        stepId,
        stepKey,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  };
  ctx.parallel = async (items, mapper, options) => {
    const list = Array.isArray(items) ? items : [];
    const concurrency = Math.max(1, Number(options?.concurrency ?? list.length));
    const results = new Array(list.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, list.length) }, async () => {
        while (cursor < list.length) {
          const index = cursor++;
          results[index] = await mapper(list[index], index);
        }
      }),
    );
    return results;
  };
  ctx.log = (value) => call("log", { value, currentStepId: currentStepId() });
  ctx.notify = (notification) =>
    call("notify", { notification, currentStepId: currentStepId() });
  ctx.mcp = Object.freeze({
    listAvailableServers: () => call("mcp.listAvailableServers", {}),
  });
  ctx.team = Object.freeze({
    agent: (name, options) =>
      Object.freeze({
        ask: (prompt) =>
          call("team.agent.ask", {
            name,
            options,
            prompt,
            currentStepId: currentStepId(),
          }),
      }),
  });
  ctx.ui = Object.freeze({
    ask: (request) => call("ui.ask", { request, currentStepId: currentStepId() }),
  });
  ctx.state = Object.freeze({
    get: (key, options) => call("state.get", { key, scope: stateScope(options) }),
    set: (key, value, options) =>
      call("state.set", { key, value, scope: stateScope(options), currentStepId: currentStepId() }),
    update: async (key, updater, options) => {
      const scope = stateScope(options);
      const current = await call("state.get", { key, scope });
      const next = await updater(current);
      await call("state.set", { key, value: next, scope, currentStepId: currentStepId() });
      return next;
    },
  });
  ctx.notes = Object.freeze({
    add: (note) => call("notes.add", { note, currentStepId: currentStepId() }),
  });
  ctx.tasks = Object.freeze({
    propose: (taskInput) =>
      call("tasks.propose", { taskInput, currentStepId: currentStepId() }),
    list: (filter) => call("tasks.list", { filter }),
    accept: (taskId) => call("tasks.accept", { taskId, currentStepId: currentStepId() }),
    reject: (taskId, reason) =>
      call("tasks.reject", { taskId, reason, currentStepId: currentStepId() }),
    run: (taskId) => call("tasks.run", { taskId, currentStepId: currentStepId() }),
  });
  return Object.freeze(ctx);
}

async function runWorkflow(message) {
  const context = vm.createContext(
    Object.assign(Object.create(null), {
      console: Object.freeze({
        log: (...args) => void call("log", { value: args.map(String).join(" "), currentStepId: currentStepId() }),
        warn: (...args) => void call("log", { value: args.map(String).join(" "), currentStepId: currentStepId() }),
        error: (...args) => void call("log", { value: args.map(String).join(" "), currentStepId: currentStepId() }),
      }),
      structuredClone,
    }),
    {
      codeGeneration: { strings: false, wasm: false },
    },
  );
  const script = new vm.Script(message.transformedSource, {
    filename: message.filename,
  });
  script.runInContext(context, { timeout: 1_000 });
  const workflowFn = context.__fenrirWorkflowDefault;
  if (typeof workflowFn !== "function") {
    throw new Error("Workflow default export was not callable.");
  }
  await workflowFn(makeCtx(), message.args);
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "ctx-response") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(decode(message.result));
    } else {
      entry.reject(new Error(String(message.error?.message ?? "Workflow ctx call failed.")));
    }
    return;
  }
  if (message.type !== "start") {
    return;
  }
  runWorkflow(message)
    .then(() => send({ type: "done" }))
    .catch((error) => send({ type: "error", error: safeError(error) }));
});

send({ type: "ready" });
`;

function now(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return crypto.randomUUID();
}

function withoutWorkflowManagementMcp(
  serverIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  return (serverIds ?? []).filter((serverId) => serverId !== FENRIR_WORKFLOWS_MCP_ID);
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function workflowError(message: string, cause?: unknown): WorkflowError {
  return new WorkflowError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function workflowNotFound(input: {
  readonly workflowId?: WorkflowId | undefined;
  readonly runId?: WorkflowRunId | undefined;
}): WorkflowNotFoundError {
  return new WorkflowNotFoundError({
    message:
      input.workflowId !== undefined
        ? `Workflow not found: ${input.workflowId}`
        : `Workflow run not found: ${input.runId}`,
    ...input,
  });
}

function transformWorkflowSource(source: string): string {
  const transformed = source.replace(
    /export\s+default\s+async\s+function(?:\s+[A-Za-z_$][\w$]*)?\s*\(/,
    "async function __fenrirWorkflowDefault(",
  );
  if (transformed === source) {
    throw new Error("Workflow must export a default async function.");
  }
  return `${transformed}\n;globalThis.__fenrirWorkflowDefault = __fenrirWorkflowDefault;`;
}

function validateSource(source: string): ValidationResult {
  if (source.trim().length === 0) {
    return { valid: false, error: "Workflow source is empty." };
  }
  if (source.length > SOURCE_MAX_CHARS) {
    return { valid: false, error: `Workflow source exceeds ${SOURCE_MAX_CHARS} characters.` };
  }
  if (!/export\s+default\s+async\s+function\b/.test(source)) {
    return { valid: false, error: "Workflow must export a default async function." };
  }
  for (const forbidden of FORBIDDEN_SOURCE_PATTERNS) {
    if (forbidden.pattern.test(source)) {
      return { valid: false, error: `Workflow source uses forbidden v1 API: ${forbidden.label}.` };
    }
  }
  try {
    const script = new vm.Script(transformWorkflowSource(source), {
      filename: "fenrir-workflow-validation.js",
    });
    script.createCachedData();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Workflow source does not compile: ${message}` };
  }
  return { valid: true, error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeRuntimeValue(value: unknown): unknown {
  return isRecord(value) && value.__fenrirWorkflowUndefined === true ? undefined : value;
}

function encodeRuntimeValue(value: unknown): unknown {
  return value === undefined ? WORKFLOW_RUNTIME_UNDEFINED : value;
}

function runtimeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function runtimeWorkflowStepId(
  payload: Record<string, unknown>,
  key: "currentStepId" | "stepId" = "currentStepId",
): WorkflowStepId | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? WorkflowStepId.make(value) : null;
}

function runtimeNodePath(): string {
  if (process.env.FENRIR_WORKFLOW_NODE_PATH?.trim()) {
    return process.env.FENRIR_WORKFLOW_NODE_PATH.trim();
  }
  return (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun
    ? "node"
    : process.execPath;
}

function runtimeProcessEnv(): NodeJS.ProcessEnv {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...getElectronNodeRunnerEnv(),
    NODE_NO_WARNINGS: "1",
  };
}

function terminateRuntimeProcess(child: ChildProcess): Effect.Effect<void> {
  return Effect.sync(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, WORKFLOW_RUNTIME_SHUTDOWN_GRACE_MS);
    timeout.unref?.();
  });
}

function terminalRunStatus(status: WorkflowRunSnapshot["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function latestAssistantText(
  thread: {
    readonly messages: ReadonlyArray<{
      readonly role: string;
      readonly text: string;
      readonly createdAt: string;
    }>;
  },
  afterIso: string,
): string {
  return (
    thread.messages
      .filter((message) => message.role === "assistant" && message.createdAt >= afterIso)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1)?.text ?? ""
  );
}

export const WorkflowLive = Layer.effect(
  WorkflowService,
  Effect.gen(function* () {
    const repo = yield* WorkflowRepository;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const config = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const eventPubSub = yield* PubSub.unbounded<WorkflowEventStreamItem>();
    const runtimeScope = yield* Scope.make("sequential");
    const watcherScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));
    yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

    const runFibers = yield* Ref.make(new Map<string, Fiber.Fiber<void, never>>());
    const runProcesses = yield* Ref.make(new Map<string, ChildProcess>());
    const watchedWorkflowIds = yield* Ref.make(new Set<string>());
    const pendingInput = yield* Ref.make(new Map<string, Deferred.Deferred<unknown>>());

    const publish = (event: WorkflowEventStreamItem) =>
      PubSub.publish(eventPubSub, event).pipe(Effect.asVoid);

    const publishRun = (run: WorkflowRunSnapshot) => publish({ type: "workflow.run.changed", run });
    const publishWorkflow = (workflow: WorkflowDraft) =>
      publish({ type: "workflow.changed", workflow });

    const provideFsPath = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );

    const appendEvent = (event: Parameters<typeof repo.appendEvent>[0]) =>
      repo.appendEvent(event).pipe(
        Effect.tap((persisted) => publish({ type: "workflow.event.appended", event: persisted })),
        Effect.mapError((error) => workflowError(error.message, error)),
      );

    const updateRun = (runId: WorkflowRunId, patch: Parameters<typeof repo.updateRun>[1]) =>
      repo.updateRun(runId, patch).pipe(
        Effect.tap(publishRun),
        Effect.mapError((error) => workflowError(error.message, error)),
      );

    const getRunSnapshot = (runId: WorkflowRunId) =>
      repo.getRun(runId).pipe(
        Effect.mapError((error) => workflowError(error.message, error)),
        Effect.flatMap((runOption) =>
          Option.match(runOption, {
            onNone: () => Effect.fail(workflowNotFound({ runId })),
            onSome: Effect.succeed,
          }),
        ),
      );

    const getWorkflowDraft = (workflowId: WorkflowId) =>
      repo.getDraft(workflowId).pipe(
        Effect.mapError((error) => workflowError(error.message, error)),
        Effect.flatMap((workflowOption) =>
          Option.match(workflowOption, {
            onNone: () => Effect.fail(workflowNotFound({ workflowId })),
            onSome: Effect.succeed,
          }),
        ),
      );

    const validateAndPersist = (workflow: WorkflowDraft) =>
      Effect.gen(function* () {
        const validation = validateSource(workflow.source);
        const updated = yield* repo
          .updateDraft(workflow.workflowId, {
            status: validation.valid ? "validated" : "invalid",
            validationStatus: validation.valid ? "valid" : "invalid",
            validationError: validation.error,
            updatedAt: now() as any,
          })
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: updated.workflowId,
          runId: null,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.validation.changed",
          title: validation.valid ? "Workflow validated" : "Workflow validation failed",
          body: validation.error,
          payload: { valid: validation.valid },
          createdAt: updated.updatedAt,
        });
        yield* publishWorkflow(updated);
        return updated;
      });

    const workflowSourcePath = (workflowId: WorkflowId) => {
      const dir = path.join(config.stateDir, "workflows", workflowId);
      return { dir, filePath: path.join(dir, "workflow.js") };
    };

    const syncSourceInternal = (workflowId: WorkflowId, source: string) =>
      Effect.gen(function* () {
        const workflow = yield* getWorkflowDraft(workflowId);
        const sourceHash = hashSource(source);
        const updated = yield* repo
          .updateDraft(workflowId, {
            source,
            sourceHash,
            status: "draft",
            validationStatus: "pending",
            validationError: null,
            updatedAt: now() as any,
          })
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId,
          runId: null,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.source.synced",
          title: "Workflow source synced",
          body: null,
          payload: { previousHash: workflow.sourceHash, sourceHash },
          createdAt: updated.updatedAt,
        });
        yield* publishWorkflow(updated);
        return updated;
      });

    const ensureSourceWatcher = (workflowId: WorkflowId, filePath: string) =>
      Ref.modify(watchedWorkflowIds, (watched) => {
        if (watched.has(workflowId)) {
          return [false, watched] as const;
        }
        const next = new Set(watched);
        next.add(workflowId);
        return [true, next] as const;
      }).pipe(
        Effect.flatMap((shouldWatch) =>
          shouldWatch
            ? watchFileDebounced({
                filePath,
                debounce: Duration.millis(250),
                scope: watcherScope,
                onChange: fs.readFileString(filePath).pipe(
                  Effect.flatMap((source) => syncSourceInternal(workflowId, source)),
                  Effect.flatMap(validateAndPersist),
                ),
              }).pipe(provideFsPath)
            : Effect.void,
        ),
      );

    const waitForThreadTurnComplete = (
      threadId: ThreadId,
      startedAt: string,
    ): Effect.Effect<{ readonly text: string }, WorkflowError> => {
      const startedAtMs = Date.now();
      let turnWasActive = false;
      const poll: Effect.Effect<{ readonly text: string }, WorkflowError> = Effect.gen(
        function* () {
          const elapsedMs = Date.now() - startedAtMs;
          if (elapsedMs > 60 * 60 * 1000) {
            return yield* Effect.fail(workflowError("Workflow agent turn timed out."));
          }
          const readModel = yield* orchestrationEngine.getReadModel();
          const thread = readModel.threads.find((entry) => entry.id === threadId);
          if (!thread) {
            return yield* Effect.fail(
              workflowError(`Workflow agent thread not found: ${threadId}`),
            );
          }
          if (!thread.session) {
            yield* Effect.sleep(Duration.seconds(2));
            return yield* poll;
          }
          if (thread.session.activeTurnId !== null) {
            turnWasActive = true;
            yield* Effect.sleep(Duration.seconds(2));
            return yield* poll;
          }
          if (!turnWasActive) {
            yield* Effect.sleep(Duration.seconds(2));
            return yield* poll;
          }
          if (thread.session.status === "error") {
            return yield* Effect.fail(
              workflowError(thread.session.lastError ?? "Workflow agent session failed."),
            );
          }
          return { text: latestAssistantText(thread, startedAt) };
        },
      );
      return poll;
    };

    const dispatchOrFail = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
      orchestrationEngine
        .dispatch(command)
        .pipe(
          Effect.mapError((error) =>
            workflowError("Workflow orchestration dispatch failed.", error),
          ),
        );

    const runInIsolatedRuntime = (
      run: WorkflowRunSnapshot,
      source: string,
      handleCall: WorkflowRuntimeCallHandler,
    ) =>
      Effect.gen(function* () {
        const child = yield* Effect.sync(() =>
          spawn(runtimeNodePath(), ["--permission", "-e", WORKFLOW_RUNTIME_PROCESS_SOURCE], {
            env: runtimeProcessEnv(),
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          }),
        );
        yield* Ref.update(runProcesses, (current) => {
          const next = new Map(current);
          next.set(run.runId, child);
          return next;
        });

        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              let settled = false;
              let ready = false;
              const stderrChunks: string[] = [];
              const settle = (result: "success" | Error) => {
                if (settled) {
                  return;
                }
                settled = true;
                if (result === "success") {
                  resolve();
                } else {
                  reject(result);
                }
              };

              child.stderr?.on("data", (chunk: Buffer | string) => {
                if (stderrChunks.join("").length > 20_000) {
                  return;
                }
                stderrChunks.push(String(chunk));
              });

              child.on("error", (error) => {
                settle(error);
              });
              child.on("exit", (code, signal) => {
                if (settled) {
                  return;
                }
                const stderr = stderrChunks.join("").trim();
                settle(
                  new Error(
                    `Workflow runtime exited before completion (code ${code ?? "null"}, signal ${signal ?? "null"}).${stderr ? `\n${stderr}` : ""}`,
                  ),
                );
              });
              child.on("message", (message: WorkflowRuntimeProcessMessage) => {
                if (!isRecord(message)) {
                  return;
                }
                switch (message.type) {
                  case "ready": {
                    ready = true;
                    child.send({
                      type: "start",
                      transformedSource: transformWorkflowSource(source),
                      args: run.args ?? {},
                      filename: `fenrir-workflow-${run.workflowId}.js`,
                    });
                    return;
                  }
                  case "ctx-call": {
                    void Effect.runPromise(
                      handleCall(message.method, decodeRuntimeValue(message.payload)),
                    )
                      .then((result) => {
                        if (!child.connected) {
                          return;
                        }
                        child.send({
                          type: "ctx-response",
                          id: message.id,
                          ok: true,
                          result: encodeRuntimeValue(result),
                        });
                      })
                      .catch((error: unknown) => {
                        if (!child.connected) {
                          return;
                        }
                        child.send({
                          type: "ctx-response",
                          id: message.id,
                          ok: false,
                          error: {
                            message: error instanceof Error ? error.message : String(error),
                          },
                        });
                      });
                    return;
                  }
                  case "done":
                    settle("success");
                    return;
                  case "error":
                    settle(
                      new Error(
                        message.error?.stack ??
                          message.error?.message ??
                          "Workflow runtime failed.",
                      ),
                    );
                    return;
                }
              });

              const readyTimeout = setTimeout(() => {
                if (!ready) {
                  const stderr = stderrChunks.join("").trim();
                  settle(
                    new Error(
                      `Workflow runtime did not become ready.${stderr ? `\n${stderr}` : ""}`,
                    ),
                  );
                }
              }, 5_000);
              readyTimeout.unref?.();
            }),
          catch: (error) =>
            workflowError(error instanceof Error ? error.message : String(error), error),
        }).pipe(
          Effect.ensuring(
            Ref.update(runProcesses, (current) => {
              const next = new Map(current);
              next.delete(run.runId);
              return next;
            }).pipe(Effect.flatMap(() => terminateRuntimeProcess(child).pipe(Effect.ignore))),
          ),
        );
      });

    const ensureAgentThread = (input: {
      readonly run: WorkflowRunSnapshot;
      readonly agent: WorkflowAgentSnapshot;
      readonly options: RuntimeAgentOptions;
    }) =>
      Effect.gen(function* () {
        if (input.agent.threadId !== null) {
          return input.agent.threadId;
        }
        const readModel = yield* orchestrationEngine.getReadModel();
        const originThread = readModel.threads.find(
          (thread) => thread.id === input.run.originThreadId,
        );
        if (!originThread) {
          return yield* Effect.fail(
            workflowError(`Origin thread not found: ${input.run.originThreadId}`),
          );
        }
        const threadId = ThreadId.make(makeId());
        const createdAt = now();
        yield* dispatchOrFail({
          type: "thread.create",
          commandId: CommandId.make(`workflow-agent:create:${makeId()}`),
          threadId,
          projectId: input.run.projectId,
          title: `[Workflow] ${input.run.name}: ${input.agent.name}` as any,
          modelSelection: input.options.modelSelection ?? originThread.modelSelection,
          runtimeMode: input.options.runtimeMode ?? originThread.runtimeMode,
          interactionMode: "default",
          mcpServerIds: withoutWorkflowManagementMcp(
            input.options.mcpServerIds ?? originThread.mcpServerIds,
          ) as any,
          branch: originThread.branch as any,
          worktreePath: originThread.worktreePath as any,
          visibility: "internal",
          owner: {
            kind: "workflowAgent",
            parentThreadId: input.run.originThreadId,
            workflowRunId: input.run.runId,
            agentName: input.agent.name,
          },
          deleteOnSettled: false,
          createdAt: createdAt as any,
        });
        const updated: WorkflowAgentSnapshot = {
          ...input.agent,
          threadId,
          updatedAt: createdAt as any,
        };
        yield* repo
          .upsertAgent(updated)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: input.run.workflowId,
          runId: input.run.runId,
          stepId: null,
          agentId: input.agent.agentId,
          taskId: null,
          kind: "workflow.agent.created",
          title: `Agent ${input.agent.name} created`,
          body: input.agent.role,
          payload: { threadId },
          createdAt: createdAt as any,
        });
        return threadId;
      });

    const runWorkflowSource = (run: WorkflowRunSnapshot, source: string) =>
      Effect.gen(function* () {
        const stepScope = new AsyncLocalStorage<{
          readonly stepId: WorkflowStepId | null;
        }>();
        const currentStepId = () => stepScope.getStore()?.stepId ?? null;
        const stateScope = "workflow" as any;

        const getLatestRun = () => getRunSnapshot(run.runId);

        const persistState = (key: string, value: unknown, scope: string = stateScope) =>
          Effect.gen(function* () {
            const entry: WorkflowStateEntry = {
              runId: run.runId,
              scope: scope as any,
              key: key as any,
              value,
              updatedAt: now() as any,
            };
            yield* repo
              .upsertState(entry)
              .pipe(Effect.mapError((error) => workflowError(error.message, error)));
            yield* appendEvent({
              workflowId: run.workflowId,
              runId: run.runId,
              stepId: currentStepId(),
              agentId: null,
              taskId: null,
              kind: "workflow.state.updated",
              title: `State updated: ${key}`,
              body: null,
              payload: { scope, key, value },
              createdAt: entry.updatedAt,
            });
            yield* getLatestRun().pipe(Effect.flatMap(publishRun));
            return entry;
          });

        const getOrCreateAgent = (name: string, options: RuntimeAgentOptions) =>
          Effect.gen(function* () {
            const snapshot = yield* getLatestRun();
            const existing = snapshot.agents.find((agent) => agent.name === name);
            if (existing) {
              return existing;
            }
            const createdAt = now();
            const agent: WorkflowAgentSnapshot = {
              agentId: WorkflowAgentId.make(`${run.runId}:${name}`),
              runId: run.runId,
              name: name as any,
              role: options.role,
              threadId: null,
              status: "idle",
              ...(options.modelSelection !== undefined
                ? { modelSelection: options.modelSelection }
                : {}),
              ...(options.runtimeMode !== undefined ? { runtimeMode: options.runtimeMode } : {}),
              mcpServerIds: withoutWorkflowManagementMcp(options.mcpServerIds) as any,
              createdAt: createdAt as any,
              updatedAt: createdAt as any,
            };
            yield* repo
              .upsertAgent(agent)
              .pipe(Effect.mapError((error) => workflowError(error.message, error)));
            yield* appendEvent({
              workflowId: run.workflowId,
              runId: run.runId,
              stepId: currentStepId(),
              agentId: agent.agentId,
              taskId: null,
              kind: "workflow.agent.created",
              title: `Agent ${name} registered`,
              body: options.role,
              payload: {},
              createdAt: createdAt as any,
            });
            yield* getLatestRun().pipe(Effect.flatMap(publishRun));
            return agent;
          });

        const askAgent = (name: string, options: RuntimeAgentOptions, prompt: string) =>
          Effect.gen(function* () {
            const snapshot = yield* getLatestRun();
            const agent = yield* getOrCreateAgent(name, options);
            const threadId = yield* ensureAgentThread({ run: snapshot, agent, options });
            const startedAt = now();
            const runningAgent = {
              ...agent,
              threadId,
              status: "running" as const,
              updatedAt: startedAt as any,
            };
            yield* repo
              .upsertAgent(runningAgent)
              .pipe(Effect.mapError((error) => workflowError(error.message, error)));
            yield* appendEvent({
              workflowId: run.workflowId,
              runId: run.runId,
              stepId: currentStepId(),
              agentId: agent.agentId,
              taskId: null,
              kind: "workflow.agent.message.sent",
              title: `Message sent to ${name}`,
              body: prompt,
              payload: { threadId },
              createdAt: startedAt as any,
            });
            yield* dispatchOrFail({
              type: "thread.turn.start",
              commandId: CommandId.make(`workflow-agent:turn:${makeId()}`),
              threadId,
              message: {
                messageId: MessageId.make(makeId()),
                role: "user",
                text: prompt,
                attachments: [],
              },
              modelSelection: options.modelSelection ?? agent.modelSelection,
              runtimeMode: options.runtimeMode ?? agent.runtimeMode ?? "full-access",
              interactionMode: "default",
              mcpServerIds: withoutWorkflowManagementMcp(
                options.mcpServerIds ?? agent.mcpServerIds,
              ) as any,
              createdAt: startedAt as any,
            });
            const result = yield* waitForThreadTurnComplete(threadId, startedAt);
            const completedAt = now();
            yield* repo
              .upsertAgent({
                ...runningAgent,
                status: "idle",
                updatedAt: completedAt as any,
              })
              .pipe(Effect.mapError((error) => workflowError(error.message, error)));
            yield* appendEvent({
              workflowId: run.workflowId,
              runId: run.runId,
              stepId: currentStepId(),
              agentId: agent.agentId,
              taskId: null,
              kind: "workflow.agent.message.completed",
              title: `${name} completed`,
              body: result.text,
              payload: { threadId },
              createdAt: completedAt as any,
            });
            yield* getLatestRun().pipe(Effect.flatMap(publishRun));
            return { text: result.text, threadId };
          });

        const ctx = {
          step: async (stepKey: string, fn: () => Promise<unknown>) => {
            const startedAt = now();
            const latest = await Effect.runPromise(getLatestRun());
            const existing = latest.steps.find((step) => step.stepKey === stepKey);
            const stepId = existing?.stepId ?? WorkflowStepId.make(`${run.runId}:${stepKey}`);
            const step: WorkflowStepSnapshot = {
              stepId,
              runId: run.runId,
              stepKey: stepKey as any,
              status: "running",
              result: null,
              error: null,
              sequence: existing?.sequence ?? NonNegativeInt.make(latest.steps.length),
              startedAt: (existing?.startedAt ?? startedAt) as any,
              completedAt: null,
            };
            await Effect.runPromise(
              repo.upsertStep(step).pipe(
                Effect.mapError((error) => workflowError(error.message, error)),
                Effect.flatMap(() =>
                  appendEvent({
                    workflowId: run.workflowId,
                    runId: run.runId,
                    stepId,
                    agentId: null,
                    taskId: null,
                    kind: "workflow.step.started",
                    title: `Step ${stepKey} started`,
                    body: null,
                    payload: {},
                    createdAt: startedAt as any,
                  }),
                ),
              ),
            );
            try {
              const result = await stepScope.run({ stepId }, async () => await fn());
              const completedAt = now();
              await Effect.runPromise(
                repo
                  .upsertStep({
                    ...step,
                    status: "completed",
                    result,
                    completedAt: completedAt as any,
                  })
                  .pipe(
                    Effect.mapError((error) => workflowError(error.message, error)),
                    Effect.flatMap(() =>
                      appendEvent({
                        workflowId: run.workflowId,
                        runId: run.runId,
                        stepId,
                        agentId: null,
                        taskId: null,
                        kind: "workflow.step.completed",
                        title: `Step ${stepKey} completed`,
                        body: null,
                        payload: { result },
                        createdAt: completedAt as any,
                      }),
                    ),
                    Effect.flatMap(() => getLatestRun()),
                    Effect.flatMap(publishRun),
                  ),
              );
              return result;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const completedAt = now();
              await Effect.runPromise(
                repo
                  .upsertStep({
                    ...step,
                    status: "failed",
                    error: message,
                    completedAt: completedAt as any,
                  })
                  .pipe(
                    Effect.mapError((repoError) => workflowError(repoError.message, repoError)),
                    Effect.flatMap(() =>
                      appendEvent({
                        workflowId: run.workflowId,
                        runId: run.runId,
                        stepId,
                        agentId: null,
                        taskId: null,
                        kind: "workflow.step.failed",
                        title: `Step ${stepKey} failed`,
                        body: message,
                        payload: {},
                        createdAt: completedAt as any,
                      }),
                    ),
                  ),
              );
              throw error;
            }
          },
          parallel: async <A, B>(
            items: ReadonlyArray<A>,
            mapper: (item: A, index: number) => Promise<B>,
            options?: { readonly concurrency?: number },
          ) => {
            const concurrency = Math.max(1, options?.concurrency ?? items.length);
            const results: B[] = [];
            results.length = items.length;
            let cursor = 0;
            const workers = Array.from(
              { length: Math.min(concurrency, items.length) },
              async () => {
                while (cursor < items.length) {
                  const index = cursor++;
                  results[index] = await mapper(items[index]!, index);
                }
              },
            );
            await Promise.all(workers);
            return results;
          },
          log: async (messageOrEvent: unknown) => {
            const title = typeof messageOrEvent === "string" ? messageOrEvent : "Workflow log";
            await Effect.runPromise(
              appendEvent({
                workflowId: run.workflowId,
                runId: run.runId,
                stepId: currentStepId(),
                agentId: null,
                taskId: null,
                kind: "workflow.note.added",
                title,
                body: typeof messageOrEvent === "string" ? null : JSON.stringify(messageOrEvent),
                payload: { value: messageOrEvent },
                createdAt: now() as any,
              }),
            );
          },
          notify: async (notification: {
            readonly level?: string;
            readonly title: string;
            readonly body?: string;
          }) => {
            await Effect.runPromise(
              appendEvent({
                workflowId: run.workflowId,
                runId: run.runId,
                stepId: currentStepId(),
                agentId: null,
                taskId: null,
                kind: "workflow.notification.emitted",
                title: notification.title,
                body: notification.body ?? null,
                payload: { level: notification.level ?? "info" },
                createdAt: now() as any,
              }),
            );
          },
          mcp: {
            listAvailableServers: async () => {
              const settings = await Effect.runPromise(serverSettings.getSettings);
              return getSelectableMcpServers(settings)
                .filter((server) => server.id !== FENRIR_WORKFLOWS_MCP_ID)
                .map((server) => ({
                  id: server.id,
                  name: server.name,
                  description: server.description,
                  source: server.source,
                  enabled: server.enabled,
                }));
            },
          },
          team: {
            agent: (name: string, options: RuntimeAgentOptions) => ({
              ask: (prompt: string) => Effect.runPromise(askAgent(name, options, prompt)),
            }),
          },
          ui: {
            ask: async (request: {
              readonly title: string;
              readonly body?: string;
              readonly fields?: unknown;
            }) => {
              const requestId = WorkflowInputRequestId.make(makeId());
              const deferred = await Effect.runPromise(Deferred.make<unknown>());
              const createdAt = now();
              const inputRequest: WorkflowInputRequestSnapshot = {
                requestId,
                runId: run.runId,
                title: request.title as any,
                body: request.body ?? null,
                fields: request.fields ?? [],
                status: "pending",
                response: null,
                createdAt: createdAt as any,
                resolvedAt: null,
              };
              await Effect.runPromise(
                Ref.update(pendingInput, (current) => {
                  const next = new Map(current);
                  next.set(requestId, deferred);
                  return next;
                }).pipe(
                  Effect.flatMap(() =>
                    repo
                      .upsertInputRequest(inputRequest)
                      .pipe(Effect.mapError((error) => workflowError(error.message, error))),
                  ),
                  Effect.flatMap(() =>
                    updateRun(run.runId, {
                      status: "paused",
                      lastUpdatedAt: createdAt as any,
                    }),
                  ),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId: null,
                      kind: "workflow.run.paused",
                      title: "Workflow paused",
                      body: request.body ?? null,
                      payload: { requestId },
                      createdAt: createdAt as any,
                    }),
                  ),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId: null,
                      kind: "workflow.input.requested",
                      title: request.title,
                      body: request.body ?? null,
                      payload: { requestId, fields: request.fields ?? [] },
                      createdAt: createdAt as any,
                    }),
                  ),
                ),
              );
              return await Effect.runPromise(Deferred.await(deferred));
            },
          },
          state: {
            get: async (key: string, scope: string = stateScope) => {
              const latest = await Effect.runPromise(getLatestRun());
              return latest.state.find((entry) => entry.scope === scope && entry.key === key)
                ?.value;
            },
            set: (key: string, value: unknown, scope: string = stateScope) =>
              Effect.runPromise(persistState(key, value, scope)),
            update: async (
              key: string,
              updater: (value: unknown) => unknown,
              scope: string = stateScope,
            ) => {
              const latest = await Effect.runPromise(getLatestRun());
              const current = latest.state.find(
                (entry) => entry.scope === scope && entry.key === key,
              )?.value;
              return await Effect.runPromise(persistState(key, updater(current), scope));
            },
          },
          notes: {
            add: async (note: {
              readonly title?: string;
              readonly body: string;
              readonly visibility?: string;
            }) => {
              await Effect.runPromise(
                appendEvent({
                  workflowId: run.workflowId,
                  runId: run.runId,
                  stepId: currentStepId(),
                  agentId: null,
                  taskId: null,
                  kind: "workflow.note.added",
                  title: note.title ?? "Workflow note",
                  body: note.body,
                  payload: { visibility: note.visibility ?? "run" },
                  createdAt: now() as any,
                }),
              );
            },
          },
          tasks: {
            propose: async (taskInput: {
              readonly title: string;
              readonly reason?: string;
              readonly kind?: WorkflowTaskKind;
              readonly assignee?: string;
              readonly prompt: string;
            }) => {
              const createdAt = now();
              const task: WorkflowTaskSnapshot = {
                taskId: WorkflowTaskId.make(makeId()),
                runId: run.runId,
                title: taskInput.title as any,
                reason: taskInput.reason ?? null,
                kind: taskInput.kind ?? "other",
                assignee: (taskInput.assignee as any) ?? null,
                prompt: taskInput.prompt,
                status: "proposed",
                createdByAgentId: null,
                result: null,
                error: null,
                createdAt: createdAt as any,
                updatedAt: createdAt as any,
              };
              await Effect.runPromise(
                repo.upsertTask(task).pipe(
                  Effect.mapError((error) => workflowError(error.message, error)),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId: task.taskId,
                      kind: "workflow.task.proposed",
                      title: task.title,
                      body: task.reason,
                      payload: { kind: task.kind, assignee: task.assignee, prompt: task.prompt },
                      createdAt: createdAt as any,
                    }),
                  ),
                ),
              );
              return task;
            },
            list: async (filter?: RuntimeTaskFilter) => {
              const latest = await Effect.runPromise(getLatestRun());
              return latest.tasks.filter(
                (task) =>
                  (filter?.status === undefined || task.status === filter.status) &&
                  (filter?.kind === undefined || task.kind === filter.kind),
              );
            },
            accept: async (taskId: WorkflowTaskId) => {
              const latest = await Effect.runPromise(getLatestRun());
              const task = latest.tasks.find((entry) => entry.taskId === taskId);
              if (!task) throw new Error(`Workflow task not found: ${taskId}`);
              const updatedAt = now();
              const updated = { ...task, status: "accepted" as const, updatedAt: updatedAt as any };
              await Effect.runPromise(
                repo.upsertTask(updated).pipe(
                  Effect.mapError((error) => workflowError(error.message, error)),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId,
                      kind: "workflow.task.accepted",
                      title: task.title,
                      body: null,
                      payload: {},
                      createdAt: updatedAt as any,
                    }),
                  ),
                ),
              );
              return updated;
            },
            reject: async (taskId: WorkflowTaskId, reason?: string) => {
              const latest = await Effect.runPromise(getLatestRun());
              const task = latest.tasks.find((entry) => entry.taskId === taskId);
              if (!task) throw new Error(`Workflow task not found: ${taskId}`);
              const updatedAt = now();
              const updated = {
                ...task,
                status: "rejected" as const,
                error: reason ?? null,
                updatedAt: updatedAt as any,
              };
              await Effect.runPromise(
                repo.upsertTask(updated).pipe(
                  Effect.mapError((error) => workflowError(error.message, error)),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId,
                      kind: "workflow.task.rejected",
                      title: task.title,
                      body: reason ?? null,
                      payload: {},
                      createdAt: updatedAt as any,
                    }),
                  ),
                ),
              );
              return updated;
            },
            run: async (taskId: WorkflowTaskId) => {
              const latest = await Effect.runPromise(getLatestRun());
              const task = latest.tasks.find((entry) => entry.taskId === taskId);
              if (!task) throw new Error(`Workflow task not found: ${taskId}`);
              const startedAt = now();
              await Effect.runPromise(
                repo
                  .upsertTask({
                    ...task,
                    status: "running",
                    updatedAt: startedAt as any,
                  })
                  .pipe(
                    Effect.mapError((error) => workflowError(error.message, error)),
                    Effect.flatMap(() =>
                      appendEvent({
                        workflowId: run.workflowId,
                        runId: run.runId,
                        stepId: currentStepId(),
                        agentId: null,
                        taskId,
                        kind: "workflow.task.started",
                        title: task.title,
                        body: null,
                        payload: {},
                        createdAt: startedAt as any,
                      }),
                    ),
                  ),
              );
              const result =
                task.assignee !== null
                  ? await Effect.runPromise(
                      askAgent(task.assignee, { role: `Own task: ${task.title}` }, task.prompt),
                    )
                  : { text: task.prompt };
              const completedAt = now();
              const updated = {
                ...task,
                status: "completed" as const,
                result,
                updatedAt: completedAt as any,
              };
              await Effect.runPromise(
                repo.upsertTask(updated).pipe(
                  Effect.mapError((error) => workflowError(error.message, error)),
                  Effect.flatMap(() =>
                    appendEvent({
                      workflowId: run.workflowId,
                      runId: run.runId,
                      stepId: currentStepId(),
                      agentId: null,
                      taskId,
                      kind: "workflow.task.completed",
                      title: task.title,
                      body:
                        typeof result === "object" && result && "text" in result
                          ? String(result.text)
                          : null,
                      payload: { result },
                      createdAt: completedAt as any,
                    }),
                  ),
                ),
              );
              return updated;
            },
          },
        };

        const payloadRecord = (payload: unknown): Record<string, unknown> =>
          isRecord(payload) ? payload : {};
        const runtimeAgentOptions = (value: unknown): RuntimeAgentOptions => {
          const options = payloadRecord(value);
          return {
            role: runtimeString(options.role, "Workflow agent"),
            ...(options.modelSelection !== undefined
              ? { modelSelection: options.modelSelection as ModelSelection }
              : {}),
            ...(options.runtimeMode !== undefined
              ? { runtimeMode: options.runtimeMode as RuntimeMode }
              : {}),
            ...(Array.isArray(options.mcpServerIds)
              ? { mcpServerIds: options.mcpServerIds.filter((id) => typeof id === "string") as any }
              : {}),
          };
        };
        const runtimeTaskFilter = (value: unknown): RuntimeTaskFilter | undefined => {
          if (!isRecord(value)) {
            return undefined;
          }
          return {
            ...(typeof value.status === "string"
              ? { status: value.status as WorkflowTaskSnapshot["status"] }
              : {}),
            ...(typeof value.kind === "string" ? { kind: value.kind as WorkflowTaskKind } : {}),
          };
        };
        const runtimeStateScope = (value: unknown) => runtimeString(value, stateScope);
        const withCurrentStep = async <A>(
          stepId: WorkflowStepId | null,
          operation: () => Promise<A>,
        ): Promise<A> => {
          return await stepScope.run({ stepId }, operation);
        };
        const startRuntimeStep = (payload: Record<string, unknown>) =>
          Effect.gen(function* () {
            const stepKey = runtimeString(payload.stepKey, "");
            if (!stepKey) {
              return yield* Effect.fail(workflowError("Workflow step key is required."));
            }
            const startedAt = now();
            const latest = yield* getLatestRun();
            const existing = latest.steps.find((step) => step.stepKey === stepKey);
            const stepId = existing?.stepId ?? WorkflowStepId.make(`${run.runId}:${stepKey}`);
            const step: WorkflowStepSnapshot = {
              stepId,
              runId: run.runId,
              stepKey: stepKey as any,
              status: "running",
              result: null,
              error: null,
              sequence: existing?.sequence ?? NonNegativeInt.make(latest.steps.length),
              startedAt: (existing?.startedAt ?? startedAt) as any,
              completedAt: null,
            };
            yield* repo
              .upsertStep(step)
              .pipe(Effect.mapError((error) => workflowError(error.message, error)));
            yield* appendEvent({
              workflowId: run.workflowId,
              runId: run.runId,
              stepId,
              agentId: null,
              taskId: null,
              kind: "workflow.step.started",
              title: `Step ${stepKey} started`,
              body: null,
              payload: {},
              createdAt: startedAt as any,
            });
            return { stepId };
          });
        const finishRuntimeStep = (payload: Record<string, unknown>) =>
          Effect.gen(function* () {
            const stepId = runtimeWorkflowStepId(payload, "stepId");
            const stepKey = runtimeString(payload.stepKey, "");
            if (!stepId || !stepKey) {
              return yield* Effect.fail(workflowError("Workflow step finish payload is invalid."));
            }
            const latest = yield* getLatestRun();
            const existing = latest.steps.find((step) => step.stepId === stepId);
            if (!existing) {
              return yield* Effect.fail(workflowError(`Workflow step not found: ${stepId}`));
            }
            const completedAt = now();
            if (payload.status === "completed") {
              const result = payload.result;
              yield* repo
                .upsertStep({
                  ...existing,
                  status: "completed",
                  result,
                  error: null,
                  completedAt: completedAt as any,
                })
                .pipe(Effect.mapError((error) => workflowError(error.message, error)));
              yield* appendEvent({
                workflowId: run.workflowId,
                runId: run.runId,
                stepId,
                agentId: null,
                taskId: null,
                kind: "workflow.step.completed",
                title: `Step ${stepKey} completed`,
                body: null,
                payload: { result },
                createdAt: completedAt as any,
              });
            } else {
              const message = runtimeString(payload.error, "Workflow step failed.");
              yield* repo
                .upsertStep({
                  ...existing,
                  status: "failed",
                  error: message,
                  completedAt: completedAt as any,
                })
                .pipe(Effect.mapError((error) => workflowError(error.message, error)));
              yield* appendEvent({
                workflowId: run.workflowId,
                runId: run.runId,
                stepId,
                agentId: null,
                taskId: null,
                kind: "workflow.step.failed",
                title: `Step ${stepKey} failed`,
                body: message,
                payload: {},
                createdAt: completedAt as any,
              });
            }
            yield* getLatestRun().pipe(Effect.flatMap(publishRun));
            return { stepId };
          });

        const handleRuntimeCall: WorkflowRuntimeCallHandler = (method, payload) => {
          const record = payloadRecord(payload);
          const stepId = runtimeWorkflowStepId(record);
          const ensureRuntimeRunActive = getLatestRun().pipe(
            Effect.flatMap((latest) =>
              terminalRunStatus(latest.status)
                ? Effect.fail(workflowError("Workflow run is no longer active."))
                : Effect.succeed(latest),
            ),
          );
          const withStep = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({
              try: () => withCurrentStep(stepId, operation),
              catch: (error) =>
                workflowError(error instanceof Error ? error.message : String(error), error),
            });
          const guarded = <A, E>(
            effect: Effect.Effect<A, E, never>,
          ): Effect.Effect<A, E | WorkflowError | WorkflowNotFoundError, never> =>
            ensureRuntimeRunActive.pipe(Effect.flatMap(() => effect));

          const operation = (() => {
            switch (method) {
              case "step.start":
                return startRuntimeStep(record);
              case "step.finish":
                return finishRuntimeStep(record);
              case "log":
                return withStep(() => ctx.log(record.value));
              case "notify":
                return withStep(() =>
                  ctx.notify(
                    isRecord(record.notification)
                      ? (record.notification as any)
                      : { title: "Workflow notification" },
                  ),
                );
              case "mcp.listAvailableServers":
                return Effect.tryPromise({
                  try: () => ctx.mcp.listAvailableServers(),
                  catch: (error) =>
                    workflowError(error instanceof Error ? error.message : String(error), error),
                });
              case "team.agent.ask":
                return withStep(() =>
                  ctx.team
                    .agent(runtimeString(record.name, "agent"), runtimeAgentOptions(record.options))
                    .ask(runtimeString(record.prompt, "")),
                );
              case "ui.ask":
                return withStep(() =>
                  ctx.ui.ask(
                    isRecord(record.request)
                      ? (record.request as any)
                      : { title: "Workflow input requested" },
                  ),
                );
              case "state.get":
                return Effect.tryPromise({
                  try: () =>
                    ctx.state.get(runtimeString(record.key, ""), runtimeStateScope(record.scope)),
                  catch: (error) =>
                    workflowError(error instanceof Error ? error.message : String(error), error),
                });
              case "state.set":
                return withStep(() =>
                  ctx.state.set(
                    runtimeString(record.key, ""),
                    record.value,
                    runtimeStateScope(record.scope),
                  ),
                );
              case "notes.add":
                return withStep(() =>
                  ctx.notes.add(
                    isRecord(record.note) ? (record.note as any) : { body: "Workflow note" },
                  ),
                );
              case "tasks.propose":
                return withStep(() =>
                  ctx.tasks.propose(
                    isRecord(record.taskInput)
                      ? (record.taskInput as any)
                      : { title: "Workflow task", prompt: "", kind: "other" },
                  ),
                );
              case "tasks.list":
                return Effect.tryPromise({
                  try: () => ctx.tasks.list(runtimeTaskFilter(record.filter)),
                  catch: (error) =>
                    workflowError(error instanceof Error ? error.message : String(error), error),
                });
              case "tasks.accept":
                return withStep(() =>
                  ctx.tasks.accept(WorkflowTaskId.make(runtimeString(record.taskId, ""))),
                );
              case "tasks.reject":
                return withStep(() =>
                  ctx.tasks.reject(
                    WorkflowTaskId.make(runtimeString(record.taskId, "")),
                    typeof record.reason === "string" ? record.reason : undefined,
                  ),
                );
              case "tasks.run":
                return withStep(() =>
                  ctx.tasks.run(WorkflowTaskId.make(runtimeString(record.taskId, ""))),
                );
              default:
                return Effect.fail(workflowError(`Unknown workflow runtime call: ${method}`));
            }
          })();
          return guarded(operation);
        };

        yield* runInIsolatedRuntime(run, source, handleRuntimeCall);
      });

    const executeRun = (run: WorkflowRunSnapshot, source: string) =>
      Effect.gen(function* () {
        const runExit = yield* Effect.exit(
          runWorkflowSource(run, source).pipe(
            Effect.flatMap(() =>
              getRunSnapshot(run.runId).pipe(
                Effect.flatMap((latest) => {
                  if (terminalRunStatus(latest.status)) {
                    return Effect.succeed(latest);
                  }
                  const completedAt = now();
                  return updateRun(run.runId, {
                    status: "completed",
                    summary: "Workflow completed.",
                    completedAt: completedAt as any,
                    lastUpdatedAt: completedAt as any,
                  });
                }),
              ),
            ),
            Effect.tap((completed) =>
              completed.status === "completed"
                ? appendEvent({
                    workflowId: completed.workflowId,
                    runId: completed.runId,
                    stepId: null,
                    agentId: null,
                    taskId: null,
                    kind: "workflow.run.completed",
                    title: "Workflow completed",
                    body: completed.summary,
                    payload: {},
                    createdAt: completed.completedAt ?? completed.lastUpdatedAt,
                  })
                : Effect.void,
            ),
          ),
        );
        if (Exit.isFailure(runExit)) {
          const latestExit = yield* Effect.exit(getRunSnapshot(run.runId));
          const latest = Exit.isFailure(latestExit) ? run : latestExit.value;
          if (terminalRunStatus(latest.status)) {
            return;
          }
          const failedAt = now();
          const message = Cause.pretty(runExit.cause);
          const failed = yield* updateRun(run.runId, {
            status: "failed",
            summary: message,
            completedAt: failedAt as any,
            lastUpdatedAt: failedAt as any,
          });
          yield* appendEvent({
            workflowId: failed.workflowId,
            runId: failed.runId,
            stepId: null,
            agentId: null,
            taskId: null,
            kind: "workflow.run.failed",
            title: "Workflow failed",
            body: message,
            payload: {},
            createdAt: failedAt as any,
          });
        }
      }).pipe(
        Effect.ensuring(
          Ref.update(runFibers, (current) => {
            const next = new Map(current);
            next.delete(run.runId);
            return next;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("workflow run fiber failed", {
            runId: run.runId,
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const activeAtBoot = yield* repo
      .listActiveRuns()
      .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<WorkflowRunSnapshot>)));
    for (const run of activeAtBoot) {
      const interruptedAt = now();
      const interruptionMessage = "Workflow was interrupted by server restart.";
      const interruptedExit = yield* Effect.exit(
        updateRun(run.runId, {
          status: "interrupted",
          summary: interruptionMessage,
          completedAt: interruptedAt as any,
          lastUpdatedAt: interruptedAt as any,
        }),
      );
      if (Exit.isSuccess(interruptedExit)) {
        for (const step of run.steps) {
          if (step.status !== "running" && step.status !== "pending") {
            continue;
          }
          yield* repo
            .upsertStep({
              ...step,
              status: "skipped",
              error: interruptionMessage,
              completedAt: interruptedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          yield* appendEvent({
            workflowId: run.workflowId,
            runId: run.runId,
            stepId: step.stepId,
            agentId: null,
            taskId: null,
            kind: "workflow.step.skipped",
            title: `Step ${step.stepKey} skipped`,
            body: interruptionMessage,
            payload: {},
            createdAt: interruptedAt as any,
          }).pipe(Effect.ignoreCause({ log: true }));
        }
        for (const request of run.inputRequests) {
          if (request.status !== "pending") {
            continue;
          }
          yield* repo
            .upsertInputRequest({
              ...request,
              status: "cancelled",
              resolvedAt: interruptedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          yield* appendEvent({
            workflowId: run.workflowId,
            runId: run.runId,
            stepId: null,
            agentId: null,
            taskId: null,
            kind: "workflow.input.cancelled",
            title: `Input cancelled: ${request.title}`,
            body: interruptionMessage,
            payload: { requestId: request.requestId },
            createdAt: interruptedAt as any,
          }).pipe(Effect.ignoreCause({ log: true }));
        }
        yield* appendEvent({
          workflowId: interruptedExit.value.workflowId,
          runId: interruptedExit.value.runId,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.run.interrupted",
          title: "Workflow interrupted",
          body: interruptedExit.value.summary,
          payload: {},
          createdAt: interruptedAt as any,
        }).pipe(Effect.ignoreCause({ log: true }));
      }
    }

    const createDraft: WorkflowServiceShape["createDraft"] = (input) =>
      Effect.gen(function* () {
        const createdAt = now();
        const workflow: WorkflowDraft = {
          workflowId: WorkflowId.make(makeId()),
          projectId: input.projectId,
          originThreadId: input.originThreadId,
          name: input.name,
          description: input.description ?? null,
          source: input.source,
          sourceHash: hashSource(input.source) as any,
          status: "draft",
          validationStatus: "pending",
          validationError: null,
          createdAt: createdAt as any,
          updatedAt: createdAt as any,
          archivedAt: null,
        };
        yield* repo
          .insertDraft(workflow)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: workflow.workflowId,
          runId: null,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.draft.created",
          title: `Workflow draft created: ${workflow.name}`,
          body: workflow.description,
          payload: {},
          createdAt: workflow.createdAt,
        });
        const validated = yield* validateAndPersist(workflow);
        return { workflow: validated };
      });

    const listThread: WorkflowServiceShape["listThread"] = (input) =>
      Effect.gen(function* () {
        const [drafts, runs] = yield* Effect.all(
          [repo.listDraftsForThread(input), repo.listRunsForThread(input)],
          { concurrency: "unbounded" },
        ).pipe(Effect.mapError((error) => workflowError(error.message, error)));
        return {
          runs,
          workflows: drafts.map((workflow) => {
            const workflowRuns = runs.filter((run) => run.workflowId === workflow.workflowId);
            const latestRun = workflowRuns[0] ?? null;
            const activeRunCount = workflowRuns.filter(
              (run) => run.status === "running" || run.status === "paused",
            ).length;
            const pendingInputCount = workflowRuns.reduce(
              (count, run) =>
                run.status === "running" || run.status === "paused"
                  ? count +
                    run.inputRequests.filter((request) => request.status === "pending").length
                  : count,
              0,
            );
            return {
              workflow,
              latestRun,
              activeRunCount: NonNegativeInt.make(activeRunCount),
              pendingInputCount: NonNegativeInt.make(pendingInputCount),
            };
          }),
        };
      });

    const openSource: WorkflowServiceShape["openSource"] = (input) =>
      Effect.gen(function* () {
        const workflow = yield* getWorkflowDraft(input.workflowId);
        const { dir, filePath } = workflowSourcePath(input.workflowId);
        yield* provideFsPath(fs.makeDirectory(dir, { recursive: true })).pipe(
          Effect.mapError((error) =>
            workflowError("Failed to create workflow source directory.", error),
          ),
        );
        yield* provideFsPath(fs.writeFileString(filePath, workflow.source)).pipe(
          Effect.mapError((error) =>
            workflowError("Failed to materialize workflow source.", error),
          ),
        );
        yield* ensureSourceWatcher(input.workflowId, filePath).pipe(
          Effect.mapError((error) => workflowError("Failed to watch workflow source.", error)),
        );
        yield* appendEvent({
          workflowId: workflow.workflowId,
          runId: null,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.source.opened",
          title: "Workflow source opened",
          body: filePath,
          payload: { path: filePath },
          createdAt: now() as any,
        });
        return { workflowId: input.workflowId, path: filePath as any };
      });

    const syncSource: WorkflowServiceShape["syncSource"] = (input) =>
      syncSourceInternal(input.workflowId, input.source).pipe(
        Effect.map((workflow) => ({ workflow })),
      );

    const validate: WorkflowServiceShape["validate"] = (input) =>
      getWorkflowDraft(input.workflowId).pipe(
        Effect.flatMap(validateAndPersist),
        Effect.map((workflow) => ({ workflow })),
      );

    const archive: WorkflowServiceShape["archive"] = (input) =>
      Effect.gen(function* () {
        const workflow = yield* getWorkflowDraft(input.workflowId);
        if (workflow.archivedAt !== null || workflow.status === "archived") {
          return { workflow };
        }
        const runs = yield* repo
          .listRunsForWorkflow(input.workflowId)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        const activeRun = runs.find((run) => run.status === "running" || run.status === "paused");
        if (activeRun) {
          return yield* workflowError("Stop active workflow runs before removing this workflow.");
        }
        const archivedAt = now();
        const archived = yield* repo
          .updateDraft(input.workflowId, {
            status: "archived",
            archivedAt: archivedAt as any,
            updatedAt: archivedAt as any,
          })
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: archived.workflowId,
          runId: null,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.draft.archived",
          title: `Workflow removed: ${archived.name}`,
          body: archived.description,
          payload: {},
          createdAt: archivedAt as any,
        });
        yield* publishWorkflow(archived);
        return { workflow: archived };
      });

    const run: WorkflowServiceShape["run"] = (input) =>
      Effect.gen(function* () {
        const workflow =
          input.workflowId !== undefined
            ? yield* getWorkflowDraft(input.workflowId)
            : yield* repo.latestRunnableDraftForThread(input).pipe(
                Effect.mapError((error) => workflowError(error.message, error)),
                Effect.flatMap((workflowOption) =>
                  Option.match(workflowOption, {
                    onNone: () =>
                      Effect.fail(
                        workflowError("No validated workflow exists for the current thread."),
                      ),
                    onSome: Effect.succeed,
                  }),
                ),
              );
        if (
          workflow.projectId !== input.projectId ||
          workflow.originThreadId !== input.originThreadId
        ) {
          return yield* Effect.fail(
            workflowError("Workflow does not belong to the requested thread."),
          );
        }
        if (workflow.status !== "validated" || workflow.validationStatus !== "valid") {
          return yield* Effect.fail(workflowError("Workflow must be validated before running."));
        }
        const validation = validateSource(workflow.source);
        if (!validation.valid) {
          yield* validateAndPersist(workflow);
          return yield* Effect.fail(workflowError(validation.error ?? "Workflow is invalid."));
        }
        const startedAt = now();
        const runRow: WorkflowRunRow = {
          runId: WorkflowRunId.make(makeId()),
          workflowId: workflow.workflowId,
          projectId: workflow.projectId,
          originThreadId: workflow.originThreadId,
          name: workflow.name,
          args: input.args ?? null,
          sourceSnapshot: workflow.source,
          sourceHash: workflow.sourceHash,
          status: "running",
          summary: null,
          startedAt: startedAt as any,
          completedAt: null,
          lastUpdatedAt: startedAt as any,
        };
        yield* repo
          .insertRun(runRow)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        const snapshot = yield* getRunSnapshot(runRow.runId);
        yield* publishRun(snapshot);
        yield* appendEvent({
          workflowId: workflow.workflowId,
          runId: snapshot.runId,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.run.started",
          title: `Workflow started: ${workflow.name}`,
          body: workflow.description,
          payload: { args: input.args ?? null, sourceHash: workflow.sourceHash },
          createdAt: startedAt as any,
        });
        const fiber = yield* executeRun(snapshot, workflow.source).pipe(
          Effect.forkIn(runtimeScope),
        );
        yield* Ref.update(runFibers, (current) => {
          const next = new Map(current);
          next.set(snapshot.runId, fiber);
          return next;
        });
        return { run: snapshot };
      });

    const stop: WorkflowServiceShape["stop"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* getRunSnapshot(input.runId);
        if (terminalRunStatus(snapshot.status)) {
          return;
        }
        const stoppedAt = now();
        const cancelled = yield* updateRun(input.runId, {
          status: "cancelled",
          summary: "Workflow cancelled.",
          completedAt: stoppedAt as any,
          lastUpdatedAt: stoppedAt as any,
        });
        const runtimeProcess = (yield* Ref.get(runProcesses)).get(input.runId);
        if (runtimeProcess) {
          yield* terminateRuntimeProcess(runtimeProcess).pipe(Effect.ignore);
        }
        const fiber = (yield* Ref.get(runFibers)).get(input.runId);
        if (fiber) {
          yield* Fiber.interrupt(fiber).pipe(Effect.ignore);
        }
        for (const agent of snapshot.agents) {
          if (
            agent.threadId === null ||
            (agent.status !== "running" && agent.status !== "waiting")
          ) {
            continue;
          }
          yield* dispatchOrFail({
            type: "thread.session.stop",
            commandId: CommandId.make(`workflow-agent:stop:${makeId()}`),
            threadId: agent.threadId,
            createdAt: stoppedAt as any,
          }).pipe(Effect.ignoreCause({ log: true }));
          yield* repo
            .upsertAgent({
              ...agent,
              status: "stopped",
              updatedAt: stoppedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
        }
        for (const step of snapshot.steps) {
          if (step.status !== "running" && step.status !== "pending") {
            continue;
          }
          yield* repo
            .upsertStep({
              ...step,
              status: "skipped",
              error: "Workflow cancelled.",
              completedAt: stoppedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          yield* appendEvent({
            workflowId: snapshot.workflowId,
            runId: snapshot.runId,
            stepId: step.stepId,
            agentId: null,
            taskId: null,
            kind: "workflow.step.skipped",
            title: `Step ${step.stepKey} skipped`,
            body: "Workflow cancelled.",
            payload: {},
            createdAt: stoppedAt as any,
          }).pipe(Effect.ignoreCause({ log: true }));
        }
        for (const request of snapshot.inputRequests) {
          if (request.status !== "pending") {
            continue;
          }
          yield* repo
            .upsertInputRequest({
              ...request,
              status: "cancelled",
              resolvedAt: stoppedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          const deferred = (yield* Ref.get(pendingInput)).get(request.requestId);
          if (deferred) {
            yield* Deferred.succeed(deferred, undefined).pipe(Effect.ignore);
          }
          yield* Ref.update(pendingInput, (current) => {
            const next = new Map(current);
            next.delete(request.requestId);
            return next;
          });
          yield* appendEvent({
            workflowId: snapshot.workflowId,
            runId: snapshot.runId,
            stepId: null,
            agentId: null,
            taskId: null,
            kind: "workflow.input.cancelled",
            title: `Input cancelled: ${request.title}`,
            body: null,
            payload: { requestId: request.requestId },
            createdAt: stoppedAt as any,
          }).pipe(Effect.ignoreCause({ log: true }));
        }
        yield* appendEvent({
          workflowId: cancelled.workflowId,
          runId: cancelled.runId,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.run.cancelled",
          title: "Workflow cancelled",
          body: null,
          payload: {},
          createdAt: stoppedAt as any,
        });
        yield* getRunSnapshot(input.runId).pipe(Effect.flatMap(publishRun), Effect.ignore);
      });

    const respondToInput: WorkflowServiceShape["respondToInput"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* getRunSnapshot(input.runId);
        if (terminalRunStatus(snapshot.status)) {
          return yield* Effect.fail(workflowError("Cannot respond to a terminal workflow run."));
        }
        const request = snapshot.inputRequests.find(
          (entry) => entry.requestId === input.requestId && entry.status === "pending",
        );
        if (!request) {
          return yield* Effect.fail(workflowNotFound({ runId: input.runId }));
        }
        const resolvedAt = now();
        yield* repo
          .upsertInputRequest({
            ...request,
            status: "resolved",
            response: input.response,
            resolvedAt: resolvedAt as any,
          })
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: snapshot.workflowId,
          runId: input.runId,
          stepId: null,
          agentId: null,
          taskId: null,
          kind: "workflow.input.resolved",
          title: `Input resolved: ${request.title}`,
          body: null,
          payload: { requestId: input.requestId, response: input.response },
          createdAt: resolvedAt as any,
        });
        const remainingPendingInputCount = snapshot.inputRequests.filter(
          (entry) => entry.status === "pending" && entry.requestId !== input.requestId,
        ).length;
        const resumed = yield* updateRun(input.runId, {
          status: remainingPendingInputCount === 0 ? "running" : "paused",
          lastUpdatedAt: resolvedAt as any,
        });
        if (remainingPendingInputCount === 0) {
          yield* appendEvent({
            workflowId: resumed.workflowId,
            runId: resumed.runId,
            stepId: null,
            agentId: null,
            taskId: null,
            kind: "workflow.run.resumed",
            title: "Workflow resumed",
            body: null,
            payload: {},
            createdAt: resolvedAt as any,
          });
        }
        const deferred = (yield* Ref.get(pendingInput)).get(input.requestId);
        if (deferred) {
          yield* Deferred.succeed(deferred, input.response);
          yield* Ref.update(pendingInput, (current) => {
            const next = new Map(current);
            next.delete(input.requestId);
            return next;
          });
        }
      });

    const getRun: WorkflowServiceShape["getRun"] = (input) => getRunSnapshot(input.runId);

    const getTimeline: WorkflowServiceShape["getTimeline"] = (input) =>
      Effect.gen(function* () {
        yield* getRunSnapshot(input.runId);
        const events = yield* repo
          .listEventsForRun(input.runId)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        return { runId: input.runId, events };
      });

    const resolveCollaborationContext = (
      context: Parameters<WorkflowServiceShape["collaborationAddNote"]>[0]["context"],
    ) =>
      Effect.gen(function* () {
        const run = yield* getRunSnapshot(context.workflowRunId);
        if (run.projectId !== context.projectId) {
          return yield* Effect.fail(
            workflowError("Workflow collaboration context project mismatch."),
          );
        }
        const agent = run.agents.find(
          (candidate) =>
            candidate.name === context.agentName && candidate.threadId === context.agentThreadId,
        );
        if (!agent) {
          return yield* Effect.fail(
            workflowError("Workflow collaboration context does not match a run agent."),
          );
        }
        return { run, agent };
      });

    const collaborationStatePatch: WorkflowServiceShape["collaborationStatePatch"] = (input) =>
      Effect.gen(function* () {
        const { run, agent } = yield* resolveCollaborationContext(input.context);
        const updatedAt = now();
        for (const [key, value] of Object.entries(input.patch)) {
          const entry: WorkflowStateEntry = {
            runId: run.runId,
            scope: input.scope as any,
            key: key as any,
            value,
            updatedAt: updatedAt as any,
          };
          yield* repo
            .upsertState(entry)
            .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        }
        yield* appendEvent({
          workflowId: run.workflowId,
          runId: run.runId,
          stepId: null,
          agentId: agent.agentId,
          taskId: null,
          kind: "workflow.state.updated",
          title: `${agent.name} updated ${input.scope} state`,
          body: null,
          payload: { scope: input.scope, keys: Object.keys(input.patch) },
          createdAt: updatedAt as any,
        });
        const snapshot = yield* getRunSnapshot(run.runId);
        yield* publishRun(snapshot);
        return snapshot;
      });

    const collaborationAddNote: WorkflowServiceShape["collaborationAddNote"] = (input) =>
      Effect.gen(function* () {
        const { run, agent } = yield* resolveCollaborationContext(input.context);
        const createdAt = now();
        yield* appendEvent({
          workflowId: run.workflowId,
          runId: run.runId,
          stepId: null,
          agentId: agent.agentId,
          taskId: null,
          kind: "workflow.note.added",
          title: input.title ?? `Note from ${agent.name}`,
          body: input.body,
          payload: { agentName: agent.name },
          createdAt: createdAt as any,
        });
        return { noted: true as const };
      });

    const collaborationProposeTask: WorkflowServiceShape["collaborationProposeTask"] = (input) =>
      Effect.gen(function* () {
        const { run, agent } = yield* resolveCollaborationContext(input.context);
        const createdAt = now();
        const task: WorkflowTaskSnapshot = {
          taskId: WorkflowTaskId.make(`${run.runId}:${makeId()}`),
          runId: run.runId,
          title: input.title as any,
          reason: input.reason ?? null,
          kind: input.kind,
          assignee: (input.assignee ?? null) as any,
          prompt: input.prompt,
          status: "proposed",
          createdByAgentId: agent.agentId,
          result: null,
          error: null,
          createdAt: createdAt as any,
          updatedAt: createdAt as any,
        };
        yield* repo
          .upsertTask(task)
          .pipe(Effect.mapError((error) => workflowError(error.message, error)));
        yield* appendEvent({
          workflowId: run.workflowId,
          runId: run.runId,
          stepId: null,
          agentId: agent.agentId,
          taskId: task.taskId,
          kind: "workflow.task.proposed",
          title: `Task proposed: ${task.title}`,
          body: task.reason,
          payload: { kind: task.kind, assignee: task.assignee, prompt: task.prompt },
          createdAt: createdAt as any,
        });
        const snapshot = yield* getRunSnapshot(run.runId);
        yield* publishRun(snapshot);
        return snapshot;
      });

    const collaborationMessageAgent: WorkflowServiceShape["collaborationMessageAgent"] = (input) =>
      Effect.gen(function* () {
        const { run, agent } = yield* resolveCollaborationContext(input.context);
        const snapshot = yield* getRunSnapshot(run.runId);
        const target = snapshot.agents.find((candidate) => candidate.name === input.to);
        if (!target?.threadId) {
          return yield* Effect.fail(
            workflowError(`Workflow agent '${input.to}' is not available.`),
          );
        }
        const createdAt = now();
        const message = `[Workflow message from ${agent.name}]\n\n${input.message}`;
        yield* dispatchOrFail({
          type: "thread.turn.start",
          commandId: CommandId.make(`workflow-agent:message:${makeId()}`),
          threadId: target.threadId,
          message: {
            messageId: MessageId.make(makeId()),
            role: "user",
            text: message,
            attachments: [],
          },
          modelSelection: target.modelSelection,
          runtimeMode: target.runtimeMode ?? "full-access",
          interactionMode: "default",
          mcpServerIds: withoutWorkflowManagementMcp(target.mcpServerIds) as any,
          createdAt: createdAt as any,
        });
        yield* appendEvent({
          workflowId: run.workflowId,
          runId: run.runId,
          stepId: null,
          agentId: agent.agentId,
          taskId: null,
          kind: "workflow.agent.message.sent",
          title: `${agent.name} messaged ${target.name}`,
          body: input.message,
          payload: { from: agent.name, to: target.name, threadId: target.threadId },
          createdAt: createdAt as any,
        });
        return { sent: true as const, threadId: target.threadId };
      });

    return {
      createDraft,
      listThread,
      openSource,
      syncSource,
      validate,
      archive,
      run,
      stop,
      respondToInput,
      getRun,
      getTimeline,
      collaborationStatePatch,
      collaborationAddNote,
      collaborationProposeTask,
      collaborationMessageAgent,
      get streamEvents() {
        return Stream.fromPubSub(eventPubSub);
      },
    } satisfies WorkflowServiceShape;
  }),
);
