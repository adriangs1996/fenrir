import {
  IsoDateTime,
  PlanRunId,
  TrimmedNonEmptyString,
  type FeatureSummary,
} from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import { getFeatureRunStatus, isFeatureStartBlocked } from "./featureRunStatus";

const tn = TrimmedNonEmptyString.makeUnsafe;
const rid = PlanRunId.makeUnsafe;
const ts = IsoDateTime.makeUnsafe;

function makeFeature(
  overrides: Partial<FeatureSummary> & { featureName?: string } = {},
): FeatureSummary {
  return {
    featureName: tn(overrides.featureName ?? "demo-feature"),
    planCount: 0,
    hasActiveRun: overrides.hasActiveRun ?? false,
    activeRunId: overrides.activeRunId ?? null,
    lastRunId: overrides.lastRunId ?? null,
    lastRunState: overrides.lastRunState ?? null,
    lastRunUpdatedAt: overrides.lastRunUpdatedAt ?? null,
  };
}

describe("getFeatureRunStatus", () => {
  it("returns 'notRun' for a feature with no stored run", () => {
    expect(getFeatureRunStatus(makeFeature())).toBe("notRun");
  });

  it("returns 'running' when a non-recovering run is active", () => {
    expect(
      getFeatureRunStatus(
        makeFeature({
          hasActiveRun: true,
          activeRunId: rid("run-1"),
          lastRunId: rid("run-1"),
          lastRunState: "executing",
          lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toBe("running");
  });

  it("returns 'recovering' when active run is in recovering state", () => {
    expect(
      getFeatureRunStatus(
        makeFeature({
          hasActiveRun: true,
          activeRunId: rid("run-1"),
          lastRunId: rid("run-1"),
          lastRunState: "recovering",
          lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toBe("recovering");
  });

  it("returns 'passed' on a completed terminal run", () => {
    expect(
      getFeatureRunStatus(
        makeFeature({
          lastRunId: rid("run-1"),
          lastRunState: "completed",
          lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toBe("passed");
  });

  it("returns 'failed' on a failed terminal run", () => {
    expect(
      getFeatureRunStatus(
        makeFeature({
          lastRunId: rid("run-1"),
          lastRunState: "failed",
          lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toBe("failed");
  });

  it("falls back to 'recovering' when active flag dropped but state persists", () => {
    expect(
      getFeatureRunStatus(
        makeFeature({
          lastRunId: rid("run-1"),
          lastRunState: "recovering",
          lastRunUpdatedAt: ts("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toBe("recovering");
  });
});

describe("isFeatureStartBlocked", () => {
  it("blocks Start while a run is active", () => {
    expect(
      isFeatureStartBlocked(
        makeFeature({
          hasActiveRun: true,
          activeRunId: rid("run-1"),
          lastRunId: rid("run-1"),
          lastRunState: "executing",
        }),
      ),
    ).toBe(true);
  });

  it("blocks Start during recovery (still has active run)", () => {
    expect(
      isFeatureStartBlocked(
        makeFeature({
          hasActiveRun: true,
          activeRunId: rid("run-1"),
          lastRunId: rid("run-1"),
          lastRunState: "recovering",
        }),
      ),
    ).toBe(true);
  });

  it("permits Start once the run reaches a terminal state", () => {
    expect(
      isFeatureStartBlocked(
        makeFeature({
          lastRunId: rid("run-1"),
          lastRunState: "completed",
        }),
      ),
    ).toBe(false);
    expect(
      isFeatureStartBlocked(
        makeFeature({
          lastRunId: rid("run-1"),
          lastRunState: "failed",
        }),
      ),
    ).toBe(false);
  });
});
