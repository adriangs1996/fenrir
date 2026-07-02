/**
 * TmuxExecutor — Spawns managed processes inside tmux windows.
 *
 * Each managed-process instance runs as a tmux **window** inside a per-project
 * tmux session (`fenrir-mp-{projectId}`). The window keeps running when Fenrir
 * exits; on restart, the manager re-attaches via `reattach()`.
 *
 * Output capture: a FIFO pipe per instance, fed by `tmux pipe-pane`, read by
 * a Node readable stream that emits `onData` events.
 *
 * Exit detection: `remain-on-exit on` keeps the pane alive after the command
 * finishes so we can read `pane_dead_status`. A poll loop detects exit.
 *
 * Instance ID convention: `{projectId}/{windowSuffix}`. The projectId determines
 * the tmux session; the full instanceId derives the window name.
 *
 * @module ManagedProcess/Layers/TmuxExecutor
 */
import * as nodeFs from "node:fs";
import nodePath from "node:path";
import { execFileSync } from "node:child_process";

import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  checkTmuxSync,
  execTmuxSync,
  makeTmuxSessionName,
  MANAGED_PROCESS_TMUX_SESSION_PREFIX,
  tmuxTarget,
} from "../../terminal/tmuxRuntime.ts";
import { Executor, ExecutorError } from "../Services/Executor.ts";
import type { ExecutorHandle, ExecutorSpawnInput } from "../Services/Executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse instanceId into projectId and a sanitized FIFO-safe name.
 * Convention: `{projectId}/{rest}` — if no `/`, use full id for both.
 */
function parseInstanceId(instanceId: string): { projectId: string; fifoName: string } {
  const slashIdx = instanceId.indexOf("/");
  const projectId = slashIdx >= 0 ? instanceId.slice(0, slashIdx) : instanceId;
  const fifoName = instanceId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return { projectId, fifoName };
}

/**
 * Run a tmux command synchronously and return stdout (trimmed).
 * Throws on non-zero exit.
 */
function tmuxExec(args: readonly string[]): string {
  return execTmuxSync(args);
}

/**
 * Run a tmux command synchronously, returning `true` on exit 0.
 */
function tmuxCheck(args: readonly string[]): boolean {
  return checkTmuxSync(args);
}

/**
 * Directory for FIFOs belonging to a project.
 */
function fifoDir(stateDir: string, projectId: string): string {
  return nodePath.join(stateDir, "managed-process", projectId, ".fifo");
}

/**
 * Create the FIFO path for an instance, ensuring parent dir exists.
 */
function createFifo(stateDir: string, projectId: string, fifoName: string): string {
  const dir = fifoDir(stateDir, projectId);
  nodeFs.mkdirSync(dir, { recursive: true });
  const fifoPath = nodePath.join(dir, fifoName);

  // Remove stale FIFO if present
  try {
    nodeFs.unlinkSync(fifoPath);
  } catch {
    // not there — fine
  }

  execFileSync("mkfifo", [fifoPath], { stdio: "ignore", timeout: 5_000 });
  return fifoPath;
}

/**
 * Safely unlink a FIFO path, ignoring errors.
 */
function unlinkFifo(fifoPath: string): void {
  try {
    nodeFs.unlinkSync(fifoPath);
  } catch {
    // already gone — fine
  }
}

/**
 * Cancel any pipe-pane command attached to a pane.
 */
function stopPipePane(target: string): void {
  try {
    tmuxExec(["pipe-pane", "-t", target]);
  } catch {
    // window/pane already gone or no pipe attached — fine
  }
}

function pipePaneWriterPids(fifoPath: string): number[] {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return output.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      const pidText = match?.[1];
      const command = match?.[2];
      if (!pidText || !command || !command.includes(fifoPath)) return [];
      const pid = Number(pidText);
      return pid === process.pid || Number.isNaN(pid) ? [] : [pid];
    });
  } catch {
    return [];
  }
}

function killPipePaneWritersForFifo(fifoPath: string): void {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of pipePaneWriterPids(fifoPath)) {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  }
}

function cleanupWindowResources(target: string, fifoPath: string): void {
  stopPipePane(target);
  killPipePaneWritersForFifo(fifoPath);
  try {
    tmuxExec(["kill-window", "-t", target]);
  } catch {
    // already gone
  }
  unlinkFifo(fifoPath);
}

/**
 * Check if a tmux window exists within a session.
 */
function windowExists(sessionName: string, windowName: string): boolean {
  try {
    const windows = tmuxExec(["list-windows", "-t", sessionName, "-F", "#{window_name}"]);
    return windows.split("\n").includes(windowName);
  } catch {
    return false;
  }
}

/**
 * Get the pane PID for a window.
 */
