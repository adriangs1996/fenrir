import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { GitCommandError } from "@fenrir/contracts";
import { ThreadId } from "@fenrir/contracts";
import {
  ReviewChunkId,
  ReviewMutationConflictError,
  ReviewSessionId,
} from "@fenrir/contracts/sourceControlReview";
import type { ReviewApplyRawMutationInput } from "@fenrir/contracts/sourceControlReview";
import type { ReviewIgnoreRuleRecord } from "../../../persistence/Services/ReviewIgnoreRules.ts";
import type { ReviewSessionRecord } from "../../../persistence/Services/ReviewSessions.ts";
import { makeReviewDiffService } from "../Services/ReviewDiffService.ts";
import { makeReviewMutationService } from "../Services/ReviewMutationService.ts";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@example.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@example.com",
    },
  });
}

function gitStdout(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fenrir",
      GIT_AUTHOR_EMAIL: "fenrir@example.com",
      GIT_COMMITTER_NAME: "Fenrir",
      GIT_COMMITTER_EMAIL: "fenrir@example.com",
    },
  }).toString("utf8");
}

function writeFile(cwd: string, relativePath: string, content: string) {
  const filePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-mutations-"));
  git(cwd, "init", "-b", "main");
  writeFile(cwd, "src/review.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");
  git(cwd, "checkout", "-b", "feature/review");
  return cwd;
}

function makeSession(cwd: string): ReviewSessionRecord {
  return {
    sessionId: ReviewSessionId.make("review-session-1"),
    threadId: ThreadId.make("thread-1"),
    projectId: null,
    checkoutPath: cwd,
    mode: "review",
    scope: "combined",
    target: {
      cwd,
      repositoryRoot: cwd,
      worktreePath: null,
      baseRef: "main",
      headRef: "feature/review",
    },
    pullRequestOverrideProvider: null,
    pullRequestOverrideNumber: null,
    pullRequestOverrideUrl: null,
    pullRequestProvider: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    baseBranchOverride: null,
    createdAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-21T10:00:00.000Z",
    lastActivatedAt: "2026-05-21T10:00:00.000Z",
    archivedAt: null,
  };
}

