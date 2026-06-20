import {
  DEFAULT_TERMINAL_ID,
  type TerminalEvent,
  type TerminalSessionSnapshot,
  type TerminalSessionStatus,
} from "@fenrir/contracts";
import { capHistory, sanitizeTerminalHistoryChunk } from "@fenrir/shared/ansiSanitizer";
import {
  Effect,
  Equal,
  Exit,
  FileSystem,
  Layer,
  Option,
  Scope,
  Semaphore,
  SynchronizedRef,
} from "effect";

import {
  increment,
  terminalRestartsTotal,
  terminalSessionsTotal,
} from "../../observability/Metrics";
import { ServerConfig } from "../../config";
import {
  TerminalCwdError,
  TerminalManager,
  TerminalNotRunningError,
  TerminalSessionLookupError,
  type TerminalManagerShape,
} from "../Services/Manager";
import {
  PtyAdapter,
  PtySpawnError,
  type PtyAdapterShape,
  type PtyExitEvent,
  type PtyProcess,
} from "../Services/PTY";
import {
  TerminalHistoryManager,
  type TerminalHistoryManagerShape,
} from "../Services/HistoryManager";
import {
  TerminalShellResolver,
  type TerminalShellResolverShape,
  type ShellCandidate,
} from "../Services/ShellResolver";
import {
  TerminalProcessLifecycle,
  type TerminalProcessLifecycleShape,
} from "../Services/ProcessLifecycle";
import { withPierreDarkLazygitThemeEnvForStateDir } from "./LazygitTheme";

const DEFAULT_HISTORY_LINE_LIMIT = 5_000;
const DEFAULT_SUBPROCESS_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS = 128;
const DEFAULT_OPEN_COLS = 120;
const DEFAULT_OPEN_ROWS = 30;
const NOOP: () => void = () => undefined;

