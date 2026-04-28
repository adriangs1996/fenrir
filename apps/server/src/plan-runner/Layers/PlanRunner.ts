import { Effect, FileSystem, Layer, Path, PubSub, Ref, Stream } from "effect";
import type {
  FeatureState,
  ModelSelection,
  PlanNode,
  PlanRunId,
  PlanRunnerEvent,
  PlanRunSnapshot,
  PlanState,
  ProjectId,
} from "@fenrir/contracts";
import {
  CommandId,
  MessageId,
  PlanRunId as PlanRunIdSchema,
  PlanRunnerError,
  PlanRunnerNotFoundError,
  ThreadId,
} from "@fenrir/contracts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { GitCore } from "../../git/Services/GitCore";
import { ServerSettingsService } from "../../serverSettings";
import { TextGeneration } from "../../git/Services/TextGeneration";
import { PlanRunnerService, type PlanRunnerServiceShape } from "../Services/PlanRunner";

// ─── Internal types ─────────────────────────────────────────────────────────

interface PlanRunState {
  runId: PlanRunId;
  featureName: string;
  projectId: ProjectId;
  branch: string;
  worktreePath: string | null;
  /** True if we created the worktree (vs reusing existing). Only cleanup what we created. */
  ownsWorktree: boolean;
  state: FeatureState;
  plans: Map<string, MutablePlanNode>;
  analyzerThreadId: string | null;
  integrationThreadId: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  cancelled: boolean;
  modelSelection: ModelSelection;
}

/**
 * Structured reviewer feedback from a failed REVIEW_FAIL pass.
 * Carried into the next executor attempt so the model knows exactly
 * what to fix instead of re-running blind on a dirty worktree.
 */
interface ReviewFeedback {
  /** 1-indexed attempt number this feedback corresponds to. */
  attempt: number;
  /** Short root-cause summary parsed from reviewer output. */
  rootCause: string;
  /** Verifier checks that failed (e.g. "bun typecheck", "bun test src/foo"). */
  failedChecks: string[];
  /** Concrete fixes the reviewer said are required. */
  requiredFixes: string[];
  /** Full raw reviewer message (sentinel stripped). Fallback if parsing is partial. */
  raw: string;
}

interface MutablePlanNode {
  planId: string;
  filename: string;
  state: PlanState;
  dependsOn: string[];
  maxRetries: number;
  retriesUsed: number;
  executorThreadId: string | null;
  reviewerThreadId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  content: string;
  /** Feedback from prior failed review passes, oldest → newest. */
  reviewFeedback: ReviewFeedback[];
}

