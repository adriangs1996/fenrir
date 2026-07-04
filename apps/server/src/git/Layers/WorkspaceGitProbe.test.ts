import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { GitCommandError, GitHubCliError } from "@fenrir/contracts";

import type { ProcessRunResult } from "../../processRunner.ts";
import { GitCore, type GitCoreShape, type GitStatusDetails } from "../Services/GitCore.ts";
import { GitHubCli, type GitHubCliShape } from "../Services/GitHubCli.ts";
import { WorkspaceGitProbe } from "../Services/WorkspaceGitProbe.ts";
import {
  mapWorkspaceGitProbeChecksState,
  mapWorkspaceGitProbePullRequestState,
  WorkspaceGitProbeLive,
} from "./WorkspaceGitProbe.ts";

function ghSuccess(stdout: string): ProcessRunResult {
  return {
    stdout,
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
  };
}

function statusDetails(overrides: Partial<GitStatusDetails> = {}): GitStatusDetails {
  return {
    isRepo: true,
    hasOriginRemote: true,
    isDefaultBranch: false,
    branch: "feature/probe",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 2,
    behindCount: 1,
    aheadOfDefaultCount: 0,
    upstreamRef: "origin/feature/probe",
    ...overrides,
  };
}

interface FakeGhRunner {
  readonly calls: Array<ReadonlyArray<string>>;
  readonly layer: Layer.Layer<GitHubCli>;
}

function makeFakeGhRunner(
  respond: (args: ReadonlyArray<string>) => Effect.Effect<ProcessRunResult, GitHubCliError>,
): FakeGhRunner {
  const calls: Array<ReadonlyArray<string>> = [];
  const execute: GitHubCliShape["execute"] = (input) => {
    calls.push(input.args);
    return respond(input.args);
  };
  return {
    calls,
    layer: Layer.mock(GitHubCli)({ execute }),
  };
}

function makeLayer(input: {
  readonly gitCore?: Partial<GitCoreShape>;
  readonly gh: FakeGhRunner;
}): Layer.Layer<WorkspaceGitProbe> {
  return WorkspaceGitProbeLive.pipe(
    Layer.provide(Layer.mock(GitCore)(input.gitCore ?? {})),
    Layer.provide(input.gh.layer),
  );
}

const openPassingPrJson = JSON.stringify({
  number: 128,
  state: "OPEN",
  isDraft: false,
  url: "https://github.com/acme/fenrir/pull/128",
  statusCheckRollup: [
    { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "StatusContext", state: "SUCCESS" },
  ],
});

