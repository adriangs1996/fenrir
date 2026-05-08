import type { ManagedProcessInstance, ManagedProcessInstanceStatus } from "@fenrir/contracts";

export function isSameHostAsServer(serverHost: string | null): boolean {
  if (!serverHost) return false;
  if (typeof window === "undefined") return false;
  return window.location.hostname === serverHost || window.location.hostname === "localhost";
}

export function displayBranchSlug(branchName: string | null): string {
  if (!branchName) return "";
  return branchName
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function urlForDisplay(instance: ManagedProcessInstance): string | null {
  return instance.url.confirmed ?? instance.url.estimate;
}

/**
 * Base status dot color. A `running` instance with `ready: true` should
 * override to `var(--color-success)` — the value here is the not-ready
 * fallback for `running`.
 */
export const STATUS_DOT_COLOR: Record<ManagedProcessInstanceStatus, string> = {
  idle: "var(--color-muted-fg)",
  starting: "var(--color-warning)",
  running: "var(--color-success-muted)",
  stopping: "var(--color-warning)",
  stopped: "var(--color-muted-fg)",
  crashed: "var(--color-danger)",
};
