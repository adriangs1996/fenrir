import * as ChildProcess from "node:child_process";
import { clipboard } from "electron";
import * as FS from "node:fs";
import * as Http from "node:http";
import * as Net from "node:net";
import * as Path from "node:path";

import { WebContentsView, type BrowserWindow } from "electron";
import type {
  EmbeddedViewBounds,
  EditorOpenFileInput,
  KeybindingCommand,
  VSCodeShortcutState,
  VSCodeWebServerKind,
  VSCodeWebSession,
} from "@fenrir/contracts";
import {
  EDITOR_SEND_TO_COMPOSER_CHANNEL,
  VSCODE_SHORTCUT_COMMAND_CHANNEL,
} from "@fenrir/contracts";
import { resolveShortcutCommand, type ShortcutEventLike } from "@fenrir/shared/keybindings";

import { probeVSCodeWeb } from "./probe";

interface VSCodeWebManagerConfig {
  readonly window: BrowserWindow;
}

interface VSCodeWebLaunch {
  readonly args: readonly string[];
  readonly url: string;
}

interface ActiveVSCodeWebSession extends VSCodeWebSession {
  readonly proc: ChildProcess.ChildProcess;
  readonly view: WebContentsView;
}

export interface VSCodeWebManager {
  ensureStarted(cwd: string): Promise<VSCodeWebSession>;
  openFile(input: EditorOpenFileInput): Promise<VSCodeWebSession>;
  setBounds(bounds: EmbeddedViewBounds): void;
  setShortcutState(state: VSCodeShortcutState): void;
  show(): void;
  hide(): void;
  stop(): void;
}

const LOOPBACK_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_KILL_DELAY_MS = 2_000;
const STARTUP_LOG_TAIL_LINES = 20;
const PORT_BIND_RETRY_LIMIT = 3;
const VSCODE_FENRIR_SHORTCUT_COMMANDS = new Set<KeybindingCommand>([
  "terminal.toggle",
  "terminal.split",
  "terminal.new",
  "terminal.close",
  "settings.toggle",
  "diff.toggle",
  "gitDiff.toggle",
  "thread.open",
  "editor.toggleChatTab",
  "editor.sendSelection",
  "editor.runPrompt",
]);

export function resolveVSCodeWorkspacePath(targetPath: string): string {
  const resolvedPath = Path.resolve(targetPath);
  try {
    const stat = FS.statSync(resolvedPath);
    return stat.isDirectory() ? resolvedPath : Path.dirname(resolvedPath);
  } catch {
    return Path.extname(resolvedPath).length > 0 ? Path.dirname(resolvedPath) : resolvedPath;
  }
}

export function isVSCodeServerReadyOutput(line: string): boolean {
  return /HTTP server listening on|Web UI available at/i.test(line);
}

export function isPortBindInUseError(message: string): boolean {
  return /\bEADDRINUSE\b|address already in use/i.test(message);
}

export function extractVSCodeServerUrl(line: string): string | null {
  const match = line.match(/https?:\/\/127\.0\.0\.1:(\d+)(?:\/|$)/i);
  if (!match) return null;
  return `http://${LOOPBACK_HOST}:${match[1]}/`;
}

export function createVSCodeServerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  delete nextEnv.PORT;
  delete nextEnv.HOST;
  delete nextEnv.FENRIR_PORT;
  delete nextEnv.VITE_DEV_SERVER_URL;
  delete nextEnv.VITE_HTTP_URL;
  delete nextEnv.VITE_WS_URL;
  return nextEnv;
}

export function resolveVSCodeFenrirShortcutCommand(
  event: ShortcutEventLike,
  state: VSCodeShortcutState | null,
): KeybindingCommand | null {
  if (!state) return null;
  const command = resolveShortcutCommand(event, state.keybindings, {
    platform: state.platform,
    context: state.context,
  });
  return command && VSCODE_FENRIR_SHORTCUT_COMMANDS.has(command) ? command : null;
}

