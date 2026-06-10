import { Effect, Schema } from "effect";

import {
  FilesystemBrowseError,
  ProjectCopyEntryError,
  ProjectCreateDirectoryError,
  ProjectCreateFileError,
  ProjectListEntriesError,
  ProjectMoveEntryError,
  ProjectRemoveEntryError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  WS_METHODS,
} from "@fenrir/contracts";

import { Open } from "../../open";
import { WorkspaceEntries } from "../../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../../workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "../../workspace/Services/WorkspacePaths";
import { makeRpcDomain } from "../handlers";

const isWorkspacePathOutsideRootError = Schema.is(WorkspacePathOutsideRootError);

function workspaceFileSystemMutationMessage(cause: unknown, fallback: string): string {
  return isWorkspacePathOutsideRootError(cause)
    ? "Workspace file path must stay within the project root."
    : fallback;
}

export const makeWorkspaceRoutes = Effect.gen(function* () {
  const workspaceEntries = yield* WorkspaceEntries;
  const workspaceFileSystem = yield* WorkspaceFileSystem;
  const open = yield* Open;

  const workspace = makeRpcDomain("workspace");

  return {
    [WS_METHODS.projectsListEntries]: workspace.effect(WS_METHODS.projectsListEntries, (input) =>
      workspaceEntries.listEntries(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectListEntriesError({
              message: `Failed to list workspace entries: ${cause.detail}`,
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.projectsSearchEntries]: workspace.effect(
      WS_METHODS.projectsSearchEntries,
      (input) =>
        workspaceEntries.search(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSearchEntriesError({
                message: `Failed to search workspace entries: ${cause.detail}`,
                cause,
              }),
          ),
        ),
    ),
    [WS_METHODS.projectsWriteFile]: workspace.effect(WS_METHODS.projectsWriteFile, (input) =>
      workspaceFileSystem.writeFile(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectWriteFileError({
              message: workspaceFileSystemMutationMessage(cause, "Failed to write workspace file"),
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.projectsCreateFile]: workspace.effect(WS_METHODS.projectsCreateFile, (input) =>
      workspaceFileSystem.createFile(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectCreateFileError({
              message: workspaceFileSystemMutationMessage(cause, "Failed to create workspace file"),
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.projectsCreateDirectory]: workspace.effect(
      WS_METHODS.projectsCreateDirectory,
      (input) =>
        workspaceFileSystem.createDirectory(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectCreateDirectoryError({
                message: workspaceFileSystemMutationMessage(
                  cause,
                  "Failed to create workspace directory",
                ),
                cause,
              }),
          ),
        ),
    ),
    [WS_METHODS.projectsRemoveEntry]: workspace.effect(WS_METHODS.projectsRemoveEntry, (input) =>
      workspaceFileSystem.removeEntry(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectRemoveEntryError({
              message: workspaceFileSystemMutationMessage(
                cause,
                "Failed to remove workspace entry",
              ),
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.projectsMoveEntry]: workspace.effect(WS_METHODS.projectsMoveEntry, (input) =>
      workspaceFileSystem.moveEntry(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectMoveEntryError({
              message: workspaceFileSystemMutationMessage(cause, "Failed to move workspace entry"),
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.projectsCopyEntry]: workspace.effect(WS_METHODS.projectsCopyEntry, (input) =>
      workspaceFileSystem.copyEntry(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectCopyEntryError({
              message: workspaceFileSystemMutationMessage(cause, "Failed to copy workspace entry"),
              cause,
            }),
        ),
      ),
    ),
    [WS_METHODS.shellOpenInEditor]: workspace.effect(WS_METHODS.shellOpenInEditor, (input) =>
      open.openInEditor(input),
    ),
    [WS_METHODS.filesystemBrowse]: workspace.effect(WS_METHODS.filesystemBrowse, (input) =>
      workspaceEntries.browse(input).pipe(
        Effect.mapError(
          (cause) =>
            new FilesystemBrowseError({
              message: cause.detail,
              cause,
            }),
        ),
      ),
    ),
  };
});
