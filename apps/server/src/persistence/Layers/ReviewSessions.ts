import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  FindActiveReviewSessionInput,
  GetReviewSessionInput,
  ListReviewSessionsByThreadInput,
  ReviewSessionRecord,
  ReviewSessionRepository,
  type ReviewSessionRepositoryShape,
} from "../Services/ReviewSessions.ts";
import { ReviewSessionTarget } from "@fenrir/contracts/sourceControlReview";

const ReviewSessionDbRow = ReviewSessionRecord.mapFields(
  Struct.assign({
    target: Schema.fromJsonString(ReviewSessionTarget),
  }),
);
type ReviewSessionDbRow = typeof ReviewSessionDbRow.Type;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toReviewSessionRecord(row: ReviewSessionDbRow): ReviewSessionRecord {
  return {
    sessionId: row.sessionId,
    threadId: row.threadId,
    projectId: row.projectId,
    checkoutPath: row.checkoutPath,
    mode: row.mode,
    scope: row.scope,
    target: row.target,
    pullRequestOverrideProvider: row.pullRequestOverrideProvider,
    pullRequestOverrideNumber: row.pullRequestOverrideNumber,
    pullRequestOverrideUrl: row.pullRequestOverrideUrl,
    pullRequestProvider: row.pullRequestProvider,
    pullRequestNumber: row.pullRequestNumber,
    pullRequestUrl: row.pullRequestUrl,
    baseBranchOverride: row.baseBranchOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivatedAt: row.lastActivatedAt,
    archivedAt: row.archivedAt,
  };
}

const makeReviewSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertSessionRow = SqlSchema.void({
    Request: ReviewSessionRecord,
    execute: (session) =>
      sql`
        INSERT INTO review_sessions (
          session_id,
          thread_id,
          project_id,
          checkout_path,
          mode,
          scope,
          target_json,
          pull_request_override_provider,
          pull_request_override_number,
          pull_request_override_url,
          pull_request_provider,
          pull_request_number,
          pull_request_url,
          base_branch_override,
          created_at,
          updated_at,
          last_activated_at,
          archived_at
        )
        VALUES (
          ${session.sessionId},
          ${session.threadId},
          ${session.projectId},
          ${session.checkoutPath},
          ${session.mode},
          ${session.scope},
          ${JSON.stringify(session.target)},
          ${session.pullRequestOverrideProvider},
          ${session.pullRequestOverrideNumber},
          ${session.pullRequestOverrideUrl},
          ${session.pullRequestProvider},
          ${session.pullRequestNumber},
          ${session.pullRequestUrl},
          ${session.baseBranchOverride},
          ${session.createdAt},
          ${session.updatedAt},
          ${session.lastActivatedAt},
          ${session.archivedAt}
        )
        ON CONFLICT (session_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          project_id = excluded.project_id,
          checkout_path = excluded.checkout_path,
          mode = excluded.mode,
          scope = excluded.scope,
          target_json = excluded.target_json,
          pull_request_override_provider = excluded.pull_request_override_provider,
          pull_request_override_number = excluded.pull_request_override_number,
          pull_request_override_url = excluded.pull_request_override_url,
          pull_request_provider = excluded.pull_request_provider,
          pull_request_number = excluded.pull_request_number,
          pull_request_url = excluded.pull_request_url,
          base_branch_override = excluded.base_branch_override,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_activated_at = excluded.last_activated_at,
          archived_at = excluded.archived_at
      `,
  });

  const getSessionRow = SqlSchema.findOneOption({
    Request: GetReviewSessionInput,
    Result: ReviewSessionDbRow,
    execute: ({ sessionId }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          thread_id AS "threadId",
          project_id AS "projectId",
          checkout_path AS "checkoutPath",
          mode AS "mode",
          scope AS "scope",
          target_json AS "target",
          pull_request_override_provider AS "pullRequestOverrideProvider",
          pull_request_override_number AS "pullRequestOverrideNumber",
          pull_request_override_url AS "pullRequestOverrideUrl",
          pull_request_provider AS "pullRequestProvider",
          pull_request_number AS "pullRequestNumber",
          pull_request_url AS "pullRequestUrl",
          base_branch_override AS "baseBranchOverride",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_activated_at AS "lastActivatedAt",
          archived_at AS "archivedAt"
        FROM review_sessions
        WHERE session_id = ${sessionId}
      `,
  });

  const findActiveSessionRow = SqlSchema.findOneOption({
    Request: FindActiveReviewSessionInput,
    Result: ReviewSessionDbRow,
    execute: ({ threadId, checkoutPath }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          thread_id AS "threadId",
          project_id AS "projectId",
          checkout_path AS "checkoutPath",
          mode AS "mode",
          scope AS "scope",
          target_json AS "target",
          pull_request_override_provider AS "pullRequestOverrideProvider",
          pull_request_override_number AS "pullRequestOverrideNumber",
          pull_request_override_url AS "pullRequestOverrideUrl",
          pull_request_provider AS "pullRequestProvider",
          pull_request_number AS "pullRequestNumber",
          pull_request_url AS "pullRequestUrl",
          base_branch_override AS "baseBranchOverride",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_activated_at AS "lastActivatedAt",
          archived_at AS "archivedAt"
        FROM review_sessions
        WHERE thread_id = ${threadId}
          AND checkout_path = ${checkoutPath}
          AND archived_at IS NULL
        ORDER BY last_activated_at DESC, session_id ASC
        LIMIT 1
      `,
  });

  const listSessionRowsByThread = SqlSchema.findAll({
    Request: ListReviewSessionsByThreadInput,
    Result: ReviewSessionDbRow,
    execute: ({ threadId, includeArchived }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          thread_id AS "threadId",
          project_id AS "projectId",
          checkout_path AS "checkoutPath",
          mode AS "mode",
          scope AS "scope",
          target_json AS "target",
          pull_request_override_provider AS "pullRequestOverrideProvider",
          pull_request_override_number AS "pullRequestOverrideNumber",
          pull_request_override_url AS "pullRequestOverrideUrl",
          pull_request_provider AS "pullRequestProvider",
          pull_request_number AS "pullRequestNumber",
          pull_request_url AS "pullRequestUrl",
          base_branch_override AS "baseBranchOverride",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_activated_at AS "lastActivatedAt",
          archived_at AS "archivedAt"
        FROM review_sessions
        WHERE thread_id = ${threadId}
          AND (${(includeArchived ?? false) ? 1 : 0} = 1 OR archived_at IS NULL)
        ORDER BY archived_at IS NOT NULL ASC, last_activated_at DESC, session_id ASC
      `,
  });

  const upsert: ReviewSessionRepositoryShape["upsert"] = (session) =>
    upsertSessionRow(session).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewSessionRepository.upsert:query",
          "ReviewSessionRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ReviewSessionRepositoryShape["getById"] = (input) =>
    getSessionRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewSessionRepository.getById:query",
          "ReviewSessionRepository.getById:decodeRow",
        ),
      ),
      Effect.map(Option.map(toReviewSessionRecord)),
    );

  const findActiveByThread: ReviewSessionRepositoryShape["findActiveByThread"] = (input) =>
    findActiveSessionRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewSessionRepository.findActiveByThread:query",
          "ReviewSessionRepository.findActiveByThread:decodeRow",
        ),
      ),
      Effect.map(Option.map(toReviewSessionRecord)),
    );

  const listByThreadId: ReviewSessionRepositoryShape["listByThreadId"] = (input) =>
    listSessionRowsByThread(input).pipe(
      Effect.map((rows) => rows.map(toReviewSessionRecord)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewSessionRepository.listByThreadId:query",
          "ReviewSessionRepository.listByThreadId:decodeRows",
        ),
      ),
    );

  const archive: ReviewSessionRepositoryShape["archive"] = ({ sessionId, archivedAt, updatedAt }) =>
    sql`
      UPDATE review_sessions
      SET archived_at = ${archivedAt}, updated_at = ${updatedAt}
      WHERE session_id = ${sessionId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewSessionRepository.archive:query")),
    );

  return {
    upsert,
    getById,
    findActiveByThread,
    listByThreadId,
    archive,
  } satisfies ReviewSessionRepositoryShape;
});

export const ReviewSessionRepositoryLive = Layer.effect(
  ReviewSessionRepository,
  makeReviewSessionRepository,
);
