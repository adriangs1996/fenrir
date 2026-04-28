import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as Path from "node:path";
import type { VpnConnectionState, VpnProfile } from "@fenrir/contracts";

// ---------------------------------------------------------------------------
// Module-level state (same pattern as backendProcess in main.ts)
// ---------------------------------------------------------------------------

let vpnProcess: ChildProcess.ChildProcess | null = null;
let vpnState: VpnConnectionState = {
  status: "disconnected",
  activeProfileId: null,
  assignedIp: null,
  connectedAt: null,
  errorMessage: null,
};
let stateListeners: Array<(state: VpnConnectionState) => void> = [];
let connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let pidFilePath: string | null = null;
let stateDir: string | null = null;

const CONNECTION_TIMEOUT_MS = 30_000;
const KILL_ESCALATION_MS = 2_000;

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function setState(next: Partial<VpnConnectionState>): void {
  vpnState = { ...vpnState, ...next };
  for (const listener of stateListeners) {
    try {
      listener(vpnState);
    } catch {
      // listener errors must not crash the manager
    }
  }
}

export function getVpnState(): VpnConnectionState {
  return vpnState;
}

export function onVpnStateChange(listener: (state: VpnConnectionState) => void): () => void {
  stateListeners.push(listener);
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener);
  };
}

// ---------------------------------------------------------------------------
// PID file tracking (crash recovery)
// ---------------------------------------------------------------------------

export function initVpnManager(dir: string): void {
  stateDir = dir;
  pidFilePath = Path.join(dir, "vpn.pid");
  ensureAskpassScript(dir);
  cleanupOrphanedVpn();
}

function writePidFile(pid: number): void {
  if (!pidFilePath) return;
  const dir = Path.dirname(pidFilePath);
  FS.mkdirSync(dir, { recursive: true });
  FS.writeFileSync(pidFilePath, String(pid), "utf8");
}

function removePidFile(): void {
  if (!pidFilePath) return;
  try {
    FS.unlinkSync(pidFilePath);
  } catch {
    // already gone
  }
}

function cleanupOrphanedVpn(): void {
  if (!pidFilePath || !FS.existsSync(pidFilePath)) return;
  try {
    const pid = Number(FS.readFileSync(pidFilePath, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // check alive
        process.kill(pid, "SIGTERM"); // still running → kill
      } catch {
        // already dead
      }
    }
  } catch {
    // corrupt file, ignore
  }
  removePidFile();
}

// ---------------------------------------------------------------------------
// Capability check
// ---------------------------------------------------------------------------

