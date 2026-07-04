import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ApprovalFeedEvent, ApprovalSubmitInput } from "@fenrir/contracts";

import { clampApprovalTimeoutMs, makeAgentFeedService } from "./AgentFeedService";

function submitInput(overrides: Partial<ApprovalSubmitInput> = {}): ApprovalSubmitInput {
  return {
    workspaceId: "workspace-1",
    agentId: "claude-code",
    kind: "permission",
    summary: "Allow Bash: bun run test?",
    options: [
      { id: "allow", label: "Allow" },
      { id: "deny", label: "Deny" },
    ],
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("AgentFeedService", () => {
  it("relays a request to subscribers and returns the decision to the waiting hook", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    const events: ApprovalFeedEvent[] = [];
    await Effect.runPromise(feed.subscribe((event) => events.push(event)));

    const hookOutcome = Effect.runPromise(feed.submit(submitInput({ timeoutMs: 5_000 })));
    await waitFor(() => events.some((event) => event.type === "pending"));

    const pendingEvent = events.find((event) => event.type === "pending");
    if (pendingEvent?.type !== "pending") throw new Error("missing pending event");
    expect(pendingEvent.workspaceId).toBe("workspace-1");
    expect(pendingEvent.request.kind).toBe("permission");
    expect(pendingEvent.request.options.map((option) => option.id)).toEqual(["allow", "deny"]);

    const decision = await Effect.runPromise(
      feed.decide({ requestId: pendingEvent.request.id, optionId: "allow" }),
    );
    expect(decision).toEqual({ requestId: pendingEvent.request.id, optionId: "allow" });

    await expect(hookOutcome).resolves.toEqual({
      outcome: "decided",
      requestId: pendingEvent.request.id,
      optionId: "allow",
    });

    const settledEvent = events.find((event) => event.type === "settled");
    if (settledEvent?.type !== "settled") throw new Error("missing settled event");
    expect(settledEvent.requestId).toBe(pendingEvent.request.id);
    expect(settledEvent.reason).toBe("decided");
    expect(settledEvent.optionId).toBe("allow");

    await expect(Effect.runPromise(feed.pending())).resolves.toEqual([]);
  });

  it("times out undecided requests so the hook falls back to the agent TUI", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    const events: ApprovalFeedEvent[] = [];
    await Effect.runPromise(feed.subscribe((event) => events.push(event)));

    const outcome = await Effect.runPromise(feed.submit(submitInput({ timeoutMs: 25 })));
    expect(outcome.outcome).toBe("timeout");

    const settledEvent = events.find((event) => event.type === "settled");
    if (settledEvent?.type !== "settled") throw new Error("missing settled event");
    expect(settledEvent.reason).toBe("timeout");
    expect(settledEvent.optionId).toBeNull();

    // A decision arriving after the timeout is a typed late rejection.
    const late = await Effect.runPromise(
      Effect.flip(feed.decide({ requestId: settledEvent.requestId, optionId: "allow" })),
    );
    expect(late._tag).toBe("ApprovalDecideError");
    expect(late.code).toBe("expired");
  });

  it("rejects duplicate decisions for the same request id", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    const request = await Effect.runPromise(feed.inject(submitInput({ timeoutMs: 5_000 })));

    await Effect.runPromise(feed.decide({ requestId: request.id, optionId: "deny" }));
    const duplicate = await Effect.runPromise(
      Effect.flip(feed.decide({ requestId: request.id, optionId: "allow" })),
    );
    expect(duplicate._tag).toBe("ApprovalDecideError");
    expect(duplicate.code).toBe("already-decided");
  });

  it("rejects unknown request ids and options that were never offered", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    const request = await Effect.runPromise(feed.inject(submitInput({ timeoutMs: 5_000 })));

    const unknown = await Effect.runPromise(
      Effect.flip(feed.decide({ requestId: `${request.id}-missing` as never, optionId: "allow" })),
    );
    expect(unknown.code).toBe("not-found");

    const invalidOption = await Effect.runPromise(
      Effect.flip(feed.decide({ requestId: request.id, optionId: "bypass" })),
    );
    expect(invalidOption.code).toBe("invalid-option");

    // The request stays pending and decidable after invalid attempts.
    await Effect.runPromise(feed.decide({ requestId: request.id, optionId: "allow" }));
  });

  it("replays pending requests to new subscribers and filters by workspace", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    const requestA = await Effect.runPromise(
      feed.inject(submitInput({ workspaceId: "workspace-a", timeoutMs: 5_000 })),
    );
    await Effect.runPromise(
      feed.inject(submitInput({ workspaceId: "workspace-b", timeoutMs: 5_000 })),
    );

    const events: ApprovalFeedEvent[] = [];
    await Effect.runPromise(feed.subscribe((event) => events.push(event)));
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.type === "pending")).toBe(true);

    await expect(Effect.runPromise(feed.pending("workspace-a"))).resolves.toEqual([requestA]);
  });

  it("bounds pending requests per workspace", async () => {
    const feed = makeAgentFeedService({ minTimeoutMs: 10 });
    for (let index = 0; index < 32; index += 1) {
      await Effect.runPromise(feed.inject(submitInput({ timeoutMs: 5_000 })));
    }
    const overCapacity = await Effect.runPromise(
      Effect.flip(feed.submit(submitInput({ timeoutMs: 5_000 }))),
    );
    expect(overCapacity._tag).toBe("AgentFeedCapacityError");

    // Other workspaces are unaffected by the saturated one.
    await Effect.runPromise(
      feed.inject(submitInput({ workspaceId: "workspace-other", timeoutMs: 5_000 })),
    );
  });

  it("clamps hook soft-waits to the D-042 ceiling", () => {
    expect(clampApprovalTimeoutMs(undefined, 1_000)).toBe(110_000);
    expect(clampApprovalTimeoutMs(500_000, 1_000)).toBe(120_000);
    expect(clampApprovalTimeoutMs(5, 1_000)).toBe(1_000);
  });
});
