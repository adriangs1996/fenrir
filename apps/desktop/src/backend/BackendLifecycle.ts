import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";

export type BackendLifecycleState = "stopped" | "starting" | "ready" | "error";

/**
 * Generous upper bound on consecutive unexpected-exit restarts. The previous
 * implementation retried forever (with a capped 10s backoff); we now stop
 * after this many consecutive failures and log loudly instead of spinning.
 */
const MAX_BACKEND_RESTART_ATTEMPTS = 50;

function appendNodeOption(existing: string | undefined, option: string): string {
  return existing && existing.trim().length > 0 ? `${existing} ${option}` : option;
}

export interface BackendLifecycleDeps {
  readonly isQuitting: () => boolean;
  readonly resolveBackendEntry: () => string;
  readonly resolveBackendCwd: () => string;
  readonly buildChildEnv: () => NodeJS.ProcessEnv;
  /** Serialized as a single JSON line over the fd3 bootstrap pipe. */
  readonly buildBootstrapPayload: () => Record<string, unknown>;
  readonly shouldCaptureBackendLogs: () => boolean;
  readonly captureBackendOutput: (child: ChildProcess.ChildProcess) => void;
  readonly writeSessionBoundary: (phase: "START" | "END", details: string) => void;
  readonly getBackendPort: () => number;
  /** Awaits backend HTTP readiness (resolves once the backend answers). */
  readonly waitForReady: () => Promise<void>;
  /** Called once the backend reports HTTP-ready after a (re)spawn. */
  readonly onReady: () => void;
  /** Called whenever the backend process goes away (exit or spawn error). */
  readonly onProcessGone: () => void;
  /** Called before a stop request tears the process down (cancel waits, etc.). */
  readonly onBeforeStop: () => void;
}

/**
 * Owns the backend child process: spawn (with the fd3 bootstrap pipe),
 * stop/stop-and-wait, and bounded exponential-backoff restarts on
 * unexpected exits.
 */
export class BackendLifecycle {
  private readonly deps: BackendLifecycleDeps;
  private backendProcess: ChildProcess.ChildProcess | null = null;
  private restartAttempt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private state: BackendLifecycleState = "stopped";
  private readonly expectedExitChildren = new WeakSet<ChildProcess.ChildProcess>();

  constructor(deps: BackendLifecycleDeps) {
    this.deps = deps;
  }

  getState(): BackendLifecycleState {
    return this.state;
  }

