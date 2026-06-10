import type { BrowserWindow } from "electron";
import {
  VPN_ADD_PROFILE_CHANNEL,
  VPN_CONNECT_CHANNEL,
  VPN_DISCONNECT_CHANNEL,
  VPN_GET_PROFILES_CHANNEL,
  VPN_GET_STATE_CHANNEL,
  VPN_REMOVE_PROFILE_CHANNEL,
  VPN_STATE_CHANNEL,
} from "@fenrir/contracts";

import { addVpnProfile, readVpnProfiles, removeVpnProfile } from "../vpnSettings";
import {
  checkOpenvpnInstalled,
  connectVpn,
  disconnectVpn,
  getVpnState,
  initVpnManager,
  onVpnStateChange,
} from "../vpnManager";
import { registerHandler } from "./registerHandler";
import { requireString } from "./validators";

export interface VpnHandlersDeps {
  readonly stateDir: string;
  readonly vpnProfilesPath: string;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly ensureShellEnvironmentSynced: (reason: string) => void;
}

export function registerVpnHandlers(deps: VpnHandlersDeps): void {
  initVpnManager(deps.stateDir);

  registerHandler(VPN_GET_STATE_CHANNEL, async () => getVpnState());

  registerHandler(VPN_GET_PROFILES_CHANNEL, async () => readVpnProfiles(deps.vpnProfilesPath));

  registerHandler(VPN_ADD_PROFILE_CHANNEL, async (_event, label: unknown, configPath: unknown) => {
    const validLabel = requireString("VPN profile input", label);
    const validConfigPath = requireString("VPN profile input", configPath);
    return addVpnProfile(deps.vpnProfilesPath, validLabel, validConfigPath);
  });

  registerHandler(VPN_REMOVE_PROFILE_CHANNEL, async (_event, rawProfileId: unknown) => {
    const profileId = requireString("VPN profile ID", rawProfileId);
    const state = getVpnState();
    if (state.activeProfileId === profileId && state.status !== "disconnected") {
      throw new Error("Cannot remove an active VPN profile. Disconnect first.");
    }
    removeVpnProfile(deps.vpnProfilesPath, profileId);
  });

  registerHandler(VPN_CONNECT_CHANNEL, async (_event, rawProfileId: unknown) => {
    const profileId = requireString("VPN profile ID", rawProfileId);
    deps.ensureShellEnvironmentSynced("vpn-connect");
    if (!checkOpenvpnInstalled()) {
      throw new Error(
        "OpenVPN is not installed. Install it with `brew install openvpn` (macOS) or your package manager.",
      );
    }
    const profiles = readVpnProfiles(deps.vpnProfilesPath);
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      throw new Error(`VPN profile not found: ${profileId}`);
    }
    return connectVpn(profile);
  });

  registerHandler(VPN_DISCONNECT_CHANNEL, async () => disconnectVpn());

  // Push VPN state changes to renderer
  onVpnStateChange((state) => {
    deps.getMainWindow()?.webContents.send(VPN_STATE_CHANNEL, state);
  });
}
