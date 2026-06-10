import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { DesktopServerExposureMode, DesktopServerExposureState } from "@fenrir/contracts";
import {
  MENU_ACTION_CHANNEL,
  TRAFFIC_LENS_PAUSED_EVENT_CHANNEL,
  TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL,
  TRAFFIC_LENS_STORAGE_EVENT_CHANNEL,
  TRAFFIC_LENS_TAB_EVENT_CHANNEL,
} from "@fenrir/contracts";

import { RotatingFileSink } from "@fenrir/shared/logging";
import { parsePersistedServerObservabilitySettings } from "@fenrir/shared/serverSettings";
import {
  DEFAULT_DESKTOP_BACKEND_PORT,
  resolveDesktopBackendPort,
  isBackendReadinessAborted,
  waitForHttpReady,
  createBackendReadinessWaiter,
} from "../backend/DesktopBackendConfiguration";
import { BackendLifecycle } from "../backend/BackendLifecycle";
import {
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettings,
  setDesktopServerExposurePreference,
  writeDesktopSettings,
} from "../settings/DesktopAppSettings";
import { resolveDesktopServerExposure } from "../backend/DesktopServerExposure";
import { syncShellEnvironment } from "../shell/DesktopShellEnvironment";
import { DesktopUpdaterController } from "../updates/DesktopUpdaterController";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./DesktopRuntimeArch";
import { stopVpn } from "../vpnManager";
import { createTrafficLensManager, type TrafficLensManager } from "../window/DesktopWindow";
import { NeovimSource } from "../neovim";
import { createVSCodeWebManager, type VSCodeWebManager } from "../vscode";
import { createBrowserLabControlClient } from "../browserLab/BrowserLabControlClient";
import { formatErrorMessage } from "../errorMessage";
import { getSafeExternalUrl } from "../electron/SafeInputs";
import { registerSettingsHandlers } from "../ipc/settingsHandlers";
import { registerDialogHandlers } from "../ipc/dialogHandlers";
import { registerUpdaterHandlers } from "../ipc/updaterHandlers";
import { registerVpnHandlers } from "../ipc/vpnHandlers";
import { registerTrafficLensHandlers } from "../ipc/trafficLensHandlers";
import { registerNeovimHandlers, type NeovimIpcController } from "../ipc/neovimHandlers";
import { registerVSCodeHandlers } from "../ipc/vscodeHandlers";
import { registerEditorHandlers } from "../ipc/editorHandlers";
import { createRenderRuntime } from "../ipc/renderHandlers";

