import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { GitHubCliError } from "@fenrir/contracts";

import { GitHubCli } from "../../../git/Services/GitHubCli.ts";
import { ReviewProvider } from "../Services/ReviewProvider.ts";
import { GitHubReviewProviderLive } from "./GitHubReviewProvider.ts";

function makeRuntime(overrides: {
  readonly execute?: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<
    {
      readonly stdout: string;
      readonly stderr: string;
      readonly code: number;
      readonly signal: null;
      readonly timedOut: boolean;
    },
    GitHubCliError
  >;
  readonly getPullRequest?: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<
    {
      readonly number: number;
      readonly title: string;
      readonly url: string;
      readonly baseRefName: string;
      readonly headRefName: string;
    },
    GitHubCliError
  >;
}) {
  const layer = GitHubReviewProviderLive.pipe(
    Layer.provide(
      Layer.mock(GitHubCli)({
        execute:
          overrides.execute ??
          (() =>
            Effect.fail(
              new GitHubCliError({
                operation: "execute",
                detail: "unexpected execute",
              }),
            )),
        listOpenPullRequests: () => Effect.succeed([]),
        getPullRequest:
          overrides.getPullRequest ??
          (() =>
            Effect.fail(
              new GitHubCliError({
                operation: "getPullRequest",
                detail: "unexpected getPullRequest",
              }),
            )),
        getRepositoryCloneUrls: () =>
          Effect.fail(
            new GitHubCliError({
              operation: "getRepositoryCloneUrls",
              detail: "unexpected getRepositoryCloneUrls",
            }),
          ),
        createPullRequest: () =>
          Effect.fail(
            new GitHubCliError({
              operation: "createPullRequest",
              detail: "unexpected createPullRequest",
            }),
          ),
        getDefaultBranch: () => Effect.succeed(null),
        checkoutPullRequest: () =>
          Effect.fail(
            new GitHubCliError({
              operation: "checkoutPullRequest",
              detail: "unexpected checkoutPullRequest",
            }),
          ),
      }),
    ),
  );

  return ManagedRuntime.make(layer);
}

