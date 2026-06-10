import type { DesktopUpdateActionResult, DesktopUpdateCheckResult } from "@fenrir/contracts";
import {
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
} from "@fenrir/contracts";

import type { DesktopUpdaterController } from "../updates/DesktopUpdaterController";
import { registerHandler } from "./registerHandler";

export interface UpdaterHandlersDeps {
  readonly updater: DesktopUpdaterController;
  readonly isQuitting: () => boolean;
}

export function registerUpdaterHandlers(deps: UpdaterHandlersDeps): void {
  const { updater } = deps;

  registerHandler(UPDATE_GET_STATE_CHANNEL, async () => updater.getState());

  registerHandler(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await updater.downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updater.getState(),
    } satisfies DesktopUpdateActionResult;
  });

  registerHandler(UPDATE_INSTALL_CHANNEL, async () => {
    if (deps.isQuitting()) {
      return {
        accepted: false,
        completed: false,
        state: updater.getState(),
      } satisfies DesktopUpdateActionResult;
    }
    const result = await updater.installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updater.getState(),
    } satisfies DesktopUpdateActionResult;
  });

  registerHandler(UPDATE_CHECK_CHANNEL, async () => {
    if (!updater.isConfigured()) {
      return {
        checked: false,
        state: updater.getState(),
      } satisfies DesktopUpdateCheckResult;
    }
    const checked = await updater.checkForUpdates("web-ui");
    return {
      checked,
      state: updater.getState(),
    } satisfies DesktopUpdateCheckResult;
  });
}
