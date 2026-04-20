// VPN profile and connection state types.
// Schema-only — no runtime logic (contracts rule).

export type VpnProfileId = string;

export interface VpnProfile {
  readonly id: VpnProfileId;
  readonly label: string;
  /** Absolute path to the .ovpn config file (referenced in-place, not copied). */
  readonly configPath: string;
  readonly createdAt: string;
}

export type VpnConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export interface VpnConnectionState {
  readonly status: VpnConnectionStatus;
  readonly activeProfileId: VpnProfileId | null;
  readonly assignedIp: string | null;
  readonly connectedAt: string | null;
  readonly errorMessage: string | null;
}