const BASE_DIR = process.env.FENRIR_HOME?.trim() || Path.join(OS.homedir(), ".fenrir");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const DESKTOP_SETTINGS_PATH = Path.join(STATE_DIR, "desktop-settings.json");
const CLIENT_SETTINGS_PATH = Path.join(STATE_DIR, "client-settings.json");
const SAVED_ENVIRONMENT_REGISTRY_PATH = Path.join(STATE_DIR, "saved-environments.json");
const VPN_PROFILES_PATH = Path.join(STATE_DIR, "vpn-profiles.json");
const BROWSER_LAB_TAB_SESSION_PATH = Path.join(STATE_DIR, "browser-lab-tabs.json");
const DESKTOP_SCHEME = "t3";
const ELECTRON_DIST_DIR = __dirname;
const ROOT_DIR = Path.resolve(ELECTRON_DIST_DIR, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Fenrir (Dev)" : "Fenrir";
const APP_USER_MODEL_ID = isDevelopment ? "com.fenrir.app.dev" : "com.fenrir.app";
const LINUX_DESKTOP_ENTRY_NAME = isDevelopment ? "fenrir-dev.desktop" : "fenrir.desktop";
const LINUX_WM_CLASS = isDevelopment ? "fenrir-dev" : "fenrir";
const USER_DATA_DIR_NAME = isDevelopment ? "fenrir-dev" : "fenrir";
const LEGACY_USER_DATA_DIR_NAME = isDevelopment ? "Fenrir (Dev)" : "Fenrir";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const LOG_DIR = Path.join(STATE_DIR, "logs");
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 10;
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const SERVER_SETTINGS_PATH = Path.join(STATE_DIR, "settings.json");
const DESKTOP_LOOPBACK_HOST = "127.0.0.1";
const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";

type WindowTitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type LinuxDesktopNamedApp = Electron.App & {
  setDesktopName?: (desktopName: string) => void;
};

let mainWindow: BrowserWindow | null = null;
let backendPort = 0;
let backendBindHost = DESKTOP_LOOPBACK_HOST;
let backendBootstrapToken = "";
let backendHttpUrl = "";
let backendWsUrl = "";
let backendEndpointUrl: string | null = null;
let backendAdvertisedHost: string | null = null;
const backendReadinessWaiter = createBackendReadinessWaiter((baseUrl, signal) =>
  waitForHttpReady(baseUrl, { signal }),
);
let isQuitting = false;
let desktopProtocolRegistered = false;
let aboutCommitHashCache: string | null | undefined;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let restoreStdIoCapture: (() => void) | null = null;
let trafficLensManager: TrafficLensManager | null = null;
let trafficLensManagerOwner: BrowserWindow | null = null;
let stopTrafficLensTabEventForwarding: (() => void) | null = null;
let stopTrafficLensPausedEventForwarding: (() => void) | null = null;
let stopTrafficLensStorageEventForwarding: (() => void) | null = null;
let vscodeWebManager: VSCodeWebManager | null = null;
let vscodeWebManagerOwner: BrowserWindow | null = null;
let desktopShellEnvironmentSynced = false;
let neovimIpc: NeovimIpcController | null = null;

const neovimSource = new NeovimSource(process.env.HOME ?? process.cwd());
const renderRuntime = createRenderRuntime({ neovimSource });
let desktopSettings = readDesktopSettings(DESKTOP_SETTINGS_PATH);
let desktopServerExposureMode: DesktopServerExposureMode = desktopSettings.serverExposureMode;

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;

const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});

const desktopUpdater = new DesktopUpdaterController({
  isDevelopment,
  runtimeInfo: desktopRuntimeInfo,
  isQuitting: () => isQuitting,
  setQuitting: (value) => {
    isQuitting = value;
  },
  stopBackendAndWaitForExit: () => backendLifecycle.stopAndWaitForExit(),
});

const browserLabControlClient = createBrowserLabControlClient({
  isQuitting: () => isQuitting,
  getBackendWsUrl: () => backendWsUrl,
  getBootstrapToken: () => backendBootstrapToken,
  ensureTrafficLensManager: () => ensureTrafficLensManager(),
});

