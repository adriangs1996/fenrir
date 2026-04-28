/**
 * MetasploitShellAdapterLive — Converts MSFRPC poll-based reads into
 * push-based callbacks for xterm.js consumption.
 *
 * - write() → MSFRPC session.shell_write / session.meterpreter_write
 * - Polling loop (~100ms) → session.shell_read → invoke onData callbacks
 * - onExit() → triggered when session disappears from session.list
 * - resize() → meterpreter: structured command; raw shell: best-effort stty
 * - close() → clears polling interval, cleanup
 */
import { Effect, Layer } from "effect";
import { MetasploitSessionError } from "@fenrir/contracts";

import { MetasploitService } from "../Services/MetasploitService";
import {
  MetasploitShellAdapter,
  type MetasploitShellAdapterShape,
  type MsfShellProcess,
} from "../Services/MetasploitShellAdapter";

const SHELL_POLL_INTERVAL_MS = 100;

export const MetasploitShellAdapterLive = Layer.effect(
  MetasploitShellAdapter,
  Effect.gen(function* () {
    const metasploitService = yield* MetasploitService;
    const runFork = Effect.runForkWith(yield* Effect.services());
    const runPromise = Effect.runPromiseWith(yield* Effect.services());
    const activeProcesses = new Map<string, MsfShellProcess>();

    return {
      attach: (sessionId: string) =>
        Effect.gen(function* () {
          // Clean up any existing attachment for this session
          const existing = activeProcesses.get(sessionId);
          if (existing) {
            existing.close();
            activeProcesses.delete(sessionId);
          }

          const dataCallbacks = new Set<(data: string) => void>();
          const exitCallbacks = new Set<() => void>();
          let pollTimer: ReturnType<typeof setInterval> | null = null;
          let closed = false;

          // Start polling for shell output
          pollTimer = setInterval(async () => {
            if (closed) return;
            try {
              const data = await runPromise(metasploitService.sessionRead(sessionId));
              if (data && data.length > 0) {
                for (const cb of dataCallbacks) {
                  try {
                    cb(data);
                  } catch {
                    // Don't let callback errors break polling
                  }
                }
              }
            } catch {
              // Session may have closed — trigger exit
              if (!closed) {
                closed = true;
                if (pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
                for (const cb of exitCallbacks) {
                  try {
                    cb();
                  } catch {
                    // Swallow callback errors
                  }
                }
                activeProcesses.delete(sessionId);
              }
            }
          }, SHELL_POLL_INTERVAL_MS);

          // Subscribe to metasploit events to detect session close
          const unsubscribe = yield* metasploitService.subscribe((event) => {
            if (event.type === "session.closed" && event.sessionId === sessionId) {
              if (!closed) {
                closed = true;
                if (pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
                for (const cb of exitCallbacks) {
                  try {
                    cb();
                  } catch {
                    // Swallow callback errors
                  }
                }
                activeProcesses.delete(sessionId);
              }
            }
          });

          const shellProcess: MsfShellProcess = {
            sessionId,

            write(data: string) {
              if (closed) return;
              runFork(metasploitService.sessionWrite(sessionId, data));
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
              if (closed) return;
              // Best-effort resize: send stty for raw shells,
              // structured command for meterpreter
              const sttyCommand = `stty rows ${rows} cols ${cols}\n`;
              runFork(metasploitService.sessionWrite(sessionId, sttyCommand));
            },

            close() {
              if (closed) return;
              closed = true;
              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
              unsubscribe();
              dataCallbacks.clear();
              exitCallbacks.clear();
              activeProcesses.delete(sessionId);
            },
          };

          activeProcesses.set(sessionId, shellProcess);
          return shellProcess;
        }),
    } satisfies MetasploitShellAdapterShape;
  }),
);
