import {
  FeatureState,
  IsoDateTime,
  ModelSelection,
  NonNegativeInt,
  PlanNode,
  PlanRunId,
  PlanRunnerStepSnapshot,
  PlanRunnerThreadRef,
  PlanRunSnapshot,
  ProjectId,
  TrimmedNonEmptyString,
} from "@fenrir/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteRunInput,
  GetFeatureRunInput,
  GetRunByIdInput,
  ListFeatureSummariesInput,
  ListInternalThreadRefsInput,
  ListSyntheticLogEntriesInput,
  PlanRunnerFeatureRunSummary,
  PlanRunnerInternalThreadRow,
  PlanRunnerRepository,
  PlanRunnerRunRow,
  PlanRunnerStepRow,
  PlanRunnerSyntheticLogEntryRow,
  ReplaceFeatureRunResult,
  type PlanRunnerRepositoryShape,
} from "../Services/PlanRunnerRepository.ts";

// ─── DB row schemas (decode JSON columns + INTEGER booleans) ────────────────

/**
 * Run row as it appears on the wire from SQLite. `ownsWorktree` is decoded
 * from INTEGER (0/1) post-query because there is no portable
 * `Schema.transform` helper here.
 */
const PlanRunnerRunDbRow = PlanRunnerRunRow.mapFields(
  Struct.assign({
    ownsWorktree: Schema.Number,
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
type PlanRunnerRunDbRow = typeof PlanRunnerRunDbRow.Type;

const PlanRunnerStepDbRow = PlanRunnerStepRow.mapFields(
  Struct.assign({
    dependsOn: Schema.fromJsonString(Schema.Array(Schema.String)),
  }),
);
type PlanRunnerStepDbRow = typeof PlanRunnerStepDbRow.Type;

const PlanRunnerSyntheticLogEntryDbRow = PlanRunnerSyntheticLogEntryRow.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
  }),
);
type PlanRunnerSyntheticLogEntryDbRow = typeof PlanRunnerSyntheticLogEntryDbRow.Type;

const PlanRunnerFeatureSummaryDbRow = Schema.Struct({
  featureName: TrimmedNonEmptyString,
  runId: PlanRunId,
  state: FeatureState,
  lastUpdatedAt: IsoDateTime,
});
type PlanRunnerFeatureSummaryDbRow = typeof PlanRunnerFeatureSummaryDbRow.Type;

// ─── Helpers ────────────────────────────────────────────────────────────────

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const TERMINAL_FEATURE_STATES: ReadonlyArray<FeatureState> = ["completed", "failed"] as const;

function isActiveFeatureState(state: FeatureState): boolean {
  return !TERMINAL_FEATURE_STATES.includes(state);
}

