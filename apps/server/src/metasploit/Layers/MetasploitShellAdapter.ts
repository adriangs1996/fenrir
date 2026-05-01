/**
 * MetasploitShellAdapterLive — Converts MSFRPC poll-based reads into
 * push-based callbacks for xterm.js consumption.
 *
 * - write() → MSFRPC session.shell_write / session.meterpreter_write
 * - Polling loop (serialized, adaptive) → session.shell_read → invoke onData callbacks
 * - onExit() → triggered when session disappears from session.list
 * - resize() → meterpreter: structured command; raw shell: best-effort stty
 * - close() → stops polling loop, cleanup
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

/** Delay between polls when session has no pending output (idle backoff). */
const SHELL_IDLE_POLL_MS = 50;
/** Number of consecutive read failures before we consider the session dead. */
const MAX_READ_FAILURES = 5;

// ─── PTY Upgrade ──────────────────────────────────────────────────────────

/**
 * Commands tried in order to upgrade a raw shell to a full PTY.
 * Each entry is [test, command]: test runs first; if it succeeds, command spawns the PTY.
 * Falls back through the list until one works.
 */
const PTY_UPGRADE_COMMANDS = [
  `python3 -c 'import pty; pty.spawn("/bin/bash")'`,
  `python -c 'import pty; pty.spawn("/bin/bash")'`,
  `script -qc /bin/bash /dev/null`,
];

/** Delay after sending PTY upgrade command before sending env/stty setup. */
const PTY_UPGRADE_SETTLE_MS = 800;

export const MetasploitShellAdapterLive = Layer.effect(
  MetasploitShellAdapter,
  Effect.gen(function* () {
    const metasploitService = yield* MetasploitService;
    const runFork = Effect.runForkWith(yield* Effect.services());
    const runPromise = Effect.runPromiseWith(yield* Effect.services());
    const activeProcesses = new Map<string, MsfShellProcess>();

    return {
      attach: (sessionId: string, options?: AttachOptions) =>
        Effect.gen(function* () {
          // Clean up any existing attachment for this session
          const existing = activeProcesses.get(sessionId);
          if (existing) {
            existing.close();
            activeProcesses.delete(sessionId);
          }

          // Resolve session type so resize can behave correctly per session kind.
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

          // Start polling for shell output — serialized to prevent connection pile-up.
          // Each poll waits for the previous to finish before scheduling the next.
          let pollActive = true;
          const pollLoop = async () => {
            while (pollActive && !closed) {
              let hasData = false;
              try {
                const data = await runPromise(metasploitService.sessionRead(sessionId));
                consecutiveFailures = 0; // Reset on success
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
              } catch (err) {
                consecutiveFailures++;
                console.warn(
                  `[msf-shell] sessionRead failed for ${sessionId} (${consecutiveFailures}/${MAX_READ_FAILURES}):`,
                  err instanceof Error ? err.message : String(err),
                );
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

          // ── Auto PTY upgrade for raw shell sessions ────────────────────
          // Spawns a PTY inside the reverse shell so users get tab-complete,
          // arrow keys, Ctrl+C, and editor support.
          if (sessionType === "shell") {
            const cols = options?.cols ?? 80;
            const rows = options?.rows ?? 24;
            const writeCmd = (cmd: string) =>
              runPromise(metasploitService.sessionWrite(sessionId, cmd)).catch((err) =>
                console.warn(`[msf-shell] PTY upgrade write failed:`, err),
              );

            // Fire-and-forget upgrade sequence. Wait for poll to get first data,
            // then send PTY spawn + env + stty.
            void (async () => {
              // Wait for first successful read so we know session is alive.
              await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
              if (closed) return;

              console.log(`[msf-shell] upgrading session ${sessionId} to PTY...`);

              // Try each PTY upgrade command in order
              for (const cmd of PTY_UPGRADE_COMMANDS) {
                await writeCmd(cmd + "\n");
                await new Promise((r) => setTimeout(r, PTY_UPGRADE_SETTLE_MS));
                if (closed) return;

                // Check if we got a new prompt (PTY spawned successfully).
                // Read any pending output to look for a prompt indicator.
                try {
                  const output = await runPromise(metasploitService.sessionRead(sessionId));
                  // If we got output that looks like a shell prompt, upgrade succeeded.
                  if (output && (output.includes("$") || output.includes("#") || output.includes("%"))) {
                    console.log(`[msf-shell] PTY upgrade succeeded for ${sessionId} via: ${cmd.split(" ")[0]}`);
                    // Drain this output to the terminal
                    for (const cb of dataCallbacks) {
                      try {
                        cb(output);
                      } catch {
                        // ignore
                      }
                    }
                    break;
                  }
                } catch {
                  // Read failed — try next command
                  continue;
                }
              }

              if (closed) return;

              // Set terminal environment
              await writeCmd("export TERM=xterm-256color\n");
              await new Promise((r) => setTimeout(r, 200));
              if (closed) return;
              await writeCmd(`stty rows ${rows} cols ${cols}\n`);
              await new Promise((r) => setTimeout(r, 200));
              if (closed) return;
              // Clear screen for clean start
              await writeCmd("clear\n");
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
              if (closed) {
                console.warn(`[msf-shell] write ignored: session ${sessionId} is closed`);
                return;
              }
              runFork(
                metasploitService
                  .sessionWrite(sessionId, data)
                  .pipe(
                    Effect.tapError((err) =>
                      Effect.sync(() =>
                        console.warn(
                          `[msf-shell] write failed for ${sessionId}:`,
                          err instanceof Error ? err.message : String(err),
                        ),
                      ),
                    ),
                  ),
              );
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
              // Meterpreter has no TTY — sending stty would produce error output.
              // Only send stty resize for raw shell sessions.
              if (sessionType === "meterpreter") return;
              const sttyCommand = `stty rows ${rows} cols ${cols}\n`;
              runFork(metasploitService.sessionWrite(sessionId, sttyCommand));
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

          activeProcesses.set(sessionId, shellProcess);
          return shellProcess;
        }),
    } satisfies MetasploitShellAdapterShape;
  }),
);