const backendLifecycle = new BackendLifecycle({
  isQuitting: () => isQuitting,
  resolveBackendEntry,
  resolveBackendCwd,
  buildChildEnv: backendChildEnv,
  buildBootstrapPayload: () => {
    const observability = readPersistedBackendObservabilitySettings();
    return {
      mode: "desktop",
      noBrowser: true,
      port: backendPort,
      fenrirHome: BASE_DIR,
      host: backendBindHost,
      desktopBootstrapToken: backendBootstrapToken,
      ...(observability.otlpTracesUrl ? { otlpTracesUrl: observability.otlpTracesUrl } : {}),
      ...(observability.otlpMetricsUrl ? { otlpMetricsUrl: observability.otlpMetricsUrl } : {}),
    };
  },
  shouldCaptureBackendLogs: () => app.isPackaged && backendLogSink !== null,
  captureBackendOutput,
  writeSessionBoundary: writeBackendSessionBoundary,
  getBackendPort: () => backendPort,
  waitForReady: () => waitForBackendHttpReady(backendHttpUrl),
  onReady: () => {
    browserLabControlClient.start();
  },
  onProcessGone: () => {
    browserLabControlClient.stop();
  },
  onBeforeStop: () => {
    cancelBackendReadinessWait();
    browserLabControlClient.stop();
  },
});

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readPersistedBackendObservabilitySettings(): {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
} {
  try {
    if (!FS.existsSync(SERVER_SETTINGS_PATH)) {
      return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
    }
    return parsePersistedServerObservabilitySettings(FS.readFileSync(SERVER_SETTINGS_PATH, "utf8"));
  } catch (error) {
    console.warn("[desktop] failed to read persisted backend observability settings", error);
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function resolveConfiguredDesktopBackendPort(rawPort: string | undefined): number | undefined {
  if (!rawPort) {
    return undefined;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return undefined;
  }

  return parsedPort;
}

function resolveDesktopDevServerUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (!devServerUrl) {
    throw new Error("VITE_DEV_SERVER_URL is required in desktop development.");
  }

  return devServerUrl;
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FENRIR_PORT;
  delete env.FENRIR_MODE;
  delete env.FENRIR_NO_BROWSER;
  delete env.FENRIR_HOST;
  delete env.FENRIR_DESKTOP_WS_URL;
  delete env.FENRIR_DESKTOP_LAN_ACCESS;
  delete env.FENRIR_DESKTOP_LAN_HOST;
  return env;
}

function getDesktopServerExposureState(): DesktopServerExposureState {
  return {
    mode: desktopServerExposureMode,
    endpointUrl: backendEndpointUrl,
    advertisedHost: backendAdvertisedHost,
  };
}

function getDesktopSecretStorage() {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value: string) => safeStorage.encryptString(value),
    decryptString: (value: Buffer) => safeStorage.decryptString(value),
  } as const;
}

function resolveAdvertisedHostOverride(): string | undefined {
  const override = process.env.FENRIR_DESKTOP_LAN_HOST?.trim();
  return override && override.length > 0 ? override : undefined;
}

async function applyDesktopServerExposureMode(
  mode: DesktopServerExposureMode,
  options?: {
    readonly persist?: boolean;
    readonly rejectIfUnavailable?: boolean;
  },
): Promise<DesktopServerExposureState> {
  const advertisedHostOverride = resolveAdvertisedHostOverride();
  const requestedMode = mode;
  let exposure = resolveDesktopServerExposure({
    mode,
    port: backendPort,
    networkInterfaces: OS.networkInterfaces(),
    ...(advertisedHostOverride ? { advertisedHostOverride } : {}),
  });

  if (requestedMode === "network-accessible" && exposure.endpointUrl === null) {
    if (options?.rejectIfUnavailable) {
      throw new Error("No reachable network address is available for this desktop right now.");
    }
    exposure = resolveDesktopServerExposure({
      mode: "local-only",
      port: backendPort,
      networkInterfaces: OS.networkInterfaces(),
      ...(advertisedHostOverride ? { advertisedHostOverride } : {}),
    });
  }

  desktopServerExposureMode = exposure.mode;
  desktopSettings = setDesktopServerExposurePreference(desktopSettings, requestedMode);
  backendBindHost = exposure.bindHost;
  backendHttpUrl = exposure.localHttpUrl;
  backendWsUrl = exposure.localWsUrl;
  backendEndpointUrl = exposure.endpointUrl;
  backendAdvertisedHost = exposure.advertisedHost;

  if (options?.persist) {
    writeDesktopSettings(DESKTOP_SETTINGS_PATH, desktopSettings);
  }

  return getDesktopServerExposureState();
}

