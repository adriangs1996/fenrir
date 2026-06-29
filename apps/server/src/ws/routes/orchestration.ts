import { Cause, Effect, Option, Ref, Stream } from "effect";
import { clamp } from "effect/Number";

import {
  EventId,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  type OrchestrationManagedProcessStreamItem,
  OrchestrationReplayEventsError,
  type OrchestrationShellStreamEvent,
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  WS_METHODS,
} from "@fenrir/contracts";

import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery";
import { ManagedProcessManager } from "../../managedProcess/Services/Manager";
import { normalizeDispatchCommand } from "../../orchestration/Normalizer";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup";
import { SourceControl } from "../../sourceControl/Services/SourceControl";
import { SourceControlWorkflows } from "../../sourceControl/Services/SourceControlWorkflows";
import { TerminalManager } from "../../terminal/Services/Manager";
import { makeControlPlaneDomain } from "../controlPlane";
import {
  makeRpcErrorMapper,
  toBootstrapDispatchCommandCauseError,
  toDispatchCommandError,
} from "../rpcErrors";
import { serverCommandId, type RefreshGitStatus } from "../shared";

const toDispatchCommandRouteError = makeRpcErrorMapper(
  OrchestrationDispatchCommandError,
  (cause) =>
    new OrchestrationDispatchCommandError({
      message: "Failed to dispatch orchestration command",
      cause,
    }),
);

export const makeOrchestrationRoutes = (deps: { readonly refreshGitStatus: RefreshGitStatus }) =>
  Effect.gen(function* () {
    const { refreshGitStatus } = deps;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const sourceControlWorkflows = yield* SourceControlWorkflows;
    const sourceControl = yield* SourceControl;
    const terminalManager = yield* TerminalManager;
    const startup = yield* ServerRuntimeStartup;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
    const managedProcessManager = yield* ManagedProcessManager;

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
          id: EventId.make(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

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

    const toShellStreamEvent = (
      event: OrchestrationEvent,
    ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
      switch (event.type) {
        case "project.created":
        case "project.meta-updated":
          return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
            Effect.map((project) =>
              Option.map(project, (nextProject) => ({
                kind: "project-upserted" as const,
                sequence: event.sequence,
                project: nextProject,
              })),
            ),
            Effect.catch(() => Effect.succeed(Option.none())),
          );
        case "project.deleted":
          return Effect.succeed(
            Option.some({
              kind: "project-removed" as const,
              sequence: event.sequence,
              projectId: event.payload.projectId,
            }),
          );
        case "thread.deleted":
        case "thread.archived":
          return Effect.succeed(
            Option.some({
              kind: "thread-removed" as const,
              sequence: event.sequence,
              threadId: event.payload.threadId,
            }),
          );
        case "thread.unarchived":
          return projectionSnapshotQuery.getThreadShellById(event.payload.threadId).pipe(
            Effect.map((thread) =>
              Option.map(thread, (nextThread) => ({
                kind: "thread-upserted" as const,
                sequence: event.sequence,
                thread: nextThread,
              })),
            ),
            Effect.catch(() => Effect.succeed(Option.none())),
          );
        default:
          if (event.aggregateKind !== "thread") {
            return Effect.succeed(Option.none());
          }
          return projectionSnapshotQuery.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
            Effect.map((thread) =>
              Option.map(thread, (nextThread) => ({
                kind: "thread-upserted" as const,
                sequence: event.sequence,
                thread: nextThread,
              })),
            ),
            Effect.catch(() => Effect.succeed(Option.none())),
          );
      }
    };

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
              mcpServerIds: bootstrap.createThread.mcpServerIds ?? [],
              ...(bootstrap.createThread.visibility !== undefined
                ? { visibility: bootstrap.createThread.visibility }
                : {}),
              ...(bootstrap.createThread.owner !== undefined
                ? { owner: bootstrap.createThread.owner }
                : {}),
              ...(bootstrap.createThread.deleteOnSettled !== undefined
                ? { deleteOnSettled: bootstrap.createThread.deleteOnSettled }
                : {}),
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

    const orchestration = makeControlPlaneDomain("orchestration");

    return {
      [ORCHESTRATION_WS_METHODS.getBootstrapSnapshot]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getBootstrapSnapshot,
        (_input) =>
          projectionSnapshotQuery.getBootstrapSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration bootstrap snapshot",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
        (_input) =>
          projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load archived orchestration shell snapshot",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.subscribeShell]: orchestration.streamEffect(
        ORCHESTRATION_WS_METHODS.subscribeShell,
        (_input) =>
          Effect.gen(function* () {
            const snapshot = yield* projectionSnapshotQuery.getBootstrapSnapshot().pipe(
              Effect.map(
                ({ managedProcessInstances: _managedProcessInstances, ...shellSnapshot }) =>
                  shellSnapshot,
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load orchestration shell snapshot",
                    cause,
                  }),
              ),
            );

            const liveStream = orchestrationEngine.streamDomainEvents.pipe(
              Stream.mapEffect(toShellStreamEvent),
              Stream.flatMap((shellEvent) =>
                Option.isSome(shellEvent) ? Stream.succeed(shellEvent.value) : Stream.empty,
              ),
            );

            return Stream.concat(
              Stream.succeed({
                kind: "snapshot" as const,
                snapshot,
              }),
              liveStream,
            );
          }),
      ),
      [ORCHESTRATION_WS_METHODS.subscribeManagedProcesses]: orchestration.streamEffect(
        ORCHESTRATION_WS_METHODS.subscribeManagedProcesses,
        (_input) =>
          managedProcessManager.listAll().pipe(
            Effect.map((instances) => {
              const snapshot: OrchestrationManagedProcessStreamItem = {
                kind: "snapshot",
                snapshot: {
                  instances,
                  updatedAt: new Date().toISOString(),
                },
              };
              return Stream.concat(Stream.succeed(snapshot), Stream.never);
            }),
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load managed process snapshot",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.getSnapshot]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getSnapshot,
        (_input) =>
          projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.getThreadSnapshot]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getThreadSnapshot,
        (input) =>
          projectionSnapshotQuery.getThreadSnapshot(input.threadId).pipe(
            Effect.map((thread) => (Option.isSome(thread) ? thread.value : null)),
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration thread snapshot",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.dispatchCommand,
        (command) =>
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
          }).pipe(Effect.mapError(toDispatchCommandRouteError)),
      ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getTurnDiff,
        (input) =>
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.getFullThreadDiff,
        (input) =>
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
      ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: orchestration.effect(
        ORCHESTRATION_WS_METHODS.replayEvents,
        (input) =>
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
      ),
      [WS_METHODS.subscribeOrchestrationDomainEvents]: orchestration.streamEffect(
        WS_METHODS.subscribeOrchestrationDomainEvents,
        (_input) =>
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
      ),
    };
  });
