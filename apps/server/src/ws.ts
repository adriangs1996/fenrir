import { Cause, Effect, Layer, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthAccessStreamEvent,
  AuthSessionId,
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  ManagedProcessRpcError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  GlobalActionsRpcError,
  SkillRpcError,
  ThreadId,
  type TerminalEvent,
  type RawTcpEvent,
  WS_METHODS,
  WsRpcGroup,
  TmuxError,
  type ServerProviderSkill,
  type ManagedProcessLogServerMessage,
} from "@fenrir/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { GlobalActionsService } from "./globalActions";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { SourceControlQuery } from "./sourceControl/Services/SourceControlQuery";
import { SourceControl } from "./sourceControl/Services/SourceControl";
import { SourceControlStatus } from "./sourceControl/Services/SourceControlStatus";
import { SourceControlWorkflows } from "./sourceControl/Services/SourceControlWorkflows";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { ServerAuth } from "./auth/Services/ServerAuth";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService";
import { respondToAuthError } from "./auth/http";
import { ImportResolver } from "./managedProcess/Services/ImportResolver";
import { ManagedProcessManager } from "./managedProcess/Services/Manager";
import { TmuxSessionManager } from "./terminal/Services/TmuxSessionManager";
import { RawTcpListenerService } from "./raw-tcp/Services/RawTcpListenerService";
import { TrafficLensService } from "./traffic-lens/Services/TrafficLensService";
import { PlanRunnerService } from "./plan-runner/Services/PlanRunner";
import type { TrafficLensEvent } from "@fenrir/contracts";
import { resolveManagedProcessCwd } from "@fenrir/shared/projectScripts";
import { SkillService } from "./skill/SkillService";

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (currentSessionId: AuthSessionId) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const sourceControlQuery = yield* SourceControlQuery;
      const sourceControlStatus = yield* SourceControlStatus;
      const sourceControlWorkflows = yield* SourceControlWorkflows;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const globalActions = yield* GlobalActionsService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const sourceControl = yield* SourceControl;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const tmuxSessionManager = yield* TmuxSessionManager;
      const rawTcpListenerService = yield* RawTcpListenerService;
      const trafficLensService = yield* TrafficLensService;
      const planRunnerService = yield* PlanRunnerService;
      const skillService = yield* SkillService;
      const managedProcessManager = yield* ManagedProcessManager;
      const importResolver = yield* ImportResolver;
      const activeTmuxProcesses = new Map<string, { pid: number }>();

      const serverCommandId = (tag: string) =>
        CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

      const toManagedProcessRpcError = (err: unknown): ManagedProcessRpcError => {
        if (Schema.is(ManagedProcessRpcError)(err)) return err;
        return new ManagedProcessRpcError({
          code: "io-error",
          message: err instanceof Error ? err.message : "Managed process operation failed",
        });
      };

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return sourceControl.resolveRepositoryIdentity(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                (yield* orchestrationEngine.getReadModel()).projects.find(
                  (project) => project.id === event.payload.projectId,
                )?.workspaceRoot ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity =
                yield* sourceControl.resolveRepositoryIdentity(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            });
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail:
                      error instanceof Error
                        ? error.message
                        : "Unknown setup activity dispatch failure.",
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* sourceControlWorkflows.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const globalActionsList = yield* globalActions.getAll.pipe(
          Effect.orElseSucceed(() => [] as const),
        );
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
          globalActions: globalActionsList,
          skills: yield* skillService.getAll.pipe(
            Effect.orElseSucceed(() => [] as readonly ServerProviderSkill[]),
          ),
        };
      });

      const refreshGitStatus = (cwd: string) =>
        sourceControlStatus
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [WS_METHODS.terminalDetachTmux]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalDetachTmux,
            Effect.gen(function* () {
              // Clear active process ref BEFORE detach so the stale guard
              // suppresses the exit event from the killed process.
              activeTmuxProcesses.delete(input.projectId);
              yield* tmuxSessionManager.detachSession(input.projectId);
            }).pipe(
              Effect.mapError(
                (err) =>
                  new TmuxError({
                    message: err.message ?? "Tmux detach failed",
                  }),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),

        [WS_METHODS.terminalWriteTmux]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalWriteTmux,
            tmuxSessionManager.writeToSession(input.projectId, input.data).pipe(
              Effect.mapError(
                (err) =>
                  new TmuxError({
                    message: err.message ?? "Tmux write failed",
                  }),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),

        [WS_METHODS.terminalResizeTmux]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalResizeTmux,
            tmuxSessionManager.resizeSession(input.projectId, input.cols, input.rows).pipe(
              Effect.mapError(
                (err) =>
                  new TmuxError({
                    message: err.message ?? "Tmux resize failed",
                  }),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),

        [WS_METHODS.terminalAttachTmux]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalAttachTmux,
            Effect.gen(function* () {
              const services = yield* Effect.services<never>();
              const runFork = Effect.runForkWith(services);

              const exists = yield* tmuxSessionManager.hasSession(input.projectId);
              if (!exists) {
                yield* tmuxSessionManager.createSession(input.projectId, input.cwd);
              }

              const ptyProcess = yield* tmuxSessionManager.attachSession(
                input.projectId,
                input.cols,
                input.rows,
              );

              // Track active process so stale handlers become no-ops
              const processRef = { pid: ptyProcess.pid };
              activeTmuxProcesses.set(input.projectId, processRef);

              // Wire the PTY output to the Terminal Manager event bus
              ptyProcess.onData((data) => {
                if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
                runFork(terminalManager.publishTmuxOutput(input.projectId, data));
              });

              ptyProcess.onExit((event) => {
                if (activeTmuxProcesses.get(input.projectId) !== processRef) return;
                activeTmuxProcesses.delete(input.projectId);
                runFork(
                  terminalManager.publishTmuxExit(
                    input.projectId,
                    event.exitCode,
                    event.signal ?? null,
                  ),
                );
              });

              return {
                projectId: input.projectId,
                sessionName: tmuxSessionManager.sessionName(input.projectId),
                pid: ptyProcess.pid,
              };
            }).pipe(
              Effect.mapError(
                (err) =>
                  new TmuxError({
                    message: err.message ?? "Tmux operation failed",
                  }),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),

        [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getSnapshot,
            projectionSnapshotQuery.getSnapshot().pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load orchestration snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine.readEvents(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
              ),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeOrchestrationDomainEvents,
            Effect.gen(function* () {
              const snapshot = yield* orchestrationEngine.getReadModel();
              const fromSequenceExclusive = snapshot.snapshotSequence;
              const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
                orchestrationEngine.readEvents(fromSequenceExclusive),
              ).pipe(
                Effect.map((events) => Array.from(events)),
                Effect.flatMap(enrichOrchestrationEvents),
                Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
              );
              const replayStream = Stream.fromIterable(replayEvents);
              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.mapEffect(enrichProjectEvent),
              );
              const source = Stream.merge(replayStream, liveStream);
              type SequenceState = {
                readonly nextSequence: number;
                readonly pendingBySequence: Map<number, OrchestrationEvent>;
              };
              const state = yield* Ref.make<SequenceState>({
                nextSequence: fromSequenceExclusive + 1,
                pendingBySequence: new Map<number, OrchestrationEvent>(),
              });

              return source.pipe(
                Stream.mapEffect((event) =>
                  Ref.modify(
                    state,
                    ({
                      nextSequence,
                      pendingBySequence,
                    }): [Array<OrchestrationEvent>, SequenceState] => {
                      if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                        return [[], { nextSequence, pendingBySequence }];
                      }

                      const updatedPending = new Map(pendingBySequence);
                      updatedPending.set(event.sequence, event);

                      const emit: Array<OrchestrationEvent> = [];
                      let expected = nextSequence;
                      for (;;) {
                        const expectedEvent = updatedPending.get(expected);
                        if (!expectedEvent) {
                          break;
                        }
                        emit.push(expectedEvent);
                        updatedPending.delete(expected);
                        expected += 1;
                      }

                      return [
                        emit,
                        {
                          nextSequence: expected,
                          pendingBySequence: updatedPending,
                        },
                      ];
                    },
                  ),
                ),
                Stream.flatMap((events) => Stream.fromIterable(events)),
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetGlobalActions]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetGlobalActions,
            globalActions.getAll.pipe(
              Effect.mapError(
                (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverCreateGlobalAction]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverCreateGlobalAction,
            globalActions
              .create(input)
              .pipe(
                Effect.mapError(
                  (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
                ),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpdateGlobalAction]: ({ id, ...input }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateGlobalAction,
            globalActions
              .update(id, input)
              .pipe(
                Effect.mapError(
                  (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
                ),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverDeleteGlobalAction]: ({ id }) =>
          observeRpcEffect(
            WS_METHODS.serverDeleteGlobalAction,
            globalActions
              .delete(id)
              .pipe(
                Effect.mapError(
                  (e) => new GlobalActionsRpcError({ message: e.message, cause: e.cause }),
                ),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    message: `Failed to search workspace entries: ${cause.detail}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : "Failed to write workspace file";
                return new ProjectWriteFileError({
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(WS_METHODS.subscribeGitStatus, sourceControlStatus.streamStatus(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            sourceControlStatus.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            sourceControlWorkflows.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              sourceControlWorkflows
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () =>
                      refreshGitStatus(input.cwd).pipe(
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            sourceControlWorkflows.resolvePullRequest(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            sourceControlWorkflows
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(WS_METHODS.gitListBranches, sourceControlQuery.listBranches(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            sourceControlWorkflows
              .createWorktree(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            sourceControlWorkflows
              .removeWorktree(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            sourceControlWorkflows
              .createBranch(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            Effect.scoped(sourceControlWorkflows.checkoutBranch(input)).pipe(
              Effect.tap(() => refreshGitStatus(input.cwd)),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            sourceControlWorkflows
              .initRepo(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );
              const globalActionsUpdates = globalActions.streamChanges.pipe(
                Stream.map((globalActionsList) => ({
                  version: 1 as const,
                  type: "globalActionsUpdated" as const,
                  payload: { globalActions: globalActionsList },
                })),
              );
              const skillsUpdates = skillService.streamChanges.pipe(
                Stream.map((skillsList) => ({
                  version: 1 as const,
                  type: "skillsUpdated" as const,
                  payload: { skills: skillsList },
                })),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                Stream.merge(
                  keybindingsUpdates,
                  Stream.merge(
                    providerStatuses,
                    Stream.merge(
                      settingsUpdates,
                      Stream.merge(globalActionsUpdates, skillsUpdates),
                    ),
                  ),
                ),
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                BootstrapCredentialChange | SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),

        // ─── Raw TCP Listener RPCs ─────────────────────────────────────

        [WS_METHODS.rawTcpCreateListener]: (input) =>
          observeRpcEffect(
            WS_METHODS.rawTcpCreateListener,
            rawTcpListenerService.createListener(input),
            { "rpc.aggregate": "rawTcp" },
          ),

        [WS_METHODS.rawTcpStopListener]: (input) =>
          observeRpcEffect(
            WS_METHODS.rawTcpStopListener,
            rawTcpListenerService.stopListener(input.listenerId),
            { "rpc.aggregate": "rawTcp" },
          ),

        [WS_METHODS.rawTcpListListeners]: (_input) =>
          observeRpcEffect(WS_METHODS.rawTcpListListeners, rawTcpListenerService.listListeners(), {
            "rpc.aggregate": "rawTcp",
          }),

        [WS_METHODS.rawTcpListSessions]: (_input) =>
          observeRpcEffect(WS_METHODS.rawTcpListSessions, rawTcpListenerService.listSessions(), {
            "rpc.aggregate": "rawTcp",
          }),

        [WS_METHODS.rawTcpSessionWrite]: (input) =>
          observeRpcEffect(
            WS_METHODS.rawTcpSessionWrite,
            rawTcpListenerService.sessionWrite(input.sessionId, input.data),
            { "rpc.aggregate": "rawTcp" },
          ),

        [WS_METHODS.rawTcpSessionUpgradePty]: (input) =>
          observeRpcEffect(
            WS_METHODS.rawTcpSessionUpgradePty,
            rawTcpListenerService.sessionUpgradePty(input),
            { "rpc.aggregate": "rawTcp" },
          ),

        [WS_METHODS.rawTcpSessionClose]: (input) =>
          observeRpcEffect(
            WS_METHODS.rawTcpSessionClose,
            rawTcpListenerService.sessionClose(input.sessionId),
            { "rpc.aggregate": "rawTcp" },
          ),

        [WS_METHODS.subscribeRawTcpEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeRawTcpEvents,
            Stream.callback<RawTcpEvent>((queue) =>
              Effect.acquireRelease(
                rawTcpListenerService.subscribe((event) => {
                  Queue.offerUnsafe(queue, event);
                }),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "rawTcp" },
          ),

        // ─── Traffic Lens RPCs ─────────────────────────────────────────

        [WS_METHODS.trafficLensGetTraffic]: (input) =>
          observeRpcEffect(
            WS_METHODS.trafficLensGetTraffic,
            trafficLensService.queryTraffic(input),
            { "rpc.aggregate": "trafficLens" },
          ),

        [WS_METHODS.trafficLensGetTrafficDetail]: (input) =>
          observeRpcEffect(
            WS_METHODS.trafficLensGetTrafficDetail,
            trafficLensService.getTrafficDetail(input.id),
            { "rpc.aggregate": "trafficLens" },
          ),

        [WS_METHODS.trafficLensClearTraffic]: (input) =>
          observeRpcEffect(
            WS_METHODS.trafficLensClearTraffic,
            trafficLensService.clearTraffic(input.tabId),
            { "rpc.aggregate": "trafficLens" },
          ),

        [WS_METHODS.trafficLensReplayRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.trafficLensReplayRequest,
            trafficLensService.replayRequest(input),
            { "rpc.aggregate": "trafficLens" },
          ),

        [WS_METHODS.subscribeTrafficLensEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTrafficLensEvents,
            Stream.callback<TrafficLensEvent>((queue) =>
              Effect.acquireRelease(
                trafficLensService.subscribe((event) => {
                  Queue.offerUnsafe(queue, event);
                }),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "trafficLens" },
          ),

        // ─── Plan Runner RPCs ─────────────────────────────────────────

        [WS_METHODS.planRunnerStart]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerStart, planRunnerService.start(input), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerRerunFromFailure]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerRerunFromFailure,
            planRunnerService.rerunFromFailure(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerGetStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerGetStatus,
            planRunnerService.getStatus(input.runId),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerCancel]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerCancel, planRunnerService.cancel(input.runId), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerStop]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerStop, planRunnerService.stop(input.runId), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerResume]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerResume, planRunnerService.resume(input.runId), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.subscribePlanRunnerEvents]: (_input) =>
          observeRpcStream(WS_METHODS.subscribePlanRunnerEvents, planRunnerService.streamEvents, {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerListFeatures]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerListFeatures,
            planRunnerService.listFeatures(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerGetFeaturePlans]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerGetFeaturePlans,
            planRunnerService.getFeaturePlans(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerGetFeatureRun]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerGetFeatureRun,
            planRunnerService.getFeatureRun(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerListRuns]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerListRuns, planRunnerService.listRuns(input), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerGetStepLog]: (input) =>
          observeRpcEffect(WS_METHODS.planRunnerGetStepLog, planRunnerService.getStepLog(input), {
            "rpc.aggregate": "planRunner",
          }),

        [WS_METHODS.planRunnerArchiveFeature]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerArchiveFeature,
            planRunnerService.archiveFeature(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerUnarchiveFeature]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerUnarchiveFeature,
            planRunnerService.unarchiveFeature(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerListArchivedFeatures]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerListArchivedFeatures,
            planRunnerService.listArchivedFeatures(input),
            { "rpc.aggregate": "planRunner" },
          ),

        [WS_METHODS.planRunnerRenameFeature]: (input) =>
          observeRpcEffect(
            WS_METHODS.planRunnerRenameFeature,
            planRunnerService.renameFeature(input),
            { "rpc.aggregate": "planRunner" },
          ),
        // ─── Managed Process RPCs ────────────────────────────────────────

        [WS_METHODS.managedProcessList]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessList,
            managedProcessManager
              .list(input.projectId)
              .pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessStart]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessStart,
            managedProcessManager.start(input).pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessStop]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessStop,
            managedProcessManager
              .stop(input.instanceId)
              .pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessForceKill]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessForceKill,
            managedProcessManager
              .forceKill(input.instanceId)
              .pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessRestart]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessRestart,
            managedProcessManager
              .restart(input.instanceId)
              .pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessWriteStdin]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessWriteStdin,
            managedProcessManager.writeStdin(input).pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessUpsertDefinition]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessUpsertDefinition,
            Effect.gen(function* () {
              // Server-side validation of the definition before dispatching
              const project = (yield* orchestrationEngine.getReadModel()).projects.find(
                (p) => p.id === input.projectId,
              );
              if (!project) {
                return yield* new ManagedProcessRpcError({
                  code: "not-found",
                  message: `Project '${input.projectId}' does not exist.`,
                });
              }

              // Validate cwd resolves cleanly against the scope root
              const scopeRoot = project.workspaceRoot;
              const cwdResult = resolveManagedProcessCwd({
                scopeRoot,
                cwd: input.definition.cwd,
              });
              if (!cwdResult.ok) {
                return yield* new ManagedProcessRpcError({
                  code: "invalid-state",
                  message: `Invalid cwd: ${cwdResult.reason}`,
                });
              }

              // Validate readiness log-pattern regex compiles
              if (input.definition.readiness.kind === "log-pattern") {
                try {
                  new RegExp(input.definition.readiness.pattern);
                } catch {
                  return yield* new ManagedProcessRpcError({
                    code: "invalid-state",
                    message: `Invalid readiness log-pattern regex: "${input.definition.readiness.pattern}"`,
                  });
                }
              }

              yield* orchestrationEngine.dispatch({
                type: "project.managedProcess.upsert",
                commandId: serverCommandId("managed-process-upsert"),
                projectId: input.projectId,
                definition: input.definition,
              });
            }).pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessDeleteDefinition]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessDeleteDefinition,
            orchestrationEngine
              .dispatch({
                type: "project.managedProcess.delete",
                commandId: serverCommandId("managed-process-delete"),
                projectId: input.projectId,
                processDefId: input.processDefId,
              })
              .pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessProposedImports]: (input) =>
          observeRpcEffect(
            WS_METHODS.managedProcessProposedImports,
            Effect.gen(function* () {
              const readModel = yield* orchestrationEngine.getReadModel();
              const project = readModel.projects.find((p) => p.id === input.projectId);
              if (!project) {
                return yield* new ManagedProcessRpcError({
                  code: "not-found",
                  message: `Project '${input.projectId}' does not exist.`,
                });
              }
              return yield* importResolver.propose({
                projectId: input.projectId,
                workspaceRoot: project.workspaceRoot,
                existingDefinitions: [...(project.managedProcesses ?? [])],
              });
            }).pipe(Effect.mapError(toManagedProcessRpcError)),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.managedProcessSubscribeLog]: (input) =>
          observeRpcStreamEffect(
            WS_METHODS.managedProcessSubscribeLog,
            managedProcessManager.subscribeLog(input.instanceId).pipe(
              Effect.map(({ backfill, stream }) => {
                const backfillMsg: ManagedProcessLogServerMessage = {
                  type: "backfill",
                  instanceId: input.instanceId,
                  bytes: backfill.bytes,
                  ringBufferBytes: backfill.ringBufferBytes,
                  truncated: backfill.truncated,
                  sequenceNumber: backfill.sequenceNumber,
                };
                const liveStream = stream.pipe(
                  Stream.map(
                    (chunk): ManagedProcessLogServerMessage => ({
                      type: "chunk",
                      instanceId: input.instanceId,
                      bytes: chunk.bytes,
                      sequenceNumber: chunk.sequenceNumber,
                    }),
                  ),
                );
                return Stream.concat(Stream.make(backfillMsg), liveStream);
              }),
              Effect.mapError(toManagedProcessRpcError),
            ),
            { "rpc.aggregate": "managedProcess" },
          ),

        [WS_METHODS.serverListSkills]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverListSkills,
            skillService.getAll.pipe(
              Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSkillDetails]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSkillDetails,
            skillService
              .getDetails(input.name)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverCreateSkill]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverCreateSkill,
            skillService
              .create(input)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpdateSkill]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSkill,
            skillService
              .update(input)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverDeleteSkill]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverDeleteSkill,
            skillService
              .delete(input.name)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverResolveSkillConflict]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverResolveSkillConflict,
            skillService
              .resolveConflict(input)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverSetActiveSkillProject]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverSetActiveSkillProject,
            skillService
              .setActiveProjectRoot(input.cwd)
              .pipe(
                Effect.mapError((e) => new SkillRpcError({ message: e.message, cause: e.cause })),
              ),
            { "rpc.aggregate": "server" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
