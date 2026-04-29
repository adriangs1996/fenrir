import type { PlanRunnerStepSnapshot } from "@fenrir/contracts";

/**
 * Human label for a step. Plan steps surface their filename (with `.md`
 * stripped), while the fixed analyzer/integration phases use canonical names.
 *
 * Falls back to the (always-present) `stepKey` if a plan step is missing its
 * filename — schema disallows this but we still render something rather than
 * crash if the server snapshot is malformed.
 */
export function stepLabel(step: PlanRunnerStepSnapshot): string {
  switch (step.kind) {
    case "analyzer":
      return "Analyzer";
    case "integration":
      return "Integration";
    case "plan":
      if (step.filename) return step.filename.replace(/\.md$/, "");
      return step.stepKey;
  }
}
