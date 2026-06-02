import * as ChildProcess from "node:child_process";
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
  ipcMain,
  MessageChannelMain,
  type MessagePortMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type {
  ClientSettings,
  DesktopTheme,
  DesktopServerExposureMode,
  DesktopServerExposureState,
  Frame,
  InputEvent,
  PersistedSavedEnvironmentRecord,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  VSCodeShortcutState,
} from "@fenrir/contracts";
import { autoUpdater } from "electron-updater";

import type { ContextMenuItem } from "@fenrir/contracts";
import {
  EDITOR_CMD_CHANNEL,
  EDITOR_EVENT_CHANNEL,
  EDITOR_INVOKE_BRIDGE_CHANNEL,
  EDITOR_OPEN_FILE_CHANNEL,
  EDITOR_SEND_TO_COMPOSER_CHANNEL,
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
import {
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettings,
  setDesktopServerExposurePreference,
  writeDesktopSettings,
} from "../settings/DesktopAppSettings";
import {
  readClientSettings,
  readSavedEnvironmentRegistry,
  readSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  writeClientSettings,
  writeSavedEnvironmentRegistry,
  writeSavedEnvironmentSecret,
} from "../settings/DesktopClientSettings";
import { showDesktopConfirmDialog } from "../electron/ElectronDialog";
import { resolveDesktopServerExposure } from "../backend/DesktopServerExposure";
import { syncShellEnvironment } from "../shell/DesktopShellEnvironment";
import {
  getAutoUpdateDisabledReason,
  shouldBroadcastDownloadProgress,
} from "../updates/DesktopUpdates";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "../updates/updateMachine";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./DesktopRuntimeArch";
import { readVpnProfiles, addVpnProfile, removeVpnProfile } from "../vpnSettings";
import {
  checkOpenvpnInstalled,
  connectVpn,
  disconnectVpn,
  getVpnState,
  initVpnManager,
  onVpnStateChange,
  stopVpn,
} from "../vpnManager";
import { createTrafficLensManager, type TrafficLensManager } from "../window/DesktopWindow";
import { RenderLoop } from "../render/RenderLoop";
import { FENRIR_EXIT_LUA, FENRIR_INIT_LUA, NeovimSource } from "../neovim";
import { probeNvim } from "../neovim/probe";
import { createVSCodeWebManager, probeVSCodeWeb, type VSCodeWebManager } from "../vscode";

syncShellEnvironment();

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:get-saved-environment-registry";
const SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:set-saved-environment-registry";
const GET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:get-saved-environment-secret";
const SET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:set-saved-environment-secret";
const REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:remove-saved-environment-secret";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";
const VPN_GET_STATE_CHANNEL = "desktop:vpn-get-state";
const VPN_GET_PROFILES_CHANNEL = "desktop:vpn-get-profiles";
const VPN_ADD_PROFILE_CHANNEL = "desktop:vpn-add-profile";
const VPN_REMOVE_PROFILE_CHANNEL = "desktop:vpn-remove-profile";
const VPN_CONNECT_CHANNEL = "desktop:vpn-connect";
const VPN_DISCONNECT_CHANNEL = "desktop:vpn-disconnect";
const VPN_STATE_CHANNEL = "desktop:vpn-state";
const PICK_FILE_CHANNEL = "desktop:pick-file";
const TRAFFIC_LENS_CREATE_TAB_CHANNEL = "desktop:traffic-lens-create-tab";
const TRAFFIC_LENS_CLOSE_TAB_CHANNEL = "desktop:traffic-lens-close-tab";
const TRAFFIC_LENS_NAVIGATE_CHANNEL = "desktop:traffic-lens-navigate";
const TRAFFIC_LENS_GO_BACK_CHANNEL = "desktop:traffic-lens-go-back";
const TRAFFIC_LENS_GO_FORWARD_CHANNEL = "desktop:traffic-lens-go-forward";
const TRAFFIC_LENS_RELOAD_CHANNEL = "desktop:traffic-lens-reload";
const TRAFFIC_LENS_GET_TABS_CHANNEL = "desktop:traffic-lens-get-tabs";
const TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL = "desktop:traffic-lens-set-tab-view-mode";
const TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL = "desktop:traffic-lens-set-tab-mobile-preset";
const TRAFFIC_LENS_SET_BOUNDS_CHANNEL = "desktop:traffic-lens-set-bounds";
const TRAFFIC_LENS_SHOW_TAB_CHANNEL = "desktop:traffic-lens-show-tab";
const TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL = "desktop:traffic-lens-hide-all-tabs";
const TRAFFIC_LENS_TAB_EVENT_CHANNEL = "desktop:traffic-lens-tab-event";
const TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL = "desktop:traffic-lens-create-tab-in-profile";
const TRAFFIC_LENS_LIST_RULES_CHANNEL = "desktop:traffic-lens-list-rules";
const TRAFFIC_LENS_CREATE_RULE_CHANNEL = "desktop:traffic-lens-create-rule";
const TRAFFIC_LENS_UPDATE_RULE_CHANNEL = "desktop:traffic-lens-update-rule";
const TRAFFIC_LENS_DELETE_RULE_CHANNEL = "desktop:traffic-lens-delete-rule";
const TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL = "desktop:traffic-lens-set-rule-enabled";
const TRAFFIC_LENS_LIST_PAUSED_CHANNEL = "desktop:traffic-lens-list-paused";
const TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL = "desktop:traffic-lens-continue-paused";
const TRAFFIC_LENS_DROP_PAUSED_CHANNEL = "desktop:traffic-lens-drop-paused";
const TRAFFIC_LENS_LIST_PROFILES_CHANNEL = "desktop:traffic-lens-list-profiles";
const TRAFFIC_LENS_CREATE_PROFILE_CHANNEL = "desktop:traffic-lens-create-profile";
const TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL = "desktop:traffic-lens-update-profile";
const TRAFFIC_LENS_DELETE_PROFILE_CHANNEL = "desktop:traffic-lens-delete-profile";
const TRAFFIC_LENS_GET_COOKIES_CHANNEL = "desktop:traffic-lens-get-cookies";
const TRAFFIC_LENS_SET_COOKIE_CHANNEL = "desktop:traffic-lens-set-cookie";
const TRAFFIC_LENS_DELETE_COOKIE_CHANNEL = "desktop:traffic-lens-delete-cookie";
const TRAFFIC_LENS_GET_STORAGE_CHANNEL = "desktop:traffic-lens-get-storage";
const TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL = "desktop:traffic-lens-set-storage-entry";
const TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL = "desktop:traffic-lens-delete-storage-entry";
const TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL = "desktop:traffic-lens-list-storage-origins";
const TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL = "desktop:traffic-lens-capture-storage-origin";
const TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL = "desktop:traffic-lens-get-applicable-cookies";
const TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL = "desktop:traffic-lens-set-cookie-for-origin";
const TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL =
  "desktop:traffic-lens-delete-cookie-for-origin";
const TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-get-local-storage";
const TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL = "desktop:traffic-lens-set-local-storage-item";
const TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-local-storage-item";
const TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-clear-local-storage";
const TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-get-live-session-storage";
const TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-set-live-session-storage-item";
const TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-live-session-storage-item";
const TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-clear-live-session-storage";
const TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL =
  "desktop:traffic-lens-list-session-storage-snapshots";
const TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-get-session-storage-snapshot";
const TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-update-session-storage-snapshot";
const TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-rehydrate-session-storage-snapshot";
const TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL = "desktop:traffic-lens-list-overrides";
const TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-create-override";
const TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-update-override";
const TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL = "desktop:traffic-lens-delete-override";
const TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL = "desktop:traffic-lens-set-override-enabled";
const TRAFFIC_LENS_PAUSED_EVENT_CHANNEL = "desktop:traffic-lens-paused-event";
const TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL = "desktop:traffic-lens-storage-changed";
const TRAFFIC_LENS_STORAGE_EVENT_CHANNEL = "desktop:traffic-lens-storage-event";
const NEOVIM_ATTACH_CHANNEL = "desktop:neovim-attach";
const NEOVIM_DETACH_CHANNEL = "desktop:neovim-detach";
const NEOVIM_INPUT_CHANNEL = "desktop:neovim-input";
const NEOVIM_RESIZE_CHANNEL = "desktop:neovim-resize";
const NEOVIM_REDRAW_CHANNEL = "desktop:neovim-redraw";
const NEOVIM_SET_CWD_CHANNEL = "desktop:neovim-set-cwd";
const RENDER_START_CHANNEL = "desktop:render-start";
const RENDER_STOP_CHANNEL = "desktop:render-stop";
const RENDER_SET_FPS_CHANNEL = "desktop:render-set-fps";
const RENDER_SYNC_VIEWPORT_CHANNEL = "desktop:render-sync-viewport";
const RENDER_INPUT_CHANNEL = "desktop:render-input";
const RENDER_FRAME_PORT_CHANNEL = "desktop:render-frame-port";
const RENDER_SET_EDITOR_FONT_METRICS_CHANNEL = "desktop:render-set-editor-font-metrics";
const NVIM_AVAILABLE_CHANNEL = "desktop:nvim-available";
const VSCODE_AVAILABLE_CHANNEL = "desktop:vscode-available";
const VSCODE_PROBE_DETAIL_CHANNEL = "desktop:vscode-probe-detail";
const VSCODE_START_CHANNEL = "desktop:vscode-start";
const VSCODE_OPEN_FILE_CHANNEL = "desktop:vscode-open-file";
const VSCODE_SET_BOUNDS_CHANNEL = "desktop:vscode-set-bounds";
const VSCODE_SHOW_CHANNEL = "desktop:vscode-show";
const VSCODE_HIDE_CHANNEL = "desktop:vscode-hide";
const VSCODE_SET_SHORTCUT_STATE_CHANNEL = "desktop:vscode-set-shortcut-state";
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
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DESKTOP_UPDATE_CHANNEL = "latest";
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
const DESKTOP_LOOPBACK_HOST = "127.0.0.1";
const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";

type WindowTitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];
type LinuxDesktopNamedApp = Electron.App & {
  setDesktopName?: (desktopName: string) => void;
};

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
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
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
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
let browserLabControlSocket: WebSocket | null = null;
let browserLabControlReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let browserLabControlReconnectAttempt = 0;
let nvimSession: {
  client: any;
  proc: ChildProcess.ChildProcessWithoutNullStreams;
} | null = null;
let renderFramePort: MessagePortMain | null = null;

