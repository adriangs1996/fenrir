import { useCallback, useEffect, useState } from "react";
import type { VpnConnectionState, VpnProfile } from "@fenrir/contracts";

interface UseVpnStateResult {
  /** null when desktop bridge unavailable (web-only mode) */
  state: VpnConnectionState | null;
  profiles: readonly VpnProfile[];
  isDesktop: boolean;
  connect: (profileId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  addProfile: (label: string, configPath: string) => Promise<VpnProfile | null>;
  removeProfile: (profileId: string) => Promise<void>;
  pickOvpnFile: () => Promise<string | null>;
  refreshProfiles: () => Promise<void>;
}

function getDesktopBridge() {
  return typeof window !== "undefined"
    ? ((window as unknown as Record<string, unknown>).desktopBridge as
        | import("@fenrir/contracts").DesktopBridge
        | undefined)
    : undefined;
}

export function useVpnState(): UseVpnStateResult {
  const [state, setState] = useState<VpnConnectionState | null>(null);
  const [profiles, setProfiles] = useState<readonly VpnProfile[]>([]);

  const bridge = getDesktopBridge();
  const isDesktop = Boolean(bridge?.getVpnState);

  const refreshProfiles = useCallback(async () => {
    const b = getDesktopBridge();
    if (!b?.getVpnProfiles) return;
    const p = await b.getVpnProfiles();
    setProfiles(p);
  }, []);

  useEffect(() => {
    const b = getDesktopBridge();
    if (!b?.getVpnState) return;

    void b.getVpnState().then(setState);
    void b.getVpnProfiles().then(setProfiles);

    const unsubscribe = b.onVpnStateChange((newState) => {
      setState(newState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const connect = useCallback(async (profileId: string) => {
    const b = getDesktopBridge();
    if (!b?.connectVpn) return;
    const result = await b.connectVpn(profileId);
    setState(result);
  }, []);

  const disconnect = useCallback(async () => {
    const b = getDesktopBridge();
    if (!b?.disconnectVpn) return;
    const result = await b.disconnectVpn();
    setState(result);
  }, []);

  const addProfile = useCallback(
    async (label: string, configPath: string): Promise<VpnProfile | null> => {
      const b = getDesktopBridge();
      if (!b?.addVpnProfile) return null;
      const profile = await b.addVpnProfile(label, configPath);
      await refreshProfiles();
      return profile;
    },
    [refreshProfiles],
  );

  const removeProfile = useCallback(
    async (profileId: string) => {
      const b = getDesktopBridge();
      if (!b?.removeVpnProfile) return;
      await b.removeVpnProfile(profileId);
      await refreshProfiles();
    },
    [refreshProfiles],
  );

  const pickOvpnFile = useCallback(async (): Promise<string | null> => {
    const b = getDesktopBridge();
    if (!b?.pickFile) return null;
    return b.pickFile({ filters: [{ name: "OpenVPN Config", extensions: ["ovpn"] }] });
  }, []);

  return {
    state,
    profiles,
    isDesktop,
    connect,
    disconnect,
    addProfile,
    removeProfile,
    pickOvpnFile,
    refreshProfiles,
  };
}
