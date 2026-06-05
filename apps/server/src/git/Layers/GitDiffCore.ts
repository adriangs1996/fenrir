import { lstat, readFile, readlink } from "node:fs/promises";
import nodePath from "node:path";
import type {
  GitDiffFileContent,
  GitDiffFileSummary,
  GitDiffStackStep,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadStackedDiffFileIndexInput,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { GitCore } from "../Services/GitCore.ts";
import { GitDiffCore } from "../Services/GitDiffCore.ts";

const DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DIFF_FILE_PATCH_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function buildDiffArgs(input: LoadDiffFileIndexInput): ReadonlyArray<string> {
  const args = ["diff", "--numstat", "-z"];
  if (input.detectRenames) {
    args.push("--find-renames");
  }
  if (input.detectCopies) {
    args.push("--find-copies");
  }
  if (input.target.kind === "staged") {
    args.push("--cached");
  }
  if (input.target.kind === "range") {
    args.push(`${input.target.baseRef}...${input.target.headRef}`);
  }
  return args;
}

function buildDiffFilePatchArgs(input: LoadDiffFileInput): ReadonlyArray<string> {
  const args = ["diff", "--no-ext-diff", "--no-color"];
  if (input.detectRenames) {
    args.push("--find-renames");
  }
  if (input.detectCopies) {
    args.push("--find-copies");
  }
  if (input.target.kind === "staged") {
    args.push("--cached");
  }
  if (input.target.kind === "range") {
    args.push(`${input.target.baseRef}...${input.target.headRef}`);
  }

  args.push("--", ...uniqueDiffFilePaths(input));
  return args;
}

function uniqueDiffFilePaths(input: LoadDiffFileInput): ReadonlyArray<string> {
  return [...new Set([input.previousPath, input.path].filter((value): value is string => !!value))];
}

function formatGitObjectSpec(ref: string, filePath: string): string {
  return ref.length === 0 ? `:${filePath}` : `${ref}:${filePath}`;
}

function isSafeRelativePath(cwd: string, relativePath: string): boolean {
  if (nodePath.isAbsolute(relativePath)) {
    return false;
  }

  const absoluteCwd = nodePath.resolve(cwd);
  const absolutePath = nodePath.resolve(absoluteCwd, relativePath);
  const relativeToCwd = nodePath.relative(absoluteCwd, absolutePath);

  return (
    relativeToCwd.length > 0 &&
    !relativeToCwd.startsWith("..") &&
    !nodePath.isAbsolute(relativeToCwd)
  );
}

function parseNumstat(stdout: string): ReadonlyArray<GitDiffFileSummary> {
  const tokens = stdout.split("\0");
  const summaries: GitDiffFileSummary[] = [];

  for (let index = 0; index < tokens.length; ) {
    const header = tokens[index++];
    if (!header) {
      continue;
    }

    const firstTab = header.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : header.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) {
      continue;
    }

    const insertionsText = header.slice(0, firstTab);
    const deletionsText = header.slice(firstTab + 1, secondTab);
    const inlinePath = header.slice(secondTab + 1);
    const previousPath = inlinePath.length === 0 ? (tokens[index++] ?? "") : null;
    const path = inlinePath.length === 0 ? (tokens[index++] ?? "") : inlinePath;
    if (path.length === 0) {
      continue;
    }

    const binary = insertionsText === "-" || deletionsText === "-";
    summaries.push({
      path,
      previousPath: previousPath && previousPath.length > 0 ? previousPath : null,
      insertions: binary ? 0 : Number(insertionsText),
      deletions: binary ? 0 : Number(deletionsText),
      binary,
    });
  }

  return summaries;
}

interface BranchTip {
  readonly branchName: string;
  readonly oid: string;
}

function parseCommitOids(stdout: string): ReadonlyArray<string> {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseBranchTips(stdout: string): ReadonlyArray<BranchTip> {
  return stdout
    .split(/\r?\n/u)
    .map((line) => {
      const [branchName = "", oid = ""] = line.split("\t");
      return { branchName: branchName.trim(), oid: oid.trim() };
    })
    .filter((tip) => tip.branchName.length > 0 && tip.oid.length > 0);
}

function orderedBranchTipsOnPath(input: {
  readonly branchTips: ReadonlyArray<BranchTip>;
  readonly commitOids: ReadonlyArray<string>;
  readonly headRef: string;
}): ReadonlyArray<BranchTip> {
  const commitIndexByOid = new Map(input.commitOids.map((oid, index) => [oid, index]));
  const tipsByCommitIndex = new Map<number, BranchTip[]>();

  for (const tip of input.branchTips) {
    const commitIndex = commitIndexByOid.get(tip.oid);
    if (commitIndex === undefined) {
      continue;
    }

    const existing = tipsByCommitIndex.get(commitIndex) ?? [];
    existing.push(tip);
    tipsByCommitIndex.set(commitIndex, existing);
  }

  return [...tipsByCommitIndex.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, tips]) => {
      const exactHead = tips.find((tip) => tip.branchName === input.headRef);
      return (
        exactHead ??
        tips.toSorted((left, right) => left.branchName.localeCompare(right.branchName))[0]!
      );
    });
}

