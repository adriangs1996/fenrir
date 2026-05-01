/**
 * MetasploitServiceLive — Layer implementation for MetasploitService.
 *
 * Spawns msfrpcd via PtyAdapter, communicates via MSFRPC MessagePack-RPC over HTTP,
 * polls for session changes, and emits events via internal PubSub.
 */
import { Deferred, Duration, Effect, Fiber, Layer, Schedule, Schema } from "effect";
import {
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitListenerLookupError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  PayloadType,
  isDirectTcpPayload,
  type CreateListenerInput,
  type ListenerSnapshot,
  type MetasploitEvent,
  type MetasploitStatusSnapshot,
  type MsfSessionSnapshot,
} from "@fenrir/contracts";

import { PtyAdapter, type PtyProcess } from "../../terminal/Services/PTY";
import { MetasploitService, type MetasploitServiceShape } from "../Services/MetasploitService";

// Extracted modules
import type { MsfrpcClient } from "./msfrpcClient";
import type { ListenerState } from "./listenerMatching";
import { buildSessionSnapshot } from "./sessionSnapshot";
import { createRawTcpListener } from "./RawTcpListener";
import {
  MSFRPC_HOST,
  MSFRPC_PORT,
  MSFRPC_USER,
  MSFRPC_PASSWORD,
  JOB_MISS_THRESHOLD,
  POLL_FAILURE_THRESHOLD,
  __testSeams,
} from "./constants";

// ─── Layer ──────────────────────────────────────────────────────────────────

