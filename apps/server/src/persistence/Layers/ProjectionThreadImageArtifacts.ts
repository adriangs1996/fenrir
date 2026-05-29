import { ChatImageAttachment } from "@fenrir/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadImageArtifactsInput,
  GetProjectionThreadImageArtifactInput,
  ProjectionThreadImageArtifact,
  ProjectionThreadImageArtifactRepository,
  type ProjectionThreadImageArtifactRepositoryShape,
} from "../Services/ProjectionThreadImageArtifacts.ts";

const ProjectionThreadImageArtifactDbRowSchema = ProjectionThreadImageArtifact.mapFields(
  Struct.assign({
    attachment: Schema.fromJsonString(ChatImageAttachment),
  }),
);

function toProjectionThreadImageArtifact(
  row: Schema.Schema.Type<typeof ProjectionThreadImageArtifactDbRowSchema>,
): ProjectionThreadImageArtifact {
  return {
    artifactId: row.artifactId,
    threadId: row.threadId,
    turnId: row.turnId,
    attachment: row.attachment,
    sourceKind: row.sourceKind,
    sourceEventId: row.sourceEventId,
    createdAt: row.createdAt,
  };
}

const makeProjectionThreadImageArtifactRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadImageArtifactRow = SqlSchema.void({
    Request: ProjectionThreadImageArtifact,
    execute: (row) => sql`
      INSERT INTO projection_thread_image_artifacts (
        thread_id,
        artifact_id,
        turn_id,
        attachment_json,
        source_kind,
        source_event_id,
        created_at
      )
      VALUES (
        ${row.threadId},
        ${row.artifactId},
        ${row.turnId},
        ${JSON.stringify(row.attachment)},
        ${row.sourceKind},
        ${row.sourceEventId},
        ${row.createdAt}
      )
      ON CONFLICT (thread_id, artifact_id)
      DO UPDATE SET
        turn_id = excluded.turn_id,
        attachment_json = excluded.attachment_json,
        source_kind = excluded.source_kind,
        source_event_id = excluded.source_event_id,
        created_at = excluded.created_at
    `,
  });

  const getProjectionThreadImageArtifactRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadImageArtifactInput,
    Result: ProjectionThreadImageArtifactDbRowSchema,
    execute: ({ threadId, artifactId }) => sql`
      SELECT
        artifact_id AS "artifactId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        attachment_json AS "attachment",
        source_kind AS "sourceKind",
        source_event_id AS "sourceEventId",
        created_at AS "createdAt"
      FROM projection_thread_image_artifacts
      WHERE thread_id = ${threadId}
        AND artifact_id = ${artifactId}
      LIMIT 1
    `,
  });

  const deleteProjectionThreadImageArtifactRows = SqlSchema.void({
    Request: DeleteProjectionThreadImageArtifactsInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_image_artifacts
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadImageArtifactRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadImageArtifactRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadImageArtifactRepository.upsert")),
    );

  const getByThreadIdAndArtifactId: ProjectionThreadImageArtifactRepositoryShape["getByThreadIdAndArtifactId"] =
    (input) =>
      getProjectionThreadImageArtifactRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadImageArtifactRepository.getByThreadIdAndArtifactId",
          ),
        ),
        Effect.map(Option.map(toProjectionThreadImageArtifact)),
      );

  const deleteByThreadId: ProjectionThreadImageArtifactRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionThreadImageArtifactRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadImageArtifactRepository.deleteByThreadId"),
      ),
    );

  return {
    upsert,
    getByThreadIdAndArtifactId,
    deleteByThreadId,
  } satisfies ProjectionThreadImageArtifactRepositoryShape;
});

export const ProjectionThreadImageArtifactRepositoryLive = Layer.effect(
  ProjectionThreadImageArtifactRepository,
  makeProjectionThreadImageArtifactRepository,
);
