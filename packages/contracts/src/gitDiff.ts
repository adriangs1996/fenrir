import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const DiffTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("worktree"),
  }),
  Schema.Struct({
    kind: Schema.Literal("staged"),
  }),
  Schema.Struct({
    kind: Schema.Literal("range"),
    baseRef: TrimmedNonEmptyString,
    headRef: TrimmedNonEmptyString,
  }),
]);
export type DiffTarget = typeof DiffTarget.Type;

export const LoadDiffFileIndexInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadDiffFileIndexInput = typeof LoadDiffFileIndexInput.Type;

export const GitDiffFileSummary = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
});
export type GitDiffFileSummary = typeof GitDiffFileSummary.Type;

export const LoadDiffFileIndexResult = Schema.Array(GitDiffFileSummary);
export type LoadDiffFileIndexResult = typeof LoadDiffFileIndexResult.Type;

export const LoadDiffFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: DiffTarget,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadDiffFileInput = typeof LoadDiffFileInput.Type;

export const GitDiffFileContent = Schema.Struct({
  path: TrimmedNonEmptyString,
  contents: Schema.String,
});
export type GitDiffFileContent = typeof GitDiffFileContent.Type;

export const LoadDiffFileResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  oldFile: Schema.NullOr(GitDiffFileContent),
  newFile: Schema.NullOr(GitDiffFileContent),
  patch: Schema.String,
});
export type LoadDiffFileResult = typeof LoadDiffFileResult.Type;

export const LoadStackedDiffFileIndexInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  detectRenames: Schema.Boolean,
  detectCopies: Schema.Boolean,
});
export type LoadStackedDiffFileIndexInput = typeof LoadStackedDiffFileIndexInput.Type;

export const GitDiffStackStep = Schema.Struct({
  index: PositiveInt,
  branchName: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  files: Schema.Array(GitDiffFileSummary),
});
export type GitDiffStackStep = typeof GitDiffStackStep.Type;

export const LoadStackedDiffFileIndexResult = Schema.Struct({
  baseRef: TrimmedNonEmptyString,
  headRef: TrimmedNonEmptyString,
  steps: Schema.Array(GitDiffStackStep),
});
export type LoadStackedDiffFileIndexResult = typeof LoadStackedDiffFileIndexResult.Type;
