import type { FeatureSummary } from "@fenrir/contracts";

/**
 * UI-level status of a feature's last/current run, as rendered by the
 * sidebar status icon and configure-page affordances.
 *
 * Mapping from {@link FeatureSummary} fields:
 *  - `notRun`     — no stored run yet (`lastRunId === null`)
 *  - `running`    — a run is active (`hasActiveRun`) and not in `recovering`
 *  - `recovering` — a run is active and `lastRunState === "recovering"`
 *  - `stopped`    — a run is paused and resumable
 *  - `passed`     — terminal: `lastRunState === "completed"`
 *  - `failed`     — terminal: `lastRunState === "failed"`
 *
 * Defaults to `notRun` when the summary lacks enough information.
 */
export type FeatureRunStatus =
  | "notRun"
  | "running"
  | "recovering"
  | "stopped"
  | "passed"
  | "failed";

export function getFeatureRunStatus(feature: FeatureSummary): FeatureRunStatus {
  if (feature.hasActiveRun) {
    if (feature.lastRunState === "stopped") return "stopped";
    return feature.lastRunState === "recovering" ? "recovering" : "running";
  }
  if (!feature.lastRunId) return "notRun";
  if (feature.lastRunState === "stopped") return "stopped";
  if (feature.lastRunState === "completed") return "passed";
  if (feature.lastRunState === "failed") return "failed";
  // Active run flag flipped off but a non-terminal lastRunState is recorded —
  // this is a transient race, fall back to the closest meaningful bucket.
  if (feature.lastRunState === "recovering") return "recovering";
  return "running";
}

/** True when a Start command should be blocked because a run already owns the feature. */
export function isFeatureStartBlocked(feature: FeatureSummary): boolean {
  return feature.hasActiveRun;
}