interface TerminalStartInput {
  threadId: string;
  terminalId: string;
  cwd: string;
  worktreePath?: string | null;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

interface TerminalSessionState {
  threadId: string;
  terminalId: string;
  cwd: string;
  worktreePath: string | null;
  status: TerminalSessionStatus;
  pid: number | null;
  history: string;
  pendingHistoryControlSequence: string;
  pendingProcessEvents: Array<PendingProcessEvent>;
  pendingProcessEventIndex: number;
  processEventDrainRunning: boolean;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
  cols: number;
  rows: number;
  process: PtyProcess | null;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
  hasRunningSubprocess: boolean;
  runtimeEnv: Record<string, string> | null;
}

type PendingProcessEvent = { type: "output"; data: string } | { type: "exit"; event: PtyExitEvent };

type DrainProcessEventAction =
  | { type: "idle" }
  | {
      type: "output";
      threadId: string;
      terminalId: string;
      history: string | null;
      data: string;
    }
  | {
      type: "exit";
      process: PtyProcess | null;
      threadId: string;
      terminalId: string;
      exitCode: number | null;
      exitSignal: number | null;
    };

interface TerminalManagerState {
  sessions: Map<string, TerminalSessionState>;
}

interface ThreadLockEntry {
  readonly semaphore: Semaphore.Semaphore;
  readonly users: number;
}

function snapshot(session: TerminalSessionState): TerminalSessionSnapshot {
  return {
    threadId: session.threadId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    worktreePath: session.worktreePath,
    status: session.status,
    pid: session.pid,
    history: session.history,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    updatedAt: session.updatedAt,
  };
}

function cleanupProcessHandles(session: TerminalSessionState): void {
  session.unsubscribeData?.();
  session.unsubscribeData = null;
  session.unsubscribeExit?.();
  session.unsubscribeExit = null;
}

function enqueueProcessEvent(
  session: TerminalSessionState,
  expectedPid: number,
  event: PendingProcessEvent,
): boolean {
  if (!session.process || session.status !== "running" || session.pid !== expectedPid) {
    return false;
  }

  session.pendingProcessEvents.push(event);
  if (session.processEventDrainRunning) {
    return false;
  }

  session.processEventDrainRunning = true;
  return true;
}

function toSessionKey(threadId: string, terminalId: string): string {
  return `${threadId}\u0000${terminalId}`;
}

interface TerminalManagerOptions {
  ptyAdapter: PtyAdapterShape;
  historyManager: TerminalHistoryManagerShape;
  shellResolver: TerminalShellResolverShape;
  processLifecycle: TerminalProcessLifecycleShape;
  subprocessPollIntervalMs?: number;
  maxRetainedInactiveSessions?: number;
}

const makeTerminalManager = Effect.fn("makeTerminalManager")(function* () {
  const ptyAdapter = yield* PtyAdapter;
  const historyManager = yield* TerminalHistoryManager;
  const shellResolver = yield* TerminalShellResolver;
  const processLifecycle = yield* TerminalProcessLifecycle;
  return yield* makeTerminalManagerWithOptions({
    ptyAdapter,
    historyManager,
    shellResolver,
    processLifecycle,
  });
});

export const makeTerminalManagerWithOptions = Effect.fn("makeTerminalManagerWithOptions")(
  function* (options: TerminalManagerOptions) {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* Effect.serviceOption(ServerConfig);
    const services = yield* Effect.context();
    const runFork = Effect.runForkWith(services);
    const withLazygitThemeEnv = (env: NodeJS.ProcessEnv) =>
      Option.match(serverConfig, {
        onNone: () => Effect.succeed(env),
        onSome: (config) =>
          withPierreDarkLazygitThemeEnvForStateDir(env, config.stateDir).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
          ),
      });

    const subprocessPollIntervalMs =
      options.subprocessPollIntervalMs ?? DEFAULT_SUBPROCESS_POLL_INTERVAL_MS;
    const maxRetainedInactiveSessions =
      options.maxRetainedInactiveSessions ?? DEFAULT_MAX_RETAINED_INACTIVE_SESSIONS;

    const managerStateRef = yield* SynchronizedRef.make<TerminalManagerState>({
      sessions: new Map(),
    });
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, ThreadLockEntry>());
    const terminalEventListeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
    const workerScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));

    const publishEvent = (event: TerminalEvent) =>
      Effect.gen(function* () {
        for (const listener of terminalEventListeners) {
          yield* listener(event).pipe(Effect.ignoreCause({ log: true }));
        }
      });

    const readManagerState = SynchronizedRef.get(managerStateRef);

    const modifyManagerState = <A>(
      f: (state: TerminalManagerState) => readonly [A, TerminalManagerState],
    ) => SynchronizedRef.modify(managerStateRef, f);

    const threadHasSessions = (threadId: string) =>
      readManagerState.pipe(
        Effect.map((state) =>
          [...state.sessions.values()].some((session) => session.threadId === threadId),
        ),
      );

    const acquireThreadLock = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<ThreadLockEntry> = Option.fromNullishOr(
          current.get(threadId),
        );
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const entry: ThreadLockEntry = { semaphore, users: 1 };
                const next = new Map(current);
                next.set(threadId, entry);
                return [entry, next] as const;
              }),
            ),
          onSome: (entry) => {
            const nextEntry: ThreadLockEntry = {
              semaphore: entry.semaphore,
              users: entry.users + 1,
            };
            const next = new Map(current);
            next.set(threadId, nextEntry);
            return Effect.succeed([nextEntry, next] as const);
          },
        });
      });

    const releaseThreadLock = (threadId: string, entry: ThreadLockEntry) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) =>
        threadHasSessions(threadId).pipe(
          Effect.map((hasSessions) => {
            const existing = current.get(threadId);
            if (!existing || existing.semaphore !== entry.semaphore) {
              return [undefined, current] as const;
            }

            const nextUsers = Math.max(0, existing.users - 1);
            const next = new Map(current);
            if (nextUsers === 0 && !hasSessions) {
              next.delete(threadId);
            } else {
              next.set(threadId, {
                semaphore: existing.semaphore,
                users: nextUsers,
              });
            }
            return [undefined, next] as const;
          }),
        ),
      );

    const withThreadLock = <A, E, R>(
      threadId: string,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.flatMap(acquireThreadLock(threadId), (entry) =>
        entry.semaphore
          .withPermit(effect)
          .pipe(Effect.ensuring(releaseThreadLock(threadId, entry))),
      );

    const assertValidCwd = Effect.fn("terminal.assertValidCwd")(function* (cwd: string) {
      const stats = yield* fileSystem.stat(cwd).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalCwdError({
              cwd,
              reason: cause.reason._tag === "NotFound" ? "notFound" : "statFailed",
              cause,
            }),
        ),
      );
      if (stats.type !== "Directory") {
        return yield* new TerminalCwdError({
          cwd,
          reason: "notDirectory",
        });
      }
    });

    const getSession = Effect.fn("terminal.getSession")(function* (
      threadId: string,
      terminalId: string,
    ): Effect.fn.Return<Option.Option<TerminalSessionState>> {
      return yield* Effect.map(readManagerState, (state) =>
        Option.fromNullishOr(state.sessions.get(toSessionKey(threadId, terminalId))),
      );
    });

    const requireSession = Effect.fn("terminal.requireSession")(function* (
      threadId: string,
      terminalId: string,
    ): Effect.fn.Return<TerminalSessionState, TerminalSessionLookupError> {
      return yield* Effect.flatMap(getSession(threadId, terminalId), (session) =>
        Option.match(session, {
          onNone: () =>
            Effect.fail(
              new TerminalSessionLookupError({
                threadId,
                terminalId,
              }),
            ),
          onSome: Effect.succeed,
        }),
      );
    });

    const sessionsForThread = Effect.fn("terminal.sessionsForThread")(function* (threadId: string) {
      return yield* readManagerState.pipe(
        Effect.map((state) =>
          [...state.sessions.values()].filter((session) => session.threadId === threadId),
        ),
      );
    });

    const evictInactiveSessionsIfNeeded = Effect.fn("terminal.evictInactiveSessionsIfNeeded")(
      function* () {
        yield* modifyManagerState((state) => {
          const inactiveSessions = [...state.sessions.values()].filter(
            (session) => session.status !== "running",
          );
          if (inactiveSessions.length <= maxRetainedInactiveSessions) {
            return [undefined, state] as const;
          }

          inactiveSessions.sort(
            (left, right) =>
              left.updatedAt.localeCompare(right.updatedAt) ||
              left.threadId.localeCompare(right.threadId) ||
              left.terminalId.localeCompare(right.terminalId),
          );

          const sessions = new Map(state.sessions);

          const toEvict = inactiveSessions.length - maxRetainedInactiveSessions;
          for (const session of inactiveSessions.slice(0, toEvict)) {
            const key = toSessionKey(session.threadId, session.terminalId);
            sessions.delete(key);
          }

          return [undefined, { ...state, sessions }] as const;
        });
      },
    );

    const drainProcessEvents = Effect.fn("terminal.drainProcessEvents")(function* (
      session: TerminalSessionState,
      expectedPid: number,
    ) {
      while (true) {
        const action: DrainProcessEventAction = yield* Effect.sync(() => {
          if (session.pid !== expectedPid || !session.process || session.status !== "running") {
            session.pendingProcessEvents = [];
            session.pendingProcessEventIndex = 0;
            session.processEventDrainRunning = false;
            return { type: "idle" } as const;
          }

          const nextEvent = session.pendingProcessEvents[session.pendingProcessEventIndex];
          if (!nextEvent) {
            session.pendingProcessEvents = [];
            session.pendingProcessEventIndex = 0;
            session.processEventDrainRunning = false;
            return { type: "idle" } as const;
          }

          session.pendingProcessEventIndex += 1;
          if (session.pendingProcessEventIndex >= session.pendingProcessEvents.length) {
            session.pendingProcessEvents = [];
            session.pendingProcessEventIndex = 0;
          }

          if (nextEvent.type === "output") {
            const sanitized = sanitizeTerminalHistoryChunk(
              session.pendingHistoryControlSequence,
              nextEvent.data,
            );
            session.pendingHistoryControlSequence = sanitized.pendingControlSequence;
            if (sanitized.visibleText.length > 0) {
              session.history = capHistory(
                `${session.history}${sanitized.visibleText}`,
                DEFAULT_HISTORY_LINE_LIMIT,
              );
            }
            session.updatedAt = new Date().toISOString();

            return {
              type: "output",
              threadId: session.threadId,
              terminalId: session.terminalId,
              history: sanitized.visibleText.length > 0 ? session.history : null,
              data: nextEvent.data,
            } as const;
          }

          const process = session.process;
          cleanupProcessHandles(session);
          session.process = null;
          session.pid = null;
          session.hasRunningSubprocess = false;
          session.status = "exited";
          session.pendingHistoryControlSequence = "";
          session.pendingProcessEvents = [];
          session.pendingProcessEventIndex = 0;
          session.processEventDrainRunning = false;
          session.exitCode = Number.isInteger(nextEvent.event.exitCode)
            ? nextEvent.event.exitCode
            : null;
          session.exitSignal = Number.isInteger(nextEvent.event.signal)
            ? nextEvent.event.signal
            : null;
          session.updatedAt = new Date().toISOString();

          return {
            type: "exit",
            process,
            threadId: session.threadId,
            terminalId: session.terminalId,
            exitCode: session.exitCode,
            exitSignal: session.exitSignal,
          } as const;
        });

        if (action.type === "idle") {
          return;
        }

        if (action.type === "output") {
          if (action.history !== null) {
            yield* options.historyManager.queuePersist(
              action.threadId,
              action.terminalId,
              action.history,
            );
          }

          yield* publishEvent({
            type: "output",
            threadId: action.threadId,
            terminalId: action.terminalId,
            createdAt: new Date().toISOString(),
            data: action.data,
          });
          continue;
        }

        yield* options.processLifecycle.clearKillFiber(action.process);
        yield* publishEvent({
          type: "exited",
          threadId: action.threadId,
          terminalId: action.terminalId,
          createdAt: new Date().toISOString(),
          exitCode: action.exitCode,
          exitSignal: action.exitSignal,
        });
        yield* evictInactiveSessionsIfNeeded();
        return;
      }
    });

    const stopProcess = Effect.fn("terminal.stopProcess")(function* (
      session: TerminalSessionState,
    ) {
      const process = session.process;
      if (!process) return;

      yield* modifyManagerState((state) => {
        cleanupProcessHandles(session);
        session.process = null;
        session.pid = null;
        session.hasRunningSubprocess = false;
        session.status = "exited";
        session.pendingHistoryControlSequence = "";
        session.pendingProcessEvents = [];
        session.pendingProcessEventIndex = 0;
        session.processEventDrainRunning = false;
        session.updatedAt = new Date().toISOString();
        return [undefined, state] as const;
      });

      yield* options.processLifecycle.clearKillFiber(process);
      yield* options.processLifecycle.startKillEscalation(
        process,
        session.threadId,
        session.terminalId,
      );
      yield* evictInactiveSessionsIfNeeded();
    });

    const trySpawn = Effect.fn("terminal.trySpawn")(function* (
      shellCandidates: ReadonlyArray<ShellCandidate>,
      spawnEnv: NodeJS.ProcessEnv,
      session: TerminalSessionState,
      index = 0,
      lastError: PtySpawnError | null = null,
    ): Effect.fn.Return<{ process: PtyProcess; shellLabel: string }, PtySpawnError> {
      if (index >= shellCandidates.length) {
        const detail = lastError?.message ?? "Failed to spawn PTY process";
        const tried =
          shellCandidates.length > 0
            ? ` Tried shells: ${shellCandidates.map((candidate) => options.shellResolver.formatCandidate(candidate)).join(", ")}.`
            : "";
        return yield* new PtySpawnError({
          adapter: "terminal-manager",
          message: `${detail}.${tried}`.trim(),
          ...(lastError ? { cause: lastError } : {}),
        });
      }

      const candidate = shellCandidates[index];
      if (!candidate) {
        return yield* (
          lastError ??
            new PtySpawnError({
              adapter: "terminal-manager",
              message: "No shell candidate available for PTY spawn.",
            })
        );
      }

      const attempt = yield* Effect.result(
        options.ptyAdapter.spawn({
          shell: candidate.shell,
          ...(candidate.args ? { args: candidate.args } : {}),
          cwd: session.cwd,
          cols: session.cols,
          rows: session.rows,
          env: spawnEnv,
        }),
      );

      if (attempt._tag === "Success") {
        return {
          process: attempt.success,
          shellLabel: options.shellResolver.formatCandidate(candidate),
        };
      }

      const spawnError = attempt.failure;
      if (!options.shellResolver.isRetryableSpawnError(spawnError)) {
        return yield* spawnError;
      }

      return yield* trySpawn(shellCandidates, spawnEnv, session, index + 1, spawnError);
    });

    const startSession = Effect.fn("terminal.startSession")(function* (
      session: TerminalSessionState,
      input: TerminalStartInput,
      eventType: "started" | "restarted",
    ) {
      yield* stopProcess(session);
      yield* Effect.annotateCurrentSpan({
        "terminal.thread_id": session.threadId,
        "terminal.id": session.terminalId,
        "terminal.event_type": eventType,
        "terminal.cwd": input.cwd,
      });

      yield* modifyManagerState((state) => {
        session.status = "starting";
        session.cwd = input.cwd;
        session.worktreePath = input.worktreePath ?? null;
        session.cols = input.cols;
        session.rows = input.rows;
        session.exitCode = null;
        session.exitSignal = null;
        session.hasRunningSubprocess = false;
        session.pendingProcessEvents = [];
        session.pendingProcessEventIndex = 0;
        session.processEventDrainRunning = false;
        session.updatedAt = new Date().toISOString();
        return [undefined, state] as const;
      });

      let ptyProcess: PtyProcess | null = null;
      let startedShell: string | null = null;

      const startResult = yield* Effect.result(
        increment(terminalSessionsTotal, { lifecycle: eventType }).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const shellCandidates = options.shellResolver.resolve();
              const terminalEnv = yield* withLazygitThemeEnv(
                options.shellResolver.createSpawnEnv(process.env, session.runtimeEnv),
              );
              const spawnResult = yield* trySpawn(shellCandidates, terminalEnv, session);
              ptyProcess = spawnResult.process;
              startedShell = spawnResult.shellLabel;

              const processPid = ptyProcess.pid;
              let unsubscribeData = NOOP;
              let unsubscribeExit = NOOP;

              yield* modifyManagerState((state) => {
                session.process = ptyProcess;
                session.pid = processPid;
                session.status = "running";
                session.updatedAt = new Date().toISOString();
                session.unsubscribeData = () => unsubscribeData();
                session.unsubscribeExit = () => unsubscribeExit();
                return [undefined, state] as const;
              });

              unsubscribeData = ptyProcess.onData((data) => {
                if (
                  !enqueueProcessEvent(session, processPid, {
                    type: "output",
                    data,
                  })
                ) {
                  return;
                }
                runFork(drainProcessEvents(session, processPid));
              });
              unsubscribeExit = ptyProcess.onExit((event) => {
                if (
                  !enqueueProcessEvent(session, processPid, {
                    type: "exit",
                    event,
                  })
                ) {
                  return;
                }
                runFork(drainProcessEvents(session, processPid));
              });

              yield* modifyManagerState((state) => {
                if (
                  session.process === ptyProcess &&
                  session.pid === processPid &&
                  session.status === "running"
                ) {
                  session.updatedAt = new Date().toISOString();
                  session.unsubscribeData = unsubscribeData;
                  session.unsubscribeExit = unsubscribeExit;
                } else {
                  unsubscribeData();
                  unsubscribeExit();
                }
                return [undefined, state] as const;
              });

              yield* publishEvent({
                type: eventType,
                threadId: session.threadId,
                terminalId: session.terminalId,
                createdAt: new Date().toISOString(),
                snapshot: snapshot(session),
              });
            }),
          ),
        ),
      );

      if (startResult._tag === "Success") {
        return;
      }

      {
        const error = startResult.failure;
        if (ptyProcess) {
          yield* options.processLifecycle.startKillEscalation(
            ptyProcess,
            session.threadId,
            session.terminalId,
          );
        }

        yield* modifyManagerState((state) => {
          session.status = "error";
          session.pid = null;
          session.process = null;
          session.unsubscribeData = null;
          session.unsubscribeExit = null;
          session.hasRunningSubprocess = false;
          session.pendingProcessEvents = [];
          session.pendingProcessEventIndex = 0;
          session.processEventDrainRunning = false;
          session.updatedAt = new Date().toISOString();
          return [undefined, state] as const;
        });

        yield* evictInactiveSessionsIfNeeded();

        const message = error.message;
        yield* publishEvent({
          type: "error",
          threadId: session.threadId,
          terminalId: session.terminalId,
          createdAt: new Date().toISOString(),
          message,
        });
        yield* Effect.logError("failed to start terminal", {
          threadId: session.threadId,
          terminalId: session.terminalId,
          error: message,
          ...(startedShell ? { shell: startedShell } : {}),
        });
      }
    });

    const closeSession = Effect.fn("terminal.closeSession")(function* (
      threadId: string,
      terminalId: string,
      deleteHistoryOnClose: boolean,
    ) {
      const key = toSessionKey(threadId, terminalId);
      const session = yield* getSession(threadId, terminalId);

      if (Option.isSome(session)) {
        yield* stopProcess(session.value);
        yield* options.historyManager.persist(threadId, terminalId, session.value.history);
      }

      yield* options.historyManager.flushPersist(threadId, terminalId);

      yield* modifyManagerState((state) => {
        if (!state.sessions.has(key)) {
          return [undefined, state] as const;
        }
        const sessions = new Map(state.sessions);
        sessions.delete(key);
        return [undefined, { ...state, sessions }] as const;
      });

      if (deleteHistoryOnClose) {
        yield* options.historyManager.delete(threadId, terminalId);
      }
    });

    const pollSubprocessActivity = Effect.fn("terminal.pollSubprocessActivity")(function* () {
      const state = yield* readManagerState;
      const runningSessions = [...state.sessions.values()].filter(
        (session): session is TerminalSessionState & { pid: number } =>
          session.status === "running" && Number.isInteger(session.pid),
      );

      if (runningSessions.length === 0) {
        return;
      }

      const checkSubprocessActivity = Effect.fn("terminal.checkSubprocessActivity")(function* (
        session: TerminalSessionState & { pid: number },
      ) {
        const terminalPid = session.pid;
        const hasRunningSubprocess = yield* options.processLifecycle
          .checkSubprocessActivity(terminalPid)
          .pipe(Effect.map(Option.some));

        if (Option.isNone(hasRunningSubprocess)) {
          return;
        }

        const event = yield* modifyManagerState((state) => {
          const liveSession: Option.Option<TerminalSessionState> = Option.fromNullishOr(
            state.sessions.get(toSessionKey(session.threadId, session.terminalId)),
          );
          if (
            Option.isNone(liveSession) ||
            liveSession.value.status !== "running" ||
            liveSession.value.pid !== terminalPid ||
            liveSession.value.hasRunningSubprocess === hasRunningSubprocess.value
          ) {
            return [Option.none(), state] as const;
          }

          liveSession.value.hasRunningSubprocess = hasRunningSubprocess.value;
          liveSession.value.updatedAt = new Date().toISOString();

          return [
            Option.some({
              type: "activity" as const,
              threadId: liveSession.value.threadId,
              terminalId: liveSession.value.terminalId,
              createdAt: new Date().toISOString(),
              hasRunningSubprocess: hasRunningSubprocess.value,
            }),
            state,
          ] as const;
        });

        if (Option.isSome(event)) {
          yield* publishEvent(event.value);
        }
      });

      yield* Effect.forEach(runningSessions, checkSubprocessActivity, {
        concurrency: "unbounded",
        discard: true,
      });
    });

    const hasRunningSessions = readManagerState.pipe(
      Effect.map((state) =>
        [...state.sessions.values()].some((session) => session.status === "running"),
      ),
    );

    yield* Effect.forever(
      hasRunningSessions.pipe(
        Effect.flatMap((active) =>
          active
            ? pollSubprocessActivity().pipe(
                Effect.flatMap(() => Effect.sleep(subprocessPollIntervalMs)),
              )
            : Effect.sleep(subprocessPollIntervalMs),
        ),
      ),
    ).pipe(Effect.forkIn(workerScope));

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const sessions = yield* modifyManagerState(
          (state) =>
            [
              [...state.sessions.values()],
              {
                ...state,
                sessions: new Map(),
              },
            ] as const,
        );

        const cleanupSession = Effect.fn("terminal.cleanupSession")(function* (
          session: TerminalSessionState,
        ) {
          cleanupProcessHandles(session);
          if (!session.process) return;
          // Cancel any pending kill fiber, then run kill escalation inline
          // (not forked) so that SIGTERM/SIGKILL complete before scope closes.
          yield* options.processLifecycle.clearKillFiber(session.process);
          yield* Effect.try({
            try: () => session.process!.kill("SIGTERM"),
            catch: () => undefined,
          }).pipe(Effect.ignore);
          yield* Effect.try({
            try: () => session.process!.kill("SIGKILL"),
            catch: () => undefined,
          }).pipe(Effect.ignore);
        });

        yield* Effect.forEach(sessions, cleanupSession, {
          concurrency: "unbounded",
          discard: true,
        });
      }).pipe(Effect.ignoreCause({ log: true })),
    );

    const open: TerminalManagerShape["open"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
          yield* assertValidCwd(input.cwd);

          const sessionKey = toSessionKey(input.threadId, terminalId);
          const existing = yield* getSession(input.threadId, terminalId);
          if (Option.isNone(existing)) {
            yield* options.historyManager.flushPersist(input.threadId, terminalId);
            const history = yield* options.historyManager.read(input.threadId, terminalId);
            const cols = input.cols ?? DEFAULT_OPEN_COLS;
            const rows = input.rows ?? DEFAULT_OPEN_ROWS;
            const session: TerminalSessionState = {
              threadId: input.threadId,
              terminalId,
              cwd: input.cwd,
              worktreePath: input.worktreePath ?? null,
              status: "starting",
              pid: null,
              history,
              pendingHistoryControlSequence: "",
              pendingProcessEvents: [],
              pendingProcessEventIndex: 0,
              processEventDrainRunning: false,
              exitCode: null,
              exitSignal: null,
              updatedAt: new Date().toISOString(),
              cols,
              rows,
              process: null,
              unsubscribeData: null,
              unsubscribeExit: null,
              hasRunningSubprocess: false,
              runtimeEnv: options.shellResolver.normalizeRuntimeEnv(input.env),
            };

            const createdSession = session;
            yield* modifyManagerState((state) => {
              const sessions = new Map(state.sessions);
              sessions.set(sessionKey, createdSession);
              return [undefined, { ...state, sessions }] as const;
            });

            yield* evictInactiveSessionsIfNeeded();
            yield* startSession(
              session,
              {
                threadId: input.threadId,
                terminalId,
                cwd: input.cwd,
                ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
                cols,
                rows,
                ...(input.env ? { env: input.env } : {}),
              },
              "started",
            );
            return snapshot(session);
          }

          const liveSession = existing.value;
          const nextRuntimeEnv = options.shellResolver.normalizeRuntimeEnv(input.env);
          const currentRuntimeEnv = liveSession.runtimeEnv;
          const targetCols = input.cols ?? liveSession.cols;
          const targetRows = input.rows ?? liveSession.rows;
          const runtimeEnvChanged = !Equal.equals(currentRuntimeEnv, nextRuntimeEnv);

          if (liveSession.cwd !== input.cwd || runtimeEnvChanged) {
            yield* stopProcess(liveSession);
            liveSession.cwd = input.cwd;
            liveSession.worktreePath = input.worktreePath ?? null;
            liveSession.runtimeEnv = nextRuntimeEnv;
            liveSession.history = "";
            liveSession.pendingHistoryControlSequence = "";
            liveSession.pendingProcessEvents = [];
            liveSession.pendingProcessEventIndex = 0;
            liveSession.processEventDrainRunning = false;
            yield* options.historyManager.persist(
              liveSession.threadId,
              liveSession.terminalId,
              liveSession.history,
            );
          } else if (liveSession.status === "exited" || liveSession.status === "error") {
            liveSession.runtimeEnv = nextRuntimeEnv;
            liveSession.worktreePath = input.worktreePath ?? null;
            liveSession.history = "";
            liveSession.pendingHistoryControlSequence = "";
            liveSession.pendingProcessEvents = [];
            liveSession.pendingProcessEventIndex = 0;
            liveSession.processEventDrainRunning = false;
            yield* options.historyManager.persist(
              liveSession.threadId,
              liveSession.terminalId,
              liveSession.history,
            );
          }

          if (!liveSession.process) {
            yield* startSession(
              liveSession,
              {
                threadId: input.threadId,
                terminalId,
                cwd: input.cwd,
                worktreePath: liveSession.worktreePath,
                cols: targetCols,
                rows: targetRows,
                ...(input.env ? { env: input.env } : {}),
              },
              "started",
            );
            return snapshot(liveSession);
          }

          if (liveSession.cols !== targetCols || liveSession.rows !== targetRows) {
            liveSession.cols = targetCols;
            liveSession.rows = targetRows;
            liveSession.updatedAt = new Date().toISOString();
            liveSession.process.resize(targetCols, targetRows);
          }

          return snapshot(liveSession);
        }),
      );

    const write: TerminalManagerShape["write"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
          const session = yield* requireSession(input.threadId, terminalId);
          const process = session.process;
          if (!process || session.status !== "running") {
            if (session.status === "exited") return;
            return yield* new TerminalNotRunningError({
              threadId: input.threadId,
              terminalId,
            });
          }
          yield* Effect.sync(() => process.write(input.data));
        }),
      );

    const resize: TerminalManagerShape["resize"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
          const session = yield* requireSession(input.threadId, terminalId);
          const process = session.process;
          if (!process || session.status !== "running") {
            return yield* new TerminalNotRunningError({
              threadId: input.threadId,
              terminalId,
            });
          }
          session.cols = input.cols;
          session.rows = input.rows;
          session.updatedAt = new Date().toISOString();
          yield* Effect.sync(() => process.resize(input.cols, input.rows));
        }),
      );

    const clear: TerminalManagerShape["clear"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
          const session = yield* requireSession(input.threadId, terminalId);
          session.history = "";
          session.pendingHistoryControlSequence = "";
          session.pendingProcessEvents = [];
          session.pendingProcessEventIndex = 0;
          session.processEventDrainRunning = false;
          session.updatedAt = new Date().toISOString();
          yield* options.historyManager.persist(input.threadId, terminalId, session.history);
          yield* publishEvent({
            type: "cleared",
            threadId: input.threadId,
            terminalId,
            createdAt: new Date().toISOString(),
          });
        }),
      );

    const restart: TerminalManagerShape["restart"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          yield* increment(terminalRestartsTotal, { scope: "thread" });
          const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
          yield* assertValidCwd(input.cwd);

          const sessionKey = toSessionKey(input.threadId, terminalId);
          const existingSession = yield* getSession(input.threadId, terminalId);
          let session: TerminalSessionState;
          if (Option.isNone(existingSession)) {
            const cols = input.cols ?? DEFAULT_OPEN_COLS;
            const rows = input.rows ?? DEFAULT_OPEN_ROWS;
            session = {
              threadId: input.threadId,
              terminalId,
              cwd: input.cwd,
              worktreePath: input.worktreePath ?? null,
              status: "starting",
              pid: null,
              history: "",
              pendingHistoryControlSequence: "",
              pendingProcessEvents: [],
              pendingProcessEventIndex: 0,
              processEventDrainRunning: false,
              exitCode: null,
              exitSignal: null,
              updatedAt: new Date().toISOString(),
              cols,
              rows,
              process: null,
              unsubscribeData: null,
              unsubscribeExit: null,
              hasRunningSubprocess: false,
              runtimeEnv: options.shellResolver.normalizeRuntimeEnv(input.env),
            };
            const createdSession = session;
            yield* modifyManagerState((state) => {
              const sessions = new Map(state.sessions);
              sessions.set(sessionKey, createdSession);
              return [undefined, { ...state, sessions }] as const;
            });
            yield* evictInactiveSessionsIfNeeded();
          } else {
            session = existingSession.value;
            yield* stopProcess(session);
            session.cwd = input.cwd;
            session.worktreePath = input.worktreePath ?? null;
            session.runtimeEnv = options.shellResolver.normalizeRuntimeEnv(input.env);
          }

          const cols = input.cols ?? session.cols;
          const rows = input.rows ?? session.rows;

          session.history = "";
          session.pendingHistoryControlSequence = "";
          session.pendingProcessEvents = [];
          session.pendingProcessEventIndex = 0;
          session.processEventDrainRunning = false;
          yield* options.historyManager.persist(input.threadId, terminalId, session.history);
          yield* startSession(
            session,
            {
              threadId: input.threadId,
              terminalId,
              cwd: input.cwd,
              ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
              cols,
              rows,
              ...(input.env ? { env: input.env } : {}),
            },
            "restarted",
          );
          return snapshot(session);
        }),
      );

    const close: TerminalManagerShape["close"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.terminalId) {
            yield* closeSession(input.threadId, input.terminalId, input.deleteHistory === true);
            return;
          }

          const threadSessions = yield* sessionsForThread(input.threadId);
          yield* Effect.forEach(
            threadSessions,
            (session) => closeSession(input.threadId, session.terminalId, false),
            { discard: true },
          );

          if (input.deleteHistory) {
            yield* options.historyManager.deleteAllForThread(input.threadId);
          }
        }),
      );

    return {
      open,
      write,
      resize,
      clear,
      restart,
      close,
      subscribe: (listener) =>
        Effect.sync(() => {
          terminalEventListeners.add(listener);
          return () => {
            terminalEventListeners.delete(listener);
          };
        }),

      publishTmuxOutput: (projectId, data) =>
        publishEvent({
          type: "output",
          threadId: `tmux:${projectId}`,
          terminalId: `tmux`,
          data,
          createdAt: new Date().toISOString(),
        }),

      publishTmuxExit: (projectId, exitCode, signal) =>
        publishEvent({
          type: "exited",
          threadId: `tmux:${projectId}`,
          terminalId: `tmux`,
          exitCode,
          exitSignal: signal,
          createdAt: new Date().toISOString(),
        }),
    } satisfies TerminalManagerShape;
  },
);

export const TerminalManagerLive = Layer.effect(TerminalManager, makeTerminalManager());
