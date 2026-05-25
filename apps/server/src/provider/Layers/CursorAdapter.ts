import { randomUUID } from "node:crypto";
import {
  spawn,
  spawnSync,
  type ChildProcess as NodeChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type RuntimeEventRawSource,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ToolLifecycleItemType,
} from "@fenrir/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { resolveCursorInstanceSettings } from "../providerSettings.ts";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter.ts";

const PROVIDER = ProviderDriverKind.makeUnsafe("cursor");
const RESUME_WAIT_TIMEOUT_MS = 2_000;

interface CursorResumeState {
  readonly sessionId: string;
}

interface CursorToolState {
  readonly itemId: string;
  readonly title: string;
  readonly itemType: ToolLifecycleItemType;
}

interface CursorTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface CursorActiveRun {
  readonly turnId: TurnId;
  readonly child: ChildProcessWithoutNullStreams;
  readonly assistantItemId: string;
  readonly toolStates: Map<string, CursorToolState>;
  readonly sessionIdPromise: Promise<string | undefined>;
  readonly resolveSessionId: (value: string | undefined) => void;
  readonly stdoutBuffer: { value: string };
  readonly stderrBuffer: { value: string };
  assistantText: string;
  interrupted: boolean;
  completed: boolean;
  assistantCompleted: boolean;
}

interface CursorSessionContext {
  session: ProviderSession;
  readonly turns: Array<CursorTurnSnapshot>;
  activeRun?: CursorActiveRun;
  stopped: boolean;
}

interface CursorStreamEvent {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly session_id?: unknown;
  readonly request_id?: unknown;
  readonly model?: unknown;
  readonly message?: unknown;
  readonly tool_call?: unknown;
  readonly call_id?: unknown;
  readonly result?: unknown;
  readonly is_error?: unknown;
}

export interface CursorAdapterSpawnInput {
  readonly settings: {
    readonly binaryPath: string;
    readonly apiEndpoint: string;
  };
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly prompt: string;
  readonly model?: string;
  readonly resumeState?: CursorResumeState;
}

export interface CursorAdapterSpawnPlan {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
}

export interface CursorAdapterLiveOptions {
  readonly provider?: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly rawSource?: RuntimeEventRawSource;
  readonly environment?: NodeJS.ProcessEnv;
  readonly readyReason?: string;
  readonly spawn?: (input: CursorAdapterSpawnInput) => CursorAdapterSpawnPlan;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseCursorResumeState(resumeCursor: unknown): CursorResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const sessionId =
    "sessionId" in resumeCursor && typeof resumeCursor.sessionId === "string"
      ? resumeCursor.sessionId.trim()
      : "";
  return sessionId.length > 0 ? { sessionId } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function makeDeferredValue<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolved = false;
  let resolver: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = (value: T) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
    };
  });
  return {
    promise,
    resolve: (value) => resolver?.(value),
  };
}

function killChildTree(child: NodeChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fall back to direct child kill
    }
  }
  child.kill(signal);
}

function buildEventBase(input: {
  readonly provider?: ProviderDriverKind;
  readonly rawSource?: RuntimeEventRawSource;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly itemId?: string;
  readonly requestId?: string;
  readonly raw?: unknown;
}): Pick<
  ProviderRuntimeEvent,
  "eventId" | "provider" | "threadId" | "createdAt" | "turnId" | "itemId" | "requestId" | "raw"
> {
  return {
    eventId: EventId.makeUnsafe(randomUUID()),
    provider: input.provider ?? PROVIDER,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: RuntimeItemId.makeUnsafe(input.itemId) } : {}),
    ...(input.requestId ? { requestId: RuntimeRequestId.makeUnsafe(input.requestId) } : {}),
    ...(input.raw !== undefined
      ? {
          raw: {
            source: input.rawSource ?? "cursor.agent.stream-json",
            payload: input.raw,
          },
        }
      : {}),
  };
}

function sessionIdFromStreamEvent(event: CursorStreamEvent): string | undefined {
  return trimString(event.session_id);
}

