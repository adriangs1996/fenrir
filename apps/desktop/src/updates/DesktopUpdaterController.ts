import * as FS from "node:fs";
import * as Path from "node:path";

import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopRuntimeInfo, DesktopUpdateState } from "@fenrir/contracts";
import { UPDATE_STATE_CHANNEL } from "@fenrir/contracts";

import { formatErrorMessage } from "../errorMessage";
import { isArm64HostRunningIntelBuild } from "../app/DesktopRuntimeArch";
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from "./DesktopUpdates";
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
} from "./updateMachine";

const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DESKTOP_UPDATE_CHANNEL = "latest";
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

export interface UpdateActionOutcome {
  accepted: boolean;
  completed: boolean;
}

export interface DesktopUpdaterDeps {
  readonly isDevelopment: boolean;
  readonly runtimeInfo: DesktopRuntimeInfo;
  readonly isQuitting: () => boolean;
  readonly setQuitting: (value: boolean) => void;
  readonly stopBackendAndWaitForExit: () => Promise<void>;
}

/** Read the baked-in app-update.yml config (if applicable). */
export function readAppUpdateYml(): Record<string, string> | null {
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

export class DesktopUpdaterController {
  private readonly deps: DesktopUpdaterDeps;
  private updatePollTimer: ReturnType<typeof setInterval> | null = null;
  private updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private updateCheckInFlight = false;
  private updateDownloadInFlight = false;
  private updateInstallInFlight = false;
  private updaterConfigured = false;
  private updateState: DesktopUpdateState;

  constructor(deps: DesktopUpdaterDeps) {
    this.deps = deps;
    this.updateState = createInitialDesktopUpdateState(app.getVersion(), deps.runtimeInfo);
  }

  getState(): DesktopUpdateState {
    return this.updateState;
  }

  isConfigured(): boolean {
    return this.updaterConfigured;
  }

  emitState(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(UPDATE_STATE_CHANNEL, this.updateState);
    }
  }

  /** Reason updates are unavailable right now, or `null` when enabled. */
  getDisabledReason(): string | null {
    const hasUpdateFeedConfig =
      readAppUpdateYml() !== null || Boolean(process.env.FENRIR_DESKTOP_MOCK_UPDATES);
    return getAutoUpdateDisabledReason({
      isDevelopment: this.deps.isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.FENRIR_DISABLE_AUTO_UPDATE === "1",
      hasUpdateFeedConfig,
    });
  }

  clearTimers(): void {
    if (this.updateStartupTimer) {
      clearTimeout(this.updateStartupTimer);
      this.updateStartupTimer = null;
    }
    if (this.updatePollTimer) {
      clearInterval(this.updatePollTimer);
      this.updatePollTimer = null;
    }
  }

  handleBeforeQuit(): void {
    this.updateInstallInFlight = false;
  }

  async checkForUpdates(reason: string): Promise<boolean> {
    if (this.deps.isQuitting() || !this.updaterConfigured || this.updateCheckInFlight) return false;
    if (this.updateState.status === "downloading" || this.updateState.status === "downloaded") {
      console.info(
        `[desktop-updater] Skipping update check (${reason}) while status=${this.updateState.status}.`,
      );
      return false;
    }
    this.updateCheckInFlight = true;
    this.setUpdateState(
      reduceDesktopUpdateStateOnCheckStart(this.updateState, new Date().toISOString()),
    );
    console.info(`[desktop-updater] Checking for updates (${reason})...`);

    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setUpdateState(
        reduceDesktopUpdateStateOnCheckFailure(this.updateState, message, new Date().toISOString()),
      );
      console.error(`[desktop-updater] Failed to check for updates: ${message}`);
      return true;
    } finally {
      this.updateCheckInFlight = false;
    }
  }

  async downloadAvailableUpdate(): Promise<UpdateActionOutcome> {
    if (
      !this.updaterConfigured ||
      this.updateDownloadInFlight ||
      this.updateState.status !== "available"
    ) {
      return { accepted: false, completed: false };
    }
    this.updateDownloadInFlight = true;
    this.setUpdateState(reduceDesktopUpdateStateOnDownloadStart(this.updateState));
    autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(this.deps.runtimeInfo);
    console.info("[desktop-updater] Downloading update...");

    try {
      await autoUpdater.downloadUpdate();
      return { accepted: true, completed: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(this.updateState, message));
      console.error(`[desktop-updater] Failed to download update: ${message}`);
      return { accepted: true, completed: false };
    } finally {
      this.updateDownloadInFlight = false;
    }
  }

  async installDownloadedUpdate(): Promise<UpdateActionOutcome> {
    if (
      this.deps.isQuitting() ||
      !this.updaterConfigured ||
      this.updateState.status !== "downloaded"
    ) {
      return { accepted: false, completed: false };
    }

    this.deps.setQuitting(true);
    this.updateInstallInFlight = true;
    this.clearTimers();
    try {
      await this.deps.stopBackendAndWaitForExit();
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
      this.updateInstallInFlight = false;
      this.deps.setQuitting(false);
      this.setUpdateState(reduceDesktopUpdateStateOnInstallFailure(this.updateState, message));
      console.error(`[desktop-updater] Failed to install update: ${message}`);
      return { accepted: true, completed: false };
    }
  }

  configure(): void {
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

    const enabled = this.getDisabledReason() === null;
    this.setUpdateState({
      ...createInitialDesktopUpdateState(app.getVersion(), this.deps.runtimeInfo),
      enabled,
      status: enabled ? "idle" : "disabled",
    });
    if (!enabled) {
      return;
    }
    this.updaterConfigured = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Keep alpha branding, but force all installs onto the stable update track.
    autoUpdater.channel = DESKTOP_UPDATE_CHANNEL;
    autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(this.deps.runtimeInfo);
    let lastLoggedDownloadMilestone = -1;

    if (isArm64HostRunningIntelBuild(this.deps.runtimeInfo)) {
      console.info(
        "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
      );
    }

    autoUpdater.on("checking-for-update", () => {
      console.info("[desktop-updater] Looking for updates...");
    });
    autoUpdater.on("update-available", (info) => {
      this.setUpdateState(
        reduceDesktopUpdateStateOnUpdateAvailable(
          this.updateState,
          info.version,
          new Date().toISOString(),
        ),
      );
      lastLoggedDownloadMilestone = -1;
      console.info(`[desktop-updater] Update available: ${info.version}`);
    });
    autoUpdater.on("update-not-available", () => {
      this.setUpdateState(
        reduceDesktopUpdateStateOnNoUpdate(this.updateState, new Date().toISOString()),
      );
      lastLoggedDownloadMilestone = -1;
      console.info("[desktop-updater] No updates available.");
    });
    autoUpdater.on("error", (error) => {
      const message = formatErrorMessage(error);
      if (this.updateInstallInFlight) {
        this.updateInstallInFlight = false;
        this.deps.setQuitting(false);
        this.setUpdateState(reduceDesktopUpdateStateOnInstallFailure(this.updateState, message));
        console.error(`[desktop-updater] Updater error: ${message}`);
        return;
      }
      if (!this.updateCheckInFlight && !this.updateDownloadInFlight) {
        this.setUpdateState({
          status: "error",
          message,
          checkedAt: new Date().toISOString(),
          downloadPercent: null,
          errorContext: this.resolveUpdaterErrorContext(),
          canRetry:
            this.updateState.availableVersion !== null ||
            this.updateState.downloadedVersion !== null,
        });
      }
      console.error(`[desktop-updater] Updater error: ${message}`);
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.floor(progress.percent);
      if (
        shouldBroadcastDownloadProgress(this.updateState, progress.percent) ||
        this.updateState.message !== null
      ) {
        this.setUpdateState(
          reduceDesktopUpdateStateOnDownloadProgress(this.updateState, progress.percent),
        );
      }
      const milestone = percent - (percent % 10);
      if (milestone > lastLoggedDownloadMilestone) {
        lastLoggedDownloadMilestone = milestone;
        console.info(`[desktop-updater] Download progress: ${percent}%`);
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.setUpdateState(
        reduceDesktopUpdateStateOnDownloadComplete(this.updateState, info.version),
      );
      console.info(`[desktop-updater] Update downloaded: ${info.version}`);
    });

    this.clearTimers();

    this.updateStartupTimer = setTimeout(() => {
      this.updateStartupTimer = null;
      void this.checkForUpdates("startup");
    }, AUTO_UPDATE_STARTUP_DELAY_MS);
    this.updateStartupTimer.unref();

    this.updatePollTimer = setInterval(() => {
      void this.checkForUpdates("poll");
    }, AUTO_UPDATE_POLL_INTERVAL_MS);
    this.updatePollTimer.unref();
  }

  private setUpdateState(patch: Partial<DesktopUpdateState>): void {
    this.updateState = { ...this.updateState, ...patch };
    this.emitState();
  }

  private resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
    if (this.updateInstallInFlight) return "install";
    if (this.updateDownloadInFlight) return "download";
    if (this.updateCheckInFlight) return "check";
    return this.updateState.errorContext;
  }
}