function makeServices(session: ReviewSessionRecord) {
  const ignoreRules = new Map<string, ReviewIgnoreRuleRecord>();
  const diffService = makeReviewDiffService({
    executeGit: (cwd, args, options) =>
      Effect.try({
        try: () => {
          const stdout = execFileSync("git", args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: options?.maxOutputBytes ?? 1_500_000,
            env: process.env,
          }).toString("utf8");
          return { stdout, code: 0 };
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "ReviewMutationService.test.executeGit",
            command: `git ${args.join(" ")}`,
            cwd,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    streamGitStatus: () => Stream.empty,
    listReviewIgnoreRules: () => Effect.succeed([...ignoreRules.values()]),
  });

  const mutationService = makeReviewMutationService({
    getSession: () => Effect.succeed(session),
    loadFilePatchArtifact: (input) => diffService.loadFilePatchArtifact(input),
    executeGitPatch: ({ cwd, args, patch }) =>
      Effect.try({
        try: () => {
          const result = spawnSync("git", args, {
            cwd,
            input: patch,
            encoding: "utf8",
            env: process.env,
          });
          if (result.status !== 0) {
            throw new Error((result.stderr || result.stdout || "git apply failed").trim());
          }
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "ReviewMutationService.test.executeGitPatch",
            command: `git ${args.join(" ")}`,
            cwd,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    refreshGitStatus: () => Effect.void,
    upsertIgnoreRule: ({ checkoutPath, rulePath, ruleKind, createdAt, updatedAt }) =>
      Effect.sync(() => {
        const normalizedPath = rulePath.replace(/^\.\/+/g, "").replace(/\/+$/g, "");
        const matchPath = ruleKind === "directory" ? `${normalizedPath}/` : normalizedPath;
        const record: ReviewIgnoreRuleRecord = {
          checkoutPath,
          ruleKind,
          normalizedPath,
          matchPath,
          createdAt,
          updatedAt,
        };
        ignoreRules.set(`${ruleKind}:${normalizedPath}`, record);
        return record;
      }),
    deleteIgnoreRule: ({ normalizedPath, ruleKind }) =>
      Effect.sync(() => {
        ignoreRules.delete(`${ruleKind}:${normalizedPath}`);
      }),
  });

  return { diffService, mutationService, ignoreRules };
}

async function loadFirstChunkId(
  diffService: ReturnType<typeof makeReviewDiffService>,
  session: ReviewSessionRecord,
  lane: "unstaged" | "staged" | "committed",
  normalizedPath: string,
) {
  const artifact = await Effect.runPromise(
    diffService.loadFilePatchArtifact({
      sessionId: session.sessionId,
      scope: lane === "committed" ? "branch" : "combined",
      lane,
      normalizedPath,
      target: session.target,
    }),
  );
  const chunkId = artifact?.chunkArtifacts[0]?.chunkId;
  expect(chunkId).toBeDefined();
  return chunkId as ReviewChunkId;
}

describe("ReviewMutationService", () => {
  it("stages and unstages a chunk without touching the other hunk", async () => {
    const cwd = makeRepo();
    const session = makeSession(cwd);
    writeFile(cwd, "src/review.txt", "A\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nM\nn\n");
    const { diffService, mutationService } = makeServices(session);

    const chunkId = await loadFirstChunkId(diffService, session, "unstaged", "src/review.txt");

    await Effect.runPromise(
      mutationService.applyRawMutation({
        sessionId: session.sessionId,
        action: "stage",
        target: {
          targetKind: "chunk",
          lane: "unstaged",
          normalizedPath: "src/review.txt",
          chunkId,
        },
      }),
    );

    expect(gitStdout(cwd, "diff", "--cached", "--src-prefix=a/", "--dst-prefix=b/")).toContain(
      "+A",
    );
    expect(gitStdout(cwd, "diff", "--src-prefix=a/", "--dst-prefix=b/")).toContain("+M");

    const stagedChunkId = await loadFirstChunkId(diffService, session, "staged", "src/review.txt");

    await Effect.runPromise(
      mutationService.applyRawMutation({
        sessionId: session.sessionId,
        action: "unstage",
        target: {
          targetKind: "chunk",
          lane: "staged",
          normalizedPath: "src/review.txt",
          chunkId: stagedChunkId,
        },
      }),
    );

    expect(gitStdout(cwd, "diff", "--cached")).toBe("");
    expect(gitStdout(cwd, "diff")).toContain("+A");
    expect(gitStdout(cwd, "diff")).toContain("+M");
  });

  it("undos a committed chunk by creating an unstaged inverse edit only", async () => {
    const cwd = makeRepo();
    const session = makeSession(cwd);
    writeFile(cwd, "src/review.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nM\nn\n");
    git(cwd, "add", "src/review.txt");
    git(cwd, "commit", "-m", "branch change");
    const { diffService, mutationService } = makeServices(session);

    const chunkId = await loadFirstChunkId(diffService, session, "committed", "src/review.txt");

    await Effect.runPromise(
      mutationService.applyRawMutation({
        sessionId: session.sessionId,
        action: "undo",
        target: {
          targetKind: "chunk",
          lane: "committed",
          normalizedPath: "src/review.txt",
          chunkId,
        },
      }),
    );

    expect(gitStdout(cwd, "diff", "--cached")).toBe("");
    expect(gitStdout(cwd, "diff")).toContain("-M");
    expect(gitStdout(cwd, "diff")).toContain("+m");
  });

  it("fails stale chunk mutations atomically with a refresh-needed error", async () => {
    const cwd = makeRepo();
    const session = makeSession(cwd);
    writeFile(cwd, "src/review.txt", "A\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
    const { diffService, mutationService } = makeServices(session);

    const chunkId = await loadFirstChunkId(diffService, session, "unstaged", "src/review.txt");
    writeFile(cwd, "src/review.txt", "AA\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");

    await expect(
      Effect.runPromise(
        mutationService.applyRawMutation({
          sessionId: session.sessionId,
          action: "stage",
          target: {
            targetKind: "chunk",
            lane: "unstaged",
            normalizedPath: "src/review.txt",
            chunkId,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ReviewMutationConflictError);
    expect(gitStdout(cwd, "diff", "--cached")).toBe("");
  });

  it("handles mixed committed, staged, and unstaged files without cross-lane corruption", async () => {
    const cwd = makeRepo();
    const session = makeSession(cwd);

    writeFile(cwd, "src/staged-only.txt", "tracked staged base\n");
    writeFile(cwd, "src/unstaged-only.txt", "tracked unstaged base\n");
    git(cwd, "add", "src/staged-only.txt", "src/unstaged-only.txt");
    git(cwd, "commit", "-m", "seed tracked files");

    writeFile(cwd, "src/review.txt", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nM\nn\n");
    git(cwd, "add", "src/review.txt");
    git(cwd, "commit", "-m", "committed review change");

    writeFile(cwd, "src/staged-only.txt", "staged change\n");
    git(cwd, "add", "src/staged-only.txt");

    writeFile(cwd, "src/unstaged-only.txt", "draft one\n");

    const { diffService, mutationService } = makeServices(session);

    const committedChunkId = await loadFirstChunkId(
      diffService,
      session,
      "committed",
      "src/review.txt",
    );
    const unstagedChunkId = await loadFirstChunkId(
      diffService,
      session,
      "unstaged",
      "src/unstaged-only.txt",
    );

    await Effect.runPromise(
      mutationService.applyRawMutation({
        sessionId: session.sessionId,
        action: "undo",
        target: {
          targetKind: "chunk",
          lane: "committed",
          normalizedPath: "src/review.txt",
          chunkId: committedChunkId,
        },
      }),
    );

    expect(gitStdout(cwd, "diff", "--cached")).toContain("src/staged-only.txt");
    expect(gitStdout(cwd, "diff", "--cached")).not.toContain("src/review.txt");
    expect(gitStdout(cwd, "diff")).toContain("src/review.txt");
    expect(gitStdout(cwd, "diff")).toContain("-M");
    expect(gitStdout(cwd, "diff")).toContain("+m");
    expect(gitStdout(cwd, "diff")).toContain("src/unstaged-only.txt");

    writeFile(cwd, "src/unstaged-only.txt", "draft two\n");

    await expect(
      Effect.runPromise(
        mutationService.applyRawMutation({
          sessionId: session.sessionId,
          action: "stage",
          target: {
            targetKind: "chunk",
            lane: "unstaged",
            normalizedPath: "src/unstaged-only.txt",
            chunkId: unstagedChunkId,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ReviewMutationConflictError);

    expect(gitStdout(cwd, "diff", "--cached")).toContain("src/staged-only.txt");
    expect(gitStdout(cwd, "diff", "--cached")).not.toContain("src/unstaged-only.txt");
  });

  it("adds and removes ignore overlay rules for the checkout path", async () => {
    const cwd = makeRepo();
    const session = makeSession(cwd);
    const { ignoreRules, mutationService } = makeServices(session);

    const ignoreInput: ReviewApplyRawMutationInput = {
      sessionId: session.sessionId,
      action: "ignore",
      target: {
        targetKind: "ignore-rule",
        ruleKind: "file",
        normalizedPath: "src/generated.txt",
      },
    };

    await Effect.runPromise(mutationService.applyRawMutation(ignoreInput));
    expect(ignoreRules.has("file:src/generated.txt")).toBe(true);

    await Effect.runPromise(
      mutationService.applyRawMutation({
        sessionId: session.sessionId,
        action: "unignore",
        target: {
          targetKind: "ignore-rule",
          ruleKind: "file",
          normalizedPath: "src/generated.txt",
        },
      }),
    );
    expect(ignoreRules.has("file:src/generated.txt")).toBe(false);
  });
});
