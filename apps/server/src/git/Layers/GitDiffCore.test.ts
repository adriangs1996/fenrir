import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../../config";
import { GitCoreLive } from "./GitCore";
import { GitDiffCoreLive } from "./GitDiffCore";
import { GitDiffCore } from "../Services/GitDiffCore";
import type {
  ChangeRequest,
  ChangeRequestCheck,
  ChangeRequestReviewThread,
} from "@fenrir/contracts";
import { LoadDiffFileIndexResult, VcsProcessTimeoutError } from "@fenrir/contracts";
import { execFileSync } from "child_process";
import { Effect, Layer, Option, Schema } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { describe, it } from "@effect/vitest";
import { tmpdir } from "os";
import path from "path";
import { expect } from "vitest";
import type { SourceControlProviderShape } from "../../sourceControl/SourceControlProvider";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry";
import { GitVcsDriver, GitVcsDriverLive } from "../../vcs/GitVcsDriver";
import { VcsDriverRegistry, VcsDriverRegistryLive } from "../../vcs/VcsDriverRegistry";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fenrir-git-diff-core-test",
});
const TEST_DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TEST_UNTRACKED_FILE_LINE_COUNT_MAX_BYTES = 2 * 1024 * 1024;
const decodeLoadDiffFileIndexResult = Schema.decodeUnknownSync(LoadDiffFileIndexResult);

function makeChangeRequest(input: {
  number: number;
  title: string;
  baseRefName: string;
  headRefName: string;
}): ChangeRequest {
  return {
    provider: "github",
    number: input.number,
    title: input.title,
    url: `https://example.test/pull/${input.number}`,
    baseRefName: input.baseRefName,
    headRefName: input.headRefName,
    state: "open",
    updatedAt: Option.none(),
    isCrossRepository: false,
  };
}

function makeSourceControlProviderRegistryLayer(input?: {
  readonly changeRequests?: ReadonlyArray<ChangeRequest>;
  readonly defaultBranch?: string;
  readonly checks?: ReadonlyArray<ChangeRequestCheck>;
  readonly reviewThreads?: ReadonlyArray<ChangeRequestReviewThread>;
  readonly calls?: {
    readonly close?: string[];
    readonly merge?: Array<{
      readonly reference: string;
      readonly method?: "merge" | "squash" | "rebase";
    }>;
    readonly comment?: Array<{
      readonly reference: string;
      readonly path: string;
      readonly body: string;
      readonly side: "additions" | "deletions";
      readonly line: number;
      readonly startLine?: number;
    }>;
  };
}) {
  const changeRequests = input?.changeRequests ?? [];
  const defaultBranch = input?.defaultBranch ?? "main";
  const checks = input?.checks ?? [];
  const reviewThreads = input?.reviewThreads ?? [];
  const provider: SourceControlProviderShape = {
    kind: "github",
    listChangeRequests: (request) =>
      Effect.succeed(
        changeRequests
          .filter(
            (changeRequest) =>
              (request.state === "all" || changeRequest.state === request.state) &&
              (request.headSelector === undefined ||
                changeRequest.headRefName === request.headSelector) &&
              (request.baseRefName === undefined ||
                changeRequest.baseRefName === request.baseRefName),
          )
          .slice(0, request.limit ?? changeRequests.length),
      ),
    getChangeRequest: (request) => {
      const number = Number(request.reference.replace(/^#/u, ""));
      const changeRequest =
        changeRequests.find((candidate) => candidate.number === number) ?? changeRequests[0];
      return changeRequest
        ? Effect.succeed(changeRequest)
        : Effect.die("getChangeRequest should not be called without a matching fixture");
    },
    createChangeRequest: () => Effect.void,
    updateChangeRequest: () => Effect.void,
    closeChangeRequest: (request) =>
      Effect.sync(() => {
        input?.calls?.close?.push(request.reference);
      }),
    mergeChangeRequest: (request) =>
      Effect.sync(() => {
        input?.calls?.merge?.push({
          reference: request.reference,
          ...(request.method ? { method: request.method } : {}),
        });
      }),
    createChangeRequestLineComment: (request) =>
      Effect.sync(() => {
        input?.calls?.comment?.push({
          reference: request.reference,
          path: request.path,
          body: request.body,
          side: request.side,
          line: request.line,
          ...(request.startLine !== undefined ? { startLine: request.startLine } : {}),
        });
      }),
    listChangeRequestChecks: () => Effect.succeed(checks),
    listChangeRequestReviewThreads: () => Effect.succeed(reviewThreads),
    getRepositoryCloneUrls: () =>
      Effect.succeed({
        nameWithOwner: "fenrir/test",
        url: "https://example.test/fenrir/test",
        sshUrl: "git@example.test:fenrir/test.git",
      }),
    createRepository: () =>
      Effect.succeed({
        nameWithOwner: "fenrir/test",
        url: "https://example.test/fenrir/test",
        sshUrl: "git@example.test:fenrir/test.git",
      }),
    getDefaultBranch: () => Effect.succeed(defaultBranch),
    checkoutChangeRequest: () => Effect.void,
  };

  return Layer.succeed(
    SourceControlProviderRegistry,
    SourceControlProviderRegistry.of({
      get: () => Effect.succeed(provider),
      resolve: () => Effect.succeed(provider),
      resolveHandle: () =>
        Effect.succeed({
          provider,
          context: {
            provider: {
              kind: "github",
              name: "GitHub",
              baseUrl: "https://example.test",
            },
            remoteName: "origin",
            remoteUrl: "https://example.test/fenrir/test.git",
          },
        }),
      discover: Effect.succeed([]),
    }),
  );
}

const UI_STACK_CHANGE_REQUESTS = [
  makeChangeRequest({
    number: 1,
    title: "Typed comment API",
    baseRefName: "main",
    headRefName: "feature/typed-comment-api",
  }),
  makeChangeRequest({
    number: 2,
    title: "Optimistic comment posting",
    baseRefName: "feature/typed-comment-api",
    headRefName: "feature/optimistic-comment-posting",
  }),
  makeChangeRequest({
    number: 3,
    title: "Comment composer UI",
    baseRefName: "feature/optimistic-comment-posting",
    headRefName: "feature/comment-composer-ui",
  }),
] as const;

const PROVIDER_TEST_CALLS = {
  close: [] as string[],
  merge: [] as Array<{
    readonly reference: string;
    readonly method?: "merge" | "squash" | "rebase";
  }>,
  comment: [] as Array<{
    readonly reference: string;
    readonly path: string;
    readonly body: string;
    readonly side: "additions" | "deletions";
    readonly line: number;
    readonly startLine?: number;
  }>,
};
const PROVIDER_TEST_CHECKS: ChangeRequestCheck[] = [];
const PROVIDER_TEST_REVIEW_THREADS: ChangeRequestReviewThread[] = [];

function resetProviderTestFixtures() {
  PROVIDER_TEST_CALLS.close.length = 0;
  PROVIDER_TEST_CALLS.merge.length = 0;
  PROVIDER_TEST_CALLS.comment.length = 0;
  PROVIDER_TEST_CHECKS.length = 0;
  PROVIDER_TEST_REVIEW_THREADS.length = 0;
}

const TestLayer = GitDiffCoreLive.pipe(
  Layer.provide(GitCoreLive),
  Layer.provide(VcsDriverRegistryLive),
  Layer.provide(
    makeSourceControlProviderRegistryLayer({
      changeRequests: UI_STACK_CHANGE_REQUESTS,
      calls: PROVIDER_TEST_CALLS,
      checks: PROVIDER_TEST_CHECKS,
      reviewThreads: PROVIDER_TEST_REVIEW_THREADS,
    }),
  ),
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);

function makeReviewDiffDetectionTimeout(cwd: string) {
  return new VcsProcessTimeoutError({
    operation: "GitVcsDriver.isInsideWorkTree",
    command: `git -C ${cwd} rev-parse --is-inside-work-tree`,
    cwd,
    timeoutMs: 5_000,
  });
}

const TimeoutResolvingVcsDriverRegistryLayer = Layer.effect(
  VcsDriverRegistry,
  Effect.gen(function* () {
    const gitDriver = yield* GitVcsDriver;

    return VcsDriverRegistry.of({
      get: (kind) => (kind === "git" ? Effect.succeed(gitDriver) : Effect.die("unexpected VCS")),
      detect: (input) => Effect.fail(makeReviewDiffDetectionTimeout(input.cwd)),
      resolve: (input) => Effect.fail(makeReviewDiffDetectionTimeout(input.cwd)),
      resolveReviewDiff: (input) => Effect.fail(makeReviewDiffDetectionTimeout(input.cwd)),
    });
  }),
).pipe(Layer.provide(GitVcsDriverLive));

const ReviewDiffDetectionTimeoutTestLayer = GitDiffCoreLive.pipe(
  Layer.provide(GitCoreLive),
  Layer.provide(TimeoutResolvingVcsDriverRegistryLayer),
  Layer.provide(makeSourceControlProviderRegistryLayer()),
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);

const git = (cwd: string, ...args: string[]) => {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@test.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@test.com",
    },
  });
};