describe("GitHubReviewProvider", () => {
  it("returns an unavailable result when no pull request is attached", async () => {
    const runtime = makeRuntime({});
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewProvider = yield* ReviewProvider;
        return yield* reviewProvider.readReview({
          cwd: "/repo",
          pullRequest: null,
        });
      }),
    );

    expect(result).toEqual({
      status: "unavailable",
      provider: "github",
      reason: "no-pull-request",
      message: "No GitHub pull request is attached to this review session.",
      pullRequest: null,
    });
  });

  it("reads a GitHub pull request snapshot through gh graphql", async () => {
    const runtime = makeRuntime({
      execute: ({ args }) => {
        expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
        return Effect.succeed({
          stdout: JSON.stringify({
            data: {
              resource: {
                __typename: "PullRequest",
                number: 42,
                url: "https://github.com/fenrir/fenrir/pull/42",
                title: "Rich review provider",
                state: "OPEN",
                isDraft: false,
                body: "This PR wires the remote review read path.",
                createdAt: "2026-05-20T10:00:00.000Z",
                updatedAt: "2026-05-20T11:00:00.000Z",
                baseRefName: "main",
                headRefName: "feature/rich-review-tab",
                author: {
                  login: "adrian",
                  avatarUrl: "https://avatars.example/adrian.png",
                },
                reviewThreads: {
                  nodes: [
                    {
                      id: "PRRT_1",
                      path: "apps/server/src/review/provider.ts",
                      diffSide: "RIGHT",
                      startDiffSide: "RIGHT",
                      line: 18,
                      originalLine: 15,
                      startLine: 16,
                      originalStartLine: 13,
                      subjectType: "LINE",
                      isResolved: true,
                      isOutdated: false,
                      isCollapsed: true,
                      comments: {
                        nodes: [
                          {
                            id: "PRRC_1",
                            url: "https://github.com/fenrir/fenrir/pull/42#discussion_r1",
                            body: "Use the normalized anchor vocabulary here.",
                            path: "apps/server/src/review/provider.ts",
                            diffHunk: "@@ -13,4 +16,4 @@ const anchor = buildAnchor();",
                            line: 18,
                            originalLine: 15,
                            startLine: 16,
                            originalStartLine: 13,
                            createdAt: "2026-05-20T10:05:00.000Z",
                            updatedAt: "2026-05-20T10:06:00.000Z",
                            author: {
                              login: "reviewer",
                              avatarUrl: "https://avatars.example/reviewer.png",
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
                comments: {
                  nodes: [
                    {
                      id: "PRC_1",
                      url: "https://github.com/fenrir/fenrir/pull/42#issuecomment-1",
                      body: "Top-level discussion comment.",
                      createdAt: "2026-05-20T10:10:00.000Z",
                      updatedAt: "2026-05-20T10:11:00.000Z",
                      author: {
                        login: "maintainer",
                        avatarUrl: "https://avatars.example/maintainer.png",
                      },
                    },
                  ],
                },
              },
            },
          }),
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        });
      },
    });

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewProvider = yield* ReviewProvider;
        return yield* reviewProvider.readReview({
          cwd: "/repo",
          pullRequest: {
            provider: "github",
            number: 42,
            url: "https://github.com/fenrir/fenrir/pull/42",
            baseRef: "main",
            headRef: "feature/rich-review-tab",
          },
        });
      }),
    );

    expect(result.status).toBe("available");
    if (result.status !== "available") {
      return;
    }

    expect(result.snapshot.pullRequest.title).toBe("Rich review provider");
    expect(result.snapshot.reviewThreads).toHaveLength(1);
    expect(result.snapshot.reviewThreads[0]?.anchor).toEqual({
      normalizedPath: "apps/server/src/review/provider.ts",
      provenance: {
        scope: "branch",
        lane: "committed",
      },
      oldRange: {
        startLine: 13,
        endLine: 15,
      },
      newRange: {
        startLine: 16,
        endLine: 18,
      },
      excerpt: "@@ -13,4 +16,4 @@ const anchor = buildAnchor();",
    });
    expect(result.snapshot.reviewThreads[0]?.isResolved).toBe(true);
    expect(result.snapshot.generalComments[0]?.authorLogin).toBe("maintainer");
  });

  it("degrades cleanly when gh is missing", async () => {
    const runtime = makeRuntime({
      execute: () =>
        Effect.fail(
          new GitHubCliError({
            operation: "execute",
            detail: "GitHub CLI (`gh`) is required but not available on PATH.",
          }),
        ),
    });

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewProvider = yield* ReviewProvider;
        return yield* reviewProvider.readReview({
          cwd: "/repo",
          pullRequest: {
            provider: "github",
            number: 42,
            url: "https://github.com/fenrir/fenrir/pull/42",
            baseRef: "main",
            headRef: "feature/rich-review-tab",
          },
        });
      }),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") {
      return;
    }
    expect(result.reason).toBe("provider-cli-missing");
  });

  it("resolves a pull request reference through gh pr view", async () => {
    const runtime = makeRuntime({
      getPullRequest: ({ reference }) => {
        expect(reference).toBe("#42");
        return Effect.succeed({
          number: 42,
          title: "Rich review provider",
          url: "https://github.com/fenrir/fenrir/pull/42",
          baseRefName: "main",
          headRefName: "feature/rich-review-tab",
        });
      },
    });

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const reviewProvider = yield* ReviewProvider;
        return yield* reviewProvider.resolvePullRequestReference({
          cwd: "/repo",
          reference: "#42",
        });
      }),
    );

    expect(result).toEqual({
      provider: "github",
      number: 42,
      url: "https://github.com/fenrir/fenrir/pull/42",
      baseRef: "main",
      headRef: "feature/rich-review-tab",
    });
  });
});
