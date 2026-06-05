/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProjectCopyEntryInput,
  ProjectCopyEntryResult,
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectCreateFileInput,
  ProjectCreateFileResult,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectRemoveEntryInput,
  ProjectRemoveEntryResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@fenrir/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";

export class WorkspaceFileSystemError extends Schema.TaggedErrorClass<WorkspaceFileSystemError>()(
  "WorkspaceFileSystemError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspaceFileSystemShape - Service API for workspace-relative file operations.
 */
export interface WorkspaceFileSystemShape {
  /**
   * Write a file relative to the workspace root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * workspace root.
   */
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<
    ProjectWriteFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Create a file relative to the workspace root.
   *
   * Creates parent directories as needed, rejects paths that escape the
   * workspace root, and fails if the target file already exists.
   */
  readonly createFile: (
    input: ProjectCreateFileInput,
  ) => Effect.Effect<
    ProjectCreateFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Create a directory relative to the workspace root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * workspace root.
   */
  readonly createDirectory: (
    input: ProjectCreateDirectoryInput,
  ) => Effect.Effect<
    ProjectCreateDirectoryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Remove a file or directory relative to the workspace root.
   *
   * Rejects paths that escape the workspace root.
   */
  readonly removeEntry: (
    input: ProjectRemoveEntryInput,
  ) => Effect.Effect<
    ProjectRemoveEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Move or rename a file or directory relative to the workspace root.
   *
   * Rejects paths that escape the workspace root and fails if the destination
   * already exists.
   */
  readonly moveEntry: (
    input: ProjectMoveEntryInput,
  ) => Effect.Effect<
    ProjectMoveEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Copy a file or directory relative to the workspace root.
   *
   * Rejects paths that escape the workspace root and fails if the destination
   * already exists.
   */
  readonly copyEntry: (
    input: ProjectCopyEntryInput,
  ) => Effect.Effect<
    ProjectCopyEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;
}

/**
 * WorkspaceFileSystem - Service tag for workspace file operations.
 */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  WorkspaceFileSystemShape
>()("t3/workspace/Services/WorkspaceFileSystem") {}
