import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

import { DateTime, Effect, Layer, Option, Context } from "effect";

import { VcsProcessExitError } from "@fenrir/contracts";
import type {
  GitDiffFileContent,
  GitDiffFileSummary,
  GitDiffHunkSummary,
  LoadDiffFileIndexInput,
  LoadDiffFileInput,
} from "@fenrir/contracts";
import type { VcsDriverShape } from "./VcsDriver.ts";
import { VcsProcess, VcsProcessLive } from "./VcsProcess.ts";

const DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DIFF_FILE_PATCH_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const UNTRACKED_FILE_LINE_COUNT_MAX_BYTES = 2 * 1024 * 1024;
const UNTRACKED_FILE_BINARY_SNIFF_BYTES = 8_000;
const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const GIT_EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const WORKSPACE_GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

export class GitVcsDriver extends Context.Service<GitVcsDriver, VcsDriverShape>()(
  "fenrir/vcs/Services/GitVcsDriver",
) {}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
}

function buildDiffArgs(input: LoadDiffFileIndexInput): ReadonlyArray<string> {
  const args = ["diff", "--numstat", "-z"];
  if (input.target.kind === "stash") {
    args.length = 0;
    args.push("stash", "show", "--numstat", "-z", "--no-ext-diff");
    args.push(input.target.ref);
    return args;
  }
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
  if (input.target.kind === "commit") {
    args.push(input.target.parentRef ?? GIT_EMPTY_TREE_SHA, input.target.commitRef);
  }
  return args;
}

function buildDiffPatchArgsForTarget(input: LoadDiffFileIndexInput): ReadonlyArray<string> {
  if (input.target.kind === "stash") {
    return ["stash", "show", "-p", "--no-ext-diff", "--no-color", "--unified=0", input.target.ref];
  }

  const args = ["diff", "--no-ext-diff", "--no-color", "--unified=0"];
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
  if (input.target.kind === "commit") {
    args.push(input.target.parentRef ?? GIT_EMPTY_TREE_SHA, input.target.commitRef);
  }
  return args;
}

function buildDiffSignatureArgs(
  input: Parameters<NonNullable<VcsDriverShape["reviewDiff"]>["loadChangeSignature"]>[0],
): ReadonlyArray<string> {
  const args = ["diff", "--no-ext-diff", "--no-color"];
  if (input.detectRenames) {
    args.push("--find-renames");
  }
  if (input.detectCopies) {
    args.push("--find-copies");
  }

  switch (input.target.kind) {
    case "worktree":
      return args;
    case "staged":
      args.push("--cached");
      return args;
    case "range":
      args.push(`${input.target.baseRef}...${input.target.headRef}`);
      return args;
    case "commit":
      args.push(input.target.parentRef ?? GIT_EMPTY_TREE_SHA, input.target.commitRef);
      return args;
    case "stash":
      return ["stash", "show", "-p", "--no-ext-diff", "--no-color", input.target.ref];
  }
}

function buildUntrackedStatusArgs(): ReadonlyArray<string> {
  return ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"];
}

