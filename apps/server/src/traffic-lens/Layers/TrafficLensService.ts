import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { TrafficLensService, type TrafficLensServiceShape } from "../Services/TrafficLensService";
import {
  TrafficLensError,
  TrafficLensNotFoundError,
  type TrafficLensEvent,
  type TrafficLensFinding,
  type TrafficLensOverride,
  type TrafficLensProfile,
  type TrafficLensRule,
} from "@fenrir/contracts";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";
const DEFAULT_PROFILE_PARTITION_KEY = "persist:traffic-lens:default";

function mapTrafficRow(r: any) {
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

function parseJsonObject(json: string | null | undefined): Record<string, string> {
  if (!json) {
    return {};
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = typeof value === "string" ? value : String(value);
    }
    return result;
  } catch {
    return {};
  }
}

function mapProfileRow(row: any): TrafficLensProfile {
  return {
    id: row.id,
    name: row.name,
    partitionKey: row.partition_key,
    ...(row.user_agent_preset ? { userAgentPreset: row.user_agent_preset } : {}),
    ...(row.proxy_preset !== null && row.proxy_preset !== undefined
      ? { proxyPreset: row.proxy_preset }
      : {}),
    ...(row.notes !== null && row.notes !== undefined ? { notes: row.notes } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRuleRow(row: any): TrafficLensRule {
  const mutation = parseJsonObject(row.mutation_json);
  const parsedMutation = row.mutation_json ? JSON.parse(row.mutation_json) : {};
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    phase: row.phase,
    action: row.action,
    scope: JSON.parse(row.scope_json),
    ...(mutation.urlRewrite ? { urlRewrite: mutation.urlRewrite } : {}),
    ...(parsedMutation.headerMutation ? { headerMutation: parsedMutation.headerMutation } : {}),
    ...(Object.hasOwn(parsedMutation, "bodyReplace")
      ? { bodyReplace: parsedMutation.bodyReplace }
      : {}),
    ...(parsedMutation.mockResponse ? { mockResponse: parsedMutation.mockResponse } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as TrafficLensRule;
}

function mapOverrideRow(row: any): TrafficLensOverride {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    match: JSON.parse(row.match_json),
    response: JSON.parse(row.response_json),
    ...(row.latency_ms === null || row.latency_ms === undefined
      ? {}
      : { latencyMs: row.latency_ms }),
    ...(row.offline ? { offline: true } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFindingRow(row: any): TrafficLensFinding {
  return {
    id: row.id,
    tabId: row.tab_id ?? null,
    trafficId: row.traffic_id ?? null,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: row.description,
    evidenceJson: row.evidence_json,
    createdAt: row.created_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function serializeRuleMutation(rule: TrafficLensRule | { [key: string]: unknown }): string {
  const {
    urlRewrite = undefined,
    headerMutation = undefined,
    bodyReplace = undefined,
    mockResponse = undefined,
  } = rule as {
    urlRewrite?: string;
    headerMutation?: unknown;
    bodyReplace?: string | null;
    mockResponse?: unknown;
  };

  return JSON.stringify({
    ...(urlRewrite ? { urlRewrite } : {}),
    ...(headerMutation ? { headerMutation } : {}),
    ...(Object.hasOwn(rule, "bodyReplace") ? { bodyReplace } : {}),
    ...(mockResponse ? { mockResponse } : {}),
  });
}

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }
  return lowered;
}

function deriveFindings(input: {
  entryId: number;
  tabId: string;
  url: string;
  path: string;
  responseHeaders: Record<string, string>;
}): Omit<TrafficLensFinding, "id" | "createdAt">[] {
  const headers = lowerCaseHeaders(input.responseHeaders);
  const findings: Array<Omit<TrafficLensFinding, "id" | "createdAt">> = [];
  const url = new URL(input.url);

  if (!headers["content-security-policy"]) {
    findings.push({
      tabId: input.tabId,
      trafficId: input.entryId,
      kind: "missing-security-header",
      severity: "medium",
      title: "Missing Content-Security-Policy",
      description: "The response did not include a Content-Security-Policy header.",
      evidenceJson: JSON.stringify({ header: "content-security-policy", url: input.url }),
    });
  }

  if (url.protocol === "https:" && !headers["strict-transport-security"]) {
    findings.push({
      tabId: input.tabId,
      trafficId: input.entryId,
      kind: "missing-security-header",
      severity: "low",
      title: "Missing Strict-Transport-Security",
      description: "The HTTPS response did not include a Strict-Transport-Security header.",
      evidenceJson: JSON.stringify({ header: "strict-transport-security", url: input.url }),
    });
  }

  if (headers["access-control-allow-origin"] === "*") {
    findings.push({
      tabId: input.tabId,
      trafficId: input.entryId,
      kind: "cors-wildcard",
      severity: "medium",
      title: "Wildcard CORS policy",
      description: "The response allows any origin through Access-Control-Allow-Origin: *.",
      evidenceJson: JSON.stringify({ header: "access-control-allow-origin", url: input.url }),
    });
  }

  if (input.path.endsWith(".map")) {
    findings.push({
      tabId: input.tabId,
      trafficId: input.entryId,
      kind: "sourcemap-exposed",
      severity: "info",
      title: "Source map exposed",
      description: "A source map file was served to the browser.",
      evidenceJson: JSON.stringify({ path: input.path, url: input.url }),
    });
  }

  const setCookie = headers["set-cookie"];
  if (setCookie) {
    const lowerCookie = setCookie.toLowerCase();
    if (!lowerCookie.includes("httponly")) {
      findings.push({
        tabId: input.tabId,
        trafficId: input.entryId,
        kind: "weak-cookie-flag",
        severity: "medium",
        title: "Cookie missing HttpOnly",
        description: "A Set-Cookie header was observed without the HttpOnly flag.",
        evidenceJson: JSON.stringify({ header: setCookie, missing: "HttpOnly" }),
      });
    }
    if (url.protocol === "https:" && !lowerCookie.includes("secure")) {
      findings.push({
        tabId: input.tabId,
        trafficId: input.entryId,
        kind: "weak-cookie-flag",
        severity: "medium",
        title: "Cookie missing Secure",
        description: "A secure-context cookie was observed without the Secure flag.",
        evidenceJson: JSON.stringify({ header: setCookie, missing: "Secure" }),
      });
    }
    if (!lowerCookie.includes("samesite")) {
      findings.push({
        tabId: input.tabId,
        trafficId: input.entryId,
        kind: "weak-cookie-flag",
        severity: "low",
        title: "Cookie missing SameSite",
        description: "A Set-Cookie header was observed without a SameSite attribute.",
        evidenceJson: JSON.stringify({ header: setCookie, missing: "SameSite" }),
      });
    }
  }

  return findings;
}

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
          // listener errors must not crash the service
        }
      }
    }

    function ensureDefaultProfile() {
      const timestamp = nowIso();
      return sql`
        INSERT OR IGNORE INTO traffic_lens_profiles (
          id, name, partition_key, created_at, updated_at
        ) VALUES (
          ${DEFAULT_PROFILE_ID},
          ${DEFAULT_PROFILE_NAME},
          ${DEFAULT_PROFILE_PARTITION_KEY},
          ${timestamp},
          ${timestamp}
        )
      `;
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
          } else {
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

          const rows = yield* sql`
            SELECT
              id, tab_id, request_id,
              method, url, host, path,
              status_code, content_type, content_length,
              body_truncated, is_websocket,
              timing_started_at, timing_response_at, timing_completed_at,
              created_at, response_headers_json
            FROM traffic_lens_entries
            WHERE request_id = ${payload.requestId}
            LIMIT 1
          `;

          if (rows.length === 0) {
            return;
          }

          const row = rows[0] as any;
          const entry = mapTrafficRow(row);
          emitEvent({ type: "traffic.captured", entry });

          if (payload.stage !== "response") {
            return;
          }

          const findings = deriveFindings({
            entryId: entry.id,
            tabId: entry.tabId,
            url: entry.url,
            path: entry.path,
            responseHeaders: parseJsonObject(row.response_headers_json),
          });

          for (const finding of findings) {
            yield* sql`
              INSERT INTO traffic_lens_findings (
                tab_id, traffic_id, kind, severity, title, description, evidence_json, created_at
              ) VALUES (
                ${finding.tabId ?? null},
                ${finding.trafficId ?? null},
                ${finding.kind},
                ${finding.severity},
                ${finding.title},
                ${finding.description},
                ${finding.evidenceJson},
                ${payload.timestamp}
              )
            `;

            const inserted = yield* sql`
              SELECT
                id, tab_id, traffic_id, kind, severity, title, description, evidence_json, created_at
              FROM traffic_lens_findings
              WHERE rowid = last_insert_rowid()
              LIMIT 1
            `;
            const createdFinding = mapFindingRow(inserted[0]);
            emitEvent({ type: "finding.created", finding: createdFinding });
          }
        }).pipe(Effect.orDie),

      queryTraffic: (input) =>
        Effect.gen(function* () {
          const limit = Math.min(input.limit ?? 100, 500);
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

          return (rows as any[]).map(mapTrafficRow).filter((entry) => {
            if (input.tabId && entry.tabId !== input.tabId) return false;
            if (input.host && entry.host !== input.host) return false;
            if (input.method && entry.method.toUpperCase() !== input.method.toUpperCase()) {
              return false;
            }
            if (input.statusCode !== undefined && entry.statusCode !== input.statusCode) {
              return false;
            }
            if (
              input.search &&
              !entry.url.toLowerCase().includes(input.search.toLowerCase()) &&
              !entry.path.toLowerCase().includes(input.search.toLowerCase())
            ) {
              return false;
            }
            return true;
          });
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
            return yield* new TrafficLensNotFoundError({
              trafficId: id,
              message: `Traffic entry ${id} not found`,
            });
          }

          const row = rows[0] as any;
          return {
            ...mapTrafficRow(row),
            requestHeadersJson: row.request_headers_json,
            requestBody: row.request_body ?? null,
            responseHeadersJson: row.response_headers_json ?? null,
            responseBody: row.response_body ?? null,
            notes: row.notes ?? null,
          };
        }).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error))),

      clearTraffic: (tabId) =>
        Effect.gen(function* () {
          if (tabId) {
            yield* sql`DELETE FROM traffic_lens_entries WHERE tab_id = ${tabId}`;
            yield* sql`DELETE FROM traffic_lens_findings WHERE tab_id = ${tabId}`;
          } else {
            yield* sql`DELETE FROM traffic_lens_entries`;
            yield* sql`DELETE FROM traffic_lens_findings`;
          }
        }).pipe(Effect.orDie),

      subscribe: (listener) =>
        Effect.sync(() => {
          eventListeners.push(listener);
          return () => {
            eventListeners = eventListeners.filter((candidate) => candidate !== listener);
          };
        }),

      replayRequest: (input) =>
        Effect.gen(function* () {
          const startTime = Date.now();
          const fetchHeaders: Record<string, string> = { ...input.headers };
          const fetchBody = input.body ? Buffer.from(input.body, "base64") : undefined;

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(input.url, {
                method: input.method,
                headers: fetchHeaders,
                body: ["GET", "HEAD"].includes(input.method.toUpperCase()) ? undefined : fetchBody,
                redirect: "manual",
              });

              const bodyBuffer = await response.arrayBuffer();
              const bodyBase64 = Buffer.from(bodyBuffer).toString("base64");
              const headers: Record<string, string> = {};
              response.headers.forEach((value, key) => {
                headers[key] = value;
              });

              return {
                statusCode: response.status,
                statusText: response.statusText,
                headers,
                body: bodyBase64,
                timing: Date.now() - startTime,
              };
            },
            catch: (error) =>
              new TrafficLensError({
                message: `Replay request failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
          });
        }),

      listProfiles: () =>
        Effect.gen(function* () {
          yield* ensureDefaultProfile();
          const rows = yield* sql`
            SELECT
              id, name, partition_key, user_agent_preset, proxy_preset, notes, created_at, updated_at
            FROM traffic_lens_profiles
            ORDER BY CASE WHEN id = ${DEFAULT_PROFILE_ID} THEN 0 ELSE 1 END, name ASC
          `;
          return (rows as any[]).map(mapProfileRow);
        }).pipe(Effect.orDie),

      upsertProfile: ({ id, input }) =>
        Effect.gen(function* () {
          const profileId = id ?? (randomUUID() as any);
          const timestamp = nowIso();
          const existing = yield* sql`
            SELECT created_at FROM traffic_lens_profiles WHERE id = ${profileId} LIMIT 1
          `;
          const createdAt = existing[0]?.created_at ?? timestamp;

          yield* sql`
            INSERT INTO traffic_lens_profiles (
              id, name, partition_key, user_agent_preset, proxy_preset, notes, created_at, updated_at
            ) VALUES (
              ${profileId},
              ${input.name},
              ${input.partitionKey},
              ${input.userAgentPreset ?? null},
              ${input.proxyPreset ?? null},
              ${input.notes ?? null},
              ${createdAt},
              ${timestamp}
            )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              partition_key = excluded.partition_key,
              user_agent_preset = excluded.user_agent_preset,
              proxy_preset = excluded.proxy_preset,
              notes = excluded.notes,
              updated_at = excluded.updated_at
          `;

          const rows = yield* sql`
            SELECT
              id, name, partition_key, user_agent_preset, proxy_preset, notes, created_at, updated_at
            FROM traffic_lens_profiles
            WHERE id = ${profileId}
            LIMIT 1
          `;
          return mapProfileRow(rows[0]);
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not persist profile: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      deleteProfile: ({ id }) =>
        Effect.gen(function* () {
          if (id === DEFAULT_PROFILE_ID) {
            return yield* new TrafficLensError({
              message: "The default profile cannot be deleted.",
            });
          }
          yield* sql`DELETE FROM traffic_lens_profiles WHERE id = ${id}`;
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not delete profile: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      listRules: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, enabled, phase, action, scope_json, mutation_json, created_at, updated_at
            FROM traffic_lens_rules
            ORDER BY updated_at DESC
          `;
          return (rows as any[]).map(mapRuleRow);
        }).pipe(Effect.orDie),

      upsertRule: ({ id, input }) =>
        Effect.gen(function* () {
          const ruleId = id ?? (randomUUID() as any);
          const timestamp = nowIso();
          const existing = yield* sql`
            SELECT created_at FROM traffic_lens_rules WHERE id = ${ruleId} LIMIT 1
          `;
          const createdAt = existing[0]?.created_at ?? timestamp;

          yield* sql`
            INSERT INTO traffic_lens_rules (
              id, name, enabled, phase, action, scope_json, mutation_json, created_at, updated_at
            ) VALUES (
              ${ruleId},
              ${input.name},
              ${input.enabled ? 1 : 0},
              ${input.phase},
              ${input.action},
              ${JSON.stringify(input.scope)},
              ${serializeRuleMutation(input)},
              ${createdAt},
              ${timestamp}
            )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              enabled = excluded.enabled,
              phase = excluded.phase,
              action = excluded.action,
              scope_json = excluded.scope_json,
              mutation_json = excluded.mutation_json,
              updated_at = excluded.updated_at
          `;

          const rows = yield* sql`
            SELECT id, name, enabled, phase, action, scope_json, mutation_json, created_at, updated_at
            FROM traffic_lens_rules
            WHERE id = ${ruleId}
            LIMIT 1
          `;
          return mapRuleRow(rows[0]);
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not persist intercept rule: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      deleteRule: ({ id }) =>
        sql`DELETE FROM traffic_lens_rules WHERE id = ${id}`.pipe(
          Effect.asVoid,
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not delete intercept rule: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      listOverrides: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, enabled, match_json, response_json, latency_ms, offline, created_at, updated_at
            FROM traffic_lens_overrides
            ORDER BY updated_at DESC
          `;
          return (rows as any[]).map(mapOverrideRow);
        }).pipe(Effect.orDie),

      upsertOverride: ({ id, input }) =>
        Effect.gen(function* () {
          const overrideId = id ?? (randomUUID() as any);
          const timestamp = nowIso();
          const existing = yield* sql`
            SELECT created_at FROM traffic_lens_overrides WHERE id = ${overrideId} LIMIT 1
          `;
          const createdAt = existing[0]?.created_at ?? timestamp;

          yield* sql`
            INSERT INTO traffic_lens_overrides (
              id, name, enabled, match_json, response_json, latency_ms, offline, created_at, updated_at
            ) VALUES (
              ${overrideId},
              ${input.name},
              ${input.enabled ? 1 : 0},
              ${JSON.stringify(input.match)},
              ${JSON.stringify(input.response)},
              ${input.latencyMs ?? null},
              ${(input.offline ?? false) ? 1 : 0},
              ${createdAt},
              ${timestamp}
            )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              enabled = excluded.enabled,
              match_json = excluded.match_json,
              response_json = excluded.response_json,
              latency_ms = excluded.latency_ms,
              offline = excluded.offline,
              updated_at = excluded.updated_at
          `;

          const rows = yield* sql`
            SELECT id, name, enabled, match_json, response_json, latency_ms, offline, created_at, updated_at
            FROM traffic_lens_overrides
            WHERE id = ${overrideId}
            LIMIT 1
          `;
          return mapOverrideRow(rows[0]);
        }).pipe(
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not persist override: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      deleteOverride: ({ id }) =>
        sql`DELETE FROM traffic_lens_overrides WHERE id = ${id}`.pipe(
          Effect.asVoid,
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(
              new TrafficLensError({
                message: `Could not delete override: ${String(error.message ?? error)}`,
              }),
            ),
          ),
        ),

      listFindings: (input) =>
        Effect.gen(function* () {
          const limit = Math.min(input.limit ?? 200, 500);
          const rows = yield* sql`
            SELECT
              id, tab_id, traffic_id, kind, severity, title, description, evidence_json, created_at
            FROM traffic_lens_findings
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
          return (rows as any[]).map(mapFindingRow).filter((finding) => {
            if (input.tabId && finding.tabId !== input.tabId) return false;
            if (input.kind && finding.kind !== input.kind) return false;
            if (input.severity && finding.severity !== input.severity) return false;
            return true;
          });
        }).pipe(Effect.orDie),
    } satisfies TrafficLensServiceShape;
  }),
);
