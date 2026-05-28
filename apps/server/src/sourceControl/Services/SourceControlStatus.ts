import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type {
  GitManagerServiceError,
  GitStatusInput,
  GitStatusLocalResult,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@fenrir/contracts";

export interface SourceControlStatusShape {
  readonly getStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly refreshLocalStatus: (
    cwd: string,
  ) => Effect.Effect<GitStatusLocalResult, GitManagerServiceError>;
  readonly refreshStatus: (cwd: string) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: GitStatusInput,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
}

export class SourceControlStatus extends Context.Service<
  SourceControlStatus,
  SourceControlStatusShape
>()("fenrir/sourceControl/Services/SourceControlStatus") {}