  start(): void {
    if (this.deps.isQuitting() || this.backendProcess) return;

    const backendEntry = this.deps.resolveBackendEntry();
    if (!FS.existsSync(backendEntry)) {
      this.scheduleRestart(`missing server entry at ${backendEntry}`);
      return;
    }

    this.state = "starting";
    const captureBackendLogs = this.deps.shouldCaptureBackendLogs();
    const childEnv = this.deps.buildChildEnv();
    const child = ChildProcess.spawn(process.execPath, [backendEntry, "--bootstrap-fd", "3"], {
      cwd: this.deps.resolveBackendCwd(),
      // In Electron main, process.execPath points to the Electron binary.
      // Run the child in Node mode so this backend process does not become a GUI app instance.
      env: {
        ...childEnv,
        ELECTRON_RUN_AS_NODE: "1",
        // The backend hydrates large orchestration state at boot; the default
        // ~4GB V8 old-space limit has been hit on long-lived installs. Give it
        // headroom — actual usage stays far below unless something regresses.
        NODE_OPTIONS: appendNodeOption(childEnv.NODE_OPTIONS, "--max-old-space-size=8192"),
      },
      stdio: captureBackendLogs
        ? ["ignore", "pipe", "pipe", "pipe"]
        : ["ignore", "inherit", "inherit", "pipe"],
    });
    const bootstrapStream = child.stdio[3];
    if (bootstrapStream && "write" in bootstrapStream) {
      bootstrapStream.write(`${JSON.stringify(this.deps.buildBootstrapPayload())}\n`);
      bootstrapStream.end();
    } else {
      child.kill("SIGTERM");
      this.scheduleRestart("missing desktop bootstrap pipe");
      return;
    }
    this.backendProcess = child;
    let backendSessionClosed = false;
    const closeBackendSession = (details: string) => {
      if (backendSessionClosed) return;
      backendSessionClosed = true;
      this.deps.writeSessionBoundary("END", details);
    };
    this.deps.writeSessionBoundary(
      "START",
      `pid=${child.pid ?? "unknown"} port=${this.deps.getBackendPort()} cwd=${this.deps.resolveBackendCwd()}`,
    );
    this.deps.captureBackendOutput(child);

    child.once("spawn", () => {
      void this.deps
        .waitForReady()
        .then(() => {
          if (this.backendProcess === child) {
            // Reset the crash-loop budget only once readiness confirms:
            // "spawn" fires even for a backend that dies milliseconds later,
            // which would keep the restart cap from ever triggering.
            this.restartAttempt = 0;
            this.state = "ready";
            this.deps.onReady();
          }
        })
        .catch(() => undefined);
    });

    child.on("error", (error) => {
      this.deps.onProcessGone();
      const wasExpected = this.expectedExitChildren.has(child);
      if (this.backendProcess === child) {
        this.backendProcess = null;
      }
      closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
      if (wasExpected) {
        return;
      }
      this.scheduleRestart(error.message);
    });

    child.on("exit", (code, signal) => {
      this.deps.onProcessGone();
      const wasExpected = this.expectedExitChildren.has(child);
      if (this.backendProcess === child) {
        this.backendProcess = null;
      }
      closeBackendSession(
        `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      if (this.deps.isQuitting() || wasExpected) return;
      const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
      this.scheduleRestart(reason);
    });
  }

  stop(): void {
    this.deps.onBeforeStop();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.state = "stopped";

    const child = this.backendProcess;
    this.backendProcess = null;
    if (!child) return;

    if (child.exitCode === null && child.signalCode === null) {
      this.expectedExitChildren.add(child);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 2_000).unref();
    }
  }

  async stopAndWaitForExit(timeoutMs = 5_000): Promise<void> {
    this.deps.onBeforeStop();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.state = "stopped";

    const child = this.backendProcess;
    this.backendProcess = null;
    if (!child) return;
    const backendChild = child;
    if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;
    this.expectedExitChildren.add(backendChild);

    await new Promise<void>((resolve) => {
      let settled = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
      let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

      function settle(): void {
        if (settled) return;
        settled = true;
        backendChild.off("exit", onExit);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (exitTimeoutTimer) {
          clearTimeout(exitTimeoutTimer);
        }
        resolve();
      }

      function onExit(): void {
        settle();
      }

      backendChild.once("exit", onExit);
      backendChild.kill("SIGTERM");

      forceKillTimer = setTimeout(() => {
        if (backendChild.exitCode === null && backendChild.signalCode === null) {
          backendChild.kill("SIGKILL");
        }
      }, 2_000);
      forceKillTimer.unref();

      exitTimeoutTimer = setTimeout(() => {
        settle();
      }, timeoutMs);
      exitTimeoutTimer.unref();
    });
  }

  private scheduleRestart(reason: string): void {
    if (this.deps.isQuitting() || this.restartTimer) return;

    if (this.restartAttempt >= MAX_BACKEND_RESTART_ATTEMPTS) {
      this.state = "error";
      console.error(
        `[desktop] backend exited unexpectedly (${reason}); restart cap of ${MAX_BACKEND_RESTART_ATTEMPTS} attempts reached — giving up`,
      );
      return;
    }

    const delayMs = Math.min(500 * 2 ** this.restartAttempt, 10_000);
    this.restartAttempt += 1;
    console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delayMs);
  }
}
