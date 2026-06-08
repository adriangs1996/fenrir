import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../../config";
import { GitCoreLive } from "./GitCore";
import { GitDiffCoreLive } from "./GitDiffCore";
import { GitDiffCore } from "../Services/GitDiffCore";
import type { ChangeRequest, ChangeRequestCheck } from "@fenrir/contracts";
import { execFileSync } from "child_process";
import { Effect, Layer, Option } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { describe, it } from "@effect/vitest";
import { tmpdir } from "os";
import path from "path";
import { expect } from "vitest";
import type { SourceControlProviderShape } from "../../sourceControl/SourceControlProvider";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fenrir-git-diff-core-test",
});

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

function resetProviderTestFixtures() {
  PROVIDER_TEST_CALLS.close.length = 0;
  PROVIDER_TEST_CALLS.merge.length = 0;
  PROVIDER_TEST_CALLS.comment.length = 0;
  PROVIDER_TEST_CHECKS.length = 0;
}

const TestLayer = GitDiffCoreLive.pipe(
  Layer.provide(GitCoreLive),
  Layer.provide(
    makeSourceControlProviderRegistryLayer({
      changeRequests: UI_STACK_CHANGE_REQUESTS,
      calls: PROVIDER_TEST_CALLS,
      checks: PROVIDER_TEST_CHECKS,
    }),
  ),
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

    it.effect("delegates pull request actions and check loading to the provider", () =>
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

        try {
          resetProviderTestFixtures();
          PROVIDER_TEST_CHECKS.push(...checks);

          const gitDiff = yield* GitDiffCore;
          expect(yield* gitDiff.closeChangeRequest({ cwd, reference: "3" })).toEqual({
            status: "ok",
          });
          expect(
            yield* gitDiff.mergeChangeRequest({ cwd, reference: "3", method: "squash" }),
          ).toEqual({ status: "ok" });
          expect(yield* gitDiff.loadChangeRequestChecks({ cwd, reference: "3" })).toEqual(checks);
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
