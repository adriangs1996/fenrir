import type { Effect } from "effect";

import type {
  CheckpointRef,
  DiffTarget,
  GitDiffFileSummary,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileResult,
  VcsDriverCapabilities,
  VcsDriverKind,
  VcsError,
  VcsInitInput,
  VcsListRemotesResult,
  VcsListWorkspaceFilesResult,
  VcsRepositoryIdentity,
} from "@fenrir/contracts";
import type { VcsProcessInput, VcsProcessOutput } from "./VcsProcess.ts";

export type {
  VcsDriverCapabilities,
  VcsDriverKind,
  VcsListWorkspaceFilesResult,
  VcsRepositoryIdentity,
};

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
  readonly captureCheckpoint: (input: VcsCaptureCheckpointInput) => Effect.Effect<void, VcsError>;
  readonly hasCheckpointRef: (
    input: Omit<VcsRestoreCheckpointInput, "fallbackToHead">,
  ) => Effect.Effect<boolean, VcsError>;
  readonly restoreCheckpoint: (
    input: VcsRestoreCheckpointInput,
  ) => Effect.Effect<boolean, VcsError>;
  readonly diffCheckpoints: (input: VcsDiffCheckpointsInput) => Effect.Effect<string, VcsError>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Effect.Effect<void, VcsError>;
}

export interface VcsReviewDiffTargetInput {
  readonly cwd: string;
  readonly target: DiffTarget;
  readonly detectRenames: boolean;
  readonly detectCopies: boolean;
}

export interface VcsReviewDiffOps {
  readonly loadFileIndex: (
    input: LoadDiffFileIndexInput,
  ) => Effect.Effect<ReadonlyArray<GitDiffFileSummary>, VcsError>;
  readonly loadFile: (input: LoadDiffFileInput) => Effect.Effect<LoadDiffFileResult, VcsError>;
  readonly loadChangeSignature: (
    input: VcsReviewDiffTargetInput,
  ) => Effect.Effect<{ readonly signature: string }, VcsError>;
}

export interface VcsDriverShape {
  readonly capabilities: VcsDriverCapabilities;
  readonly execute: (
    input: Omit<VcsProcessInput, "command">,
  ) => Effect.Effect<VcsProcessOutput, VcsError>;
  readonly checkpoints?: VcsCheckpointOps;
  readonly reviewDiff?: VcsReviewDiffOps;
  readonly detectRepository: (cwd: string) => Effect.Effect<VcsRepositoryIdentity | null, VcsError>;
  readonly isInsideWorkTree: (cwd: string) => Effect.Effect<boolean, VcsError>;
  readonly listWorkspaceFiles: (
    cwd: string,
  ) => Effect.Effect<VcsListWorkspaceFilesResult, VcsError>;
  readonly listRemotes: (cwd: string) => Effect.Effect<VcsListRemotesResult, VcsError>;
  readonly filterIgnoredPaths: (
    cwd: string,
    relativePaths: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, VcsError>;
  readonly initRepository: (input: VcsInitInput) => Effect.Effect<void, VcsError>;
}
