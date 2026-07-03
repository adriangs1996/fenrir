import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionRetention,
  type ProjectionRetentionShape,
} from "../Services/ProjectionRetention.ts";

const makeProjectionRetention = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Every per-thread table is deletable in bounded batches through a rowid
  // subquery (`DELETE ... LIMIT` needs a non-default SQLite build flag). The
  // statements are written out per table because the sql template only
  // interpolates values, not identifiers.
  const purgeBatchStatements = [
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_thread_activities
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_thread_messages
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_turns
      WHERE rowid IN (
        SELECT rowid FROM projection_turns
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_thread_proposed_plans
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_thread_sessions
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_pending_approvals
      WHERE rowid IN (
        SELECT rowid FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
    (threadId: string, limit: number) => sql`
      DELETE FROM projection_thread_image_artifacts
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_image_artifacts
        WHERE thread_id = ${threadId}
        LIMIT ${limit}
      )
      RETURNING rowid
    `,
  ] as const;

  const listPurgeableDeletedThreadIds: ProjectionRetentionShape["listPurgeableDeletedThreadIds"] = (
    input,
  ) => {
    const normalizedLimit = Math.max(0, Math.floor(input.limit));
    if (normalizedLimit === 0) {
      return Effect.succeed([]);
    }
    return sql`
        SELECT threads.thread_id AS "threadId"
        FROM projection_threads AS threads
        WHERE threads.deleted_at IS NOT NULL
          AND threads.deleted_at < ${input.deletedBeforeIso}
          AND (
            EXISTS (
              SELECT 1 FROM projection_thread_activities
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_thread_messages
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_turns
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_thread_proposed_plans
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_thread_sessions
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_pending_approvals
              WHERE thread_id = threads.thread_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_thread_image_artifacts
              WHERE thread_id = threads.thread_id
            )
          )
        ORDER BY threads.deleted_at ASC, threads.thread_id ASC
        LIMIT ${normalizedLimit}
      `.pipe(
      Effect.map((rows) => rows.map((row) => String((row as { threadId: string }).threadId))),
      Effect.mapError(
        toPersistenceSqlError("ProjectionRetention.listPurgeableDeletedThreadIds:query"),
      ),
    );
  };

  const purgeDeletedThreadRowsBatch: ProjectionRetentionShape["purgeDeletedThreadRowsBatch"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const normalizedLimit = Math.max(0, Math.floor(input.limit));
      if (normalizedLimit === 0) {
        return 0;
      }
      let deletedCount = 0;
      for (const deleteBatch of purgeBatchStatements) {
        const remaining = normalizedLimit - deletedCount;
        if (remaining <= 0) {
          break;
        }
        const rows = yield* deleteBatch(input.threadId, remaining);
        deletedCount += rows.length;
      }
      return deletedCount;
    }).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionRetention.purgeDeletedThreadRowsBatch")),
    );

  const listActivityCapExceedingThreadIds: ProjectionRetentionShape["listActivityCapExceedingThreadIds"] =
    (input) => {
      const keepCount = Math.max(0, Math.floor(input.keepCount));
      return sql`
        SELECT thread_id AS "threadId"
        FROM projection_thread_activities
        GROUP BY thread_id
        HAVING COUNT(*) > ${keepCount}
        ORDER BY thread_id ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => String((row as { threadId: string }).threadId))),
        Effect.mapError(
          toPersistenceSqlError("ProjectionRetention.listActivityCapExceedingThreadIds:query"),
        ),
      );
    };

  const getActivityCapCutoff: ProjectionRetentionShape["getActivityCapCutoff"] = (input) => {
    const keepCount = Math.max(1, Math.floor(input.keepCount));
    return sql`
      SELECT created_at AS "createdAt"
      FROM projection_thread_activities
      WHERE thread_id = ${input.threadId}
      ORDER BY created_at DESC
      LIMIT 1 OFFSET ${keepCount - 1}
    `.pipe(
      Effect.map((rows) =>
        rows.length === 0 ? null : String((rows[0] as { createdAt: string }).createdAt),
      ),
      Effect.mapError(toPersistenceSqlError("ProjectionRetention.getActivityCapCutoff:query")),
    );
  };

  const pruneActivitiesBefore: ProjectionRetentionShape["pruneActivitiesBefore"] = (input) => {
    const normalizedLimit = Math.max(0, Math.floor(input.limit));
    if (normalizedLimit === 0) {
      return Effect.succeed(0);
    }
    return sql`
      DELETE FROM projection_thread_activities
      WHERE rowid IN (
        SELECT rowid FROM projection_thread_activities
        WHERE thread_id = ${input.threadId}
          AND created_at < ${input.beforeIso}
        ORDER BY created_at ASC
        LIMIT ${normalizedLimit}
      )
      RETURNING rowid
    `.pipe(
      Effect.map((rows) => rows.length),
      Effect.mapError(toPersistenceSqlError("ProjectionRetention.pruneActivitiesBefore:delete")),
    );
  };

  return {
    listPurgeableDeletedThreadIds,
    purgeDeletedThreadRowsBatch,
    listActivityCapExceedingThreadIds,
    getActivityCapCutoff,
    pruneActivitiesBefore,
  } satisfies ProjectionRetentionShape;
});

export const ProjectionRetentionLive = Layer.effect(ProjectionRetention, makeProjectionRetention);