const renderLoop = new RenderLoop({
  fps: 60,
  emit: (frame: Frame) => {
    renderFramePort?.postMessage(frame);
  },
});
const neovimSource = new NeovimSource(process.env.HOME ?? process.cwd());
renderLoop.setSource(neovimSource);
let backendObservabilitySettings = readPersistedBackendObservabilitySettings();
let desktopSettings = readDesktopSettings(DESKTOP_SETTINGS_PATH);
let desktopServerExposureMode: DesktopServerExposureMode = desktopSettings.serverExposureMode;

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;
const NVIM_PROBE_DETAIL_CHANNEL = "desktop:nvim-probe-detail";

const expectedBackendExitChildren = new WeakSet<ChildProcess.ChildProcess>();
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const initialUpdateState = (): DesktopUpdateState =>
  createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo);

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
    clearUpdatePollTimer();
    cancelBackendReadinessWait();
    void stopBackendAndWaitForExit()
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

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeTheme(rawTheme: unknown): DesktopTheme | null {
  if (rawTheme === "light" || rawTheme === "dark" || rawTheme === "system") {
    return rawTheme;
  }

  return null;
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableString(
  input: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in input)) {
    return undefined;
  }
  const value = input[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string or null.`);
  }
  return value;
}

function makeProfilePartitionKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `persist:traffic-lens:${slug || "profile"}`;
}

function normalizeStorageOrigin(value: string): string {
  return URL.canParse(value) ? new URL(value).origin : value;
}

function getTabSnapshot(manager: TrafficLensManager, tabId: string) {
  const tab = manager.getTabs().find((candidate) => candidate.tabId === tabId);
  if (!tab) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  return tab;
}

function activeTabStorageScope(
  manager: TrafficLensManager,
  input: Record<string, unknown>,
  options?: { readonly requireLiveTab?: boolean },
) {
  const tabId = optionalString(input, "tabId");
  const profileId = optionalString(input, "profileId");
  const requestedOrigin = optionalString(input, "origin");
  if (profileId && requestedOrigin && !options?.requireLiveTab) {
    return {
      profileId,
      origin: normalizeStorageOrigin(requestedOrigin),
      ...(tabId ? { tabId } : {}),
    };
  }

  const activeTab = tabId ? getTabSnapshot(manager, tabId) : manager.ensureActiveTab();
  const url = requestedOrigin ?? (activeTab.url ? activeTab.url : "about:blank");
  const origin = normalizeStorageOrigin(url);
  return {
    profileId: profileId ?? activeTab.profileId,
    origin,
    tabId: tabId ?? activeTab.tabId,
  };
}

function browserLabProfileInput(input: Record<string, unknown>) {
  const name = requiredString(input, "name");
  const id = optionalString(input, "id");
  const userAgentPreset = optionalString(input, "userAgentPreset");
  const proxyPreset = optionalNullableString(input, "proxyPreset");
  const notes = optionalNullableString(input, "notes");
  return {
    ...(id ? { id } : {}),
    name,
    partitionKey: optionalString(input, "partitionKey") ?? makeProfilePartitionKey(name),
    ...(userAgentPreset ? { userAgentPreset } : {}),
    ...(proxyPreset !== undefined ? { proxyPreset } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function browserLabProfilePatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  const name = optionalString(input, "name");
  if (name) {
    patch.name = name;
  }
  const partitionKey = optionalString(input, "partitionKey");
  if (partitionKey) {
    patch.partitionKey = partitionKey;
  }
  const userAgentPreset = optionalString(input, "userAgentPreset");
  if (userAgentPreset) {
    patch.userAgentPreset = userAgentPreset;
  }
  const proxyPreset = optionalNullableString(input, "proxyPreset");
  if (proxyPreset !== undefined) {
    patch.proxyPreset = proxyPreset;
  }
  const notes = optionalNullableString(input, "notes");
  if (notes !== undefined) {
    patch.notes = notes;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("At least one profile field is required.");
  }
  return patch;
}

async function handleBrowserLabControlMethod(method: string, params: unknown): Promise<unknown> {
  const manager = ensureTrafficLensManager();
  const input = asRecord(params);

  switch (method) {
    case "browser_lab_list_tabs":
      return manager.getTabs();
    case "browser_lab_get_active_tab":
      return manager.getActiveTab() ?? manager.ensureActiveTab();
    case "browser_lab_create_tab":
      return typeof input.profileId === "string"
        ? manager.createTabInProfile({
            profileId: input.profileId,
            ...(typeof input.url === "string" ? { url: input.url } : {}),
          })
        : manager.createTab(typeof input.url === "string" ? input.url : undefined);
    case "browser_lab_create_tab_in_profile": {
      const profileId = requiredString(input, "profileId");
      return manager.createTabInProfile({
        profileId,
        ...(typeof input.url === "string" ? { url: input.url } : {}),
      });
    }
    case "browser_lab_select_tab": {
      if (typeof input.tabId !== "string") throw new Error("tabId is required.");
      return manager.setActiveTab(input.tabId);
    }
    case "browser_lab_close_tab": {
      if (typeof input.tabId !== "string") throw new Error("tabId is required.");
      manager.closeTab(input.tabId);
      return { closed: true };
    }
    case "browser_lab_navigate": {
      const tab = typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId;
      const url = typeof input.url === "string" ? input.url : "";
      if (!url) throw new Error("url is required.");
      manager.navigateTab(tab, url);
      return manager.getActiveTab();
    }
    case "browser_lab_back": {
      manager.goBack(
        typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
      );
      return { ok: true };
    }
    case "browser_lab_forward": {
      manager.goForward(
        typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
      );
      return { ok: true };
    }
    case "browser_lab_reload": {
      manager.reloadTab(
        typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
      );
      return { ok: true };
    }
    case "browser_lab_wait_for_load":
      return manager.waitForTabLoad(input as any);
    case "browser_lab_snapshot":
      return manager.capturePageSnapshot(typeof input.tabId === "string" ? input.tabId : undefined);
    case "browser_lab_screenshot":
      return manager.captureScreenshot(typeof input.tabId === "string" ? input.tabId : undefined);
    case "browser_lab_click":
      await manager.clickPage(input as any);
      return { ok: true };
    case "browser_lab_type":
      if (typeof input.text !== "string") throw new Error("text is required.");
      await manager.typeIntoPage(input as any);
      return { ok: true };
    case "browser_lab_press":
      if (typeof input.key !== "string") throw new Error("key is required.");
      await manager.pressPage(input as any);
      return { ok: true };
    case "browser_lab_get_cookies":
      return manager.getCookies(
        typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
      );
    case "browser_lab_get_local_storage": {
      const scope = activeTabStorageScope(manager, input);
      return manager.getLocalStorage(scope as any);
    }
    case "browser_lab_set_local_storage_item": {
      const scope = activeTabStorageScope(manager, input);
      await manager.setLocalStorageItem({ ...scope, ...input } as any);
      return { ok: true };
    }
    case "browser_lab_delete_local_storage_item": {
      const scope = activeTabStorageScope(manager, input);
      await manager.deleteLocalStorageItem({ ...scope, ...input } as any);
      return { ok: true };
    }
    case "browser_lab_get_session_storage": {
      const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
      return manager.getLiveSessionStorage(scope as any);
    }
    case "browser_lab_set_session_storage_item": {
      const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
      await manager.setLiveSessionStorageItem({ ...scope, ...input } as any);
      return { ok: true };
    }
    case "browser_lab_delete_session_storage_item": {
      const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
      await manager.deleteLiveSessionStorageItem({ ...scope, ...input } as any);
      return { ok: true };
    }
    case "traffic_lens_list_paused_requests":
      return manager.listPaused();
    case "traffic_lens_continue_paused_request":
      await manager.continuePaused(input as any);
      return { ok: true };
    case "traffic_lens_drop_paused_request":
      await manager.dropPaused(input as any);
      return { ok: true };
    case "traffic_lens_list_profiles":
      return manager.listProfiles();
    case "traffic_lens_create_profile":
      return manager.createProfile(browserLabProfileInput(input) as any);
    case "traffic_lens_update_profile":
      return manager.updateProfile(
        requiredString(input, "id"),
        browserLabProfilePatch(input) as any,
      );
    case "traffic_lens_delete_profile":
      manager.deleteProfile(requiredString(input, "id"));
      return { ok: true };
    case "traffic_lens_list_rules":
      return manager.listRules();
    case "traffic_lens_upsert_rule": {
      const ruleInput = asRecord(input.input ?? input);
      return typeof input.id === "string"
        ? manager.updateRule(input.id, ruleInput as any)
        : manager.createRule(ruleInput as any);
    }
    case "traffic_lens_delete_rule":
      if (typeof input.id !== "string") throw new Error("id is required.");
      manager.deleteRule(input.id);
      return { ok: true };
    case "traffic_lens_set_rule_enabled":
      if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
        throw new Error("id and enabled are required.");
      }
      manager.setRuleEnabled(input.id, input.enabled);
      return { ok: true };
    case "traffic_lens_list_overrides":
      return manager.listOverrides();
    case "traffic_lens_upsert_override": {
      const overrideInput = asRecord(input.input ?? input);
      return typeof input.id === "string"
        ? manager.updateOverride(input.id, overrideInput as any)
        : manager.createOverride(overrideInput as any);
    }
    case "traffic_lens_delete_override":
      if (typeof input.id !== "string") throw new Error("id is required.");
      manager.deleteOverride(input.id);
      return { ok: true };
    case "traffic_lens_set_override_enabled":
      if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
        throw new Error("id and enabled are required.");
      }
      manager.setOverrideEnabled(input.id, input.enabled);
      return { ok: true };
    case "traffic_lens_list_storage_origins":
      return manager.listStorageOrigins(requiredString(input, "profileId"));
    case "traffic_lens_capture_storage_origin":
      await manager.captureStorageOrigin({
        profileId: requiredString(input, "profileId") as any,
        origin: normalizeStorageOrigin(requiredString(input, "origin")),
        ...(typeof input.tabId === "string" ? { tabId: input.tabId } : {}),
      });
      return { ok: true };
    case "traffic_lens_get_cookies_for_origin":
      return manager.getApplicableCookies({
        profileId: requiredString(input, "profileId") as any,
        origin: normalizeStorageOrigin(requiredString(input, "origin")),
      });
    case "traffic_lens_set_cookie_for_origin":
      await manager.setCookieForOrigin(input as any);
      return { ok: true };
    case "traffic_lens_delete_cookie_for_origin":
      await manager.deleteCookieForOrigin(input as any);
      return { ok: true };
    case "browser_lab_clear_local_storage": {
      const scope = activeTabStorageScope(manager, input);
      await manager.clearLocalStorage(scope as any);
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported Browser Lab control method: ${method}`);
  }
}

