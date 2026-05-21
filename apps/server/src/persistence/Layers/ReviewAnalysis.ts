import { TrimmedNonEmptyString } from "@fenrir/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetReviewAnalysisInput,
  ReviewAnalysisRecord,
  ReviewAnalysisRepository,
  type ReviewAnalysisRepositoryShape,
} from "../Services/ReviewAnalysis.ts";
import { ReviewAnalysisArtifact } from "../../../../../packages/contracts/src/review.ts";

const ReviewAnalysisDbRow = ReviewAnalysisRecord.mapFields(
  Struct.assign({
    artifact: Schema.fromJsonString(ReviewAnalysisArtifact),
    analysisPayload: Schema.fromJsonString(Schema.Unknown),
    staleMarkerInputs: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    staleReasonFlags: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
  }),
);
type ReviewAnalysisDbRow = typeof ReviewAnalysisDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeReviewAnalysisRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertAnalysisRow = SqlSchema.void({
    Request: ReviewAnalysisRecord,
    execute: (analysis) =>
      sql`
        INSERT INTO review_analysis (
          session_id,
          artifact_json,
          analysis_payload_json,
          generated_at,
          stale_marker_inputs_json,
          stale_reason_flags_json,
          updated_at
        )
        VALUES (
          ${analysis.sessionId},
          ${JSON.stringify(analysis.artifact)},
          ${JSON.stringify(analysis.analysisPayload)},
          ${analysis.generatedAt},
          ${analysis.staleMarkerInputs === null ? null : JSON.stringify(analysis.staleMarkerInputs)},
          ${JSON.stringify(analysis.staleReasonFlags)},
          ${analysis.updatedAt}
        )
        ON CONFLICT (session_id)
        DO UPDATE SET
          artifact_json = excluded.artifact_json,
          analysis_payload_json = excluded.analysis_payload_json,
          generated_at = excluded.generated_at,
          stale_marker_inputs_json = excluded.stale_marker_inputs_json,
          stale_reason_flags_json = excluded.stale_reason_flags_json,
          updated_at = excluded.updated_at
      `,
  });

  const getAnalysisRow = SqlSchema.findOneOption({
    Request: GetReviewAnalysisInput,
    Result: ReviewAnalysisDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          artifact_json AS "artifact",
          analysis_payload_json AS "analysisPayload",
          generated_at AS "generatedAt",
          stale_marker_inputs_json AS "staleMarkerInputs",
          stale_reason_flags_json AS "staleReasonFlags",
          updated_at AS "updatedAt"
        FROM review_analysis
        WHERE session_id = ${sessionId}
      `,
  });

  const upsertLatest: ReviewAnalysisRepositoryShape["upsertLatest"] = (analysis) =>
    upsertAnalysisRow(analysis).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewAnalysisRepository.upsertLatest:query",
          "ReviewAnalysisRepository.upsertLatest:encodeRequest",
        ),
      ),
    );

  const getBySessionId: ReviewAnalysisRepositoryShape["getBySessionId"] = (input) =>
    getAnalysisRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewAnalysisRepository.getBySessionId:query",
          "ReviewAnalysisRepository.getBySessionId:decodeRow",
        ),
      ),
    );

  const deleteBySessionId: ReviewAnalysisRepositoryShape["deleteBySessionId"] = ({ sessionId }) =>
    sql`
      DELETE FROM review_analysis
      WHERE session_id = ${sessionId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewAnalysisRepository.deleteBySessionId:query")),
    );

  return {
    upsertLatest,
    getBySessionId,
    deleteBySessionId,
  } satisfies ReviewAnalysisRepositoryShape;
});

export const ReviewAnalysisRepositoryLive = Layer.effect(
  ReviewAnalysisRepository,
  makeReviewAnalysisRepository,
);
