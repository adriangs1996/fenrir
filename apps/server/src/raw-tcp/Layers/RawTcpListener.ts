/**
 * RawTcpListener — Direct TCP server for raw reverse shell sessions.
 *
 * Bypasses msfrpcd entirely: we own the socket, so shell I/O has zero
 * HTTP overhead. Used for non-staged payloads like cmd/unix/reverse_bash.
 */
import * as net from "node:net";

// ─── Types ────────────────────────────────────────────────────────────────

export interface RawTcpSession {
  readonly sessionId: string;
  readonly socket: net.Socket;
  readonly remoteAddress: string;
  readonly connectedAt: string;
}

export interface RawTcpListenerHandle {
  readonly listenerId: string;
  readonly port: number;
  readonly host: string;
  /** Get a connected session's socket by sessionId. */
  getSession(sessionId: string): RawTcpSession | undefined;
  /** All active sessions. */
  getSessions(): ReadonlyMap<string, RawTcpSession>;
  /** Close the TCP server and all connections. */
  close(): void;
}

export interface RawTcpListenerCallbacks {
  onSession: (session: RawTcpSession) => void;
  onSessionClosed: (sessionId: string) => void;
  onError: (error: Error) => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createRawTcpListener(
  listenerId: string,
  host: string,
  port: number,
  callbacks: RawTcpListenerCallbacks,
): Promise<RawTcpListenerHandle> {
  return new Promise((resolve, reject) => {
    const sessions = new Map<string, RawTcpSession>();
    let counter = 0;
    let closed = false;

    const server = net.createServer((socket) => {
      if (closed) {
        socket.destroy();
        return;
      }

      const sessionId = `raw-${listenerId.slice(0, 8)}-${++counter}`;
      const remoteAddress = socket.remoteAddress ?? "unknown";
      const session: RawTcpSession = {
        sessionId,
        socket,
        remoteAddress,
        connectedAt: new Date().toISOString(),
      };

      sessions.set(sessionId, session);
      console.log(`[raw-tcp] session ${sessionId} connected from ${remoteAddress}`);
      callbacks.onSession(session);

      const cleanup = () => {
        if (!sessions.has(sessionId)) return; // Already cleaned up
        sessions.delete(sessionId);
        console.log(`[raw-tcp] session ${sessionId} disconnected`);
        callbacks.onSessionClosed(sessionId);
      };

      socket.on("close", cleanup);
      socket.on("error", (err) => {
        console.warn(`[raw-tcp] session ${sessionId} error:`, err.message);
        cleanup();
      });
    });

    server.on("error", (err) => {
      if (!closed) {
        callbacks.onError(err);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      console.log(`[raw-tcp] listener ${listenerId} listening on ${host}:${port}`);
      resolve({
        listenerId,
        port,
        host,
        getSession: (id) => sessions.get(id),
        getSessions: () => sessions,
        close: () => {
          if (closed) return;
          closed = true;
          // Close all active sessions
          for (const [id, session] of sessions) {
            if (!session.socket.destroyed) {
              session.socket.destroy();
            }
            sessions.delete(id);
            callbacks.onSessionClosed(id);
          }
          server.close();
          console.log(`[raw-tcp] listener ${listenerId} closed`);
        },
      });
    });
  });
}
