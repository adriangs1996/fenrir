import type { PlanRunnerStepSnapshot } from "@fenrir/contracts";

/**
 * Human label for a step. Plan steps surface their filename (with `.md`
 * stripped), while fixed runner phases use canonical names. Integration is
 * retained only for legacy persisted runs.
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
