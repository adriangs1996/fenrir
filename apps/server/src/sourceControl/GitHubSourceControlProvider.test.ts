import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const processResult = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeProvider(github: Partial<GitHubCli.GitHubCliShape>) {
  return GitHubSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(GitHubCli.GitHubCli)(github)),
  );
}

it.effect("maps GitHub PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitHub provider",
          url: "https://github.com/pingdotgg/t3code/pull/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/t3code",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "github",
      number: 42,
      title: "Add GitHub provider",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/t3code",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("uses gh json listing for non-open change request state queries", () =>
  Effect.gen(function* () {
    let executeArgs: ReadonlyArray<string> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs = input.args;
        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 7,
                title: "Merged work",
                url: "https://github.com/pingdotgg/t3code/pull/7",
                baseRefName: "main",
                headRefName: "feature/merged",
                state: "merged",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ]),
          ),
        );
      },
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/merged",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(executeArgs, [
      "pr",
      "list",
      "--head",
      "feature/merged",
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
    ]);
    assert.strictEqual(changeRequests[0]?.provider, "github");
    assert.strictEqual(changeRequests[0]?.state, "merged");
    assert.deepStrictEqual(
      changeRequests[0]?.updatedAt,
      Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    );
  }),
);

it.effect("treats empty non-open change request listing output as no results", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: () => Effect.succeed(processResult("")),
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/empty",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(changeRequests, []);
  }),
);

it.effect("creates GitHub PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GitHubCli.GitHubCliShape["createPullRequest"]>[0] | null = null;
    const provider = yield* makeProvider({
      createPullRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });

    assert.deepStrictEqual(createInput, {
      cwd: "/repo",
      baseBranch: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it.effect("lists GitHub pull request review threads from GraphQL", () =>
  Effect.gen(function* () {
    const executeArgs: Array<ReadonlyArray<string>> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs.push(input.args);
        if (input.args[0] === "repo") {
          return Effect.succeed(processResult("fenrir/t3code\n"));
        }

        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                data: {
                  repository: {
                    pullRequest: {
                      reviewThreads: {
                        nodes: [
                          {
                            id: "thread-1",
                            path: "src/file.ts",
                            diffSide: "RIGHT",
                            line: 20,
                            startLine: 18,
                            isResolved: false,
                            isOutdated: false,
                            comments: {
                              nodes: [
                                {
                                  id: "comment-1",
                                  body: "Nice",
                                  author: {
                                    login: "alice",
                                    avatarUrl: "https://example.test/alice.png",
                                  },
                                  createdAt: "2026-06-08T10:00:00Z",
                                  updatedAt: "2026-06-08T10:00:00Z",
                                  url: "https://github.com/fenrir/t3code/pull/42#discussion_r1",
                                },
                                {
                                  id: "comment-2",
                                  body: "Agreed",
                                  author: {
                                    login: "bob",
                                    avatarUrl: null,
                                  },
                                  createdAt: "2026-06-08T10:05:00Z",
                                  updatedAt: null,
                                  url: null,
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            ]),
          ),
        );
      },
    });

    const threads = yield* provider.listChangeRequestReviewThreads({
      cwd: "/repo",
      reference: "#42",
    });

    assert.deepStrictEqual(executeArgs[0], [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
    assert.deepStrictEqual(executeArgs[1]?.slice(0, 8), [
      "api",
      "graphql",
      "--paginate",
      "--slurp",
      "-F",
      "owner=fenrir",
      "-F",
      "name=t3code",
    ]);
    assert.deepStrictEqual(threads, [
      {
        id: "thread-1",
        path: "src/file.ts",
        side: "additions",
        line: 20,
        startLine: 18,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            id: "comment-1",
            body: "Nice",
            author: {
              login: "alice",
              avatarUrl: "https://example.test/alice.png",
            },
            createdAt: "2026-06-08T10:00:00Z",
            updatedAt: "2026-06-08T10:00:00Z",
            url: "https://github.com/fenrir/t3code/pull/42#discussion_r1",
          },
          {
            id: "comment-2",
            body: "Agreed",
            author: {
              login: "bob",
            },
            createdAt: "2026-06-08T10:05:00Z",
          },
        ],
      },
    ]);
  }),
);
