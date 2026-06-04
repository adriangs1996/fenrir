import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const DiffTarget = Schema.Struct({
  kind: TrimmedNonEmptyString,
});
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
