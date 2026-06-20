import { randomUUID } from "node:crypto";

import { Deferred, Effect, Layer, Option, Ref, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type * as Socket from "effect/unstable/socket/Socket";
import {
  TrafficLensDeleteOverrideInput,
  TrafficLensDeleteRuleInput,
  TrafficLensListFindingsInput,
  TrafficLensQueryInput,
  TrafficLensReplayInput,
  TrafficLensUpsertOverrideInput,
  TrafficLensUpsertRuleInput,
} from "@fenrir/contracts";

import { ServerConfig } from "../config.ts";
import { TrafficLensService } from "../traffic-lens/Services/TrafficLensService.ts";
import { fenrirImageUri, parseFenrirImageArtifactId } from "../assistantImageMaterialization.ts";
import { persistMcpImageArtifact, readMcpImageArtifact } from "../mcpImageArtifactStore.ts";
import { getBrowserLabMcpToken } from "../mcp/browserLabMcpRuntime.ts";
import { BrowserLabControlError } from "./Services/BrowserLabControlService.ts";

const BrowserLabMcpCall = Schema.Struct({
  toolName: Schema.String,
  input: Schema.optional(Schema.Unknown),
});

interface PendingControlCall {
  readonly deferred: Deferred.Deferred<unknown, BrowserLabControlError>;
}

interface ControlConnection {
  readonly writer: (chunk: string) => Effect.Effect<void, Socket.SocketError>;
}

const controlConnectionRef = Effect.runSync(Ref.make<ControlConnection | null>(null));
const pendingControlCalls = new Map<number, PendingControlCall>();
let nextControlCallId = 1;

function parseControlMessage(raw: string | Uint8Array): unknown {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return JSON.parse(text);
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

const clearControlConnection = Effect.gen(function* () {
  yield* Ref.set(controlConnectionRef, null);
  for (const [id, call] of pendingControlCalls) {
    pendingControlCalls.delete(id);
    yield* Deferred.fail(
      call.deferred,
      new BrowserLabControlError({ message: "Browser Lab desktop connection closed." }),
    );
  }
});

function handleControlMessage(message: unknown): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!message || typeof message !== "object") return;
    const record = message as { readonly id?: unknown; readonly result?: unknown; error?: unknown };
    if (typeof record.id !== "number") return;
    const call = pendingControlCalls.get(record.id);
    if (!call) return;
    pendingControlCalls.delete(record.id);
    if (record.error !== undefined) {
      yield* Deferred.fail(
        call.deferred,
        new BrowserLabControlError({
          message: errorMessage(record.error, "Browser Lab desktop call failed."),
        }),
      );
      return;
    }
    yield* Deferred.succeed(call.deferred, record.result);
  });
}

function registerControlSocket(socket: Socket.Socket): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      yield* Ref.set(controlConnectionRef, { writer });
      yield* socket
        .runRaw((raw) =>
          Effect.try({
            try: () => parseControlMessage(raw),
            catch: () => undefined,
          }).pipe(Effect.flatMap(handleControlMessage)),
        )
        .pipe(
          Effect.ensuring(clearControlConnection),
          Effect.catch(() => clearControlConnection),
        );
    }),
  );
}

function callControl(
  method: string,
  params: unknown,
): Effect.Effect<unknown, BrowserLabControlError> {
  return Effect.gen(function* () {
    const connection = yield* Ref.get(controlConnectionRef);
    if (!connection) {
      return yield* new BrowserLabControlError({
        message: "Browser Lab desktop connection is not available.",
      });
    }
    const id = nextControlCallId++;
    const deferred = yield* Deferred.make<unknown, BrowserLabControlError>();
    pendingControlCalls.set(id, { deferred });
    yield* connection.writer(JSON.stringify({ id, method, params })).pipe(
      Effect.mapError(
        (cause) =>
          new BrowserLabControlError({
            message: `Failed to send Browser Lab command: ${cause}`,
          }),
      ),
      Effect.catch((error) =>
        Effect.gen(function* () {
          pendingControlCalls.delete(id);
          return yield* error;
        }),
      ),
    );
    const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption("15 seconds"));
    pendingControlCalls.delete(id);
    if (Option.isNone(result)) {
      return yield* new BrowserLabControlError({
        message: `Browser Lab command '${method}' timed out.`,
      });
    }
    return result.value;
  });
}

function bearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const authorization = request.headers["authorization"];
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function controlToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const url = HttpServerRequest.toURL(request);
  if (url._tag === "Some") {
    const token = url.value.searchParams.get("token")?.trim();
    if (token) {
      return token;
    }
  }
  return bearerToken(request);
}

