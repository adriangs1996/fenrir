import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("035_CanonicalizeModelSelectionOptions", (it) => {
  it.effect("converts legacy object options to canonical selection arrays", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-legacy-options',
          'Legacy options project',
          '/tmp/project',
          '{"provider":"claudeAgent","model":"claude-opus-4-6","options":{"effort":"max","fastMode":true}}',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES (
          'thread-legacy-options',
          'project-legacy-options',
          'Legacy options thread',
          '{"provider":"codex","model":"gpt-5.4","options":{"reasoningEffort":"high","fastMode":false,"empty":"   ","nested":{"bad":true}}}',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL,
          'full-access',
          'default'
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'event-project',
            'project',
            'project-legacy-options',
            1,
            'project.created',
            '2026-01-01T00:00:00.000Z',
            'cmd-project',
            NULL,
            'corr-project',
            'user',
            '{"projectId":"project-legacy-options","title":"Project","workspaceRoot":"/tmp/project","defaultModelSelection":{"provider":"claudeAgent","model":"claude-opus-4-6","options":{"effort":"max","fastMode":true}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
            '{}'
          ),
          (
            'event-thread',
            'thread',
            'thread-legacy-options',
            1,
            'thread.turn-start-requested',
            '2026-01-01T00:00:00.000Z',
            'cmd-thread',
            NULL,
            'corr-thread',
            'user',
            '{"threadId":"thread-legacy-options","messageId":"message-1","modelSelection":{"provider":"codex","model":"gpt-5.4","options":{"reasoningEffort":"low","fastMode":true}},"runtimeMode":"full-access","interactionMode":"default","createdAt":"2026-01-01T00:00:00.000Z"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const projectRows = yield* sql<{ readonly json: string }>`
        SELECT default_model_selection_json AS json
        FROM projection_projects
        WHERE project_id = 'project-legacy-options'
      `;
      assert.deepStrictEqual(JSON.parse(projectRows[0]!.json), {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: [
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      });

      const threadRows = yield* sql<{ readonly json: string }>`
        SELECT model_selection_json AS json
        FROM projection_threads
        WHERE thread_id = 'thread-legacy-options'
      `;
      assert.deepStrictEqual(JSON.parse(threadRows[0]!.json), {
        provider: "codex",
        model: "gpt-5.4",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: false },
        ],
      });

      const eventRows = yield* sql<{ readonly eventId: string; readonly json: string }>`
        SELECT event_id AS "eventId", payload_json AS json
        FROM orchestration_events
        WHERE event_id IN ('event-project', 'event-thread')
        ORDER BY event_id
      `;
      assert.deepStrictEqual(JSON.parse(eventRows[0]!.json).defaultModelSelection.options, [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ]);
      assert.deepStrictEqual(JSON.parse(eventRows[1]!.json).modelSelection.options, [
        { id: "reasoningEffort", value: "low" },
        { id: "fastMode", value: true },
      ]);
    }),
  );
});
