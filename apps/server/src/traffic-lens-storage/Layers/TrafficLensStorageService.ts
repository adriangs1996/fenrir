import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  TrafficLensError,
  type TrafficLensCookieSnapshot,
  type TrafficLensDomStorageSnapshot,
  type TrafficLensStorageAreaKind,
} from "@fenrir/contracts";
import {
  TrafficLensStorageService,
  type TrafficLensStorageServiceShape,
} from "../Services/TrafficLensStorageService";

function hashPayload(payloadJson: string): string {
  return createHash("sha256").update(payloadJson).digest("hex");
}

function parseJson<T>(payloadJson: string): T {
  return JSON.parse(payloadJson) as T;
}

function mapOriginRow(row: any) {
  return {
    profileId: row.profile_id,
    origin: row.origin,
    lastDocumentUrl: row.last_document_url ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    latestCookieVersionId: row.latest_cookie_version_id ?? null,
    latestLocalStorageVersionId: row.latest_local_storage_version_id ?? null,
    latestSessionStorageVersionId: row.latest_session_storage_version_id ?? null,
    hasLiveSessionStorage: false,
    liveSessionTabIds: [],
  } as const;
}

function mapVersionRow(row: any) {
  return {
    id: row.id,
    profileId: row.profile_id,
    origin: row.origin,
    areaKind: row.area_kind as TrafficLensStorageAreaKind,
    scopeKey: row.scope_key,
    capturedAt: row.captured_at,
    snapshotReason: row.snapshot_reason,
    sourceTabId: row.source_tab_id ?? null,
    sourceUrl: row.source_url ?? null,
  } as const;
}