function requestIdFromStreamEvent(event: CursorStreamEvent): string | undefined {
  return trimString(event.request_id);
}

function readAssistantDelta(event: CursorStreamEvent): string {
  const message = isRecord(event.message) ? event.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((entry) => {
      const item = isRecord(entry) ? entry : undefined;
      return item?.type === "text" ? (trimString(item.text) ?? "") : "";
    })
    .join("");
}

function resolveToolCallEntry(
  event: CursorStreamEvent,
): { readonly key: string; readonly value: Record<string, unknown> } | undefined {
  const toolCall = isRecord(event.tool_call) ? event.tool_call : undefined;
  if (!toolCall) {
    return undefined;
  }
  const [key, value] = Object.entries(toolCall)[0] ?? [];
  return key && isRecord(value) ? { key, value } : undefined;
}

function detailFromToolArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) {
    return undefined;
  }
  const path =
    trimString(args.path) ??
    trimString(args.filePath) ??
    trimString(args.command) ??
    trimString(args.query);
  if (path) {
    return path;
  }
  const commandArgs = Array.isArray(args.args)
    ? args.args.map((entry) => trimString(entry)).filter((entry): entry is string => !!entry)
    : [];
  return commandArgs.length > 0 ? commandArgs.join(" ") : undefined;
}

function mapCursorToolItemType(toolKey: string): ToolLifecycleItemType {
  const normalized = toolKey.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("terminal") ||
    normalized.includes("command")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("replace")
  ) {
    return "file_change";
  }
  if (normalized.includes("web")) {
    return "web_search";
  }
  return "dynamic_tool_call";
}

function titleFromToolKey(toolKey: string): string {
  const normalized = toolKey.toLowerCase();
  if (normalized.includes("read")) return "Read file";
  if (normalized.includes("write")) return "Write file";
  if (normalized.includes("edit")) return "Edit file";
  if (normalized.includes("patch")) return "Apply patch";
  if (normalized.includes("bash") || normalized.includes("terminal")) return "Run command";
  if (normalized.includes("search")) return "Search";
  return "Tool";
}

function resolveTurnSnapshot(turns: Array<CursorTurnSnapshot>, turnId: TurnId): CursorTurnSnapshot {
  const existing = turns.find((turn) => turn.id === turnId);
  if (existing) {
    return existing;
  }
  const created: CursorTurnSnapshot = { id: turnId, items: [] };
  turns.push(created);
  return created;
}

function appendTurnItem(context: CursorSessionContext, turnId: TurnId, item: unknown): void {
  resolveTurnSnapshot(context.turns, turnId).items.push(item);
}

function buildPrompt(input: {
  readonly text: string | undefined;
  readonly imagePaths: ReadonlyArray<string>;
}): string | undefined {
  const text = input.text?.trim();
  if (input.imagePaths.length === 0) {
    return text;
  }

  const attachmentSection = [
    "Attached local images:",
    ...input.imagePaths.map((path) => `- ${path}`),
    "Use those file paths directly if you need to inspect the images.",
  ].join("\n");

  if (text && text.length > 0) {
    return `${text}\n\n${attachmentSection}`;
  }

  return `Inspect the attached local images and help with the request.\n\n${attachmentSection}`;
}

function waitForResumeCursor(
  promise: Promise<string | undefined>,
): Promise<CursorResumeState | undefined> {
  return Promise.race([
    promise.then((sessionId) => (sessionId ? { sessionId } : undefined)),
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), RESUME_WAIT_TIMEOUT_MS);
    }),
  ]);
}

function processExitDetail(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return trimmedStderr;
  }
  if (signal) {
    return `Cursor process exited with signal ${signal}.`;
  }
  return `Cursor process exited with code ${code ?? "null"}.`;
}

function buildDefaultCursorSpawnPlan(input: CursorAdapterSpawnInput): CursorAdapterSpawnPlan {
  return {
    command: input.settings.binaryPath,
    args: [
      ...(input.settings.apiEndpoint.trim().length > 0
        ? ["--endpoint", input.settings.apiEndpoint.trim()]
        : []),
      "--print",
      "--output-format",
      "stream-json",
      ...(input.resumeState ? ["--resume", input.resumeState.sessionId] : []),
      ...(input.model ? ["--model", input.model] : []),
      input.prompt,
    ],
    cwd: input.cwd,
    env: input.environment,
    shell: process.platform === "win32",
  };
}