function trimStartupLogLines(lines: string[]): string[] {
  return lines.slice(-STARTUP_LOG_TAIL_LINES);
}

function pushStartupLogLines(target: string[], chunk: string): void {
  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    target.push(line);
  }
}

function formatStartupFailureMessage(input: {
  readonly prefix: string;
  readonly detail?: string | null;
  readonly stdoutLines: readonly string[];
  readonly stderrLines: readonly string[];
}): string {
  const parts = [input.prefix];
  if (input.detail) {
    parts.push(input.detail);
  }
  const tail = [...input.stderrLines, ...input.stdoutLines].slice(-STARTUP_LOG_TAIL_LINES);
  if (tail.length > 0) {
    parts.push(`Recent output: ${tail.join(" | ")}`);
  }
  return parts.join(" ");
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = Path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !Path.isAbsolute(relative));
}

export function buildVSCodeWebLaunch(input: {
  readonly command: string;
  readonly cwd: string;
  readonly host: string;
  readonly port: number;
  readonly serverKind: VSCodeWebServerKind;
}): VSCodeWebLaunch {
  const origin = `http://${input.host}:${input.port}`;
  if (input.serverKind === "code-server") {
    return {
      args: ["--bind-addr", `${input.host}:0`, "--auth", "none", "--disable-telemetry", input.cwd],
      url: `${origin}/?folder=${encodeURIComponent(input.cwd)}`,
    };
  }

  return {
    args: [
      "--host",
      input.host,
      "--port",
      String(input.port),
      "--without-connection-token",
      "--accept-server-license-terms",
      "--telemetry-level",
      "off",
      input.cwd,
    ],
    url: origin,
  };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = Net.createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (port <= 0) {
          reject(new Error("Unable to reserve a loopback port for Embedded VS Code."));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttpReady(url: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const request = Http.request(url, { method: "GET" }, (response) => {
        response.resume();
        resolve(response.statusCode !== undefined && response.statusCode < 500);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(750, () => {
        request.destroy();
        resolve(false);
      });
      request.end();
    });

    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Embedded VS Code did not become ready before the startup timeout.");
}

function toSnapshot(session: ActiveVSCodeWebSession): VSCodeWebSession {
  return {
    cwd: session.cwd,
    url: session.url,
    serverKind: session.serverKind,
    command: session.command,
  };
}

export function createVSCodeWebManager(config: VSCodeWebManagerConfig): VSCodeWebManager {
  const parentWindow = config.window;
  let activeSession: ActiveVSCodeWebSession | null = null;
  let activeBounds: EmbeddedViewBounds | null = null;
  let shortcutState: VSCodeShortcutState | null = null;
  let startPromise: Promise<VSCodeWebSession> | null = null;

  function detachView(view: WebContentsView): void {
    try {
      parentWindow.contentView.removeChildView(view);
    } catch {
      // The view may already be detached.
    }
  }

  function stopSession(session: ActiveVSCodeWebSession): void {
    detachView(session.view);
    try {
      session.view.webContents.close();
    } catch {
      // The view may already be closed.
    }

    if (session.proc.exitCode !== null || session.proc.signalCode !== null) {
      return;
    }

    session.proc.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (session.proc.exitCode === null && session.proc.signalCode === null) {
        session.proc.kill("SIGKILL");
      }
    }, SHUTDOWN_KILL_DELAY_MS);
    killTimer.unref();
  }

  async function sendVSCodeSelectionToComposer(session: ActiveVSCodeWebSession): Promise<void> {
    const previousClipboardText = clipboard.readText();
    session.view.webContents.copy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const text = clipboard.readText();
    clipboard.writeText(previousClipboardText);
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    if (!normalizedText) return;

    parentWindow.webContents.send(EDITOR_SEND_TO_COMPOSER_CHANNEL, {
      file: session.view.webContents.getTitle() || "VS Code selection",
      lineStart: 1,
      lineEnd: Math.max(1, normalizedText.split("\n").length),
      text: normalizedText,
    });
  }

  function attachShortcutBridge(session: ActiveVSCodeWebSession): void {
    session.view.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;

      const command = resolveVSCodeFenrirShortcutCommand(
        {
          key: input.key,
          code: input.code,
          metaKey: input.meta,
          ctrlKey: input.control,
          shiftKey: input.shift,
          altKey: input.alt,
        },
        shortcutState,
      );
      if (!command) return;

      event.preventDefault();
      if (command === "editor.sendSelection") {
        void sendVSCodeSelectionToComposer(session);
        return;
      }
      parentWindow.webContents.send(VSCODE_SHORTCUT_COMMAND_CHANNEL, command);
    });
  }

  async function startOnce(input: {
    readonly cwd: string;
    readonly command: string;
    readonly serverKind: VSCodeWebServerKind;
  }): Promise<VSCodeWebSession> {
    const port = input.serverKind === "code-server" ? 0 : await reserveLoopbackPort();
    const launch = buildVSCodeWebLaunch({
      command: input.command,
      cwd: input.cwd,
      host: LOOPBACK_HOST,
      port,
      serverKind: input.serverKind,
    });
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:fenrir-vscode-web",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const proc = ChildProcess.spawn(input.command, [...launch.args], {
      // Keep the spawned server anchored to the app process cwd. The target
      // workspace is already passed as a launch argument; using it as the OS
      // cwd makes startup fail when a stale worktree path is selected.
      cwd: process.cwd(),
      env: createVSCodeServerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const session: ActiveVSCodeWebSession = {
      cwd: input.cwd,
      url: launch.url,
      serverKind: input.serverKind,
      command: input.command,
      proc,
      view,
    };
    attachShortcutBridge(session);
    activeSession = session;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let serverBaseUrl: string | null = null;
    let settled = false;
    let settleStartup: ((value: void | PromiseLike<void>) => void) | null = null;
    let rejectStartup: ((reason?: unknown) => void) | null = null;
    const startupSignal = new Promise<void>((resolve, reject) => {
      settleStartup = resolve;
      rejectStartup = reject;
    });
    const resolveStartup = (): void => {
      if (settled) return;
      settled = true;
      settleStartup?.();
    };
    const failStartup = (message: string): void => {
      if (settled) return;
      settled = true;
      rejectStartup?.(new Error(message));
    };

    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      pushStartupLogLines(stdoutLines, text);
      stdoutLines.splice(0, stdoutLines.length, ...trimStartupLogLines(stdoutLines));
      console.log("[vscode-web] stdout:", text.trim());
      for (const line of stdoutLines) {
        const nextUrl = extractVSCodeServerUrl(line);
        if (nextUrl) {
          serverBaseUrl = nextUrl;
        }
      }
      if (stdoutLines.some(isVSCodeServerReadyOutput)) {
        resolveStartup();
      }
    });
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      pushStartupLogLines(stderrLines, text);
      stderrLines.splice(0, stderrLines.length, ...trimStartupLogLines(stderrLines));
      console.warn("[vscode-web] stderr:", text.trim());
      for (const line of stderrLines) {
        const nextUrl = extractVSCodeServerUrl(line);
        if (nextUrl) {
          serverBaseUrl = nextUrl;
        }
      }
      if (stderrLines.some(isVSCodeServerReadyOutput)) {
        resolveStartup();
      }
    });
    proc.once("error", (error) => {
      if (activeSession === session) {
        activeSession = null;
      }
      console.error("[vscode-web] process error:", error);
      failStartup(
        formatStartupFailureMessage({
          prefix: "Embedded VS Code failed to start.",
          detail: error.message,
          stdoutLines,
          stderrLines,
        }),
      );
    });
    proc.once("exit", (code, signal) => {
      if (activeSession === session) {
        activeSession = null;
      }
      detachView(view);
      console.log("[vscode-web] process exit:", code, signal);
      if (code !== 0 || signal !== null) {
        failStartup(
          formatStartupFailureMessage({
            prefix: "Embedded VS Code exited before it became ready.",
            detail: `Exit code: ${code ?? "null"}, signal: ${signal ?? "none"}.`,
            stdoutLines,
            stderrLines,
          }),
        );
      }
    });

    try {
      if (input.serverKind === "code-server") {
        await startupSignal;
        if (!serverBaseUrl) {
          throw new Error(
            "Embedded VS Code did not report a loopback URL before startup completed.",
          );
        }
        await waitForHttpReady(serverBaseUrl);
      } else {
        await Promise.race([waitForHttpReady(`http://${LOOPBACK_HOST}:${port}/`), startupSignal]);
      }
      const resolvedBaseUrl = serverBaseUrl ?? `http://${LOOPBACK_HOST}:${port}/`;
      const resolvedUrl =
        input.serverKind === "code-server"
          ? `${resolvedBaseUrl}?folder=${encodeURIComponent(input.cwd)}`
          : resolvedBaseUrl;
      if (activeSession === session) {
        activeSession = { ...session, url: resolvedUrl };
      }
      await view.webContents.loadURL(resolvedUrl);
      if (activeBounds) {
        view.setBounds(activeBounds);
      }
      return {
        cwd: input.cwd,
        url: resolvedUrl,
        serverKind: input.serverKind,
        command: input.command,
      };
    } catch (error) {
      if (activeSession === session) {
        activeSession = null;
      }
      stopSession(session);
      throw error;
    }
  }

  async function start(cwd: string): Promise<VSCodeWebSession> {
    const probe = await probeVSCodeWeb();
    if (!probe.available || !probe.command || !probe.serverKind) {
      throw new Error(probe.error ?? "Embedded VS Code is not available.");
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < PORT_BIND_RETRY_LIMIT; attempt += 1) {
      try {
        return await startOnce({
          cwd,
          command: probe.command,
          serverKind: probe.serverKind,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!isPortBindInUseError(message) || attempt === PORT_BIND_RETRY_LIMIT - 1) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Embedded VS Code failed to start.");
  }

  async function ensureStartedForCwd(cwd: string): Promise<VSCodeWebSession> {
    const workspaceCwd = resolveVSCodeWorkspacePath(cwd);
    if (activeSession?.cwd === workspaceCwd) {
      return toSnapshot(activeSession);
    }

    if (startPromise) {
      const pending = await startPromise.catch(() => null);
      if (pending?.cwd === workspaceCwd) {
        return pending;
      }
    }

    if (activeSession) {
      const previous = activeSession;
      activeSession = null;
      stopSession(previous);
    }

    startPromise = start(workspaceCwd).finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  return {
    ensureStarted: ensureStartedForCwd,

    openFile: async (input) => {
      const targetPath = Path.resolve(input.path);
      const workspaceCwd =
        activeSession && isPathInside(activeSession.cwd, targetPath)
          ? activeSession.cwd
          : resolveVSCodeWorkspacePath(targetPath);
      return ensureStartedForCwd(workspaceCwd);
    },

    setBounds: (bounds) => {
      if (
        bounds.width < 1 ||
        bounds.height < 1 ||
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height)
      ) {
        return;
      }
      activeBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      activeSession?.view.setBounds(activeBounds);
    },
    setShortcutState: (state) => {
      shortcutState = state;
    },

    show: () => {
      if (!activeSession) {
        return;
      }
      if (activeBounds) {
        activeSession.view.setBounds(activeBounds);
      }
      try {
        parentWindow.contentView.addChildView(activeSession.view);
      } catch {
        detachView(activeSession.view);
        parentWindow.contentView.addChildView(activeSession.view);
      }
      activeSession.view.webContents.focus();
    },

    hide: () => {
      if (!activeSession) {
        return;
      }
      detachView(activeSession.view);
    },

    stop: () => {
      const session = activeSession;
      activeSession = null;
      startPromise = null;
      if (session) {
        stopSession(session);
      }
    },
  };
}
