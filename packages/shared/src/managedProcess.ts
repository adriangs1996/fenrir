/**
 * Shared managed-process utilities consumed by both server and web.
 *
 * @module managedProcess
 */
import type { ManagedProcessReadiness, ManagedProcessProxy } from "@fenrir/contracts";

/**
 * Compute sensible readiness defaults when the user picks a proxy kind.
 * Used by the settings UI to auto-fill the readiness field.
 */
export function defaultReadinessForProxy(
  proxy: ManagedProcessProxy | null,
): ManagedProcessReadiness {
  if (proxy?.kind === "portless") return { kind: "portless-http" } as ManagedProcessReadiness;
  return { kind: "none" } as ManagedProcessReadiness;
}
