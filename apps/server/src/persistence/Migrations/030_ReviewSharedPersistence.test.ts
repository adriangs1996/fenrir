import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeSqlitePersistenceLive } from "../Layers/Sqlite.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const memoryLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

memoryLayer("030_ReviewSharedPersistence", (it) => {
  it.effect("boots an empty database with all review persistence tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'review_sessions',
            'review_annotations',
            'review_progress',
            'review_analysis',
            'review_github_pending_drafts',
            'review_ignore_rules'
          )
        ORDER BY name ASC
      `;

      assert.deepStrictEqual(
        tables.map((row) => row.name),
        [
          "review_analysis",
          "review_annotations",
          "review_github_pending_drafts",
          "review_ignore_rules",
          "review_progress",
          "review_sessions",
        ],
      );

      const activeIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(review_sessions)
      `;
      assert.ok(
        activeIndexes.some(
          (index) =>
            index.name === "idx_review_sessions_thread_checkout_active_unique" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );
    }),
  );
});

it.effect("030_ReviewSharedPersistence upgrades an existing user db from migration 29", () =>
  Effect.gen(function* () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-migration-"));
    const dbPath = path.join(tempDir, "orchestration.sqlite");

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-existing',
          'project-existing',
          'Existing thread',
          '{"provider":"codex","model":"gpt-5"}',
          'full-access',
          'default',
          NULL,
          '/repo',
          NULL,
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL,
          NULL
        )
      `;
    }).pipe(Effect.provide(persistenceLayer));

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 30 });

      const threadRows = yield* sql<{ readonly title: string }>`
        SELECT title
        FROM projection_threads
        WHERE thread_id = 'thread-existing'
      `;
      assert.equal(threadRows[0]?.title, "Existing thread");

      const reviewTableRows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'review_%'
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        reviewTableRows.map((row) => row.name),
        [
          "review_analysis",
          "review_annotations",
          "review_github_pending_drafts",
          "review_ignore_rules",
          "review_progress",
          "review_sessions",
        ],
      );
    }).pipe(Effect.provide(persistenceLayer));

    fs.rmSync(tempDir, { recursive: true, force: true });
  }).pipe(Effect.provide(NodeServices.layer)),
);