export const TrafficLensStorageServiceLive = Layer.effect(
  TrafficLensStorageService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const service = {
      ingestSnapshot: (payload) =>
        Effect.gen(function* () {
          const normalizedPayloadJson = payload.payloadJson;
          const contentHash = hashPayload(normalizedPayloadJson);

          const existingOriginRows = yield* sql`
            SELECT first_seen_at
            FROM traffic_lens_storage_origins
            WHERE profile_id = ${payload.profileId} AND origin = ${payload.origin}
            LIMIT 1
          `;
          const firstSeenAt = existingOriginRows[0]?.first_seen_at ?? payload.capturedAt;

          yield* sql`
            INSERT INTO traffic_lens_storage_origins (
              profile_id,
              origin,
              last_document_url,
              first_seen_at,
              last_seen_at,
              latest_cookie_version_id,
              latest_local_storage_version_id,
              latest_session_storage_version_id
            ) VALUES (
              ${payload.profileId},
              ${payload.origin},
              ${payload.sourceUrl ?? null},
              ${firstSeenAt},
              ${payload.capturedAt},
              null,
              null,
              null
            )
            ON CONFLICT(profile_id, origin) DO UPDATE SET
              last_document_url = COALESCE(excluded.last_document_url, traffic_lens_storage_origins.last_document_url),
              last_seen_at = excluded.last_seen_at
          `;

          if (payload.sourceUrl) {
            const provenanceRows = yield* sql`
              SELECT first_seen_at
              FROM traffic_lens_storage_url_provenance
              WHERE profile_id = ${payload.profileId} AND url = ${payload.sourceUrl}
              LIMIT 1
            `;
            const provenanceFirstSeenAt = provenanceRows[0]?.first_seen_at ?? payload.capturedAt;

            yield* sql`
              INSERT INTO traffic_lens_storage_url_provenance (
                profile_id,
                origin,
                url,
                first_seen_at,
                last_seen_at
              ) VALUES (
                ${payload.profileId},
                ${payload.origin},
                ${payload.sourceUrl},
                ${provenanceFirstSeenAt},
                ${payload.capturedAt}
              )
              ON CONFLICT(profile_id, url) DO UPDATE SET
                origin = excluded.origin,
                last_seen_at = excluded.last_seen_at
            `;
          }

          const latestRows = yield* sql`
            SELECT version_id, payload_json
            FROM traffic_lens_storage_latest
            WHERE
              profile_id = ${payload.profileId}
              AND origin = ${payload.origin}
              AND area_kind = ${payload.areaKind}
              AND scope_key = ${payload.scopeKey}
            LIMIT 1
          `;

          let versionId = latestRows[0]?.version_id ?? null;
          if (latestRows[0]?.payload_json !== normalizedPayloadJson) {
            const versionRows = yield* sql`
              INSERT INTO traffic_lens_storage_versions (
                profile_id,
                origin,
                area_kind,
                scope_key,
                payload_json,
                captured_at,
                snapshot_reason,
                source_tab_id,
                source_url,
                content_hash
              ) VALUES (
                ${payload.profileId},
                ${payload.origin},
                ${payload.areaKind},
                ${payload.scopeKey},
                ${normalizedPayloadJson},
                ${payload.capturedAt},
                ${payload.snapshotReason},
                ${payload.sourceTabId ?? null},
                ${payload.sourceUrl ?? null},
                ${contentHash}
              )
              RETURNING id
            `;
            versionId = Number(versionRows[0]!.id);
          }

          if (versionId === null) {
            return;
          }

          yield* sql`
            INSERT INTO traffic_lens_storage_latest (
              profile_id,
              origin,
              area_kind,
              scope_key,
              version_id,
              payload_json,
              captured_at
            ) VALUES (
              ${payload.profileId},
              ${payload.origin},
              ${payload.areaKind},
              ${payload.scopeKey},
              ${versionId},
              ${normalizedPayloadJson},
              ${payload.capturedAt}
            )
            ON CONFLICT(profile_id, origin, area_kind, scope_key) DO UPDATE SET
              version_id = excluded.version_id,
              payload_json = excluded.payload_json,
              captured_at = excluded.captured_at
          `;

          if (payload.areaKind === "cookies") {
            yield* sql`
              UPDATE traffic_lens_storage_origins
              SET
                last_document_url = COALESCE(${payload.sourceUrl ?? null}, last_document_url),
                last_seen_at = ${payload.capturedAt},
                latest_cookie_version_id = ${versionId}
              WHERE profile_id = ${payload.profileId} AND origin = ${payload.origin}
            `;
          } else if (payload.areaKind === "localStorage") {
            yield* sql`
              UPDATE traffic_lens_storage_origins
              SET
                last_document_url = COALESCE(${payload.sourceUrl ?? null}, last_document_url),
                last_seen_at = ${payload.capturedAt},
                latest_local_storage_version_id = ${versionId}
              WHERE profile_id = ${payload.profileId} AND origin = ${payload.origin}
            `;
          } else {
            yield* sql`
              UPDATE traffic_lens_storage_origins
              SET
                last_document_url = COALESCE(${payload.sourceUrl ?? null}, last_document_url),
                last_seen_at = ${payload.capturedAt},
                latest_session_storage_version_id = ${versionId}
              WHERE profile_id = ${payload.profileId} AND origin = ${payload.origin}
            `;
          }
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not ingest storage snapshot: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      listOrigins: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              profile_id,
              origin,
              last_document_url,
              first_seen_at,
              last_seen_at,
              latest_cookie_version_id,
              latest_local_storage_version_id,
              latest_session_storage_version_id
            FROM traffic_lens_storage_origins
            WHERE profile_id = ${input.profileId}
            ORDER BY last_seen_at DESC, origin ASC
          `;
          return (rows as any[]).map(mapOriginRow);
        }).pipe(Effect.orDie),

      getCookieSnapshot: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT payload_json
            FROM traffic_lens_storage_latest
            WHERE
              profile_id = ${input.profileId}
              AND origin = ${input.origin}
              AND area_kind = ${"cookies"}
              AND scope_key = ${""}
            LIMIT 1
          `;
          return rows[0]
            ? parseJson<TrafficLensCookieSnapshot>(String(rows[0]!.payload_json))
            : null;
        }).pipe(Effect.orDie),

      getLocalStorageSnapshot: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT payload_json
            FROM traffic_lens_storage_latest
            WHERE
              profile_id = ${input.profileId}
              AND origin = ${input.origin}
              AND area_kind = ${"localStorage"}
              AND scope_key = ${""}
            LIMIT 1
          `;
          return rows[0]
            ? parseJson<TrafficLensDomStorageSnapshot>(String(rows[0]!.payload_json))
            : null;
        }).pipe(Effect.orDie),

      listSessionStorageSnapshots: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              id,
              profile_id,
              origin,
              captured_at,
              snapshot_reason,
              source_tab_id,
              source_url
            FROM traffic_lens_storage_versions
            WHERE
              profile_id = ${input.profileId}
              AND origin = ${input.origin}
              AND area_kind = ${"sessionStorage"}
            ORDER BY captured_at DESC, id DESC
          `;
          return (rows as any[]).map((row) => ({
            versionId: row.id,
            profileId: row.profile_id,
            origin: row.origin,
            sourceTabId: row.source_tab_id ?? null,
            sourceUrl: row.source_url ?? null,
            capturedAt: row.captured_at,
            snapshotReason: row.snapshot_reason,
          }));
        }).pipe(Effect.orDie),

      getSessionStorageSnapshot: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT payload_json
            FROM traffic_lens_storage_versions
            WHERE id = ${input.versionId}
            LIMIT 1
          `;
          const row = rows[0];
          if (!row) {
            return yield* new TrafficLensError({
              message: `Session storage snapshot not found: ${input.versionId}`,
            });
          }
          const snapshot = parseJson<TrafficLensDomStorageSnapshot>(String(row.payload_json));
          return snapshot.entries;
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not load session storage snapshot: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      updateSessionStorageSnapshot: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT profile_id, origin
            FROM traffic_lens_storage_versions
            WHERE id = ${input.versionId}
            LIMIT 1
          `;
          const row = rows[0];
          if (!row) {
            return yield* new TrafficLensError({
              message: `Session storage snapshot not found: ${input.versionId}`,
            });
          }

          const payloadJson = JSON.stringify({
            origin: String(row.origin),
            kind: "sessionStorage",
            entries: input.entries,
          } satisfies TrafficLensDomStorageSnapshot);
          const contentHash = hashPayload(payloadJson);

          yield* sql`
            UPDATE traffic_lens_storage_versions
            SET payload_json = ${payloadJson}, content_hash = ${contentHash}
            WHERE id = ${input.versionId}
          `;

          yield* sql`
            UPDATE traffic_lens_storage_latest
            SET payload_json = ${payloadJson}
            WHERE version_id = ${input.versionId}
          `;
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not update session storage snapshot: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      getStorageVersions: (input) =>
        Effect.gen(function* () {
          const rows = input.areaKind
            ? yield* sql`
                SELECT
                  id,
                  profile_id,
                  origin,
                  area_kind,
                  scope_key,
                  captured_at,
                  snapshot_reason,
                  source_tab_id,
                  source_url
                FROM traffic_lens_storage_versions
                WHERE
                  profile_id = ${input.profileId}
                  AND origin = ${input.origin}
                  AND area_kind = ${input.areaKind}
                ORDER BY captured_at DESC, id DESC
              `
            : yield* sql`
                SELECT
                  id,
                  profile_id,
                  origin,
                  area_kind,
                  scope_key,
                  captured_at,
                  snapshot_reason,
                  source_tab_id,
                  source_url
                FROM traffic_lens_storage_versions
                WHERE profile_id = ${input.profileId} AND origin = ${input.origin}
                ORDER BY captured_at DESC, id DESC
              `;
          return (rows as any[]).map(mapVersionRow);
        }).pipe(Effect.orDie),

      clearPersistedOrigin: (input) =>
        Effect.gen(function* () {
          yield* sql`
            DELETE FROM traffic_lens_storage_latest
            WHERE profile_id = ${input.profileId} AND origin = ${input.origin}
          `;
          yield* sql`
            DELETE FROM traffic_lens_storage_versions
            WHERE profile_id = ${input.profileId} AND origin = ${input.origin}
          `;
          yield* sql`
            DELETE FROM traffic_lens_storage_url_provenance
            WHERE profile_id = ${input.profileId} AND origin = ${input.origin}
          `;
          yield* sql`
            DELETE FROM traffic_lens_storage_origins
            WHERE profile_id = ${input.profileId} AND origin = ${input.origin}
          `;
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not clear persisted origin: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),
    } satisfies TrafficLensStorageServiceShape;

    return service;
  }),
);
