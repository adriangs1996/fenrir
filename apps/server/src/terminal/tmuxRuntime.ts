import { execFileSync } from "node:child_process";

export const TERMINAL_TMUX_SESSION_PREFIX = "fenrir-";
export const MANAGED_PROCESS_TMUX_SESSION_PREFIX = "fenrir-mp-";
export const DEFAULT_TMUX_COMMAND_TIMEOUT_MS = 10_000;

export function sanitizeTmuxName(value: string): string {
  return value.replace(/[.:]/g, "-");
}

export function makeTmuxSessionName(prefix: string, projectId: string): string {
  return `${prefix}${sanitizeTmuxName(projectId)}`;
}

export function tmuxTarget(sessionName: string, windowName: string): string {
  return `${sessionName}:${windowName}`;
}

export function execTmuxSync(
  args: readonly string[],
  options?: { readonly timeoutMs?: number },
): string {
  return execFileSync("tmux", [...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options?.timeoutMs ?? DEFAULT_TMUX_COMMAND_TIMEOUT_MS,
  }).trim();
}

export function checkTmuxSync(
  args: readonly string[],
  options?: { readonly timeoutMs?: number },
): boolean {
  try {
    execTmuxSync(args, options);
    return true;
  } catch {
    return false;
  }
}
