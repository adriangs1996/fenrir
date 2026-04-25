/**
 * MetasploitServiceLive — Layer implementation for MetasploitService.
 *
 * Spawns msfrpcd via PtyAdapter, communicates via MSFRPC MessagePack-RPC over HTTP,
 * polls for session changes, and emits events via internal PubSub.
 */
import { Duration, Effect, Fiber, Layer, Schedule } from "effect";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { msgpackDecode } from "@fenrir/shared/msgpack";
import {
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  type CreateListenerInput,
  type ListenerSnapshot,
  type MetasploitEvent,
  type MetasploitStatusSnapshot,
  type MsfSessionSnapshot,
} from "@fenrir/contracts";

import { PtyAdapter, type PtyProcess } from "../../terminal/Services/PTY";
import {
  MetasploitService,
  type MetasploitServiceShape,
} from "../Services/MetasploitService";

// ─── MSFRPC Client ──────────────────────────────────────────────────────────

interface MsfrpcClient {
  call(method: string, params?: unknown[]): Promise<any>;
  authenticate(): Promise<void>;
  dispose(): void;
}

function createMsfrpcClient(
  host: string,
  port: number,
  password: string,
): MsfrpcClient {
  let token: string | null = null;
  let disposed = false;

  const call = async (method: string, params: unknown[] = []): Promise<any> => {
    if (disposed) {
      throw new Error("MSFRPC client disposed");
    }
    const body = token
      ? [method, token, ...params]
      : [method, ...params];

    const response = await fetch(`http://${host}:${port}/api/`, {
      method: "POST",
      headers: { "Content-Type": "binary/message-pack" },
      body: msgpackEncode(body),
    });

    if (!response.ok) {
      throw new Error(
        `MSFRPC request failed: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = await response.arrayBuffer();
    return msgpackDecode(new Uint8Array(buffer));
  };

  return {
    call,
    authenticate: async () => {
      const result = await call("auth.login", [MSFRPC_USER, password]);
      if (result?.result === "success" && result?.token) {
        token = result.token;
      } else {
        throw new Error("MSFRPC authentication failed");
      }
    },
    dispose: () => {
      disposed = true;
      token = null;
    },
  };
}

// ─── Internal State ─────────────────────────────────────────────────────────

interface ListenerState {
  snapshot: ListenerSnapshot;
  jobId: string | null;
}

// ─── Layer ──────────────────────────────────────────────────────────────────

const MSFRPC_HOST = "127.0.0.1";
const MSFRPC_PORT = 55553;
const MSFRPC_USER = "msf";
const MSFRPC_PASSWORD = "fenrir";
const SESSION_POLL_INTERVAL = "2 seconds";

export const MetasploitServiceLive = Layer.effect(
  MetasploitService,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const runFork = Effect.runForkWith(yield* Effect.services());

    // Internal state
    let msfrpcdProcess: PtyProcess | null = null;
    let rpcClient: MsfrpcClient | null = null;
    const listeners = new Map<string, ListenerState>();
    const knownSessions = new Map<string, MsfSessionSnapshot>();
    const eventSubscribers = new Set<(event: MetasploitEvent) => void>();
    let pollingFiber: { interrupt: () => void } | null = null;

    const emitEvent = (event: MetasploitEvent) => {
      for (const subscriber of eventSubscribers) {
        try {
          subscriber(event);
        } catch {
          // Don't let subscriber errors propagate
        }
      }
    };

    const ensureConnected = (): MsfrpcClient => {
      if (!rpcClient) {
        throw new MetasploitConnectionError({
          message: "Metasploit is not connected",
        });
      }
      return rpcClient;
    };

    /** Spawn msfrpcd + authenticate if not already running. Idempotent. */
    const ensureStarted = Effect.gen(function* () {
      if (rpcClient) return rpcClient;

      // Spawn msfrpcd
      const proc = yield* ptyAdapter
        .spawn({
          shell: "msfrpcd",
          args: [
            "-P",
            MSFRPC_PASSWORD,
            "-S",
            "-a",
            MSFRPC_HOST,
            "-p",
            String(MSFRPC_PORT),
          ],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          env: process.env as NodeJS.ProcessEnv,
        })
        .pipe(
          Effect.mapError((err) => {
            if (
              err.message.includes("ENOENT") ||
              err.message.includes("not found")
            ) {
              return MetasploitNotFoundError.default();
            }
            return new MetasploitConnectionError({
              message: `Failed to spawn msfrpcd: ${err.message}`,
              cause: err,
            });
          }),
        );

      msfrpcdProcess = proc;

      yield* Effect.sleep("3 seconds");

      const client = createMsfrpcClient(
        MSFRPC_HOST,
        MSFRPC_PORT,
        MSFRPC_PASSWORD,
      );

      yield* Effect.retry(
        Effect.tryPromise({
          try: () => client.authenticate(),
          catch: (error) =>
            new MetasploitConnectionError({
              message: `MSFRPC authentication failed: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        }),
        Schedule.recurs(5).pipe(Schedule.addDelay(() => Effect.succeed(Duration.seconds(2)))),
      );

      rpcClient = client;
      startSessionPolling();
      return client;
    });

    const startSessionPolling = () => {
      if (pollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = ensureConnected();
        const result = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        });

        if (result == null) return; // Polling failure — retry next interval

        const currentSessionIds = new Set<string>();

        if (result && typeof result === "object") {
          for (const [sessionId, sessionData] of Object.entries(
            result as Record<string, any>,
          )) {
            currentSessionIds.add(sessionId);
            if (!knownSessions.has(sessionId)) {
              const snapshot: MsfSessionSnapshot = {
                sessionId,
                type: (sessionData as any).type === "meterpreter"
                  ? "meterpreter"
                  : "shell",
                info: String((sessionData as any).info ?? ""),
                targetHost: String(
                  (sessionData as any).session_host ?? "unknown",
                ),
                platform: String((sessionData as any).platform ?? "unknown"),
                via: String((sessionData as any).via_exploit ?? ""),
                listenerId: null,
                openedAt: new Date().toISOString(),
              };
              knownSessions.set(sessionId, snapshot);
              emitEvent({
                type: "session.opened",
                snapshot,
                createdAt: new Date().toISOString(),
              });
            }
          }
        }

        // Detect closed sessions
        for (const [sessionId] of knownSessions) {
          if (!currentSessionIds.has(sessionId)) {
            knownSessions.delete(sessionId);
            emitEvent({
              type: "session.closed",
              sessionId,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }).pipe(Effect.orElseSucceed(() => undefined));

      const pollingSchedule = Schedule.spaced(SESSION_POLL_INTERVAL);
      const fiber = runFork(
        pollEffect.pipe(Effect.repeat(pollingSchedule)),
      );
      pollingFiber = {
        interrupt: () => runFork(Fiber.interrupt(fiber)),
      };
    };

    const stopSessionPolling = () => {
      if (pollingFiber) {
        pollingFiber.interrupt();
        pollingFiber = null;
      }
    };

    return {
      isAvailable: Effect.gen(function* () {
        const proc = yield* ptyAdapter
          .spawn({
            shell: "msfrpcd",
            args: ["-h"],
            cwd: "/tmp",
            cols: 80,
            rows: 24,
            env: process.env as NodeJS.ProcessEnv,
          })
          .pipe(Effect.orElseSucceed(() => null));

        if (!proc) return false;

        return yield* Effect.callback<boolean>((resume) => {
          proc.onExit(() => {
            resume(Effect.succeed(true));
          });
        });
      }).pipe(Effect.orElseSucceed(() => false)),

      start: () => Effect.asVoid(ensureStarted),

      stop: () =>
        Effect.sync(() => {
          stopSessionPolling();

          if (rpcClient) {
            rpcClient.dispose();
            rpcClient = null;
          }

          if (msfrpcdProcess) {
            msfrpcdProcess.kill("SIGTERM");
            // Force kill after 5 seconds if still alive
            setTimeout(() => {
              if (msfrpcdProcess) {
                msfrpcdProcess.kill("SIGKILL");
                msfrpcdProcess = null;
              }
            }, 5_000);
          }

          listeners.clear();
          knownSessions.clear();
        }),

      status: () =>
        Effect.try({
          try: () => {
            const snapshot: MetasploitStatusSnapshot = {
              connected: rpcClient !== null,
              version: null,
              listenersCount: listeners.size,
              sessionsCount: knownSessions.size,
            };
            return snapshot;
          },
          catch: (error) =>
            new MetasploitConnectionError({
              message: `Failed to get status: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        }),

      createListener: (input: CreateListenerInput) =>
        Effect.gen(function* () {
          const client = yield* ensureStarted;

          const listenerId = crypto.randomUUID();

          const result = yield* Effect.tryPromise({
            try: () =>
              client.call("module.execute", [
                "exploit",
                "multi/handler",
                {
                  PAYLOAD: input.payload,
                  LHOST: input.lhost,
                  LPORT: String(input.lport),
                  ExitOnSession: "false",
                },
              ]),
            catch: (error) =>
              new MetasploitListenerError({
                listenerId,
                message: `Failed to create listener: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          const jobId = result?.job_id != null ? String(result.job_id) : null;

          const snapshot: ListenerSnapshot = {
            listenerId,
            name: input.name,
            payload: input.payload,
            lhost: input.lhost,
            lport: input.lport,
            status: jobId ? "waiting" : "error",
            jobId,
            createdAt: new Date().toISOString(),
          };

          listeners.set(listenerId, { snapshot, jobId });

          emitEvent({
            type: "listener.created",
            snapshot,
            createdAt: new Date().toISOString(),
          });

          return snapshot;
        }),

      stopListener: (listenerId: string) =>
        Effect.gen(function* () {
          const listenerState = listeners.get(listenerId);
          if (!listenerState) {
            return yield* new MetasploitListenerError({
              listenerId,
              message: `Listener ${listenerId} not found`,
            });
          }

          if (listenerState.jobId && rpcClient) {
            yield* Effect.tryPromise({
              try: () => rpcClient!.call("job.stop", [listenerState.jobId]),
              catch: (error) =>
                new MetasploitListenerError({
                  listenerId,
                  message: `Failed to stop listener: ${error instanceof Error ? error.message : String(error)}`,
                  cause: error,
                }),
            });
          }

          listeners.delete(listenerId);
          emitEvent({
            type: "listener.stopped",
            listenerId,
            createdAt: new Date().toISOString(),
          });
        }),

      listListeners: () =>
        Effect.try({
          try: () =>
            Array.from(listeners.values()).map(
              (state) => state.snapshot,
            ),
          catch: (error) =>
            new MetasploitConnectionError({
              message: `Failed to list listeners: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        }),

      listSessions: () =>
        Effect.try({
          try: () => Array.from(knownSessions.values()),
          catch: (error) =>
            new MetasploitConnectionError({
              message: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        }),

      sessionWrite: (sessionId: string, data: string) =>
        Effect.gen(function* () {
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          const method =
            session.type === "meterpreter"
              ? "session.meterpreter_write"
              : "session.shell_write";

          yield* Effect.tryPromise({
            try: () => client.call(method, [sessionId, data]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to write to session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });
        }),

      sessionRead: (sessionId: string) =>
        Effect.gen(function* () {
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          const method =
            session.type === "meterpreter"
              ? "session.meterpreter_read"
              : "session.shell_read";

          const result = yield* Effect.tryPromise({
            try: () => client.call(method, [sessionId]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to read from session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          return String(result?.data ?? "");
        }),

      sessionUpgrade: (sessionId: string) =>
        Effect.gen(function* () {
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          if (session.type === "meterpreter") {
            return session; // Already upgraded
          }

          yield* Effect.tryPromise({
            try: () =>
              client.call("session.shell_upgrade", [
                sessionId,
                MSFRPC_HOST,
                "0", // Let Metasploit pick a port
              ]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to upgrade session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // Wait for upgrade to complete
          yield* Effect.sleep("5 seconds");

          // Re-fetch session info
          const result = yield* Effect.tryPromise({
            try: () => client.call("session.list"),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to verify upgrade: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // Find the new meterpreter session
          const sessions = result as Record<string, any> | null;
          if (sessions) {
            for (const [id, data] of Object.entries(sessions)) {
              if (
                (data as any).type === "meterpreter" &&
                (data as any).session_host === session.targetHost
              ) {
                const upgraded: MsfSessionSnapshot = {
                  sessionId: id,
                  type: "meterpreter",
                  info: String((data as any).info ?? ""),
                  targetHost: session.targetHost,
                  platform: String((data as any).platform ?? session.platform),
                  via: String((data as any).via_exploit ?? session.via),
                  listenerId: session.listenerId,
                  openedAt: session.openedAt,
                };
                knownSessions.set(id, upgraded);

                // Remove old shell session if different ID
                if (id !== sessionId) {
                  knownSessions.delete(sessionId);
                }

                emitEvent({
                  type: "session.upgraded",
                  snapshot: upgraded,
                  createdAt: new Date().toISOString(),
                });

                return upgraded;
              }
            }
          }

          return yield* new MetasploitSessionError({
            sessionId,
            message: "Session upgrade did not produce a meterpreter session",
          });
        }),

      sessionClose: (sessionId: string) =>
        Effect.gen(function* () {
          const client = ensureConnected();
          if (!knownSessions.has(sessionId)) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          yield* Effect.tryPromise({
            try: () => client.call("session.stop", [sessionId]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to close session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          knownSessions.delete(sessionId);
          emitEvent({
            type: "session.closed",
            sessionId,
            createdAt: new Date().toISOString(),
          });
        }),

      subscribe: (listener: (event: MetasploitEvent) => void) =>
        Effect.sync(() => {
          eventSubscribers.add(listener);
          return () => {
            eventSubscribers.delete(listener);
          };
        }),
    } satisfies MetasploitServiceShape;
  }),
);