export function checkOpenvpnInstalled(): boolean {
  try {
    const result = ChildProcess.spawnSync("which", ["openvpn"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

export async function connectVpn(profile: VpnProfile): Promise<VpnConnectionState> {
  // Disconnect existing connection first
  if (vpnState.status === "connected" || vpnState.status === "connecting") {
    await disconnectVpn();
  }

  if (!FS.existsSync(profile.configPath)) {
    setState({
      status: "error",
      errorMessage: `Config file not found: ${profile.configPath}`,
      activeProfileId: profile.id,
    });
    return vpnState;
  }

  setState({
    status: "connecting",
    activeProfileId: profile.id,
    assignedIp: null,
    connectedAt: null,
    errorMessage: null,
  });

  return new Promise<VpnConnectionState>((resolve) => {
    const child = spawnPrivileged(profile.configPath);

    if (!child) {
      setState({
        status: "error",
        errorMessage: "Failed to start OpenVPN. Administrator permission may have been denied.",
        activeProfileId: profile.id,
      });
      resolve(vpnState);
      return;
    }

    vpnProcess = child;
    if (child.pid) writePidFile(child.pid);

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearConnectionTimeout();
      resolve(vpnState);
    };

    // Connection timeout
    connectionTimeoutTimer = setTimeout(() => {
      if (vpnState.status === "connecting") {
        setState({
          status: "error",
          errorMessage: "Connection timed out after 30 seconds.",
        });
        killVpnProcess();
        finish();
      }
    }, CONNECTION_TIMEOUT_MS);

    // Parse stdout for status signals
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();

      // Extract assigned IP from /sbin/ifconfig line.
      // Real output: "/sbin/ifconfig utun4 10.10.16.164 10.10.16.164 netmask ..."
      // Must use /sbin/ifconfig to avoid matching the PUSH_REPLY "ifconfig IP NETMASK" line
      // which would incorrectly capture the netmask as the IP.
      const ipMatch = text.match(/\/sbin\/ifconfig\s+\S+\s+(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch?.[1]) {
        setState({ assignedIp: ipMatch[1] });
      }

      // Connection established
      if (text.includes("Initialization Sequence Completed")) {
        setState({
          status: "connected",
          connectedAt: new Date().toISOString(),
          errorMessage: null,
        });
        finish();
      }

      // Auth failure
      if (text.includes("AUTH_FAILED")) {
        setState({
          status: "error",
          errorMessage: "VPN authentication failed. Check credentials in .ovpn file.",
        });
        killVpnProcess();
        finish();
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      // OpenVPN sometimes writes status to stderr too
      if (text.includes("Initialization Sequence Completed")) {
        setState({
          status: "connected",
          connectedAt: new Date().toISOString(),
          errorMessage: null,
        });
        finish();
      }
      if (text.includes("AUTH_FAILED")) {
        setState({
          status: "error",
          errorMessage: "VPN authentication failed. Check credentials in .ovpn file.",
        });
        killVpnProcess();
        finish();
      }
    });

    child.on("error", (err) => {
      setState({
        status: "error",
        errorMessage: `OpenVPN process error: ${err.message}`,
      });
      vpnProcess = null;
      removePidFile();
      finish();
    });

    child.on("exit", (code, signal) => {
      vpnProcess = null;
      removePidFile();
      if (vpnState.status === "connected") {
        // Unexpected disconnect
        setState({
          status: "disconnected",
          activeProfileId: null,
          assignedIp: null,
          connectedAt: null,
          errorMessage: "VPN disconnected unexpectedly.",
        });
      } else if (vpnState.status !== "error" && vpnState.status !== "disconnected") {
        setState({
          status: "error",
          errorMessage: `OpenVPN exited with code ${code ?? signal ?? "unknown"}.`,
        });
      }
      finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnectVpn(): Promise<VpnConnectionState> {
  clearConnectionTimeout();

  if (!vpnProcess) {
    setState({
      status: "disconnected",
      activeProfileId: null,
      assignedIp: null,
      connectedAt: null,
      errorMessage: null,
    });
    removePidFile();
    return vpnState;
  }

  setState({ status: "disconnecting" });

  return new Promise<VpnConnectionState>((resolve) => {
    const child = vpnProcess!;
    let settled = false;

    const onExit = () => {
      if (settled) return;
      settled = true;
      vpnProcess = null;
      removePidFile();
      setState({
        status: "disconnected",
        activeProfileId: null,
        assignedIp: null,
        connectedAt: null,
        errorMessage: null,
      });
      resolve(vpnState);
    };

    child.once("exit", onExit);
    child.kill("SIGTERM");

    // Escalate to SIGKILL after timeout
    setTimeout(() => {
      if (!settled && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, KILL_ESCALATION_MS);

    // Safety: resolve after 5s even if exit event never fires
    setTimeout(() => {
      if (!settled) {
        settled = true;
        vpnProcess = null;
        removePidFile();
        setState({
          status: "disconnected",
          activeProfileId: null,
          assignedIp: null,
          connectedAt: null,
          errorMessage: null,
        });
        resolve(vpnState);
      }
    }, KILL_ESCALATION_MS + 3_000);
  });
}

/** Synchronous stop for quit handlers. Best-effort, no waiting. */
export function stopVpn(): void {
  clearConnectionTimeout();
  if (vpnProcess) {
    try {
      vpnProcess.kill("SIGTERM");
    } catch {
      // already exited
    }
    vpnProcess = null;
  }
  removePidFile();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearConnectionTimeout(): void {
  if (connectionTimeoutTimer) {
    clearTimeout(connectionTimeoutTimer);
    connectionTimeoutTimer = null;
  }
}

function killVpnProcess(): void {
  if (vpnProcess) {
    try {
      vpnProcess.kill("SIGTERM");
    } catch {
      // already exited
    }
  }
}

// ---------------------------------------------------------------------------
// Askpass helper (macOS)
// ---------------------------------------------------------------------------

const ASKPASS_SCRIPT_NAME = "vpn-askpass.sh";

/**
 * Create a small shell script that uses osascript to prompt for the sudo
 * password via a native macOS dialog.  `sudo -A` invokes this script when
 * it needs credentials, giving us streaming stdout from openvpn while still
 * getting the native admin prompt.
 */
function ensureAskpassScript(dir: string): void {
  if (process.platform !== "darwin") return;
  const scriptPath = Path.join(dir, ASKPASS_SCRIPT_NAME);
  const content = [
    "#!/bin/bash",
    "# Auto-generated by Fenrir — prompts for sudo password via macOS dialog",
    'osascript -e \'display dialog "Fenrir needs administrator access to manage the VPN connection." default answer "" with hidden answer with title "Fenrir VPN"\' -e \'text returned of result\' 2>/dev/null',
    "",
  ].join("\n");

  FS.mkdirSync(dir, { recursive: true });
  FS.writeFileSync(scriptPath, content, { mode: 0o755 });
}

function getAskpassPath(): string | null {
  if (!stateDir) return null;
  const p = Path.join(stateDir, ASKPASS_SCRIPT_NAME);
  return FS.existsSync(p) ? p : null;
}

// ---------------------------------------------------------------------------
// Privilege-escalated spawn
// ---------------------------------------------------------------------------

/**
 * Spawn openvpn with platform-specific privilege escalation.
 *
 * macOS: `sudo -A` with a SUDO_ASKPASS script that shows a native password
 *        dialog via osascript.  Unlike the `do shell script … with
 *        administrator privileges` approach, this gives us **streaming
 *        stdout/stderr** so we can parse connection status in real time.
 *
 * Linux: `pkexec` which handles its own auth dialog.
 */
function spawnPrivileged(configPath: string): ChildProcess.ChildProcess | null {
  try {
    if (process.platform === "darwin") {
      const askpass = getAskpassPath();
      if (!askpass) return null;

      return ChildProcess.spawn("sudo", ["-A", "openvpn", "--config", configPath, "--verb", "3"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SUDO_ASKPASS: askpass },
      });
    }

    // Linux: pkexec
    return ChildProcess.spawn("pkexec", ["openvpn", "--config", configPath, "--verb", "3"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}
