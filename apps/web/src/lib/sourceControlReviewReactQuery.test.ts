import { describe, expect, it } from "vitest";
import { EnvironmentId, ReviewSessionId } from "@fenrir/contracts";

import {
  sourceControlReviewDiffSnapshotQueryOptions,
  sourceControlReviewFilePatchQueryOptions,
  sourceControlReviewGetOrCreateSessionQueryOptions,
  sourceControlReviewQueryKeys,
  sourceControlReviewSessionSnapshotQueryOptions,
} from "./sourceControlReviewReactQuery";

const environmentId = EnvironmentId.make("env-1");
const sessionId = ReviewSessionId.make("review-session-1");

describe("sourceControlReviewReactQuery", () => {
  it("builds stable review query keys", () => {
    expect(sourceControlReviewQueryKeys.session(environmentId, sessionId)).toEqual([
      "source-control-review",
      "env-1",
      "review-session-1",
    ]);
    expect(
      sourceControlReviewQueryKeys.filePatch(
        environmentId,
        sessionId,
        "unstaged",
        "apps/web/src/App.tsx",
      ),
    ).toEqual([
      "source-control-review",
      "env-1",
      "review-session-1",
      "file-patch",
      "unstaged",
      "apps/web/src/App.tsx",
    ]);
  });

  it("disables review queries until required context is available", () => {
    expect(
      sourceControlReviewGetOrCreateSessionQueryOptions({
        environmentId: null,
        request: null,
      }).enabled,
    ).toBe(false);
    expect(
      sourceControlReviewSessionSnapshotQueryOptions({
        environmentId,
        sessionId: null,
      }).enabled,
    ).toBe(false);
    expect(
      sourceControlReviewDiffSnapshotQueryOptions({
        environmentId,
        sessionId,
      }).enabled,
    ).toBe(true);
    expect(
      sourceControlReviewFilePatchQueryOptions({
        environmentId,
        sessionId,
        lane: null,
        normalizedPath: "apps/web/src/App.tsx",
      }).enabled,
    ).toBe(false);
  });
});
