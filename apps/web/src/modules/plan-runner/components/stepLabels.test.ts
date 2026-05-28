import {
  IsoDateTime,
  NonNegativeInt,
  TrimmedNonEmptyString,
  type PlanRunnerStepSnapshot,
} from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import { stepLabel } from "./stepLabels";

const tn = TrimmedNonEmptyString.make;
const ts = IsoDateTime.make;
const nn = NonNegativeInt.make;

function makeStep(overrides: Partial<PlanRunnerStepSnapshot>): PlanRunnerStepSnapshot {
  return {
    stepKey: tn("plan:p"),
    kind: "plan",
    planId: "p",
    filename: tn("01-step.md"),
    state: "running",
    failureSummary: null,
    startedAt: ts("2026-04-01T00:00:00.000Z"),
    completedAt: null,
    executionOrder: nn(0),
    threadRefs: [],
    ...overrides,
  };
}

describe("stepLabel", () => {
  it("renders 'Analyzer' for analyzer steps", () => {
    expect(
      stepLabel(
        makeStep({
          kind: "analyzer",
          planId: null,
          filename: null,
          stepKey: tn("analyzer"),
        }),
      ),
    ).toBe("Analyzer");
  });

  it("renders 'Integration' for integration steps", () => {
    expect(
      stepLabel(
        makeStep({
          kind: "integration",
          planId: null,
          filename: null,
          stepKey: tn("integration"),
        }),
      ),
    ).toBe("Integration");
  });

  it("strips the .md suffix from plan filenames", () => {
    expect(stepLabel(makeStep({ filename: tn("03-thing.md") }))).toBe("03-thing");
  });

  it("falls back to stepKey when a plan step has no filename", () => {
    expect(
      stepLabel(
        makeStep({
          filename: null,
          stepKey: tn("plan:fallback"),
        }),
      ),
    ).toBe("plan:fallback");
  });
});