export function makeCursorAdapter(options?: CursorAdapterLiveOptions) {
  return Effect.gen(function* () {
    const services = yield* Effect.services();
    const runFork = Effect.runForkWith(services);
    const serverConfig = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const runtimeProvider = options?.provider ?? PROVIDER;
    const defaultInstanceId = options?.instanceId ?? ProviderInstanceId.makeUnsafe("cursor");
    const runtimeRawSource = options?.rawSource ?? "cursor.agent.stream-json";
    const runtimeEnvironment = options?.environment ?? process.env;
    const buildSpawnPlan = options?.spawn ?? buildDefaultCursorSpawnPlan;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const eventsPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ProviderRuntimeEvent>(),
      PubSub.shutdown,
    );
    const sessions = new Map<ThreadId, CursorSessionContext>();
    const buildRuntimeEventBase = (input: Omit<Parameters<typeof buildEventBase>[0], "provider">) =>
      buildEventBase({ provider: runtimeProvider, rawSource: runtimeRawSource, ...input });

    const emit = (event: ProviderRuntimeEvent) =>
      Effect.succeed(event).pipe(
        Effect.tap((value) =>
          nativeEventLogger
            ? nativeEventLogger.write(
                {
                  observedAt: nowIso(),
                  event: value,
                },
                value.threadId,
              )
            : Effect.void,
        ),
        Effect.flatMap((value) => PubSub.publish(eventsPubSub, value)),
        Effect.asVoid,
      );

    const loadCursorSettings = (operation: string, providerInstanceId: ProviderInstanceId) =>
      serverSettings.getSettings.pipe(
        Effect.flatMap((value) => resolveCursorInstanceSettings(value, providerInstanceId)),
        Effect.mapError(
          (cause) =>
            new ProviderAdapterValidationError({
              provider: runtimeProvider,
              operation,
              issue:
                cause instanceof Error
                  ? cause.message
                  : "Failed to resolve Cursor provider settings.",
              cause,
            }),
        ),
      );

    const ensureSessionContext = (threadId: ThreadId): CursorSessionContext => {
      const context = sessions.get(threadId);
      if (!context || context.stopped) {
        throw new ProviderAdapterSessionNotFoundError({
          provider: runtimeProvider,
          threadId,
        });
      }
      return context;
    };

    const updateSession = (
      context: CursorSessionContext,
      updates: Partial<ProviderSession>,
    ): ProviderSession => {
      context.session = {
        ...context.session,
        ...updates,
        updatedAt: nowIso(),
      };
      return context.session;
    };

    const completeAssistantItem = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      status: "completed" | "failed",
      detail: string,
    ) => {
      if (run.assistantCompleted || detail.trim().length === 0) {
        return;
      }
      run.assistantCompleted = true;
      runFork(
        emit({
          ...buildRuntimeEventBase({
            threadId: context.session.threadId,
            turnId: run.turnId,
            itemId: run.assistantItemId,
          }),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status,
            title: "Assistant message",
            detail,
          },
        }),
      );
      appendTurnItem(context, run.turnId, {
        kind: "assistant",
        status,
        text: detail,
      });
    };

    const finalizeRun = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      outcome:
        | {
            readonly kind: "completed";
            readonly detail: string;
            readonly requestId?: string;
          }
        | {
            readonly kind: "aborted";
            readonly reason: string;
          }
        | {
            readonly kind: "failed";
            readonly reason: string;
          },
    ) => {
      if (run.completed) {
        return;
      }
      run.completed = true;
      delete context.activeRun;

      if (outcome.kind === "completed") {
        const detail = outcome.detail.trim();
        if (detail.length > 0 && detail !== run.assistantText) {
          const suffix = detail.startsWith(run.assistantText)
            ? detail.slice(run.assistantText.length)
            : detail;
          if (suffix.length > 0) {
            run.assistantText = detail;
            runFork(
              emit({
                ...buildEventBase({
                  threadId: context.session.threadId,
                  turnId: run.turnId,
                  itemId: run.assistantItemId,
                  ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
                }),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta: suffix,
                },
              }),
            );
          }
        }
        completeAssistantItem(context, run, "completed", detail);
        updateSession(context, {
          status: "ready",
          activeTurnId: undefined,
          lastError: undefined,
        });
        runFork(
          emit({
            ...buildRuntimeEventBase({
              threadId: context.session.threadId,
              turnId: run.turnId,
            }),
            type: "turn.completed",
            payload: {
              state: "completed",
              stopReason: null,
            },
          }),
        );
        appendTurnItem(context, run.turnId, {
          kind: "turn.completed",
          state: "completed",
        });
        run.resolveSessionId(parseCursorResumeState(context.session.resumeCursor)?.sessionId);
        return;
      }

      if (run.assistantText.trim().length > 0) {
        completeAssistantItem(
          context,
          run,
          outcome.kind === "failed" ? "failed" : "completed",
          run.assistantText,
        );
      }

      updateSession(context, {
        status: "ready",
        activeTurnId: undefined,
        lastError: outcome.reason,
      });

      if (outcome.kind === "aborted") {
        runFork(
          emit({
            ...buildRuntimeEventBase({
              threadId: context.session.threadId,
              turnId: run.turnId,
            }),
            type: "turn.aborted",
            payload: {
              reason: outcome.reason,
            },
          }),
        );
      } else {
        runFork(
          emit({
            ...buildRuntimeEventBase({
              threadId: context.session.threadId,
              turnId: run.turnId,
            }),
            type: "turn.completed",
            payload: {
              state: "failed",
              stopReason: outcome.reason,
              errorMessage: outcome.reason,
            },
          }),
        );
      }

      appendTurnItem(context, run.turnId, {
        kind: outcome.kind,
        detail: outcome.reason,
      });
      run.resolveSessionId(parseCursorResumeState(context.session.resumeCursor)?.sessionId);
    };

    const handleToolEvent = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      raw: CursorStreamEvent,
    ) => {
      const entry = resolveToolCallEntry(raw);
      const callId = trimString(raw.call_id);
      if (!entry || !callId) {
        return;
      }
      const args = isRecord(entry.value.args) ? entry.value.args : undefined;
      const detail = detailFromToolArgs(args);
      const subtype = trimString(raw.subtype);

      if (subtype === "started") {
        const state: CursorToolState = {
          itemId: callId,
          title: titleFromToolKey(entry.key),
          itemType: mapCursorToolItemType(entry.key),
        };
        run.toolStates.set(callId, state);
        runFork(
          emit({
            ...buildRuntimeEventBase({
              threadId: context.session.threadId,
              turnId: run.turnId,
              itemId: state.itemId,
              raw,
            }),
            type: "item.started",
            payload: {
              itemType: state.itemType,
              title: state.title,
              ...(detail ? { detail } : {}),
            },
          }),
        );
        appendTurnItem(context, run.turnId, {
          kind: "tool.started",
          tool: entry.key,
          detail,
        });
        return;
      }

      if (subtype === "completed") {
        const state = run.toolStates.get(callId) ?? {
          itemId: callId,
          title: titleFromToolKey(entry.key),
          itemType: mapCursorToolItemType(entry.key),
        };
        run.toolStates.delete(callId);
        runFork(
          emit({
            ...buildRuntimeEventBase({
              threadId: context.session.threadId,
              turnId: run.turnId,
              itemId: state.itemId,
              raw,
            }),
            type: "item.completed",
            payload: {
              itemType: state.itemType,
              status: "completed",
              title: state.title,
              ...(detail ? { detail } : {}),
              data: entry.value,
            },
          }),
        );
        appendTurnItem(context, run.turnId, {
          kind: "tool.completed",
          tool: entry.key,
          detail,
        });
      }
    };

    const handleAssistantEvent = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      raw: CursorStreamEvent,
    ) => {
      const delta = readAssistantDelta(raw);
      if (delta.length === 0) {
        return;
      }
      run.assistantText += delta;
      runFork(
        emit({
          ...buildRuntimeEventBase({
            threadId: context.session.threadId,
            turnId: run.turnId,
            itemId: run.assistantItemId,
            raw,
          }),
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta,
          },
        }),
      );
      appendTurnItem(context, run.turnId, {
        kind: "assistant.delta",
        delta,
      });
    };

    const observeSessionId = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      raw: CursorStreamEvent,
    ) => {
      const sessionId = sessionIdFromStreamEvent(raw);
      if (!sessionId) {
        return;
      }
      const currentSessionId = parseCursorResumeState(context.session.resumeCursor)?.sessionId;
      if (currentSessionId !== sessionId) {
        updateSession(context, {
          resumeCursor: { sessionId },
        });
      }
      run.resolveSessionId(sessionId);
    };

    const processStdoutLine = (
      context: CursorSessionContext,
      run: CursorActiveRun,
      line: string,
    ) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }

      let parsed: CursorStreamEvent;
      try {
        parsed = JSON.parse(trimmed) as CursorStreamEvent;
      } catch {
        run.stderrBuffer.value += `${trimmed}\n`;
        return;
      }

      observeSessionId(context, run, parsed);

      const type = trimString(parsed.type);
      if (type === "system") {
        const model = trimString(parsed.model);
        if (model) {
          updateSession(context, { model });
        }
        return;
      }

      if (type === "assistant") {
        handleAssistantEvent(context, run, parsed);
        return;
      }

      if (type === "tool_call") {
        handleToolEvent(context, run, parsed);
        return;
      }

      if (type === "result") {
        const detail = trimString(parsed.result) ?? run.assistantText;
        const requestId = requestIdFromStreamEvent(parsed);
        finalizeRun(
          context,
          run,
          parsed.is_error === true
            ? {
                kind: "failed",
                reason: detail || "Cursor run failed.",
              }
            : {
                kind: "completed",
                detail,
                ...(requestId ? { requestId } : {}),
              },
        );
      }
    };

    const attachCursorProcess = (context: CursorSessionContext, run: CursorActiveRun): void => {
      run.child.stdout.on("data", (chunk: Buffer | string) => {
        run.stdoutBuffer.value += chunk.toString();
        const parts = run.stdoutBuffer.value.split(/\r?\n/u);
        run.stdoutBuffer.value = parts.pop() ?? "";
        for (const line of parts) {
          processStdoutLine(context, run, line);
        }
      });

      run.child.stderr.on("data", (chunk: Buffer | string) => {
        run.stderrBuffer.value += chunk.toString();
      });

      run.child.once("error", (error) => {
        finalizeRun(context, run, {
          kind: run.interrupted ? "aborted" : "failed",
          reason: error instanceof Error ? error.message : "Cursor process failed to start.",
        });
      });

      run.child.once("close", (code, signal) => {
        if (run.stdoutBuffer.value.trim().length > 0) {
          processStdoutLine(context, run, run.stdoutBuffer.value);
          run.stdoutBuffer.value = "";
        }
        if (run.completed) {
          return;
        }
        const detail = processExitDetail(code, signal, run.stderrBuffer.value);
        finalizeRun(context, run, {
          kind: run.interrupted ? "aborted" : "failed",
          reason: run.interrupted ? "Interrupted by user." : detail,
        });
      });
    };

    const startSession: CursorAdapterShape["startSession"] = Effect.fn("startSession")(
      function* (input) {
        if (input.provider !== undefined && input.provider !== runtimeProvider) {
          return yield* new ProviderAdapterValidationError({
            provider: runtimeProvider,
            operation: "startSession",
            issue: `Expected provider '${runtimeProvider}' but received '${input.provider}'.`,
          });
        }

        const providerInstanceId = input.providerInstanceId ?? defaultInstanceId;
        const settings = yield* loadCursorSettings("startSession", providerInstanceId);
        if (!settings.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: runtimeProvider,
            operation: "startSession",
            issue: "Cursor is disabled for this provider instance.",
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) {
          return existing.session;
        }

        const createdAt = nowIso();
        const resumeState = parseCursorResumeState(input.resumeCursor);
        const session: ProviderSession = {
          provider: runtimeProvider,
          providerInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: trimString(input.cwd) ?? process.cwd(),
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          threadId: input.threadId,
          ...(resumeState ? { resumeCursor: resumeState } : {}),
          createdAt,
          updatedAt: createdAt,
        };
        const context: CursorSessionContext = {
          session,
          turns: [],
          stopped: false,
        };
        sessions.set(input.threadId, context);

        yield* emit({
          ...buildRuntimeEventBase({ threadId: input.threadId }),
          type: "session.started",
          payload: {
            message: options?.readyReason ?? "Cursor session started",
            ...(resumeState ? { resume: resumeState } : {}),
          },
        });
        yield* emit({
          ...buildRuntimeEventBase({ threadId: input.threadId }),
          type: "thread.started",
          payload: resumeState ? { providerThreadId: resumeState.sessionId } : {},
        });

        return session;
      },
    );

    const sendTurn: CursorAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = ensureSessionContext(input.threadId);
      if (context.activeRun) {
        return yield* new ProviderAdapterValidationError({
          provider: runtimeProvider,
          operation: "sendTurn",
          issue: "Cursor already has an active turn for this thread.",
        });
      }

      const providerInstanceId =
        context.session.providerInstanceId ?? ProviderInstanceId.makeUnsafe("cursor");
      const settings = yield* loadCursorSettings("sendTurn", providerInstanceId);
      if (!settings.enabled) {
        return yield* new ProviderAdapterValidationError({
          provider: runtimeProvider,
          operation: "sendTurn",
          issue: "Cursor is disabled for this provider instance.",
        });
      }

      const imagePaths = (input.attachments ?? [])
        .map((attachment) =>
          resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          }),
        )
        .filter((value): value is string => typeof value === "string");
      const prompt = buildPrompt({
        text: trimString(input.input),
        imagePaths,
      });
      if (!prompt) {
        return yield* new ProviderAdapterValidationError({
          provider: runtimeProvider,
          operation: "sendTurn",
          issue: "Cursor turns require text input or at least one attachment.",
        });
      }

      const turnId = TurnId.makeUnsafe(`cursor-turn-${randomUUID()}`);
      const selectedModel = input.modelSelection?.model ?? context.session.model;
      const resumeState = parseCursorResumeState(context.session.resumeCursor);
      const sessionCwd = context.session.cwd ?? process.cwd();
      const spawnPlan = buildSpawnPlan({
        settings: {
          binaryPath: settings.binaryPath,
          apiEndpoint: settings.apiEndpoint,
        },
        cwd: sessionCwd,
        environment: runtimeEnvironment,
        prompt,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(resumeState ? { resumeState } : {}),
      });

      const child = yield* Effect.try({
        try: () =>
          spawn(spawnPlan.command, [...spawnPlan.args], {
            cwd: spawnPlan.cwd ?? sessionCwd,
            env: spawnPlan.env ?? runtimeEnvironment,
            stdio: "pipe",
            shell: spawnPlan.shell ?? process.platform === "win32",
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: runtimeProvider,
            threadId: input.threadId,
            detail: cause instanceof Error ? cause.message : "Failed to spawn Cursor process.",
            cause,
          }),
      });

      const deferred = makeDeferredValue<string | undefined>();
      const run: CursorActiveRun = {
        turnId,
        child,
        assistantItemId: `assistant-${randomUUID()}`,
        toolStates: new Map(),
        sessionIdPromise: deferred.promise,
        resolveSessionId: deferred.resolve,
        stdoutBuffer: { value: "" },
        stderrBuffer: { value: "" },
        assistantText: "",
        interrupted: false,
        completed: false,
        assistantCompleted: false,
      };
      context.activeRun = run;
      updateSession(context, {
        status: "running",
        activeTurnId: turnId,
        ...(selectedModel ? { model: selectedModel } : {}),
        lastError: undefined,
      });

      attachCursorProcess(context, run);

      yield* emit({
        ...buildRuntimeEventBase({
          threadId: input.threadId,
          turnId,
        }),
        type: "turn.started",
        payload: selectedModel ? { model: selectedModel } : {},
      });
      appendTurnItem(context, turnId, {
        kind: "turn.started",
        model: selectedModel,
      });

      const updatedResumeState = yield* Effect.promise(() =>
        waitForResumeCursor(run.sessionIdPromise),
      );
      if (updatedResumeState) {
        updateSession(context, {
          resumeCursor: updatedResumeState,
        });
      }

      return {
        threadId: input.threadId,
        turnId,
        ...(parseCursorResumeState(context.session.resumeCursor) !== undefined
          ? { resumeCursor: parseCursorResumeState(context.session.resumeCursor) }
          : {}),
      };
    });

    const interruptTurn: CursorAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId) {
        const context = ensureSessionContext(threadId);
        const run = context.activeRun;
        if (!run) {
          return;
        }
        run.interrupted = true;
        yield* Effect.sync(() => {
          killChildTree(run.child, "SIGTERM");
        });
      },
    );

    const unsupportedRequestError = (method: string) =>
      new ProviderAdapterRequestError({
        provider: runtimeProvider,
        method,
        detail: "Cursor CLI print mode does not expose interactive approval callbacks.",
      });

    const respondToRequest: CursorAdapterShape["respondToRequest"] = (
      _threadId,
      _requestId,
      _decision,
    ) => Effect.fail(unsupportedRequestError("approval.reply"));

    const respondToUserInput: CursorAdapterShape["respondToUserInput"] = (
      _threadId,
      _requestId,
      _answers,
    ) => Effect.fail(unsupportedRequestError("user-input.reply"));

    const stopSession: CursorAdapterShape["stopSession"] = Effect.fn("stopSession")(
      function* (threadId) {
        const context = ensureSessionContext(threadId);
        context.stopped = true;
        const activeRun = context.activeRun;
        if (activeRun) {
          activeRun.interrupted = true;
          yield* Effect.sync(() => {
            killChildTree(activeRun.child, "SIGTERM");
          });
        }
        sessions.delete(threadId);
        yield* emit({
          ...buildRuntimeEventBase({ threadId }),
          type: "session.exited",
          payload: {
            reason: "Session stopped.",
            recoverable: false,
            exitKind: "graceful",
          },
        });
      },
    );

    const listSessions: CursorAdapterShape["listSessions"] = () =>
      Effect.sync(() =>
        [...sessions.values()].filter((entry) => !entry.stopped).map((entry) => entry.session),
      );

    const hasSession: CursorAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return !!context && !context.stopped;
      });

    const readThread: CursorAdapterShape["readThread"] = Effect.fn("readThread")((threadId) =>
      Effect.sync(() => {
        const context = ensureSessionContext(threadId);
        return {
          threadId,
          turns: context.turns,
        };
      }),
    );

    const rollbackThread: CursorAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
      function* (threadId) {
        const context = ensureSessionContext(threadId);
        return yield* new ProviderAdapterValidationError({
          provider: runtimeProvider,
          operation: "rollbackThread",
          issue: `Cursor sessions do not support remote rollback for thread '${threadId}'.`,
          cause: context.turns,
        });
      },
    );

    const stopAll: CursorAdapterShape["stopAll"] = () =>
      Effect.forEach([...sessions.keys()], (threadId) => stopSession(threadId)).pipe(Effect.asVoid);

    return {
      provider: runtimeProvider,
      capabilities: {
        sessionModelSwitch: "restart-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromPubSub(eventsPubSub),
    } satisfies CursorAdapterShape;
  });
}

export const CursorAdapterLive = Layer.effect(CursorAdapter, makeCursorAdapter());

export function makeCursorAdapterLive(options?: CursorAdapterLiveOptions) {
  return Layer.effect(CursorAdapter, makeCursorAdapter(options));
}
