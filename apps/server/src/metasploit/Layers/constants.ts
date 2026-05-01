/**
 * Metasploit service configuration constants and test seams.
 */
import type { Duration } from "effect";
import { createMsfrpcClient, type MsfrpcClient } from "./msfrpcClient";

// ─── MSFRPC Defaults ───────────────────────────────────────────────────────

export const MSFRPC_HOST = "127.0.0.1";
export const MSFRPC_PORT = 55553;
export const MSFRPC_USER = "msf";
export const MSFRPC_PASSWORD = "fenrir";
export const SESSION_POLL_INTERVAL = "2 seconds";
export const JOB_POLL_INTERVAL = "2 seconds";
export const JOB_MISS_THRESHOLD = 2;
export const POLL_FAILURE_THRESHOLD = 3;

// ─── Test Seams ────────────────────────────────────────────────────────────

/** @internal Mutable test seam — tests override properties to inject fakes. Reset in afterEach. */
export const __testSeams: {
  createClient: typeof createMsfrpcClient;
  startupDelay: Duration.Input;
  /** Polling interval between upgrade verification attempts (default 2s, up to MAX_UPGRADE_ATTEMPTS). */
  upgradeDelay: Duration.Input;
  sessionPollInterval: Duration.Input;
  jobPollInterval: Duration.Input;
} = {
  createClient: createMsfrpcClient,
  startupDelay: "8 seconds",
  upgradeDelay: "2 seconds",
  sessionPollInterval: SESSION_POLL_INTERVAL,
  jobPollInterval: JOB_POLL_INTERVAL,
};
