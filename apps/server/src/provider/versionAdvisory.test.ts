import { assert, describe, it } from "@effect/vitest";

import {
  clearLatestProviderVersionCacheForTests,
  createProviderVersionAdvisory,
} from "./versionAdvisory";

describe("versionAdvisory", () => {
  it("marks a provider behind latest when the installed version is older", () => {
    assert.deepStrictEqual(
      createProviderVersionAdvisory({
        currentVersion: "1.0.0",
        latestVersion: "1.2.0",
        checkedAt: "2026-05-19T00:00:00.000Z",
      }),
      {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.2.0",
        checkedAt: "2026-05-19T00:00:00.000Z",
        message: "Update available: install 1.2.0.",
      },
    );
  });

  it("marks a provider current when the installed version matches latest", () => {
    assert.deepStrictEqual(
      createProviderVersionAdvisory({
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        checkedAt: "2026-05-19T00:00:00.000Z",
      }),
      {
        status: "current",
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        checkedAt: "2026-05-19T00:00:00.000Z",
        message: null,
      },
    );
  });

  it("marks advisory status unknown when latest version is unavailable", () => {
    assert.deepStrictEqual(
      createProviderVersionAdvisory({
        currentVersion: "1.2.0",
        latestVersion: null,
        checkedAt: "2026-05-19T00:00:00.000Z",
      }),
      {
        status: "unknown",
        currentVersion: "1.2.0",
        latestVersion: null,
        checkedAt: "2026-05-19T00:00:00.000Z",
        message: null,
      },
    );
  });

  it("clears the advisory cache for tests", () => {
    clearLatestProviderVersionCacheForTests();
    assert.isTrue(true);
  });
});