function stopBrowserLabControlClient(): void {
  if (browserLabControlReconnectTimer) {
    clearTimeout(browserLabControlReconnectTimer);
    browserLabControlReconnectTimer = null;
  }
  const socket = browserLabControlSocket;
  browserLabControlSocket = null;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}

function scheduleBrowserLabControlReconnect(): void {
  if (isQuitting || browserLabControlReconnectTimer || !backendWsUrl || !backendBootstrapToken) {
    return;
  }
  const delayMs = Math.min(500 * 2 ** browserLabControlReconnectAttempt, 10_000);
  browserLabControlReconnectAttempt += 1;
  browserLabControlReconnectTimer = setTimeout(() => {
    browserLabControlReconnectTimer = null;
    startBrowserLabControlClient();
  }, delayMs);
  browserLabControlReconnectTimer.unref?.();
}

function startBrowserLabControlClient(): void {
  if (isQuitting || !backendWsUrl || !backendBootstrapToken) return;
  if (
    browserLabControlSocket &&
    (browserLabControlSocket.readyState === WebSocket.CONNECTING ||
      browserLabControlSocket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const url = `${backendWsUrl}/api/browser-lab/control/ws?token=${encodeURIComponent(
    backendBootstrapToken,
  )}`;
  const socket = new WebSocket(url);
  browserLabControlSocket = socket;

  socket.addEventListener("open", () => {
    browserLabControlReconnectAttempt = 0;
  });
  socket.addEventListener("message", (event) => {
    void (async () => {
      const request = JSON.parse(String(event.data)) as {
        id?: unknown;
        method?: unknown;
        params?: unknown;
      };
      if (typeof request.id !== "number" || typeof request.method !== "string") {
        return;
      }
      try {
        const result = await handleBrowserLabControlMethod(request.method, request.params);
        socket.send(JSON.stringify({ id: request.id, result }));
      } catch (error) {
        socket.send(
          JSON.stringify({
            id: request.id,
            error: { message: formatErrorMessage(error) },
          }),
        );
      }
    })().catch(() => undefined);
  });
  socket.addEventListener("close", () => {
    if (browserLabControlSocket === socket) {
      browserLabControlSocket = null;
    }
    scheduleBrowserLabControlReconnect();
  });
  socket.addEventListener("error", () => {
    if (browserLabControlSocket === socket) {
      browserLabControlSocket = null;
    }
    try {
      socket.close();
    } catch {
      // Ignore close failures from already-closed sockets.
    }
    scheduleBrowserLabControlReconnect();
  });
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
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
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
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = initialUpdateState();

function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (updateInstallInFlight) return "install";
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
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

/** Read the baked-in app-update.yml config (if applicable). */
function readAppUpdateYml(): Record<string, string> | null {
  try {
    // electron-updater reads from process.resourcesPath in packaged builds,
    // or dev-app-update.yml via app.getAppPath() in dev.
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    // The YAML is simple key-value pairs — avoid pulling in a YAML parser by
    // doing a line-based parse (fields: provider, owner, repo, releaseType, …).
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
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
  stopBackend();
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

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 });
          return;
        }
        callback({ path: fallbackIndex });
        return;
      }

      callback({ path: resolvedCandidate });
    } catch {
      callback({ path: fallbackIndex });
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
  const hasUpdateFeedConfig =
    readAppUpdateYml() !== null || Boolean(process.env.FENRIR_DESKTOP_MOCK_UPDATES);
  const disabledReason = getAutoUpdateDisabledReason({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: process.env.FENRIR_DISABLE_AUTO_UPDATE === "1",
    hasUpdateFeedConfig,
  });
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
  await checkForUpdates("menu");

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

function clearUpdatePollTimer(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
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

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function shouldEnableAutoUpdates(): boolean {
  const hasUpdateFeedConfig =
    readAppUpdateYml() !== null || Boolean(process.env.FENRIR_DESKTOP_MOCK_UPDATES);
  return (
    getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.FENRIR_DISABLE_AUTO_UPDATE === "1",
      hasUpdateFeedConfig,
    }) === null
  );
}

