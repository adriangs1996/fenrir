import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetReviewProgressInput,
  ListReviewProgressInput,
  ReviewProgressRecord,
  ReviewProgressRepository,
  type ReviewProgressRepositoryShape,
} from "../Services/ReviewProgress.ts";
import { ReviewLocalNoteAuthorSnapshot } from "../../../../../packages/contracts/src/review.ts";

const ReviewProgressDbRow = ReviewProgressRecord.mapFields(
  Struct.assign({
    author: Schema.fromJsonString(ReviewLocalNoteAuthorSnapshot),
  }),
);
type ReviewProgressDbRow = typeof ReviewProgressDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeReviewProgressRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProgressRow = SqlSchema.void({
    Request: ReviewProgressRecord,
    execute: (progress) =>
      sql`
        INSERT INTO review_progress (
          session_id,
          target_kind,
          target_id,
          progress_state,
          last_updated_author_json,
          last_updated_at
        )
        VALUES (
          ${progress.sessionId},
          ${progress.targetKind},
          ${progress.targetId},
          ${progress.progressState},
          ${JSON.stringify(progress.author)},
          ${progress.lastUpdatedAt}
        )
        ON CONFLICT (session_id, target_kind, target_id)
        DO UPDATE SET
          progress_state = excluded.progress_state,
          last_updated_author_json = excluded.last_updated_author_json,
          last_updated_at = excluded.last_updated_at
      `,
  });

  const getProgressRow = SqlSchema.findOneOption({
    Request: GetReviewProgressInput,
    Result: ReviewProgressDbRow,
    execute: ({ sessionId, targetKind, targetId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          target_kind AS "targetKind",
          target_id AS "targetId",
          progress_state AS "progressState",
          last_updated_author_json AS "author",
          last_updated_at AS "lastUpdatedAt"
        FROM review_progress
        WHERE session_id = ${sessionId}
          AND target_kind = ${targetKind}
          AND target_id = ${targetId}
      `,
  });

  const listProgressRows = SqlSchema.findAll({
    Request: ListReviewProgressInput,
    Result: ReviewProgressDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          target_kind AS "targetKind",
          target_id AS "targetId",
          progress_state AS "progressState",
          last_updated_author_json AS "author",
          last_updated_at AS "lastUpdatedAt"
        FROM review_progress
        WHERE session_id = ${sessionId}
        ORDER BY last_updated_at ASC, target_kind ASC, target_id ASC
      `,
  });

  const upsert: ReviewProgressRepositoryShape["upsert"] = (progress) =>
    upsertProgressRow(progress).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewProgressRepository.upsert:query",
          "ReviewProgressRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getByTarget: ReviewProgressRepositoryShape["getByTarget"] = (input) =>
    getProgressRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewProgressRepository.getByTarget:query",
          "ReviewProgressRepository.getByTarget:decodeRow",
        ),
      ),
    );

  const listBySessionId: ReviewProgressRepositoryShape["listBySessionId"] = (input) =>
    listProgressRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewProgressRepository.listBySessionId:query",
          "ReviewProgressRepository.listBySessionId:decodeRows",
        ),
      ),
    );

  const deleteByTarget: ReviewProgressRepositoryShape["deleteByTarget"] = ({
    sessionId,
    targetKind,
    targetId,
  }) =>
    sql`
      DELETE FROM review_progress
      WHERE session_id = ${sessionId}
        AND target_kind = ${targetKind}
        AND target_id = ${targetId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewProgressRepository.deleteByTarget:query")),
    );

  return {
    upsert,
    getByTarget,
    listBySessionId,
    deleteByTarget,
  } satisfies ReviewProgressRepositoryShape;
});

export const ReviewProgressRepositoryLive = Layer.effect(
  ReviewProgressRepository,
  makeReviewProgressRepository,
);