function dbRowToRunRow(row: PlanRunnerRunDbRow): PlanRunnerRunRow {
  return {
    runId: row.runId,
    projectId: row.projectId,
    featureName: row.featureName,
    state: row.state,
    summary: row.summary,
    branch: row.branch,
    worktreePath: row.worktreePath,
    ownsWorktree: row.ownsWorktree !== 0,
    modelSelection: row.modelSelection,
    maxConcurrency: row.maxConcurrency,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}

function dbRowToStepRow(row: PlanRunnerStepDbRow): PlanRunnerStepRow {
  return {
    runId: row.runId,
    stepKey: row.stepKey,
    stepKind: row.stepKind,
    planId: row.planId,
    filename: row.filename,
    planMarkdown: row.planMarkdown,
    dependsOn: row.dependsOn,
    state: row.state,
    maxRetries: row.maxRetries,
    retriesUsed: row.retriesUsed,
    error: row.error,
    failureSummary: row.failureSummary,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    executionOrder: row.executionOrder,
  };
}

function dbRowToSyntheticEntryRow(
  row: PlanRunnerSyntheticLogEntryDbRow,
): PlanRunnerSyntheticLogEntryRow {
  return {
    runId: row.runId,
    stepKey: row.stepKey,
    sequence: row.sequence,
    kind: row.kind,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    bodyText: row.bodyText,
    copyText: row.copyText,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

/**
 * Build a `PlanRunSnapshot` from normalized rows.
 *
 * - `plans`: every plan-kind step row, so blocked/ready/not-yet-started plans
 *   still appear in the graph.
 * - `steps`: started rows only (`startedAt IS NOT NULL`) — the unified
 *   step-history projection.
 * - `analyzerThreadId`/`integrationThreadId`: latest thread of each role by
 *   `createdAt` ascending; runtime only persists one but recoveries may
 *   leave stale rows.
 */
function buildSnapshot(
  run: PlanRunnerRunRow,
  steps: ReadonlyArray<PlanRunnerStepRow>,
  threads: ReadonlyArray<PlanRunnerInternalThreadRow>,
): PlanRunSnapshot {
  const stepThreadsByKey = new Map<string, PlanRunnerInternalThreadRow[]>();
  for (const t of threads) {
    const list = stepThreadsByKey.get(t.stepKey) ?? [];
    list.push(t);
    stepThreadsByKey.set(t.stepKey, list);
  }

  const plans: PlanNode[] = steps
    .filter((s) => s.stepKind === "plan" && s.planId !== null && s.filename !== null)
    .map((s) => {
      const stepThreads = stepThreadsByKey.get(s.stepKey) ?? [];
      const executor = stepThreads.find((t) => t.threadRole === "executor");
      // Outer filter ensures planId/filename non-null; bang here because
      // Array.filter does not narrow element types.
      return {
        planId: s.planId!,
        filename: s.filename!,
        state: s.state,
        dependsOn: s.dependsOn,
        maxRetries: s.maxRetries,
        retriesUsed: s.retriesUsed,
        executorThreadId: executor?.threadId ?? null,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      } satisfies PlanNode;
    });

  const stepHistory: PlanRunnerStepSnapshot[] = steps
    .filter((s) => s.startedAt !== null)
    .map((s) => {
      const stepThreads = stepThreadsByKey.get(s.stepKey) ?? [];
      const refs: PlanRunnerThreadRef[] = stepThreads.map((t) => ({
        threadId: t.threadId,
        role: t.threadRole,
      }));
      return {
        stepKey: s.stepKey,
        kind: s.stepKind,
        planId: s.planId,
        filename: s.filename,
        state: s.state,
        failureSummary: s.failureSummary,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        executionOrder: s.executionOrder,
        threadRefs: refs,
      } satisfies PlanRunnerStepSnapshot;
    });

  const analyzerThreads = threads
    .filter((t) => t.threadRole === "analyzer")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const integrationThreads = threads
    .filter((t) => t.threadRole === "integration")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    runId: run.runId,
    featureName: run.featureName,
    projectId: run.projectId,
    branch: run.branch,
    worktreePath: run.worktreePath,
    state: run.state,
    plans,
    maxConcurrency: run.maxConcurrency,
    analyzerThreadId: analyzerThreads.at(-1)?.threadId ?? null,
    integrationThreadId: integrationThreads.at(-1)?.threadId ?? null,
    steps: stepHistory,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    lastUpdatedAt: run.lastUpdatedAt,
    summary: run.summary,
  };
}

// ─── Layer ──────────────────────────────────────────────────────────────────

const makePlanRunnerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── Reads ─────────────────────────────────────────────────────────

  const findRunByFeature = SqlSchema.findOneOption({
    Request: GetFeatureRunInput,
    Result: PlanRunnerRunDbRow,
    execute: ({ projectId, featureName }) =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          feature_name AS "featureName",
          state,
          summary,
          branch,
          worktree_path AS "worktreePath",
          owns_worktree AS "ownsWorktree",
          model_selection_json AS "modelSelection",
          max_concurrency AS "maxConcurrency",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        WHERE project_id = ${projectId}
          AND feature_name = ${featureName}
        LIMIT 1
      `,
  });

  const findRunById = SqlSchema.findOneOption({
    Request: GetRunByIdInput,
    Result: PlanRunnerRunDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          feature_name AS "featureName",
          state,
          summary,
          branch,
          worktree_path AS "worktreePath",
          owns_worktree AS "ownsWorktree",
          model_selection_json AS "modelSelection",
          max_concurrency AS "maxConcurrency",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        WHERE run_id = ${runId}
        LIMIT 1
      `,
  });

  const listAllRuns = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: PlanRunnerRunDbRow,
    execute: () =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          feature_name AS "featureName",
          state,
          summary,
          branch,
          worktree_path AS "worktreePath",
          owns_worktree AS "ownsWorktree",
          model_selection_json AS "modelSelection",
          max_concurrency AS "maxConcurrency",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        ORDER BY started_at ASC, run_id ASC
      `,
  });

  const listRunsByProject = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: PlanRunnerRunDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          feature_name AS "featureName",
          state,
          summary,
          branch,
          worktree_path AS "worktreePath",
          owns_worktree AS "ownsWorktree",
          model_selection_json AS "modelSelection",
          max_concurrency AS "maxConcurrency",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        WHERE project_id = ${projectId}
        ORDER BY started_at ASC, run_id ASC
      `,
  });

  const listRecoverableRunRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: PlanRunnerRunDbRow,
    execute: () =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          feature_name AS "featureName",
          state,
          summary,
          branch,
          worktree_path AS "worktreePath",
          owns_worktree AS "ownsWorktree",
          model_selection_json AS "modelSelection",
          max_concurrency AS "maxConcurrency",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        WHERE state IN ('analyzing', 'executing', 'integrating', 'recovering')
        ORDER BY started_at ASC, run_id ASC
      `,
  });

  const listStepRowsForRun = SqlSchema.findAll({
    Request: Schema.Struct({ runId: PlanRunId }),
    Result: PlanRunnerStepDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          step_key AS "stepKey",
          step_kind AS "stepKind",
          plan_id AS "planId",
          filename,
          plan_markdown AS "planMarkdown",
          depends_on_json AS "dependsOn",
          state,
          max_retries AS "maxRetries",
          retries_used AS "retriesUsed",
          error,
          failure_summary AS "failureSummary",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          execution_order AS "executionOrder"
        FROM plan_runner_steps
        WHERE run_id = ${runId}
        ORDER BY execution_order ASC, started_at ASC, step_key ASC
      `,
  });

  const listInternalThreadRowsForRun = SqlSchema.findAll({
    Request: ListInternalThreadRefsInput,
    Result: PlanRunnerInternalThreadRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          step_key AS "stepKey",
          thread_id AS "threadId",
          thread_role AS "threadRole",
          created_at AS "createdAt"
        FROM plan_runner_internal_threads
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listSyntheticLogRowsForStep = SqlSchema.findAll({
    Request: ListSyntheticLogEntriesInput,
    Result: PlanRunnerSyntheticLogEntryDbRow,
    execute: ({ runId, stepKey }) =>
      sql`
        SELECT
          run_id AS "runId",
          step_key AS "stepKey",
          sequence,
          kind,
          title,
          body_markdown AS "bodyMarkdown",
          body_text AS "bodyText",
          copy_text AS "copyText",
          payload_json AS "payload",
          created_at AS "createdAt"
        FROM plan_runner_synthetic_log_entries
        WHERE run_id = ${runId}
          AND step_key = ${stepKey}
        ORDER BY sequence ASC
      `,
  });

  const listFeatureSummaryRows = SqlSchema.findAll({
    Request: ListFeatureSummariesInput,
    Result: PlanRunnerFeatureSummaryDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          feature_name AS "featureName",
          run_id AS "runId",
          state,
          last_updated_at AS "lastUpdatedAt"
        FROM plan_runner_feature_runs
        WHERE project_id = ${projectId}
        ORDER BY feature_name ASC
      `,
  });

  // ── Snapshot reconstruction (run row + lazy step/thread fetch) ────

  const fetchRunChildren = (runId: PlanRunId) =>
    Effect.gen(function* () {
      const stepRowsRaw = yield* listStepRowsForRun({ runId });
      const threadRows = yield* listInternalThreadRowsForRun({ runId });
      const stepRows = stepRowsRaw.map(dbRowToStepRow);
      return { stepRows, threadRows };
    });

  const reconstructSnapshot = (runDbRow: PlanRunnerRunDbRow) =>
    Effect.gen(function* () {
      const runRow = dbRowToRunRow(runDbRow);
      const { stepRows, threadRows } = yield* fetchRunChildren(runRow.runId);
      return buildSnapshot(runRow, stepRows, threadRows);
    });

  // ── Writes ────────────────────────────────────────────────────────

  const insertRunRow = SqlSchema.void({
    Request: PlanRunnerRunRow,
    execute: (row) =>
      sql`
        INSERT INTO plan_runner_feature_runs (
          run_id,
          project_id,
          feature_name,
          state,
          summary,
          branch,
          worktree_path,
          owns_worktree,
          model_selection_json,
          max_concurrency,
          started_at,
          completed_at,
          last_updated_at
        )
        VALUES (
          ${row.runId},
          ${row.projectId},
          ${row.featureName},
          ${row.state},
          ${row.summary},
          ${row.branch},
          ${row.worktreePath},
          ${row.ownsWorktree ? 1 : 0},
          ${JSON.stringify(row.modelSelection)},
          ${row.maxConcurrency},
          ${row.startedAt},
          ${row.completedAt},
          ${row.lastUpdatedAt}
        )
      `,
  });

  const insertStepRow = SqlSchema.void({
    Request: PlanRunnerStepRow,
    execute: (row) =>
      sql`
        INSERT INTO plan_runner_steps (
          run_id,
          step_key,
          step_kind,
          plan_id,
          filename,
          plan_markdown,
          depends_on_json,
          state,
          max_retries,
          retries_used,
          error,
          failure_summary,
          started_at,
          completed_at,
          execution_order
        )
        VALUES (
          ${row.runId},
          ${row.stepKey},
          ${row.stepKind},
          ${row.planId},
          ${row.filename},
          ${row.planMarkdown},
          ${JSON.stringify(row.dependsOn)},
          ${row.state},
          ${row.maxRetries},
          ${row.retriesUsed},
          ${row.error},
          ${row.failureSummary},
          ${row.startedAt},
          ${row.completedAt},
          ${row.executionOrder}
        )
      `,
  });

  const insertInternalThreadRow = SqlSchema.void({
    Request: PlanRunnerInternalThreadRow,
    execute: (row) =>
      sql`
        INSERT INTO plan_runner_internal_threads (
          run_id,
          step_key,
          thread_id,
          thread_role,
          created_at
        )
        VALUES (
          ${row.runId},
          ${row.stepKey},
          ${row.threadId},
          ${row.threadRole},
          ${row.createdAt}
        )
      `,
  });

  const deleteRunRow = SqlSchema.void({
    Request: DeleteRunInput,
    execute: ({ runId }) =>
      sql`
        DELETE FROM plan_runner_feature_runs
        WHERE run_id = ${runId}
      `,
  });

  const insertRunBundle = (
    run: PlanRunnerRunRow,
    steps: ReadonlyArray<PlanRunnerStepRow>,
    threads: ReadonlyArray<PlanRunnerInternalThreadRow>,
  ) =>
    Effect.gen(function* () {
      yield* insertRunRow(run);
      for (const step of steps) {
        yield* insertStepRow(step);
      }
      for (const thread of threads) {
        yield* insertInternalThreadRow(thread);
      }
    });

  // ── Service implementation ────────────────────────────────────────

  const getFeatureRun: PlanRunnerRepositoryShape["getFeatureRun"] = (input) =>
    findRunByFeature(input).pipe(
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none<PlanRunSnapshot>()),
          onSome: (row) => reconstructSnapshot(row).pipe(Effect.map(Option.some)),
        }),
      ),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.getFeatureRun:query",
          "PlanRunnerRepository.getFeatureRun:decodeRows",
        ),
      ),
    );

  const getRunById: PlanRunnerRepositoryShape["getRunById"] = (input) =>
    findRunById(input).pipe(
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none<PlanRunSnapshot>()),
          onSome: (row) => reconstructSnapshot(row).pipe(Effect.map(Option.some)),
        }),
      ),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.getRunById:query",
          "PlanRunnerRepository.getRunById:decodeRows",
        ),
      ),
    );

  const listRuns: PlanRunnerRepositoryShape["listRuns"] = (input) =>
    Effect.gen(function* () {
      const rows = input.projectId
        ? yield* listRunsByProject({ projectId: input.projectId })
        : yield* listAllRuns({});
      const snapshots: PlanRunSnapshot[] = [];
      for (const row of rows) {
        snapshots.push(yield* reconstructSnapshot(row));
      }
      return snapshots as ReadonlyArray<PlanRunSnapshot>;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.listRuns:query",
          "PlanRunnerRepository.listRuns:decodeRows",
        ),
      ),
    );

  const listFeatureSummaries: PlanRunnerRepositoryShape["listFeatureSummaries"] = (input) =>
    listFeatureSummaryRows(input).pipe(
      Effect.map((rows) =>
        rows.map((row): PlanRunnerFeatureRunSummary => {
          const active = isActiveFeatureState(row.state);
          return {
            featureName: row.featureName,
            hasActiveRun: active,
            activeRunId: active ? row.runId : null,
            lastRunId: row.runId,
            lastRunState: row.state,
            lastRunUpdatedAt: row.lastUpdatedAt,
          };
        }),
      ),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.listFeatureSummaries:query",
          "PlanRunnerRepository.listFeatureSummaries:decodeRows",
        ),
      ),
    );

  const insertRunSnapshot: PlanRunnerRepositoryShape["insertRunSnapshot"] = (input) =>
    sql
      .withTransaction(insertRunBundle(input.run, input.steps, input.internalThreads))
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "PlanRunnerRepository.insertRunSnapshot:query",
            "PlanRunnerRepository.insertRunSnapshot:encodeRequest",
          ),
        ),
      );

  const replaceFeatureRun: PlanRunnerRepositoryShape["replaceFeatureRun"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existingByFeature = yield* findRunByFeature({
            projectId: input.projectId,
            featureName: input.featureName,
          });
          const existingId = Option.match(existingByFeature, {
            onNone: () => null as PlanRunId | null,
            onSome: (row) => row.runId,
          });

          // Delete prior run row by feature lookup. Cascade clears steps,
          // internal threads, and synthetic log entries.
          if (existingId !== null) {
            yield* deleteRunRow({ runId: existingId });
          }

          // Defensive: if caller supplied a different oldRunId hint, also
          // remove that row to avoid leaking orphan state across mismatched
          // states between caller cache and DB.
          if (input.oldRunId && input.oldRunId !== existingId) {
            yield* deleteRunRow({ runId: input.oldRunId });
          }

          yield* insertRunBundle(input.run, input.steps, input.internalThreads);

          return { deletedRunId: existingId } satisfies ReplaceFeatureRunResult;
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "PlanRunnerRepository.replaceFeatureRun:query",
            "PlanRunnerRepository.replaceFeatureRun:encodeRequest",
          ),
        ),
      );

  // Single UPDATE that touches `last_updated_at` plus whichever optional
  // fields were patched. COALESCE-with-current-row preserves untouched
  // columns; CASE guards distinguish "explicitly null" from "absent".
  const updateRunState: PlanRunnerRepositoryShape["updateRunState"] = ({ runId, patch }) =>
    sql`
      UPDATE plan_runner_feature_runs
      SET
        state = COALESCE(${patch.state ?? null}, state),
        summary = CASE
          WHEN ${patch.summary !== undefined ? 1 : 0} = 1
            THEN ${patch.summary === undefined ? null : patch.summary}
          ELSE summary
        END,
        completed_at = CASE
          WHEN ${patch.completedAt !== undefined ? 1 : 0} = 1
            THEN ${patch.completedAt === undefined ? null : patch.completedAt}
          ELSE completed_at
        END,
        last_updated_at = ${patch.lastUpdatedAt}
      WHERE run_id = ${runId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("PlanRunnerRepository.updateRunState:query")),
    );

  const updateStepState: PlanRunnerRepositoryShape["updateStepState"] = ({
    runId,
    stepKey,
    patch,
    lastUpdatedAt,
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE plan_runner_steps
            SET
              state = COALESCE(${patch.state ?? null}, state),
              error = CASE
                WHEN ${patch.error !== undefined ? 1 : 0} = 1
                  THEN ${patch.error === undefined ? null : patch.error}
                ELSE error
              END,
              failure_summary = CASE
                WHEN ${patch.failureSummary !== undefined ? 1 : 0} = 1
                  THEN ${patch.failureSummary === undefined ? null : patch.failureSummary}
                ELSE failure_summary
              END,
              retries_used = COALESCE(${patch.retriesUsed ?? null}, retries_used),
              started_at = CASE
                WHEN ${patch.startedAt !== undefined ? 1 : 0} = 1
                  THEN ${patch.startedAt === undefined ? null : patch.startedAt}
                ELSE started_at
              END,
              completed_at = CASE
                WHEN ${patch.completedAt !== undefined ? 1 : 0} = 1
                  THEN ${patch.completedAt === undefined ? null : patch.completedAt}
                ELSE completed_at
              END
            WHERE run_id = ${runId}
              AND step_key = ${stepKey}
          `;
          yield* sql`
            UPDATE plan_runner_feature_runs
            SET last_updated_at = ${lastUpdatedAt}
            WHERE run_id = ${runId}
          `;
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("PlanRunnerRepository.updateStepState:query")));

  const setStepExecutionOrder: PlanRunnerRepositoryShape["setStepExecutionOrder"] = ({
    runId,
    stepKey,
    executionOrder,
    lastUpdatedAt,
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE plan_runner_steps
            SET execution_order = ${executionOrder}
            WHERE run_id = ${runId}
              AND step_key = ${stepKey}
          `;
          yield* sql`
            UPDATE plan_runner_feature_runs
            SET last_updated_at = ${lastUpdatedAt}
            WHERE run_id = ${runId}
          `;
        }),
      )
      .pipe(
        Effect.mapError(toPersistenceSqlError("PlanRunnerRepository.setStepExecutionOrder:query")),
      );

  const appendSyntheticLogEntry: PlanRunnerRepositoryShape["appendSyntheticLogEntry"] = ({
    runId,
    stepKey,
    entry,
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          // Compute next sequence atomically — readers and writers race on
          // (run_id, step_key) without this lock.
          const seqRows = yield* sql<{ readonly next: number }>`
            SELECT COALESCE(MAX(sequence) + 1, 0) AS "next"
            FROM plan_runner_synthetic_log_entries
            WHERE run_id = ${runId}
              AND step_key = ${stepKey}
          `;
          const nextSequence: number = seqRows[0]?.next ?? 0;
          const sequence = NonNegativeInt.make(nextSequence);
          const payloadJson = JSON.stringify(entry.payload ?? null);
          yield* sql`
            INSERT INTO plan_runner_synthetic_log_entries (
              run_id,
              step_key,
              sequence,
              kind,
              title,
              body_markdown,
              body_text,
              copy_text,
              payload_json,
              created_at
            )
            VALUES (
              ${runId},
              ${stepKey},
              ${sequence},
              ${entry.kind},
              ${entry.title},
              ${entry.bodyMarkdown},
              ${entry.bodyText},
              ${entry.copyText},
              ${payloadJson},
              ${entry.createdAt}
            )
          `;
          yield* sql`
            UPDATE plan_runner_feature_runs
            SET last_updated_at = ${entry.createdAt}
            WHERE run_id = ${runId}
          `;
          return {
            runId,
            stepKey,
            sequence,
            kind: entry.kind,
            title: entry.title,
            bodyMarkdown: entry.bodyMarkdown,
            bodyText: entry.bodyText,
            copyText: entry.copyText,
            payload: entry.payload,
            createdAt: entry.createdAt,
          } satisfies PlanRunnerSyntheticLogEntryRow;
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("PlanRunnerRepository.appendSyntheticLogEntry:query"),
        ),
      );

  const listSyntheticLogEntries: PlanRunnerRepositoryShape["listSyntheticLogEntries"] = (input) =>
    listSyntheticLogRowsForStep(input).pipe(
      Effect.map((rows) => rows.map(dbRowToSyntheticEntryRow)),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.listSyntheticLogEntries:query",
          "PlanRunnerRepository.listSyntheticLogEntries:decodeRows",
        ),
      ),
    );

  const listInternalThreadRefs: PlanRunnerRepositoryShape["listInternalThreadRefs"] = (input) =>
    listInternalThreadRowsForRun(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.listInternalThreadRefs:query",
          "PlanRunnerRepository.listInternalThreadRefs:decodeRows",
        ),
      ),
    );

  const registerInternalThread: PlanRunnerRepositoryShape["registerInternalThread"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          // Idempotent on `thread_id` (globally unique per migration 027):
          // re-registering an already-tracked thread is a no-op so recovery
          // replays cannot duplicate rows.
          yield* sql`
            INSERT INTO plan_runner_internal_threads (
              run_id,
              step_key,
              thread_id,
              thread_role,
              created_at
            )
            VALUES (
              ${input.runId},
              ${input.stepKey},
              ${input.threadId},
              ${input.threadRole},
              ${input.createdAt}
            )
            ON CONFLICT(thread_id) DO NOTHING
          `;
          yield* sql`
            UPDATE plan_runner_feature_runs
            SET last_updated_at = ${input.createdAt}
            WHERE run_id = ${input.runId}
          `;
        }),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "PlanRunnerRepository.registerInternalThread:query",
            "PlanRunnerRepository.registerInternalThread:encodeRequest",
          ),
        ),
      );

  const deleteRun: PlanRunnerRepositoryShape["deleteRun"] = (input) =>
    deleteRunRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("PlanRunnerRepository.deleteRun:query")),
    );

  const listRecoverableRuns: PlanRunnerRepositoryShape["listRecoverableRuns"] = () =>
    Effect.gen(function* () {
      const rows = yield* listRecoverableRunRows({});
      const snapshots: PlanRunSnapshot[] = [];
      for (const row of rows) {
        snapshots.push(yield* reconstructSnapshot(row));
      }
      return snapshots as ReadonlyArray<PlanRunSnapshot>;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "PlanRunnerRepository.listRecoverableRuns:query",
          "PlanRunnerRepository.listRecoverableRuns:decodeRows",
        ),
      ),
    );

  return {
    getFeatureRun,
    getRunById,
    listRuns,
    listFeatureSummaries,
    insertRunSnapshot,
    replaceFeatureRun,
    updateRunState,
    updateStepState,
    setStepExecutionOrder,
    appendSyntheticLogEntry,
    listSyntheticLogEntries,
    listInternalThreadRefs,
    registerInternalThread,
    deleteRun,
    listRecoverableRuns,
  } satisfies PlanRunnerRepositoryShape;
});

export const PlanRunnerRepositoryLive = Layer.effect(
  PlanRunnerRepository,
  makePlanRunnerRepository,
);
