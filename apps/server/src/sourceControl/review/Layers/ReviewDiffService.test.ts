import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { GitStatusStreamEvent } from "@fenrir/contracts";
import { GitCommandError } from "@fenrir/contracts";
import { ReviewSessionId } from "@fenrir/contracts/sourceControlReview";
import type { ReviewIgnoreRuleRecord } from "../../../persistence/Services/ReviewIgnoreRules.ts";

import { makeReviewDiffService } from "../Services/ReviewDiffService.ts";

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

function writeFile(cwd: string, relativePath: string, content: string) {
  const filePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-diff-"));
  git(cwd, "init", "-b", "main");
  writeFile(cwd, "src/file.txt", "one\ntwo\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");
  git(cwd, "checkout", "-b", "feature/review");

  writeFile(cwd, "src/file.txt", "one\ntwo\nthree\n");
  git(cwd, "add", "src/file.txt");
  git(cwd, "commit", "-m", "branch change");

  writeFile(cwd, ".gitignore", "ignored.log\n");
  writeFile(cwd, "ignored.log", "ignore me\n");
  writeFile(cwd, "src/file.txt", "one\ntwo\nthree\nfour\n");
  writeFile(cwd, "src/staged.txt", "hello\n");
  git(cwd, "add", "src/staged.txt");
  return cwd;
}

function makeService(args?: {
  readonly statusStream?: ReadonlyArray<GitStatusStreamEvent>;
  readonly ignoreRules?: ReadonlyArray<ReviewIgnoreRuleRecord>;
}) {
  return makeReviewDiffService({
    executeGit: (cwd, args, options) =>
      Effect.try({
        try: () => {
          const stdout = execFileSync("git", args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: options?.maxOutputBytes ?? 1_500_000,
          }).toString("utf8");
          return {
            stdout,
            code: 0,
          };
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "ReviewDiffService.test.executeGit",
            command: `git ${args.join(" ")}`,
            cwd,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    streamGitStatus: () =>
      Stream.fromIterable(
        args?.statusStream ?? [
          {
            _tag: "snapshot",
            local: {
              isRepo: true,
              hasOriginRemote: false,
              isDefaultBranch: false,
              branch: "feature/review",
              hasWorkingTreeChanges: true,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            },
            remote: null,
          },
        ],
      ),
    listReviewIgnoreRules: () => Effect.succeed(args?.ignoreRules ?? []),
  });
}

describe("ReviewDiffService", () => {
  it("builds lane metadata and lazy file patches", async () => {
    const cwd = makeRepo();
    const service = makeService();
    const sessionId = ReviewSessionId.make("review-session-1");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* service.loadSnapshot({
          sessionId,
          scope: "combined",
          target: {
            cwd,
            worktreePath: null,
            repositoryRoot: cwd,
            baseRef: "main",
            headRef: "feature/review",
          },
        });

        expect(snapshot.lanes.map((lane) => lane.kind)).toEqual([
          "ignored",
          "unstaged",
          "staged",
          "committed",
          "inverse-edit",
        ]);
        expect(
          snapshot.lanes.find((lane) => lane.kind === "ignored")?.files[0]?.normalizedPath,
        ).toBe("ignored.log");
        expect(
          snapshot.lanes.find((lane) => lane.kind === "staged")?.files[0]?.normalizedPath,
        ).toBe("src/staged.txt");

        const patch = yield* service.loadFilePatch({
          sessionId,
          scope: "combined",
          lane: "committed",
          normalizedPath: "src/file.txt",
          target: {
            cwd,
            worktreePath: null,
            repositoryRoot: cwd,
            baseRef: "main",
            headRef: "feature/review",
          },
        });

        expect(patch?.chunks.length).toBeGreaterThan(0);
        expect(patch?.chunks[0]?.anchor.provenance.lane).toBe("committed");
        expect(patch?.chunks[0]?.anchor.excerptHash).toMatch(/^sha256:/);
      }),
    );

    expect(result).toBeUndefined();
  });

  it("debounces snapshot recomputation over status bursts", async () => {
    const cwd = makeRepo();
    const service = makeService({
      statusStream: [
        {
          _tag: "snapshot",
          local: {
            isRepo: true,
            hasOriginRemote: false,
            isDefaultBranch: false,
            branch: "feature/review",
            hasWorkingTreeChanges: true,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          },
          remote: null,
        },
        {
          _tag: "localUpdated",
          local: {
            isRepo: true,
            hasOriginRemote: false,
            isDefaultBranch: false,
            branch: "feature/review",
            hasWorkingTreeChanges: true,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          },
        },
      ],
    });
    const sessionId = ReviewSessionId.make("review-session-2");

    const snapshots = await Effect.runPromise(
      Stream.take(
        service.streamSnapshots({
          sessionId,
          scope: "combined",
          target: {
            cwd,
            worktreePath: null,
            repositoryRoot: cwd,
            baseRef: "main",
            headRef: "feature/review",
          },
        }),
        1,
      ).pipe(Stream.runCollect),
    );

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.lanes.some((lane) => lane.kind === "committed")).toBe(true);
  });

  it("surfaces review-ignored files in the ignored lane with their source provenance", async () => {
    const cwd = makeRepo();
    const service = makeService({
      ignoreRules: [
        {
          checkoutPath: cwd,
          ruleKind: "file",
          normalizedPath: "src/staged.txt",
          matchPath: "src/staged.txt",
          createdAt: "2026-05-21T10:00:00.000Z",
          updatedAt: "2026-05-21T10:00:00.000Z",
        },
      ],
    });
    const sessionId = ReviewSessionId.make("review-session-3");

    const snapshot = await Effect.runPromise(
      service.loadSnapshot({
        sessionId,
        scope: "combined",
        target: {
          cwd,
          worktreePath: null,
          repositoryRoot: cwd,
          baseRef: "main",
          headRef: "feature/review",
        },
      }),
    );
    const ignoredFile = snapshot.lanes
      .find((lane) => lane.kind === "ignored")
      ?.files.find((file) => file.normalizedPath === "src/staged.txt");

    expect(ignoredFile?.lane).toBe("ignored");
    expect(ignoredFile?.provenance.lane).toBe("staged");
    expect(ignoredFile?.ignoreRule?.ruleKind).toBe("file");

    const patch = await Effect.runPromise(
      service.loadFilePatch({
        sessionId,
        scope: "combined",
        lane: "ignored",
        normalizedPath: "src/staged.txt",
        target: {
          cwd,
          worktreePath: null,
          repositoryRoot: cwd,
          baseRef: "main",
          headRef: "feature/review",
        },
      }),
    );

    expect(patch?.lane).toBe("ignored");
    expect(patch?.provenance.lane).toBe("staged");
    expect(patch?.chunks.length).toBeGreaterThan(0);
    expect(patch?.chunks[0]?.anchor.provenance.lane).toBe("staged");
  });
});