async function checkForUpdates(reason: string): Promise<boolean> {
  if (isQuitting || !updaterConfigured || updateCheckInFlight) return false;
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${updateState.status}.`,
    );
    return false;
  }
  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  console.info(`[desktop-updater] Checking for updates (${reason})...`);

  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    return true;
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }
  updateDownloadInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  console.info("[desktop-updater] Downloading update...");

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  updateInstallInFlight = true;
  clearUpdatePollTimer();
  try {
    await stopBackendAndWaitForExit();
    // Destroy all windows before launching the NSIS installer to avoid the installer finding live windows it needs to close.
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy();
    }
    // `quitAndInstall()` only starts the handoff to the updater. The actual
    // install may still fail asynchronously, so keep the action incomplete
    // until we either quit or receive an updater error.
    autoUpdater.quitAndInstall(true, true);
    return { accepted: true, completed: false };
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    updateInstallInFlight = false;
    isQuitting = false;
    setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const githubToken =
    process.env.FENRIR_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  if (githubToken) {
    // When a token is provided, re-configure the feed with `private: true` so
    // electron-updater uses the GitHub API (api.github.com) instead of the
    // public Atom feed (github.com/…/releases.atom) which rejects Bearer auth.
    const appUpdateYml = readAppUpdateYml();
    if (appUpdateYml?.provider === "github") {
      autoUpdater.setFeedURL({
        ...appUpdateYml,
        provider: "github" as const,
        private: true,
        token: githubToken,
      });
    }
  }

  if (process.env.FENRIR_DESKTOP_MOCK_UPDATES) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `http://localhost:${process.env.FENRIR_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000}`,
    });
  }

  const enabled = shouldEnableAutoUpdates();
  setUpdateState({
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
  });
  if (!enabled) {
    return;
  }
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Keep alpha branding, but force all installs onto the stable update track.
  autoUpdater.channel = DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  let lastLoggedDownloadMilestone = -1;

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }

  autoUpdater.on("checking-for-update", () => {
    console.info("[desktop-updater] Looking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        updateState,
        info.version,
        new Date().toISOString(),
      ),
    );
    lastLoggedDownloadMilestone = -1;
    console.info(`[desktop-updater] Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    lastLoggedDownloadMilestone = -1;
    console.info("[desktop-updater] No updates available.");
  });
  autoUpdater.on("error", (error) => {
    const message = formatErrorMessage(error);
    if (updateInstallInFlight) {
      updateInstallInFlight = false;
      isQuitting = false;
      setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
      console.error(`[desktop-updater] Updater error: ${message}`);
      return;
    }
    if (!updateCheckInFlight && !updateDownloadInFlight) {
      setUpdateState({
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: resolveUpdaterErrorContext(),
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      });
    }
    console.error(`[desktop-updater] Updater error: ${message}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    if (
      shouldBroadcastDownloadProgress(updateState, progress.percent) ||
      updateState.message !== null
    ) {
      setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
    }
    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[desktop-updater] Download progress: ${percent}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });

  clearUpdatePollTimer();

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}
function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  backendObservabilitySettings = readPersistedBackendObservabilitySettings();
  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const captureBackendLogs = app.isPackaged && backendLogSink !== null;
  const child = ChildProcess.spawn(process.execPath, [backendEntry, "--bootstrap-fd", "3"], {
    cwd: resolveBackendCwd(),
    // In Electron main, process.execPath points to the Electron binary.
    // Run the child in Node mode so this backend process does not become a GUI app instance.
    env: {
      ...backendChildEnv(),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: captureBackendLogs
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "inherit", "inherit", "pipe"],
  });
  const bootstrapStream = child.stdio[3];
  if (bootstrapStream && "write" in bootstrapStream) {
    bootstrapStream.write(
      `${JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port: backendPort,
        fenrirHome: BASE_DIR,
        host: backendBindHost,
        desktopBootstrapToken: backendBootstrapToken,
        ...(backendObservabilitySettings.otlpTracesUrl
          ? { otlpTracesUrl: backendObservabilitySettings.otlpTracesUrl }
          : {}),
        ...(backendObservabilitySettings.otlpMetricsUrl
          ? { otlpMetricsUrl: backendObservabilitySettings.otlpMetricsUrl }
          : {}),
      })}\n`,
    );
    bootstrapStream.end();
  } else {
    child.kill("SIGTERM");
    scheduleBackendRestart("missing desktop bootstrap pipe");
    return;
  }
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
    void waitForBackendHttpReady(backendHttpUrl)
      .then(() => {
        startBrowserLabControlClient();
      })
      .catch(() => undefined);
  });

  child.on("error", (error) => {
    stopBrowserLabControlClient();
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    if (wasExpected) {
      return;
    }
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    stopBrowserLabControlClient();
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting || wasExpected) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}

function stopBackend(): void {
  cancelBackendReadinessWait();
  stopBrowserLabControlClient();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    expectedBackendExitChildren.add(child);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }
}

async function stopBackendAndWaitForExit(timeoutMs = 5_000): Promise<void> {
  cancelBackendReadinessWait();
  stopBrowserLabControlClient();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  const backendChild = child;
  if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;
  expectedBackendExitChildren.add(backendChild);

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

/**
 * Run the embedded Neovim's exit handler (force-quit via Lua), then escalate
 * to SIGTERM/SIGKILL with timeouts. Mirrors neovide's pattern of asking
 * Neovim to quit itself before tearing down the process — without this we
 * SIGTERM into modified buffers and lose unsaved work / hang on prompts.
 *
 * Always nulls `nvimSession` synchronously before awaiting, so concurrent
 * callers don't double-shutdown the same session.
 */
async function shutdownNvim(reason: string): Promise<void> {
  const session = nvimSession;
  if (!session) return;
  nvimSession = null;
  console.log(`[neovim:main] shutdown (${reason})`);

  const exitPromise = new Promise<void>((resolve) => {
    if (session.proc.exitCode !== null || session.proc.signalCode !== null) {
      resolve();
      return;
    }
    session.proc.once("exit", () => resolve());
  });

  const isAlive = () => session.proc.exitCode === null && session.proc.signalCode === null;

  // 1. Ask Neovim to quit itself. Don't await this past the deadline — the
  //    RPC reply never comes when nvim exits before responding (see
  //    neovim/neovim#26743), so we time out and fall through to wait on exit.
  try {
    await Promise.race([
      session.client.request("nvim_exec_lua", [FENRIR_EXIT_LUA, []]),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);
  } catch (e) {
    // Common when nvim exited mid-request; not fatal.
    console.log("[neovim:main] exec_lua quit returned error (expected on quick exit):", e);
  }

  // 2. Wait for actual process exit.
  await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 1_500))]);

  // 3. Escalate if still alive.
  if (isAlive()) {
    console.warn("[neovim:main] graceful quit timed out — sending SIGTERM");
    try {
      session.proc.kill("SIGTERM");
    } catch (e) {
      console.warn("[neovim:main] SIGTERM threw:", e);
    }
    await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  }
  if (isAlive()) {
    console.warn("[neovim:main] SIGTERM ignored — sending SIGKILL");
    try {
      session.proc.kill("SIGKILL");
    } catch (e) {
      console.warn("[neovim:main] SIGKILL threw:", e);
    }
  }
}

function parseInputEvent(payload: unknown): InputEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const kind = p["kind"];
  if (kind === "key") {
    const type = p["type"];
    if (type !== "down" && type !== "up") return null;
    if (typeof p["key"] !== "string" || typeof p["code"] !== "string") return null;
    return {
      kind: "key",
      type,
      key: p["key"],
      code: p["code"],
      mods: parseMods(p["mods"]),
    };
  }
  if (kind === "paste") {
    if (typeof p["text"] !== "string") return null;
    return { kind: "paste", text: p["text"] };
  }
  if (kind === "mouse") {
    const type = p["type"];
    if (type !== "down" && type !== "up" && type !== "move" && type !== "wheel") return null;
    if (typeof p["x"] !== "number" || typeof p["y"] !== "number") return null;
    const button = p["button"];
    const buttonOk = button === undefined || button === 0 || button === 1 || button === 2;
    if (!buttonOk) return null;
    const ev: InputEvent = {
      kind: "mouse",
      type,
      x: p["x"],
      y: p["y"],
      mods: parseMods(p["mods"]),
    };
    if (button === 0 || button === 1 || button === 2) ev.button = button;
    if (typeof p["deltaX"] === "number") ev.deltaX = p["deltaX"];
    if (typeof p["deltaY"] === "number") ev.deltaY = p["deltaY"];
    return ev;
  }
  if (kind === "resize") {
    if (typeof p["w"] !== "number" || typeof p["h"] !== "number") return null;
    return { kind: "resize", w: p["w"], h: p["h"] };
  }
  return null;
}