function jsonResponse(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const persistBrowserLabScreenshotResult = Effect.fn("persistBrowserLabScreenshotResult")(function* (
  result: unknown,
) {
  const record = asRecord(result);
  const data = asString(record?.data);
  const mimeType = asString(record?.mimeType) ?? "image/png";
  if (!record || !data) {
    return yield* Effect.fail(new Error("Browser Lab screenshot returned no image data."));
  }

  const artifactId = `browser-lab-${randomUUID()}`;
  const stored = yield* persistMcpImageArtifact({
    artifactId,
    data,
    mimeType,
    name: "browser-lab-screenshot.png",
  });

  return {
    ...record,
    artifactId: stored.artifactId,
    uri: fenrirImageUri(stored.artifactId),
    name: stored.name,
    mimeType: stored.mimeType,
  };
});

const readBrowserLabImageHandle = Effect.fn("readBrowserLabImageHandle")(function* (
  input: unknown,
) {
  const record = asRecord(input);
  const artifactId = parseFenrirImageArtifactId(asString(record?.uri) ?? "");
  if (!artifactId) {
    return null;
  }
  return yield* readMcpImageArtifact({ artifactId });
});

function mapDesktopMethod(toolName: string): string | null {
  if (
    toolName.startsWith("browser_lab_") ||
    toolName.startsWith("traffic_lens_list_paused") ||
    toolName.startsWith("traffic_lens_continue_paused") ||
    toolName.startsWith("traffic_lens_drop_paused") ||
    toolName.startsWith("traffic_lens_list_profiles") ||
    toolName.startsWith("traffic_lens_create_profile") ||
    toolName.startsWith("traffic_lens_update_profile") ||
    toolName.startsWith("traffic_lens_delete_profile") ||
    toolName.startsWith("traffic_lens_list_rules") ||
    toolName.startsWith("traffic_lens_upsert_rule") ||
    toolName.startsWith("traffic_lens_delete_rule") ||
    toolName.startsWith("traffic_lens_set_rule_enabled") ||
    toolName.startsWith("traffic_lens_list_overrides") ||
    toolName.startsWith("traffic_lens_upsert_override") ||
    toolName.startsWith("traffic_lens_delete_override") ||
    toolName.startsWith("traffic_lens_set_override_enabled") ||
    toolName.startsWith("traffic_lens_list_storage_origins") ||
    toolName.startsWith("traffic_lens_capture_storage_origin") ||
    toolName.startsWith("traffic_lens_get_cookies_for_origin") ||
    toolName.startsWith("traffic_lens_set_cookie_for_origin") ||
    toolName.startsWith("traffic_lens_delete_cookie_for_origin")
  ) {
    return toolName;
  }
  return null;
}

function decode<A>(schema: Schema.Codec<A, any, never, never>, value: unknown): A {
  return Schema.decodeUnknownSync(schema)(value);
}

export const browserLabControlWebSocketRouteLayer = HttpRouter.add(
  "GET",
  "/api/browser-lab/control/ws",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const expectedToken = config.desktopBootstrapToken;
    if (!expectedToken || controlToken(request) !== expectedToken) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const socket = yield* Effect.orDie(request.upgrade);
    yield* registerControlSocket(socket);
    return HttpServerResponse.empty({ status: 204 });
  }),
);

export const browserLabMcpCallRouteLayer = HttpRouter.add(
  "POST",
  "/api/internal/mcp/browser-lab/call",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (bearerToken(request) !== getBrowserLabMcpToken()) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const payload = yield* HttpServerRequest.schemaBodyJson(BrowserLabMcpCall);
    const input = payload.input ?? {};
    if (payload.toolName === "browser_lab_open_image") {
      const image = yield* readBrowserLabImageHandle(input);
      return image
        ? jsonResponse({ ok: true, result: image })
        : jsonResponse({ ok: false, error: "Unknown Browser Lab image handle." }, 404);
    }

    const trafficLens = yield* TrafficLensService;
    const desktopMethod = mapDesktopMethod(payload.toolName);
    if (desktopMethod) {
      const result = yield* callControl(desktopMethod, input);
      if (payload.toolName === "browser_lab_screenshot") {
        const storedResult = yield* persistBrowserLabScreenshotResult(result);
        return jsonResponse({ ok: true, result: storedResult });
      }
      return jsonResponse({ ok: true, result });
    }

    switch (payload.toolName) {
      case "traffic_lens_query_requests":
        return yield* trafficLens
          .queryTraffic(decode(TrafficLensQueryInput, input))
          .pipe(Effect.map((result) => jsonResponse({ ok: true, result })));
      case "traffic_lens_get_request": {
        const id = Number((input as { id?: unknown }).id);
        const result = yield* trafficLens.getTrafficDetail(id);
        return jsonResponse({ ok: true, result });
      }
      case "traffic_lens_clear_requests": {
        const tabId = (input as { tabId?: unknown }).tabId;
        yield* trafficLens.clearTraffic(typeof tabId === "string" ? tabId : undefined);
        return jsonResponse({ ok: true, result: { cleared: true } });
      }
      case "traffic_lens_replay_request":
        return yield* trafficLens
          .replayRequest(decode(TrafficLensReplayInput, input))
          .pipe(Effect.map((result) => jsonResponse({ ok: true, result })));
      case "traffic_lens_list_findings":
        return yield* trafficLens
          .listFindings(decode(TrafficLensListFindingsInput, input))
          .pipe(Effect.map((result) => jsonResponse({ ok: true, result })));
      case "traffic_lens_upsert_persisted_rule":
        return yield* trafficLens
          .upsertRule(decode(TrafficLensUpsertRuleInput, input))
          .pipe(Effect.map((result) => jsonResponse({ ok: true, result })));
      case "traffic_lens_delete_persisted_rule":
        return yield* trafficLens
          .deleteRule(decode(TrafficLensDeleteRuleInput, input))
          .pipe(Effect.as(jsonResponse({ ok: true, result: { deleted: true } })));
      case "traffic_lens_upsert_persisted_override":
        return yield* trafficLens
          .upsertOverride(decode(TrafficLensUpsertOverrideInput, input))
          .pipe(Effect.map((result) => jsonResponse({ ok: true, result })));
      case "traffic_lens_delete_persisted_override":
        return yield* trafficLens
          .deleteOverride(decode(TrafficLensDeleteOverrideInput, input))
          .pipe(Effect.as(jsonResponse({ ok: true, result: { deleted: true } })));
      default:
        return jsonResponse(
          { ok: false, error: `Unknown Browser Lab MCP tool ${payload.toolName}` },
          404,
        );
    }
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Browser Lab MCP call failed.",
          },
          { status: 500 },
        ),
      ),
    ),
  ),
);

export const BrowserLabControlHttpLive = Layer.mergeAll(
  browserLabControlWebSocketRouteLayer,
  browserLabMcpCallRouteLayer,
);
