import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import type { VpnProfile } from "@fenrir/contracts";

interface VpnSettingsFile {
  readonly profiles: VpnProfile[];
}

export function readVpnProfiles(settingsPath: string): VpnProfile[] {
  try {
    if (!FS.existsSync(settingsPath)) return [];
    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { profiles?: unknown };
    if (!Array.isArray(parsed.profiles)) return [];
    return parsed.profiles as VpnProfile[];
  } catch {
    return [];
  }
}

function writeVpnSettingsFile(settingsPath: string, file: VpnSettingsFile): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}

export function addVpnProfile(settingsPath: string, label: string, configPath: string): VpnProfile {
  if (!FS.existsSync(configPath)) {
    throw new Error(`VPN config file not found: ${configPath}`);
  }
  if (!configPath.endsWith(".ovpn")) {
    throw new Error(`Expected .ovpn file, got: ${configPath}`);
  }

  const profiles = readVpnProfiles(settingsPath);
  const profile: VpnProfile = {
    id: Crypto.randomUUID(),
    label: label.trim(),
    configPath,
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  writeVpnSettingsFile(settingsPath, { profiles });
  return profile;
}

export function removeVpnProfile(settingsPath: string, profileId: string): void {
  const profiles = readVpnProfiles(settingsPath);
  const filtered = profiles.filter((p) => p.id !== profileId);
  if (filtered.length === profiles.length) {
    throw new Error(`VPN profile not found: ${profileId}`);
  }
  writeVpnSettingsFile(settingsPath, { profiles: filtered });
}
