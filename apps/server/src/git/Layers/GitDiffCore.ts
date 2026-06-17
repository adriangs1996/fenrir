import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { parseDiffFromFile } from "@pierre/diffs";
import {
  GitCommandError,
  type ChangeRequest,
  type GitDiffRepository,
  type GitDiffIgnoreList,
  type GitDiffPushResult,
  type GitDiffRepositoryOperation,
  type GitDiffSelectedLineRange,
  type GitDiffCommit,
  type GitDiffStash,
  type RevertGitDiffChangeRequestLinesInput,
  type SourceControlProviderError,
} from "@fenrir/contracts";
import type {
  GitDiffFileContent,
  GitDiffFileSummary,
  GitDiffStackStep,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadStackedDiffFileIndexInput,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import type {
  SourceControlProviderContext,
  SourceControlProviderShape,
} from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitDiffCore } from "../Services/GitDiffCore.ts";

const DIFF_FILE_CONTENT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DIFF_FILE_PATCH_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const HISTORY_MAX_OUTPUT_BYTES = 512 * 1024;
const STASH_LIST_MAX_OUTPUT_BYTES = 512 * 1024;
const ACTIVE_CHANGE_REQUEST_STACK_MAX_DEPTH = 32;
const GIT_EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_DIFF_IGNORE_LISTS_GIT_PATH = "info/fenrir-diff-ignore-lists.json";
const DEFAULT_REVERT_COMMIT_SUBJECT_MAX_LENGTH = 72;
const GIT_DIFF_REPOSITORY_SCAN_MAX_DEPTH = 5;
const GIT_DIFF_REPOSITORY_SCAN_EXCLUDED_DIRS = new Set([
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

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
  if (input.target.kind === "commit") {
    args.push(input.target.parentRef ?? GIT_EMPTY_TREE_SHA, input.target.commitRef);
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

function parseNulSeparatedPaths(stdout: string): ReadonlyArray<string> {
  return stdout
    .split("\0")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
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

function parseGitDiffHistory(stdout: string): ReadonlyArray<GitDiffCommit> {
  return stdout.split(/\r?\n/u).flatMap((line): GitDiffCommit[] => {
    if (line.trim().length === 0) return [];

    const [
      sha = "",
      shortSha = "",
      parentShas = "",
      authorName = "",
      authorEmail = "",
      authoredAt = "",
      subject = "",
    ] = line.split("\0");
    const normalizedSha = sha.trim();
    const normalizedShortSha = shortSha.trim();
    const normalizedAuthoredAt = authoredAt.trim();
    if (
      normalizedSha.length === 0 ||
      normalizedShortSha.length === 0 ||
      normalizedAuthoredAt.length === 0
    ) {
      return [];
    }

    const parentSha = parentShas.trim().split(/\s+/u).find(Boolean) ?? null;

    return [
      {
        sha: normalizedSha,
        shortSha: normalizedShortSha,
        parentSha,
        subject: subject.trim() || normalizedShortSha,
        authorName: authorName.trim() || "Unknown",
        authorEmail: authorEmail.trim() || "unknown",
        authoredAt: normalizedAuthoredAt,
      },
    ];
  });
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

function gitDiffCommandError(
  operation: string,
  cwd: string,
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation,
    command: "git diff",
    cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function shouldSkipRepositoryScanDirectory(name: string): boolean {
  return name === ".git" || GIT_DIFF_REPOSITORY_SCAN_EXCLUDED_DIRS.has(name);
}

async function hasGitMetadata(directoryPath: string): Promise<boolean> {
  try {
    const stats = await lstat(nodePath.join(directoryPath, ".git"));
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function toGitDiffRepository(workspaceCwd: string, repositoryCwd: string): GitDiffRepository {
  const relativePath = nodePath.relative(workspaceCwd, repositoryCwd).replace(/\\/g, "/");
  return {
    cwd: repositoryCwd,
    relativePath,
    name:
      relativePath.length === 0
        ? nodePath.basename(repositoryCwd)
        : nodePath.basename(relativePath),
    isWorkspaceRoot: relativePath.length === 0,
  };
}

async function discoverGitRepositories(
  workspaceCwd: string,
): Promise<ReadonlyArray<GitDiffRepository>> {
  const root = nodePath.resolve(workspaceCwd);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${workspaceCwd}`);
  }

  const repositoriesByCwd = new Map<string, GitDiffRepository>();

  const addRepository = (repositoryCwd: string) => {
    const normalizedCwd = nodePath.resolve(repositoryCwd);
    repositoriesByCwd.set(normalizedCwd, toGitDiffRepository(root, normalizedCwd));
  };

  if (await hasGitMetadata(root)) {
    addRepository(root);
  }

  const walk = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth >= GIT_DIFF_REPOSITORY_SCAN_MAX_DEPTH) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipRepositoryScanDirectory(entry.name)) {
        continue;
      }

      const childPath = nodePath.join(directoryPath, entry.name);
      if (await hasGitMetadata(childPath)) {
        addRepository(childPath);
      }

      await walk(childPath, depth + 1);
    }
  };

  await walk(root, 0);

  return [...repositoriesByCwd.values()].toSorted((left, right) => {
    if (left.isWorkspaceRoot !== right.isWorkspaceRoot) {
      return left.isWorkspaceRoot ? -1 : 1;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function toGitDiffProviderError(
  operation: string,
  cwd: string,
  error: SourceControlProviderError,
): GitCommandError {
  return gitDiffCommandError(operation, cwd, error.detail, error);
}

function isMainlineRef(refName: string, defaultBranch: string | null): boolean {
  return refName === "main" || refName === "master" || refName === defaultBranch;
}

function selectChangeRequestForHead(
  changeRequests: ReadonlyArray<ChangeRequest>,
  headRefName: string,
): ChangeRequest | null {
  return (
    changeRequests.find(
      (changeRequest) =>
        changeRequest.state === "open" && changeRequest.headRefName === headRefName,
    ) ??
    changeRequests.find((changeRequest) => changeRequest.state === "open") ??
    null
  );
}

function noActiveChangeRequestStack(input: { readonly headRef: string | null }): {
  readonly activeChangeRequest: null;
  readonly baseRef: null;
  readonly headRef: string | null;
  readonly steps: readonly GitDiffStackStep[];
} {
  return {
    activeChangeRequest: null,
    baseRef: null,
    headRef: input.headRef,
    steps: [],
  };
}

function sanitizeIgnoreListId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "ignore-list"}-${randomUUID().slice(0, 8)}`;
}

function normalizeRelativePath(cwd: string, filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.length === 0 || !isSafeRelativePath(cwd, normalized)) {
    throw gitDiffCommandError(
      "GitDiffCore.normalizeRelativePath",
      cwd,
      `Unsafe relative path: ${filePath}`,
    );
  }
  return normalized;
}

function normalizeRelativePaths(
  cwd: string,
  filePaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [...new Set(filePaths.map((filePath) => normalizeRelativePath(cwd, filePath)))].toSorted(
    (left, right) => left.localeCompare(right),
  );
}

function normalizeStashRef(cwd: string, ref: string): string {
  const trimmed = ref.trim();
  if (trimmed.length === 0 || trimmed.startsWith("-") || trimmed.includes("\0")) {
    throw gitDiffCommandError("GitDiffCore.normalizeStashRef", cwd, `Unsafe stash ref: ${ref}`);
  }
  return trimmed;
}

function normalizeCommitRef(cwd: string, ref: string): string {
  const trimmed = ref.trim();
  if (trimmed.length === 0 || trimmed.startsWith("-") || trimmed.includes("\0")) {
    throw gitDiffCommandError("GitDiffCore.normalizeCommitRef", cwd, `Unsafe commit ref: ${ref}`);
  }
  return trimmed;
}

function gitDiffOperationLabel(kind: GitDiffRepositoryOperation["kind"]): string {
  switch (kind) {
    case "merge":
      return "Merge in progress";
    case "rebase":
      return "Rebase in progress";
    case "cherry_pick":
      return "Cherry-pick in progress";
    case "revert":
      return "Revert in progress";
  }
}

function operationHeadPath(kind: GitDiffRepositoryOperation["kind"]): string | null {
  switch (kind) {
    case "merge":
      return "MERGE_HEAD";
    case "cherry_pick":
      return "CHERRY_PICK_HEAD";
    case "revert":
      return "REVERT_HEAD";
    case "rebase":
      return null;
  }
}

function continueOperationArgs(kind: GitDiffRepositoryOperation["kind"]): ReadonlyArray<string> {
  switch (kind) {
    case "merge":
      return ["merge", "--continue"];
    case "rebase":
      return ["rebase", "--continue"];
    case "cherry_pick":
      return ["cherry-pick", "--continue"];
    case "revert":
      return ["revert", "--continue"];
  }
}

function abortOperationArgs(kind: GitDiffRepositoryOperation["kind"]): ReadonlyArray<string> {
  switch (kind) {
    case "merge":
      return ["merge", "--abort"];
    case "rebase":
      return ["rebase", "--abort"];
    case "cherry_pick":
      return ["cherry-pick", "--abort"];
    case "revert":
      return ["revert", "--abort"];
  }
}

function isMissingFileSystemPath(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    String(cause.code) === "ENOENT"
  );
}

function parseIgnoreLists(raw: string): ReadonlyArray<GitDiffIgnoreList> {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item): GitDiffIgnoreList[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const id = "id" in item && typeof item.id === "string" ? item.id.trim() : "";
    const name = "name" in item && typeof item.name === "string" ? item.name.trim() : "";
    const rawFilePaths: unknown[] =
      "filePaths" in item && Array.isArray(item.filePaths) ? item.filePaths : [];
    if (id.length === 0 || name.length === 0) {
      return [];
    }
    return [
      {
        id,
        name,
        filePaths: rawFilePaths
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim())
          .toSorted((left, right) => left.localeCompare(right)),
      },
    ];
  });
}

function parseStashBranchName(subject: string): string | null {
  const match = /^(?:WIP on|On) ([^:]+):/u.exec(subject.trim());
  const branchName = match?.[1]?.trim();
  return branchName && branchName.length > 0 ? branchName : null;
}

function parseStashMessage(subject: string): string {
  const trimmed = subject.trim();
  const message = trimmed.replace(/^(?:WIP on|On) [^:]+:\s*/u, "").trim();
  return message.length > 0 ? message : trimmed || "Stash";
}

function parseStashList(stdout: string): ReadonlyArray<GitDiffStash> {
  return stdout.split(/\r?\n/u).flatMap((line): GitDiffStash[] => {
    if (line.trim().length === 0) return [];

    const [ref = "", sha = "", createdAt = "", subject = ""] = line.split("\0");
    const stashRef = ref.trim();
    const stashSha = sha.trim();
    const stashCreatedAt = createdAt.trim();
    const branchName = parseStashBranchName(subject);
    if (stashRef.length === 0 || stashSha.length === 0 || stashCreatedAt.length === 0) {
      return [];
    }

    return [
      {
        ref: stashRef,
        sha: stashSha,
        message: parseStashMessage(subject),
        createdAt: stashCreatedAt,
        ...(branchName ? { branchName } : {}),
      },
    ];
  });
}

function splitPreservingLineEndings(contents: string): string[] {
  if (contents.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let start = 0;
  while (start < contents.length) {
    const newlineIndex = contents.indexOf("\n", start);
    if (newlineIndex === -1) {
      lines.push(contents.slice(start));
      break;
    }
    lines.push(contents.slice(start, newlineIndex + 1));
    start = newlineIndex + 1;
  }
  return lines;
}

function normalizeSelection(selection: GitDiffSelectedLineRange): GitDiffSelectedLineRange {
  return selection.start <= selection.end
    ? selection
    : { side: selection.side, start: selection.end, end: selection.start };
}

function shortenCommitSubject(subject: string): string {
  const normalized = subject.replace(/\s+/g, " ").trim();
  if (normalized.length <= DEFAULT_REVERT_COMMIT_SUBJECT_MAX_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, DEFAULT_REVERT_COMMIT_SUBJECT_MAX_LENGTH - 1).trimEnd();
}

function refMatchesBranch(ref: string, branch: string): boolean {
  const trimmed = ref.trim();
  return (
    trimmed === branch ||
    trimmed === `refs/heads/${branch}` ||
    trimmed.endsWith(`/${branch}`) ||
    trimmed.endsWith(`/heads/${branch}`)
  );
}

function resolveDeletedLineInsertionIndex(input: {
  readonly oldPath: string;
  readonly newPath: string;
  readonly oldContents: string;
  readonly newContents: string;
  readonly selection: GitDiffSelectedLineRange;
}): number {
  const diff = parseDiffFromFile(
    { name: input.oldPath, contents: input.oldContents },
    { name: input.newPath, contents: input.newContents },
  );
  const selection = normalizeSelection(input.selection);

  for (const hunk of diff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        continue;
      }
      const deletionStart = hunk.deletionStart + content.deletionLineIndex - hunk.deletionLineIndex;
      const deletionEnd = deletionStart + content.deletions - 1;
      if (selection.start <= deletionEnd && selection.end >= deletionStart) {
        const additionStart =
          hunk.additionStart + content.additionLineIndex - hunk.additionLineIndex;
        return Math.max(0, additionStart - 1);
      }
    }
  }

  return Math.max(0, selection.start - 1);
}

function revertSelectedLines(input: {
  readonly oldPath: string;
  readonly newPath: string;
  readonly oldContents: string;
  readonly newContents: string;
  readonly selection: GitDiffSelectedLineRange;
}): string {
  const selection = normalizeSelection(input.selection);
  const oldLines = splitPreservingLineEndings(input.oldContents);
  const newLines = splitPreservingLineEndings(input.newContents);

  if (selection.side === "additions") {
    const startIndex = selection.start - 1;
    const endIndex = selection.end;
    if (startIndex < 0 || endIndex > newLines.length) {
      throw new Error("Selected added lines are outside the current file.");
    }
    return [...newLines.slice(0, startIndex), ...newLines.slice(endIndex)].join("");
  }

  const selectedOldLines = oldLines.slice(selection.start - 1, selection.end);
  if (selectedOldLines.length === 0) {
    throw new Error("Selected deleted lines are outside the base file.");
  }
  const insertionIndex = resolveDeletedLineInsertionIndex({
    oldPath: input.oldPath,
    newPath: input.newPath,
    oldContents: input.oldContents,
    newContents: input.newContents,
    selection,
  });
  return [
    ...newLines.slice(0, insertionIndex),
    ...selectedOldLines,
    ...newLines.slice(insertionIndex),
  ].join("");
}

export const GitDiffCoreLive = Layer.effect(
  GitDiffCore,
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const sourceControlProviderRegistry = yield* SourceControlProviderRegistry;
    const listRepositories = (input: { readonly workspaceCwd: string }) =>
      Effect.tryPromise({
        try: () => discoverGitRepositories(input.workspaceCwd),
        catch: (cause) =>
          gitDiffCommandError(
            "GitDiffCore.listRepositories",
            input.workspaceCwd,
            "Failed to discover workspace git repositories.",
            cause,
          ),
      });

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
        case "commit":
          return input.target.parentRef === null
            ? Effect.succeed(null)
            : readGitRevisionFile(input.cwd, input.target.parentRef, filePath);
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
        case "commit":
          return readGitRevisionFile(input.cwd, input.target.commitRef, filePath);
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

    const loadHistory = (input: { readonly cwd: string; readonly limit?: number }) =>
      Effect.gen(function* () {
        const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
        const result = yield* gitCore.execute({
          operation: "GitDiffCore.loadHistory",
          cwd: input.cwd,
          args: [
            "log",
            `--max-count=${limit}`,
            "--date=iso-strict",
            "--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s",
          ],
          allowNonZeroExit: true,
          maxOutputBytes: HISTORY_MAX_OUTPUT_BYTES,
          truncateOutputAtMaxBytes: true,
        });
        if (result.stdoutTruncated) {
          return yield* gitDiffCommandError(
            "GitDiffCore.loadHistory",
            input.cwd,
            "Commit history output exceeded the maximum supported size.",
          );
        }
        if (result.code !== 0) {
          const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
          if (
            output.includes("does not have any commits") ||
            output.includes("your current branch") ||
            output.includes("unknown revision")
          ) {
            return [];
          }
          return yield* gitDiffCommandError(
            "GitDiffCore.loadHistory",
            input.cwd,
            result.stderr.trim() || result.stdout.trim() || "Failed to load commit history.",
          );
        }

        return parseGitDiffHistory(result.stdout);
      });

    const resolveIgnoreListsPath = (cwd: string) =>
      gitCore
        .execute({
          operation: "GitDiffCore.resolveIgnoreListsPath",
          cwd,
          args: ["rev-parse", "--git-path", GIT_DIFF_IGNORE_LISTS_GIT_PATH],
        })
        .pipe(
          Effect.map((result) => {
            const resolved = result.stdout.trim();
            return nodePath.isAbsolute(resolved) ? resolved : nodePath.resolve(cwd, resolved);
          }),
        );

    const writeIgnoreLists = (
      cwd: string,
      lists: ReadonlyArray<GitDiffIgnoreList>,
    ): Effect.Effect<ReadonlyArray<GitDiffIgnoreList>, GitCommandError> =>
      Effect.gen(function* () {
        const path = yield* resolveIgnoreListsPath(cwd);
        const normalizedLists = lists
          .map((list) => ({
            id: list.id.trim(),
            name: list.name.trim(),
            filePaths: normalizeRelativePaths(cwd, list.filePaths),
          }))
          .filter((list) => list.id.length > 0 && list.name.length > 0)
          .toSorted((left, right) => left.name.localeCompare(right.name));

        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(nodePath.dirname(path), { recursive: true });
            await writeFile(path, `${JSON.stringify(normalizedLists, null, 2)}\n`, "utf8");
          },
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.writeIgnoreLists",
              cwd,
              "Failed to write git diff ignore lists.",
              cause,
            ),
        });

        return normalizedLists;
      });

    const loadIgnoreLists = (input: { readonly cwd: string }) =>
      Effect.gen(function* () {
        const path = yield* resolveIgnoreListsPath(input.cwd);
        const raw = yield* Effect.tryPromise({
          try: async () => {
            try {
              return await readFile(path, "utf8");
            } catch (cause) {
              const code =
                typeof cause === "object" && cause !== null && "code" in cause
                  ? String(cause.code)
                  : "";
              if (code === "ENOENT") {
                return "[]";
              }
              throw cause;
            }
          },
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.loadIgnoreLists",
              input.cwd,
              "Failed to read git diff ignore lists.",
              cause,
            ),
        });

        return parseIgnoreLists(raw)
          .map((list) => ({
            id: list.id,
            name: list.name,
            filePaths: normalizeRelativePaths(input.cwd, list.filePaths),
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name));
      });

    const createIgnoreList = (input: { readonly cwd: string; readonly name: string }) =>
      Effect.gen(function* () {
        const existing = yield* loadIgnoreLists(input);
        return yield* writeIgnoreLists(input.cwd, [
          ...existing,
          {
            id: sanitizeIgnoreListId(input.name),
            name: input.name.trim(),
            filePaths: [],
          },
        ]);
      });

    const updateIgnoreList = (input: {
      readonly cwd: string;
      readonly id: string;
      readonly name?: string;
      readonly filePaths?: ReadonlyArray<string>;
    }) =>
      Effect.gen(function* () {
        const existing = yield* loadIgnoreLists(input);
        let found = false;
        const next = existing.map((list) => {
          if (list.id !== input.id) {
            return list;
          }
          found = true;
          return {
            id: list.id,
            name: input.name !== undefined ? input.name.trim() : list.name,
            filePaths:
              input.filePaths !== undefined
                ? normalizeRelativePaths(input.cwd, input.filePaths)
                : list.filePaths,
          };
        });
        if (!found) {
          return yield* gitDiffCommandError(
            "GitDiffCore.updateIgnoreList",
            input.cwd,
            `Ignore list '${input.id}' does not exist.`,
          );
        }
        return yield* writeIgnoreLists(input.cwd, next);
      });

    const deleteIgnoreList = (input: { readonly cwd: string; readonly id: string }) =>
      Effect.gen(function* () {
        const existing = yield* loadIgnoreLists(input);
        return yield* writeIgnoreLists(
          input.cwd,
          existing.filter((list) => list.id !== input.id),
        );
      });

    const stageWorktreeChanges = (input: {
      readonly cwd: string;
      readonly filePaths: ReadonlyArray<string>;
      readonly ignoredFilePaths: ReadonlyArray<string>;
    }) =>
      Effect.gen(function* () {
        const ignoredFilePaths = normalizeRelativePaths(input.cwd, input.ignoredFilePaths);
        const ignoredSet = new Set(ignoredFilePaths);
        const stagedFilePaths = normalizeRelativePaths(input.cwd, input.filePaths).filter(
          (filePath) => !ignoredSet.has(filePath),
        );

        if (ignoredFilePaths.length > 0) {
          yield* gitCore
            .execute({
              operation: "GitDiffCore.stageWorktreeChanges.unstageIgnored",
              cwd: input.cwd,
              args: ["reset", "--", ...ignoredFilePaths],
              allowNonZeroExit: true,
            })
            .pipe(Effect.asVoid);
        }
        if (stagedFilePaths.length > 0) {
          yield* gitCore
            .execute({
              operation: "GitDiffCore.stageWorktreeChanges.stage",
              cwd: input.cwd,
              args: ["add", "-A", "--", ...stagedFilePaths],
            })
            .pipe(Effect.asVoid);
        }

        return {
          stagedFilePaths,
          ignoredFilePaths,
        };
      });

    const unstageStagedChanges = (input: {
      readonly cwd: string;
      readonly filePaths: ReadonlyArray<string>;
    }) =>
      Effect.gen(function* () {
        const unstagedFilePaths = normalizeRelativePaths(input.cwd, input.filePaths);
        if (unstagedFilePaths.length > 0) {
          yield* gitCore
            .execute({
              operation: "GitDiffCore.unstageStagedChanges",
              cwd: input.cwd,
              args: ["reset", "--", ...unstagedFilePaths],
            })
            .pipe(Effect.asVoid);
        }

        return {
          unstagedFilePaths,
        };
      });

    const discardWorktreeChanges = (input: {
      readonly cwd: string;
      readonly filePaths: ReadonlyArray<string>;
    }) =>
      Effect.gen(function* () {
        const discardedFilePaths = normalizeRelativePaths(input.cwd, input.filePaths);
        if (discardedFilePaths.length > 0) {
          yield* gitCore
            .execute({
              operation: "GitDiffCore.discardWorktreeChanges.restore",
              cwd: input.cwd,
              args: ["restore", "--worktree", "--", ...discardedFilePaths],
              allowNonZeroExit: true,
            })
            .pipe(Effect.asVoid);
          yield* gitCore
            .execute({
              operation: "GitDiffCore.discardWorktreeChanges.clean",
              cwd: input.cwd,
              args: ["clean", "-fd", "--", ...discardedFilePaths],
              allowNonZeroExit: true,
            })
            .pipe(Effect.asVoid);
        }

        return {
          discardedFilePaths,
        };
      });

    const amendStagedChanges = (input: {
      readonly cwd: string;
      readonly filePaths?: ReadonlyArray<string>;
      readonly commitMessage?: string;
    }) =>
      Effect.gen(function* () {
        const headResult = yield* gitCore.execute({
          operation: "GitDiffCore.amendStagedChanges.hasHead",
          cwd: input.cwd,
          args: ["rev-parse", "--verify", "HEAD"],
          allowNonZeroExit: true,
        });
        if (headResult.code !== 0) {
          return yield* new GitCommandError({
            operation: "GitDiffCore.amendStagedChanges",
            command: "git commit --amend",
            cwd: input.cwd,
            detail: "Cannot amend before the repository has an initial commit.",
          });
        }

        const filePaths =
          input.filePaths === undefined ? [] : normalizeRelativePaths(input.cwd, input.filePaths);
        if (filePaths.length > 0) {
          yield* gitCore
            .execute({
              operation: "GitDiffCore.amendStagedChanges.reset",
              cwd: input.cwd,
              args: ["reset"],
            })
            .pipe(Effect.asVoid);
          yield* gitCore
            .execute({
              operation: "GitDiffCore.amendStagedChanges.addSelected",
              cwd: input.cwd,
              args: ["add", "-A", "--", ...filePaths],
            })
            .pipe(Effect.asVoid);
        }

        const stagedResult = yield* gitCore.execute({
          operation: "GitDiffCore.amendStagedChanges.hasStagedChanges",
          cwd: input.cwd,
          args: ["diff", "--cached", "--quiet", "--exit-code"],
          allowNonZeroExit: true,
        });
        if (stagedResult.code === 0) {
          return yield* new GitCommandError({
            operation: "GitDiffCore.amendStagedChanges",
            command: "git commit --amend",
            cwd: input.cwd,
            detail: "No staged changes to amend.",
          });
        }
        if (stagedResult.code !== 1) {
          return yield* new GitCommandError({
            operation: "GitDiffCore.amendStagedChanges",
            command: "git diff --cached --quiet --exit-code",
            cwd: input.cwd,
            detail:
              stagedResult.stderr.trim() ||
              stagedResult.stdout.trim() ||
              "Failed to inspect staged changes.",
          });
        }

        const message = input.commitMessage?.trim();
        yield* gitCore
          .execute({
            operation: "GitDiffCore.amendStagedChanges.commit",
            cwd: input.cwd,
            args:
              message && message.length > 0
                ? ["commit", "--amend", "-F", "-"]
                : ["commit", "--amend", "--no-edit"],
            ...(message && message.length > 0 ? { stdin: `${message}\n` } : {}),
          })
          .pipe(Effect.asVoid);

        const commitSha = yield* gitCore
          .execute({
            operation: "GitDiffCore.amendStagedChanges.revParseHead",
            cwd: input.cwd,
            args: ["rev-parse", "HEAD"],
          })
          .pipe(Effect.map((result) => result.stdout.trim()));

        return { commitSha };
      });

    const readHeadSha = (cwd: string, operation: string) =>
      gitCore
        .execute({
          operation,
          cwd,
          args: ["rev-parse", "HEAD"],
        })
        .pipe(Effect.map((result) => result.stdout.trim()));

    const revertCommit = (input: { readonly cwd: string; readonly commitRef: string }) =>
      Effect.gen(function* () {
        const commitRef = normalizeCommitRef(input.cwd, input.commitRef);
        yield* gitCore
          .execute({
            operation: "GitDiffCore.revertCommit",
            cwd: input.cwd,
            args: ["revert", "--no-edit", commitRef],
          })
          .pipe(Effect.asVoid);

        return {
          commitSha: yield* readHeadSha(input.cwd, "GitDiffCore.revertCommit.revParseHead"),
        };
      });

    const cherryPickCommit = (input: { readonly cwd: string; readonly commitRef: string }) =>
      Effect.gen(function* () {
        const commitRef = normalizeCommitRef(input.cwd, input.commitRef);
        yield* gitCore
          .execute({
            operation: "GitDiffCore.cherryPickCommit",
            cwd: input.cwd,
            args: ["cherry-pick", commitRef],
          })
          .pipe(Effect.asVoid);

        return {
          commitSha: yield* readHeadSha(input.cwd, "GitDiffCore.cherryPickCommit.revParseHead"),
        };
      });

    const resolveGitPath = (cwd: string, pathSpec: string) =>
      gitCore
        .execute({
          operation: "GitDiffCore.resolveGitPath",
          cwd,
          args: ["rev-parse", "--git-path", pathSpec],
        })
        .pipe(
          Effect.map((result) => {
            const resolvedPath = result.stdout.trim();
            return nodePath.isAbsolute(resolvedPath)
              ? resolvedPath
              : nodePath.resolve(cwd, resolvedPath);
          }),
        );

    const gitPathExists = (cwd: string, pathSpec: string) =>
      Effect.gen(function* () {
        const resolvedPath = yield* resolveGitPath(cwd, pathSpec);
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              await lstat(resolvedPath);
              return true;
            } catch (cause) {
              if (isMissingFileSystemPath(cause)) {
                return false;
              }
              throw cause;
            }
          },
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.gitPathExists",
              cwd,
              `Failed to inspect git state path ${pathSpec}.`,
              cause,
            ),
        });
      });

    const readGitPathText = (cwd: string, pathSpec: string) =>
      Effect.gen(function* () {
        const resolvedPath = yield* resolveGitPath(cwd, pathSpec);
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              return (await readFile(resolvedPath, "utf8")).trim() || null;
            } catch (cause) {
              if (isMissingFileSystemPath(cause)) {
                return null;
              }
              throw cause;
            }
          },
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.readGitPathText",
              cwd,
              `Failed to read git state path ${pathSpec}.`,
              cause,
            ),
        });
      });

    const loadConflictedFilePaths = (cwd: string) =>
      gitCore
        .execute({
          operation: "GitDiffCore.loadConflictedFilePaths",
          cwd,
          args: ["diff", "--name-only", "--diff-filter=U", "-z"],
        })
        .pipe(Effect.map((result) => parseNulSeparatedPaths(result.stdout)));

    const detectOperationKind = (cwd: string) =>
      Effect.gen(function* () {
        const [rebaseMerge, rebaseApply, cherryPick, revert, merge] = yield* Effect.all([
          gitPathExists(cwd, "rebase-merge"),
          gitPathExists(cwd, "rebase-apply"),
          gitPathExists(cwd, "CHERRY_PICK_HEAD"),
          gitPathExists(cwd, "REVERT_HEAD"),
          gitPathExists(cwd, "MERGE_HEAD"),
        ]);

        if (rebaseMerge || rebaseApply) return "rebase" as const;
        if (cherryPick) return "cherry_pick" as const;
        if (revert) return "revert" as const;
        if (merge) return "merge" as const;
        return null;
      });

    const loadOperation = (input: { readonly cwd: string }) =>
      Effect.gen(function* () {
        const kind = yield* detectOperationKind(input.cwd);
        if (kind === null) {
          return { operation: null };
        }

        const headPath = operationHeadPath(kind);
        const headRef = headPath === null ? null : yield* readGitPathText(input.cwd, headPath);
        const conflictedFilePaths = yield* loadConflictedFilePaths(input.cwd);

        return {
          operation: {
            kind,
            label: gitDiffOperationLabel(kind),
            headRef,
            conflictedFilePaths,
          },
        };
      });

    const continueOperation = (input: { readonly cwd: string }) =>
      Effect.gen(function* () {
        const kind = yield* detectOperationKind(input.cwd);
        if (kind === null) {
          return yield* gitDiffCommandError(
            "GitDiffCore.continueOperation",
            input.cwd,
            "No Git operation is in progress.",
          );
        }

        yield* gitCore
          .execute({
            operation: "GitDiffCore.continueOperation",
            cwd: input.cwd,
            args: continueOperationArgs(kind),
            env: {
              GIT_EDITOR: "true",
              GIT_SEQUENCE_EDITOR: "true",
            },
          })
          .pipe(Effect.asVoid);

        return {
          status: "ok" as const,
          commitSha: yield* readHeadSha(input.cwd, "GitDiffCore.continueOperation.revParseHead"),
        };
      });

    const abortOperation = (input: { readonly cwd: string }) =>
      Effect.gen(function* () {
        const kind = yield* detectOperationKind(input.cwd);
        if (kind === null) {
          return yield* gitDiffCommandError(
            "GitDiffCore.abortOperation",
            input.cwd,
            "No Git operation is in progress.",
          );
        }

        yield* gitCore
          .execute({
            operation: "GitDiffCore.abortOperation",
            cwd: input.cwd,
            args: abortOperationArgs(kind),
            env: {
              GIT_EDITOR: "true",
              GIT_SEQUENCE_EDITOR: "true",
            },
          })
          .pipe(Effect.asVoid);

        return {
          status: "ok" as const,
          commitSha: null,
        };
      });

    const loadStashes = (input: { readonly cwd: string }) =>
      gitCore
        .execute({
          operation: "GitDiffCore.loadStashes",
          cwd: input.cwd,
          args: ["stash", "list", "--format=%gd%x00%H%x00%ci%x00%gs"],
          maxOutputBytes: STASH_LIST_MAX_OUTPUT_BYTES,
          truncateOutputAtMaxBytes: true,
        })
        .pipe(
          Effect.flatMap((result) =>
            result.stdoutTruncated
              ? Effect.fail(
                  gitDiffCommandError(
                    "GitDiffCore.loadStashes",
                    input.cwd,
                    "Stash list output exceeded the maximum supported size.",
                  ),
                )
              : Effect.succeed(parseStashList(result.stdout)),
          ),
        );

    const createStash = (input: {
      readonly cwd: string;
      readonly message?: string;
      readonly filePaths?: ReadonlyArray<string>;
    }) =>
      Effect.gen(function* () {
        const filePaths =
          input.filePaths === undefined ? [] : normalizeRelativePaths(input.cwd, input.filePaths);
        const message = input.message?.trim() || "Fenrir stash";
        const result = yield* gitCore.execute({
          operation: "GitDiffCore.createStash",
          cwd: input.cwd,
          args: [
            "stash",
            "push",
            "--include-untracked",
            "-m",
            message,
            ...(filePaths.length > 0 ? ["--", ...filePaths] : []),
          ],
          allowNonZeroExit: true,
        });
        const output = `${result.stdout}\n${result.stderr}`;
        const noChanges = output.includes("No local changes to save");
        if (result.code !== 0 && !noChanges) {
          return yield* gitDiffCommandError(
            "GitDiffCore.createStash",
            input.cwd,
            result.stderr.trim() || result.stdout.trim() || "Failed to create stash.",
          );
        }
        if (noChanges) {
          return {
            status: "skipped_no_changes" as const,
            stash: null,
          };
        }

        const stashes = yield* loadStashes({ cwd: input.cwd });
        return {
          status: "stashed" as const,
          stash: stashes[0] ?? null,
        };
      });

    const applyStash = (input: { readonly cwd: string; readonly ref: string }) =>
      gitCore
        .execute({
          operation: "GitDiffCore.applyStash",
          cwd: input.cwd,
          args: ["stash", "apply", "--index", normalizeStashRef(input.cwd, input.ref)],
        })
        .pipe(Effect.as({ status: "ok" as const }));

    const popStash = (input: { readonly cwd: string; readonly ref: string }) =>
      gitCore
        .execute({
          operation: "GitDiffCore.popStash",
          cwd: input.cwd,
          args: ["stash", "pop", "--index", normalizeStashRef(input.cwd, input.ref)],
        })
        .pipe(Effect.as({ status: "ok" as const }));

    const dropStash = (input: { readonly cwd: string; readonly ref: string }) =>
      gitCore
        .execute({
          operation: "GitDiffCore.dropStash",
          cwd: input.cwd,
          args: ["stash", "drop", normalizeStashRef(input.cwd, input.ref)],
        })
        .pipe(Effect.as({ status: "ok" as const }));

    const resolveProviderHandle = (cwd: string, operation: string) =>
      sourceControlProviderRegistry.resolveHandle({ cwd }).pipe(
        Effect.mapError((error) => toGitDiffProviderError(operation, cwd, error)),
        Effect.flatMap((handle) =>
          handle.provider.kind === "unknown"
            ? Effect.fail(
                gitDiffCommandError(operation, cwd, "No source control provider is configured."),
              )
            : Effect.succeed(handle),
        ),
      );

    const providerAction = <A>(
      cwd: string,
      operation: string,
      run: (
        provider: SourceControlProviderShape,
        context: SourceControlProviderContext | null,
      ) => Effect.Effect<A, SourceControlProviderError>,
    ) =>
      Effect.gen(function* () {
        const handle = yield* resolveProviderHandle(cwd, operation);
        return yield* run(handle.provider, handle.context).pipe(
          Effect.mapError((error) => toGitDiffProviderError(operation, cwd, error)),
        );
      });

    const closeChangeRequest = (input: { readonly cwd: string; readonly reference: string }) =>
      providerAction(input.cwd, "GitDiffCore.closeChangeRequest", (provider, context) =>
        provider
          .closeChangeRequest({
            cwd: input.cwd,
            reference: input.reference,
            ...(context ? { context } : {}),
          })
          .pipe(Effect.as({ status: "ok" as const })),
      );

    const mergeChangeRequest = (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly method?: "merge" | "squash" | "rebase";
    }) =>
      providerAction(input.cwd, "GitDiffCore.mergeChangeRequest", (provider, context) =>
        provider
          .mergeChangeRequest({
            cwd: input.cwd,
            reference: input.reference,
            method: input.method ?? "squash",
            ...(context ? { context } : {}),
          })
          .pipe(Effect.as({ status: "ok" as const })),
      );

    const loadChangeRequestChecks = (input: { readonly cwd: string; readonly reference: string }) =>
      providerAction(input.cwd, "GitDiffCore.loadChangeRequestChecks", (provider, context) =>
        provider.listChangeRequestChecks({
          cwd: input.cwd,
          reference: input.reference,
          ...(context ? { context } : {}),
        }),
      );

    const loadChangeRequestReviewThreads = (input: {
      readonly cwd: string;
      readonly reference: string;
    }) =>
      providerAction(input.cwd, "GitDiffCore.loadChangeRequestReviewThreads", (provider, context) =>
        provider.listChangeRequestReviewThreads({
          cwd: input.cwd,
          reference: input.reference,
          ...(context ? { context } : {}),
        }),
      );

    const commentChangeRequestLines = (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly path: string;
      readonly body: string;
      readonly side: "additions" | "deletions";
      readonly line: number;
      readonly startLine?: number;
    }) =>
      providerAction(input.cwd, "GitDiffCore.commentChangeRequestLines", (provider, context) =>
        provider
          .createChangeRequestLineComment({
            cwd: input.cwd,
            reference: input.reference,
            path: normalizeRelativePath(input.cwd, input.path),
            body: input.body.trim(),
            side: input.side,
            line: input.line,
            ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
            ...(context ? { context } : {}),
          })
          .pipe(Effect.as({ status: "ok" as const })),
      );

    const revertChangeRequestLines = (input: RevertGitDiffChangeRequestLinesInput) =>
      Effect.gen(function* () {
        const path = normalizeRelativePath(input.cwd, input.path);
        const previousPath =
          input.previousPath === null ? null : normalizeRelativePath(input.cwd, input.previousPath);
        const status = yield* gitCore.statusDetailsLocal(input.cwd);
        if (status.branch === null) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            "Cannot revert selected PR lines from detached HEAD.",
          );
        }
        if (!refMatchesBranch(input.headRef, status.branch)) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            `Cannot revert selected PR lines because the local branch '${status.branch}' does not match '${input.headRef}'.`,
          );
        }
        if (status.hasWorkingTreeChanges) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            "Cannot revert selected PR lines while the worktree has local changes.",
          );
        }

        const oldPath = previousPath ?? path;
        const [oldFile, newFile] = yield* Effect.all(
          [
            readGitRevisionFile(input.cwd, input.baseRef, oldPath),
            readGitRevisionFile(input.cwd, input.headRef, path),
          ],
          { concurrency: "unbounded" },
        );
        const oldContents = oldFile?.contents ?? "";
        const newContents = newFile?.contents ?? "";

        if (input.selection.side === "deletions" && oldFile === null) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            "Cannot revert deleted lines because the base file could not be read.",
          );
        }
        if (input.selection.side === "additions" && newFile === null) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            "Cannot revert added lines because the PR file could not be read.",
          );
        }

        const nextContents = yield* Effect.try({
          try: () =>
            revertSelectedLines({
              oldPath,
              newPath: path,
              oldContents,
              newContents,
              selection: input.selection,
            }),
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.revertChangeRequestLines",
              input.cwd,
              cause instanceof Error
                ? cause.message
                : "Failed to apply the selected PR line revert.",
              cause,
            ),
        });
        if (nextContents === newContents) {
          return yield* gitDiffCommandError(
            "GitDiffCore.revertChangeRequestLines",
            input.cwd,
            "Selected PR lines did not produce a file change.",
          );
        }

        const absolutePath = nodePath.resolve(input.cwd, path);
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(nodePath.dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, nextContents, "utf8");
          },
          catch: (cause) =>
            gitDiffCommandError(
              "GitDiffCore.revertChangeRequestLines.writeFile",
              input.cwd,
              "Failed to write the reverted file contents.",
              cause,
            ),
        });

        yield* gitCore
          .execute({
            operation: "GitDiffCore.revertChangeRequestLines.stage",
            cwd: input.cwd,
            args: ["add", "-A", "--", path],
          })
          .pipe(Effect.asVoid);

        const subject = shortenCommitSubject(
          input.commitMessage ?? `Revert selected PR lines in ${path}`,
        );
        const commitBody =
          input.commitMessage && input.commitMessage.trim() !== subject
            ? ""
            : `Generated from review action for change request ${input.reference}.`;
        const { commitSha } = yield* gitCore.commit(input.cwd, subject, commitBody);
        const push = (yield* gitCore.pushCurrentBranch(
          input.cwd,
          status.branch,
        )) as GitDiffPushResult;

        return {
          path,
          commitSha,
          push,
        };
      });

    const gitRefExists = (cwd: string, ref: string) =>
      gitCore
        .execute({
          operation: "GitDiffCore.refExists",
          cwd,
          args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.map((result) => result.code === 0),
          Effect.catch(() => Effect.succeed(false)),
        );

    const resolveComparableRef = (
      cwd: string,
      refName: string,
      remoteName: string | null,
    ): Effect.Effect<string> =>
      Effect.gen(function* () {
        const candidates = [
          refName,
          remoteName ? `${remoteName}/${refName}` : null,
          remoteName ? `refs/remotes/${remoteName}/${refName}` : null,
          "origin" !== remoteName ? `origin/${refName}` : null,
          "origin" !== remoteName ? `refs/remotes/origin/${refName}` : null,
          `refs/heads/${refName}`,
        ].filter((candidate): candidate is string => candidate !== null);

        for (const candidate of new Set(candidates)) {
          if (yield* gitRefExists(cwd, candidate)) {
            return candidate;
          }
        }

        return refName;
      });

    const loadOpenChangeRequestsForHead = (
      input: LoadActiveChangeRequestStackedDiffFileIndexInput,
      provider: SourceControlProviderShape,
      headRefName: string,
    ) =>
      provider
        .listChangeRequests({
          cwd: input.cwd,
          headSelector: headRefName,
          state: "open",
          limit: 10,
        })
        .pipe(
          Effect.mapError((error) =>
            toGitDiffProviderError(
              "GitDiffCore.loadActiveChangeRequestStackedDiffFileIndex.listChangeRequests",
              input.cwd,
              error,
            ),
          ),
        );

    const loadActiveChangeRequestStackedDiffFileIndex = (
      input: LoadActiveChangeRequestStackedDiffFileIndexInput,
    ) =>
      Effect.gen(function* () {
        const status = yield* gitCore.statusDetailsLocal(input.cwd);
        const currentBranch = status.branch;
        if (currentBranch === null) {
          return noActiveChangeRequestStack({ headRef: null });
        }

        const providerHandle = yield* sourceControlProviderRegistry
          .resolveHandle({ cwd: input.cwd })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (providerHandle === null || providerHandle.provider.kind === "unknown") {
          return noActiveChangeRequestStack({ headRef: currentBranch });
        }

        const activeChangeRequest = selectChangeRequestForHead(
          yield* loadOpenChangeRequestsForHead(input, providerHandle.provider, currentBranch),
          currentBranch,
        );
        if (activeChangeRequest === null) {
          return noActiveChangeRequestStack({ headRef: currentBranch });
        }

        const defaultBranch = yield* providerHandle.provider
          .getDefaultBranch({
            cwd: input.cwd,
            ...(providerHandle.context ? { context: providerHandle.context } : {}),
          })
          .pipe(Effect.catch(() => Effect.succeed(null)));

        const headToBaseChain: ChangeRequest[] = [];
        const visited = new Set<string>();
        let current: ChangeRequest | null = activeChangeRequest;

        while (current && headToBaseChain.length < ACTIVE_CHANGE_REQUEST_STACK_MAX_DEPTH) {
          const visitKey = `${current.provider}:${current.number}:${current.headRefName}`;
          if (visited.has(visitKey)) {
            break;
          }
          visited.add(visitKey);
          headToBaseChain.push(current);

          if (isMainlineRef(current.baseRefName, defaultBranch)) {
            break;
          }

          current = selectChangeRequestForHead(
            yield* loadOpenChangeRequestsForHead(
              input,
              providerHandle.provider,
              current.baseRefName,
            ),
            current.baseRefName,
          );
        }

        const baseToHeadChain = headToBaseChain.toReversed();
        const remoteName = providerHandle.context?.remoteName ?? null;
        const steps = yield* Effect.all(
          baseToHeadChain.map((changeRequest, index) =>
            Effect.gen(function* () {
              const [baseRef, headRef] = yield* Effect.all(
                [
                  resolveComparableRef(input.cwd, changeRequest.baseRefName, remoteName),
                  resolveComparableRef(input.cwd, changeRequest.headRefName, remoteName),
                ],
                { concurrency: "unbounded" },
              );
              const files = yield* loadDiffFileIndex({
                cwd: input.cwd,
                target: {
                  kind: "range",
                  baseRef,
                  headRef,
                },
                detectRenames: input.detectRenames,
                detectCopies: input.detectCopies,
              });

              return {
                index: index + 1,
                branchName: changeRequest.headRefName,
                baseRef,
                headRef,
                changeRequest,
                files,
              } satisfies GitDiffStackStep;
            }),
          ),
          { concurrency: 2 },
        );

        return {
          activeChangeRequest,
          baseRef: steps[0]?.baseRef ?? activeChangeRequest.baseRefName,
          headRef: steps.at(-1)?.headRef ?? activeChangeRequest.headRefName,
          steps,
        };
      });

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
      listRepositories,
      loadDiffFile,
      loadDiffFileIndex,
      loadActiveChangeRequestStackedDiffFileIndex,
      loadStackedDiffFileIndex,
      loadHistory,
      loadIgnoreLists,
      createIgnoreList,
      updateIgnoreList,
      deleteIgnoreList,
      stageWorktreeChanges,
      unstageStagedChanges,
      discardWorktreeChanges,
      amendStagedChanges,
      revertCommit,
      cherryPickCommit,
      loadOperation,
      continueOperation,
      abortOperation,
      loadStashes,
      createStash,
      applyStash,
      popStash,
      dropStash,
      closeChangeRequest,
      mergeChangeRequest,
      loadChangeRequestChecks,
      loadChangeRequestReviewThreads,
      commentChangeRequestLines,
      revertChangeRequestLines,
    });
  }),
);
