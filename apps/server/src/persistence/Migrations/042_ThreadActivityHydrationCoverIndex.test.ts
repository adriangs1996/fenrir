import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ThreadActivityHydrationCoverIndex", (it) => {
  it.effect("replaces the thread_sequence index with the hydration covering index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const indexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_activities)
      `;
      assert.ok(
        indexes.some((index) => index.name === "idx_projection_thread_activities_hydration"),
      );
      assert.notOk(
        indexes.some((index) => index.name === "idx_projection_thread_activities_thread_sequence"),
      );

      const indexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_activities_hydration')
      `;
      assert.deepStrictEqual(
        indexColumns.map((column) => column.name),
        ["thread_id", "sequence", "created_at", "activity_id"],
      );
    }),
  );
});
