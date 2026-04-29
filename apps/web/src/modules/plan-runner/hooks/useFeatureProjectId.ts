import type { ProjectId } from "@fenrir/contracts";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";

/**
 * Resolve the owning `projectId` for a feature name from the plan-runner
 * store. Looks first in `plansByFeatureKey` (already-cached plans pin the
 * exact project), then falls back to `featuresByProjectId` discovery data.
 *
 * Returns `null` until either source has been seeded — callers should
 * render a loader while resolution is pending.
 */
export function useFeatureProjectId(featureName: string): ProjectId | null {
  return usePlanRunnerStore((s): ProjectId | null => {
    for (const key of Object.keys(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        const projectId = key.split(":")[0] ?? null;
        if (projectId) return projectId as ProjectId;
      }
    }
    for (const [pid, features] of Object.entries(s.featuresByProjectId)) {
      if (features.some((f) => f.featureName === featureName)) return pid as ProjectId;
    }
    return null;
  });
}
