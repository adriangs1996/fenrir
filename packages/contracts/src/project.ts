import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_LIST_ENTRIES_MAX_LIMIT = 500;
const PROJECT_ENTRY_PATH_MAX_LENGTH = 512;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_CREATE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_REMOVE_ENTRY_PATH_MAX_LENGTH = 512;
const PROJECT_MOVE_ENTRY_PATH_MAX_LENGTH = 512;
const PROJECT_COPY_ENTRY_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectListEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    Schema.String.check(Schema.isMaxLength(PROJECT_ENTRY_PATH_MAX_LENGTH)),
  ),
  includeIgnored: Schema.optional(Schema.Boolean),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_LIST_ENTRIES_MAX_LIMIT)),
});
export type ProjectListEntriesInput = typeof ProjectListEntriesInput.Type;

export const ProjectListEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectListEntriesResult = typeof ProjectListEntriesResult.Type;

export class ProjectListEntriesError extends Schema.TaggedErrorClass<ProjectListEntriesError>()(
  "ProjectListEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CREATE_FILE_PATH_MAX_LENGTH),
  ),
  contents: Schema.optional(Schema.String),
});
export type ProjectCreateFileInput = typeof ProjectCreateFileInput.Type;

export const ProjectCreateFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateFileResult = typeof ProjectCreateFileResult.Type;

export class ProjectCreateFileError extends Schema.TaggedErrorClass<ProjectCreateFileError>()(
  "ProjectCreateFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH),
  ),
});
export type ProjectCreateDirectoryInput = typeof ProjectCreateDirectoryInput.Type;

export const ProjectCreateDirectoryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateDirectoryResult = typeof ProjectCreateDirectoryResult.Type;

export class ProjectCreateDirectoryError extends Schema.TaggedErrorClass<ProjectCreateDirectoryError>()(
  "ProjectCreateDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectRemoveEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_REMOVE_ENTRY_PATH_MAX_LENGTH),
  ),
});
export type ProjectRemoveEntryInput = typeof ProjectRemoveEntryInput.Type;

export const ProjectRemoveEntryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectRemoveEntryResult = typeof ProjectRemoveEntryResult.Type;

export class ProjectRemoveEntryError extends Schema.TaggedErrorClass<ProjectRemoveEntryError>()(
  "ProjectRemoveEntryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectMoveEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_MOVE_ENTRY_PATH_MAX_LENGTH),
  ),
  destinationRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_MOVE_ENTRY_PATH_MAX_LENGTH),
  ),
});
export type ProjectMoveEntryInput = typeof ProjectMoveEntryInput.Type;

export const ProjectMoveEntryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectMoveEntryResult = typeof ProjectMoveEntryResult.Type;

export class ProjectMoveEntryError extends Schema.TaggedErrorClass<ProjectMoveEntryError>()(
  "ProjectMoveEntryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCopyEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_COPY_ENTRY_PATH_MAX_LENGTH),
  ),
  destinationRelativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_COPY_ENTRY_PATH_MAX_LENGTH),
  ),
});
export type ProjectCopyEntryInput = typeof ProjectCopyEntryInput.Type;

export const ProjectCopyEntryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCopyEntryResult = typeof ProjectCopyEntryResult.Type;

export class ProjectCopyEntryError extends Schema.TaggedErrorClass<ProjectCopyEntryError>()(
  "ProjectCopyEntryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
