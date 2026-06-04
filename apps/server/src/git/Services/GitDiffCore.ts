import {
  GitCommandError,
  LoadDiffFileIndexResult,
  type LoadDiffFileIndexInput,
} from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface GitDiffCoreShape {
  readonly loadDiffFileIndex: (
    input: LoadDiffFileIndexInput,
  ) => Effect.Effect<LoadDiffFileIndexResult, GitCommandError>;
}

export class GitDiffCore extends Context.Service<GitDiffCore, GitDiffCoreShape>()(
  "fenrir/git/Services/GitDiffCore",
) {}
