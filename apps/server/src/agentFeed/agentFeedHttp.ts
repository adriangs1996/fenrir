import { ApprovalSubmitInput } from "@fenrir/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { respondToAuthError } from "../auth/http.ts";
import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { AgentFeedHookCredential, AgentFeedService } from "./Services/AgentFeedService.ts";

export const AGENT_FEED_REQUESTS_PATH = "/api/agent-feed/requests";
export const AGENT_FEED_SMOKE_INJECT_PATH = "/api/agent-feed/smoke/inject";

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const authorization = request.headers["authorization"];
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * D-042 hook-endpoint auth: hooks run next to the server inside tmux panes,
 * so they authenticate with the per-boot agent-feed hook token exported into
 * tmux session environments (`FENRIR_HOOK_TOKEN`). This mirrors the
 * bootstrap/bearer flow used by the traffic-lens ingest endpoint but uses a
 * dedicated, feed-only credential instead of the session-granting bootstrap
 * token. Authenticated client sessions are also accepted (same fallback the
 * ingest endpoint uses), which is what the smoke verifier and tests rely on.
 */
const requireAgentFeedHookRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const hookCredential = yield* AgentFeedHookCredential;
  const bearerToken = parseBearerToken(request);
  if (bearerToken !== null && bearerToken === hookCredential.token) {
    return;
  }
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

/**
 * Hook long-poll endpoint. The POST registers the approval request and the
 * response is not written until a client decides or the soft-wait (<= 120s)
 * elapses. The hook treats any non-2xx (or transport failure) as neutral and
 * lets the agent's own TUI take over, so this endpoint may reject freely.
 */
export const agentFeedRequestsRouteLayer = HttpRouter.add(
  "POST",
  AGENT_FEED_REQUESTS_PATH,
  Effect.gen(function* () {
    yield* requireAgentFeedHookRequest;
    const agentFeed = yield* AgentFeedService;
    const payload = yield* HttpServerRequest.schemaBodyJson(ApprovalSubmitInput).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (payload === null) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Invalid approval request payload." },
        { status: 400 },
      );
    }
    return yield* agentFeed.submit(payload).pipe(
      Effect.map((outcome) => HttpServerResponse.jsonUnsafe(outcome, { status: 200 })),
      Effect.catchTag("AgentFeedCapacityError", () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: "Approval feed capacity reached." },
            { status: 429 },
          ),
        ),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * Test-only injection route for the approval-feed smoke op. Registers a
 * request without blocking; the soft-wait runs in the background. Gated
 * behind FENRIR_SMOKE_OPS=1 (same gate as the native run-script smoke op)
 * and the same auth as the hook endpoint.
 */
export const agentFeedSmokeInjectRouteLayer = HttpRouter.add(
  "POST",
  AGENT_FEED_SMOKE_INJECT_PATH,
  Effect.gen(function* () {
    if (process.env["FENRIR_SMOKE_OPS"] !== "1") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    yield* requireAgentFeedHookRequest;
    const agentFeed = yield* AgentFeedService;
    const payload = yield* HttpServerRequest.schemaBodyJson(ApprovalSubmitInput).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (payload === null) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Invalid approval request payload." },
        { status: 400 },
      );
    }
    return yield* agentFeed.inject(payload).pipe(
      Effect.map((request) =>
        HttpServerResponse.jsonUnsafe({ requestId: request.id }, { status: 200 }),
      ),
      Effect.catchTag("AgentFeedCapacityError", () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: "Approval feed capacity reached." },
            { status: 429 },
          ),
        ),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
