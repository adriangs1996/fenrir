import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetReviewGitHubPendingDraftInput,
  ListReviewGitHubPendingDraftsInput,
  ReviewGitHubPendingDraftRecord,
  ReviewGitHubPendingDraftRepository,
  type ReviewGitHubPendingDraftRepositoryShape,
} from "../Services/ReviewGitHubDrafts.ts";
import { ReviewStableAnchor } from "@fenrir/contracts/sourceControlReview";

const ReviewGitHubPendingDraftDbRow = ReviewGitHubPendingDraftRecord.mapFields(
  Struct.assign({
    anchor: Schema.NullOr(Schema.fromJsonString(ReviewStableAnchor)),
    isOutdated: Schema.Number,
  }),
);
type ReviewGitHubPendingDraftDbRow = typeof ReviewGitHubPendingDraftDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toReviewGitHubPendingDraftRecord(
  row: ReviewGitHubPendingDraftDbRow,
): ReviewGitHubPendingDraftRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    authSessionId: row.authSessionId,
    draftKind: row.draftKind,
    anchor: row.anchor,
    body: row.body,
    isOutdated: row.isOutdated !== 0,
    submitAction: row.submitAction,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const makeReviewGitHubPendingDraftRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertDraftRow = SqlSchema.void({
    Request: ReviewGitHubPendingDraftRecord,
    execute: (draft) =>
      sql`
        INSERT INTO review_github_pending_drafts (
          draft_id,
          session_id,
          auth_session_id,
          draft_kind,
          anchor_payload_json,
          body,
          is_outdated,
          submit_action,
          created_at,
          updated_at
        )
        VALUES (
          ${draft.id},
          ${draft.sessionId},
          ${draft.authSessionId},
          ${draft.draftKind},
          ${draft.anchor === null ? null : JSON.stringify(draft.anchor)},
          ${draft.body},
          ${draft.isOutdated ? 1 : 0},
          ${draft.submitAction},
          ${draft.createdAt},
          ${draft.updatedAt}
        )
        ON CONFLICT (draft_id)
        DO UPDATE SET
          session_id = excluded.session_id,
          auth_session_id = excluded.auth_session_id,
          draft_kind = excluded.draft_kind,
          anchor_payload_json = excluded.anchor_payload_json,
          body = excluded.body,
          is_outdated = excluded.is_outdated,
          submit_action = excluded.submit_action,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getDraftRow = SqlSchema.findOneOption({
    Request: GetReviewGitHubPendingDraftInput,
    Result: ReviewGitHubPendingDraftDbRow,
    execute: ({ draftId }) =>
      sql`
        SELECT
          draft_id AS "id",
          session_id AS "sessionId",
          auth_session_id AS "authSessionId",
          draft_kind AS "draftKind",
          anchor_payload_json AS "anchor",
          body,
          is_outdated AS "isOutdated",
          submit_action AS "submitAction",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM review_github_pending_drafts
        WHERE draft_id = ${draftId}
      `,
  });

  const listDraftRows = SqlSchema.findAll({
    Request: ListReviewGitHubPendingDraftsInput,
    Result: ReviewGitHubPendingDraftDbRow,
    execute: ({ sessionId, authSessionId }) =>
      sql`
        SELECT
          draft_id AS "id",
          session_id AS "sessionId",
          auth_session_id AS "authSessionId",
          draft_kind AS "draftKind",
          anchor_payload_json AS "anchor",
          body,
          is_outdated AS "isOutdated",
          submit_action AS "submitAction",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM review_github_pending_drafts
        WHERE session_id = ${sessionId}
          AND auth_session_id = ${authSessionId}
        ORDER BY
          CASE draft_kind WHEN 'review-summary' THEN 0 ELSE 1 END ASC,
          updated_at ASC,
          draft_id ASC
      `,
  });

  const upsert: ReviewGitHubPendingDraftRepositoryShape["upsert"] = (draft) =>
    upsertDraftRow(draft).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewGitHubPendingDraftRepository.upsert:query",
          "ReviewGitHubPendingDraftRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ReviewGitHubPendingDraftRepositoryShape["getById"] = (input) =>
    getDraftRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewGitHubPendingDraftRepository.getById:query",
          "ReviewGitHubPendingDraftRepository.getById:decodeRow",
        ),
      ),
      Effect.map(Option.map(toReviewGitHubPendingDraftRecord)),
    );

  const listForViewer: ReviewGitHubPendingDraftRepositoryShape["listForViewer"] = (input) =>
    listDraftRows(input).pipe(
      Effect.map((rows) => rows.map(toReviewGitHubPendingDraftRecord)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewGitHubPendingDraftRepository.listForViewer:query",
          "ReviewGitHubPendingDraftRepository.listForViewer:decodeRows",
        ),
      ),
    );

  const deleteById: ReviewGitHubPendingDraftRepositoryShape["deleteById"] = ({ draftId }) =>
    sql`
      DELETE FROM review_github_pending_drafts
      WHERE draft_id = ${draftId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewGitHubPendingDraftRepository.deleteById:query")),
    );

  const deleteForViewer: ReviewGitHubPendingDraftRepositoryShape["deleteForViewer"] = ({
    sessionId,
    authSessionId,
  }) =>
    sql`
      DELETE FROM review_github_pending_drafts
      WHERE session_id = ${sessionId}
        AND auth_session_id = ${authSessionId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ReviewGitHubPendingDraftRepository.deleteForViewer:query"),
      ),
    );

  const deleteForSession: ReviewGitHubPendingDraftRepositoryShape["deleteForSession"] = ({
    sessionId,
  }) =>
    sql`
      DELETE FROM review_github_pending_drafts
      WHERE session_id = ${sessionId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ReviewGitHubPendingDraftRepository.deleteForSession:query"),
      ),
    );

  const markSessionDraftsOutdated: ReviewGitHubPendingDraftRepositoryShape["markSessionDraftsOutdated"] =
    ({ sessionId, markedOutdatedAt }) =>
      sql`
        UPDATE review_github_pending_drafts
        SET is_outdated = 1,
            updated_at = ${markedOutdatedAt}
        WHERE session_id = ${sessionId}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError(
            "ReviewGitHubPendingDraftRepository.markSessionDraftsOutdated:query",
          ),
        ),
      );

  return {
    upsert,
    getById,
    listForViewer,
    deleteById,
    deleteForViewer,
    deleteForSession,
    markSessionDraftsOutdated,
  } satisfies ReviewGitHubPendingDraftRepositoryShape;
});

export const ReviewGitHubPendingDraftRepositoryLive = Layer.effect(
  ReviewGitHubPendingDraftRepository,
  makeReviewGitHubPendingDraftRepository,
);
