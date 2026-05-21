import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeSqlitePersistenceLive } from "../Layers/Sqlite.ts";
import { runMigrations } from "../Migrations.ts";

it.effect(
  "031_ReviewSessionPullRequestOverride upgrades review_sessions with explicit override columns",
  () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenrir-review-migration-"));
      const dbPath = path.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);

      yield* runMigrations({ toMigrationInclusive: 30 }).pipe(Effect.provide(persistenceLayer));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 31 });

        const columns = yield* sql<{
          readonly name: string;
        }>`
        PRAGMA table_info(review_sessions)
      `;

        assert.ok(columns.some((column) => column.name === "pull_request_override_provider"));
        assert.ok(columns.some((column) => column.name === "pull_request_override_number"));
        assert.ok(columns.some((column) => column.name === "pull_request_override_url"));
      }).pipe(Effect.provide(persistenceLayer));

      fs.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
);
