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
  MetasploitListenerLookupError,
  MetasploitNotFoundError,
  MetasploitSessionError,
  type CreateListenerInput,
  type ListenerSnapshot,
  type MetasploitEvent,
  type MetasploitStatusSnapshot,
  type MsfSessionSnapshot,
} from "@fenrir/contracts";

import { PtyAdapter, type PtyProcess } from "../../terminal/Services/PTY";
import { MetasploitService, type MetasploitServiceShape } from "../Services/MetasploitService";

// ─── MSFRPC Client ──────────────────────────────────────────────────────────

export interface MsfrpcClient {
  call(method: string, params?: unknown[]): Promise<any>;
  authenticate(): Promise<void>;
  dispose(): void;
}

export function createMsfrpcClient(host: string, port: number, password: string): MsfrpcClient {
  let token: string | null = null;
  let disposed = false;

  const call = async (method: string, params: unknown[] = []): Promise<any> => {
    if (disposed) {
      throw new Error("MSFRPC client disposed");
    }
    const body = token ? [method, token, ...params] : [method, ...params];

    const response = await fetch(`http://${host}:${port}/api/`, {
      method: "POST",
      headers: { "Content-Type": "binary/message-pack" },
      body: msgpackEncode(body),
    });

    if (!response.ok) {
      throw new Error(`MSFRPC request failed: ${response.status} ${response.statusText}`);
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

// ─── Session ↔ Listener Matching ────────────────────────────────────────────

/**
 * Match a discovered session to a registered listener.
 *
 * Returns the listenerId on match, or null if no candidate qualifies.
 * Match rules:
 *   - listener.payload === session.via_exploit
 *   - listener.lport === port(session.tunnel_local) (when parseable)
 *   - listener.lhost is wildcard ("0.0.0.0" / "::" / "") OR equal to host(session.tunnel_local)
 * Tie-break: exact host match wins over wildcard match.
 */
function findListenerForSession(
  s: { via_exploit?: unknown; tunnel_local?: unknown },
  listeners: ReadonlyMap<string, { snapshot: ListenerSnapshot; jobId: string | null }>,
): string | null {
  const payload = typeof s.via_exploit === "string" ? s.via_exploit : "";
  if (!payload) return null;

  const tunnel = typeof s.tunnel_local === "string" ? s.tunnel_local : "";
  // IPv6-safe host:port split via last colon.
  const lastColon = tunnel.lastIndexOf(":");
  const sessionHost = lastColon > 0 ? tunnel.slice(0, lastColon) : "";
  const sessionPortRaw = lastColon > 0 ? tunnel.slice(lastColon + 1) : "";
  const sessionPort = sessionPortRaw === "" ? NaN : Number(sessionPortRaw);
  const havePort = Number.isFinite(sessionPort);

  const candidates: string[] = [];
  for (const [id, state] of listeners) {
    const L = state.snapshot;
    if (L.payload !== payload) continue;
    if (havePort && Number(L.lport) !== sessionPort) continue;

    const wildcard = L.lhost === "0.0.0.0" || L.lhost === "::" || L.lhost === "";
    if (!wildcard && sessionHost && L.lhost !== sessionHost) continue;

    candidates.push(id);
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Multiple candidates — prefer exact host match.
  const exact = candidates.find((id) => listeners.get(id)?.snapshot.lhost === sessionHost);
  return exact ?? candidates[0]!;
}

// ─── Layer ──────────────────────────────────────────────────────────────────

const MSFRPC_HOST = "127.0.0.1";
const MSFRPC_PORT = 55553;
const MSFRPC_USER = "msf";
const MSFRPC_PASSWORD = "fenrir";
const SESSION_POLL_INTERVAL = "2 seconds";

/** @internal Mutable test seam — tests override properties to inject fakes. Reset in afterEach. */
export const __testSeams: {
  createClient: typeof createMsfrpcClient;
  startupDelay: Duration.Input;
  upgradeDelay: Duration.Input;
  sessionPollInterval: Duration.Input;
  jobPollInterval: Duration.Input;
} = {
  createClient: createMsfrpcClient,
  startupDelay: "3 seconds",
  upgradeDelay: "5 seconds",
  sessionPollInterval: SESSION_POLL_INTERVAL,
  jobPollInterval: "2 seconds",
};

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
    let jobPollingFiber: { interrupt: () => void } | null = null;
    /** Per-listener consecutive-miss counter for debounce. */
    const listenerMissCount = new Map<string, number>();
    const JOB_POLL_INTERVAL = "2 seconds";
    const JOB_MISS_THRESHOLD = 2;

    // Connection tracking state
    let msfVersion: string | null = null;
    let lastEmittedConnected: boolean | null = null;
    let pollFailureCount = 0;
    let cachedClient: MsfrpcClient | null = null;
    let inFlightStart: Effect.Effect<
      MsfrpcClient,
      MetasploitNotFoundError | MetasploitConnectionError
    > | null = null;
    const POLL_FAILURE_THRESHOLD = 3;

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

    const ensureConnected = (): MsfrpcClient => {
      if (!rpcClient) {
        throw new MetasploitConnectionError({
          message: "Metasploit is not connected",
        });
      }
      return rpcClient;
    };

    /**
     * One-shot rehydration of `listeners` and `knownSessions` from msfrpcd's
     * live state. Best-effort: any RPC failure short-circuits silently; an
     * empty rehydration is an acceptable initial state.
     *
     * Must be called with `rpcClient` set (i.e. inside `ensureStartedRaw`
     * after authentication succeeds, before polling fibers start).
     */
    const hydrateState = (client: MsfrpcClient) =>
      Effect.gen(function* () {
        // Wipe stale in-memory state — fresh msfrpcd has fresh truth.
        listeners.clear();
        knownSessions.clear();
        listenerMissCount.clear();

        // ── Hydrate listeners from job.list + job.info ──────────────
        const jobsResult = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (jobsResult && typeof jobsResult === "object") {
          for (const [jobIdRaw, infoRaw] of Object.entries(jobsResult as Record<string, unknown>)) {
            const jobId = String(jobIdRaw);
            const infoString = typeof infoRaw === "string" ? infoRaw : "";
            if (!infoString.includes("multi/handler")) continue;

            // Per-job structured info call.
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

            const listenerId = crypto.randomUUID();
            const snapshot: ListenerSnapshot = {
              listenerId,
              name: `hydrated:${payload}@${lhost}:${lport}`,
              payload: payload as ListenerSnapshot["payload"],
              lhost,
              lport,
              status: "active", // job exists, so active by definition
              jobId,
              createdAt: new Date().toISOString(),
            };

            listeners.set(listenerId, { snapshot, jobId });
            emitEvent({
              type: "listener.created",
              snapshot,
              createdAt: new Date().toISOString(),
            });
          }
        }

        // ── Hydrate sessions from session.list ──────────────────────
        const sessionsResult = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null));

        if (sessionsResult && typeof sessionsResult === "object") {
          for (const [sessionId, sessionData] of Object.entries(
            sessionsResult as Record<string, any>,
          )) {
            const matchedListenerId = findListenerForSession(
              sessionData as { via_exploit?: unknown; tunnel_local?: unknown },
              listeners,
            );

            const snapshot: MsfSessionSnapshot = {
              sessionId,
              type: (sessionData as any).type === "meterpreter" ? "meterpreter" : "shell",
              info: String((sessionData as any).info ?? ""),
              targetHost: String((sessionData as any).session_host ?? "unknown"),
              platform: String((sessionData as any).platform ?? "unknown"),
              via: String((sessionData as any).via_exploit ?? ""),
              listenerId: matchedListenerId,
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
      });

    /** Raw start: spawn msfrpcd, authenticate, fetch version. NOT cached. */
    const ensureStartedRaw = Effect.gen(function* () {
      // Spawn msfrpcd
      const proc = yield* ptyAdapter
        .spawn({
          shell: "msfrpcd",
          args: ["-P", MSFRPC_PASSWORD, "-S", "-a", MSFRPC_HOST, "-p", String(MSFRPC_PORT)],
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

      // Hook process exit → mark disconnected.
      proc.onExit(() => {
        rpcClient?.dispose();
        rpcClient = null;
        cachedClient = null;
        msfrpcdProcess = null;
        msfVersion = null;
        stopJobPolling();
        stopSessionPolling();
        emitConnectionChanged(false);
        // Clear in-memory listener/session maps — fresh msfrpcd will have fresh state.
        listeners.clear();
        knownSessions.clear();
      });

      yield* Effect.sleep(__testSeams.startupDelay);

      const client = __testSeams.createClient(MSFRPC_HOST, MSFRPC_PORT, MSFRPC_PASSWORD);

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

      // Hydrate from msfrpcd live state (best-effort).
      yield* hydrateState(client).pipe(Effect.orElseSucceed(() => undefined));

      startSessionPolling();
      startJobPolling();
      emitConnectionChanged(true);
      return client;
    });

    /**
     * Single-flight wrapper: concurrent callers share one in-flight Effect.
     * Caches success forever (until disconnect invalidates `cachedClient`).
     * On failure, cached entry cleared so next caller retries.
     */
    const ensureStarted = Effect.suspend(() => {
      if (cachedClient) return Effect.succeed(cachedClient);
      if (inFlightStart) return inFlightStart;
      const flight = ensureStartedRaw.pipe(
        Effect.tap((client) =>
          Effect.sync(() => {
            cachedClient = client;
          }),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            cachedClient = null;
            inFlightStart = null;
            emitConnectionChanged(false);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            inFlightStart = null;
          }),
        ),
      );
      inFlightStart = flight;
      return flight;
    });

    const startSessionPolling = () => {
      if (pollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = ensureConnected();
        const result = yield* Effect.tryPromise({
          try: () => client.call("session.list"),
          catch: () => null,
        });

        if (result == null) {
          pollFailureCount += 1;
          if (pollFailureCount >= POLL_FAILURE_THRESHOLD) {
            // Sustained RPC failure → declare disconnected.
            rpcClient?.dispose();
            rpcClient = null;
            cachedClient = null;
            msfVersion = null;
            emitConnectionChanged(false);
            stopJobPolling();
            stopSessionPolling();
            listeners.clear();
            knownSessions.clear();
          }
          return;
        }
        pollFailureCount = 0; // reset on success

        const currentSessionIds = new Set<string>();

        if (result && typeof result === "object") {
          for (const [sessionId, sessionData] of Object.entries(result as Record<string, any>)) {
            currentSessionIds.add(sessionId);
            if (!knownSessions.has(sessionId)) {
              const matchedListenerId = findListenerForSession(
                sessionData as { via_exploit?: unknown; tunnel_local?: unknown },
                listeners,
              );

              if (matchedListenerId === null) {
                yield* Effect.logInfo(
                  `[metasploit] orphan session ${sessionId} (via=${String(
                    (sessionData as any).via_exploit ?? "?",
                  )}, tunnel_local=${String((sessionData as any).tunnel_local ?? "?")})`,
                );
              }

              const snapshot: MsfSessionSnapshot = {
                sessionId,
                type: (sessionData as any).type === "meterpreter" ? "meterpreter" : "shell",
                info: String((sessionData as any).info ?? ""),
                targetHost: String((sessionData as any).session_host ?? "unknown"),
                platform: String((sessionData as any).platform ?? "unknown"),
                via: String((sessionData as any).via_exploit ?? ""),
                listenerId: matchedListenerId,
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

      const pollingSchedule = Schedule.spaced(__testSeams.sessionPollInterval);
      const fiber = runFork(pollEffect.pipe(Effect.repeat(pollingSchedule)));
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

    const startJobPolling = () => {
      if (jobPollingFiber) return;

      const pollEffect = Effect.gen(function* () {
        const client = ensureConnected();
        const result = yield* Effect.tryPromise({
          try: () => client.call("job.list"),
          catch: () => null,
        });

        if (result == null) return; // RPC failure — session poll handles disconnect.
        if (typeof result !== "object") return;

        // job.list returns: { "<jobId>": "<info string>", ... }
        const activeJobIds = new Set<string>(Object.keys(result as Record<string, unknown>));

        for (const [listenerId, state] of listeners) {
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
            // Job missing — debounce.
            if (prevStatus === "active") {
              const misses = (listenerMissCount.get(listenerId) ?? 0) + 1;
              if (misses >= JOB_MISS_THRESHOLD) {
                nextStatus = "stopped";
                listenerMissCount.delete(listenerId);
              } else {
                listenerMissCount.set(listenerId, misses);
              }
            }
            // prevStatus === "waiting" with job missing: leave as waiting.
            // Don't auto-flip to stopped — the job may not be registered yet.
          }

          if (nextStatus !== prevStatus) {
            const updatedSnapshot: ListenerSnapshot = {
              ...state.snapshot,
              status: nextStatus,
            };
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
      jobPollingFiber = {
        interrupt: () => runFork(Fiber.interrupt(fiber)),
      };
    };

    const stopJobPolling = () => {
      if (jobPollingFiber) {
        jobPollingFiber.interrupt();
        jobPollingFiber = null;
      }
      listenerMissCount.clear();
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
          stopJobPolling();
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

          msfVersion = null;
          cachedClient = null;
          inFlightStart = null;
          lastEmittedConnected = null;
          pollFailureCount = 0;
          emitConnectionChanged(false);
        }),

      status: () =>
        Effect.gen(function* () {
          // Auto-start: best-effort, swallow not-found / connection errors so status
          // can be queried even when msfrpcd is unavailable (UI shows "Disconnected").
          yield* ensureStarted.pipe(Effect.orElseSucceed(() => null));

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
          try: () => Array.from(listeners.values()).map((state) => state.snapshot),
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
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

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
          const client = ensureConnected();
          const session = knownSessions.get(sessionId);
          if (!session) {
            return yield* new MetasploitSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          if (session.type === "meterpreter") {
            return session; // Already upgraded.
          }

          // ── Listener lookup — strict (Q5/Q5b) ────────────────────────
          if (!session.listenerId) {
            // Orphan session — can't upgrade. Drop it from UI so the user
            // gets clear feedback (button disappears with the session).
            knownSessions.delete(sessionId);
            emitEvent({
              type: "session.closed",
              sessionId,
              createdAt: new Date().toISOString(),
            });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              message: `Session ${sessionId} has no associated listener; cannot upgrade orphan session.`,
            });
          }

          const listenerState = listeners.get(session.listenerId);
          if (!listenerState) {
            // listenerId set but listener removed (e.g. stopped). Drop session same as orphan.
            knownSessions.delete(sessionId);
            emitEvent({
              type: "session.closed",
              sessionId,
              createdAt: new Date().toISOString(),
            });
            return yield* new MetasploitListenerLookupError({
              sessionId,
              listenerId: session.listenerId,
              message: `Listener ${session.listenerId} for session ${sessionId} not found.`,
            });
          }

          const lhost = listenerState.snapshot.lhost;
          const lport = String(listenerState.snapshot.lport);

          // ── Trigger upgrade ──────────────────────────────────────────
          yield* Effect.tryPromise({
            try: () => client.call("session.shell_upgrade", [sessionId, lhost, lport]),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to upgrade session: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // ── Wait for upgrade to complete ─────────────────────────────
          yield* Effect.sleep(__testSeams.upgradeDelay);

          // ── Verify by re-listing sessions ────────────────────────────
          const result = yield* Effect.tryPromise({
            try: () => client.call("session.list"),
            catch: (error) =>
              new MetasploitSessionError({
                sessionId,
                message: `Failed to verify upgrade: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              }),
          });

          // Find the new meterpreter session.
          const sessionsMap = result as Record<string, any> | null;
          if (sessionsMap) {
            for (const [id, data] of Object.entries(sessionsMap)) {
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

                // Emit session.closed for the OLD id BEFORE session.upgraded.
                // Backstop: store also handles previousSessionId on the upgraded event.
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
        Effect.gen(function* () {
          // Auto-start (best-effort) so subscribers see live data even on first connect.
          yield* ensureStarted.pipe(Effect.orElseSucceed(() => null));

          eventSubscribers.add(listener);

          // Seed: deliver current connection state to new subscriber as one-shot.
          // Bypasses transitions-only filter for this subscriber only.
          try {
            listener({
              type: "connection.changed",
              connected: rpcClient !== null,
              version: msfVersion ?? undefined,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // Ignore subscriber errors during seed.
          }

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
    } satisfies MetasploitServiceShape;
  }),
);

// Test-only export.
export { findListenerForSession as __findListenerForSessionForTests };
