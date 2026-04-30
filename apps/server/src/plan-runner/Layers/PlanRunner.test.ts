import { describe, expect, it } from "vitest";

import { computeExecutionDispatch, findRecentProviderTurnStartFailure } from "./PlanRunner";

describe("findRecentProviderTurnStartFailure", () => {
  it("returns the recent provider failure detail", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: { detail: "Claude binary path is invalid." },
              createdAt: "2026-04-30T10:31:49.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBe("Claude binary path is invalid.");
  });

  it("ignores stale failures from before the current wait window", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: { detail: "Old failure." },
              createdAt: "2026-04-30T10:31:47.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBeNull();
  });

  it("falls back to the activity summary when no detail exists", () => {
    expect(
      findRecentProviderTurnStartFailure(
        {
          activities: [
            {
              kind: "provider.turn.start.failed",
              summary: "Provider turn start failed",
              payload: {},
              createdAt: "2026-04-30T10:31:49.000Z",
            },
          ],
        },
        "2026-04-30T10:31:48.000Z",
      ),
    ).toBe("Provider turn start failed");
  });
});

describe("computeExecutionDispatch", () => {
  it("fills newly opened slots with dependency-ready plans", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "done" },
          { planId: "b", state: "running" },
          { planId: "d", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["b"]),
      }),
    ).toEqual({
      occupiedSlots: 1,
      readyPlanIds: ["d"],
    });
  });

  it("does not dispatch more work when all slots are occupied", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "running" },
          { planId: "b", state: "reviewing" },
          { planId: "c", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["a", "b"]),
      }),
    ).toEqual({
      occupiedSlots: 2,
      readyPlanIds: [],
    });
  });

  it("excludes plans already being launched from the ready queue", () => {
    expect(
      computeExecutionDispatch({
        plans: [
          { planId: "a", state: "ready" },
          { planId: "b", state: "ready" },
          { planId: "c", state: "ready" },
        ],
        maxConcurrency: 2,
        inFlightPlanIds: new Set(["a"]),
      }),
    ).toEqual({
      occupiedSlots: 1,
      readyPlanIds: ["b"],
    });
  });
});
