import { Effect, Layer } from "effect";
import {
  RawTcpListenerError,
  type RawTcpListenerId,
  type RawTcpListenerSnapshot,
  RawTcpSessionError,
  type RawTcpSessionId,
  type RawTcpSessionSnapshot,
  type RawTcpEvent,
} from "@fenrir/contracts";

import { RawTcpListenerService } from "../Services/RawTcpListenerService";
import { createRawTcpListener, type RawTcpListenerHandle } from "./RawTcpListener";
import { buildRawTcpPtyUpgradeCommand } from "./ptyUpgrade";

interface ListenerEntry {
  readonly snapshot: RawTcpListenerSnapshot;
  readonly handle: RawTcpListenerHandle;
}

export const RawTcpListenerServiceLive = Layer.effect(
  RawTcpListenerService,
  Effect.sync(() => {
    const listeners = new Map<RawTcpListenerId, ListenerEntry>();
    const sessionToListener = new Map<RawTcpSessionId, RawTcpListenerId>();
    const sessionSnapshots = new Map<RawTcpSessionId, RawTcpSessionSnapshot>();
    const subscribers = new Set<(event: RawTcpEvent) => void>();

    const resolveSession = (sessionId: RawTcpSessionId) => {
      const listenerId = sessionToListener.get(sessionId);
      const entry = listenerId ? listeners.get(listenerId) : undefined;
      return entry?.handle.getSession(sessionId);
    };

    const emit = (event: RawTcpEvent) => {
      for (const sub of subscribers) {
        try {
          sub(event);
        } catch (err) {
          console.warn("[raw-tcp] subscriber threw:", err);
        }
      }
    };

    return {
      createListener: ({ label, host, port }) =>
        Effect.tryPromise({
          try: async () => {
            const listenerId = `rtl-${crypto.randomUUID()}` as RawTcpListenerId;
            const handle = await createRawTcpListener(listenerId, host, port, {
              onSession: (session) => {
                const sessionId = session.sessionId as RawTcpSessionId;
                sessionToListener.set(sessionId, listenerId);
                const snapshot: RawTcpSessionSnapshot = {
                  sessionId,
                  listenerId,
                  remoteAddress: session.remoteAddress,
                  connectedAt: session.connectedAt,
                  terminalMode: "raw",
                };
                sessionSnapshots.set(sessionId, snapshot);
                emit({ type: "session.connected", snapshot });
                session.socket.on("data", (chunk: Buffer) => {
                  emit({
                    type: "session.data",
                    sessionId,
                    data: chunk.toString("utf8"),
                  });
                });
              },
              onSessionClosed: (sessionId) => {
                const id = sessionId as RawTcpSessionId;
                sessionToListener.delete(id);
                sessionSnapshots.delete(id);
                emit({ type: "session.closed", sessionId: id });
              },
              onError: (error) => {
                console.warn(`[raw-tcp] listener ${listenerId} error:`, error.message);
              },
            });

            const snapshot: RawTcpListenerSnapshot = {
              listenerId,
              label,
              host,
              port,
              createdAt: new Date().toISOString(),
            };
            listeners.set(listenerId, { snapshot, handle });
            emit({ type: "listener.created", snapshot });
            return snapshot;
          },
          catch: (cause) =>
            new RawTcpListenerError({
              message: cause instanceof Error ? cause.message : "Failed to create listener",
            }),
        }),

      stopListener: (listenerId) =>
        Effect.sync(() => {
          const id = listenerId as RawTcpListenerId;
          const entry = listeners.get(id);
          if (!entry) return;
          entry.handle.close();
          listeners.delete(id);
          for (const [sid, lid] of sessionToListener) {
            if (lid === id) sessionToListener.delete(sid);
          }
          emit({ type: "listener.stopped", listenerId: id });
        }),

      listListeners: () =>
        Effect.sync(() => Array.from(listeners.values()).map((entry) => entry.snapshot)),

      listSessions: () => Effect.sync(() => Array.from(sessionSnapshots.values())),

      sessionWrite: (sessionId, data) =>
        Effect.gen(function* () {
          const id = sessionId as RawTcpSessionId;
          const session = resolveSession(id);
          if (!session) {
            return yield* new RawTcpSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }
          yield* Effect.try({
            try: () => session.socket.write(data),
            catch: (err) =>
              new RawTcpSessionError({
                sessionId,
                message: err instanceof Error ? err.message : "Write failed",
              }),
          });
        }),

      sessionUpgradePty: ({ sessionId, cols, rows }) =>
        Effect.gen(function* () {
          const id = sessionId as RawTcpSessionId;
          const session = resolveSession(id);
          const existingSnapshot = sessionSnapshots.get(id);
          if (!session || !existingSnapshot) {
            return yield* new RawTcpSessionError({
              sessionId,
              message: `Session ${sessionId} not found`,
            });
          }

          const command = buildRawTcpPtyUpgradeCommand(cols, rows);
          yield* Effect.try({
            try: () => session.socket.write(command),
            catch: (err) =>
              new RawTcpSessionError({
                sessionId,
                message: err instanceof Error ? err.message : "PTY upgrade failed",
              }),
          });

          const snapshot: RawTcpSessionSnapshot = {
            ...existingSnapshot,
            terminalMode: "pty",
          };
          sessionSnapshots.set(id, snapshot);
          emit({ type: "session.updated", snapshot });
          return snapshot;
        }),

      sessionClose: (sessionId) =>
        Effect.sync(() => {
          const id = sessionId as RawTcpSessionId;
          const session = resolveSession(id);
          if (!session) return;
          session.socket.destroy();
        }),

      subscribe: (callback) =>
        Effect.sync(() => {
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        }),
    };
  }),
);
