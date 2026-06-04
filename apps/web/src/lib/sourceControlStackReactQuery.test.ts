import { describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId } from "@fenrir/contracts";

import {
  sourceControlStackMutationOptions,
  sourceControlStackQueryKeys,
  sourceControlStackSnapshotQueryOptions,
} from "./sourceControlStackReactQuery";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");

describe("sourceControlStackReactQuery", () => {
  it("builds stable stack query keys", () => {
    expect(sourceControlStackQueryKeys.snapshot(environmentId, threadId)).toEqual([
      "source-control-stack",
      "env-1",
      "thread-1",
    ]);
  });

  it("disables snapshot queries until environment and thread are available", () => {
    expect(
      sourceControlStackSnapshotQueryOptions({
        environmentId: null,
        threadId,
      }).enabled,
    ).toBe(false);
    expect(
      sourceControlStackSnapshotQueryOptions({
        environmentId,
        threadId: null,
      }).enabled,
    ).toBe(false);
    expect(
      sourceControlStackSnapshotQueryOptions({
        environmentId,
        threadId,
        selectedHeadRefName: "feature/stack",
      }).enabled,
    ).toBe(true);
  });

  it("uses caller-provided mutation keys", () => {
    const options = sourceControlStackMutationOptions({
      environmentId: null,
      cwd: null,
      queryClient: {} as never,
      mutationKey: ["source-control-stack", "env-1", "publish"] as const,
      run: async () => ({}) as never,
    });

    expect(options.mutationKey).toEqual(["source-control-stack", "env-1", "publish"]);
  });
});
