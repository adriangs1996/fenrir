import { randomBytes } from "node:crypto";

import {
  APPROVAL_TIMEOUT_DEFAULT_MS,
  APPROVAL_TIMEOUT_MAX_MS,
  APPROVAL_TIMEOUT_MIN_MS,
  ApprovalDecideError,
  ApprovalRequestId,
  type ApprovalDecideInput,
  type ApprovalDecision,
  type ApprovalFeedEvent,
  type ApprovalRequest,
  type ApprovalSettledReason,
  type ApprovalSubmitInput,
} from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import {
  AgentFeedCapacityError,
  AgentFeedHookCredential,
  AgentFeedService,
  type AgentFeedServiceShape,
  type AgentFeedSubmitOutcome,
} from "../Services/AgentFeedService";

/**
 * In-memory approval-feed relay (D-042).
 *
 * Bounded per workspace and overall; persistence is an explicit follow-up.
 * All state transitions (decide, timeout) run synchronously on the JS event
 * loop, so exactly one settlement wins per request id by construction.
 */

const MAX_PENDING_PER_WORKSPACE = 32;
const MAX_PENDING_TOTAL = 256;
const MAX_SETTLED_RECORDS = 512;

type Listener = (event: ApprovalFeedEvent) => void;

interface PendingEntry {
  readonly request: ApprovalRequest;
  readonly resolve: (outcome: AgentFeedSubmitOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface SettledRecord {
  readonly reason: ApprovalSettledReason;
  readonly optionId: string | null;
}

export function clampApprovalTimeoutMs(timeoutMs: number | undefined, minTimeoutMs: number) {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return APPROVAL_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(APPROVAL_TIMEOUT_MAX_MS, Math.max(minTimeoutMs, Math.trunc(timeoutMs)));
}

export interface MakeAgentFeedServiceOptions {
  /** Test hook: lowers the minimum soft-wait clamp. */
  readonly minTimeoutMs?: number;
}

export function makeAgentFeedService(options: MakeAgentFeedServiceOptions = {}) {
  const minTimeoutMs = options.minTimeoutMs ?? APPROVAL_TIMEOUT_MIN_MS;
  const listeners = new Set<Listener>();
  const pending = new Map<string, PendingEntry>();
  const pendingByWorkspace = new Map<string, number>();
  const settled = new Map<string, SettledRecord>();

  const notify = (event: ApprovalFeedEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[agent-feed] approval feed listener failed:", error);
      }
    }
  };

  const recordSettled = (requestId: string, record: SettledRecord) => {
    settled.set(requestId, record);
    if (settled.size > MAX_SETTLED_RECORDS) {
      const oldest = settled.keys().next().value;
      if (oldest !== undefined) settled.delete(oldest);
    }
  };

  const removePending = (entry: PendingEntry) => {
    pending.delete(entry.request.id);
    const workspaceCount = (pendingByWorkspace.get(entry.request.workspaceId) ?? 1) - 1;
    if (workspaceCount <= 0) {
      pendingByWorkspace.delete(entry.request.workspaceId);
    } else {
      pendingByWorkspace.set(entry.request.workspaceId, workspaceCount);
    }
  };