function panePid(sessionName: string, windowName: string): number | null {
  try {
    const raw = tmuxExec([
      "display-message",
      "-p",
      "-t",
      tmuxTarget(sessionName, windowName),
      "#{pane_pid}",
    ]);
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

/**
 * Check if pane has exited (remain-on-exit mode). Returns the dead status
 * exit code or `null` if still running.
 */
function paneDeadStatus(
  sessionName: string,
  windowName: string,
): { dead: true; exitCode: number | null } | { dead: false } {
  try {
    const raw = tmuxExec([
      "display-message",
      "-p",
      "-t",
      tmuxTarget(sessionName, windowName),
      "#{pane_dead} #{pane_dead_status}",
    ]);
    const parts = raw.split(" ");
    if (parts[0] === "1") {
      const code = parseInt(parts[1] ?? "", 10);
      return { dead: true, exitCode: Number.isNaN(code) ? null : code };
    }
    return { dead: false };
  } catch {
    // Window gone entirely
    return { dead: true, exitCode: null };
  }
}

/**
 * Ensure a tmux session exists with correct options.
 * Sets `remain-on-exit`, `automatic-rename off`, and `allow-rename off`
 * so windows keep their assigned names and stay after the command exits.
 */
function ensureSession(sessionName: string, cwd: string): void {
  if (!tmuxCheck(["has-session", "-t", sessionName])) {
    tmuxExec(["new-session", "-d", "-s", sessionName, "-c", cwd]);
    // remain-on-exit: keep panes alive so we can read pane_dead_status
    tmuxExec(["set-option", "-t", sessionName, "remain-on-exit", "on"]);
    // Prevent tmux from auto-renaming windows to the running command name.
    // Without this, `new-window -n foo` gets renamed to `sleep` or `sh`
    // and subsequent `pipe-pane -t session:foo` fails with "can't find window".
    tmuxExec(["set-option", "-t", sessionName, "automatic-rename", "off"]);
    tmuxExec(["set-option", "-t", sessionName, "allow-rename", "off"]);
  }
}

// ---------------------------------------------------------------------------
// Handle builder
// ---------------------------------------------------------------------------

interface TmuxHandleInput {
  readonly sessionName: string;
  readonly windowName: string;
  readonly instanceId: string;
  readonly fifoPath: string;
  readonly stateDir: string;
  readonly projectId: string;
}

function buildHandle(input: TmuxHandleInput): ExecutorHandle {
  const { sessionName, windowName, fifoPath } = input;
  const target = tmuxTarget(sessionName, windowName);

  let userInitiated = false;
  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const dataHandlers = new Set<(chunk: string) => void>();
  const exitHandlers = new Set<
    (event: { exitCode: number | null; signal: string | null; userInitiated: boolean }) => void
  >();

  // --- FIFO reader ---
  let fifoReadStream: nodeFs.ReadStream | null = null;

  function startFifoReader(): void {
    try {
      fifoReadStream = nodeFs.createReadStream(fifoPath, {
        encoding: "utf-8",
        autoClose: false,
      });

      fifoReadStream.on("data", (chunk: string | Buffer) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        for (const h of dataHandlers) {
          h(str);
        }
      });

      fifoReadStream.on("error", () => {
        // Best effort — FIFO may have been unlinked during teardown
      });
    } catch {
      // mkfifo path missing or unreadable — best effort
    }
  }

  startFifoReader();

  // --- Exit poller ---
  function fireExit(exitCode: number | null, signal: string | null): void {
    if (disposed) return;
    disposed = true;
    stopPoller();
    stopFifoReader();

    for (const h of exitHandlers) {
      h({ exitCode, signal, userInitiated });
    }
  }

  function pollExit(): void {
    if (disposed) return;

    // Window gone entirely?
    if (!windowExists(sessionName, windowName)) {
      fireExit(null, null);
      return;
    }

    // Window exists but pane dead? (remain-on-exit mode)
    const status = paneDeadStatus(sessionName, windowName);
    if (status.dead) {
      const code = status.exitCode;
      // Clean up the dead window
      cleanupWindowResources(target, fifoPath);
      fireExit(code, null);
    }
  }

  function startPoller(): void {
    if (pollTimer) return;
    pollTimer = setInterval(pollExit, POLL_INTERVAL_MS);
  }

  function stopPoller(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopFifoReader(): void {
    if (fifoReadStream) {
      try {
        fifoReadStream.close();
      } catch {
        // ignore
      }
      fifoReadStream = null;
    }
  }

  startPoller();

  // --- Handle ---
  const handle: ExecutorHandle = {
    executor: "tmux" as const,
    pid: panePid(sessionName, windowName),
    nativeKey: windowName,

    write: (data: string) =>
      Effect.try({
        try: () => {
          tmuxExec(["send-keys", "-t", target, "-l", "--", data]);
        },
        catch: (cause) => new ExecutorError("io-error", "write failed", cause),
      }),

    resize: (cols: number, rows: number) =>
      Effect.try({
        try: () => {
          try {
            tmuxExec(["resize-window", "-t", target, "-x", String(cols), "-y", String(rows)]);
          } catch {
            // Non-fatal — no attached client or window already at size
          }
        },
        catch: (cause) => new ExecutorError("io-error", "resize failed", cause),
      }),

    stop: () =>
      Effect.try({
        try: () => {
          userInitiated = true;
          const pid = panePid(sessionName, windowName);
          if (pid !== null) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              // already dead
            }
          }
        },
        catch: (cause) => new ExecutorError("io-error", "stop failed", cause),
      }),

    forceKill: () =>
      Effect.try({
        try: () => {
          userInitiated = true;
          cleanupWindowResources(target, fifoPath);
        },
        catch: (cause) => new ExecutorError("io-error", "forceKill failed", cause),
      }),

    onData: (handler: (chunk: string) => void) => {
      dataHandlers.add(handler);
      return {
        unsubscribe: () => {
          dataHandlers.delete(handler);
        },
      };
    },

    onExit: (
      handler: (event: {
        exitCode: number | null;
        signal: string | null;
        userInitiated: boolean;
      }) => void,
    ) => {
      exitHandlers.add(handler);
      return {
        unsubscribe: () => {
          exitHandlers.delete(handler);
        },
      };
    },
  };

  return handle;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const TmuxExecutorLive = Layer.effect(
  Executor,
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;

    return {
      kind: "tmux" as const,

      spawn: (input: ExecutorSpawnInput) =>
        Effect.try({
          try: () => {
            const { projectId, fifoName } = parseInstanceId(input.instanceId);
            const sessionName = makeTmuxSessionName(MANAGED_PROCESS_TMUX_SESSION_PREFIX, projectId);
            const windowName = `mp-${input.instanceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const target = tmuxTarget(sessionName, windowName);
            let fifoPath: string | null = null;

            try {
              // 1. Ensure session exists with correct options
              ensureSession(sessionName, input.cwd);

              // 2. Build command and pass environment through tmux directly.
              const fullCommand = `exec ${input.command}`;
              const envArgs = Object.entries(input.env).flatMap(([key, value]) => [
                "-e",
                `${key}=${value}`,
              ]);

              // 3. Create window with a placeholder that blocks until we set up
              //    pipe-pane. Uses 2147483647 instead of `infinity` for macOS
              //    BSD-sleep compatibility.
              tmuxExec([
                "new-window",
                "-d",
                "-t",
                sessionName,
                "-n",
                windowName,
                "-c",
                input.cwd,
                "sleep 2147483647",
              ]);

              // 4. Create FIFO and attach pipe-pane BEFORE the real command runs
              fifoPath = createFifo(stateDir, projectId, fifoName);

              tmuxExec(["pipe-pane", "-o", "-t", target, `cat > ${shellEscape(fifoPath)}`]);

              // 5. Replace placeholder with the real command via respawn-pane
              tmuxExec([
                "respawn-pane",
                "-k",
                "-t",
                target,
                "-c",
                input.cwd,
                ...envArgs,
                fullCommand,
              ]);

              // 6. Build handle
              return buildHandle({
                sessionName,
                windowName,
                instanceId: input.instanceId,
                fifoPath,
                stateDir,
                projectId,
              });
            } catch (cause) {
              if (fifoPath) {
                cleanupWindowResources(target, fifoPath);
              } else {
                try {
                  tmuxExec(["kill-window", "-t", target]);
                } catch {
                  // not created yet or already gone
                }
              }
              throw cause;
            }
          },
          catch: (cause) =>
            new ExecutorError(
              "spawn-failed",
              `tmux spawn failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            ),
        }),

      reattach: (input: { instanceId: string; nativeKey: string; cols: number; rows: number }) =>
        Effect.try({
          try: () => {
            const windowName = input.nativeKey;
            const { fifoName } = parseInstanceId(input.instanceId);

            // Find the session this window belongs to
            const sessionName = findSessionForWindow(windowName);
            if (!sessionName) {
              throw new ExecutorError(
                "not-running",
                `tmux window "${windowName}" not found in any fenrir-mp session`,
              );
            }

            const projectId = sessionName.slice(MANAGED_PROCESS_TMUX_SESSION_PREFIX.length);

            // Re-create FIFO and pipe-pane
            const fifoPath = createFifo(stateDir, projectId, fifoName);

            // Cancel any existing pipe-pane, then re-attach
            try {
              tmuxExec(["pipe-pane", "-t", tmuxTarget(sessionName, windowName)]);
            } catch {
              // no existing pipe — fine
            }

            tmuxExec([
              "pipe-pane",
              "-o",
              "-t",
              tmuxTarget(sessionName, windowName),
              `cat > ${shellEscape(fifoPath)}`,
            ]);

            return buildHandle({
              sessionName,
              windowName,
              instanceId: input.instanceId,
              fifoPath,
              stateDir,
              projectId,
            });
          },
          catch: (cause) => {
            if (cause instanceof ExecutorError) return cause;
            return new ExecutorError(
              "not-running",
              `tmux reattach failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            );
          },
        }),
    };
  }),
);

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Find which fenrir-mp-* session contains a given window name.
 */
function findSessionForWindow(windowName: string): string | null {
  try {
    const sessions = tmuxExec(["list-sessions", "-F", "#{session_name}"]);
    for (const session of sessions.split("\n")) {
      if (!session.startsWith(MANAGED_PROCESS_TMUX_SESSION_PREFIX)) continue;
      if (windowExists(session, windowName)) return session;
    }
  } catch {
    // tmux not running or no sessions
  }
  return null;
}

/**
 * Escape a string for safe inclusion in a shell command passed to tmux.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
