import {
  ChatImageAttachment,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@fenrir/contracts";
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadImageArtifact = Schema.Struct({
  artifactId: TrimmedNonEmptyString,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  attachment: ChatImageAttachment,
  sourceKind: TrimmedNonEmptyString,
  sourceEventId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ProjectionThreadImageArtifact = typeof ProjectionThreadImageArtifact.Type;

export const GetProjectionThreadImageArtifactInput = Schema.Struct({
  threadId: ThreadId,
  artifactId: TrimmedNonEmptyString,
});
export type GetProjectionThreadImageArtifactInput =
  typeof GetProjectionThreadImageArtifactInput.Type;

export const DeleteProjectionThreadImageArtifactsInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadImageArtifactsInput =
  typeof DeleteProjectionThreadImageArtifactsInput.Type;

export interface ProjectionThreadImageArtifactRepositoryShape {
  readonly upsert: (
    artifact: ProjectionThreadImageArtifact,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadIdAndArtifactId: (
    input: GetProjectionThreadImageArtifactInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadImageArtifact>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadImageArtifactsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadImageArtifactRepository extends Context.Service<
  ProjectionThreadImageArtifactRepository,
  ProjectionThreadImageArtifactRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadImageArtifacts/ProjectionThreadImageArtifactRepository",
) {}
