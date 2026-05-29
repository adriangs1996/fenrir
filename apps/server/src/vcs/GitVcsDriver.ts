import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { DateTime, Effect, Layer, Option, Context } from "effect";

import { VcsProcessExitError } from "@fenrir/contracts";
import type { VcsDriverShape } from "./VcsDriver.ts";
import { VcsProcess, VcsProcessLive } from "./VcsProcess.ts";

const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 10_000_000;
const WORKSPACE_GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

export class GitVcsDriver extends Context.Service<GitVcsDriver, VcsDriverShape>()(
  "fenrir/vcs/Services/GitVcsDriver",
) {}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
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
