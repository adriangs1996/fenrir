/**
 * MetasploitShellAdapterLive — Bridges shell I/O into push-based callbacks
 * for xterm.js consumption. Two transport paths:
 *
 * 1. **Raw TCP** (direct-tcp sessions): Zero-overhead socket streaming.
 *    socket.on('data') → onData callbacks; write() → socket.write().
 *    No polling, no HTTP, no msgpack — true bidirectional streaming.
 *
 * 2. **MSFRPC** (staged/meterpreter sessions): Serialized adaptive polling.
 *    Dedicated HTTP client → session.shell_read/write. 0ms delay when data
 *    flowing, 50ms idle backoff.
 */
import { Effect, Layer } from "effect";
import { MetasploitSessionError } from "@fenrir/contracts";

import { MetasploitService } from "../Services/MetasploitService";
import {
  MetasploitShellAdapter,
  type AttachOptions,
  type MetasploitShellAdapterShape,
  type MsfShellProcess,
} from "../Services/MetasploitShellAdapter";
import { createMsfrpcClient, type MsfrpcClient } from "./msfrpcClient";
import { MSFRPC_HOST, MSFRPC_PORT, MSFRPC_PASSWORD } from "./constants";

/** Delay between polls when session has no pending output (idle backoff). */
const SHELL_IDLE_POLL_MS = 50;
/** Number of consecutive read failures before we consider the session dead. */
const MAX_READ_FAILURES = 5;

// ─── PTY Upgrade ──────────────────────────────────────────────────────────

/**
 * Single command to upgrade a raw shell to a full PTY.
 * Uses `||` so only the first available python runs — no nested PTYs.
 */
const PTY_UPGRADE_CMD = `python3 -c 'import pty; pty.spawn("/bin/bash")' 2>/dev/null || python -c 'import pty; pty.spawn("/bin/bash")' 2>/dev/null`;

/** Delay after sending PTY upgrade command before sending env/stty setup. */
const PTY_UPGRADE_SETTLE_MS = 800;

