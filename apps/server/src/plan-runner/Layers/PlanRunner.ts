import {
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Stream,
} from "effect";
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
import {
  PlanRunnerService,
  type PlanRunnerServiceShape,
} from "../Services/PlanRunner";

// ─── Internal types ─────────────────────────────────────────────────────────

interface PlanRunState {
  runId: PlanRunId;
  featureName: string;
  projectId: ProjectId;
  branch: string;
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
}

interface ParsedFrontmatter {
  id: string;
  depends_on: string[];
  max_retries: number;
  body: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseFrontmatter(
  content: string,
  fallbackId: string,
): ParsedFrontmatter {
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
      depends_on = depsMatch[1]
        .split(",")
        .map((d) => d.trim().replace(/^["']|["']$/g, ""));
    }
  }

  // Handle multi-line depends_on (YAML list format)
  const depsListMatch = yaml.match(
    /depends_on:\s*\n((?:\s+-\s+.+\n?)*)/,
  );
  if (depsListMatch?.[1] && depends_on.length === 0) {
    depends_on = depsListMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean)
      .map((d) => d.replace(/^["']|["']$/g, ""));
  }

  return { id: id ?? fallbackId, depends_on, max_retries, body };
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

    const eventPubSub = yield* PubSub.unbounded<PlanRunnerEvent>();
    const activeRuns = yield* Ref.make(
      new Map<string, PlanRunState>(),
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

    // ── Thread bootstrapping ──────────────────────────────────────────

    const bootstrapThreadWithPrompt = (input: {
      projectId: ProjectId;
      title: string;
      prompt: string;
      modelSelection: ModelSelection;
    }) =>
      Effect.gen(function* () {
        const threadId = ThreadId.makeUnsafe(makeId());
        const commandId = CommandId.makeUnsafe(
          `plan-runner:create:${makeId()}`,
        );
        const createdAt = now();

        // Create thread
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId,
          threadId,
          projectId: input.projectId,
          title: input.title as any,
          modelSelection: input.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        });

        // Start turn with prompt
        const turnCommandId = CommandId.makeUnsafe(
          `plan-runner:turn:${makeId()}`,
        );
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

    const waitForThreadTurnComplete = (
      targetThreadId: string,
    ): Effect.Effect<{ ok: boolean; error: string | null }, never, never> => {
      const poll: Effect.Effect<
        { ok: boolean; error: string | null },
        never,
        never
      > = Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const thread = readModel.threads.find(
          (t) => t.id === targetThreadId,
        );
        if (!thread?.session) {
          return { ok: true, error: null };
        }

        const session = thread.session;
        if (session.activeTurnId === null) {
          if (
            session.status === "error" ||
            session.status === "stopped"
          ) {
            return {
              ok: false,
              error: session.lastError ?? "Thread session error",
            };
          }
          return { ok: true, error: null };
        }

        // Still running — wait and retry
        yield* Effect.sleep("3 seconds");
        return yield* poll;
      });

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

    const markDependentsSkipped = (
      run: PlanRunState,
      failedPlanId: string,
    ): void => {
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
            findDependents(id);
          }
        }
      };

      findDependents(failedPlanId);
    };

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

        // Bootstrap executor thread
        const executorPrompt = `You are implementing a plan as part of a larger feature. Implement completely. No TODOs. No placeholders.

# Plan: ${plan.planId}
# Feature: ${run.featureName}

${plan.content}`;

        const { threadId: executorThreadId } =
          yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Execute: ${plan.planId}`,
            prompt: executorPrompt,
            modelSelection: run.modelSelection,
          });
        plan.executorThreadId = executorThreadId;

        // Wait for executor
        const execResult =
          yield* waitForThreadTurnComplete(executorThreadId);
        if (!execResult.ok) {
          plan.state = "failed";
          plan.error = execResult.error ?? "Executor thread failed";
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);
          markDependentsSkipped(run, plan.planId);
          return;
        }

        // Mark reviewing
        plan.state = "reviewing";
        yield* publishPlanStateChanged(run, plan.planId);

        // Bootstrap reviewer thread
        const reviewerPrompt = `You are a code reviewer for plan "${plan.planId}" in feature "${run.featureName}".
The executor has just implemented this plan. Your job:

1. Run verification:
   - bun typecheck
   - bun lint
   - bun test

2. Verify implementation correctness:
   - All tasks in plan completed
   - No placeholder/TODO code left
   - No dead code, unused imports, half-baked implementations
   - Code follows existing codebase patterns

3. Report findings.

If ALL checks pass and implementation is correct: end with REVIEW_PASS
If ANY check fails or implementation incomplete: end with REVIEW_FAIL and explain fixes needed.

Plan that was supposed to be implemented:
# Plan: ${plan.planId}
${plan.content}`;

        const { threadId: reviewerThreadId } =
          yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Review: ${plan.planId}`,
            prompt: reviewerPrompt,
            modelSelection: run.modelSelection,
          });
        plan.reviewerThreadId = reviewerThreadId;

        // Wait for reviewer
        yield* waitForThreadTurnComplete(reviewerThreadId);

        // Parse reviewer response
        const reviewResponse =
          yield* readLastAssistantMessage(reviewerThreadId);

        if (reviewResponse?.includes("REVIEW_PASS")) {
          // Pass — mark done and unblock dependents
          plan.state = "done";
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);

          // Unblock dependents
          for (const node of run.plans.values()) {
            if (
              node.state === "blocked" &&
              node.dependsOn.includes(plan.planId)
            ) {
              const allDepsResolved = node.dependsOn.every((dep) => {
                const depNode = run.plans.get(dep);
                return !depNode || depNode.state === "done";
              });
              if (allDepsResolved) {
                node.state = "ready";
              }
            }
          }
        } else if (plan.retriesUsed < plan.maxRetries) {
          // Fail but retries left — re-queue
          plan.retriesUsed++;
          plan.state = "ready";
          plan.error = "Review failed, retrying";
          yield* publishPlanStateChanged(run, plan.planId);
        } else {
          // Fail and exhausted retries
          plan.state = "failed";
          plan.error = reviewResponse
            ? `Review failed after ${plan.maxRetries} retries`
            : "Reviewer thread failed to respond";
          plan.completedAt = now();
          yield* publishPlanStateChanged(run, plan.planId);
          markDependentsSkipped(run, plan.planId);
        }
      }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            plan.state = "failed";
            plan.error = "Unexpected executor error";
            plan.completedAt = now();
            yield* publishPlanStateChanged(run, plan.planId);
            markDependentsSkipped(run, plan.planId);
          }),
        ),
      );

    // ── Main orchestration flow ───────────────────────────────────────

    const executeRun = (run: PlanRunState) =>
      Effect.gen(function* () {
        const projectCwd = yield* resolveProjectCwd(run.projectId);
        const plansDir = pathService.join(
          projectCwd,
          ".plans",
          run.featureName,
        );

        // Phase 1: Read plan files
        const entries = yield* fs.readDirectory(plansDir);
        const mdFiles = entries
          .filter((f) => f.endsWith(".md"))
          .sort();

        if (mdFiles.length === 0) {
          run.state = "failed";
          run.summary = "No .md plan files found";
          run.completedAt = now();
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
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
          };
          run.plans.set(node.planId, node);
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
        const analyzerResponse: string | null = yield* Effect.gen(
          function* () {
            const { threadId } = yield* bootstrapThreadWithPrompt({
              projectId: run.projectId,
              title: `[PlanRunner] Analyze: ${run.featureName}`,
              prompt: analyzerPrompt,
              modelSelection: run.modelSelection,
            });
            run.analyzerThreadId = threadId;
            yield* waitForThreadTurnComplete(threadId);
            return yield* readLastAssistantMessage(threadId);
          },
        ).pipe(Effect.catch(() => Effect.succeed(null)));

        // Try to parse analyzer output and merge deps (graceful degradation)
        if (analyzerResponse) {
          yield* Effect.try({
            try: () => {
              const jsonMatch = analyzerResponse.match(
                /\{[\s\S]*"plans"[\s\S]*\}/,
              );
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as {
                  plans: Record<string, { depends_on: string[] }>;
                };
                for (const [planId, discovered] of Object.entries(
                  parsed.plans,
                )) {
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
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
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

          const readyPlans = [...run.plans.values()].filter(
            (p) => p.state === "ready",
          );
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
          yield* Effect.forEach(
            readyPlans,
            (plan) => executePlan(run, plan),
            { concurrency: "unbounded" },
          );
        }

        // Phase 4: Integration — state = "integrating"
        const donePlans = [...run.plans.values()].filter(
          (p) => p.state === "done",
        );
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
          });
          return;
        }

        run.state = "integrating";
        yield* publishEvent({
          type: "planRunner.stateChanged",
          runId: run.runId,
          snapshot: toSnapshot(run),
        });

        const doneList = donePlans
          .map((p) => `- ${p.planId}`)
          .join("\n");
        const failedList =
          failedPlans.length > 0
            ? failedPlans
                .map((p) => `- ${p.planId}: ${p.error ?? "unknown"}`)
                .join("\n")
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
        const integrationResponse: string | null = yield* Effect.gen(
          function* () {
            const { threadId } = yield* bootstrapThreadWithPrompt({
              projectId: run.projectId,
              title: `[PlanRunner] Integration: ${run.featureName}`,
              prompt: integrationPrompt,
              modelSelection: run.modelSelection,
            });
            run.integrationThreadId = threadId;
            yield* waitForThreadTurnComplete(threadId);
            return yield* readLastAssistantMessage(threadId);
          },
        ).pipe(Effect.catch(() => Effect.succeed(null)));

        if (integrationResponse?.includes("INTEGRATION_PASS")) {
          run.state = "completed";
          run.summary = `Feature "${run.featureName}" completed. ${donePlans.length} plans done, ${failedPlans.length} failed/skipped.`;
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
        });
      }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            run.state = "failed";
            run.summary = "Unexpected error during plan execution";
            run.completedAt = now();
            yield* publishEvent({
              type: "planRunner.completed",
              runId: run.runId,
              state: run.state,
              summary: run.summary,
            });
          }),
        ),
      );

    // ── Service implementation ────────────────────────────────────────

    return {
      start: (input) =>
        Effect.gen(function* () {
          const runId = PlanRunIdSchema.makeUnsafe(makeId());
          const branchName = `feature/${input.featureName}`;
          const projectCwd = yield* resolveProjectCwd(input.projectId);

          // Validate .plans directory exists
          const plansDir = pathService.join(
            projectCwd,
            ".plans",
            input.featureName,
          );
          yield* fs.readDirectory(plansDir).pipe(
            Effect.catch(() =>
              Effect.fail(
                new PlanRunnerError({
                  message:
                    `Plan directory not found: .plans/${input.featureName}/` as any,
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
                  message:
                    `Run already active for feature "${input.featureName}"` as any,
                }),
              );
            }
          }

          // Get model selection — use provided or get from project default
          let modelSelection: ModelSelection | undefined =
            input.modelSelection;
          if (!modelSelection) {
            const readModel =
              yield* orchestrationEngine.getReadModel();
            const project = readModel.projects.find(
              (p) => p.id === input.projectId,
            );
            if (project?.defaultModelSelection) {
              modelSelection = project.defaultModelSelection;
            } else {
              return yield* Effect.fail(
                new PlanRunnerError({
                  message:
                    "No model selection provided and no project default found" as any,
                }),
              );
            }
          }

          // Create branch
          yield* gitCore
            .createBranch({
              cwd: projectCwd,
              branch: branchName as any,
              checkout: true,
            })
            .pipe(
              Effect.catch((err: any) =>
                Effect.fail(
                  new PlanRunnerError({
                    message:
                      `Failed to create branch "${branchName}": ${err.message ?? err}` as any,
                    cause: err,
                  }),
                ),
              ),
            );

          // Construct run state
          const run: PlanRunState = {
            runId,
            featureName: input.featureName,
            projectId: input.projectId,
            branch: branchName,
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

          // Mark non-terminal plans skipped
          for (const node of run.plans.values()) {
            if (
              node.state !== "done" &&
              node.state !== "failed" &&
              node.state !== "skipped"
            ) {
              node.state = "skipped";
              node.error = "Cancelled by user";
              node.completedAt = now();
            }
          }

          run.state = "failed";
          run.summary = "Cancelled by user";
          run.completedAt = now();

          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
          });
        }),

      listFeatures: (input) =>
        Effect.gen(function* () {
          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const plansDir = pathService.join(projectCwd, ".plans");
          let entries: string[] = [];
          try {
            const dirEntries = yield* fs.readDirectory(plansDir);
            // Filter for directories only
            for (const entry of dirEntries) {
              const entryPath = pathService.join(plansDir, entry);
              const stat = yield* fs.stat(entryPath);
              if (stat.type === "Directory") {
                entries.push(entry);
              }
            }
          } catch {
            // .plans/ doesn't exist → empty list
            return { features: [] };
          }

          const runs = yield* Ref.get(activeRuns);
          const features = [];

          for (const featureName of entries) {
            const featureDir = pathService.join(plansDir, featureName);
            let planCount = 0;
            try {
              const files = yield* fs.readDirectory(featureDir);
              planCount = files.filter((f) => f.endsWith(".md")).length;
            } catch {
              // skip unreadable dirs
            }

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
          Effect.catch(() =>
            Effect.fail(
              new PlanRunnerError({
                message: "Failed to list features" as any,
              }),
            ),
          ),
        ),

      getFeaturePlans: (input) =>
        Effect.gen(function* () {
          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const featureDir = pathService.join(
            projectCwd,
            ".plans",
            input.featureName,
          );

          let files: string[];
          try {
            const dirEntries = yield* fs.readDirectory(featureDir);
            files = dirEntries.filter((f) => f.endsWith(".md"));
          } catch {
            return yield* Effect.fail(
              new PlanRunnerError({
                message:
                  `Feature directory not found: .plans/${input.featureName}` as any,
              }),
            );
          }

          const plans = [];
          for (const filename of files) {
            const filePath = pathService.join(featureDir, filename);
            const rawContent = yield* fs.readFileString(filePath);
            const parsed = parseFrontmatter(
              rawContent,
              filename.replace(/\.md$/, ""),
            );
            plans.push({
              planId: parsed.id,
              filename,
              dependsOn: parsed.depends_on,
              maxRetries: parsed.max_retries,
              content: parsed.body,
            });
          }

          return { featureName: input.featureName, plans };
        }).pipe(
          Effect.catch(() =>
            Effect.fail(
              new PlanRunnerError({
                message: "Failed to read feature plans" as any,
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