describe("WorkspaceGitProbe", () => {
  it.effect("returns branch, ahead/behind and PR status from gh JSON", () => {
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess(openPassingPrJson)));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/workspace/fenrir" });

      assert.deepStrictEqual(result, {
        branch: "feature/probe",
        ahead: 2,
        behind: 1,
        pr: {
          number: 128,
          state: "open",
          checks: "pass",
          url: "https://github.com/acme/fenrir/pull/128",
        },
      });
      assert.equal(gh.calls.length, 1);
      assert.deepStrictEqual(gh.calls[0]?.slice(0, 2), ["pr", "view"]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: { statusDetailsLocal: () => Effect.succeed(statusDetails()) },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("degrades to pr:null when gh is missing or unauthenticated", () => {
    const gh = makeFakeGhRunner(() =>
      Effect.fail(
        new GitHubCliError({
          operation: "execute",
          detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        }),
      ),
    );

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/workspace/fenrir" });

      assert.deepStrictEqual(result, {
        branch: "feature/probe",
        ahead: 2,
        behind: 1,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: { statusDetailsLocal: () => Effect.succeed(statusDetails()) },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("degrades to pr:null on malformed gh JSON", () => {
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess("not json at all")));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/workspace/fenrir" });

      assert.equal(result.branch, "feature/probe");
      assert.equal(result.pr, null);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: { statusDetailsLocal: () => Effect.succeed(statusDetails()) },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("returns all-null without calling gh when the path is not a repository", () => {
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess(openPassingPrJson)));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(result, { branch: null, ahead: null, behind: null, pr: null });
      assert.equal(gh.calls.length, 0);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: {
              statusDetailsLocal: (cwd) =>
                Effect.fail(
                  new GitCommandError({
                    operation: "statusDetailsLocal",
                    command: "git status",
                    cwd,
                    detail: "not a git repository",
                  }),
                ),
            },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("skips the PR probe on detached HEAD and hides ahead/behind without upstream", () => {
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess(openPassingPrJson)));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/workspace/detached" });

      assert.deepStrictEqual(result, { branch: null, ahead: null, behind: null, pr: null });
      assert.equal(gh.calls.length, 0);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: {
              statusDetailsLocal: () =>
                Effect.succeed(
                  statusDetails({
                    branch: null,
                    hasUpstream: false,
                    aheadCount: 0,
                    behindCount: 0,
                  }),
                ),
            },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("serves cached snapshots within the TTL and refreshes after expiry", () => {
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess(openPassingPrJson)));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;

      const first = yield* probe.probe({ cwd: "/workspace/fenrir" });
      const second = yield* probe.probe({ cwd: "/workspace/fenrir" });
      assert.deepStrictEqual(second, first);
      assert.equal(gh.calls.length, 1);

      yield* TestClock.adjust(Duration.seconds(30));
      yield* probe.probe({ cwd: "/workspace/fenrir" });
      assert.equal(gh.calls.length, 1);

      yield* TestClock.adjust(Duration.seconds(31));
      yield* probe.probe({ cwd: "/workspace/fenrir" });
      assert.equal(gh.calls.length, 2);

      // Distinct workspaces are cached independently.
      yield* probe.probe({ cwd: "/workspace/other" });
      assert.equal(gh.calls.length, 3);
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: { statusDetailsLocal: () => Effect.succeed(statusDetails()) },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  it.effect("maps draft and failing-checks pull requests", () => {
    const draftFailingPrJson = JSON.stringify({
      number: 12,
      state: "OPEN",
      isDraft: true,
      url: "https://github.com/acme/fenrir/pull/12",
      statusCheckRollup: [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
      ],
    });
    const gh = makeFakeGhRunner(() => Effect.succeed(ghSuccess(draftFailingPrJson)));

    return Effect.gen(function* () {
      const probe = yield* WorkspaceGitProbe;
      const result = yield* probe.probe({ cwd: "/workspace/fenrir" });

      assert.deepStrictEqual(result.pr, {
        number: 12,
        state: "draft",
        checks: "fail",
        url: "https://github.com/acme/fenrir/pull/12",
      });
    }).pipe(
      Effect.provide(
        Layer.merge(
          makeLayer({
            gitCore: { statusDetailsLocal: () => Effect.succeed(statusDetails()) },
            gh,
          }),
          TestClock.layer(),
        ),
      ),
    );
  });

  describe("mapWorkspaceGitProbePullRequestState", () => {
    it("maps gh lifecycle states onto the probe contract", () => {
      assert.equal(mapWorkspaceGitProbePullRequestState("OPEN", false), "open");
      assert.equal(mapWorkspaceGitProbePullRequestState("OPEN", true), "draft");
      assert.equal(mapWorkspaceGitProbePullRequestState("MERGED", false), "merged");
      assert.equal(mapWorkspaceGitProbePullRequestState("MERGED", true), "merged");
      assert.equal(mapWorkspaceGitProbePullRequestState("CLOSED", false), "closed");
      assert.equal(mapWorkspaceGitProbePullRequestState("closed", true), "closed");
    });
  });

  describe("mapWorkspaceGitProbeChecksState", () => {
    it("returns unknown for empty or missing rollups", () => {
      assert.equal(mapWorkspaceGitProbeChecksState(null), "unknown");
      assert.equal(mapWorkspaceGitProbeChecksState(undefined), "unknown");
      assert.equal(mapWorkspaceGitProbeChecksState([]), "unknown");
    });

    it("lets any failure win over pending and pass", () => {
      assert.equal(
        mapWorkspaceGitProbeChecksState([
          { conclusion: "SUCCESS" },
          { status: "IN_PROGRESS" },
          { conclusion: "FAILURE" },
        ]),
        "fail",
      );
      assert.equal(mapWorkspaceGitProbeChecksState([{ state: "ERROR" }]), "fail");
      assert.equal(mapWorkspaceGitProbeChecksState([{ conclusion: "TIMED_OUT" }]), "fail");
    });

    it("reports pending while any check is in flight", () => {
      assert.equal(
        mapWorkspaceGitProbeChecksState([{ conclusion: "SUCCESS" }, { status: "QUEUED" }]),
        "pending",
      );
      assert.equal(mapWorkspaceGitProbeChecksState([{ state: "PENDING" }]), "pending");
      // A CheckRun that has not completed and has no conclusion is in flight.
      assert.equal(mapWorkspaceGitProbeChecksState([{ status: "IN_PROGRESS" }]), "pending");
    });

    it("reports pass when every reported check succeeded or was skipped", () => {
      assert.equal(
        mapWorkspaceGitProbeChecksState([
          { conclusion: "SUCCESS" },
          { conclusion: "SKIPPED" },
          { state: "SUCCESS" },
        ]),
        "pass",
      );
    });

    it("stays unknown for unrecognized signals", () => {
      assert.equal(mapWorkspaceGitProbeChecksState([{ state: "SOMETHING_ELSE" }]), "unknown");
    });
  });
});