function buildDiffFilePatchArgs(input: LoadDiffFileInput): ReadonlyArray<string> {
  if (input.target.kind === "stash") {
    const args = ["diff", "--no-ext-diff", "--no-color"];
    if (input.detectRenames) {
      args.push("--find-renames");
    }
    if (input.detectCopies) {
      args.push("--find-copies");
    }
    args.push(`${input.target.ref}^`, input.target.ref, "--", ...uniqueDiffFilePaths(input));
    return args;
  }

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
  if (input.target.kind === "commit") {
    args.push(input.target.parentRef ?? GIT_EMPTY_TREE_SHA, input.target.commitRef);
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
  if (path.isAbsolute(relativePath)) {
    return false;
  }

  const absoluteCwd = path.resolve(cwd);
  const absolutePath = path.resolve(absoluteCwd, relativePath);
  const relativeToCwd = path.relative(absoluteCwd, absolutePath);

  return (
    relativeToCwd.length > 0 && !relativeToCwd.startsWith("..") && !path.isAbsolute(relativeToCwd)
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
    const filePath = inlinePath.length === 0 ? (tokens[index++] ?? "") : inlinePath;
    if (filePath.length === 0) {
      continue;
    }

    const binary = insertionsText === "-" || deletionsText === "-";
    summaries.push({
      path: filePath,
      previousPath: previousPath && previousPath.length > 0 ? previousPath : null,
      insertions: binary ? 0 : Number(insertionsText),
      deletions: binary ? 0 : Number(deletionsText),
      binary,
      isUntracked: false,
      isTooLarge: false,
      statsTruncated: false,
      hunkCount: 0,
      hunks: [],
    });
  }

  return summaries;
}

interface ParsedHunkSummary {
  readonly path: string;
  readonly previousPath: string | null;
  readonly hunks: ReadonlyArray<GitDiffHunkSummary>;
}

function formatHunkHeader(hunk: FileDiffMetadata["hunks"][number]): string {
  const fallback = `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
  const header = hunk.hunkSpecs ?? fallback;
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toHunkSummary(hunk: FileDiffMetadata["hunks"][number], index: number): GitDiffHunkSummary {
  return {
    index,
    header: formatHunkHeader(hunk),
    oldStart: hunk.deletionStart,
    oldLines: hunk.deletionCount,
    newStart: hunk.additionStart,
    newLines: hunk.additionCount,
  };
}

function parsePatchHunkSummaries(patch: string): ReadonlyArray<ParsedHunkSummary> {
  if (patch.trim().length === 0) return [];

  const parsed = parsePatchFiles(patch, "patch", true).flatMap((entry) => entry.files);
  return parsed.map((file) => ({
    path: file.name,
    previousPath: file.prevName ?? null,
    hunks: file.hunks.map(toHunkSummary),
  }));
}

function parseUntrackedStatusPaths(stdout: string): ReadonlyArray<string> {
  return stdout.split("\0").flatMap((entry): string[] => {
    if (!entry.startsWith("?? ")) return [];
    const filePath = entry.slice(3).trim();
    return filePath.length > 0 ? [filePath] : [];
  });
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await import("node:fs/promises").then((fs) => fs.open(filePath, "r"));
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isBinaryBuffer(prefix: Buffer): boolean {
  if (prefix.length === 0) return false;
  let controlBytes = 0;
  for (const byte of prefix) {
    if (byte === 0) return true;
    if (byte < 0x07 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      controlBytes += 1;
    }
  }
  return controlBytes / prefix.length >= 0.3;
}

function countTextLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/u);
  return content.endsWith("\n") || content.endsWith("\r") ? lines.length - 1 : lines.length;
}

async function summarizeUntrackedFile(
  cwd: string,
  filePath: string,
): Promise<GitDiffFileSummary | null> {
  if (!isSafeRelativePath(cwd, filePath)) return null;

  const absolutePath = path.resolve(cwd, filePath);
  const stats = await lstat(absolutePath);
  if (!stats.isFile()) return null;

  const prefix = await readFilePrefix(absolutePath, UNTRACKED_FILE_BINARY_SNIFF_BYTES);
  const binary = isBinaryBuffer(prefix);
  if (binary) {
    return {
      path: filePath,
      previousPath: null,
      insertions: 0,
      deletions: 0,
      binary: true,
      isUntracked: true,
      isTooLarge: stats.size > DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
      statsTruncated: stats.size > UNTRACKED_FILE_LINE_COUNT_MAX_BYTES,
      hunkCount: 0,
      hunks: [],
    };
  }

  const statsTruncated = stats.size > UNTRACKED_FILE_LINE_COUNT_MAX_BYTES;
  const cappedContent = statsTruncated
    ? (await readFilePrefix(absolutePath, UNTRACKED_FILE_LINE_COUNT_MAX_BYTES)).toString("utf8")
    : await readFile(absolutePath, "utf8");
  const insertions = countTextLines(cappedContent);
  const hunks: ReadonlyArray<GitDiffHunkSummary> =
    stats.size > DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES || insertions === 0
      ? []
      : [
          {
            index: 0,
            header: `@@ -0,0 +1,${insertions} @@`,
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: insertions,
          },
        ];

  return {
    path: filePath,
    previousPath: null,
    insertions,
    deletions: 0,
    binary: false,
    isUntracked: true,
    isTooLarge: stats.size > DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
    statsTruncated,
    hunkCount: hunks.length,
    hunks,
  };
}

type ReadDiffFileContentResult =
  | { readonly kind: "loaded"; readonly content: GitDiffFileContent }
  | { readonly kind: "missing" }
  | { readonly kind: "too_large" };

function loadedDiffFile(filePath: string, contents: string): ReadDiffFileContentResult {
  return { kind: "loaded", content: { path: filePath, contents } };
}

function missingDiffFile(): ReadDiffFileContentResult {
  return { kind: "missing" };
}

function tooLargeDiffFile(): ReadDiffFileContentResult {
  return { kind: "too_large" };
}

async function statSignature(absolutePath: string): Promise<string> {
  try {
    const stats = await lstat(absolutePath);
    return `${absolutePath}:${stats.size}:${stats.mtimeMs}:${stats.ino}`;
  } catch {
    return `${absolutePath}:missing`;
  }
}

function chunkPathsForGitCheckIgnore(relativePaths: ReadonlyArray<string>): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (chunk.length > 0 && chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }

    chunk.push(relativePath);
    chunkBytes += relativePathBytes;

    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function parseGitRemoteVerboseOutput(
  output: string,
): Map<string, { url?: string; pushUrl?: string }> {
  const remotes = new Map<string, { url?: string; pushUrl?: string }>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const name = match[1];
    const url = match[2];
    const direction = match[3];
    if (!name || !url || !direction) {
      continue;
    }
    const remote = remotes.get(name) ?? {};
    if (direction === "fetch") {
      remote.url = url;
    } else {
      remote.pushUrl = url;
    }
    remotes.set(name, remote);
  }
  return remotes;
}

function gitProcessExitError(
  operation: string,
  cwd: string,
  command: string,
  detail: string,
  exitCode = -1,
): VcsProcessExitError {
  return new VcsProcessExitError({
    operation,
    command,
    cwd,
    exitCode,
    detail,
  });
}

const makeGitVcsDriver = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess;

  const nowFreshness = Effect.gen(function* () {
    const now = yield* DateTime.now;
    return {
      source: "live-local" as const,
      observedAt: now,
      expiresAt: Option.none(),
    };
  });

  const gitCommand = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly stdin?: string;
      readonly env?: NodeJS.ProcessEnv;
      readonly allowNonZeroExit?: boolean;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
      readonly appendTruncationMarker?: boolean;
    },
  ) =>
    vcsProcess.run({
      operation,
      command: "git",
      args: ["-C", cwd, ...args],
      cwd,
      spawnCwd: globalThis.process.cwd(),
      ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
      ...(options?.env !== undefined ? { env: options.env } : {}),
      ...(options?.allowNonZeroExit !== undefined
        ? { allowNonZeroExit: options.allowNonZeroExit }
        : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
      ...(options?.appendTruncationMarker !== undefined
        ? { appendTruncationMarker: options.appendTruncationMarker }
        : {}),
    });

  const execute: VcsDriverShape["execute"] = (input) =>
    gitCommand(input.operation, input.cwd, input.args, {
      ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      ...(input.appendTruncationMarker !== undefined
        ? { appendTruncationMarker: input.appendTruncationMarker }
        : {}),
    });

  const isInsideWorkTree: VcsDriverShape["isInsideWorkTree"] = (cwd) =>
    gitCommand("GitVcsDriver.isInsideWorkTree", cwd, ["rev-parse", "--is-inside-work-tree"], {
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"));

  const detectRepository: VcsDriverShape["detectRepository"] = Effect.fn(
    "GitVcsDriver.detectRepository",
  )(function* (cwd) {
    if (!(yield* isInsideWorkTree(cwd))) {
      return null;
    }

    const root = yield* gitCommand("GitVcsDriver.detectRepository.root", cwd, [
      "rev-parse",
      "--show-toplevel",
    ]);
    const gitCommonDirResult = yield* gitCommand(
      "GitVcsDriver.detectRepository.commonDir",
      cwd,
      ["rev-parse", "--git-common-dir"],
      {
        allowNonZeroExit: true,
      },
    ).pipe(Effect.catch(() => Effect.succeed(null)));

    const gitCommonDir = gitCommonDirResult?.stdout.trim() ?? "";

    return {
      kind: "git" as const,
      rootPath: root.stdout.trim(),
      metadataPath:
        gitCommonDir.length > 0
          ? path.isAbsolute(gitCommonDir)
            ? gitCommonDir
            : path.resolve(cwd, gitCommonDir)
          : null,
      freshness: yield* nowFreshness,
    };
  });

  const listWorkspaceFiles: VcsDriverShape["listWorkspaceFiles"] = (cwd) =>
    gitCommand(
      "GitVcsDriver.listWorkspaceFiles",
      cwd,
      [
        ...WORKSPACE_GIT_HARDENED_CONFIG_ARGS,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        allowNonZeroExit: true,
        timeoutMs: 20_000,
        maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
        appendTruncationMarker: true,
      },
    ).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.gen(function* () {
              return {
                paths: splitNullSeparatedPaths(result.stdout, result.stdoutTruncated),
                truncated: result.stdoutTruncated,
                freshness: yield* nowFreshness,
              };
            })
          : Effect.fail(
              gitProcessExitError(
                "GitVcsDriver.listWorkspaceFiles",
                cwd,
                "git ls-files",
                result.stderr.trim() || "git ls-files failed",
                result.exitCode,
              ),
            ),
      ),
    );

  const filterIgnoredPaths: VcsDriverShape["filterIgnoredPaths"] = Effect.fn(
    "GitVcsDriver.filterIgnoredPaths",
  )(function* (cwd, relativePaths) {
    if (relativePaths.length === 0) {
      return relativePaths;
    }

    const ignoredPaths = new Set<string>();
    const chunks = chunkPathsForGitCheckIgnore(relativePaths);

    for (const chunk of chunks) {
      const result = yield* gitCommand(
        "GitVcsDriver.filterIgnoredPaths",
        cwd,
        [...WORKSPACE_GIT_HARDENED_CONFIG_ARGS, "check-ignore", "--no-index", "-z", "--stdin"],
        {
          stdin: `${chunk.join("\0")}\0`,
          allowNonZeroExit: true,
          timeoutMs: 20_000,
          maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
          appendTruncationMarker: true,
        },
      );

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return yield* gitProcessExitError(
          "GitVcsDriver.filterIgnoredPaths",
          cwd,
          "git check-ignore",
          result.stderr.trim() || "git check-ignore failed",
          result.exitCode,
        );
      }

      for (const ignoredPath of splitNullSeparatedPaths(result.stdout, result.stdoutTruncated)) {
        ignoredPaths.add(ignoredPath);
      }
    }

    if (ignoredPaths.size === 0) {
      return relativePaths;
    }

    return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
  });

  const initRepository: VcsDriverShape["initRepository"] = (input) =>
    gitCommand("GitVcsDriver.initRepository", input.cwd, ["init"], {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    }).pipe(Effect.asVoid);

  const listRemotes: VcsDriverShape["listRemotes"] = Effect.fn("GitVcsDriver.listRemotes")(
    function* (cwd) {
      const result = yield* gitCommand("GitVcsDriver.listRemotes", cwd, ["remote", "-v"], {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      });

      if (result.exitCode !== 0) {
        return yield* gitProcessExitError(
          "GitVcsDriver.listRemotes",
          cwd,
          "git remote -v",
          result.stderr.trim() || "git remote -v failed",
          result.exitCode,
        );
      }

      const parsed = parseGitRemoteVerboseOutput(result.stdout);
      const remotes = Array.from(parsed.entries()).flatMap(([name, remote]) => {
        if (!remote.url) {
          return [];
        }
        return [
          {
            name,
            url: remote.url,
            pushUrl: remote.pushUrl ? Option.some(remote.pushUrl) : Option.none(),
            isPrimary: name === "origin",
          },
        ];
      });

      return {
        remotes,
        freshness: yield* nowFreshness,
      };
    },
  );

  const resolveHeadCommit = (cwd: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.resolveHeadCommit",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const hasHeadCommit = (cwd: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.hasHeadCommit",
      cwd,
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.exitCode === 0));

  const resolveCheckpointCommit = (cwd: string, checkpointRef: string) =>
    execute({
      operation: "GitVcsDriver.checkpoints.resolveCheckpointCommit",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0) {
          return null;
        }
        const commit = result.stdout.trim();
        return commit.length > 0 ? commit : null;
      }),
    );

  const resolveGitCommonDir = (cwd: string) =>
    Effect.gen(function* () {
      const result = yield* execute({
        operation: "GitVcsDriver.checkpoints.resolveGitCommonDir",
        cwd,
        args: ["rev-parse", "--git-common-dir"],
      });
      const gitCommonDir = result.stdout.trim();
      return path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
    });

  const checkpoints = {
    captureCheckpoint: Effect.fn("GitVcsDriver.checkpoints.captureCheckpoint")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.captureCheckpoint";
      const gitCommonDir = yield* resolveGitCommonDir(input.cwd);
      const tempIndexPath = path.join(gitCommonDir, `fenrir-checkpoint-index-${randomUUID()}`);
      const commitEnv: NodeJS.ProcessEnv = {
        ...globalThis.process.env,
        GIT_INDEX_FILE: tempIndexPath,
        GIT_AUTHOR_NAME: "Fenrir",
        GIT_AUTHOR_EMAIL: "fenrir@users.noreply.github.com",
        GIT_COMMITTER_NAME: "Fenrir",
        GIT_COMMITTER_EMAIL: "fenrir@users.noreply.github.com",
      };

      yield* Effect.gen(function* () {
        const headExists = yield* hasHeadCommit(input.cwd);
        if (headExists) {
          yield* execute({
            operation,
            cwd: input.cwd,
            args: ["read-tree", "HEAD"],
            env: commitEnv,
          });
        }

        yield* execute({
          operation,
          cwd: input.cwd,
          args: ["add", "-A", "--", "."],
          env: commitEnv,
        });

        const writeTreeResult = yield* execute({
          operation,
          cwd: input.cwd,
          args: ["write-tree"],
          env: commitEnv,
        });
        const treeOid = writeTreeResult.stdout.trim();
        if (treeOid.length === 0) {
          return yield* gitProcessExitError(
            operation,
            input.cwd,
            "git write-tree",
            "git write-tree returned an empty tree oid.",
          );
        }

        const message = `t3 checkpoint ref=${input.checkpointRef}`;
        const commitTreeResult = yield* execute({
          operation,
          cwd: input.cwd,
          args: ["commit-tree", treeOid, "-m", message],
          env: commitEnv,
        });
        const commitOid = commitTreeResult.stdout.trim();
        if (commitOid.length === 0) {
          return yield* gitProcessExitError(
            operation,
            input.cwd,
            "git commit-tree",
            "git commit-tree returned an empty commit oid.",
          );
        }

        yield* execute({
          operation,
          cwd: input.cwd,
          args: ["update-ref", input.checkpointRef, commitOid],
        });
      }).pipe(
        Effect.ensuring(
          execute({
            operation,
            cwd: input.cwd,
            args: ["update-index", "--clear-resolve-undo"],
            env: {
              ...globalThis.process.env,
              GIT_INDEX_FILE: tempIndexPath,
            },
            allowNonZeroExit: true,
          }).pipe(Effect.ignore),
        ),
        Effect.ensuring(
          Effect.sync(() => fs.rmSync(tempIndexPath, { force: true })).pipe(Effect.ignore),
        ),
      );
    }),

    hasCheckpointRef: (input) =>
      resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
        Effect.map((commit) => commit !== null),
      ),

    restoreCheckpoint: Effect.fn("GitVcsDriver.checkpoints.restoreCheckpoint")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.restoreCheckpoint";

      let commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);

      if (!commitOid && input.fallbackToHead === true) {
        commitOid = yield* resolveHeadCommit(input.cwd);
      }

      if (!commitOid) {
        return false;
      }

      yield* execute({
        operation,
        cwd: input.cwd,
        args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
      });
      yield* execute({
        operation,
        cwd: input.cwd,
        args: ["clean", "-fd", "--", "."],
      });

      const headExists = yield* hasHeadCommit(input.cwd);
      if (headExists) {
        yield* execute({
          operation,
          cwd: input.cwd,
          args: ["reset", "--quiet", "--", "."],
        });
      }

      return true;
    }),

    diffCheckpoints: Effect.fn("GitVcsDriver.checkpoints.diffCheckpoints")(function* (input) {
      const operation = "GitVcsDriver.checkpoints.diffCheckpoints";

      let fromRevision = `${input.fromCheckpointRef}^{commit}`;
      if (input.fallbackFromToHead === true) {
        const resolvedFromCommit = yield* resolveCheckpointCommit(
          input.cwd,
          input.fromCheckpointRef,
        );
        if (resolvedFromCommit) {
          fromRevision = resolvedFromCommit;
        } else {
          const headCommit = yield* resolveHeadCommit(input.cwd);
          if (!headCommit) {
            return yield* gitProcessExitError(
              operation,
              input.cwd,
              "git diff",
              "Checkpoint ref is unavailable for diff operation.",
            );
          }
          fromRevision = headCommit;
        }
      }

      const result = yield* execute({
        operation,
        cwd: input.cwd,
        args: [
          "diff",
          "--patch",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          ...(input.ignoreWhitespace === true ? ["--ignore-all-space"] : []),
          fromRevision,
          `${input.toCheckpointRef}^{commit}`,
        ],
        allowNonZeroExit: true,
        maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
      });

      if (result.exitCode !== 0) {
        return yield* gitProcessExitError(
          operation,
          input.cwd,
          "git diff",
          result.stderr.trim() || "Checkpoint ref is unavailable for diff operation.",
          result.exitCode,
        );
      }

      return result.stdout;
    }),

    deleteCheckpointRefs: Effect.fn("GitVcsDriver.checkpoints.deleteCheckpointRefs")(
      function* (input) {
        yield* Effect.forEach(
          input.checkpointRefs,
          (checkpointRef) =>
            execute({
              operation: "GitVcsDriver.checkpoints.deleteCheckpointRefs",
              cwd: input.cwd,
              args: ["update-ref", "-d", checkpointRef],
              allowNonZeroExit: true,
            }),
          { discard: true },
        );
      },
    ),
  } satisfies NonNullable<VcsDriverShape["checkpoints"]>;

  const readGitRevisionFile = (
    cwd: string,
    ref: string,
    filePath: string,
  ): Effect.Effect<ReadDiffFileContentResult> =>
    gitCommand(
      "GitVcsDriver.reviewDiff.loadFile.readGitRevisionFile",
      cwd,
      ["show", formatGitObjectSpec(ref, filePath)],
      {
        allowNonZeroExit: true,
        maxOutputBytes: DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
      },
    ).pipe(
      Effect.map((result) => {
        if (result.stdoutTruncated) {
          return tooLargeDiffFile();
        }
        return result.exitCode === 0 ? loadedDiffFile(filePath, result.stdout) : missingDiffFile();
      }),
      Effect.catch(() => Effect.succeed(missingDiffFile())),
    );

  const readWorkingTreeFile = (
    cwd: string,
    filePath: string,
  ): Effect.Effect<ReadDiffFileContentResult> => {
    if (!isSafeRelativePath(cwd, filePath)) {
      return Effect.succeed(missingDiffFile());
    }

    const absolutePath = path.resolve(cwd, filePath);
    return Effect.tryPromise(async () => {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        return loadedDiffFile(filePath, await readlink(absolutePath));
      }
      if (!stats.isFile()) {
        return missingDiffFile();
      }
      if (stats.size > DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES) {
        return tooLargeDiffFile();
      }

      return loadedDiffFile(filePath, await readFile(absolutePath, "utf8"));
    }).pipe(Effect.catch(() => Effect.succeed(missingDiffFile())));
  };

  const readOldDiffFile = (
    input: LoadDiffFileInput,
    filePath: string,
  ): Effect.Effect<ReadDiffFileContentResult> => {
    switch (input.target.kind) {
      case "worktree":
        return readGitRevisionFile(input.cwd, "", filePath).pipe(
          Effect.flatMap((result) =>
            result.kind === "missing"
              ? readGitRevisionFile(input.cwd, "HEAD", filePath)
              : Effect.succeed(result),
          ),
        );
      case "staged":
        return readGitRevisionFile(input.cwd, "HEAD", filePath);
      case "range":
        return readGitRevisionFile(input.cwd, input.target.baseRef, filePath);
      case "commit":
        return input.target.parentRef === null
          ? Effect.succeed(missingDiffFile())
          : readGitRevisionFile(input.cwd, input.target.parentRef, filePath);
      case "stash":
        return readGitRevisionFile(input.cwd, `${input.target.ref}^`, filePath);
    }
  };

  const readNewDiffFile = (
    input: LoadDiffFileInput,
    filePath: string,
  ): Effect.Effect<ReadDiffFileContentResult> => {
    switch (input.target.kind) {
      case "worktree":
        return readWorkingTreeFile(input.cwd, filePath);
      case "staged":
        return readGitRevisionFile(input.cwd, "", filePath);
      case "range":
        return readGitRevisionFile(input.cwd, input.target.headRef, filePath);
      case "commit":
        return readGitRevisionFile(input.cwd, input.target.commitRef, filePath);
      case "stash":
        return readGitRevisionFile(input.cwd, input.target.ref, filePath);
    }
  };

  const reviewDiff = {
    loadFile: (input) =>
      Effect.gen(function* () {
        const oldPath = input.previousPath ?? input.path;
        const [patchResult, oldFileResult, newFileResult] = yield* Effect.all(
          [
            gitCommand(
              "GitVcsDriver.reviewDiff.loadFile.patch",
              input.cwd,
              buildDiffFilePatchArgs(input),
              {
                maxOutputBytes: DIFF_FILE_PATCH_MAX_OUTPUT_BYTES,
              },
            ),
            readOldDiffFile(input, oldPath),
            readNewDiffFile(input, input.path),
          ],
          { concurrency: "unbounded" },
        );
        const oldFile = oldFileResult.kind === "loaded" ? oldFileResult.content : null;
        const newFile = newFileResult.kind === "loaded" ? newFileResult.content : null;

        return {
          path: input.path,
          previousPath: input.previousPath,
          oldFile,
          newFile,
          patch: patchResult.stdoutTruncated ? "" : patchResult.stdout,
          patchTruncated: patchResult.stdoutTruncated,
          oldFileTooLarge: oldFileResult.kind === "too_large",
          newFileTooLarge: newFileResult.kind === "too_large",
        };
      }),

    loadFileIndex: (input) =>
      Effect.gen(function* () {
        const tracked = yield* gitCommand(
          "GitVcsDriver.reviewDiff.loadFileIndex",
          input.cwd,
          buildDiffArgs(input),
        ).pipe(Effect.map((result) => parseNumstat(result.stdout)));

        const files =
          input.target.kind === "worktree"
            ? yield* Effect.gen(function* () {
                const status = yield* gitCommand(
                  "GitVcsDriver.reviewDiff.loadFileIndex.untrackedStatus",
                  input.cwd,
                  buildUntrackedStatusArgs(),
                  {
                    maxOutputBytes: DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
                  },
                );

                if (status.stdoutTruncated) {
                  return tracked;
                }

                const trackedPaths = new Set(tracked.map((file) => file.path));
                const untrackedPaths = parseUntrackedStatusPaths(status.stdout).filter(
                  (filePath) => !trackedPaths.has(filePath),
                );
                const untracked = yield* Effect.tryPromise({
                  try: async () => {
                    const summaries = await Promise.all(
                      untrackedPaths.map((filePath) => summarizeUntrackedFile(input.cwd, filePath)),
                    );
                    return summaries.filter(
                      (summary): summary is GitDiffFileSummary => summary !== null,
                    );
                  },
                  catch: () =>
                    gitProcessExitError(
                      "GitVcsDriver.reviewDiff.loadFileIndex.untrackedSummaries",
                      input.cwd,
                      "git status",
                      "Failed to summarize untracked files.",
                      -1,
                    ),
                });

                return [...tracked, ...untracked];
              })
            : tracked;

        const patchResult = yield* gitCommand(
          "GitVcsDriver.reviewDiff.loadFileIndex.hunks",
          input.cwd,
          buildDiffPatchArgsForTarget(input),
          {
            allowNonZeroExit: true,
            maxOutputBytes: DIFF_FILE_PATCH_MAX_OUTPUT_BYTES,
          },
        );

        const hunkSummaries = patchResult.stdoutTruncated
          ? []
          : parsePatchHunkSummaries(patchResult.stdout);
        const hunksByPath = new Map(hunkSummaries.map((entry) => [entry.path, entry.hunks]));

        return files.map((file) => {
          const hunks = file.binary || file.isTooLarge ? [] : (hunksByPath.get(file.path) ?? []);
          return Object.assign({}, file, {
            hunkCount: hunks.length,
            hunks,
          });
        });
      }),

    loadChangeSignature: (input) =>
      Effect.gen(function* () {
        const result = yield* gitCommand(
          "GitVcsDriver.reviewDiff.loadChangeSignature.patch",
          input.cwd,
          buildDiffSignatureArgs(input),
          {
            allowNonZeroExit: true,
            maxOutputBytes: DIFF_FILE_PATCH_MAX_OUTPUT_BYTES,
          },
        );

        const parts = [
          input.target.kind,
          result.stdoutTruncated ? "patch:truncated" : result.stdout,
          result.stderr,
        ];

        if (input.target.kind === "worktree") {
          const status = yield* gitCommand(
            "GitVcsDriver.reviewDiff.loadChangeSignature.untrackedStatus",
            input.cwd,
            buildUntrackedStatusArgs(),
            {
              allowNonZeroExit: true,
              maxOutputBytes: DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES,
            },
          );
          const untrackedPaths = status.stdoutTruncated
            ? []
            : parseUntrackedStatusPaths(status.stdout);
          const signatures = yield* Effect.tryPromise({
            try: () =>
              Promise.all(
                untrackedPaths.map((filePath) => statSignature(path.resolve(input.cwd, filePath))),
              ),
            catch: () =>
              gitProcessExitError(
                "GitVcsDriver.reviewDiff.loadChangeSignature.untrackedStats",
                input.cwd,
                "git status",
                "Failed to stat untracked files.",
                -1,
              ),
          });
          parts.push(...signatures);
        }

        return { signature: sha256(parts.join("\n---\n")) };
      }),
  } satisfies NonNullable<VcsDriverShape["reviewDiff"]>;

  return GitVcsDriver.of({
    capabilities: {
      kind: "git",
      supportsWorktrees: true,
      supportsBookmarks: false,
      supportsAtomicSnapshot: false,
      supportsPushDefaultRemote: true,
      ignoreClassifier: "native",
    },
    execute,
    checkpoints,
    reviewDiff,
    detectRepository,
    isInsideWorkTree,
    listWorkspaceFiles,
    listRemotes,
    filterIgnoredPaths,
    initRepository,
  } satisfies VcsDriverShape);
});

export const GitVcsDriverLive = Layer.effect(GitVcsDriver, makeGitVcsDriver).pipe(
  Layer.provide(VcsProcessLive),
);