export const MetasploitServiceLive = Layer.effect(
  MetasploitService,
  Effect.gen(function* () {
    const ptyAdapter = yield* PtyAdapter;
    const runFork = Effect.runForkWith(yield* Effect.services());

    // ── Mutable State ────────────────────────────────────────────────────

    let msfrpcdProcess: PtyProcess | null = null;
    let rpcClient: MsfrpcClient | null = null;
    let msfVersion: string | null = null;
    let lastEmittedConnected: boolean | null = null;
    let pollFailureCount = 0;
    let cachedClient: MsfrpcClient | null = null;
    let startDeferred: Deferred.Deferred<
      MsfrpcClient,
      MetasploitNotFoundError | MetasploitConnectionError
    > | null = null;

    const listeners = new Map<string, ListenerState>();
    const knownSessions = new Map<string, MsfSessionSnapshot>();
    const eventSubscribers = new Set<(event: MetasploitEvent) => void>();
    const listenerMissCount = new Map<string, number>();
    let pollingFiber: { interrupt: () => void } | null = null;
    let jobPollingFiber: { interrupt: () => void } | null = null;

    // ── Raw TCP Socket Lookup ───────────────────────────────────────────

    /** Find the raw TCP socket for a direct-TCP session by iterating listeners. */
    const findRawTcpSocket = (sessionId: string): import("node:net").Socket | null => {
      for (const state of listeners.values()) {
        if (state.transport === "direct-tcp" && state.tcpHandle) {
          const rawSession = state.tcpHandle.getSession(sessionId);
          if (rawSession) return rawSession.socket;
        }
      }
      return null;
    };

    // ── Event Emission ───────────────────────────────────────────────────

    const emitEvent = (event: MetasploitEvent) => {
      for (const subscriber of eventSubscribers) {
        try {
          subscriber(event);
        } catch {
          // Don't let subscriber errors propagate
        }
      }
    };

    /** Emit `connection.changed` only on transitions. */
    const emitConnectionChanged = (connected: boolean) => {
      if (lastEmittedConnected === connected) return;
      lastEmittedConnected = connected;
      emitEvent({
        type: "connection.changed",
        connected,
        version: connected ? (msfVersion ?? undefined) : undefined,
        createdAt: new Date().toISOString(),
      });
    };

    // ── Connection Guard ─────────────────────────────────────────────────

    const ensureConnected: Effect.Effect<MsfrpcClient, MetasploitConnectionError> = Effect.suspend(
      () => {
        if (!rpcClient) {
          return Effect.fail(
            new MetasploitConnectionError({ message: "Metasploit is not connected" }),
          );
        }
        return Effect.succeed(rpcClient);
      },
    );

    /** Clear all connection state — used on process exit and sustained RPC failure. */
    const clearConnectionState = () => {
      rpcClient?.dispose();
      rpcClient = null;
      cachedClient = null;
      msfVersion = null;
      stopJobPolling();
      stopSessionPolling();
      // Close all direct-tcp listeners before clearing
      for (const state of listeners.values()) {
        if (state.transport === "direct-tcp" && state.tcpHandle) {
          state.tcpHandle.close();
        }
      }
      listeners.clear();
      knownSessions.clear();
      emitConnectionChanged(false);
    };

    // ── State Hydration ──────────────────────────────────────────────────

    /**
     * One-shot rehydration of `listeners` and `knownSessions` from msfrpcd's
     * live state. Best-effort: any RPC failure short-circuits silently.
     */
    const hydrateState = (client: MsfrpcClient) =>
      Effect.gen(function* () {
        listeners.clear();
        knownSessions.clear();
        listenerMissCount.clear();

        yield* hydrateListeners(client);
        yield* hydrateSessions(client);
      });

    const hydrateListeners = (client: MsfrpcClient) =>
      Effect.gen(function* () {
        const jobsResult = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (!jobsResult || typeof jobsResult !== "object") return;

        for (const [jobIdRaw, infoRaw] of Object.entries(jobsResult as Record<string, unknown>)) {
          const jobId = String(jobIdRaw);
          const infoString = typeof infoRaw === "string" ? infoRaw : "";
          if (!infoString.includes("multi/handler")) continue;

          const detail = yield* Effect.tryPromise({
            try: () => client.call("job.info", [jobId]),
            catch: () => null,
          }).pipe(Effect.orElseSucceed(() => null));

          if (!detail || typeof detail !== "object") continue;

          const datastore = (detail as { datastore?: Record<string, unknown> }).datastore ?? {};
          const payload = String(datastore.PAYLOAD ?? "");
          const lhost = String(datastore.LHOST ?? "0.0.0.0");
          const lportRaw = datastore.LPORT;
          const lport =
            typeof lportRaw === "number"
              ? lportRaw
              : typeof lportRaw === "string"
                ? Number.parseInt(lportRaw, 10)
                : NaN;

          if (!payload || !Number.isFinite(lport)) continue;

          const payloadDecoded = Schema.decodeUnknownOption(PayloadType)(payload);
          if (payloadDecoded._tag === "None") continue;

          const listenerId = crypto.randomUUID();
          const snapshot: ListenerSnapshot = {
            listenerId,
            name: `hydrated:${payload}@${lhost}:${lport}`,
            payload: payloadDecoded.value,
            lhost,
            lport,
            status: "active",
            jobId,
            createdAt: new Date().toISOString(),
          };

          listeners.set(listenerId, { snapshot, jobId, transport: "msfrpc" });
          emitEvent({ type: "listener.created", snapshot, createdAt: new Date().toISOString() });
        }
      });

    const hydrateSessions = (client: MsfrpcClient) =>
      Effect.gen(function* () {
        const sessionsResult = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (!sessionsResult || typeof sessionsResult !== "object") return;

        for (const [sessionId, sessionData] of Object.entries(
          sessionsResult as Record<string, any>,
        )) {
          const snapshot = buildSessionSnapshot(sessionId, sessionData, listeners);
          knownSessions.set(sessionId, snapshot);
          emitEvent({ type: "session.opened", snapshot, createdAt: new Date().toISOString() });
        }
      });

    // ── Startup Lifecycle ────────────────────────────────────────────────

    /** Kill any in-flight msfrpcd process and wipe connection state. */
    const killMsfrpcd = () => {
      if (msfrpcdProcess) {
        msfrpcdProcess.kill("SIGTERM");
        msfrpcdProcess = null;
      }
      clearConnectionState();
    };

    /** Raw start: spawn msfrpcd, authenticate, fetch version. NOT cached. */
    const ensureStartedRaw = Effect.gen(function* () {
      // Kill leftover process from a previous failed start to free the port.
      killMsfrpcd();

      let processExited = false;

      const proc = yield* ptyAdapter
        .spawn({
          shell: "msfrpcd",
          args: [
            "-U",
            MSFRPC_USER,
            "-P",
            MSFRPC_PASSWORD,
            "-S",
            "-f",
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
            if (err.message.includes("ENOENT") || err.message.includes("not found")) {
              return MetasploitNotFoundError.default();
            }
            return new MetasploitConnectionError({
              message: `Failed to spawn msfrpcd: ${err.message}`,
              cause: err,
            });
          }),
        );

      msfrpcdProcess = proc;

      proc.onExit(() => {
        processExited = true;
        msfrpcdProcess = null;
        clearConnectionState();
      });

      yield* Effect.sleep(__testSeams.startupDelay);

      const client = __testSeams.createClient(MSFRPC_HOST, MSFRPC_PORT, MSFRPC_PASSWORD);

      // Auth retry that aborts early when msfrpcd exits (no point retrying a dead process).
      const authAttempt = Effect.gen(function* () {
        if (processExited) {
          return yield* new MetasploitConnectionError({
            message: "msfrpcd exited before authentication could complete",
          });
        }
        yield* Effect.tryPromise({
          try: () => client.authenticate(),
          catch: (error) =>
            new MetasploitConnectionError({
              message: `MSFRPC authentication failed: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        });
      });

      yield* Effect.retry(
        authAttempt,
        Schedule.recurs(5).pipe(Schedule.addDelay(() => Effect.succeed(Duration.seconds(2)))),
      );

      // Best-effort: fetch core.version.
      const versionResult = yield* Effect.tryPromise({
        try: () => client.call("core.version"),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      if (versionResult && typeof versionResult === "object") {
        msfVersion = String((versionResult as { version?: unknown }).version ?? "unknown");
      }

      rpcClient = client;
      cachedClient = client;
      pollFailureCount = 0;

      yield* hydrateState(client).pipe(Effect.orElseSucceed(() => undefined));

      startSessionPolling();
      startJobPolling();
      emitConnectionChanged(true);
      return client;
    });

    /**
     * Single-flight wrapper via Deferred: concurrent callers share one
     * in-flight startup. First caller runs `ensureStartedRaw`; later
     * callers `Deferred.await` the same result.
     */
    const ensureStarted: Effect.Effect<
      MsfrpcClient,
      MetasploitNotFoundError | MetasploitConnectionError
    > = Effect.gen(function* () {
      if (cachedClient) return cachedClient;

      if (startDeferred) {
        return yield* Deferred.await(startDeferred);
      }

      const deferred = yield* Deferred.make<
        MsfrpcClient,
        MetasploitNotFoundError | MetasploitConnectionError
      >();
      startDeferred = deferred;

      return yield* ensureStartedRaw.pipe(
        Effect.tap((client) =>
          Effect.sync(() => {
            cachedClient = client;
          }).pipe(Effect.andThen(Deferred.succeed(deferred, client))),
        ),
        Effect.tapError((err) =>
          Effect.sync(() => {
            // Kill the orphaned msfrpcd so the next attempt gets a clean port.
            killMsfrpcd();
          }).pipe(Effect.andThen(Deferred.fail(deferred, err))),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            startDeferred = null;
          }),
        ),
      );
    });

    // ── Session Polling ──────────────────────────────────────────────────

    const startSessionPolling = () => {
      if (pollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = yield* ensureConnected;
        const result = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        });

        if (result == null) {
          pollFailureCount += 1;
          if (pollFailureCount >= POLL_FAILURE_THRESHOLD) {
            clearConnectionState();
          }
          return;
        }
        pollFailureCount = 0;

        if (!result || typeof result !== "object") return;

        const currentSessionIds = new Set<string>();

        for (const [sessionId, sessionData] of Object.entries(result as Record<string, any>)) {
          currentSessionIds.add(sessionId);
          if (!knownSessions.has(sessionId)) {
            const snapshot = buildSessionSnapshot(sessionId, sessionData, listeners);

            if (snapshot.listenerId === null) {
              yield* Effect.logInfo(
                `[metasploit] orphan session ${sessionId} (via=${String(
                  (sessionData as any).via_exploit ?? "?",
                )}, tunnel_local=${String((sessionData as any).tunnel_local ?? "?")})`,
              );
            }

            knownSessions.set(sessionId, snapshot);
            emitEvent({ type: "session.opened", snapshot, createdAt: new Date().toISOString() });
          }
        }

        // Detect closed sessions — skip raw-TCP sessions (not tracked by msfrpc)
        for (const [sessionId] of knownSessions) {
          if (sessionId.startsWith("raw-")) continue;
          if (!currentSessionIds.has(sessionId)) {
            knownSessions.delete(sessionId);
            emitEvent({ type: "session.closed", sessionId, createdAt: new Date().toISOString() });
          }
        }
      }).pipe(Effect.orElseSucceed(() => undefined));

      const fiber = runFork(
        pollEffect.pipe(Effect.repeat(Schedule.spaced(__testSeams.sessionPollInterval))),
      );
      pollingFiber = { interrupt: () => runFork(Fiber.interrupt(fiber)) };
    };

    const stopSessionPolling = () => {
      if (pollingFiber) {
        pollingFiber.interrupt();
        pollingFiber = null;
      }
    };

    // ── Job Polling ──────────────────────────────────────────────────────

    const startJobPolling = () => {
      if (jobPollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = yield* ensureConnected;
        const result = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        });

        if (result == null || typeof result !== "object") return;

        const activeJobIds = new Set<string>(Object.keys(result as Record<string, unknown>));

        for (const [listenerId, state] of listeners) {
          // Skip direct-tcp listeners — not managed by msfrpc jobs
          if (state.transport === "direct-tcp") continue;
          if (!state.jobId) continue;

          const isActive = activeJobIds.has(state.jobId);
          const prevStatus = state.snapshot.status;
          let nextStatus: typeof prevStatus = prevStatus;

          if (isActive) {
            listenerMissCount.delete(listenerId);
            if (prevStatus === "waiting" || prevStatus === "stopped") {
              nextStatus = "active";
            }
          } else {
            if (prevStatus === "active") {
              const misses = (listenerMissCount.get(listenerId) ?? 0) + 1;
              if (misses >= JOB_MISS_THRESHOLD) {
                nextStatus = "stopped";
                listenerMissCount.delete(listenerId);
              } else {
                listenerMissCount.set(listenerId, misses);
              }
            }
          }

          if (nextStatus !== prevStatus) {
            const updatedSnapshot: ListenerSnapshot = { ...state.snapshot, status: nextStatus };
            listeners.set(listenerId, { ...state, snapshot: updatedSnapshot });
            emitEvent({
              type: "listener.updated",
              snapshot: updatedSnapshot,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }).pipe(Effect.orElseSucceed(() => undefined));

      const fiber = runFork(
        pollEffect.pipe(Effect.repeat(Schedule.spaced(__testSeams.jobPollInterval))),
      );
      jobPollingFiber = { interrupt: () => runFork(Fiber.interrupt(fiber)) };
    };

    const stopJobPolling = () => {
      if (jobPollingFiber) {
        jobPollingFiber.interrupt();
        jobPollingFiber = null;
      }
      listenerMissCount.clear();
    };

    // ── Service Methods ──────────────────────────────────────────────────

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
          stopJobPolling();
          stopSessionPolling();

          if (rpcClient) {
            rpcClient.dispose();
            rpcClient = null;
          }

          if (msfrpcdProcess) {
            msfrpcdProcess.kill("SIGTERM");
            setTimeout(() => {
              if (msfrpcdProcess) {
                msfrpcdProcess.kill("SIGKILL");
                msfrpcdProcess = null;
              }
            }, 5_000);
          }

          // Close all direct-tcp listeners
          for (const state of listeners.values()) {
            if (state.transport === "direct-tcp" && state.tcpHandle) {
              state.tcpHandle.close();
            }
          }

          listeners.clear();
          knownSessions.clear();
          msfVersion = null;
          cachedClient = null;
          startDeferred = null;
          lastEmittedConnected = null;
          pollFailureCount = 0;
          emitConnectionChanged(false);
        }),

      status: () =>
        Effect.sync(() => {
          const snapshot: MetasploitStatusSnapshot = {
            connected: rpcClient !== null,
            version: msfVersion,
            listenersCount: listeners.size,
            sessionsCount: knownSessions.size,
          };
          return snapshot;
        }),

      createListener: (input: CreateListenerInput) =>
        Effect.gen(function* () {
          const listenerId = crypto.randomUUID();

          // ── Direct TCP path — raw shell payloads (no msfrpcd needed) ───
          if (isDirectTcpPayload(input.payload)) {
            const handle = yield* Effect.tryPromise({
              try: () =>
                createRawTcpListener(listenerId, input.lhost, input.lport, {
                  onSession: (rawSession) => {
                    const sessionSnapshot: MsfSessionSnapshot = {
                      sessionId: rawSession.sessionId,
                      type: "shell",
                      info: "",
                      targetHost: rawSession.remoteAddress,
                      platform: "unknown",
                      via: input.payload,
                      listenerId,
                      openedAt: rawSession.connectedAt,
                    };
                    knownSessions.set(rawSession.sessionId, sessionSnapshot);
                    emitEvent({
                      type: "session.opened",
                      snapshot: sessionSnapshot,
                      createdAt: new Date().toISOString(),
                    });
                  },
                  onSessionClosed: (sessionId) => {
                    knownSessions.delete(sessionId);
                    emitEvent({
                      type: "session.closed",
                      sessionId,
                      createdAt: new Date().toISOString(),
                    });
                  },
                  onError: (error) => {
                    console.error(`[raw-tcp] listener ${listenerId} error:`, error);
                  },
                }),
              catch: (error) =>
                new MetasploitListenerError({
                  listenerId,
                  message: `Failed to create TCP listener: ${error instanceof Error ? error.message : String(error)}`,
                  cause: error,
                }),
            });

            const snapshot: ListenerSnapshot = {
              listenerId,
              name: input.name,
              payload: input.payload,
              lhost: input.lhost,
              lport: input.lport,
              status: "active",
              jobId: null,
              createdAt: new Date().toISOString(),
            };

            listeners.set(listenerId, {
              snapshot,
              jobId: null,
              transport: "direct-tcp",
              tcpHandle: handle,
            });
            emitEvent({ type: "listener.created", snapshot, createdAt: new Date().toISOString() });
            return snapshot;
          }

          // ── MSFRPC path — staged/meterpreter payloads ─────────────────
          const client = yield* ensureStarted;

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

          listeners.set(listenerId, { snapshot, jobId, transport: "msfrpc" });
          emitEvent({ type: "listener.created", snapshot, createdAt: new Date().toISOString() });
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

          if (listenerState.transport === "direct-tcp") {
            // Direct TCP: close the TCP server and all its sessions
            if (listenerState.tcpHandle) {
              listenerState.tcpHandle.close();
            }
          } else if (listenerState.jobId && rpcClient) {
            // MSFRPC: stop the job
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
          emitEvent({ type: "listener.stopped", listenerId, createdAt: new Date().toISOString() });
        }),

      listListeners: () =>
        Effect.sync(() => Array.from(listeners.values()).map((state) => state.snapshot)),

      listSessions: () => Effect.sync(() => Array.from(knownSessions.values())),

      sessionWrite: (sessionId: string, data: string) =>
        Effect.gen(function* () {
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          // Raw TCP path — write directly to socket
          if (sessionId.startsWith("raw-")) {
            const socket = findRawTcpSocket(sessionId);
            if (!socket) {
              return yield* new MetasploitSessionError({
                sessionId,
                message: `No TCP socket found for raw session ${sessionId}`,
              });
            }
            yield* Effect.try({
              try: () => socket.write(data),
              catch: (error) =>
                new MetasploitSessionError({
                  sessionId,
                  message: `Failed to write to raw TCP session: ${error instanceof Error ? error.message : String(error)}`,
                  cause: error,
                }),
            });
            return;
          }

          // MSFRPC path
          const client = yield* ensureConnected.pipe(
            Effect.mapError((e) => new MetasploitSessionError({ sessionId, message: e.message })),
          );
          const method =
            session.type === "meterpreter" ? "session.meterpreter_write" : "session.shell_write";

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
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          // Raw TCP sessions are push-based — no buffered reads.
          if (sessionId.startsWith("raw-")) return "";

          // MSFRPC path
          const client = yield* ensureConnected.pipe(
            Effect.mapError((e) => new MetasploitSessionError({ sessionId, message: e.message })),
          );
          const method =
            session.type === "meterpreter" ? "session.meterpreter_read" : "session.shell_read";

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
          const client = yield* ensureConnected.pipe(
            Effect.mapError((e) => new MetasploitSessionError({ sessionId, message: e.message })),
          );
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          if (session.type === "meterpreter") return session;

          // Listener lookup — strict
          if (!session.listenerId) {
            knownSessions.delete(sessionId);
            emitEvent({ type: "session.closed", sessionId, createdAt: new Date().toISOString() });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              message: `Session ${sessionId} has no associated listener; cannot upgrade orphan session.`,
            });
          }

          const listenerState = listeners.get(session.listenerId);
          if (!listenerState) {
            knownSessions.delete(sessionId);
            emitEvent({ type: "session.closed", sessionId, createdAt: new Date().toISOString() });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              listenerId: session.listenerId,
              message: `Listener ${session.listenerId} for session ${sessionId} not found.`,
            });
          }

          const lhost = listenerState.snapshot.lhost;
          const upgradePort = String(49152 + Math.floor(Math.random() * 16383));
          const preUpgradeSessionIds = new Set(knownSessions.keys());

          // Trigger upgrade
          yield* Effect.tryPromise({
            try: () => client.call("session.shell_upgrade", [sessionId, lhost, upgradePort]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to upgrade session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // Poll for new meterpreter session (up to 30s)
          const MAX_UPGRADE_ATTEMPTS = 15;

          for (let attempt = 0; attempt < MAX_UPGRADE_ATTEMPTS; attempt++) {
            yield* Effect.sleep(__testSeams.upgradeDelay);

            const result = yield* Effect.tryPromise({
              try: () => client.call("session.list"),
              catch: (error) =>
                new MetasploitSessionError({
                  sessionId,
                  message: `Failed to verify upgrade: ${error instanceof Error ? error.message : String(error)}`,
                  cause: error,
                }),
            });

            const sessionsMap = result as Record<string, any> | null;
            if (!sessionsMap) continue;

            for (const [id, data] of Object.entries(sessionsMap)) {
              if (
                (data as any).type === "meterpreter" &&
                (data as any).session_host === session.targetHost &&
                !preUpgradeSessionIds.has(id)
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

                if (id !== sessionId) {
                  knownSessions.delete(sessionId);
                  emitEvent({
                    type: "session.closed",
                    sessionId,
                    createdAt: new Date().toISOString(),
                  });
                }

                emitEvent({
                  type: "session.upgraded",
                  previousSessionId: id !== sessionId ? sessionId : undefined,
                  snapshot: upgraded,
                  createdAt: new Date().toISOString(),
                });

                return upgraded;
              }
            }
          }

          return yield* new MetasploitSessionError({
            sessionId,
            message:
              "Session upgrade timed out — no meterpreter session appeared within 30 seconds",
          });
        }),

      sessionClose: (sessionId: string) =>
        Effect.gen(function* () {
          if (!knownSessions.has(sessionId)) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          if (sessionId.startsWith("raw-")) {
            // Raw TCP: destroy the socket directly
            const socket = findRawTcpSocket(sessionId);
            if (socket && !socket.destroyed) {
              socket.destroy();
            }
          } else {
            // MSFRPC: stop via RPC
            const client = yield* ensureConnected.pipe(
              Effect.mapError((e) => new MetasploitSessionError({ sessionId, message: e.message })),
            );
            yield* Effect.tryPromise({
              try: () => client.call("session.stop", [sessionId]),
              catch: (error) =>
                new MetasploitSessionError({
                  sessionId,
                  message: `Failed to close session: ${error instanceof Error ? error.message : String(error)}`,
                  cause: error,
                }),
            });
          }

          knownSessions.delete(sessionId);
          emitEvent({ type: "session.closed", sessionId, createdAt: new Date().toISOString() });
        }),

      subscribe: (listener: (event: MetasploitEvent) => void) =>
        Effect.gen(function* () {
          eventSubscribers.add(listener);

          // Seed: deliver current connection state to new subscriber.
          yield* Effect.try({
            try: () =>
              listener({
                type: "connection.changed",
                connected: rpcClient !== null,
                version: msfVersion ?? undefined,
                createdAt: new Date().toISOString(),
              }),
            catch: () => undefined,
          }).pipe(Effect.ignore);

          return () => {
            eventSubscribers.delete(listener);
          };
        }),

      emitSessionOutput: (sessionId, data) =>
        Effect.sync(() => {
          emitEvent({
            type: "session.output",
            sessionId,
            data,
            createdAt: new Date().toISOString(),
          });
        }),

      getRawTcpSocket: (sessionId: string) => Effect.sync(() => findRawTcpSocket(sessionId)),
    } satisfies MetasploitServiceShape;
  }),
);

// ── Re-exports for backward compatibility ──────────────────────────────────

export { type MsfrpcClient } from "./msfrpcClient";
export { createMsfrpcClient } from "./msfrpcClient";
export { __testSeams } from "./constants";
export { findListenerForSession as __findListenerForSessionForTests } from "./listenerMatching";
