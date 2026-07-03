import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteWorkerClient from "./NodeSqliteWorkerClient.ts";

const tempDir = mkdtempSync(join(tmpdir(), "fenrir-sqlite-worker-"));
process.on("exit", () => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup.
  }
});

const layer = it.layer(SqliteWorkerClient.layer({ filename: join(tempDir, "worker-test.sqlite") }));

layer("NodeSqliteWorkerClient", (it) => {
  it.effect("runs prepared queries and returns positional values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`DELETE FROM entries`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

      const rows = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM entries ORDER BY id
    `;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.name, "alpha");
      assert.equal(rows[1]?.name, "beta");

      const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
      assert.equal(values.length, 2);
      assert.equal(values[0]?.[1], "alpha");
      assert.equal(values[1]?.[1], "beta");
    }),
  );

  it.effect("commits and rolls back transactions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE IF NOT EXISTS tx_entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`DELETE FROM tx_entries`;

      yield* sql.withTransaction(sql`INSERT INTO tx_entries(name) VALUES (${"committed"})`);

      const failed = yield* sql
        .withTransaction(
          Effect.andThen(
            sql`INSERT INTO tx_entries(name) VALUES (${"rolled-back"})`,
            Effect.fail(new Error("boom")),
          ),
        )
        .pipe(Effect.flip);
      assert.instanceOf(failed, Error);

      const rows = yield* sql<{ readonly name: string }>`SELECT name FROM tx_entries ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => row.name),
        ["committed"],
      );
    }),
  );

  it.effect("surfaces SQL errors as typed failures", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const failure = yield* sql`SELECT * FROM missing_table_for_sure`.pipe(Effect.flip);
      assert.equal((failure as { _tag?: string })._tag, "SqlError");
    }),
  );

  it.effect("keeps the main event loop responsive during a heavy query", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Hundreds of milliseconds of pure SQLite CPU. With the in-process
      // synchronous driver this starves the event loop completely (the timer
      // never fires); through the worker the main thread keeps ticking.
      let ticks = 0;
      const ticker = setInterval(() => {
        ticks += 1;
      }, 5);
      yield* sql`
        WITH RECURSIVE cnt(x) AS (
          SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 5000000
        )
        SELECT COUNT(*) AS count FROM cnt
      `.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            clearInterval(ticker);
          }),
        ),
      );
      assert.isAbove(ticks, 5);
    }),
  );
});

it.effect("fails with a typed error when the worker cannot open the database", () =>
  Effect.gen(function* () {
    // A directory path is unopenable as a database: the worker must report
    // the init error back (this failure is what triggers the in-process
    // fallback in `layer`) instead of hanging the ready handshake.
    const failure = yield* SqliteWorkerClient.make({ filename: tempDir }).pipe(
      Effect.provide(Reactivity.layer),
      Effect.scoped,
      Effect.flip,
    );
    assert.instanceOf(failure, Error);
    assert.include(failure.message, "SQLite worker failed to open database");
  }),
);