const gitOutput = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@test.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@test.com",
    },
  })
    .toString("utf8")
    .trim();

function writeFile(cwd: string, relativePath: string, content: string) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function makeRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-"));

  git(cwd, "init", "-b", "main");
  writeFile(cwd, "src/file.txt", "one\ntwo\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");

  git(cwd, "checkout", "-b", "feature/test");
  writeFile(cwd, "src/file.txt", "one\ntwo\nthree\n");
  writeFile(cwd, "src/staged.txt", "staged\n");
  git(cwd, "add", "src/staged.txt");

  return cwd;
}

function makeCommittedRepo(files: Record<string, string>) {
  const cwd = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-"));

  git(cwd, "init", "-b", "main");
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(cwd, relativePath, content);
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");

  return cwd;
}

function makeChangedLineFile(prefix: string, lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `${prefix}-${index}\n`).join("");
}

function makeStackedRepo() {
  const cwd = makeCommittedRepo({
    "src/base.txt": "base\n",
  });

  git(cwd, "checkout", "-b", "feature/parent");
  writeFile(cwd, "src/parent-only.txt", "parent\n");
  writeFile(cwd, "src/shared.txt", "shared from parent\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "parent stack item");

  git(cwd, "checkout", "-b", "feature/child");
  writeFile(cwd, "src/child-only.txt", "child\n");
  writeFile(cwd, "src/shared.txt", "shared from child\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "child stack item");

  git(cwd, "checkout", "feature/parent");
  writeFile(cwd, "src/parent-followup.txt", "parent followup\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "parent followup");

  git(cwd, "checkout", "feature/child");

  return cwd;
}

function makeUiStackedRepo() {
  const cwd = makeCommittedRepo({
    "src/api/comments.ts": "legacy api one\nlegacy api two\n",
    "src/components/review/CommentComposer.tsx": "legacy composer one\nlegacy composer two\n",
    "src/components/review/CommentThread.tsx": "legacy thread one\nlegacy thread two\n",
    "src/hooks/useReviewComments.ts": "legacy hook one\nlegacy hook two\n",
  });

  git(cwd, "checkout", "-b", "feature/typed-comment-api");
  writeFile(
    cwd,
    "src/api/comments.ts",
    [
      "typed api one",
      "typed api two",
      "typed api three",
      "typed api four",
      "typed api five",
      "",
    ].join("\n"),
  );
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "typed comment api");

  git(cwd, "checkout", "-b", "feature/optimistic-comment-posting");
  writeFile(
    cwd,
    "src/components/review/CommentThread.tsx",
    ["optimistic thread one", "optimistic thread two", "optimistic thread three", ""].join("\n"),
  );
  writeFile(
    cwd,
    "src/hooks/useReviewComments.ts",
    [
      "optimistic hook one",
      "optimistic hook two",
      "optimistic hook three",
      "optimistic hook four",
      "",
    ].join("\n"),
  );
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "optimistic comment posting");

  git(cwd, "checkout", "-b", "feature/comment-composer-ui");
  writeFile(
    cwd,
    "src/components/review/CommentComposer.tsx",
    [
      "composer ui one",
      "composer ui two",
      "composer ui three",
      "composer ui four",
      "composer ui five",
      "",
    ].join("\n"),
  );
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "comment composer ui");

  git(cwd, "checkout", "main");
  git(cwd, "checkout", "-b", "feature/unrelated-sidebar");
  writeFile(cwd, "src/sidebar.tsx", "unrelated sidebar\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "unrelated sidebar");
  git(cwd, "checkout", "feature/comment-composer-ui");

  return cwd;
}

function byPath<T extends { readonly path: string }>(files: ReadonlyArray<T>) {
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

describe("GitDiffCoreLive", () => {
  it.layer(TestLayer)("discovers git repositories inside an orchestration workspace", (it) => {
    it.effect("includes ignored nested repositories and skips heavy dependency directories", () =>
      Effect.gen(function* () {
        const workspace = makeCommittedRepo({
          ".gitignore": "services/\nnode_modules/\n",
          "README.md": "workspace\n",
        });
        const serviceRepo = path.join(workspace, "services/api");
        const nestedServiceRepo = path.join(serviceRepo, "packages/worker");
        const dependencyRepo = path.join(workspace, "node_modules/package");
        mkdirSync(serviceRepo, { recursive: true });
        mkdirSync(nestedServiceRepo, { recursive: true });
        mkdirSync(dependencyRepo, { recursive: true });
        git(serviceRepo, "init", "-b", "main");
        writeFile(serviceRepo, "api.txt", "api\n");
        git(serviceRepo, "add", ".");
        git(serviceRepo, "commit", "-m", "service initial");
        git(nestedServiceRepo, "init", "-b", "main");
        writeFile(nestedServiceRepo, "worker.txt", "worker\n");
        git(nestedServiceRepo, "add", ".");
        git(nestedServiceRepo, "commit", "-m", "worker initial");
        git(dependencyRepo, "init", "-b", "main");

        try {
          const gitDiff = yield* GitDiffCore;
          const repositories = yield* gitDiff.listRepositories({ workspaceCwd: workspace });

          expect(repositories.map((repository) => repository.relativePath)).toEqual([
            "",
            "services/api",
            "services/api/packages/worker",
          ]);
          expect(repositories[0]).toEqual(
            expect.objectContaining({
              cwd: workspace,
              isWorkspaceRoot: true,
            }),
          );
          expect(repositories[1]).toEqual(
            expect.objectContaining({
              cwd: serviceRepo,
              name: "api",
              isWorkspaceRoot: false,
            }),
          );
          expect(repositories[2]).toEqual(
            expect.objectContaining({
              cwd: nestedServiceRepo,
              name: "worker",
              isWorkspaceRoot: false,
            }),
          );
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      }),
    );
  });

  it.layer(ReviewDiffDetectionTimeoutTestLayer)(
    "loads review diff file summaries when VCS detection times out",
    (it) => {
      it.effect("falls back to the git review-diff driver", () =>
        Effect.gen(function* () {
          const cwd = makeCommittedRepo({
            "src/file.txt": "one\n",
          });

          try {
            writeFile(cwd, "src/file.txt", "one\ntwo\n");

            const gitDiff = yield* GitDiffCore;
            const files = yield* gitDiff.loadDiffFileIndex({
              cwd,
              target: { kind: "worktree" },
              detectRenames: true,
              detectCopies: true,
            });

            expect(files).toEqual([
              expect.objectContaining({
                path: "src/file.txt",
                insertions: 1,
                deletions: 0,
                binary: false,
              }),
            ]);
          } finally {
            rmSync(cwd, { recursive: true, force: true });
          }
        }),
      );
    },
  );

  it.layer(TestLayer)("loads unstaged file summaries from a real git repo", (it) => {
    it.effect("returns changed files without patch text", () =>
      Effect.gen(function* () {
        const cwd = makeRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("includes untracked worktree files in the worktree index", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/tracked.txt": "one\n",
        });

        try {
          mkdirSync(path.join(cwd, "src"), { recursive: true });
          writeFile(cwd, "src/new.txt", "alpha\nbeta\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/new.txt",
              previousPath: null,
              insertions: 2,
              deletions: 0,
              binary: false,
              isUntracked: true,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("changes the worktree signature after modifying a tracked file", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/tracked.txt": "one\n",
        });

        try {
          const gitDiff = yield* GitDiffCore;
          const before = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "worktree" },
          });

          writeFile(cwd, "src/tracked.txt", "one\ntwo\n");

          const after = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "worktree" },
          });

          expect(after.signature).not.toEqual(before.signature);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("changes the worktree signature after creating an untracked file", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/tracked.txt": "one\n",
        });

        try {
          const gitDiff = yield* GitDiffCore;
          const before = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "worktree" },
          });

          writeFile(cwd, "src/new.txt", "new\n");

          const after = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "worktree" },
          });

          expect(after.signature).not.toEqual(before.signature);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("changes the staged signature after staging a file", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/tracked.txt": "one\n",
        });

        try {
          const gitDiff = yield* GitDiffCore;
          const before = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "staged" },
          });

          writeFile(cwd, "src/staged.txt", "staged\n");
          git(cwd, "add", "src/staged.txt");

          const after = yield* gitDiff.loadChangeSignature({
            cwd,
            target: { kind: "staged" },
          });

          expect(after.signature).not.toEqual(before.signature);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("keeps range and commit signatures stable when the worktree changes", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/base.txt": "base\n",
        });

        try {
          git(cwd, "checkout", "-b", "feature/signature");
          writeFile(cwd, "src/feature.txt", "feature\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "feature change");
          const commitRef = gitOutput(cwd, "rev-parse", "HEAD");
          const parentRef = gitOutput(cwd, "rev-parse", "HEAD^");

          const gitDiff = yield* GitDiffCore;
          const rangeBefore = yield* gitDiff.loadChangeSignature({
            cwd,
            target: {
              kind: "range",
              baseRef: "main",
              headRef: "feature/signature",
            },
          });
          const commitBefore = yield* gitDiff.loadChangeSignature({
            cwd,
            target: {
              kind: "commit",
              commitRef,
              parentRef,
            },
          });

          writeFile(cwd, "src/base.txt", "base\nworktree\n");
          writeFile(cwd, "src/untracked.txt", "untracked\n");

          const rangeAfter = yield* gitDiff.loadChangeSignature({
            cwd,
            target: {
              kind: "range",
              baseRef: "main",
              headRef: "feature/signature",
            },
          });
          const commitAfter = yield* gitDiff.loadChangeSignature({
            cwd,
            target: {
              kind: "commit",
              commitRef,
              parentRef,
            },
          });

          expect(rangeAfter.signature).toEqual(rangeBefore.signature);
          expect(commitAfter.signature).toEqual(commitBefore.signature);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("excludes untracked files from staged and range indexes", () =>
      Effect.gen(function* () {
        const stagedCwd = makeCommittedRepo({
          "src/tracked.txt": "one\n",
        });
        const rangeCwd = makeCommittedRepo({
          "src/base.txt": "base\n",
        });

        try {
          writeFile(stagedCwd, "src/staged.txt", "staged\n");
          writeFile(stagedCwd, "src/untracked.txt", "untracked\n");
          git(stagedCwd, "add", "src/staged.txt");

          git(rangeCwd, "checkout", "-b", "feature/range");
          writeFile(rangeCwd, "src/ranged.txt", "ranged\n");
          git(rangeCwd, "add", ".");
          git(rangeCwd, "commit", "-m", "range change");
          writeFile(rangeCwd, "src/untracked.txt", "untracked\n");

          const gitDiff = yield* GitDiffCore;
          const stagedFiles = yield* gitDiff.loadDiffFileIndex({
            cwd: stagedCwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });
          const rangeFiles = yield* gitDiff.loadDiffFileIndex({
            cwd: rangeCwd,
            target: {
              kind: "range",
              baseRef: "main",
              headRef: "feature/range",
            },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(stagedFiles)).toEqual([
            expect.objectContaining({
              path: "src/staged.txt",
              isUntracked: false,
            }),
          ]);
          expect(byPath(rangeFiles)).toEqual([
            expect.objectContaining({
              path: "src/ranged.txt",
              isUntracked: false,
            }),
          ]);
        } finally {
          rmSync(stagedCwd, { recursive: true, force: true });
          rmSync(rangeCwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("counts multiline replacements as insertions and deletions", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\nthree\nfour\n",
        });

        try {
          writeFile(cwd, "src/file.txt", "one\nTWO\nTHREE\nfour\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 2,
              deletions: 2,
              binary: false,
            }),
          ]);
        } finally {
          resetProviderTestFixtures();
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("includes ordered hunk summaries for separated edits", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\nthree\nfour\nfive\nsix\n",
        });

        try {
          writeFile(cwd, "src/file.txt", "one\nTWO\nthree\nfour\nFIVE\nsix\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              hunkCount: 2,
              hunks: [
                expect.objectContaining({
                  index: 0,
                  oldStart: 2,
                  oldLines: 1,
                  newStart: 2,
                  newLines: 1,
                }),
                expect.objectContaining({
                  index: 1,
                  oldStart: 5,
                  oldLines: 1,
                  newStart: 5,
                  newLines: 1,
                }),
              ],
            }),
          ]);
          expect(files[0]?.hunks[0]?.header).toEqual(expect.stringMatching(/\S/u));
          expect(files[0]?.hunks[1]?.header).toEqual(expect.stringMatching(/\S/u));
          expect(files[0]?.hunks[0]?.header).toEqual(files[0]?.hunks[0]?.header.trim());
          expect(files[0]?.hunks[1]?.header).toEqual(files[0]?.hunks[1]?.header.trim());
          expect(() => decodeLoadDiffFileIndexResult(files)).not.toThrow();
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("returns empty hunk metadata for binary files", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "README.md": "repo\n",
        });

        try {
          writeFileSync(path.join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3]));
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "binary file");
          writeFileSync(path.join(cwd, "image.bin"), Buffer.from([0, 1, 2, 4]));

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "image.bin",
              binary: true,
              hunkCount: 0,
              hunks: [],
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("counts line removals as deletions only", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\nthree\n",
        });

        try {
          writeFile(cwd, "src/file.txt", "one\nthree\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/file.txt",
              previousPath: null,
              insertions: 0,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("returns summaries for multiple changed files", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/alpha.txt": "alpha\n",
          "src/beta.txt": "one\ntwo\n",
        });

        try {
          writeFile(cwd, "src/alpha.txt", "alpha\nnext\n");
          writeFile(cwd, "src/beta.txt", "one\n");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/alpha.txt",
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/beta.txt",
              insertions: 0,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports a staged rename with previousPath", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/old-name.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/old-name.txt", "src/new-name.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/new-name.txt",
              previousPath: "src/old-name.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports a staged rename with content changes", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/old-name.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/old-name.txt", "src/new-name.txt");
          writeFile(cwd, "src/new-name.txt", "one\ntwo\nthree\n");
          git(cwd, "add", "src/new-name.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({
              path: "src/new-name.txt",
              previousPath: "src/old-name.txt",
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reports multiple renames alongside ordinary changed files", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/alpha-old.txt": "alpha\n",
          "src/beta-old.txt": "beta\n",
          "src/changed.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/alpha-old.txt", "src/alpha-new.txt");
          git(cwd, "mv", "src/beta-old.txt", "src/beta-new.txt");
          writeFile(cwd, "src/changed.txt", "one\ntwo\nthree\n");
          git(cwd, "add", "src/changed.txt");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "staged" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/alpha-new.txt",
              previousPath: "src/alpha-old.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/beta-new.txt",
              previousPath: "src/beta-old.txt",
              insertions: 0,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/changed.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads a stacked branch file index against its parent branch", () =>
      Effect.gen(function* () {
        const cwd = makeStackedRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: {
              kind: "range",
              baseRef: "feature/parent",
              headRef: "feature/child",
            },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/child-only.txt",
              previousPath: null,
              insertions: 1,
              deletions: 0,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/shared.txt",
              previousPath: null,
              insertions: 1,
              deletions: 1,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads selected range file contents and patch text", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/file.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "checkout", "-b", "feature/file-diff");
          writeFile(cwd, "src/file.txt", "one\ntwo\nthree\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "update file");

          const gitDiff = yield* GitDiffCore;
          const file = yield* gitDiff.loadDiffFile({
            cwd,
            target: {
              kind: "range",
              baseRef: "main",
              headRef: "feature/file-diff",
            },
            path: "src/file.txt",
            previousPath: null,
            detectRenames: true,
            detectCopies: true,
          });

          expect(file.oldFile).toEqual({
            path: "src/file.txt",
            contents: "one\ntwo\n",
          });
          expect(file.newFile).toEqual({
            path: "src/file.txt",
            contents: "one\ntwo\nthree\n",
          });
          expect(file.patch).toContain("diff --git a/src/file.txt b/src/file.txt");
          expect(file.patch).toContain("@@");
          expect(file.patch).toContain("+three");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("marks selected file patch output as truncated when it exceeds max bytes", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/large-diff.txt": makeChangedLineFile("old", 120_000),
        });

        try {
          git(cwd, "checkout", "-b", "feature/large-patch");
          writeFile(cwd, "src/large-diff.txt", makeChangedLineFile("new", 120_000));
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "large patch");

          const gitDiff = yield* GitDiffCore;
          const file = yield* gitDiff.loadDiffFile({
            cwd,
            target: {
              kind: "range",
              baseRef: "main",
              headRef: "feature/large-patch",
            },
            path: "src/large-diff.txt",
            previousPath: null,
            detectRenames: true,
            detectCopies: true,
          });

          expect(Buffer.byteLength(file.oldFile?.contents ?? "")).toBeLessThan(
            TEST_DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
          );
          expect(Buffer.byteLength(file.newFile?.contents ?? "")).toBeLessThan(
            TEST_DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
          );
          expect(file.patch).toBe("");
          expect(file.patchTruncated).toBe(true);
          expect(file.oldFileTooLarge).toBe(false);
          expect(file.newFileTooLarge).toBe(false);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect(
      "marks working tree file contents as too large when the new side exceeds max bytes",
      () =>
        Effect.gen(function* () {
          const cwd = makeCommittedRepo({
            "src/large-worktree.txt": "small\n",
          });

          try {
            writeFile(
              cwd,
              "src/large-worktree.txt",
              `${"x".repeat(TEST_DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES + 1)}\n`,
            );

            const gitDiff = yield* GitDiffCore;
            const file = yield* gitDiff.loadDiffFile({
              cwd,
              target: { kind: "worktree" },
              path: "src/large-worktree.txt",
              previousPath: null,
              detectRenames: true,
              detectCopies: true,
            });

            expect(file.oldFile).toEqual({
              path: "src/large-worktree.txt",
              contents: "small\n",
            });
            expect(file.newFile).toBeNull();
            expect(file.oldFileTooLarge).toBe(false);
            expect(file.newFileTooLarge).toBe(true);
          } finally {
            rmSync(cwd, { recursive: true, force: true });
          }
        }),
    );

    it.effect("marks large untracked file summaries as too large and stats truncated", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/tracked.txt": "tracked\n",
        });

        try {
          writeFile(
            cwd,
            "src/large-untracked.txt",
            "line\n".repeat(Math.ceil((TEST_UNTRACKED_FILE_LINE_COUNT_MAX_BYTES + 1) / 5)),
          );

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "worktree" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(byPath(files)).toEqual([
            expect.objectContaining({
              path: "src/large-untracked.txt",
              previousPath: null,
              deletions: 0,
              binary: false,
              isUntracked: true,
              isTooLarge: true,
              statsTruncated: true,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads selected staged rename file contents and patch metadata", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/old-name.txt": "one\ntwo\n",
        });

        try {
          git(cwd, "mv", "src/old-name.txt", "src/new-name.txt");
          writeFile(cwd, "src/new-name.txt", "one\ntwo\nthree\n");
          git(cwd, "add", "src/new-name.txt");

          const gitDiff = yield* GitDiffCore;
          const file = yield* gitDiff.loadDiffFile({
            cwd,
            target: { kind: "staged" },
            path: "src/new-name.txt",
            previousPath: "src/old-name.txt",
            detectRenames: true,
            detectCopies: true,
          });

          expect(file.oldFile).toEqual({
            path: "src/old-name.txt",
            contents: "one\ntwo\n",
          });
          expect(file.newFile).toEqual({
            path: "src/new-name.txt",
            contents: "one\ntwo\nthree\n",
          });
          expect(file.patch).toContain("rename from src/old-name.txt");
          expect(file.patch).toContain("rename to src/new-name.txt");
          expect(file.patch).toContain("+three");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads recent history and diffs a selected commit", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "base\nchanged\n");
          writeFile(cwd, "src/added.txt", "added\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "second commit");

          const gitDiff = yield* GitDiffCore;
          const history = yield* gitDiff.loadHistory({ cwd, limit: 2 });

          expect(history).toHaveLength(2);
          expect(history[0]).toEqual(
            expect.objectContaining({
              shortSha: expect.any(String),
              subject: "second commit",
              authorName: "Fenrir",
              authorEmail: "fenrir@test.com",
            }),
          );
          expect(history[0]?.parentSha).toBe(history[1]?.sha);

          const target = {
            kind: "commit" as const,
            commitRef: history[0]!.sha,
            parentRef: history[0]!.parentSha,
          };
          const files = byPath(
            yield* gitDiff.loadDiffFileIndex({
              cwd,
              target,
              detectRenames: true,
              detectCopies: true,
            }),
          );
          expect(files.map((file) => file.path)).toEqual(["src/added.txt", "src/file.txt"]);

          const file = yield* gitDiff.loadDiffFile({
            cwd,
            target,
            path: "src/file.txt",
            previousPath: null,
            detectRenames: true,
            detectCopies: true,
          });
          expect(file.oldFile?.contents).toBe("base\n");
          expect(file.newFile?.contents).toBe("base\nchanged\n");
          expect(file.patch).toContain("+changed");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reverts a selected commit", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "base\nchanged\n");
          writeFile(cwd, "src/added.txt", "added\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "second commit");

          const gitDiff = yield* GitDiffCore;
          const history = yield* gitDiff.loadHistory({ cwd, limit: 1 });
          const result = yield* gitDiff.revertCommit({
            cwd,
            commitRef: history[0]!.sha,
          });

          expect(result.commitSha).toBe(gitOutput(cwd, "rev-parse", "HEAD"));
          expect(gitOutput(cwd, "log", "-1", "--pretty=%s")).toBe('Revert "second commit"');
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("base\n");
          expect(existsSync(path.join(cwd, "src/added.txt"))).toBe(false);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("cherry-picks a selected commit onto the current branch", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.txt": "base\n" });

        try {
          git(cwd, "checkout", "-b", "feature/source");
          writeFile(cwd, "src/cherry.txt", "picked\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "pick me");
          const sourceCommitSha = gitOutput(cwd, "rev-parse", "HEAD");

          git(cwd, "checkout", "main");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.cherryPickCommit({
            cwd,
            commitRef: sourceCommitSha,
          });

          expect(result.commitSha).toBe(gitOutput(cwd, "rev-parse", "HEAD"));
          expect(gitOutput(cwd, "log", "-1", "--pretty=%s")).toBe("pick me");
          expect(readFileSync(path.join(cwd, "src/cherry.txt"), "utf8")).toBe("picked\n");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads and continues an in-progress conflicted cherry-pick", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          git(cwd, "checkout", "-b", "feature/source");
          writeFile(cwd, "src/file.txt", "source\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "source change");
          const sourceCommitSha = gitOutput(cwd, "rev-parse", "HEAD");

          git(cwd, "checkout", "main");
          writeFile(cwd, "src/file.txt", "main\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "main change");

          const gitDiff = yield* GitDiffCore;
          const failedPick = yield* Effect.result(
            gitDiff.cherryPickCommit({
              cwd,
              commitRef: sourceCommitSha,
            }),
          );
          expect(failedPick._tag).toBe("Failure");

          expect(yield* gitDiff.loadOperation({ cwd })).toEqual({
            operation: {
              kind: "cherry_pick",
              label: "Cherry-pick in progress",
              headRef: sourceCommitSha,
              conflictedFilePaths: ["src/file.txt"],
            },
          });

          writeFile(cwd, "src/file.txt", "source\n");
          git(cwd, "add", "src/file.txt");
          const result = yield* gitDiff.continueOperation({ cwd });

          expect(result).toEqual({
            status: "ok",
            commitSha: gitOutput(cwd, "rev-parse", "HEAD"),
          });
          expect(gitOutput(cwd, "log", "-1", "--pretty=%s")).toBe("source change");
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("source\n");
          expect(yield* gitDiff.loadOperation({ cwd })).toEqual({ operation: null });
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("aborts an in-progress conflicted cherry-pick", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          git(cwd, "checkout", "-b", "feature/source");
          writeFile(cwd, "src/file.txt", "source\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "source change");
          const sourceCommitSha = gitOutput(cwd, "rev-parse", "HEAD");

          git(cwd, "checkout", "main");
          writeFile(cwd, "src/file.txt", "main\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "main change");
          const mainCommitSha = gitOutput(cwd, "rev-parse", "HEAD");

          const gitDiff = yield* GitDiffCore;
          const failedPick = yield* Effect.result(
            gitDiff.cherryPickCommit({
              cwd,
              commitRef: sourceCommitSha,
            }),
          );
          expect(failedPick._tag).toBe("Failure");

          expect((yield* gitDiff.loadOperation({ cwd })).operation?.kind).toBe("cherry_pick");
          expect(yield* gitDiff.abortOperation({ cwd })).toEqual({
            status: "ok",
            commitSha: null,
          });

          expect(gitOutput(cwd, "rev-parse", "HEAD")).toBe(mainCommitSha);
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("main\n");
          expect(yield* gitDiff.loadOperation({ cwd })).toEqual({ operation: null });
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads ordered stacked diff steps with files for each consecutive branch", () =>
      Effect.gen(function* () {
        const cwd = makeUiStackedRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const stack = yield* gitDiff.loadStackedDiffFileIndex({
            cwd,
            baseRef: "main",
            headRef: "feature/comment-composer-ui",
            detectRenames: true,
            detectCopies: true,
          });

          expect(stack.baseRef).toBe("main");
          expect(stack.headRef).toBe("feature/comment-composer-ui");
          expect(
            stack.steps.map((step) => ({
              index: step.index,
              branchName: step.branchName,
              baseRef: step.baseRef,
              headRef: step.headRef,
            })),
          ).toEqual([
            {
              index: 1,
              branchName: "feature/typed-comment-api",
              baseRef: "main",
              headRef: "feature/typed-comment-api",
            },
            {
              index: 2,
              branchName: "feature/optimistic-comment-posting",
              baseRef: "feature/typed-comment-api",
              headRef: "feature/optimistic-comment-posting",
            },
            {
              index: 3,
              branchName: "feature/comment-composer-ui",
              baseRef: "feature/optimistic-comment-posting",
              headRef: "feature/comment-composer-ui",
            },
          ]);

          expect(byPath(stack.steps[0]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/api/comments.ts",
              insertions: 5,
              deletions: 2,
              binary: false,
            }),
          ]);
          expect(byPath(stack.steps[1]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/components/review/CommentThread.tsx",
              insertions: 3,
              deletions: 2,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/hooks/useReviewComments.ts",
              insertions: 4,
              deletions: 2,
              binary: false,
            }),
          ]);
          expect(byPath(stack.steps[2]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/components/review/CommentComposer.tsx",
              insertions: 5,
              deletions: 2,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("returns no active change request stack when the current branch has no open PR", () =>
      Effect.gen(function* () {
        const cwd = makeRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const stack = yield* gitDiff.loadActiveChangeRequestStackedDiffFileIndex({
            cwd,
            detectRenames: true,
            detectCopies: true,
          });

          expect(stack).toEqual({
            activeChangeRequest: null,
            baseRef: null,
            headRef: "feature/test",
            steps: [],
          });
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads an active pull request stack by following PR base branches back to main", () =>
      Effect.gen(function* () {
        const cwd = makeUiStackedRepo();

        try {
          const gitDiff = yield* GitDiffCore;
          const stack = yield* gitDiff.loadActiveChangeRequestStackedDiffFileIndex({
            cwd,
            detectRenames: true,
            detectCopies: true,
          });

          expect(stack.activeChangeRequest).toEqual(
            expect.objectContaining({
              number: 3,
              baseRefName: "feature/optimistic-comment-posting",
              headRefName: "feature/comment-composer-ui",
            }),
          );
          expect(stack.baseRef).toBe("main");
          expect(stack.headRef).toBe("feature/comment-composer-ui");
          expect(
            stack.steps.map((step) => ({
              index: step.index,
              branchName: step.branchName,
              baseRef: step.baseRef,
              headRef: step.headRef,
              prNumber: step.changeRequest?.number,
            })),
          ).toEqual([
            {
              index: 1,
              branchName: "feature/typed-comment-api",
              baseRef: "main",
              headRef: "feature/typed-comment-api",
              prNumber: 1,
            },
            {
              index: 2,
              branchName: "feature/optimistic-comment-posting",
              baseRef: "feature/typed-comment-api",
              headRef: "feature/optimistic-comment-posting",
              prNumber: 2,
            },
            {
              index: 3,
              branchName: "feature/comment-composer-ui",
              baseRef: "feature/optimistic-comment-posting",
              headRef: "feature/comment-composer-ui",
              prNumber: 3,
            },
          ]);

          expect(byPath(stack.steps[0]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/api/comments.ts",
              insertions: 5,
              deletions: 2,
              binary: false,
            }),
          ]);
          expect(byPath(stack.steps[1]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/components/review/CommentThread.tsx",
              insertions: 3,
              deletions: 2,
              binary: false,
            }),
            expect.objectContaining({
              path: "src/hooks/useReviewComments.ts",
              insertions: 4,
              deletions: 2,
              binary: false,
            }),
          ]);
          expect(byPath(stack.steps[2]?.files ?? [])).toEqual([
            expect.objectContaining({
              path: "src/components/review/CommentComposer.tsx",
              insertions: 5,
              deletions: 2,
              binary: false,
            }),
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("persists git diff ignore lists in local git metadata", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });

        try {
          const gitDiff = yield* GitDiffCore;
          expect(yield* gitDiff.loadIgnoreLists({ cwd })).toEqual([]);

          const created = yield* gitDiff.createIgnoreList({ cwd, name: "Local scratch" });
          expect(created).toHaveLength(1);
          const list = created[0]!;
          expect(list.name).toBe("Local scratch");
          expect(existsSync(path.join(cwd, ".gitignore"))).toBe(false);

          const updated = yield* gitDiff.updateIgnoreList({
            cwd,
            id: list.id,
            filePaths: ["src/scratch.ts", "src/scratch.ts"],
          });
          expect(updated[0]?.filePaths).toEqual(["src/scratch.ts"]);

          const ignoreListPath = gitOutput(
            cwd,
            "rev-parse",
            "--git-path",
            "info/fenrir-diff-ignore-lists.json",
          );
          expect(readFileSync(path.resolve(cwd, ignoreListPath), "utf8")).toContain(
            "src/scratch.ts",
          );

          expect(yield* gitDiff.deleteIgnoreList({ cwd, id: list.id })).toEqual([]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("creates review notes in local git metadata", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });

        try {
          const gitDiff = yield* GitDiffCore;
          const note = yield* gitDiff.createReviewNote({
            cwd,
            target: { kind: "worktree" },
            path: "src/base.ts",
            previousPath: null,
            side: "additions",
            line: 1,
            body: "Check this local change.",
            source: "user",
            author: "Fenrir",
          });

          expect(note).toEqual(
            expect.objectContaining({
              targetKey: "worktree",
              path: "src/base.ts",
              previousPath: null,
              side: "additions",
              line: 1,
              body: "Check this local change.",
              source: "user",
              author: "Fenrir",
            }),
          );

          const notesPath = gitOutput(
            cwd,
            "rev-parse",
            "--git-path",
            "info/fenrir-diff-review-notes.json",
          );
          const stored = JSON.parse(readFileSync(path.resolve(cwd, notesPath), "utf8"));
          expect(stored).toEqual([expect.objectContaining({ id: note.id, targetKey: "worktree" })]);
          expect(existsSync(path.join(cwd, "fenrir-diff-review-notes.json"))).toBe(false);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads review notes filtered by target key", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });

        try {
          const gitDiff = yield* GitDiffCore;
          const worktreeNote = yield* gitDiff.createReviewNote({
            cwd,
            target: { kind: "worktree" },
            path: "src/base.ts",
            previousPath: null,
            side: "additions",
            line: 1,
            body: "Worktree note.",
            source: "agent",
          });
          const stagedNote = yield* gitDiff.createReviewNote({
            cwd,
            target: { kind: "staged" },
            path: "src/base.ts",
            previousPath: null,
            side: "additions",
            line: 1,
            body: "Staged note.",
            source: "ai",
          });

          expect(yield* gitDiff.loadReviewNotes({ cwd, target: { kind: "worktree" } })).toEqual([
            worktreeNote,
          ]);
          expect(yield* gitDiff.loadReviewNotes({ cwd, target: { kind: "staged" } })).toEqual([
            stagedNote,
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("deletes only the selected review note", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });

        try {
          const gitDiff = yield* GitDiffCore;
          const first = yield* gitDiff.createReviewNote({
            cwd,
            target: { kind: "worktree" },
            path: "src/base.ts",
            previousPath: null,
            side: "additions",
            line: 1,
            body: "Delete me.",
            source: "user",
          });
          const second = yield* gitDiff.createReviewNote({
            cwd,
            target: { kind: "worktree" },
            path: "src/base.ts",
            previousPath: null,
            side: "additions",
            line: 2,
            body: "Keep me.",
            source: "user",
          });

          expect(yield* gitDiff.deleteReviewNote({ cwd, id: first.id })).toEqual({ status: "ok" });
          expect(yield* gitDiff.loadReviewNotes({ cwd, target: { kind: "worktree" } })).toEqual([
            second,
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("returns null before a review session is published", () =>
      Effect.gen(function* () {
        const gitDiff = yield* GitDiffCore;

        expect(yield* gitDiff.loadReviewSession({ cwd: "/workspace/repo" })).toEqual({
          session: null,
        });
      }),
    );

    it.effect("stores a review session snapshot", () =>
      Effect.gen(function* () {
        const gitDiff = yield* GitDiffCore;
        const snapshot = {
          cwd: "/workspace/repo",
          target: { kind: "worktree" as const },
          targetKey: "working tree",
          title: "Changes",
          selectedPath: "src/base.ts",
          selectedHunkIndex: 0,
          selectedLines: {
            path: "src/base.ts",
            previousPath: null,
            hunkIndex: 0,
            side: "additions" as const,
            line: 3,
            startLine: 2,
          },
          files: [
            {
              path: "src/base.ts",
              previousPath: null,
              insertions: 2,
              deletions: 1,
              binary: false,
              isUntracked: false,
              hunkCount: 1,
              hunks: [
                {
                  index: 0,
                  header: "@@ -1,1 +1,2 @@",
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 2,
                },
              ],
            },
          ],
          updatedAt: "2026-06-21T10:00:00.000Z",
        };

        expect(yield* gitDiff.updateReviewSession(snapshot)).toEqual({ status: "ok" });
        expect(yield* gitDiff.loadReviewSession({ cwd: "/workspace/repo" })).toEqual({
          session: snapshot,
        });
      }),
    );

    it.effect("filters review session loads by cwd", () =>
      Effect.gen(function* () {
        const gitDiff = yield* GitDiffCore;
        const snapshot = {
          cwd: "/workspace/repo",
          target: { kind: "staged" as const },
          targetKey: "staged changes",
          title: "Changes",
          selectedPath: null,
          selectedHunkIndex: null,
          selectedLines: null,
          files: [],
          updatedAt: "2026-06-21T10:00:00.000Z",
        };

        expect(yield* gitDiff.updateReviewSession(snapshot)).toEqual({ status: "ok" });
        expect(yield* gitDiff.loadReviewSession({ cwd: "/workspace/other" })).toEqual({
          session: null,
        });
      }),
    );

    it.effect("stages worktree changes while leaving ignore-list paths unstaged", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });

        try {
          writeFile(cwd, "src/include.ts", "include\n");
          writeFile(cwd, "src/ignored.ts", "ignored\n");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.stageWorktreeChanges({
            cwd,
            filePaths: ["src/include.ts", "src/ignored.ts"],
            ignoredFilePaths: ["src/ignored.ts"],
          });

          expect(result).toEqual({
            stagedFilePaths: ["src/include.ts"],
            ignoredFilePaths: ["src/ignored.ts"],
          });
          expect(gitOutput(cwd, "diff", "--cached", "--name-only")).toBe("src/include.ts");
          expect(gitOutput(cwd, "status", "--porcelain", "--", "src/ignored.ts")).toBe(
            "?? src/ignored.ts",
          );
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("unstages selected staged changes while leaving edits in the worktree", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "changed\n");
          git(cwd, "add", "src/file.txt");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.unstageStagedChanges({
            cwd,
            filePaths: ["src/file.txt"],
          });

          expect(result).toEqual({
            unstagedFilePaths: ["src/file.txt"],
          });
          expect(gitOutput(cwd, "diff", "--cached", "--name-only")).toBe("");
          expect(gitOutput(cwd, "diff", "--name-only")).toBe("src/file.txt");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("discards selected worktree changes without unstaging indexed content", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "staged\n");
          git(cwd, "add", "src/file.txt");
          writeFile(cwd, "src/file.txt", "worktree\n");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.discardWorktreeChanges({
            cwd,
            filePaths: ["src/file.txt"],
          });

          expect(result).toEqual({
            discardedFilePaths: ["src/file.txt"],
          });
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("staged\n");
          expect(gitOutput(cwd, "diff", "--name-only")).toBe("");
          expect(gitOutput(cwd, "diff", "--cached", "--name-only")).toBe("src/file.txt");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("amends only the requested staged paths", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/include.txt": "include base\n",
          "src/keep.txt": "keep base\n",
        });

        try {
          writeFile(cwd, "src/include.txt", "include amended\n");
          writeFile(cwd, "src/keep.txt", "keep staged\n");
          git(cwd, "add", "src/include.txt", "src/keep.txt");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.amendStagedChanges({
            cwd,
            filePaths: ["src/include.txt"],
            commitMessage: "amended include",
          });

          expect(result.commitSha).toBe(gitOutput(cwd, "rev-parse", "HEAD"));
          expect(gitOutput(cwd, "rev-list", "--count", "HEAD")).toBe("1");
          expect(gitOutput(cwd, "log", "-1", "--pretty=%B")).toBe("amended include");
          expect(gitOutput(cwd, "show", "HEAD:src/include.txt")).toBe("include amended");
          expect(gitOutput(cwd, "show", "HEAD:src/keep.txt")).toBe("keep base");
          expect(gitOutput(cwd, "diff", "--cached", "--name-only")).toBe("");
          expect(gitOutput(cwd, "diff", "--name-only")).toBe("src/keep.txt");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("rejects amend when selected paths have no staged changes", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          const gitDiff = yield* GitDiffCore;
          const result = yield* Effect.result(
            gitDiff.amendStagedChanges({
              cwd,
              filePaths: ["src/file.txt"],
            }),
          );

          expect(result._tag).toBe("Failure");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("creates a selected-path stash while leaving other worktree changes alone", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({
          "src/include.txt": "include base\n",
          "src/keep.txt": "keep base\n",
        });

        try {
          writeFile(cwd, "src/include.txt", "include changed\n");
          writeFile(cwd, "src/keep.txt", "keep changed\n");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.createStash({
            cwd,
            message: "Selected file",
            filePaths: ["src/include.txt"],
          });

          expect(result.status).toBe("stashed");
          expect(result.stash).toEqual(
            expect.objectContaining({
              ref: "stash@{0}",
              message: "Selected file",
              branchName: "main",
            }),
          );
          expect(readFileSync(path.join(cwd, "src/include.txt"), "utf8")).toBe("include base\n");
          expect(readFileSync(path.join(cwd, "src/keep.txt"), "utf8")).toBe("keep changed\n");
          expect(gitOutput(cwd, "diff", "--name-only")).toBe("src/keep.txt");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("loads stash file index and selected file contents", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "one\n" });

        try {
          writeFile(cwd, "src/file.txt", "one\ntwo\n");
          git(cwd, "stash", "push", "-m", "preview me");

          const gitDiff = yield* GitDiffCore;
          const files = yield* gitDiff.loadDiffFileIndex({
            cwd,
            target: { kind: "stash", ref: "stash@{0}" },
            detectRenames: true,
            detectCopies: true,
          });

          expect(files).toEqual([
            expect.objectContaining({ path: "src/file.txt", insertions: 1, deletions: 0 }),
          ]);

          const file = yield* gitDiff.loadDiffFile({
            cwd,
            target: { kind: "stash", ref: "stash@{0}" },
            path: "src/file.txt",
            previousPath: null,
            detectRenames: true,
            detectCopies: true,
          });

          expect(file.oldFile?.contents).toBe("one\n");
          expect(file.newFile?.contents).toBe("one\ntwo\n");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("applies and drops stashes independently", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "saved\n");

          const gitDiff = yield* GitDiffCore;
          const created = yield* gitDiff.createStash({
            cwd,
            message: "Saved work",
          });
          expect(created.stash?.ref).toBe("stash@{0}");
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("base\n");

          expect(yield* gitDiff.applyStash({ cwd, ref: "stash@{0}" })).toEqual({
            status: "ok",
          });
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("saved\n");
          expect((yield* gitDiff.loadStashes({ cwd })).map((stash) => stash.ref)).toEqual([
            "stash@{0}",
          ]);

          expect(yield* gitDiff.dropStash({ cwd, ref: "stash@{0}" })).toEqual({
            status: "ok",
          });
          expect(yield* gitDiff.loadStashes({ cwd })).toEqual([]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("pops stashes by applying and removing them", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/file.txt": "base\n" });

        try {
          writeFile(cwd, "src/file.txt", "popped\n");

          const gitDiff = yield* GitDiffCore;
          const created = yield* gitDiff.createStash({
            cwd,
            message: "Pop work",
          });
          expect(created.status).toBe("stashed");
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("base\n");

          expect(yield* gitDiff.popStash({ cwd, ref: "stash@{0}" })).toEqual({
            status: "ok",
          });
          expect(readFileSync(path.join(cwd, "src/file.txt"), "utf8")).toBe("popped\n");
          expect(yield* gitDiff.loadStashes({ cwd })).toEqual([]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("delegates pull request actions, checks, and review threads to the provider", () =>
      Effect.gen(function* () {
        const cwd = makeCommittedRepo({ "src/base.ts": "base\n" });
        const checks = [
          {
            name: "lint",
            status: "success" as const,
            startedAt: Option.none(),
            completedAt: Option.none(),
          },
        ];
        const reviewThreads: ChangeRequestReviewThread[] = [
          {
            id: "thread-1",
            path: "src/base.ts",
            side: "additions",
            line: 2,
            isResolved: false,
            comments: [
              {
                id: "comment-1",
                body: "Nice",
                author: { login: "reviewer" },
              },
            ],
          },
        ];

        try {
          resetProviderTestFixtures();
          PROVIDER_TEST_CHECKS.push(...checks);
          PROVIDER_TEST_REVIEW_THREADS.push(...reviewThreads);

          const gitDiff = yield* GitDiffCore;
          expect(yield* gitDiff.closeChangeRequest({ cwd, reference: "3" })).toEqual({
            status: "ok",
          });
          expect(yield* gitDiff.mergeChangeRequest({ cwd, reference: "3" })).toEqual({
            status: "ok",
          });
          expect(yield* gitDiff.loadChangeRequestChecks({ cwd, reference: "3" })).toEqual(checks);
          expect(yield* gitDiff.loadChangeRequestReviewThreads({ cwd, reference: "3" })).toEqual(
            reviewThreads,
          );
          expect(
            yield* gitDiff.commentChangeRequestLines({
              cwd,
              reference: "3",
              path: "src/base.ts",
              body: "Please adjust this.",
              side: "additions",
              line: 2,
              startLine: 1,
            }),
          ).toEqual({ status: "ok" });

          expect(PROVIDER_TEST_CALLS.close).toEqual(["3"]);
          expect(PROVIDER_TEST_CALLS.merge).toEqual([{ reference: "3", method: "squash" }]);
          expect(PROVIDER_TEST_CALLS.comment).toEqual([
            {
              reference: "3",
              path: "src/base.ts",
              body: "Please adjust this.",
              side: "additions",
              line: 2,
              startLine: 1,
            },
          ]);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
    );

    it.effect("reverts selected PR additions locally, commits them, and pushes the branch", () =>
      Effect.gen(function* () {
        const origin = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-origin-"));
        const cwd = mkdtempSync(path.join(tmpdir(), "fenrir-git-diff-core-work-"));

        try {
          git(origin, "init", "--bare");
          git(cwd, "init", "-b", "main");
          writeFile(cwd, "src/review.ts", "one\ntwo\nthree\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "initial");
          git(cwd, "remote", "add", "origin", origin);
          git(cwd, "push", "-u", "origin", "main");
          git(cwd, "checkout", "-b", "feature/review");
          writeFile(cwd, "src/review.ts", "one\ntwo\nthree\nremove me\n");
          git(cwd, "add", ".");
          git(cwd, "commit", "-m", "review change");
          git(cwd, "push", "-u", "origin", "feature/review");

          const gitDiff = yield* GitDiffCore;
          const result = yield* gitDiff.revertChangeRequestLines({
            cwd,
            reference: "7",
            baseRef: "main",
            headRef: "feature/review",
            path: "src/review.ts",
            previousPath: null,
            selection: {
              side: "additions",
              start: 4,
              end: 4,
            },
          });

          expect(result.path).toBe("src/review.ts");
          expect(result.commitSha).toHaveLength(40);
          expect(result.push.status).toBe("pushed");
          expect(readFileSync(path.join(cwd, "src/review.ts"), "utf8")).toBe("one\ntwo\nthree\n");
          expect(gitOutput(cwd, "log", "-1", "--format=%s")).toBe(
            "Revert selected PR lines in src/review.ts",
          );
          expect(
            gitOutput(cwd, "rev-list", "--count", "origin/feature/review..feature/review"),
          ).toBe("0");
        } finally {
          rmSync(cwd, { recursive: true, force: true });
          rmSync(origin, { recursive: true, force: true });
        }
      }),
    );
  });
});
