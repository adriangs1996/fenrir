import {
  GitCommandError,
  LoadDiffFileResult,
  LoadDiffFileIndexResult,
  LoadStackedDiffFileIndexResult,
  type LoadDiffFileInput,
  type LoadDiffFileIndexInput,
  type LoadStackedDiffFileIndexInput,
} from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface GitDiffCoreShape {
  readonly loadDiffFile: (
    input: LoadDiffFileInput,
  ) => Effect.Effect<LoadDiffFileResult, GitCommandError>;
  readonly loadDiffFileIndex: (
    input: LoadDiffFileIndexInput,
  ) => Effect.Effect<LoadDiffFileIndexResult, GitCommandError>;
  readonly loadStackedDiffFileIndex: (
    input: LoadStackedDiffFileIndexInput,
  ) => Effect.Effect<LoadStackedDiffFileIndexResult, GitCommandError>;
}

export class GitDiffCore extends Context.Service<GitDiffCore, GitDiffCoreShape>()(
  "fenrir/git/Services/GitDiffCore",
) {}