function relaunchDesktopApp(reason: string): void {
  writeDesktopLogHeader(`desktop relaunch requested reason=${reason}`);
  setImmediate(() => {
    isQuitting = true;
    desktopUpdater.clearTimers();
    cancelBackendReadinessWait();
    void backendLifecycle
      .stopAndWaitForExit()
      .catch((error) => {
        writeDesktopLogHeader(
          `desktop relaunch backend shutdown warning message=${formatErrorMessage(error)}`,
        );
      })
      .finally(() => {
        restoreStdIoCapture?.();
        if (isDevelopment) {
          app.exit(75);
          return;
        }
        app.relaunch({
          execPath: process.execPath,
          args: process.argv.slice(1),
        });
        app.exit(0);
      });
  });
}

function writeDesktopLogHeader(message: string): void {
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function ensureDesktopShellEnvironmentSynced(reason: string): void {
  if (desktopShellEnvironmentSynced) return;

  desktopShellEnvironmentSynced = true;
  const normalizedReason = sanitizeLogValue(reason);
  const startedAt = Date.now();
  writeDesktopLogHeader(`shell environment sync start reason=${normalizedReason}`);
  syncShellEnvironment();
  writeDesktopLogHeader(
    `shell environment sync complete reason=${normalizedReason} durationMs=${Date.now() - startedAt}`,
  );
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

async function waitForBackendHttpReady(baseUrl: string): Promise<void> {
  await backendReadinessWaiter.wait(baseUrl);
}

function cancelBackendReadinessWait(): void {
  backendReadinessWaiter.cancel();
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (!app.isPackaged || desktopLogSink === null || restoreStdIoCapture !== null) {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const patchWrite =
    (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      writeDesktopStreamChunk(streamName, chunk, encoding);
      if (typeof encodingOrCallback === "function") {
        return originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding);
      }
      return originalWrite(chunk);
    };

  process.stdout.write = patchWrite("stdout", originalStdoutWrite);
  process.stderr.write = patchWrite("stderr", originalStderrWrite);

  restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restoreStdIoCapture = null;
  };
}

function stopTrafficLensManager(): void {
  stopTrafficLensTabEventForwarding?.();
  stopTrafficLensTabEventForwarding = null;
  stopTrafficLensPausedEventForwarding?.();
  stopTrafficLensPausedEventForwarding = null;
  stopTrafficLensStorageEventForwarding?.();
  stopTrafficLensStorageEventForwarding = null;
  trafficLensManager?.stop();
  trafficLensManager = null;
  trafficLensManagerOwner = null;
}

function ensureTrafficLensManager(): TrafficLensManager {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    stopTrafficLensManager();
    throw new Error("Traffic Lens manager is unavailable.");
  }

  if (trafficLensManager !== null && trafficLensManagerOwner === mainWindow) {
    return trafficLensManager;
  }

  stopTrafficLensManager();

  const nextManager = createTrafficLensManager({
    window: mainWindow,
    backendHttpUrl,
    bootstrapToken: backendBootstrapToken,
    onSidebarToggleShortcut: () => dispatchMenuAction("toggle-sidebar"),
    tabSessionPath: BROWSER_LAB_TAB_SESSION_PATH,
  });

  stopTrafficLensTabEventForwarding = nextManager.onTabEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(TRAFFIC_LENS_TAB_EVENT_CHANNEL, event);
  });
  stopTrafficLensPausedEventForwarding = nextManager.onPausedEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(TRAFFIC_LENS_PAUSED_EVENT_CHANNEL, event);
  });
  stopTrafficLensStorageEventForwarding = nextManager.onStorageChanged((tabId) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL, tabId);
  });
  const stopStructuredStorageEventForwarding = nextManager.onStorageEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(TRAFFIC_LENS_STORAGE_EVENT_CHANNEL, event);
  });
  const previousStop = stopTrafficLensStorageEventForwarding;
  stopTrafficLensStorageEventForwarding = () => {
    previousStop?.();
    stopStructuredStorageEventForwarding();
  };

  trafficLensManager = nextManager;
  trafficLensManagerOwner = mainWindow;
  return nextManager;
}

function stopVSCodeWebManager(): void {
  vscodeWebManager?.stop();
  vscodeWebManager = null;
  vscodeWebManagerOwner = null;
}

