import * as Rpc from "effect/unstable/rpc/Rpc";

import { OpenError, OpenInEditorInput } from "../editor";
import {
  FilesystemBrowseError,
  FilesystemBrowseInput,
  FilesystemBrowseResult,
} from "../filesystem";
import {
  ProjectCopyEntryError,
  ProjectCopyEntryInput,
  ProjectCopyEntryResult,
  ProjectCreateDirectoryError,
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectCreateFileError,
  ProjectCreateFileInput,
  ProjectCreateFileResult,
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectMoveEntryError,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectRemoveEntryError,
  ProjectRemoveEntryInput,
  ProjectRemoveEntryResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "../project";
import { WS_METHODS } from "./methods";

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: ProjectListEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsProjectsCreateFileRpc = Rpc.make(WS_METHODS.projectsCreateFile, {
  payload: ProjectCreateFileInput,
  success: ProjectCreateFileResult,
  error: ProjectCreateFileError,
});

export const WsProjectsCreateDirectoryRpc = Rpc.make(WS_METHODS.projectsCreateDirectory, {
  payload: ProjectCreateDirectoryInput,
  success: ProjectCreateDirectoryResult,
  error: ProjectCreateDirectoryError,
});

export const WsProjectsRemoveEntryRpc = Rpc.make(WS_METHODS.projectsRemoveEntry, {
  payload: ProjectRemoveEntryInput,
  success: ProjectRemoveEntryResult,
  error: ProjectRemoveEntryError,
});

export const WsProjectsMoveEntryRpc = Rpc.make(WS_METHODS.projectsMoveEntry, {
  payload: ProjectMoveEntryInput,
  success: ProjectMoveEntryResult,
  error: ProjectMoveEntryError,
});

export const WsProjectsCopyEntryRpc = Rpc.make(WS_METHODS.projectsCopyEntry, {
  payload: ProjectCopyEntryInput,
  success: ProjectCopyEntryResult,
  error: ProjectCopyEntryError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});
