import type { Effect } from "effect";

import type { CheckpointRef, GitCommandError, VcsListRemotesResult } from "@fenrir/contracts";
import type { VcsProcessInput, VcsProcessOutput } from "./VcsProcess.ts";

export type VcsDriverKind = "git";

export interface VcsRepositoryIdentity {
  readonly kind: VcsDriverKind;
  readonly rootPath: string;
  readonly metadataPath: string | null;
}

export interface VcsDriverCapabilities {
  readonly kind: VcsDriverKind;
  readonly supportsWorktrees: boolean;
  readonly supportsAtomicSnapshot: boolean;
  readonly ignoreClassifier: "native" | "git-compatible-fallback";
}

export interface VcsListWorkspaceFilesResult {
  readonly paths: ReadonlyArray<string>;
  readonly truncated: boolean;
}

export interface VcsCaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
}

export interface VcsRestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface VcsDiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace?: boolean;
}

export interface VcsDeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

export interface VcsCheckpointOps {
  readonly captureCheckpoint: (
    input: VcsCaptureCheckpointInput,
  ) => Effect.Effect<void, GitCommandError>;
  readonly hasCheckpointRef: (
    input: Omit<VcsRestoreCheckpointInput, "fallbackToHead">,
  ) => Effect.Effect<boolean, GitCommandError>;
  readonly restoreCheckpoint: (
    input: VcsRestoreCheckpointInput,
  ) => Effect.Effect<boolean, GitCommandError>;
  readonly diffCheckpoints: (
    input: VcsDiffCheckpointsInput,
  ) => Effect.Effect<string, GitCommandError>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Effect.Effect<void, GitCommandError>;
}

export interface VcsDriverShape {
  readonly capabilities: VcsDriverCapabilities;
  readonly execute: (
    input: Omit<VcsProcessInput, "command">,
  ) => Effect.Effect<VcsProcessOutput, GitCommandError>;
  readonly checkpoints?: VcsCheckpointOps;
  readonly detectRepository: (
    cwd: string,
  ) => Effect.Effect<VcsRepositoryIdentity | null, GitCommandError>;
  readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, GitCommandError>;
  readonly listWorkspaceFiles: (
    cwd: string,
  ) => Effect.Effect<VcsListWorkspaceFilesResult, GitCommandError>;
  readonly listRemotes: (cwd: string) => Effect.Effect<VcsListRemotesResult, GitCommandError>;
  readonly filterIgnoredPaths: (
    cwd: string,
    relativePaths: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, GitCommandError>;
  readonly initRepository: (input: {
    readonly cwd: string;
  }) => Effect.Effect<void, GitCommandError>;
}