function ensureVSCodeWebManager(): VSCodeWebManager {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    stopVSCodeWebManager();
    throw new Error("Embedded VS Code manager is unavailable.");
  }

  if (vscodeWebManager !== null && vscodeWebManagerOwner === mainWindow) {
    return vscodeWebManager;
  }

  stopVSCodeWebManager();
  vscodeWebManager = createVSCodeWebManager({ window: mainWindow });
  vscodeWebManagerOwner = mainWindow;
  return vscodeWebManager;
}

function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    installStdIoCapture();
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
    writeDesktopLogHeader(`diagnostics directory registered path=${LOG_DIR}`);
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: import("node:child_process").ChildProcess): void {
  if (!app.isPackaged || backendLogSink === null) return;
  const writeChunk = (chunk: unknown): void => {
    if (!backendLogSink) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    backendLogSink.write(buffer);
  };
  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);
}

initializePackagedLogging();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", LINUX_WM_CLASS);
}

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined;
  }
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({
      width: 14,
      height: 14,
    });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR;
  }
  return app.getAppPath();
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
  if (!FS.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { fenrirCommitHash?: unknown };
    return normalizeCommitHash(parsed.fenrirCommitHash);
  } catch {
    return null;
  }
}

function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache;
  }

  const envCommitHash = normalizeCommitHash(process.env.FENRIR_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash;
    return aboutCommitHashCache;
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null;
    return aboutCommitHashCache;
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash();

  return aboutCommitHashCache;
}

function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), "apps/server/dist/bin.mjs");
}

function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot();
  }
  return OS.homedir();
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  const candidates = [
    Path.join(appRoot, "apps/server/dist/client"),
    Path.join(appRoot, "apps/web/dist"),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) {
    return Path.join(staticRoot, "index.html");
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : "index.html";
  const resolvedPath = Path.join(staticRoot, requestedPath);

  if (Path.extname(resolvedPath)) {
    return resolvedPath;
  }

  const nestedIndex = Path.join(resolvedPath, "index.html");
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex;
  }

  return Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return Path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

function getDesktopStaticContentType(filePath: string): string {
  switch (Path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function createDesktopStaticResponse(filePath: string): Response {
  const body = new Uint8Array(FS.readFileSync(filePath));
  return new Response(body, {
    headers: {
      "content-type": getDesktopStaticContentType(filePath),
    },
  });
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
  console.error(`[desktop] fatal startup error (${stage})`, error);
  if (!isQuitting) {
    isQuitting = true;
    dialog.showErrorBox("Fenrir failed to start", `Stage: ${stage}\n${message}${detail}`);
  }
  backendLifecycle.stop();
  restoreStdIoCapture?.();
  app.quit();
}

function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return;

  const staticRoot = resolveDesktopStaticDir();
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }

  const staticRootResolved = Path.resolve(staticRoot);
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`;
  const fallbackIndex = Path.join(staticRootResolved, "index.html");

  protocol.handle(DESKTOP_SCHEME, async (request) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          return new Response("Not found", { status: 404 });
        }
        return createDesktopStaticResponse(fallbackIndex);
      }

      return createDesktopStaticResponse(resolvedCandidate);
    } catch {
      return createDesktopStaticResponse(fallbackIndex);
    }
  });

  desktopProtocolRegistered = true;
}

function dispatchMenuAction(action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  const send = () => {
    if (targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
    revealWindow(targetWindow);
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = desktopUpdater.getDisabledReason();
  if (disabledReason) {
    console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
    void dialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason,
      buttons: ["OK"],
    });
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  void checkForUpdatesFromMenu();
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await desktopUpdater.checkForUpdates("menu");

  const updateState = desktopUpdater.getState();
  if (updateState.status === "up-to-date") {
    void dialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `Fenrir ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => dispatchMenuAction("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        ...(process.platform === "darwin"
          ? []
          : [
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => dispatchMenuAction("open-settings"),
              },
              { type: "separator" as const },
            ]),
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(ELECTRON_DIST_DIR, "../resources", fileName),
    Path.join(ELECTRON_DIST_DIR, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
  return resolveResourcePath(`icon.${ext}`);
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json, which currently produces directories with spaces and
 * parentheses (e.g. `~/.config/Fenrir (Alpha)` on Linux). This is
 * unfriendly for shell usage and violates Linux naming conventions.
 *
 * We override it to a clean lowercase name (`fenrir`). If the legacy
 * directory already exists we keep using it so existing users don't
 * lose their Chromium profile data (localStorage, cookies, sessions).
 */
function resolveUserDataPath(): string {
  const appDataBase =
    process.platform === "win32"
      ? process.env.APPDATA || Path.join(OS.homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? Path.join(OS.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || Path.join(OS.homedir(), ".config");

  const legacyPath = Path.join(appDataBase, LEGACY_USER_DATA_DIR_NAME);
  if (FS.existsSync(legacyPath)) {
    return legacyPath;
  }

  return Path.join(appDataBase, USER_DATA_DIR_NAME);
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  const commitHash = resolveAboutCommitHash();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: commitHash ?? "unknown",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  if (process.platform === "linux") {
    (app as LinuxDesktopNamedApp).setDesktopName?.(LINUX_DESKTOP_ENTRY_NAME);
  }

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveIconPath("png");
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
  }
}

function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }

  window.focus();
}

