import type {
  ApprovalDecideError,
  ApprovalDecideInput,
  ApprovalDecision,
  ApprovalFeedEvent,
  ApprovalRequest,
  ApprovalSubmitInput,
} from "@fenrir/contracts";
import type { Effect } from "effect";
import { Context, Data } from "effect";

/**
 * Outcome returned to the hook long-poll. `timeout` means no client decided
 * within the soft-wait window and the hook must reply neutrally so the agent
 * falls back to its own TUI (D-042: the feed is an accelerator, never a
 * gate).
 */
export type AgentFeedSubmitOutcome =
  | { readonly outcome: "decided"; readonly requestId: string; readonly optionId: string }
  | { readonly outcome: "timeout"; readonly requestId: string };

export class AgentFeedCapacityError extends Data.TaggedError("AgentFeedCapacityError")<{
  readonly message: string;
}> {}

export interface AgentFeedServiceShape {
  /**
   * Registers a request and soft-waits for a decision. Resolves when a
   * client decides or the (clamped, <= 120s) timeout elapses. This is the
   * hook long-poll: the HTTP response is not written until this settles.
   */
  readonly submit: (
    input: ApprovalSubmitInput,
  ) => Effect.Effect<AgentFeedSubmitOutcome, AgentFeedCapacityError>;
  /**
   * Registers a request without blocking the caller; the soft-wait runs in
   * the background. Used by the FENRIR_SMOKE_OPS injection route.
   */
  readonly inject: (
    input: ApprovalSubmitInput,
  ) => Effect.Effect<ApprovalRequest, AgentFeedCapacityError>;
  /** Accepts exactly one decision per request id; late/duplicate rejected. */
  readonly decide: (
    input: ApprovalDecideInput,
  ) => Effect.Effect<ApprovalDecision, ApprovalDecideError>;
  /** Pending requests, optionally filtered by workspace. */
  readonly pending: (workspaceId?: string) => Effect.Effect<ReadonlyArray<ApprovalRequest>>;
  /**
   * Registers a live listener. Currently pending requests are replayed to
   * the listener as `pending` events synchronously before any live event, so
   * subscribers never miss the settled event for a request they saw.
   */
  readonly subscribe: (listener: (event: ApprovalFeedEvent) => void) => Effect.Effect<() => void>;
}

export class AgentFeedService extends Context.Service<AgentFeedService, AgentFeedServiceShape>()(
  "fenrir/agentFeed/AgentFeedService",
) {}

/**
 * Per-boot bearer credential for the local hook endpoint.
 *
 * D-042 auth note: hooks run next to the server (inside tmux panes the
 * server owns), so the simplest sound option is a dedicated random token
 * minted at boot, exported into tmux session environments alongside
 * FENRIR_WORKSPACE_ID, and accepted only by the agent-feed hook endpoint.
 * This mirrors the desktop bootstrap bearer flow used by the traffic-lens
 * ingest endpoint, but deliberately does NOT reuse the bootstrap token:
 * exposing that to every pane process would widen a session-granting
 * credential to arbitrary pane children. A stale token (panes created before
 * a server restart) fails auth and the hook exits neutrally, so approvals
 * fall back to the agent's own TUI instead of blocking.
 */
export interface AgentFeedHookCredentialShape {
  readonly token: string;
}

export class AgentFeedHookCredential extends Context.Service<
  AgentFeedHookCredential,
  AgentFeedHookCredentialShape
>()("fenrir/agentFeed/AgentFeedHookCredential") {}