function parseMods(value: unknown): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
} {
  if (typeof value !== "object" || value === null) {
    return { ctrl: false, alt: false, shift: false, meta: false };
  }
  const m = value as Record<string, unknown>;
  return {
    ctrl: !!m["ctrl"],
    alt: !!m["alt"],
    shift: !!m["shift"],
    meta: !!m["meta"],
  };
}

function sanitizeForIpc(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sanitizeForIpc);
  if (
    val !== null &&
    typeof val === "object" &&
    "data" in val &&
    (val as any).data instanceof Uint8Array
  ) {
    return Buffer.from((val as any).data).readUInt32BE(0);
  }
  return val;
}

function replaceRenderFramePort(next: MessagePortMain | null): void {
  try {
    renderFramePort?.close();
  } catch (error) {
    console.warn("[render] closing previous frame port failed:", error);
  }
  renderFramePort = next;
  renderFramePort?.start();
}

function registerIpcHandlers(): void {
  ipcMain.removeAllListeners(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
  ipcMain.on(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL, (event) => {
    event.returnValue = {
      label: "Local environment",
      httpBaseUrl: backendHttpUrl || null,
      wsBaseUrl: backendWsUrl || null,
      bootstrapToken: backendBootstrapToken || undefined,
    } as const;
  });

  ipcMain.removeHandler(GET_CLIENT_SETTINGS_CHANNEL);
  ipcMain.handle(GET_CLIENT_SETTINGS_CHANNEL, async () => readClientSettings(CLIENT_SETTINGS_PATH));

  ipcMain.removeHandler(SET_CLIENT_SETTINGS_CHANNEL);
  ipcMain.handle(SET_CLIENT_SETTINGS_CHANNEL, async (_event, rawSettings: unknown) => {
    if (typeof rawSettings !== "object" || rawSettings === null) {
      throw new Error("Invalid client settings payload.");
    }

    writeClientSettings(CLIENT_SETTINGS_PATH, rawSettings as ClientSettings);
  });

  ipcMain.removeHandler(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL);
  ipcMain.handle(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, async () =>
    readSavedEnvironmentRegistry(SAVED_ENVIRONMENT_REGISTRY_PATH),
  );

  ipcMain.removeHandler(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL);
  ipcMain.handle(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, async (_event, rawRecords: unknown) => {
    if (!Array.isArray(rawRecords)) {
      throw new Error("Invalid saved environment registry payload.");
    }

    writeSavedEnvironmentRegistry(
      SAVED_ENVIRONMENT_REGISTRY_PATH,
      rawRecords as readonly PersistedSavedEnvironmentRecord[],
    );
  });

  ipcMain.removeHandler(GET_SAVED_ENVIRONMENT_SECRET_CHANNEL);
  ipcMain.handle(
    GET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
    async (_event, rawEnvironmentId: unknown) => {
      if (typeof rawEnvironmentId !== "string" || rawEnvironmentId.trim().length === 0) {
        return null;
      }

      return readSavedEnvironmentSecret({
        registryPath: SAVED_ENVIRONMENT_REGISTRY_PATH,
        environmentId: rawEnvironmentId,
        secretStorage: getDesktopSecretStorage(),
      });
    },
  );

  ipcMain.removeHandler(SET_SAVED_ENVIRONMENT_SECRET_CHANNEL);
  ipcMain.handle(
    SET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
    async (_event, rawEnvironmentId: unknown, rawSecret: unknown) => {
      if (typeof rawEnvironmentId !== "string" || rawEnvironmentId.trim().length === 0) {
        throw new Error("Invalid saved environment id.");
      }
      if (typeof rawSecret !== "string" || rawSecret.trim().length === 0) {
        throw new Error("Invalid saved environment secret.");
      }

      return writeSavedEnvironmentSecret({
        registryPath: SAVED_ENVIRONMENT_REGISTRY_PATH,
        environmentId: rawEnvironmentId,
        secret: rawSecret,
        secretStorage: getDesktopSecretStorage(),
      });
    },
  );

  ipcMain.removeHandler(REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL);
  ipcMain.handle(
    REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL,
    async (_event, rawEnvironmentId: unknown) => {
      if (typeof rawEnvironmentId !== "string" || rawEnvironmentId.trim().length === 0) {
        return;
      }

      removeSavedEnvironmentSecret({
        registryPath: SAVED_ENVIRONMENT_REGISTRY_PATH,
        environmentId: rawEnvironmentId,
      });
    },
  );

  ipcMain.removeHandler(GET_SERVER_EXPOSURE_STATE_CHANNEL);
  ipcMain.handle(GET_SERVER_EXPOSURE_STATE_CHANNEL, async () => getDesktopServerExposureState());

  ipcMain.removeHandler(SET_SERVER_EXPOSURE_MODE_CHANNEL);
  ipcMain.handle(SET_SERVER_EXPOSURE_MODE_CHANNEL, async (_event, rawMode: unknown) => {
    if (rawMode !== "local-only" && rawMode !== "network-accessible") {
      throw new Error("Invalid desktop server exposure input.");
    }

    const nextMode = rawMode as DesktopServerExposureMode;
    if (nextMode === desktopServerExposureMode) {
      return getDesktopServerExposureState();
    }

    const nextState = await applyDesktopServerExposureMode(nextMode, {
      persist: true,
      rejectIfUnavailable: true,
    });
    relaunchDesktopApp(`serverExposureMode=${nextMode}`);
    return nextState;
  });

  // ---- VPN ----

  initVpnManager(STATE_DIR);

  ipcMain.removeHandler(VPN_GET_STATE_CHANNEL);
  ipcMain.handle(VPN_GET_STATE_CHANNEL, async () => getVpnState());

  ipcMain.removeHandler(VPN_GET_PROFILES_CHANNEL);
  ipcMain.handle(VPN_GET_PROFILES_CHANNEL, async () => readVpnProfiles(VPN_PROFILES_PATH));

  ipcMain.removeHandler(VPN_ADD_PROFILE_CHANNEL);
  ipcMain.handle(VPN_ADD_PROFILE_CHANNEL, async (_event, label: unknown, configPath: unknown) => {
    if (typeof label !== "string" || typeof configPath !== "string") {
      throw new Error("Invalid VPN profile input.");
    }
    return addVpnProfile(VPN_PROFILES_PATH, label, configPath);
  });

  ipcMain.removeHandler(VPN_REMOVE_PROFILE_CHANNEL);
  ipcMain.handle(VPN_REMOVE_PROFILE_CHANNEL, async (_event, profileId: unknown) => {
    if (typeof profileId !== "string") {
      throw new Error("Invalid VPN profile ID.");
    }
    const state = getVpnState();
    if (state.activeProfileId === profileId && state.status !== "disconnected") {
      throw new Error("Cannot remove an active VPN profile. Disconnect first.");
    }
    removeVpnProfile(VPN_PROFILES_PATH, profileId);
  });

  ipcMain.removeHandler(VPN_CONNECT_CHANNEL);
  ipcMain.handle(VPN_CONNECT_CHANNEL, async (_event, profileId: unknown) => {
    if (typeof profileId !== "string") {
      throw new Error("Invalid VPN profile ID.");
    }
    if (!checkOpenvpnInstalled()) {
      throw new Error(
        "OpenVPN is not installed. Install it with `brew install openvpn` (macOS) or your package manager.",
      );
    }
    const profiles = readVpnProfiles(VPN_PROFILES_PATH);
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      throw new Error(`VPN profile not found: ${profileId}`);
    }
    return connectVpn(profile);
  });

  ipcMain.removeHandler(VPN_DISCONNECT_CHANNEL);
  ipcMain.handle(VPN_DISCONNECT_CHANNEL, async () => disconnectVpn());

  ipcMain.removeHandler(PICK_FILE_CHANNEL);
  ipcMain.handle(PICK_FILE_CHANNEL, async (_event, options: unknown) => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const filters =
      options && typeof options === "object" && "filters" in options
        ? (options as { filters: Electron.FileFilter[] }).filters
        : [];
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openFile"],
          filters,
        })
      : await dialog.showOpenDialog({ properties: ["openFile"], filters });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  // Push VPN state changes to renderer
  onVpnStateChange((state) => {
    mainWindow?.webContents.send(VPN_STATE_CHANNEL, state);
  });

  // ---- Traffic Lens Manager ----

  ipcMain.removeHandler(TRAFFIC_LENS_CREATE_TAB_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CREATE_TAB_CHANNEL, async (_event, url: unknown) => {
    const validUrl = typeof url === "string" ? url : undefined;
    return ensureTrafficLensManager().createTab(validUrl);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid profile tab input.");
    }
    const payload = input as { url?: unknown; profileId?: unknown };
    if (typeof payload.profileId !== "string") {
      throw new Error("Invalid profile ID.");
    }
    return ensureTrafficLensManager().createTabInProfile({
      profileId: payload.profileId,
      ...(typeof payload.url === "string" ? { url: payload.url } : {}),
    });
  });

  ipcMain.removeHandler(TRAFFIC_LENS_CLOSE_TAB_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CLOSE_TAB_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    ensureTrafficLensManager().closeTab(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_NAVIGATE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_NAVIGATE_CHANNEL, async (_event, tabId: unknown, url: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    if (typeof url !== "string") throw new Error("Invalid URL.");
    ensureTrafficLensManager().navigateTab(tabId, url);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GO_BACK_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GO_BACK_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    ensureTrafficLensManager().goBack(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GO_FORWARD_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GO_FORWARD_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    ensureTrafficLensManager().goForward(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_RELOAD_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_RELOAD_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    ensureTrafficLensManager().reloadTab(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_TABS_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_TABS_CHANNEL, async () => ensureTrafficLensManager().getTabs());

  ipcMain.removeHandler(TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid tab view mode payload.");
    }
    const payload = input as Record<string, unknown>;
    if (
      typeof payload.tabId !== "string" ||
      (payload.viewMode !== "desktop" && payload.viewMode !== "mobile")
    ) {
      throw new Error("Invalid tab view mode payload.");
    }
    return ensureTrafficLensManager().setTabViewMode({
      tabId: payload.tabId as any,
      viewMode: payload.viewMode,
    });
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid tab mobile preset payload.");
    }
    const payload = input as Record<string, unknown>;
    if (
      typeof payload.tabId !== "string" ||
      (payload.mobilePreset !== "iphone-15-pro" &&
        payload.mobilePreset !== "pixel-8" &&
        payload.mobilePreset !== "ipad-mini")
    ) {
      throw new Error("Invalid tab mobile preset payload.");
    }
    return ensureTrafficLensManager().setTabMobilePreset({
      tabId: payload.tabId as any,
      mobilePreset: payload.mobilePreset,
    });
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_BOUNDS_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_SET_BOUNDS_CHANNEL,
    async (_event, tabId: unknown, bounds: unknown) => {
      if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
      if (typeof bounds !== "object" || bounds === null) throw new Error("Invalid bounds.");
      const b = bounds as Record<string, unknown>;
      if (
        typeof b.x !== "number" ||
        typeof b.y !== "number" ||
        typeof b.width !== "number" ||
        typeof b.height !== "number"
      ) {
        throw new Error("Invalid bounds shape.");
      }
      ensureTrafficLensManager().setTabBounds(tabId, {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      });
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_SHOW_TAB_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SHOW_TAB_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") throw new Error("Invalid tab ID.");
    ensureTrafficLensManager().showTab(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL, async () =>
    ensureTrafficLensManager().hideAllTabs(),
  );

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_RULES_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_LIST_RULES_CHANNEL, async () =>
    ensureTrafficLensManager().listRules(),
  );

  ipcMain.removeHandler(TRAFFIC_LENS_CREATE_RULE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CREATE_RULE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid rule input.");
    }
    return ensureTrafficLensManager().createRule(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_UPDATE_RULE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_UPDATE_RULE_CHANNEL, async (_event, id: unknown, input: unknown) => {
    if (typeof id !== "string" || typeof input !== "object" || input === null) {
      throw new Error("Invalid rule update input.");
    }
    return ensureTrafficLensManager().updateRule(id, input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_RULE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_RULE_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("Invalid rule ID.");
    }
    ensureTrafficLensManager().deleteRule(id);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL,
    async (_event, id: unknown, enabled: unknown) => {
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        throw new Error("Invalid rule enabled payload.");
      }
      ensureTrafficLensManager().setRuleEnabled(id, enabled);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_PAUSED_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_LIST_PAUSED_CHANNEL, async () =>
    ensureTrafficLensManager().listPaused(),
  );

  ipcMain.removeHandler(TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid paused continuation input.");
    }
    await ensureTrafficLensManager().continuePaused(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DROP_PAUSED_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DROP_PAUSED_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid paused drop input.");
    }
    const payload = input as { pauseId?: unknown };
    if (typeof payload.pauseId !== "string") {
      throw new Error("Invalid pause ID.");
    }
    await ensureTrafficLensManager().dropPaused({ pauseId: payload.pauseId });
  });

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_PROFILES_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_LIST_PROFILES_CHANNEL, async () =>
    ensureTrafficLensManager().listProfiles(),
  );

  ipcMain.removeHandler(TRAFFIC_LENS_CREATE_PROFILE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CREATE_PROFILE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid profile input.");
    }
    return ensureTrafficLensManager().createProfile(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL,
    async (_event, id: unknown, input: unknown) => {
      if (typeof id !== "string" || typeof input !== "object" || input === null) {
        throw new Error("Invalid profile update input.");
      }
      return ensureTrafficLensManager().updateProfile(id, input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_PROFILE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_PROFILE_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("Invalid profile ID.");
    }
    ensureTrafficLensManager().deleteProfile(id);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_COOKIES_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_COOKIES_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") {
      throw new Error("Invalid tab ID.");
    }
    return ensureTrafficLensManager().getCookies(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_COOKIE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_COOKIE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid cookie input.");
    }
    await ensureTrafficLensManager().setCookie(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_COOKIE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_COOKIE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid cookie delete input.");
    }
    await ensureTrafficLensManager().deleteCookie(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_STORAGE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_STORAGE_CHANNEL, async (_event, tabId: unknown) => {
    if (typeof tabId !== "string") {
      throw new Error("Invalid tab ID.");
    }
    return ensureTrafficLensManager().getStorage(tabId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid storage input.");
    }
    await ensureTrafficLensManager().setStorageEntry(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid storage delete input.");
    }
    await ensureTrafficLensManager().deleteStorageEntry(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as any).profileId !== "string"
    ) {
      throw new Error("Invalid storage origins input.");
    }
    return ensureTrafficLensManager().listStorageOrigins((input as any).profileId);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid storage capture input.");
    }
    await ensureTrafficLensManager().captureStorageOrigin(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid applicable cookies input.");
    }
    return ensureTrafficLensManager().getApplicableCookies(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid origin cookie input.");
    }
    await ensureTrafficLensManager().setCookieForOrigin(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid origin cookie delete input.");
    }
    await ensureTrafficLensManager().deleteCookieForOrigin(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid localStorage input.");
    }
    return ensureTrafficLensManager().getLocalStorage(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid localStorage set input.");
    }
    await ensureTrafficLensManager().setLocalStorageItem(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid localStorage delete input.");
    }
    await ensureTrafficLensManager().deleteLocalStorageItem(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid localStorage clear input.");
    }
    await ensureTrafficLensManager().clearLocalStorage(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid live sessionStorage input.");
    }
    return ensureTrafficLensManager().getLiveSessionStorage(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid live sessionStorage set input.");
      }
      await ensureTrafficLensManager().setLiveSessionStorageItem(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid live sessionStorage delete input.");
      }
      await ensureTrafficLensManager().deleteLiveSessionStorageItem(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid live sessionStorage clear input.");
      }
      await ensureTrafficLensManager().clearLiveSessionStorage(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL,
    async (_event, input: unknown) => {
      if (
        typeof input !== "object" ||
        input === null ||
        typeof (input as any).profileId !== "string" ||
        typeof (input as any).origin !== "string"
      ) {
        throw new Error("Invalid sessionStorage snapshot list input.");
      }
      return ensureTrafficLensManager().listSessionStorageSnapshots(
        (input as any).profileId,
        (input as any).origin,
      );
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid sessionStorage snapshot input.");
      }
      return ensureTrafficLensManager().getSessionStorageSnapshot(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid sessionStorage snapshot update input.");
      }
      ensureTrafficLensManager().updateSessionStorageSnapshot(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Invalid sessionStorage snapshot rehydrate input.");
      }
      return ensureTrafficLensManager().rehydrateSessionStorageSnapshot(input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL, async () =>
    ensureTrafficLensManager().listOverrides(),
  );

  ipcMain.removeHandler(TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid override input.");
    }
    return ensureTrafficLensManager().createOverride(input as any);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL,
    async (_event, id: unknown, input: unknown) => {
      if (typeof id !== "string" || typeof input !== "object" || input === null) {
        throw new Error("Invalid override update input.");
      }
      return ensureTrafficLensManager().updateOverride(id, input as any);
    },
  );

  ipcMain.removeHandler(TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL);
  ipcMain.handle(TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("Invalid override ID.");
    }
    ensureTrafficLensManager().deleteOverride(id);
  });

  ipcMain.removeHandler(TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL);
  ipcMain.handle(
    TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL,
    async (_event, id: unknown, enabled: unknown) => {
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        throw new Error("Invalid override enabled payload.");
      }
      ensureTrafficLensManager().setOverrideEnabled(id, enabled);
    },
  );

  // ---- Neovim ----

  ipcMain.removeHandler(NEOVIM_ATTACH_CHANNEL);
  ipcMain.handle(
    NEOVIM_ATTACH_CHANNEL,
    async (_event, cwd: unknown, cols: unknown, rows: unknown) => {
      console.log("[neovim:main] attach called — cwd:", cwd, "cols:", cols, "rows:", rows);
      if (typeof cwd !== "string") throw new Error("Invalid cwd");
      if (typeof cols !== "number") throw new Error("Invalid cols");
      if (typeof rows !== "number") throw new Error("Invalid rows");

      if (nvimSession) {
        await shutdownNvim("re-attach");
      }

      const { attach } = await import("neovim");
      const nvimBin =
        process.env.PATH?.split(":")
          .map((p) => Path.join(p, "nvim"))
          .find((p) => FS.existsSync(p)) ?? "nvim";
      console.log("[neovim:main] spawning nvim at:", nvimBin);
      const proc = ChildProcess.spawn(nvimBin, ["--embed", "--cmd", "tnoremap <Esc> <C-\\><C-n>"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.on("error", (err) => console.error("[neovim:main] proc error:", err));
      proc.on("exit", (code, signal) =>
        console.log("[neovim:main] proc exit — code:", code, "signal:", signal),
      );

      const client = attach({ proc });

      nvimSession = { client, proc };

      // Catch-all notification logger so we can see EVERY notification name
      // nvim emits, not just redraw. Helps diagnose whether nvim is emitting
      // events at all vs the npm client filtering them.
      client.on("notification", (method: string, args: unknown) => {
        if (method === "redraw") {
          const sanitized = sanitizeForIpc(args);
          const names = Array.isArray(sanitized)
            ? (sanitized as any[]).map((e: any) => (Array.isArray(e) ? e[0] : e))
            : [];
          console.log(`[neovim:main] redraw batch (${names.length} events): ${names.join(",")}`);
          mainWindow?.webContents.send(NEOVIM_REDRAW_CHANNEL, sanitized);
        } else {
          console.log(
            `[neovim:main] non-redraw notification: ${method}`,
            Array.isArray(args) ? `args.length=${args.length}` : args,
          );
        }
      });

      // Listen for raw stderr from nvim — startup errors (E444, "press enter")
      // surface here.
      proc.stderr?.on("data", (chunk) => {
        console.log("[neovim:main] stderr:", chunk.toString());
      });

      console.log("[neovim:main] calling nvim_ui_attach (raw RPC) —", cols, rows);
      try {
        // Single-grid mode (ext_multigrid OFF): Neovim composes splits +
        // floats into grid 1, matching what a TUI sees. Multigrid adds large
        // amounts of UI complexity (compositor, anchored floats, msg grid)
        // for animation features Fenrir doesn't use today. Re-enable only
        // when there's a concrete win.
        const result = await client.request("nvim_ui_attach", [
          cols,
          rows,
          { rgb: true, ext_linegrid: true },
        ]);
        console.log("[neovim:main] nvim_ui_attach returned:", result);
      } catch (e) {
        console.error("[neovim:main] nvim_ui_attach FAILED:", e);
        throw e;
      }
      console.log("[neovim:main] uiAttach done");

      // Identify Fenrir to Neovim and run init lua (vim.g.fenrir, ginit.vim,
      // _G.fenrir.private namespace). All best-effort: older nvim or partial
      // failures must not abort attach — the editor still works without them.
      try {
        await client.request("nvim_set_var", ["fenrir", true]);
      } catch (e) {
        console.warn("[neovim:main] set_var(fenrir) failed:", e);
      }
      try {
        await client.request("nvim_set_client_info", [
          "fenrir",
          { major: 0, minor: 1, patch: 0 },
          "ui",
          {},
          {},
        ]);
      } catch (e) {
        console.warn("[neovim:main] set_client_info failed:", e);
      }
      try {
        await client.request("nvim_exec_lua", [FENRIR_INIT_LUA, []]);
        console.log("[neovim:main] init lua executed");
      } catch (e) {
        console.warn("[neovim:main] init lua failed:", e);
      }

      // Force an initial redraw so nvim paints the welcome / current buffer
      // state immediately. With ext_multigrid, nvim doesn't always emit a
      // full initial paint until something triggers it.
      try {
        await client.command("redraw!");
        console.log("[neovim:main] initial redraw! sent");
      } catch (e) {
        console.error("[neovim:main] initial redraw! failed:", e);
      }
    },
  );

  ipcMain.removeHandler(NEOVIM_DETACH_CHANNEL);
  ipcMain.handle(NEOVIM_DETACH_CHANNEL, async () => {
    console.log("[neovim:main] detach called");
    await shutdownNvim("detach");
  });

  ipcMain.removeHandler(NEOVIM_INPUT_CHANNEL);
  ipcMain.handle(NEOVIM_INPUT_CHANNEL, async (_event, keys: unknown) => {
    if (typeof keys !== "string") throw new Error("Invalid keys");
    if (!nvimSession) return;
    await nvimSession.client.input(keys);
  });

  ipcMain.removeHandler(NEOVIM_RESIZE_CHANNEL);
  ipcMain.handle(NEOVIM_RESIZE_CHANNEL, async (_event, cols: unknown, rows: unknown) => {
    if (typeof cols !== "number") throw new Error("Invalid cols");
    if (typeof rows !== "number") throw new Error("Invalid rows");
    if (!nvimSession) return;
    await nvimSession.client.uiTryResize(cols, rows);
  });

  ipcMain.removeHandler(NEOVIM_SET_CWD_CHANNEL);
  ipcMain.handle(NEOVIM_SET_CWD_CHANNEL, async (_event, cwd: unknown) => {
    if (typeof cwd !== "string" || cwd.length === 0) {
      throw new Error("Invalid cwd");
    }
    await neovimSource.setCwd(cwd);
  });

  ipcMain.removeHandler(NVIM_AVAILABLE_CHANNEL);
  ipcMain.handle(NVIM_AVAILABLE_CHANNEL, async () => {
    const result = await probeNvim();
    return result.available;
  });

  ipcMain.removeHandler(NVIM_PROBE_DETAIL_CHANNEL);
  ipcMain.handle(NVIM_PROBE_DETAIL_CHANNEL, async () => probeNvim());

  // ---- Embedded VS Code ----

  ipcMain.removeHandler(VSCODE_AVAILABLE_CHANNEL);
  ipcMain.handle(VSCODE_AVAILABLE_CHANNEL, async () => {
    const result = await probeVSCodeWeb();
    return result.available;
  });

  ipcMain.removeHandler(VSCODE_PROBE_DETAIL_CHANNEL);
  ipcMain.handle(VSCODE_PROBE_DETAIL_CHANNEL, async () => probeVSCodeWeb());

  ipcMain.removeHandler(VSCODE_START_CHANNEL);
  ipcMain.handle(VSCODE_START_CHANNEL, async (_event, cwd: unknown) => {
    if (typeof cwd !== "string" || cwd.length === 0) {
      throw new Error("Invalid VS Code cwd.");
    }
    return ensureVSCodeWebManager().ensureStarted(cwd);
  });

  ipcMain.removeHandler(VSCODE_OPEN_FILE_CHANNEL);
  ipcMain.handle(VSCODE_OPEN_FILE_CHANNEL, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid VS Code file payload.");
    }
    const input = payload as { path?: unknown; line?: unknown; col?: unknown };
    if (typeof input.path !== "string" || input.path.length === 0) {
      throw new Error("VS Code file path is required.");
    }
    return ensureVSCodeWebManager().openFile({
      path: input.path,
      ...(typeof input.line === "number" ? { line: input.line } : {}),
      ...(typeof input.col === "number" ? { col: input.col } : {}),
    });
  });

  ipcMain.removeHandler(VSCODE_SET_BOUNDS_CHANNEL);
  ipcMain.handle(VSCODE_SET_BOUNDS_CHANNEL, async (_event, bounds: unknown) => {
    if (typeof bounds !== "object" || bounds === null) {
      throw new Error("Invalid VS Code bounds.");
    }
    const b = bounds as Record<string, unknown>;
    if (
      typeof b.x !== "number" ||
      typeof b.y !== "number" ||
      typeof b.width !== "number" ||
      typeof b.height !== "number"
    ) {
      throw new Error("Invalid VS Code bounds shape.");
    }
    ensureVSCodeWebManager().setBounds({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    });
  });

  ipcMain.removeHandler(VSCODE_SHOW_CHANNEL);
  ipcMain.handle(VSCODE_SHOW_CHANNEL, async () => {
    ensureVSCodeWebManager().show();
  });

  ipcMain.removeHandler(VSCODE_HIDE_CHANNEL);
  ipcMain.handle(VSCODE_HIDE_CHANNEL, async () => {
    vscodeWebManager?.hide();
  });

  ipcMain.removeHandler(VSCODE_SET_SHORTCUT_STATE_CHANNEL);
  ipcMain.handle(VSCODE_SET_SHORTCUT_STATE_CHANNEL, async (_event, state: unknown) => {
    if (typeof state !== "object" || state === null) {
      throw new Error("Invalid VS Code shortcut state.");
    }
    ensureVSCodeWebManager().setShortcutState(state as VSCodeShortcutState);
  });

  // ---- Editor IPC (nvim ↔ renderer) ----

  ipcMain.removeHandler(EDITOR_OPEN_FILE_CHANNEL);
  ipcMain.handle(EDITOR_OPEN_FILE_CHANNEL, async (_event, payload: unknown) => {
    const input = payload as { path?: string; line?: number; col?: number };
    if (!input?.path) throw new Error("EDITOR_OPEN_FILE: path required");
    await neovimSource.openFile(input.path, input.line, input.col);
  });

  // Forward NeovimSource fenrir events to renderer, tagged by __source.
  neovimSource.onFenrirEvent((ev) => {
    if (ev.__source === "fenrir_autocmd") {
      mainWindow?.webContents.send(EDITOR_EVENT_CHANNEL, ev.payload);
    } else if (ev.__source === "fenrir_send_to_composer") {
      mainWindow?.webContents.send(EDITOR_SEND_TO_COMPOSER_CHANNEL, ev.payload);
    } else if (ev.__source === "fenrir_cmd") {
      mainWindow?.webContents.send(EDITOR_CMD_CHANNEL, ev.payload);
    }
  });

  ipcMain.removeHandler(EDITOR_INVOKE_BRIDGE_CHANNEL);
  ipcMain.handle(EDITOR_INVOKE_BRIDGE_CHANNEL, async (_event, fn: unknown) => {
    if (typeof fn !== "string") throw new Error("EDITOR_INVOKE_BRIDGE: fn must be string");
    await neovimSource.invokeBridge(fn);
  });

  ipcMain.removeHandler(RENDER_START_CHANNEL);
  ipcMain.handle(RENDER_START_CHANNEL, async (event) => {
    const { port1, port2 } = new MessageChannelMain();
    replaceRenderFramePort(port1);
    event.sender.postMessage(RENDER_FRAME_PORT_CHANNEL, null, [port2]);
    // After a renderer reload (Cmd+R) the GL canvas is reset and has no
    // grid contents, but the embedded nvim still holds full state. Force
    // a full-snapshot frame so the renderer can repaint without waiting
    // for nvim to push deltas for unchanged regions.
    neovimSource.requestFullRepaint();
    renderLoop.start();
  });

  ipcMain.removeHandler(RENDER_STOP_CHANNEL);
  ipcMain.handle(RENDER_STOP_CHANNEL, async () => {
    renderLoop.stop();
    replaceRenderFramePort(null);
  });

  ipcMain.removeHandler(RENDER_SET_FPS_CHANNEL);
  ipcMain.handle(RENDER_SET_FPS_CHANNEL, async (_event, fps: unknown) => {
    if (typeof fps !== "number") throw new Error("Invalid fps");
    renderLoop.setFps(fps);
  });

  ipcMain.removeHandler(RENDER_SYNC_VIEWPORT_CHANNEL);
  ipcMain.handle(RENDER_SYNC_VIEWPORT_CHANNEL, async (_event, width: unknown, height: unknown) => {
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new Error("Invalid viewport");
    }
    renderLoop.pushInput({ kind: "resize", w: width, h: height });
    neovimSource.requestFullRepaint();
  });

  ipcMain.removeAllListeners(RENDER_INPUT_CHANNEL);
  ipcMain.on(RENDER_INPUT_CHANNEL, (_event, payload: unknown) => {
    const ev = parseInputEvent(payload);
    if (ev) renderLoop.pushInput(ev);
  });

  ipcMain.removeHandler(RENDER_SET_EDITOR_FONT_METRICS_CHANNEL);
  ipcMain.handle(RENDER_SET_EDITOR_FONT_METRICS_CHANNEL, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) throw new Error("Invalid metrics");
    const m = payload as Record<string, unknown>;
    if (
      typeof m["width"] !== "number" ||
      typeof m["height"] !== "number" ||
      typeof m["ascent"] !== "number" ||
      typeof m["font"] !== "string" ||
      typeof m["fontWeight"] !== "number" ||
      typeof m["ligatures"] !== "boolean"
    ) {
      throw new Error("Invalid metrics fields");
    }
    neovimSource.setEditorFontMetrics({
      width: m["width"],
      height: m["height"],
      ascent: m["ascent"],
      font: m["font"],
      fontWeight: m["fontWeight"],
      ligatures: m["ligatures"],
    });
  });

  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async (_event, options?: { initialPath?: string }) => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"],
          ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return showDesktopConfirmDialog(message, owner);
  });

  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme);
    if (!theme) {
      return;
    }

    nativeTheme.themeSource = theme;
  });

  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalizedItems = items
        .filter((item) => typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({
          id: item.id,
          label: item.label,
          destructive: item.destructive === true,
          disabled: item.disabled === true,
        }));
      if (normalizedItems.length === 0) {
        return null;
      }

      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? {
              x: Math.floor(position.x),
              y: Math.floor(position.y),
            }
          : null;

      const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!window) return null;

      return new Promise<string | null>((resolve) => {
        const template: MenuItemConstructorOptions[] = [];
        let hasInsertedDestructiveSeparator = false;
        for (const item of normalizedItems) {
          if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
            template.push({ type: "separator" });
            hasInsertedDestructiveSeparator = true;
          }
          const itemOption: MenuItemConstructorOptions = {
            label: item.label,
            enabled: !item.disabled,
            click: () => resolve(item.id),
          };
          if (item.destructive) {
            const destructiveIcon = getDestructiveMenuIcon();
            if (destructiveIcon) {
              itemOption.icon = destructiveIcon;
            }
          }
          template.push(itemOption);
        }

        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );

  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);

  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updateState,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_CHECK_CHANNEL);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (!updaterConfigured) {
      return {
        checked: false,
        state: updateState,
      } satisfies DesktopUpdateCheckResult;
    }
    const checked = await checkForUpdates("web-ui");
    return {
      checked,
      state: updateState,
    } satisfies DesktopUpdateCheckResult;
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
    emitUpdateState();
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
  if (backendHttpUrl) {
    return backendHttpUrl;
  }

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
  startBackend();
  writeDesktopLogHeader("bootstrap backend start requested");

  if (isDevelopment) {
    mainWindow = createWindow();
    ensureTrafficLensManager();
    writeDesktopLogHeader("bootstrap main window created");
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
    return;
  }

  await waitForBackendHttpReady(backendHttpUrl);
  writeDesktopLogHeader("bootstrap backend ready");
  mainWindow = createWindow();
  ensureTrafficLensManager();
  writeDesktopLogHeader("bootstrap main window created");
}

app.on("before-quit", () => {
  isQuitting = true;
  updateInstallInFlight = false;
  writeDesktopLogHeader("before-quit received");
  clearUpdatePollTimer();
  cancelBackendReadinessWait();
  stopTrafficLensManager();
  stopVSCodeWebManager();
  stopVpn();
  stopBackend();
  // Fire-and-forget: nullifies nvimSession synchronously and walks the quit
  // ladder asynchronously. Worst case the OS reaps the orphan when we exit.
  void shutdownNvim("before-quit");
  renderLoop.stop();
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
    configureAutoUpdater();
    // Kick off nvim probe early so result is cached before renderer mounts.
    void probeNvim().catch(() => undefined);
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
    clearUpdatePollTimer();
    cancelBackendReadinessWait();
    stopTrafficLensManager();
    stopVSCodeWebManager();
    stopVpn();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });

  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGTERM received");
    clearUpdatePollTimer();
    stopTrafficLensManager();
    stopVSCodeWebManager();
    stopVpn();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });
}