export const GitDiffCoreLive = Layer.effect(
  GitDiffCore,
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const readGitRevisionFile = (
      cwd: string,
      ref: string,
      filePath: string,
    ): Effect.Effect<GitDiffFileContent | null> =>
      gitCore
        .execute({
          operation: "GitDiffCore.loadDiffFile.readGitRevisionFile",
          cwd,
          args: ["show", formatGitObjectSpec(ref, filePath)],
          allowNonZeroExit: true,
          maxOutputBytes: DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
          truncateOutputAtMaxBytes: true,
        })
        .pipe(
          Effect.map((result) =>
            result.code === 0 && !result.stdoutTruncated
              ? {
                  path: filePath,
                  contents: result.stdout,
                }
              : null,
          ),
          Effect.catch(() => Effect.succeed(null)),
        );

    const readWorkingTreeFile = (
      cwd: string,
      filePath: string,
    ): Effect.Effect<GitDiffFileContent | null> => {
      if (!isSafeRelativePath(cwd, filePath)) {
        return Effect.succeed(null);
      }

      const absolutePath = nodePath.resolve(cwd, filePath);
      return Effect.tryPromise(async () => {
        const stats = await lstat(absolutePath);
        if (stats.isSymbolicLink()) {
          return {
            path: filePath,
            contents: await readlink(absolutePath),
          };
        }
        if (!stats.isFile() || stats.size > DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES) {
          return null;
        }

        return {
          path: filePath,
          contents: await readFile(absolutePath, "utf8"),
        };
      }).pipe(Effect.catch(() => Effect.succeed(null)));
    };

    const readOldDiffFile = (
      input: LoadDiffFileInput,
      filePath: string,
    ): Effect.Effect<GitDiffFileContent | null> => {
      switch (input.target.kind) {
        case "worktree":
          return readGitRevisionFile(input.cwd, "", filePath).pipe(
            Effect.flatMap((content) =>
              content ? Effect.succeed(content) : readGitRevisionFile(input.cwd, "HEAD", filePath),
            ),
          );
        case "staged":
          return readGitRevisionFile(input.cwd, "HEAD", filePath);
        case "range":
          return readGitRevisionFile(input.cwd, input.target.baseRef, filePath);
      }
    };

    const readNewDiffFile = (
      input: LoadDiffFileInput,
      filePath: string,
    ): Effect.Effect<GitDiffFileContent | null> => {
      switch (input.target.kind) {
        case "worktree":
          return readWorkingTreeFile(input.cwd, filePath);
        case "staged":
          return readGitRevisionFile(input.cwd, "", filePath);
        case "range":
          return readGitRevisionFile(input.cwd, input.target.headRef, filePath);
      }
    };

    const loadDiffFile = (input: LoadDiffFileInput) =>
      Effect.gen(function* () {
        const oldPath = input.previousPath ?? input.path;
        const [patchResult, oldFile, newFile] = yield* Effect.all(
          [
            gitCore.execute({
              operation: "GitDiffCore.loadDiffFile.patch",
              cwd: input.cwd,
              args: buildDiffFilePatchArgs(input),
              maxOutputBytes: DIFF_FILE_PATCH_MAX_OUTPUT_BYTES,
              truncateOutputAtMaxBytes: true,
            }),
            readOldDiffFile(input, oldPath),
            readNewDiffFile(input, input.path),
          ],
          { concurrency: "unbounded" },
        );

        return {
          path: input.path,
          previousPath: input.previousPath,
          oldFile,
          newFile,
          patch: patchResult.stdoutTruncated ? "" : patchResult.stdout,
        };
      });

    const loadDiffFileIndex = (input: LoadDiffFileIndexInput) =>
      gitCore
        .execute({
          operation: "GitDiffCore.loadDiffFileIndex",
          cwd: input.cwd,
          args: buildDiffArgs(input),
        })
        .pipe(Effect.map((result) => parseNumstat(result.stdout)));

    const loadStackedDiffFileIndex = (input: LoadStackedDiffFileIndexInput) =>
      Effect.gen(function* () {
        const [commitPathResult, branchTipsResult] = yield* Effect.all(
          [
            gitCore.execute({
              operation: "GitDiffCore.loadStackedDiffFileIndex.commitPath",
              cwd: input.cwd,
              args: [
                "rev-list",
                "--ancestry-path",
                "--reverse",
                `${input.baseRef}..${input.headRef}`,
              ],
            }),
            gitCore.execute({
              operation: "GitDiffCore.loadStackedDiffFileIndex.branchTips",
              cwd: input.cwd,
              args: ["for-each-ref", "--format=%(refname:short)\t%(objectname)", "refs/heads"],
            }),
          ],
          { concurrency: "unbounded" },
        );

        const stackBranchTips = orderedBranchTipsOnPath({
          branchTips: parseBranchTips(branchTipsResult.stdout),
          commitOids: parseCommitOids(commitPathResult.stdout),
          headRef: input.headRef,
        });

        const steps = yield* Effect.all(
          stackBranchTips.map((tip, index) => {
            const baseRef = index === 0 ? input.baseRef : stackBranchTips[index - 1]!.branchName;
            return loadDiffFileIndex({
              cwd: input.cwd,
              target: {
                kind: "range",
                baseRef,
                headRef: tip.branchName,
              },
              detectRenames: input.detectRenames,
              detectCopies: input.detectCopies,
            }).pipe(
              Effect.map(
                (files): GitDiffStackStep => ({
                  index: index + 1,
                  branchName: tip.branchName,
                  baseRef,
                  headRef: tip.branchName,
                  files,
                }),
              ),
            );
          }),
          { concurrency: 1 },
        );

        return {
          baseRef: input.baseRef,
          headRef: input.headRef,
          steps,
        };
      });

    return GitDiffCore.of({
      loadDiffFile,
      loadDiffFileIndex,
      loadStackedDiffFileIndex,
    });
  }),
);
