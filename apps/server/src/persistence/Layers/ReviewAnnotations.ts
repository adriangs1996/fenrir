import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetReviewAnnotationInput,
  ListReviewAnnotationsInput,
  ReviewAnnotationRecord,
  ReviewAnnotationRepository,
  type ReviewAnnotationRepositoryShape,
} from "../Services/ReviewAnnotations.ts";
import {
  ReviewLocalNoteAuthorSnapshot,
  ReviewStableAnchor,
} from "@fenrir/contracts/sourceControlReview";

const ReviewAnnotationDbRow = ReviewAnnotationRecord.mapFields(
  Struct.assign({
    anchor: Schema.NullOr(Schema.fromJsonString(ReviewStableAnchor)),
    author: Schema.fromJsonString(ReviewLocalNoteAuthorSnapshot),
    isResolved: Schema.Number,
    isReopened: Schema.Number,
    isOutdated: Schema.Number,
    isSuggestedResolved: Schema.Number,
  }),
);
type ReviewAnnotationDbRow = typeof ReviewAnnotationDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toReviewAnnotationRecord(row: ReviewAnnotationDbRow): ReviewAnnotationRecord {
  return {
    annotationId: row.annotationId,
    sessionId: row.sessionId,
    annotationKind: row.annotationKind,
    parentAnnotationId: row.parentAnnotationId,
    targetKind: row.targetKind,
    targetId: row.targetId,
    groupId: row.groupId,
    fileId: row.fileId,
    chunkId: row.chunkId,
    anchor: row.anchor,
    source: row.source,
    title: row.title,
    body: row.body,
    author: row.author,
    isResolved: row.isResolved !== 0,
    isReopened: row.isReopened !== 0,
    isOutdated: row.isOutdated !== 0,
    isSuggestedResolved: row.isSuggestedResolved !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const makeReviewAnnotationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertAnnotationRow = SqlSchema.void({
    Request: ReviewAnnotationRecord,
    execute: (annotation) =>
      sql`
        INSERT INTO review_annotations (
          annotation_id,
          session_id,
          annotation_kind,
          parent_annotation_id,
          target_kind,
          target_id,
          group_id,
          file_id,
          chunk_id,
          anchor_payload_json,
          source,
          title,
          body,
          author_json,
          resolved,
          reopened,
          outdated,
          suggested_resolved,
          created_at,
          updated_at
        )
        VALUES (
          ${annotation.annotationId},
          ${annotation.sessionId},
          ${annotation.annotationKind},
          ${annotation.parentAnnotationId},
          ${annotation.targetKind},
          ${annotation.targetId},
          ${annotation.groupId},
          ${annotation.fileId},
          ${annotation.chunkId},
          ${annotation.anchor === null ? null : JSON.stringify(annotation.anchor)},
          ${annotation.source},
          ${annotation.title},
          ${annotation.body},
          ${JSON.stringify(annotation.author)},
          ${annotation.isResolved ? 1 : 0},
          ${annotation.isReopened ? 1 : 0},
          ${annotation.isOutdated ? 1 : 0},
          ${annotation.isSuggestedResolved ? 1 : 0},
          ${annotation.createdAt},
          ${annotation.updatedAt}
        )
        ON CONFLICT (annotation_id)
        DO UPDATE SET
          session_id = excluded.session_id,
          annotation_kind = excluded.annotation_kind,
          parent_annotation_id = excluded.parent_annotation_id,
          target_kind = excluded.target_kind,
          target_id = excluded.target_id,
          group_id = excluded.group_id,
          file_id = excluded.file_id,
          chunk_id = excluded.chunk_id,
          anchor_payload_json = excluded.anchor_payload_json,
          source = excluded.source,
          title = excluded.title,
          body = excluded.body,
          author_json = excluded.author_json,
          resolved = excluded.resolved,
          reopened = excluded.reopened,
          outdated = excluded.outdated,
          suggested_resolved = excluded.suggested_resolved,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getAnnotationRow = SqlSchema.findOneOption({
    Request: GetReviewAnnotationInput,
    Result: ReviewAnnotationDbRow,
    execute: ({ annotationId }) =>
      sql`
        SELECT
          annotation_id AS "annotationId",
          session_id AS "sessionId",
          annotation_kind AS "annotationKind",
          parent_annotation_id AS "parentAnnotationId",
          target_kind AS "targetKind",
          target_id AS "targetId",
          group_id AS "groupId",
          file_id AS "fileId",
          chunk_id AS "chunkId",
          anchor_payload_json AS "anchor",
          source,
          title,
          body,
          author_json AS "author",
          resolved AS "isResolved",
          reopened AS "isReopened",
          outdated AS "isOutdated",
          suggested_resolved AS "isSuggestedResolved",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM review_annotations
        WHERE annotation_id = ${annotationId}
      `,
  });

  const listAnnotationRows = SqlSchema.findAll({
    Request: ListReviewAnnotationsInput,
    Result: ReviewAnnotationDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          annotation_id AS "annotationId",
          session_id AS "sessionId",
          annotation_kind AS "annotationKind",
          parent_annotation_id AS "parentAnnotationId",
          target_kind AS "targetKind",
          target_id AS "targetId",
          group_id AS "groupId",
          file_id AS "fileId",
          chunk_id AS "chunkId",
          anchor_payload_json AS "anchor",
          source,
          title,
          body,
          author_json AS "author",
          resolved AS "isResolved",
          reopened AS "isReopened",
          outdated AS "isOutdated",
          suggested_resolved AS "isSuggestedResolved",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM review_annotations
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC, annotation_id ASC
      `,
  });

  const upsert: ReviewAnnotationRepositoryShape["upsert"] = (annotation) =>
    upsertAnnotationRow(annotation).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewAnnotationRepository.upsert:query",
          "ReviewAnnotationRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ReviewAnnotationRepositoryShape["getById"] = (input) =>
    getAnnotationRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewAnnotationRepository.getById:query",
          "ReviewAnnotationRepository.getById:decodeRow",
        ),
      ),
      Effect.map(Option.map(toReviewAnnotationRecord)),
    );

  const listBySessionId: ReviewAnnotationRepositoryShape["listBySessionId"] = (input) =>
    listAnnotationRows(input).pipe(
      Effect.map((rows) => rows.map(toReviewAnnotationRecord)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewAnnotationRepository.listBySessionId:query",
          "ReviewAnnotationRepository.listBySessionId:decodeRows",
        ),
      ),
    );

  const deleteById: ReviewAnnotationRepositoryShape["deleteById"] = ({ annotationId }) =>
    sql`
      DELETE FROM review_annotations
      WHERE annotation_id = ${annotationId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewAnnotationRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listBySessionId,
    deleteById,
  } satisfies ReviewAnnotationRepositoryShape;
});

export const ReviewAnnotationRepositoryLive = Layer.effect(
  ReviewAnnotationRepository,
  makeReviewAnnotationRepository,
);