export const MetasploitShellAdapterLive = Layer.effect(
  MetasploitShellAdapter,
  Effect.gen(function* () {
    const metasploitService = yield* MetasploitService;
    const activeProcesses = new Map<string, MsfShellProcess>();

    // ── Dedicated MSFRPC client for shell I/O ───────────────────────
    // Separate HTTP connection so shell reads don't queue behind
    // session.list / job.list management polls on msfrpcd's
    // single-threaded Ruby server.
    let shellClient: MsfrpcClient | null = null;

    const ensureShellClient = async (): Promise<MsfrpcClient> => {
      if (shellClient) return shellClient;
      const client = createMsfrpcClient(MSFRPC_HOST, MSFRPC_PORT, MSFRPC_PASSWORD);
      await client.authenticate();
      shellClient = client;
      console.log("[msf-shell] dedicated MSFRPC client authenticated");
      return client;
    };

    /** Direct shell read — bypasses Effect/Service overhead. */
    const directRead = async (client: MsfrpcClient, sessionId: string): Promise<string> => {
      const result = await client.call("session.shell_read", [sessionId]);
      return String(result?.data ?? "");
    };

    /** Direct shell write — bypasses Effect/Service overhead. */
    const directWrite = async (
      client: MsfrpcClient,
      sessionId: string,
      data: string,
    ): Promise<void> => {
      await client.call("session.shell_write", [sessionId, data]);
    };

    // ─── Raw TCP Attach ────────────────────────────────────────────────
    // Direct socket I/O — zero polling, zero HTTP overhead.

    const attachRawTcp = (
      sessionId: string,
      socket: import("node:net").Socket,
      options: AttachOptions | undefined,
    ): MsfShellProcess => {
      const dataCallbacks = new Set<(data: string) => void>();
      const exitCallbacks = new Set<() => void>();
      let closed = false;

      const triggerExit = () => {
        if (closed) return;
        closed = true;
        for (const cb of exitCallbacks) {
          try {
            cb();
          } catch {
            // Swallow callback errors
          }
        }
        activeProcesses.delete(sessionId);
      };

      // Wire socket data → onData callbacks (true streaming, no polling)
      const onSocketData = (buf: Buffer) => {
        if (closed) return;
        const text = buf.toString("utf-8");
        for (const cb of dataCallbacks) {
          try {
            cb(text);
          } catch {
            // Don't let callback errors break the stream
          }
        }
      };
      socket.on("data", onSocketData);
      socket.on("close", triggerExit);
      socket.on("error", () => triggerExit());

      // Auto PTY upgrade
      const cols = options?.cols ?? 80;
      const rows = options?.rows ?? 24;
      void (async () => {
        await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
        if (closed) return;

        console.log(`[raw-tcp] upgrading session ${sessionId} to PTY...`);
        socket.write(PTY_UPGRADE_CMD + "\n");
        await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
        if (closed) return;

        socket.write("export TERM=xterm-256color\n");
        await new Promise((r) => setTimeout(r, 200));
        if (closed) return;
        socket.write(`stty rows ${rows} cols ${cols}\n`);
        await new Promise((r) => setTimeout(r, 200));
        if (closed) return;
        socket.write("clear\n");
        console.log(`[raw-tcp] PTY upgrade complete for ${sessionId}`);
      })();

      return {
        sessionId,

        write(data: string) {
          if (closed || socket.destroyed) return;
          socket.write(data);
        },

        onData(callback: (data: string) => void) {
          dataCallbacks.add(callback);
          return () => {
            dataCallbacks.delete(callback);
          };
        },

        onExit(callback: () => void) {
          exitCallbacks.add(callback);
          return () => {
            exitCallbacks.delete(callback);
          };
        },

        resize(cols: number, rows: number) {
          if (closed || socket.destroyed) return;
          socket.write(`stty rows ${rows} cols ${cols}\n`);
        },

        close() {
          if (closed) return;
          closed = true;
          socket.removeListener("data", onSocketData);
          dataCallbacks.clear();
          exitCallbacks.clear();
          activeProcesses.delete(sessionId);
        },
      };
    };

    // ─── MSFRPC Attach ─────────────────────────────────────────────────
    // Adaptive polling via dedicated HTTP client.

    const attachMsfrpc = function* (
      sessionId: string,
      sessionType: "shell" | "meterpreter",
      options: AttachOptions | undefined,
    ) {
      const dataCallbacks = new Set<(data: string) => void>();
      const exitCallbacks = new Set<() => void>();
      let closed = false;
      let consecutiveFailures = 0;

      const triggerExit = () => {
        if (closed) return;
        closed = true;
        for (const cb of exitCallbacks) {
          try {
            cb();
          } catch {
            // Swallow callback errors
          }
        }
        activeProcesses.delete(sessionId);
      };

      // Serialized adaptive polling loop
      let pollActive = true;
      const pollLoop = async () => {
        let client: MsfrpcClient;
        try {
          client = await ensureShellClient();
        } catch (err) {
          console.warn(`[msf-shell] failed to create shell client:`, err);
          triggerExit();
          return;
        }

        while (pollActive && !closed) {
          let hasData = false;
          try {
            const data = await directRead(client, sessionId);
            consecutiveFailures = 0;
            hasData = !!(data && data.length > 0);
            if (hasData) {
              for (const cb of dataCallbacks) {
                try {
                  cb(data);
                } catch {
                  // Don't let callback errors break polling
                }
              }
            }
          } catch {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_READ_FAILURES) {
              console.warn(
                `[msf-shell] session ${sessionId} exceeded failure threshold — marking closed`,
              );
              triggerExit();
              return;
            }
          }
          // No delay when data is flowing — immediate next read.
          // Small idle backoff when empty to avoid busy-spinning.
          if (!hasData) {
            await new Promise((r) => setTimeout(r, SHELL_IDLE_POLL_MS));
          }
        }
      };
      void pollLoop();

      // Auto PTY upgrade for raw shell sessions
      if (sessionType === "shell") {
        const cols = options?.cols ?? 80;
        const rows = options?.rows ?? 24;

        void (async () => {
          let client: MsfrpcClient;
          try {
            client = await ensureShellClient();
          } catch {
            return;
          }

          await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
          if (closed) return;

          console.log(`[msf-shell] upgrading session ${sessionId} to PTY...`);
          await directWrite(client, sessionId, PTY_UPGRADE_CMD + "\n").catch(() => {});
          await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
          if (closed) return;

          await directWrite(client, sessionId, "export TERM=xterm-256color\n").catch(() => {});
          await new Promise((r) => setTimeout(r, 200));
          if (closed) return;
          await directWrite(client, sessionId, `stty rows ${rows} cols ${cols}\n`).catch(() => {});
          await new Promise((r) => setTimeout(r, 200));
          if (closed) return;
          await directWrite(client, sessionId, "clear\n").catch(() => {});
          console.log(`[msf-shell] PTY upgrade complete for ${sessionId}`);
        })();
      }

      // Subscribe to metasploit events to detect session close
      const unsubscribe = yield* metasploitService.subscribe((event) => {
        if (event.type === "session.closed" && event.sessionId === sessionId) {
          triggerExit();
        }
      });

      const shellProcess: MsfShellProcess = {
        sessionId,

        write(data: string) {
          if (closed) return;
          if (shellClient) {
            directWrite(shellClient, sessionId, data).catch((err) =>
              console.warn(`[msf-shell] write failed for ${sessionId}:`, err),
            );
          }
        },

        onData(callback: (data: string) => void) {
          dataCallbacks.add(callback);
          return () => {
            dataCallbacks.delete(callback);
          };
        },

        onExit(callback: () => void) {
          exitCallbacks.add(callback);
          return () => {
            exitCallbacks.delete(callback);
          };
        },

        resize(cols: number, rows: number) {
          if (closed || sessionType === "meterpreter" || !shellClient) return;
          const sttyCommand = `stty rows ${rows} cols ${cols}\n`;
          directWrite(shellClient, sessionId, sttyCommand).catch(() => {});
        },

        close() {
          if (closed) return;
          closed = true;
          pollActive = false;
          unsubscribe();
          dataCallbacks.clear();
          exitCallbacks.clear();
          activeProcesses.delete(sessionId);
        },
      };

      return shellProcess;
    };

    return {
      attach: (sessionId: string, options?: AttachOptions) =>
        Effect.gen(function* () {
          // Clean up any existing attachment for this session
          const existing = activeProcesses.get(sessionId);
          if (existing) {
            existing.close();
            activeProcesses.delete(sessionId);
          }

          // ── Try raw TCP path first ────────────────────────────────────
          // If getRawTcpSocket returns a socket, this is a direct-tcp session.
          // Wire socket I/O directly — zero polling, zero HTTP.
          const rawSocket = yield* metasploitService.getRawTcpSocket(sessionId);
          if (rawSocket) {
            console.log(`[msf-shell] attaching raw TCP socket for ${sessionId}`);
            const proc = attachRawTcp(sessionId, rawSocket, options);
            activeProcesses.set(sessionId, proc);
            return proc;
          }

          // ── MSFRPC path ───────────────────────────────────────────────
          const sessions = yield* metasploitService.listSessions().pipe(
            Effect.mapError(
              () =>
                new MetasploitSessionError({
                  sessionId,
                  message: "Failed to query session type for attach",
                }),
            ),
          );
          const sessionType = sessions.find((s) => s.sessionId === sessionId)?.type ?? "shell";

          const proc = yield* attachMsfrpc(sessionId, sessionType, options);
          activeProcesses.set(sessionId, proc);
          return proc;
        }),
    } satisfies MetasploitShellAdapterShape;
  }),
);