  /** Settles a request exactly once; returns false if it already settled. */
  const settle = (
    requestId: string,
    reason: ApprovalSettledReason,
    optionId: string | null,
  ): boolean => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    removePending(entry);
    clearTimeout(entry.timer);
    recordSettled(requestId, { reason, optionId });
    notify({
      type: "settled",
      workspaceId: entry.request.workspaceId,
      requestId: entry.request.id,
      reason,
      optionId,
      settledAt: new Date().toISOString(),
    });
    entry.resolve(
      reason === "decided" && optionId !== null
        ? { outcome: "decided", requestId, optionId }
        : { outcome: "timeout", requestId },
    );
    return true;
  };

  const register = (
    input: ApprovalSubmitInput,
  ): Effect.Effect<
    { readonly request: ApprovalRequest; readonly outcome: Promise<AgentFeedSubmitOutcome> },
    AgentFeedCapacityError
  > =>
    Effect.suspend(() => {
      const workspacePending = pendingByWorkspace.get(input.workspaceId) ?? 0;
      if (pending.size >= MAX_PENDING_TOTAL || workspacePending >= MAX_PENDING_PER_WORKSPACE) {
        return Effect.fail(
          new AgentFeedCapacityError({
            message: `agent feed pending capacity reached for workspace ${input.workspaceId}`,
          }),
        );
      }
      const timeoutMs = clampApprovalTimeoutMs(input.timeoutMs, minTimeoutMs);
      const now = Date.now();
      const request: ApprovalRequest = {
        id: ApprovalRequestId.make(`approval-${crypto.randomUUID()}`),
        workspaceId: input.workspaceId,
        paneId: input.paneId ?? null,
        agentId: input.agentId,
        kind: input.kind,
        summary: input.summary,
        options: input.options,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + timeoutMs).toISOString(),
      };
      let resolve!: (outcome: AgentFeedSubmitOutcome) => void;
      const outcome = new Promise<AgentFeedSubmitOutcome>((res) => {
        resolve = res;
      });
      const timer = setTimeout(() => {
        settle(request.id, "timeout", null);
      }, timeoutMs);
      // Do not keep the process alive just for a pending soft-wait.
      timer.unref?.();
      pending.set(request.id, { request, resolve, timer });
      pendingByWorkspace.set(input.workspaceId, workspacePending + 1);
      notify({ type: "pending", workspaceId: request.workspaceId, request });
      return Effect.succeed({ request, outcome });
    });

  const service: AgentFeedServiceShape = {
    submit: (input) =>
      register(input).pipe(Effect.flatMap(({ outcome }) => Effect.promise(() => outcome))),

    inject: (input) => register(input).pipe(Effect.map(({ request }) => request)),

    decide: (input: ApprovalDecideInput) =>
      Effect.suspend(() => {
        const entry = pending.get(input.requestId);
        if (!entry) {
          const record = settled.get(input.requestId);
          if (record === undefined) {
            return Effect.fail(
              new ApprovalDecideError({
                code: "not-found",
                message: `approval request ${input.requestId} was not found`,
              }),
            );
          }
          return Effect.fail(
            new ApprovalDecideError({
              code: record.reason === "decided" ? "already-decided" : "expired",
              message:
                record.reason === "decided"
                  ? `approval request ${input.requestId} was already decided`
                  : `approval request ${input.requestId} timed out before the decision arrived`,
            }),
          );
        }
        if (!entry.request.options.some((option) => option.id === input.optionId)) {
          return Effect.fail(
            new ApprovalDecideError({
              code: "invalid-option",
              message: `option ${input.optionId} is not offered by approval request ${input.requestId}`,
            }),
          );
        }
        settle(input.requestId, "decided", input.optionId);
        const decision: ApprovalDecision = {
          requestId: input.requestId,
          optionId: input.optionId,
        };
        return Effect.succeed(decision);
      }),

    pending: (workspaceId?: string) =>
      Effect.sync(() =>
        [...pending.values()]
          .map((entry) => entry.request)
          .filter((request) => workspaceId === undefined || request.workspaceId === workspaceId),
      ),

    subscribe: (listener: Listener) =>
      Effect.sync(() => {
        // Replay currently pending requests synchronously before any live
        // event, so a subscriber never misses the settled event for a
        // request it saw (single-threaded event loop guarantees no
        // interleaving between replay and registration).
        for (const entry of pending.values()) {
          listener({
            type: "pending",
            workspaceId: entry.request.workspaceId,
            request: entry.request,
          });
        }
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
  };

  return service;
}

export const AgentFeedServiceLive = Layer.effect(
  AgentFeedService,
  Effect.sync(() => makeAgentFeedService()),
);

export const AgentFeedHookCredentialLive = Layer.effect(
  AgentFeedHookCredential,
  Effect.sync(() => ({ token: randomBytes(32).toString("hex") })),
);