function registerIpcHandlers(): void {
  registerSettingsHandlers({
    clientSettingsPath: CLIENT_SETTINGS_PATH,
    savedEnvironmentRegistryPath: SAVED_ENVIRONMENT_REGISTRY_PATH,
    getLocalEnvironmentBootstrap: () => ({
      label: "Local environment",
      httpBaseUrl: backendHttpUrl || null,
      wsBaseUrl: backendWsUrl || null,
      ...(backendBootstrapToken ? { bootstrapToken: backendBootstrapToken } : {}),
    }),
    getSecretStorage: getDesktopSecretStorage,
    getServerExposureState: getDesktopServerExposureState,
    getServerExposureMode: () => desktopServerExposureMode,
    applyServerExposureMode: applyDesktopServerExposureMode,
    relaunch: relaunchDesktopApp,
  });

  registerVpnHandlers({
    stateDir: STATE_DIR,
    vpnProfilesPath: VPN_PROFILES_PATH,
    getMainWindow: () => mainWindow,
    ensureShellEnvironmentSynced: ensureDesktopShellEnvironmentSynced,
  });

  registerDialogHandlers({
    getMainWindow: () => mainWindow,
    getDestructiveMenuIcon,
  });

  registerTrafficLensHandlers({
    ensureManager: ensureTrafficLensManager,
  });

  neovimIpc = registerNeovimHandlers({
    getMainWindow: () => mainWindow,
    ensureShellEnvironmentSynced: ensureDesktopShellEnvironmentSynced,
    neovimSource,
  });

  registerVSCodeHandlers({
    ensureManager: ensureVSCodeWebManager,
    getManager: () => vscodeWebManager,
    ensureShellEnvironmentSynced: ensureDesktopShellEnvironmentSynced,
  });

  registerEditorHandlers({
    getMainWindow: () => mainWindow,
    neovimSource,
  });

  renderRuntime.registerRenderHandlers();

  registerUpdaterHandlers({
    updater: desktopUpdater,
    isQuitting: () => isQuitting,
  });
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext);
  return iconPath ? { icon: iconPath } : {};
}

function getInitialWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
}

function getWindowTitleBarOptions(): WindowTitleBarOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: nativeTheme.shouldUseDarkColors
        ? TITLEBAR_DARK_SYMBOL_COLOR
        : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function syncWindowAppearance(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  window.setBackgroundColor(getInitialWindowBackgroundColor());
  const { titleBarOverlay } = getWindowTitleBarOptions();
  if (typeof titleBarOverlay === "object") {
    window.setTitleBarOverlay(titleBarOverlay);
  }
}

