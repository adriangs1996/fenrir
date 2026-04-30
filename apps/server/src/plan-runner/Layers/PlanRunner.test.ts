import { describe, expect, it } from "vitest";

import { findRecentProviderTurnStartFailure } from "./PlanRunner";

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
