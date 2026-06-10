import type { DesktopServerExposureMode } from "@fenrir/contracts";
import { readJsonFile, writeJsonFileAtomic } from "@fenrir/shared/jsonFile";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
};

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function readDesktopSettings(settingsPath: string): DesktopSettings {
  const parsed = readJsonFile<{ readonly serverExposureMode?: unknown }>(settingsPath);
  if (parsed === null) {
    return DEFAULT_DESKTOP_SETTINGS;
  }

  return {
    serverExposureMode:
      parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
  };
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  writeJsonFileAtomic(settingsPath, settings);
}