function syncAllWindowAppearance(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    syncWindowAppearance(window);
  }
}

nativeTheme.on("updated", syncAllWindowAppearance);

function createWindow(): BrowserWindow {
  const isMain = mainWindow === null;
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: isDevelopment,
    autoHideMenuBar: true,
    backgroundColor: getInitialWindowBackgroundColor(),
    ...getIconOption(),
    title: APP_DISPLAY_NAME,
    ...getWindowTitleBarOptions(),
    webPreferences: {
      preload: Path.join(ELECTRON_DIST_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--fenrir-main-window=${isMain ? "1" : "0"}`],
    },
  });

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const menuTemplate: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: "No suggestions", enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    const externalUrl = getSafeExternalUrl(params.linkURL);
    if (externalUrl) {
      menuTemplate.push(
        {
          label: "Copy Link",
          click: () => clipboard.writeText(params.linkURL),
        },
        { type: "separator" },
      );
    }

    if (params.mediaType === "image") {
      menuTemplate.push({
        label: "Copy Image",
        click: () => window.webContents.copyImageAt(params.x, params.y),
      });
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuTemplate).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });
  window.webContents.on("did-finish-load", () => {
    window.setTitle(APP_DISPLAY_NAME);
    desktopUpdater.emitState();
  });
  if (!isDevelopment) {
    window.once("ready-to-show", () => {
      revealWindow(window);
    });
  }

  if (isDevelopment) {
    void window.loadURL(resolveDesktopDevServerUrl());
    window.webContents.openDevTools({ mode: "detach" });
    setImmediate(() => {
      revealWindow(window);
    });
  } else {
    void window.loadURL(resolveDesktopWindowUrl());
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      stopTrafficLensManager();
      stopVSCodeWebManager();
      mainWindow = null;
    }
  });

  return window;
}

function resolveDesktopWindowUrl(): string {
  return `${DESKTOP_SCHEME}://app`;
}

// Override Electron's userData path before the `ready` event so that
// Chromium session data uses a filesystem-friendly directory name.
// Must be called synchronously at the top level — before `app.whenReady()`.
app.setPath("userData", resolveUserDataPath());

configureAppIdentity();

async function bootstrap(): Promise<void> {
  writeDesktopLogHeader("bootstrap start");
  const configuredBackendPort = resolveConfiguredDesktopBackendPort(process.env.FENRIR_PORT);
  if (isDevelopment && configuredBackendPort === undefined) {
    throw new Error("FENRIR_PORT is required in desktop development.");
  }

  backendPort =
    configuredBackendPort ??
    (await resolveDesktopBackendPort({
      host: DESKTOP_LOOPBACK_HOST,
      startPort: DEFAULT_DESKTOP_BACKEND_PORT,
    }));
  writeDesktopLogHeader(
    configuredBackendPort === undefined
      ? `selected backend port via sequential scan startPort=${DEFAULT_DESKTOP_BACKEND_PORT} port=${backendPort}`
      : `using configured backend port port=${backendPort}`,
  );
  backendBootstrapToken = Crypto.randomBytes(24).toString("hex");
  if (desktopSettings.serverExposureMode !== DEFAULT_DESKTOP_SETTINGS.serverExposureMode) {
    writeDesktopLogHeader(
      `bootstrap restoring persisted server exposure mode mode=${desktopSettings.serverExposureMode}`,
    );
  }
  const serverExposureState = await applyDesktopServerExposureMode(
    desktopSettings.serverExposureMode,
    {
      persist: desktopSettings.serverExposureMode !== DEFAULT_DESKTOP_SETTINGS.serverExposureMode,
    },
  );
  writeDesktopLogHeader(`bootstrap resolved backend endpoint baseUrl=${backendHttpUrl}`);
  if (serverExposureState.endpointUrl) {
    writeDesktopLogHeader(
      `bootstrap enabled network access endpointUrl=${serverExposureState.endpointUrl}`,
    );
  } else if (desktopSettings.serverExposureMode === "network-accessible") {
    writeDesktopLogHeader(
      "bootstrap fell back to local-only because no advertised network host was available",
    );
  }

  registerIpcHandlers();
  writeDesktopLogHeader("bootstrap ipc handlers registered");
  // The backend inherits this process's environment. When the app is launched
  // from Finder/Dock the environment has no PATH additions and no locale
  // (LANG/LC_*), so the sync must happen BEFORE the backend spawns — a missing
  // UTF-8 locale makes tmux-backed terminals substitute every non-ASCII glyph
  // with "_" for the attached client.
  ensureDesktopShellEnvironmentSynced("bootstrap");
  backendLifecycle.start();
  writeDesktopLogHeader("bootstrap backend start requested");

  if (!isDevelopment) {
    await waitForBackendHttpReady(backendHttpUrl);
    writeDesktopLogHeader("bootstrap backend ready");
  }

  mainWindow = createWindow();
  ensureTrafficLensManager();
  writeDesktopLogHeader("bootstrap main window created");
  if (isDevelopment) {
    void waitForBackendHttpReady(backendHttpUrl)
      .then(() => {
        writeDesktopLogHeader("bootstrap backend ready");
      })
      .catch((error) => {
        if (isBackendReadinessAborted(error)) {
          return;
        }
        writeDesktopLogHeader(
          `bootstrap backend readiness warning message=${formatErrorMessage(error)}`,
        );
        console.warn("[desktop] backend readiness check timed out during dev bootstrap", error);
      });
  }
}

app.on("before-quit", () => {
  isQuitting = true;
  desktopUpdater.handleBeforeQuit();
  writeDesktopLogHeader("before-quit received");
  desktopUpdater.clearTimers();
  cancelBackendReadinessWait();
  stopTrafficLensManager();
  stopVSCodeWebManager();
  stopVpn();
  backendLifecycle.stop();
  // Fire-and-forget: nullifies nvimSession synchronously and walks the quit
  // ladder asynchronously. Worst case the OS reaps the orphan when we exit.
  void neovimIpc?.shutdownNvim("before-quit");
  renderRuntime.stopRenderLoop();
  void neovimSource.shutdown();
  restoreStdIoCapture?.();
});

app
  .whenReady()
  .then(() => {
    writeDesktopLogHeader("app ready");
    configureAppIdentity();
    configureApplicationMenu();
    registerDesktopProtocol();
    desktopUpdater.configure();
    void bootstrap().catch((error) => {
      if (isBackendReadinessAborted(error) && isQuitting) {
        return;
      }
      handleFatalStartupError("bootstrap", error);
    });

    app.on("activate", () => {
      const existingWindow = mainWindow ?? BrowserWindow.getAllWindows()[0];
      if (existingWindow) {
        revealWindow(existingWindow);
        return;
      }
      mainWindow = createWindow();
      ensureTrafficLensManager();
    });
  })
  .catch((error) => {
    handleFatalStartupError("whenReady", error);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) {
    app.quit();
  }
});

if (process.platform !== "win32") {
  process.on("SIGINT", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGINT received");
    desktopUpdater.clearTimers();
    cancelBackendReadinessWait();
    stopTrafficLensManager();
    stopVSCodeWebManager();
    stopVpn();
    backendLifecycle.stop();
    restoreStdIoCapture?.();
    app.quit();
  });

  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGTERM received");
    desktopUpdater.clearTimers();
    stopTrafficLensManager();
    stopVSCodeWebManager();
    stopVpn();
    backendLifecycle.stop();
    restoreStdIoCapture?.();
    app.quit();
  });
}
