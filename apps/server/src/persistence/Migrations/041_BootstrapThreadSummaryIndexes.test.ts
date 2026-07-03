import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_BootstrapThreadSummaryIndexes", (it) => {
  it.effect("creates indexes for the bootstrap thread summary query", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const activityIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_activities)
      `;
      assert.ok(
        activityIndexes.some(
          (index) => index.name === "idx_projection_thread_activities_kind_thread",
        ),
      );

      const activityIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_activities_kind_thread')
      `;
      assert.deepStrictEqual(
        activityIndexColumns.map((column) => column.name),
        ["kind", "thread_id"],
      );

      const messageIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_messages)
      `;
      assert.ok(
        messageIndexes.some(
          (index) => index.name === "idx_projection_thread_messages_thread_role_created",
        ),
      );

      const messageIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_messages_thread_role_created')
      `;
      assert.deepStrictEqual(
        messageIndexColumns.map((column) => column.name),
        ["thread_id", "role", "created_at"],
      );
    }),
  );
});