interface ParsedFrontmatter {
  id: string;
  depends_on: string[];
  max_retries: number;
  body: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseFrontmatter(content: string, fallbackId: string): ParsedFrontmatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match || !match[1] || !match[2]) {
    return { id: fallbackId, depends_on: [], max_retries: 2, body: content };
  }

  const yaml = match[1];
  const body = match[2];

  let id: string | null = null;
  let depends_on: string[] = [];
  let max_retries = 2;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    const idMatch = trimmed.match(/^id:\s*(.+)$/);
    if (idMatch?.[1]) {
      id = idMatch[1].trim().replace(/^["']|["']$/g, "");
    }
    const retriesMatch = trimmed.match(/^max_retries:\s*(\d+)$/);
    if (retriesMatch?.[1]) {
      max_retries = parseInt(retriesMatch[1], 10);
    }
    const depsMatch = trimmed.match(/^depends_on:\s*\[(.+)\]$/);
    if (depsMatch?.[1]) {
      depends_on = depsMatch[1].split(",").map((d) => d.trim().replace(/^["']|["']$/g, ""));
    }
  }

  // Handle multi-line depends_on (YAML list format)
  const depsListMatch = yaml.match(/depends_on:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (depsListMatch?.[1] && depends_on.length === 0) {
    depends_on = depsListMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean)
      .map((d) => d.replace(/^["']|["']$/g, ""));
  }

  return { id: id ?? fallbackId, depends_on, max_retries, body };
}

function parseMarkdownList(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Extract the inner text of an XML-style `<tag>...</tag>` block.
 * Returns `undefined` if the tag is absent. Case-insensitive on the tag name,
 * tolerant of attributes and surrounding whitespace. First match wins.
 */
function extractTag(source: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = source.match(re);
  return m?.[1]?.trim();
}

/**
 * Parse a REVIEW_FAIL reviewer message into structured feedback.
 *
 * Reviewer is prompted to wrap each section in XML tags (`<root_cause>`,
 * `<failed_checks>`, `<required_fixes>`, `<raw_verifier_output>`). Parse is
 * best-effort — missing tags fall back to "" / [] and the full raw text is
 * preserved so the next executor still has signal even on malformed output.
 */
function parseReviewFeedback(raw: string, attempt: number): ReviewFeedback {
  // Strip sentinels so they don't bleed into the next prompt.
  const cleaned = raw.replace(/REVIEW_(PASS|FAIL)/g, "").trim();

  return {
    attempt,
    rootCause: extractTag(cleaned, "root_cause") ?? "",
    failedChecks: parseMarkdownList(extractTag(cleaned, "failed_checks")),
    requiredFixes: parseMarkdownList(extractTag(cleaned, "required_fixes")),
    raw: cleaned,
  };
}

function detectCycles(nodes: Map<string, string[]>): string[] | null {
  // Kahn's algorithm: inDegree[node] = number of (valid) deps that node has
  const inDeg = new Map<string, number>();
  for (const [key, deps] of nodes) {
    inDeg.set(key, deps.filter((d) => nodes.has(d)).length);
  }

  const queue: string[] = [];
  for (const [key, deg] of inDeg) {
    if (deg === 0) queue.push(key);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    // Find nodes that depend on `node`
    for (const [key, deps] of nodes) {
      if (deps.includes(node)) {
        const newDeg = (inDeg.get(key) ?? 1) - 1;
        inDeg.set(key, newDeg);
        if (newDeg === 0) queue.push(key);
      }
    }
  }

  if (sorted.length < nodes.size) {
    return [...nodes.keys()].filter((k) => !sorted.includes(k));
  }
  return null;
}

function makeId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Layer ──────────────────────────────────────────────────────────────────

export const PlanRunnerLive = Layer.effect(
  PlanRunnerService,
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const gitCore = yield* GitCore;
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const textGeneration = yield* TextGeneration;
    const serverSettingsService = yield* Effect.service(ServerSettingsService);

    const eventPubSub = yield* PubSub.unbounded<PlanRunnerEvent>();
    const activeRuns = yield* Ref.make(new Map<string, PlanRunState>());

    // ── AI dependency extraction ─────────────────────────────────────

    /**
     * Use the configured text generation provider to extract dependencies
     * from plan file contents. Provider-agnostic: works with Claude, Codex, etc.
     * Gracefully degrades: returns empty deps on any failure.
     */
    const extractDependenciesWithAI = (
      plans: Array<{ planId: string; content: string }>,
      modelSelection: ModelSelection,
    ): Effect.Effect<Map<string, string[]>, never, never> =>
      Effect.gen(function* () {
        if (plans.length <= 1) return new Map<string, string[]>();

        const allPlanIds = plans.map((p) => p.planId);

        const result = yield* textGeneration.extractDependencies({
          planIds: allPlanIds,
          planContents: plans,
          modelSelection,
        });

        // Validate: only keep deps that reference existing plan IDs
        const resolved = new Map<string, string[]>();
        const planIdSet = new Set(allPlanIds);
        for (const [planId, deps] of Object.entries(result.dependencies)) {
          if (!planIdSet.has(planId)) continue;
          resolved.set(
            planId,
            deps.filter((d) => planIdSet.has(d) && d !== planId),
          );
        }

        return resolved;
      }).pipe(
        // Graceful degradation: any failure returns empty deps
        Effect.catch(() => Effect.succeed(new Map<string, string[]>())),
      );

    // ── Project CWD resolver ─────────────────────────────────────────

    const resolveProjectCwd = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const project = readModel.projects.find((p) => p.id === projectId);
        if (!project) {
          return yield* Effect.fail(
            new PlanRunnerError({
              message: `Project not found: ${projectId}` as any,
            }),
          );
        }
        return project.workspaceRoot;
      });

    // ── Publish helper ────────────────────────────────────────────────

    const publishEvent = (event: PlanRunnerEvent) =>
      PubSub.publish(eventPubSub, event).pipe(Effect.asVoid);

    // ── Snapshot builder ──────────────────────────────────────────────

    const toSnapshot = (run: PlanRunState): PlanRunSnapshot => ({
      runId: run.runId,
      featureName: run.featureName as any,
      projectId: run.projectId,
      branch: run.branch as any,
      worktreePath: run.worktreePath,
      state: run.state,
      plans: [...run.plans.values()].map(
        (p): PlanNode => ({
          planId: p.planId,
          filename: p.filename as any,
          state: p.state,
          dependsOn: p.dependsOn,
          maxRetries: p.maxRetries,
          retriesUsed: p.retriesUsed,
          executorThreadId: p.executorThreadId as any,
          reviewerThreadId: p.reviewerThreadId as any,
          error: p.error,
          startedAt: p.startedAt,
          completedAt: p.completedAt,
        }),
      ),
      analyzerThreadId: run.analyzerThreadId as any,
      integrationThreadId: run.integrationThreadId as any,
      startedAt: run.startedAt as any,
      completedAt: run.completedAt,
      summary: run.summary,
    });

    // ── Thread lifecycle helpers ─────────────────────────────────────

    /** Stop a thread's provider session. Fire-and-forget, never fails. */
    const stopThreadSession = (threadId: string) =>
      orchestrationEngine
        .dispatch({
          type: "thread.session.stop",
          commandId: CommandId.makeUnsafe(`plan-runner:stop:${makeId()}`),
          threadId: ThreadId.makeUnsafe(threadId),
          createdAt: now(),
        })
        .pipe(Effect.ignore);

    /**
     * Stop session + archive thread. Used when a thread has finished its job
     * (success OR failure) and we want it out of the active list.
     * Fire-and-forget.
     */
    const finalizeThread = (threadId: string) =>
      Effect.gen(function* () {
        yield* stopThreadSession(threadId);
        yield* orchestrationEngine
          .dispatch({
            type: "thread.archive",
            commandId: CommandId.makeUnsafe(`plan-runner:archive:${makeId()}`),
            threadId: ThreadId.makeUnsafe(threadId),
          })
          .pipe(Effect.ignore);
      });

    /**
     * Send a follow-up user turn to an existing thread. Used to drive the
     * reviewer through fix-then-reverify cycles without spawning a new thread.
     */
    const sendFollowupTurn = (threadId: string, prompt: string) =>
      orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(`plan-runner:turn:${makeId()}`),
        threadId: ThreadId.makeUnsafe(threadId),
        message: {
          messageId: MessageId.makeUnsafe(makeId()),
          role: "user",
          text: prompt,
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now(),
      });

    /** Remove a worktree we created. Skip if we reused an existing one. */
    const cleanupWorktree = (run: PlanRunState) =>
      Effect.gen(function* () {
        if (!run.worktreePath || !run.ownsWorktree) return;
        const projectCwd = yield* resolveProjectCwd(run.projectId);
        yield* gitCore.removeWorktree({
          cwd: projectCwd,
          path: run.worktreePath,
          force: true,
        });
      }).pipe(
        Effect.catch(() =>
          Effect.logWarning("Failed to cleanup worktree", {
            runId: run.runId,
            worktreePath: run.worktreePath,
          }),
        ),
        Effect.asVoid,
      );

    // ── Thread bootstrapping ──────────────────────────────────────────

    const bootstrapThreadWithPrompt = (input: {
      projectId: ProjectId;
      title: string;
      prompt: string;
      modelSelection: ModelSelection;
      branch?: string | null;
      worktreePath?: string | null;
    }) =>
      Effect.gen(function* () {
        const threadId = ThreadId.makeUnsafe(makeId());
        const commandId = CommandId.makeUnsafe(`plan-runner:create:${makeId()}`);
        const createdAt = now();

        // Create thread — if worktreePath is set, the thread's provider
        // session will use it as CWD via resolveThreadWorkspaceCwd.
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId,
          threadId,
          projectId: input.projectId,
          title: input.title as any,
          modelSelection: input.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: (input.branch as any) ?? null,
          worktreePath: (input.worktreePath as any) ?? null,
          createdAt,
        });

        // Start turn with prompt
        const turnCommandId = CommandId.makeUnsafe(`plan-runner:turn:${makeId()}`);
        const messageId = MessageId.makeUnsafe(makeId());

        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: turnCommandId,
          threadId,
          message: {
            messageId,
            role: "user",
            text: input.prompt,
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: now(),
        });

        return { threadId };
      });

    // ── Wait for thread turn completion ───────────────────────────────

    const POLL_INTERVAL_MS = 3_000;
    const MAX_POLL_WAIT_MS = 30 * 60 * 1000; // 30 minutes absolute timeout
    const MAX_SESSION_WAIT_MS = 60 * 1000; // 60s waiting for session/turn to appear

    const waitForThreadTurnComplete = (
      targetThreadId: string,
      run?: PlanRunState,
    ): Effect.Effect<{ ok: boolean; error: string | null }, never, never> => {
      const startedAtMs = Date.now();
      // Track whether we've ever observed activeTurnId !== null.
      // This distinguishes "session just bound, turn hasn't started yet"
      // from "turn ran and completed (activeTurnId back to null)".
      let turnWasActive = false;

      const poll: Effect.Effect<{ ok: boolean; error: string | null }, never, never> = Effect.gen(
        function* () {
          // Check cancellation if run context is provided
          if (run?.cancelled) {
            return { ok: false, error: "Run cancelled" };
          }

          const elapsedMs = Date.now() - startedAtMs;

          // Absolute timeout — prevent infinite hangs
          if (elapsedMs > MAX_POLL_WAIT_MS) {
            return {
              ok: false,
              error: `Turn did not complete within ${MAX_POLL_WAIT_MS / 1000}s timeout`,
            };
          }

          const readModel = yield* orchestrationEngine.getReadModel();
          const thread = readModel.threads.find((t) => t.id === targetThreadId);

          if (!thread) {
            return { ok: false, error: `Thread ${targetThreadId} not found` };
          }

          if (!thread.session) {
            // Session not yet established — ProviderCommandReactor hasn't
            // processed the turn-start-requested event yet. Expected
            // immediately after thread creation.
            if (elapsedMs > MAX_SESSION_WAIT_MS) {
              return {
                ok: false,
                error: `Provider session was not established within ${MAX_SESSION_WAIT_MS / 1000}s`,
              };
            }
            yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
            return yield* poll;
          }

          const session = thread.session;

          if (session.activeTurnId !== null) {
            // Turn is running — remember we saw it active
            turnWasActive = true;
            yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
            return yield* poll;
          }

          // activeTurnId === null from here
          if (session.status === "error" || session.status === "stopped") {
            return {
              ok: false,
              error: session.lastError ?? "Thread session error",
            };
          }

          if (!turnWasActive) {
            // Session exists but we never saw the turn become active.
            // The turn hasn't started yet — ProviderCommandReactor may still
            // be sending the turn to the provider. Keep waiting.
            if (elapsedMs > MAX_SESSION_WAIT_MS) {
              return {
                ok: false,
                error: "Turn was never started by provider within timeout",
              };
            }
            yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
            return yield* poll;
          }

          // Turn was active and now completed — success
          return { ok: true, error: null };
        },
      );

      return poll;
    };

    // ── Read last assistant message ───────────────────────────────────

    const readLastAssistantMessage = (
      threadId: string,
    ): Effect.Effect<string | null, never, never> =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const thread = readModel.threads.find((t) => t.id === threadId);
        if (!thread) return null;

        const messages = [...thread.messages].reverse();
        const assistantMsg = messages.find((m) => m.role === "assistant");
        if (!assistantMsg) return null;

        return assistantMsg.text || null;
      });

    // ── Mark dependents skipped (recursive) ───────────────────────────

    const markDependentsSkipped = (run: PlanRunState, failedPlanId: string): string[] => {
      const skippedIds: string[] = [];
      const visited = new Set<string>();

      const findDependents = (planId: string) => {
        for (const [id, node] of run.plans) {
          if (
            !visited.has(id) &&
            node.dependsOn.includes(planId) &&
            node.state !== "done" &&
            node.state !== "failed" &&
            node.state !== "skipped"
          ) {
            visited.add(id);
            node.state = "skipped";
            node.error = `Skipped: dependency "${planId}" failed`;
            node.completedAt = now();
            skippedIds.push(id);
            findDependents(id);
          }
        }
      };

      findDependents(failedPlanId);
      return skippedIds;
    };

    const markDependentsSkippedAndPublish = (run: PlanRunState, failedPlanId: string) =>
      Effect.gen(function* () {
        const skippedIds = markDependentsSkipped(run, failedPlanId);
        for (const id of skippedIds) {
          yield* publishPlanStateChanged(run, id);
        }
      });

    // ── Publish plan state change ─────────────────────────────────────

    const publishPlanStateChanged = (run: PlanRunState, planId: string) => {
      const node = run.plans.get(planId)!;
      return publishEvent({
        type: "planRunner.planStateChanged",
        runId: run.runId,
        planId,
        state: node.state,
        retriesUsed: node.retriesUsed,
        error: node.error,
      });
    };

    // ── Per-plan executor pipeline ────────────────────────────────────

    const executePlan = (run: PlanRunState, plan: MutablePlanNode) =>
      Effect.gen(function* () {
        // Mark running
        plan.state = "running";
        plan.startedAt = now();
        yield* publishPlanStateChanged(run, plan.planId);

        // Bootstrap executor thread. Single shot — on REVIEW_FAIL the
        // reviewer (not a fresh executor) is asked to apply the fixes itself.
        const executorPrompt = `
You are implementing a plan as part of a larger feature. Implement completely. No TODOs. No placeholders.

# Plan: ${plan.planId}
# Feature: ${run.featureName}

${plan.content}`;
        const { threadId: executorThreadId } = yield* bootstrapThreadWithPrompt({
          projectId: run.projectId,
          title: `[PlanRunner] Execute: ${plan.planId}`,
          prompt: executorPrompt,
          modelSelection: run.modelSelection,
          branch: run.branch,
          worktreePath: run.worktreePath,
        });
        plan.executorThreadId = executorThreadId;

        // Wait for executor
        const execResult = yield* waitForThreadTurnComplete(executorThreadId, run);
        if (!execResult.ok) {
          // Executor done (failed). Archive — reviewer never spawned here.
          yield* finalizeThread(executorThreadId);
          plan.state = "failed";
          plan.error = execResult.error ?? "Executor thread failed";
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);
          yield* markDependentsSkippedAndPublish(run, plan.planId);
          return;
        }

        // Mark reviewing
        plan.state = "reviewing";
        yield* publishPlanStateChanged(run, plan.planId);

        // Bootstrap reviewer thread. The reviewer plays a dual role:
        //  1. Verify the executor's work and report findings.
        //  2. On REVIEW_FAIL, apply the fixes itself in follow-up turns
        //     (we no longer re-run the executor on failure).
        // The same thread persists across the fix-and-reverify loop so the
        // reviewer keeps its full context (prior findings, verifier output).
        const reviewerPrompt = `
You are a code reviewer AND fixer for plan "${plan.planId}" in feature "${run.featureName}".
The executor has just implemented this plan. Your job:

1. Run verification:
   - Typechecks if the project allows it
   - Linters
   - Tests

2. Verify implementation correctness:
   - All tasks in plan completed
   - No placeholder/TODO code left
   - No dead code, unused imports, half-baked implementations
   - Code follows existing codebase patterns

3. Report findings.

If ALL checks pass and implementation is correct: end your message with the literal token REVIEW_PASS on its own line.

If ANY check fails or implementation is incomplete, end your message with REVIEW_FAIL and the following XML-tagged sections (use these exact tag names):

<root_cause>
1-2 sentences explaining why the implementation failed.
</root_cause>

<failed_checks>
- <command or check> → <quote the exact failing output, do not paraphrase>
- ...
</failed_checks>

<required_fixes>
- <file:line or area> <concrete action required>
- ...
</required_fixes>

<raw_verifier_output>
Paste full stderr/stdout from any failing command, verbatim. No fences needed.
</raw_verifier_output>

IMPORTANT: If you reply REVIEW_FAIL, you will be asked in a follow-up turn to APPLY THE FIXES YOURSELF — the executor will not be re-run. Tag the issues precisely so your future self can act on them. You retain full edit access to the worktree.

Plan that was supposed to be implemented:
# Plan: ${plan.planId}
${plan.content}
`;

        const { threadId: reviewerThreadId } = yield* bootstrapThreadWithPrompt({
          projectId: run.projectId,
          title: `[PlanRunner] Review: ${plan.planId}`,
          prompt: reviewerPrompt,
          modelSelection: run.modelSelection,
          branch: run.branch,
          worktreePath: run.worktreePath,
        });
        plan.reviewerThreadId = reviewerThreadId;

        // Reviewer fix-and-reverify loop. Each iteration is one turn on the
        // SAME reviewer thread:
        //   - turn 1: initial review (from bootstrap prompt)
        //   - turn 2..N: "fix what you found, then reverify" follow-ups
        // Total turns capped at 1 + maxRetries.
        let reviewResponse: string | null = null;
        let passed = false;
        let exhausted = false;

        while (true) {
          const turnResult = yield* waitForThreadTurnComplete(reviewerThreadId, run);
          if (!turnResult.ok) {
            // Treat reviewer thread errors as terminal — no point retrying
            // on top of a broken session.
            reviewResponse = null;
            break;
          }

          reviewResponse = yield* readLastAssistantMessage(reviewerThreadId);

          if (reviewResponse?.includes("REVIEW_PASS")) {
            passed = true;
            break;
          }

          // FAIL — capture parsed feedback for telemetry/snapshots before
          // deciding whether to push another fix turn.
          if (reviewResponse) {
            plan.reviewFeedback.push(parseReviewFeedback(reviewResponse, plan.retriesUsed + 1));
          }

          if (plan.retriesUsed >= plan.maxRetries) {
            exhausted = true;
            break;
          }

          plan.retriesUsed++;
          plan.error = "Review failed, reviewer applying fixes";
          yield* publishPlanStateChanged(run, plan.planId);

          // Drive the reviewer to fix-then-reverify on the same thread.
          const fixupPrompt = `Your previous review reported issues. Apply the fixes yourself now — do NOT delegate or re-run the executor.

1. Apply every item listed in <required_fixes> from your previous message.
2. Re-run the same verification suite (typecheck, lint, tests).
3. End your reply with REVIEW_PASS if everything now passes, or REVIEW_FAIL with updated XML-tagged sections if issues remain.

This is fix attempt ${plan.retriesUsed} of ${plan.maxRetries}.`;

          yield* sendFollowupTurn(reviewerThreadId, fixupPrompt);
        }

        if (passed) {
          // Pass — archive the plan's threads (executor + reviewer are
          // done with their job) and mark the plan done.
          if (plan.executorThreadId) {
            yield* finalizeThread(plan.executorThreadId);
          }
          if (plan.reviewerThreadId) {
            yield* finalizeThread(plan.reviewerThreadId);
          }

          plan.state = "done";
          plan.error = null;
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);

          // Unblock dependents and notify UI
          for (const node of run.plans.values()) {
            if (node.state === "blocked" && node.dependsOn.includes(plan.planId)) {
              const allDepsResolved = node.dependsOn.every((dep) => {
                const depNode = run.plans.get(dep);
                return !depNode || depNode.state === "done";
              });
              if (allDepsResolved) {
                node.state = "ready";
                yield* publishPlanStateChanged(run, node.planId);
              }
            }
          }
        } else {
          // Fail (exhausted retries OR reviewer thread error). Archive both
          // executor + reviewer — they're done with their job either way.
          if (plan.executorThreadId) {
            yield* finalizeThread(plan.executorThreadId);
          }
          if (plan.reviewerThreadId) {
            yield* finalizeThread(plan.reviewerThreadId);
          }
          plan.state = "failed";
          plan.error = exhausted
            ? `Review failed after ${plan.maxRetries} fix attempts`
            : reviewResponse
              ? "Reviewer thread errored mid-fix"
              : "Reviewer thread failed to respond";
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);
          yield* markDependentsSkippedAndPublish(run, plan.planId);
        }
      }).pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            // Archive any spawned threads on unexpected errors
            if (plan.executorThreadId) {
              yield* finalizeThread(plan.executorThreadId);
            }
            if (plan.reviewerThreadId) {
              yield* finalizeThread(plan.reviewerThreadId);
            }
            plan.state = "failed";
            plan.error =
              err instanceof Error ? `Executor error: ${err.message}` : "Unexpected executor error";
            plan.completedAt = now();
            yield* publishPlanStateChanged(run, plan.planId);
            yield* markDependentsSkippedAndPublish(run, plan.planId);
          }),
        ),
      );

    // ── Main orchestration flow ───────────────────────────────────────

    const executeRun = (run: PlanRunState) =>
      Effect.gen(function* () {
        const projectCwd = yield* resolveProjectCwd(run.projectId);
        const plansDir = pathService.join(projectCwd, ".plans", run.featureName);

        // Phase 1: Read plan files
        const entries = yield* fs.readDirectory(plansDir);
        const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();

        if (mdFiles.length === 0) {
          run.state = "failed";
          run.summary = "No .md plan files found";
          run.completedAt = now();
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });
          return;
        }

        // Read all plan files
        const planContents = new Map<string, string>();
        for (const file of mdFiles) {
          const filePath = pathService.join(plansDir, file);
          const content = yield* fs.readFileString(filePath);
          planContents.set(file, content);
        }

        // Phase 2: Analyze dependencies — state = "analyzing"
        run.state = "analyzing";
        yield* publishEvent({
          type: "planRunner.stateChanged",
          runId: run.runId,
          snapshot: toSnapshot(run),
        });

        // Build initial PlanNode map from frontmatter
        for (const [file, content] of planContents) {
          const fallbackId = file.replace(/\.md$/, "");
          const parsed = parseFrontmatter(content, fallbackId);

          if (!parsed.body.trim()) {
            continue; // Skip empty plans
          }

          const node: MutablePlanNode = {
            planId: parsed.id,
            filename: file,
            state: "blocked",
            dependsOn: parsed.depends_on,
            maxRetries: parsed.max_retries,
            retriesUsed: 0,
            executorThreadId: null,
            reviewerThreadId: null,
            error: null,
            startedAt: null,
            completedAt: null,
            content: parsed.body,
            reviewFeedback: [],
          };
          run.plans.set(node.planId, node);
        }

        // AI-based dependency extraction for plans without YAML frontmatter deps
        const plansNeedingDeps = [...run.plans.values()].filter((p) => p.dependsOn.length === 0);
        if (plansNeedingDeps.length > 0 && run.plans.size > 1) {
          const aiDeps = yield* extractDependenciesWithAI(
            [...run.plans.values()].map((p) => ({
              planId: p.planId,
              content: p.content,
            })),
            run.modelSelection,
          );
          for (const [planId, deps] of aiDeps) {
            const node = run.plans.get(planId);
            if (node) {
              // Merge: keep any existing YAML-parsed deps, add AI-discovered
              const merged = new Set([...node.dependsOn, ...deps]);
              node.dependsOn = [...merged];
            }
          }
        }

        if (run.plans.size === 0) {
          run.state = "failed";
          run.summary = "All plan files have empty content";
          run.completedAt = now();
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });
          return;
        }

        // Spawn analyzer thread for dependency discovery
        const planSummaries = [...run.plans.values()]
          .map(
            (p) =>
              `## Plan: ${p.planId}\nExplicit deps: [${p.dependsOn.join(", ")}]\n\n${p.content.slice(0, 2000)}`,
          )
          .join("\n\n---\n\n");

        const analyzerPrompt = `You are a dependency analyzer for a multi-plan feature implementation.
Below are plan files for feature "${run.featureName}". Each has an id and may have explicit dependencies.
Your job:
1. Verify explicit dependencies are correct
2. Identify MISSING dependencies (plan A references types/files that plan B creates)
3. Return ONLY valid JSON, no markdown fences

Output format:
{ "plans": { "<planId>": { "depends_on": ["<depId>"] } }, "warnings": ["..."] }

Here are the plans:

${planSummaries}`;

        // Run analyzer — graceful degradation on failure
        const analyzerResponse: string | null = yield* Effect.gen(function* () {
          const { threadId } = yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Analyze: ${run.featureName}`,
            prompt: analyzerPrompt,
            modelSelection: run.modelSelection,
            branch: run.branch,
            worktreePath: run.worktreePath,
          });
          run.analyzerThreadId = threadId;
          yield* waitForThreadTurnComplete(threadId, run);
          return yield* readLastAssistantMessage(threadId);
        }).pipe(Effect.catch(() => Effect.succeed(null)));

        // Try to parse analyzer output and merge deps (graceful degradation)
        if (analyzerResponse) {
          yield* Effect.try({
            try: () => {
              const jsonMatch = analyzerResponse.match(/\{[\s\S]*"plans"[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as {
                  plans: Record<string, { depends_on: string[] }>;
                };
                for (const [planId, discovered] of Object.entries(parsed.plans)) {
                  const node = run.plans.get(planId);
                  if (node && discovered.depends_on) {
                    const existingDeps = new Set(node.dependsOn);
                    for (const dep of discovered.depends_on) {
                      if (run.plans.has(dep) && dep !== planId) {
                        existingDeps.add(dep);
                      }
                    }
                    node.dependsOn = [...existingDeps];
                  }
                }
              }
            },
            catch: () => new Error("Failed to parse analyzer output"),
          }).pipe(Effect.ignore);
        }

        // Detect cycles
        const depGraph = new Map<string, string[]>();
        for (const [id, node] of run.plans) {
          depGraph.set(id, node.dependsOn);
        }
        const cycleNodes = detectCycles(depGraph);
        if (cycleNodes) {
          run.state = "failed";
          run.summary = `Circular dependency detected among: ${cycleNodes.join(", ")}`;
          run.completedAt = now();
          // Mark cycle-involved plans as failed (others remain blocked but
          // the run is already terminating). Publish per-plan events so the
          // UI doesn't render lingering blocked circles after termination.
          const cycleSet = new Set(cycleNodes);
          for (const node of run.plans.values()) {
            if (cycleSet.has(node.planId)) {
              node.state = "failed";
              node.error = "Part of circular dependency";
              node.completedAt = now();
            } else if (node.state === "blocked") {
              node.state = "skipped";
              node.error = "Skipped: dependency cycle in feature";
              node.completedAt = now();
            }
            yield* publishPlanStateChanged(run, node.planId);
          }
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });
          return;
        }

        // Mark root plans as ready
        for (const node of run.plans.values()) {
          const allDepsResolved = node.dependsOn.every((dep) => {
            const depNode = run.plans.get(dep);
            return !depNode || depNode.state === "done";
          });
          if (allDepsResolved) {
            node.state = "ready";
          }
        }

        // Phase 3: Execute plans — state = "executing"
        run.state = "executing";
        yield* publishEvent({
          type: "planRunner.stateChanged",
          runId: run.runId,
          snapshot: toSnapshot(run),
        });

        // Main execution loop
        let continueLoop = true;
        while (continueLoop) {
          // Check cancellation flag
          if (run.cancelled) return;

          const readyPlans = [...run.plans.values()].filter((p) => p.state === "ready");
          const runningPlans = [...run.plans.values()].filter(
            (p) => p.state === "running" || p.state === "reviewing",
          );

          if (readyPlans.length === 0 && runningPlans.length === 0) {
            continueLoop = false;
            break;
          }

          if (readyPlans.length === 0) {
            yield* Effect.sleep("2 seconds");
            continue;
          }

          // Execute all ready plans in parallel
          yield* Effect.forEach(readyPlans, (plan) => executePlan(run, plan), {
            concurrency: "unbounded",
          });
        }

        // Phase 4: Integration — state = "integrating"
        const donePlans = [...run.plans.values()].filter((p) => p.state === "done");
        const failedPlans = [...run.plans.values()].filter(
          (p) => p.state === "failed" || p.state === "skipped",
        );

        if (donePlans.length === 0) {
          run.state = "failed";
          run.summary = "No plans completed successfully";
          run.completedAt = now();
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });
          return;
        }

        run.state = "integrating";
        yield* publishEvent({
          type: "planRunner.stateChanged",
          runId: run.runId,
          snapshot: toSnapshot(run),
        });

        const doneList = donePlans.map((p) => `- ${p.planId}`).join("\n");
        const failedList =
          failedPlans.length > 0
            ? failedPlans.map((p) => `- ${p.planId}: ${p.error ?? "unknown"}`).join("\n")
            : "None";

        const integrationPrompt = `You are an integration agent for feature "${run.featureName}".
Multiple executors implemented plans in parallel. Your job:

1. Run full check suite: bun typecheck && bun lint && bun test
2. Fix conflicts between parallel implementations
3. Check: duplicate imports, conflicting exports, inconsistent naming, missing wiring
4. Make fixes to get suite passing

Completed plans:
${doneList}

Failed/skipped:
${failedList}

After all fixes verified: end with INTEGRATION_PASS
If unresolvable: end with INTEGRATION_FAIL and explain`;

        // Run integration — graceful degradation on failure
        const integrationResponse: string | null = yield* Effect.gen(function* () {
          const { threadId } = yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Integration: ${run.featureName}`,
            prompt: integrationPrompt,
            modelSelection: run.modelSelection,
            branch: run.branch,
            worktreePath: run.worktreePath,
          });
          run.integrationThreadId = threadId;
          yield* waitForThreadTurnComplete(threadId, run);
          return yield* readLastAssistantMessage(threadId);
        }).pipe(Effect.catch(() => Effect.succeed(null)));

        if (integrationResponse?.includes("INTEGRATION_PASS")) {
          run.state = "completed";
          run.summary = `Feature "${run.featureName}" completed. ${donePlans.length} plans done, ${failedPlans.length} failed/skipped.`;

          // Run-level success — archive run-scoped helper threads. Per-plan
          // executor/reviewer threads were already archived at REVIEW_PASS.
          if (run.analyzerThreadId) {
            yield* finalizeThread(run.analyzerThreadId);
          }
          if (run.integrationThreadId) {
            yield* finalizeThread(run.integrationThreadId);
          }
        } else {
          run.state = "failed";
          run.summary = integrationResponse
            ? `Integration failed for "${run.featureName}". ${donePlans.length} plans done, ${failedPlans.length} failed/skipped.`
            : "Integration thread failed to complete";
        }

        run.completedAt = now();
        yield* publishEvent({
          type: "planRunner.completed",
          runId: run.runId,
          state: run.state,
          summary: run.summary,
          completedAt: run.completedAt!,
        });
      }).pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            run.state = "failed";
            run.summary =
              err instanceof Error
                ? `Plan execution error: ${err.message}`
                : "Unexpected error during plan execution";
            run.completedAt = now();
            // Mark any non-terminal plans as skipped and publish per-plan
            // events so the UI doesn't render stale blocked/ready/running
            // states after a top-level run failure.
            for (const node of run.plans.values()) {
              if (node.state !== "done" && node.state !== "failed" && node.state !== "skipped") {
                node.state = "skipped";
                node.error = node.error ?? "Skipped: run failed";
                node.completedAt = now();
                yield* publishPlanStateChanged(run, node.planId);
              }
            }
            yield* publishEvent({
              type: "planRunner.completed",
              runId: run.runId,
              state: run.state,
              summary: run.summary,
              completedAt: run.completedAt!,
            });
          }),
        ),
        // Cleanup worktree on failure. On success, keep it for user inspection.
        Effect.tap(() => (run.state === "failed" ? cleanupWorktree(run) : Effect.void)),
      );

    // ── Service implementation ────────────────────────────────────────

    return {
      start: (input) =>
        Effect.gen(function* () {
          const runId = PlanRunIdSchema.makeUnsafe(makeId());
          const branchName = `feature/${input.featureName}`;
          const projectCwd = yield* resolveProjectCwd(input.projectId);

          // Validate .plans directory exists
          const plansDir = pathService.join(projectCwd, ".plans", input.featureName);
          yield* fs.readDirectory(plansDir).pipe(
            Effect.catch(() =>
              Effect.fail(
                new PlanRunnerError({
                  message: `Plan directory not found: .plans/${input.featureName}/` as any,
                }),
              ),
            ),
          );

          // Check no duplicate active run
          const runs = yield* Ref.get(activeRuns);
          for (const existing of runs.values()) {
            if (
              existing.featureName === input.featureName &&
              existing.state !== "completed" &&
              existing.state !== "failed"
            ) {
              return yield* Effect.fail(
                new PlanRunnerError({
                  message: `Run already active for feature "${input.featureName}"` as any,
                }),
              );
            }
          }

          // Get model selection — use provided or get from project default
          let modelSelection: ModelSelection | undefined = input.modelSelection;
          if (!modelSelection) {
            const readModel = yield* orchestrationEngine.getReadModel();
            const project = readModel.projects.find((p) => p.id === input.projectId);
            if (project?.defaultModelSelection) {
              modelSelection = project.defaultModelSelection;
            } else {
              return yield* Effect.fail(
                new PlanRunnerError({
                  message: "No model selection provided and no project default found" as any,
                }),
              );
            }
          }

          // Resolve or create worktree — isolated filesystem for this plan run.
          // The branch may already exist if the user did manual setup first.
          const existingBranches = yield* gitCore
            .listLocalBranchNames(projectCwd)
            .pipe(Effect.catch(() => Effect.succeed([] as string[])));
          const branchExists = existingBranches.includes(branchName);

          let worktreePath: string;
          let ownsWorktree = true;

          if (branchExists) {
            // Branch already exists — check if it already has a worktree
            const branchInfo = yield* gitCore
              .listBranches({
                cwd: projectCwd as any,
                query: branchName as any,
              })
              .pipe(Effect.catch(() => Effect.succeed(null)));
            const existingWorktree = branchInfo?.branches.find(
              (b) => b.name === branchName && b.worktreePath,
            );

            if (existingWorktree?.worktreePath) {
              // Reuse existing worktree — don't remove on cleanup
              worktreePath = existingWorktree.worktreePath;
              ownsWorktree = false;
            } else {
              // Branch exists but no worktree — create worktree from it
              const worktreeResult = yield* gitCore
                .createWorktree({
                  cwd: projectCwd,
                  branch: branchName as any,
                  path: null,
                })
                .pipe(
                  Effect.catch((err: any) =>
                    Effect.fail(
                      new PlanRunnerError({
                        message:
                          `Failed to create worktree for existing branch "${branchName}": ${err.message ?? err}` as any,
                        cause: err,
                      }),
                    ),
                  ),
                );
              worktreePath = worktreeResult.worktree.path;
            }
          } else {
            // Branch doesn't exist — create worktree with new branch from HEAD
            const worktreeResult = yield* gitCore
              .createWorktree({
                cwd: projectCwd,
                branch: "HEAD",
                newBranch: branchName,
                path: null,
              })
              .pipe(
                Effect.catch((err: any) =>
                  Effect.fail(
                    new PlanRunnerError({
                      message:
                        `Failed to create worktree for "${branchName}": ${err.message ?? err}` as any,
                      cause: err,
                    }),
                  ),
                ),
              );
            worktreePath = worktreeResult.worktree.path;
          }

          // Construct run state
          const run: PlanRunState = {
            runId,
            featureName: input.featureName,
            projectId: input.projectId,
            branch: branchName,
            worktreePath,
            ownsWorktree,
            state: "analyzing",
            plans: new Map(),
            analyzerThreadId: null,
            integrationThreadId: null,
            startedAt: now(),
            completedAt: null,
            summary: null,
            cancelled: false,
            modelSelection,
          };

          // Store run
          yield* Ref.update(activeRuns, (m) => {
            const next = new Map(m);
            next.set(runId, run);
            return next;
          });

          // Emit an initial stateChanged so subscribed clients have a full
          // snapshot in their store before any subsequent event. Without
          // this, an early-fail or quick-cancel `completed` event may
          // arrive for a runId the client has never seen and be silently
          // dropped by the store reducer.
          yield* publishEvent({
            type: "planRunner.stateChanged",
            runId: run.runId,
            snapshot: toSnapshot(run),
          });

          // Fork execution into detached background fiber
          yield* executeRun(run).pipe(
            Effect.ignoreCause({ log: true }),
            Effect.forkDetach,
            Effect.asVoid,
          );

          return { runId, branch: branchName };
        }),

      getStatus: (runId) =>
        Effect.gen(function* () {
          const runs = yield* Ref.get(activeRuns);
          const run = runs.get(runId);
          if (!run) {
            return yield* Effect.fail(
              new PlanRunnerNotFoundError({
                runId,
                message: `Plan run "${runId}" not found` as any,
              }),
            );
          }
          return toSnapshot(run);
        }),

      cancel: (runId) =>
        Effect.gen(function* () {
          const runs = yield* Ref.get(activeRuns);
          const run = runs.get(runId);
          if (!run) {
            return yield* Effect.fail(
              new PlanRunnerNotFoundError({
                runId,
                message: `Plan run "${runId}" not found` as any,
              }),
            );
          }

          // Signal cancellation
          run.cancelled = true;

          // Stop all active thread sessions and mark non-terminal plans
          // skipped. Publish a planStateChanged event for each mutated plan
          // so subscribed UIs don't render stale running/reviewing states
          // after the run terminates.
          for (const node of run.plans.values()) {
            if (node.state !== "done" && node.state !== "failed" && node.state !== "skipped") {
              if (node.executorThreadId) {
                yield* stopThreadSession(node.executorThreadId);
              }
              if (node.reviewerThreadId) {
                yield* stopThreadSession(node.reviewerThreadId);
              }
              node.state = "skipped";
              node.error = "Cancelled by user";
              node.completedAt = now();
              yield* publishPlanStateChanged(run, node.planId);
            }
          }

          // Stop analyzer and integration threads if running
          if (run.analyzerThreadId) {
            yield* stopThreadSession(run.analyzerThreadId);
          }
          if (run.integrationThreadId) {
            yield* stopThreadSession(run.integrationThreadId);
          }

          run.state = "failed";
          run.summary = "Cancelled by user";
          run.completedAt = now();

          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });

          // Cleanup worktree on cancel
          yield* cleanupWorktree(run);
        }),

      listFeatures: (input) =>
        Effect.gen(function* () {
          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const plansDir = pathService.join(projectCwd, ".plans");
          const entries: string[] = [];

          const dirEntries = yield* fs.readDirectory(plansDir).pipe(
            // .plans/ doesn't exist → empty list
            Effect.catch(() => Effect.succeed([] as string[])),
          );
          if (dirEntries.length === 0) return { features: [] };

          for (const entry of dirEntries) {
            const entryPath = pathService.join(plansDir, entry);
            const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
            if (stat?.type === "Directory") {
              entries.push(entry);
            }
          }

          const runs = yield* Ref.get(activeRuns);
          const features = [];

          for (const featureName of entries) {
            const featureDir = pathService.join(plansDir, featureName);
            const planCount = yield* fs.readDirectory(featureDir).pipe(
              Effect.map((files) => files.filter((f) => f.endsWith(".md")).length),
              // skip unreadable dirs
              Effect.catch(() => Effect.succeed(0)),
            );

            // Check for active run
            let hasActiveRun = false;
            let activeRunId: PlanRunId | null = null;
            for (const run of runs.values()) {
              if (
                run.projectId === input.projectId &&
                run.featureName === featureName &&
                run.state !== "completed" &&
                run.state !== "failed"
              ) {
                hasActiveRun = true;
                activeRunId = run.runId;
                break;
              }
            }

            features.push({
              featureName,
              planCount,
              hasActiveRun,
              activeRunId,
            });
          }

          return { features };
        }).pipe(
          Effect.catch((err) => {
            if (err instanceof PlanRunnerError) return Effect.fail(err);
            return Effect.fail(
              new PlanRunnerError({
                message: "Failed to list features" as any,
                cause: err,
              }),
            );
          }),
        ),

      getFeaturePlans: (input) =>
        Effect.gen(function* () {
          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const featureDir = pathService.join(projectCwd, ".plans", input.featureName);

          const dirEntries = yield* fs.readDirectory(featureDir).pipe(
            Effect.catch(() =>
              Effect.fail(
                new PlanRunnerError({
                  message: `Feature directory not found: .plans/${input.featureName}` as any,
                }),
              ),
            ),
          );
          const files = dirEntries.filter((f: string) => f.endsWith(".md"));

          const plans: Array<{
            planId: string;
            filename: string;
            dependsOn: string[];
            maxRetries: number;
            content: string;
          }> = [];
          for (const filename of files) {
            const filePath = pathService.join(featureDir, filename);
            const rawContent = yield* fs.readFileString(filePath).pipe(
              Effect.catch(() =>
                Effect.fail(
                  new PlanRunnerError({
                    message: `Failed to read plan file: ${filename}` as any,
                  }),
                ),
              ),
            );
            const parsed = parseFrontmatter(rawContent, filename.replace(/\.md$/, ""));
            plans.push({
              planId: parsed.id,
              filename,
              dependsOn: parsed.depends_on,
              maxRetries: parsed.max_retries,
              content: parsed.body,
            });
          }

          // AI-based dependency extraction for plans without YAML frontmatter deps
          // Graceful degradation: skip if settings unavailable or AI extraction fails
          const plansNeedingDeps = plans.filter((p) => p.dependsOn.length === 0);
          if (plansNeedingDeps.length > 0 && plans.length > 1) {
            yield* Effect.gen(function* () {
              const settings = yield* serverSettingsService.getSettings;
              const aiDeps = yield* extractDependenciesWithAI(
                plans.map((p) => ({
                  planId: p.planId,
                  content: p.content,
                })),
                settings.textGenerationModelSelection,
              );
              for (const plan of plans) {
                const discovered = aiDeps.get(plan.planId);
                if (discovered) {
                  const merged = new Set([...plan.dependsOn, ...discovered]);
                  plan.dependsOn = [...merged];
                }
              }
            }).pipe(Effect.ignore);
          }

          return { featureName: input.featureName, plans };
        }).pipe(
          Effect.catch((err) => {
            if (err instanceof PlanRunnerError) return Effect.fail(err);
            return Effect.fail(
              new PlanRunnerError({
                message: "Failed to read feature plans" as any,
                cause: err,
              }),
            );
          }),
          Effect.catchDefect((defect) =>
            Effect.fail(
              new PlanRunnerError({
                message:
                  `Failed to read feature plans: ${defect instanceof Error ? defect.message : String(defect)}` as any,
              }),
            ),
          ),
        ),

      listRuns: (input) =>
        Effect.gen(function* () {
          const runs = yield* Ref.get(activeRuns);
          const snapshots: PlanRunSnapshot[] = [];
          for (const run of runs.values()) {
            if (input.projectId && run.projectId !== input.projectId) {
              continue;
            }
            snapshots.push(toSnapshot(run));
          }
          return { runs: snapshots };
        }),

      get streamEvents() {
        return Stream.fromPubSub(eventPubSub);
      },
    } satisfies PlanRunnerServiceShape;
  }),
);
