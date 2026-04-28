import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { TrafficLensService, type TrafficLensServiceShape } from "../Services/TrafficLensService";
import { TrafficLensNotFoundError, type TrafficLensEvent } from "@fenrir/contracts";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

export const TrafficLensServiceLive = Layer.effect(
  TrafficLensService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let eventListeners: Array<(event: TrafficLensEvent) => void> = [];

    function emitEvent(event: TrafficLensEvent): void {
      for (const listener of eventListeners) {
        try {
          listener(event);
        } catch {
          // swallow
        }
      }
    }

    function mapRow(r: any) {
      return {
        id: r.id,
        tabId: r.tab_id,
        requestId: r.request_id,
        method: r.method,
        url: r.url,
        host: r.host,
        path: r.path,
        statusCode: r.status_code ?? null,
        contentType: r.content_type ?? null,
        contentLength: r.content_length ?? null,
        bodyTruncated: Boolean(r.body_truncated),
        isWebSocket: Boolean(r.is_websocket),
        timingStartedAt: r.timing_started_at,
        timingResponseAt: r.timing_response_at ?? null,
        timingCompletedAt: r.timing_completed_at ?? null,
        createdAt: r.created_at,
      };
    }

    return {
      ingestTraffic: (payload) =>
        Effect.gen(function* () {
          if (payload.stage === "request") {
            yield* sql`
              INSERT OR IGNORE INTO traffic_lens_entries (
                tab_id, request_id, method, url, host, path,
                request_headers_json, request_body,
                timing_started_at, created_at
              ) VALUES (
                ${payload.tabId},
                ${payload.requestId},
                ${payload.method},
                ${payload.url},
                ${payload.host},
                ${payload.path},
                ${payload.requestHeadersJson ?? "{}"},
                ${payload.requestBody ?? null},
                ${payload.timestamp},
                datetime('now')
              )
            `;
          } else if (payload.stage === "response") {
            let responseBody = payload.responseBody ?? null;
            let bodyTruncated = payload.bodyTruncated ?? false;
            if (responseBody && Buffer.byteLength(responseBody, "base64") > MAX_BODY_SIZE) {
              responseBody = responseBody.slice(0, MAX_BODY_SIZE);
              bodyTruncated = true;
            }

            yield* sql`
              UPDATE traffic_lens_entries SET
                status_code = ${payload.statusCode ?? null},
                content_type = ${payload.contentType ?? null},
                content_length = ${payload.contentLength ?? null},
                response_headers_json = ${payload.responseHeadersJson ?? null},
                response_body = ${responseBody},
                body_truncated = ${bodyTruncated ? 1 : 0},
                timing_response_at = ${payload.timestamp},
                timing_completed_at = ${payload.timestamp}
              WHERE request_id = ${payload.requestId}
            `;
          }

          // Fetch row to emit event
          const rows = yield* sql`
            SELECT
              id, tab_id, request_id,
              method, url, host, path,
              status_code, content_type, content_length,
              body_truncated, is_websocket,
              timing_started_at, timing_response_at, timing_completed_at,
              created_at
            FROM traffic_lens_entries
            WHERE request_id = ${payload.requestId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            emitEvent({
              type: "traffic.captured",
              entry: mapRow(rows[0]),
            });
          }
        }).pipe(Effect.orDie),

      queryTraffic: (input) =>
        Effect.gen(function* () {
          const limit = input.limit ?? 100;
          const offset = input.offset ?? 0;

          const rows = yield* sql`
            SELECT
              id, tab_id, request_id,
              method, url, host, path,
              status_code, content_type, content_length,
              body_truncated, is_websocket,
              timing_started_at, timing_response_at, timing_completed_at,
              created_at
            FROM traffic_lens_entries
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `;

          return (rows as any[]).map(mapRow);
        }).pipe(Effect.orDie),

      getTrafficDetail: (id) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              id, tab_id, request_id,
              method, url, host, path,
              status_code, content_type, content_length,
              request_headers_json, request_body,
              response_headers_json, response_body,
              body_truncated, is_websocket,
              timing_started_at, timing_response_at, timing_completed_at,
              notes, created_at
            FROM traffic_lens_entries
            WHERE id = ${id}
            LIMIT 1
          `;

          if (rows.length === 0) {
            return yield* Effect.fail(
              new TrafficLensNotFoundError({
                trafficId: id,
                message: `Traffic entry ${id} not found`,
              }),
            );
          }

          const r = rows[0] as any;
          return {
            ...mapRow(r),
            requestHeadersJson: r.request_headers_json,
            requestBody: r.request_body ?? null,
            responseHeadersJson: r.response_headers_json ?? null,
            responseBody: r.response_body ?? null,
            notes: r.notes ?? null,
          };
        }).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e))),

      clearTraffic: (tabId) =>
        Effect.gen(function* () {
          if (tabId) {
            yield* sql`DELETE FROM traffic_lens_entries WHERE tab_id = ${tabId}`;
          } else {
            yield* sql`DELETE FROM traffic_lens_entries`;
          }
        }).pipe(Effect.orDie),

      subscribe: (listener) =>
        Effect.sync(() => {
          eventListeners.push(listener);
          return () => {
            eventListeners = eventListeners.filter((l) => l !== listener);
          };
        }),
    } satisfies TrafficLensServiceShape;
  }),
);
