import {
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Scope,
  Schema,
  Stream,
} from "effect";
import type {
  FeatureState,
  ModelSelection,
  PlanRunId,
  PlanRunnerEvent,
  PlanRunnerLogEntry,
  PlanRunnerLogEntryKind,
  PlanRunnerStepKind,
  PlanRunnerThreadRole,
  PlanRunSnapshot,
  PlanState,
  ProjectId,
} from "@fenrir/contracts";
import {
  CommandId,
  MessageId,
  NonNegativeInt,
  PlanRunId as PlanRunIdSchema,
  PlanRunnerError,
  PlanRunnerLogEntryId,
  PlanRunnerNotFoundError,
  ThreadId,
} from "@fenrir/contracts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { GitCore } from "../../git/Services/GitCore";
import { PlanRunnerRepository } from "../../persistence/Services/PlanRunnerRepository";
import type {
  PlanRunnerInternalThreadRow,
  PlanRunnerRunRow,
  PlanRunnerStepRow,
  PlanRunnerSyntheticLogEntryAppend,
  PlanRunnerSyntheticLogEntryRow,
} from "../../persistence/Services/PlanRunnerRepository";
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
  /**
   * Order in which plan steps started. Used to assign execution_order on
   * first state transition out of `blocked`/`ready`. Analyzer/integration
   * steps are seeded with their own deterministic order at start-time.
   */
  nextExecutionOrder: number;
  analyzerThreadId: string | null;
  integrationThreadId: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  cancelled: boolean;
  modelSelection: ModelSelection;
  maxConcurrency: number;
  /**
   * Frozen plan content keyed by planId. Captured at `start()` time and used
   * for executor/reviewer prompts. Subsequent edits to `.plans/` do not
   * affect the running execution.
   */
  planContent: Map<string, string>;
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
  /** Stable step key used in persistence + step-log queries. */
  stepKey: string;
  state: PlanState;
  dependsOn: string[];
  maxRetries: number;
  retriesUsed: number;
  executorThreadId: string | null;
  reviewerThreadId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Frozen plan body (sans frontmatter). */
  content: string;
  /** Feedback from prior failed review passes, oldest → newest. */
  reviewFeedback: ReviewFeedback[];
  /** True once `executionOrder` has been assigned + persisted. */
  executionOrderAssigned: boolean;
}

interface SyntheticStepStatePatch {
  stepKey: string;
  state: PlanState;
  error?: string | null;
  failureSummary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface ParsedFrontmatter {
  id: string;
  depends_on: string[];
  max_retries: number;
  body: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ANALYZER_STEP_KEY = "analyzer";
const INTEGRATION_STEP_KEY = "integration";
const planStepKey = (planId: string) => `plan:${planId}`;

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

const featureKey = (projectId: ProjectId, featureName: string) => `${projectId}:${featureName}`;

const stepLogKey = (runId: PlanRunId, stepKey: string) => `${runId}:${stepKey}`;

const TERMINAL_FEATURE_STATES: ReadonlyArray<FeatureState> = ["completed", "failed"] as const;

const isTerminalFeatureState = (state: FeatureState): boolean =>
  TERMINAL_FEATURE_STATES.includes(state);

// ─── Persistence row builders (pure, hoisted for reuse) ─────────────────────

function buildRunRow(run: PlanRunState): PlanRunnerRunRow {
  return {
    runId: run.runId,
    projectId: run.projectId,
    featureName: run.featureName as any,
    state: run.state,
    summary: run.summary,
    branch: run.branch as any,
    worktreePath: run.worktreePath,
    ownsWorktree: run.ownsWorktree,
    modelSelection: run.modelSelection,
    maxConcurrency: run.maxConcurrency,
    startedAt: run.startedAt as any,
    completedAt: run.completedAt as any,
    lastUpdatedAt: (run.completedAt ?? run.startedAt) as any,
  };
}

function buildPlanStepRow(
  run: PlanRunState,
  plan: MutablePlanNode,
  executionOrder: number,
): PlanRunnerStepRow {
  return {
    runId: run.runId,
    stepKey: plan.stepKey as any,
    stepKind: "plan" as PlanRunnerStepKind,
    planId: plan.planId,
    filename: plan.filename as any,
    planMarkdown: plan.content,
    dependsOn: plan.dependsOn,
    state: plan.state,
    maxRetries: plan.maxRetries,
    retriesUsed: plan.retriesUsed,
    error: plan.error,
    failureSummary: null,
    startedAt: plan.startedAt as any,
    completedAt: plan.completedAt as any,
    executionOrder: NonNegativeInt.makeUnsafe(executionOrder),
  };
}

function buildSyntheticStepRow(
  run: PlanRunState,
  stepKey: string,
  kind: PlanRunnerStepKind,
  executionOrder: number,
): PlanRunnerStepRow {
  return {
    runId: run.runId,
    stepKey: stepKey as any,
    stepKind: kind,
    planId: null,
    filename: null,
    planMarkdown: null,
    dependsOn: [],
    state: "blocked" as PlanState,
    maxRetries: 0,
    retriesUsed: 0,
    error: null,
    failureSummary: null,
    startedAt: null,
    completedAt: null,
    executionOrder: NonNegativeInt.makeUnsafe(executionOrder),
  };
}

// ─── Layer ──────────────────────────────────────────────────────────────────

export const PlanRunnerLive = Layer.effect(
  PlanRunnerService,
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const gitCore = yield* GitCore;
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const repo = yield* PlanRunnerRepository;

    const eventPubSub = yield* PubSub.unbounded<PlanRunnerEvent>();

    /**
     * Per-(runId, stepKey) monotonic counter used to assign stable
     * `sequence` values to log entries published via
     * `planRunner.stepLogAppended`. Reads through `getStepLog` re-derive
     * sequences from a deterministic merge so historical responses stay
     * stable; live appends use this counter so subscribers can append
     * without resorting.
     */
    const stepLogSequences = yield* Ref.make(new Map<string, number>());

    /**
     * Reverse index from internal thread id → owning run/step. Lets the
     * orchestration domain-event subscription route message/activity events
     * to the correct plan-runner step log without scanning the active runs
     * map.
     */
    const threadStepIndex = yield* Ref.make(
      new Map<
        string,
        {
          runId: PlanRunId;
          stepKey: string;
          threadRole: PlanRunnerThreadRole;
        }
      >(),
    );
    /**
     * Hot in-memory cache for the executor fiber. The repository is the
     * source of truth — anything in this map is also durable on disk. Reads
     * that need history fall through to the repository when a run is not
     * cached locally.
     */
    const activeRuns = yield* Ref.make(new Map<string, PlanRunState>());

    /**
     * Features whose persisted run was non-terminal at boot and is being
     * reconciled. New `start()` requests for these features are rejected
     * until reconciliation finishes.
     */
    const recoveringFeatures = yield* Ref.make(new Set<string>());

    /**
     * Cache for getFeaturePlans results. Key: "projectId:featureName".
     * Avoids redundant disk reads on repeated sidebar unfolds.
     * Invalidated by file watcher or when a run starts.
     */
    const featurePlansCache = yield* Ref.make(
      new Map<
        string,
        {
          plans: Array<{
            planId: string;
            filename: string;
            dependsOn: string[];
            maxRetries: number;
            content: string;
          }>;
          cachedAt: number;
        }
      >(),
    );

    /** Track which projects have an active `.plans/` file watcher. */
    const watchedProjects = yield* Ref.make(new Set<string>());
    const watcherScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

    // Independent scope for boot recovery work + active executor fibers so
    // they outlive the layer's effect-gen but are still cleaned up when the
    // layer scope closes.
    const runtimeScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));

    // ── Project CWD resolver ─────────────────────────────────────────

    const resolveProjectCwd = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const project = readModel.projects.find((p) => p.id === projectId);
        if (!project) {
          return yield* new PlanRunnerError({
            message: `Project not found: ${projectId}` as any,
          });
        }
        return project.workspaceRoot;
      });

    // ── Publish helper ────────────────────────────────────────────────

    const publishEvent = (event: PlanRunnerEvent) =>
      PubSub.publish(eventPubSub, event).pipe(Effect.asVoid);

    const publishPersistedSnapshot = (runId: PlanRunId) =>
      Effect.gen(function* () {
        const persisted = yield* repo
          .getRunById({ runId })
          .pipe(Effect.catch(() => Effect.succeed(Option.none<PlanRunSnapshot>())));
        if (Option.isNone(persisted)) return;
        yield* publishEvent({
          type: "planRunner.stateChanged",
          runId,
          snapshot: persisted.value,
        });
      });

    // ── Step-log helpers ──────────────────────────────────────────────

    /**
     * Reserve the next live sequence for `(runId, stepKey)` and return it.
     * Live sequences are independent from the deterministic order assigned
     * by `getStepLog`; the entry id is the stable dedupe key on the wire.
     */
    const allocateLiveSequence = (runId: PlanRunId, stepKey: string) =>
      Ref.modify(stepLogSequences, (m) => {
        const key = stepLogKey(runId, stepKey);
        const current = m.get(key) ?? 0;
        const next = new Map(m);
        next.set(key, current + 1);
        return [current, next] as const;
      });

    /**
     * Bump the live sequence counter to at least `min` so that future live
     * appends are emitted with sequences greater than any sequence returned
     * from a prior `getStepLog` snapshot.
     */
    const ensureSequenceAtLeast = (runId: PlanRunId, stepKey: string, min: number) =>
      Ref.update(stepLogSequences, (m) => {
        const key = stepLogKey(runId, stepKey);
        if ((m.get(key) ?? 0) >= min) return m;
        const next = new Map(m);
        next.set(key, min);
        return next;
      });

    const registerThreadForStep = (
      runId: PlanRunId,
      stepKey: string,
      threadId: string,
      threadRole: PlanRunnerThreadRole,
    ) =>
      Ref.update(threadStepIndex, (m) => {
        const next = new Map(m);
        next.set(threadId, { runId, stepKey, threadRole });
        return next;
      });

    /**
     * Build a normalized log entry from a persisted synthetic row. Centralized
     * so the live-publish path and the read-side `getStepLog` projection
     * agree on field shape.
     */
    const syntheticRowToLogEntry = (
      row: PlanRunnerSyntheticLogEntryRow,
      sequence: number,
    ): PlanRunnerLogEntry => {
      const fallbackTitle = "Plan runner event";
      const title = (row.title ?? fallbackTitle).trim() || fallbackTitle;
      const copy = (row.copyText ?? row.title ?? row.bodyText ?? title).trim() || title;
      return {
        entryId: PlanRunnerLogEntryId.makeUnsafe(`${row.runId}:${row.stepKey}:syn:${row.sequence}`),
        runId: row.runId,
        stepKey: row.stepKey,
        kind: row.kind,
        sequence: NonNegativeInt.makeUnsafe(sequence),
        createdAt: row.createdAt,
        threadId: null,
        threadRole: null,
        title: title as PlanRunnerLogEntry["title"],
        bodyMarkdown: row.bodyMarkdown,
        bodyText: row.bodyText,
        copyText: copy,
        payload: row.payload,
      };
    };

    /**
     * Persist a synthetic log entry and (best-effort) publish it as a live
     * append. Failures to persist or publish never abort the runner — the
     * read-side projection re-derives history from the durable rows on the
     * next `getStepLog`.
     */
    const emitSyntheticLogEntry = (
      run: PlanRunState,
      stepKey: string,
      append: PlanRunnerSyntheticLogEntryAppend,
    ) =>
      Effect.gen(function* () {
        const row = yield* repo
          .appendSyntheticLogEntry({
            runId: run.runId,
            stepKey: stepKey as any,
            entry: append,
          })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!row) return;
        const sequence = yield* allocateLiveSequence(run.runId, stepKey);
        const entry = syntheticRowToLogEntry(row, sequence);
        yield* publishEvent({
          type: "planRunner.stepLogAppended",
          runId: run.runId,
          stepKey: stepKey as any,
          entry,
        });
      });

    /**
     * Build a normalized log entry from an orchestration message. Returns
     * `null` for messages that should not appear in the merged step log
     * (system messages, empty bodies, mid-stream snapshots).
     */
    const messageToLogEntry = (input: {
      runId: PlanRunId;
      stepKey: string;
      threadId: string;
      threadRole: PlanRunnerThreadRole;
      messageId: string;
      role: "user" | "assistant" | "system";
      text: string;
      streaming: boolean;
      turnId: string | null;
      createdAt: string;
      sequence: number;
    }): PlanRunnerLogEntry | null => {
      if (input.role === "system") return null;
      if (input.streaming) return null;
      const text = (input.text ?? "").trim();
      if (text.length === 0) return null;
      const kind: PlanRunnerLogEntryKind = input.role === "user" ? "prompt" : "assistant";
      const title = kind === "prompt" ? "User prompt" : "Assistant message";
      return {
        entryId: PlanRunnerLogEntryId.makeUnsafe(
          `${input.runId}:${input.stepKey}:msg:${input.messageId}`,
        ),
        runId: input.runId,
        stepKey: input.stepKey as PlanRunnerLogEntry["stepKey"],
        kind,
        sequence: NonNegativeInt.makeUnsafe(input.sequence),
        createdAt: input.createdAt,
        threadId: ThreadId.makeUnsafe(input.threadId),
        threadRole: input.threadRole,
        title: title as PlanRunnerLogEntry["title"],
        bodyMarkdown: input.text,
        bodyText: input.text,
        copyText: input.text,
        payload: {
          messageId: input.messageId,
          role: input.role,
          turnId: input.turnId,
        },
      };
    };

    const activityToLogEntry = (input: {
      runId: PlanRunId;
      stepKey: string;
      threadId: string;
      threadRole: PlanRunnerThreadRole;
      activityId: string;
      kind: string;
      tone: string;
      summary: string;
      payload: unknown;
      turnId: string | null;
      activitySequence: number | null;
      createdAt: string;
      sequence: number;
    }): PlanRunnerLogEntry | null => {
      const summary = (input.summary ?? "").trim();
      if (summary.length === 0) return null;
      return {
        entryId: PlanRunnerLogEntryId.makeUnsafe(
          `${input.runId}:${input.stepKey}:act:${input.activityId}`,
        ),
        runId: input.runId,
        stepKey: input.stepKey as PlanRunnerLogEntry["stepKey"],
        kind: "activity",
        sequence: NonNegativeInt.makeUnsafe(input.sequence),
        createdAt: input.createdAt,
        threadId: ThreadId.makeUnsafe(input.threadId),
        threadRole: input.threadRole,
        title: summary as PlanRunnerLogEntry["title"],
        bodyMarkdown: null,
        bodyText: input.summary,
        copyText: input.summary,
        payload: {
          kind: input.kind,
          tone: input.tone,
          payload: input.payload,
          turnId: input.turnId,
          sequence: input.activitySequence,
        },
      };
    };

    // ── Persistence helpers (write-through cache) ─────────────────────

    const persistRunStateTransition = (run: PlanRunState) =>
      Effect.gen(function* () {
        yield* repo
          .updateRunState({
            runId: run.runId,
            patch: {
              state: run.state,
              summary: run.summary,
              completedAt: run.completedAt,
              lastUpdatedAt: now() as any,
            },
          })
          .pipe(Effect.ignoreCause({ log: true }));
        yield* publishPersistedSnapshot(run.runId).pipe(Effect.ignoreCause({ log: true }));
      });

    const persistStepStateTransition = (run: PlanRunState, plan: MutablePlanNode) =>
      Effect.gen(function* () {
        const lastUpdatedAt = now();
        yield* repo
          .updateStepState({
            runId: run.runId,
            stepKey: plan.stepKey as any,
            patch: {
              state: plan.state,
              error: plan.error,
              retriesUsed: plan.retriesUsed,
              startedAt: plan.startedAt,
              completedAt: plan.completedAt,
            },
            lastUpdatedAt: lastUpdatedAt as any,
          })
          .pipe(Effect.ignoreCause({ log: true }));

        // Assign execution_order the first time a plan transitions out of
        // ready/blocked. Analyzer + integration steps get their order from
        // the original snapshot; plans get the next available slot.
        if (
          !plan.executionOrderAssigned &&
          plan.state !== "blocked" &&
          plan.state !== "ready" &&
          plan.state !== "skipped"
        ) {
          const nextOrder = run.nextExecutionOrder;
          run.nextExecutionOrder += 1;
          plan.executionOrderAssigned = true;
          yield* repo
            .setStepExecutionOrder({
              runId: run.runId,
              stepKey: plan.stepKey as any,
              executionOrder: NonNegativeInt.makeUnsafe(nextOrder),
              lastUpdatedAt: lastUpdatedAt as any,
            })
            .pipe(Effect.ignoreCause({ log: true }));
        }
        yield* publishPersistedSnapshot(run.runId).pipe(Effect.ignoreCause({ log: true }));
      });

    const persistSyntheticStepStateTransition = (
      run: PlanRunState,
      patch: SyntheticStepStatePatch,
    ) =>
      Effect.gen(function* () {
        const lastUpdatedAt = now();
        yield* repo
          .updateStepState({
            runId: run.runId,
            stepKey: patch.stepKey as any,
            patch: {
              state: patch.state,
              error: patch.error,
              failureSummary: patch.failureSummary,
              startedAt: patch.startedAt,
              completedAt: patch.completedAt,
            },
            lastUpdatedAt: lastUpdatedAt as any,
          })
          .pipe(Effect.ignoreCause({ log: true }));
        yield* publishPersistedSnapshot(run.runId).pipe(Effect.ignoreCause({ log: true }));
      });

    const persistInternalThread = (
      run: PlanRunState,
      stepKey: string,
      threadId: string,
      threadRole: PlanRunnerThreadRole,
    ) =>
      Effect.gen(function* () {
        yield* repo
          .registerInternalThread({
            runId: run.runId,
            stepKey: stepKey as any,
            threadId: ThreadId.makeUnsafe(threadId),
            threadRole,
            createdAt: now() as any,
          })
          .pipe(Effect.ignoreCause({ log: true }));
        yield* registerThreadForStep(run.runId, stepKey, threadId, threadRole);
        yield* publishPersistedSnapshot(run.runId).pipe(Effect.ignoreCause({ log: true }));
      });

    const persistRunSummary = (run: PlanRunState) =>
      Effect.gen(function* () {
        yield* repo
          .updateRunState({
            runId: run.runId,
            patch: {
              state: run.state,
              summary: run.summary,
              completedAt: run.completedAt,
              lastUpdatedAt: now() as any,
            },
          })
          .pipe(Effect.ignoreCause({ log: true }));
        yield* publishPersistedSnapshot(run.runId).pipe(Effect.ignoreCause({ log: true }));
      });

    // ── Feature scanner (shared between listFeatures and watcher) ────

    /**
     * Scan the `.plans/` directory for features and compute their metadata.
     * Pure filesystem read — no AI. Returns the same shape as `listFeatures`.
     *
     * Persisted summaries from the repository drive the run-state columns;
     * the in-memory cache is consulted only as a freshness boost while a
     * write is in flight.
     */
    const scanFeatures = (projectId: ProjectId, projectCwd: string) =>
      Effect.gen(function* () {
        const plansDir = pathService.join(projectCwd, ".plans");
        const dirEntries = yield* fs
          .readDirectory(plansDir)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])));
        if (dirEntries.length === 0) return [];

        const entries: string[] = [];
        for (const entry of dirEntries) {
          const entryPath = pathService.join(plansDir, entry);
          const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
          if (stat?.type === "Directory") {
            entries.push(entry);
          }
        }

        const persistedSummaries = yield* repo
          .listFeatureSummaries({ projectId })
          .pipe(Effect.catch(() => Effect.succeed([] as const)));
        const persistedByFeature = new Map<string, (typeof persistedSummaries)[number]>();
        for (const summary of persistedSummaries) {
          persistedByFeature.set(summary.featureName, summary);
        }

        const memoryRuns = yield* Ref.get(activeRuns);

        const features: Array<{
          featureName: string;
          planCount: number;
          hasActiveRun: boolean;
          activeRunId: PlanRunId | null;
          lastRunId: PlanRunId | null;
          lastRunState:
            | "analyzing"
            | "executing"
            | "integrating"
            | "completed"
            | "failed"
            | "recovering"
            | null;
          lastRunUpdatedAt: string | null;
        }> = [];

        for (const featureName of entries) {
          const featureDir = pathService.join(plansDir, featureName);
          const planCount = yield* fs.readDirectory(featureDir).pipe(
            Effect.map((files) => files.filter((f) => f.endsWith(".md")).length),
            Effect.catch(() => Effect.succeed(0)),
          );

          const persisted = persistedByFeature.get(featureName) ?? null;
          let hasActiveRun = persisted ? persisted.hasActiveRun : false;
          let activeRunId: PlanRunId | null = persisted ? persisted.activeRunId : null;
          let lastRunId: PlanRunId | null = persisted ? persisted.lastRunId : null;
          let lastRunState: (typeof features)[number]["lastRunState"] = persisted
            ? persisted.lastRunState
            : null;
          let lastRunUpdatedAt: string | null = persisted ? persisted.lastRunUpdatedAt : null;

          // Memory-cache may be fresher than persisted columns mid-write. If
          // it is, prefer it — the persistence write that the runtime
          // dispatches lags the in-memory mutation by at most one tick.
          for (const run of memoryRuns.values()) {
            if (run.projectId !== projectId || run.featureName !== featureName) continue;
            const runActive = !isTerminalFeatureState(run.state);
            if (runActive) {
              hasActiveRun = true;
              activeRunId = run.runId;
            }
            const candidateUpdatedAt = run.completedAt ?? run.startedAt;
            if (lastRunUpdatedAt === null || candidateUpdatedAt > lastRunUpdatedAt) {
              lastRunId = run.runId;
              lastRunState = run.state;
              lastRunUpdatedAt = candidateUpdatedAt;
            }
          }

          features.push({
            featureName,
            planCount,
            hasActiveRun,
            activeRunId,
            lastRunId,
            lastRunState,
            lastRunUpdatedAt,
          });
        }

        return features;
      });

    // ── File watcher for .plans/ directory ────────────────────────────

    /**
     * Start watching `.plans/` for a project. On any file change (add, remove,
     * modify), re-scan features and push a `planRunner.featuresChanged` event.
     * Also invalidates the featurePlansCache for affected features.
     * Idempotent — only one watcher per project.
     */
    const ensurePlansWatcher = (projectId: ProjectId, projectCwd: string) =>
      Effect.gen(function* () {
        const watched = yield* Ref.get(watchedProjects);
        if (watched.has(projectId)) return;
        yield* Ref.update(watchedProjects, (s) => new Set([...s, projectId]));

        const plansDir = pathService.join(projectCwd, ".plans");
        const plansDirExists = yield* fs.exists(plansDir);
        if (!plansDirExists) return;

        // Debounced watch on .plans/ — editors fire multiple events per save
        const debouncedEvents = fs.watch(plansDir).pipe(Stream.debounce(Duration.millis(200)));

        yield* Stream.runForEach(debouncedEvents, () =>
          Effect.gen(function* () {
            // Invalidate all feature plan caches for this project
            yield* Ref.update(featurePlansCache, (m) => {
              const next = new Map(m);
              for (const key of next.keys()) {
                if (key.startsWith(`${projectId}:`)) {
                  next.delete(key);
                }
              }
              return next;
            });

            // Re-scan and publish
            const features = yield* scanFeatures(projectId, projectCwd);
            yield* publishEvent({
              type: "planRunner.featuresChanged",
              projectId,
              features,
            });
          }).pipe(Effect.ignoreCause({ log: true })),
        ).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
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

        const messages = [...thread.messages].toReversed();
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
          const node = run.plans.get(id)!;
          yield* persistStepStateTransition(run, node);
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
        plan.startedAt = plan.startedAt ?? now();
        yield* persistStepStateTransition(run, plan);
        yield* publishPlanStateChanged(run, plan.planId);
        yield* emitSyntheticLogEntry(run, plan.stepKey, {
          kind: "runner.status",
          title: `Plan "${plan.planId}" started`,
          bodyMarkdown: `Executing plan **${plan.planId}** (\`${plan.filename}\`).`,
          bodyText: `Executing plan ${plan.planId} (${plan.filename}).`,
          copyText: `plan-runner: started ${plan.planId}`,
          payload: {
            phase: "step.started",
            planId: plan.planId,
            filename: plan.filename,
          },
          createdAt: now() as any,
        });

        // Bootstrap executor thread when missing. On recovery we may already
        // have a live executor thread persisted from before the crash; in
        // that case we resume polling instead of re-spawning.
        let executorThreadId = plan.executorThreadId;
        if (!executorThreadId) {
          const executorPrompt = `
You are implementing a plan as part of a larger feature. Implement completely. No TODOs. No placeholders.

# Plan: ${plan.planId}
# Feature: ${run.featureName}

${plan.content}`;
          const bootstrapped = yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Execute: ${plan.planId}`,
            prompt: executorPrompt,
            modelSelection: run.modelSelection,
            branch: run.branch,
            worktreePath: run.worktreePath,
          });
          executorThreadId = bootstrapped.threadId;
          plan.executorThreadId = executorThreadId;
          yield* persistInternalThread(run, plan.stepKey, executorThreadId, "executor");
        }

        // Wait for executor
        const execResult = yield* waitForThreadTurnComplete(executorThreadId, run);
        if (!execResult.ok) {
          // Executor done (failed). Archive — reviewer never spawned here.
          yield* finalizeThread(executorThreadId);
          plan.state = "failed";
          plan.error = execResult.error ?? "Executor thread failed";
          plan.completedAt = now();
          yield* persistStepStateTransition(run, plan);
          yield* publishPlanStateChanged(run, plan.planId);
          yield* emitSyntheticLogEntry(run, plan.stepKey, {
            kind: "runner.status",
            title: `Plan "${plan.planId}" failed in executor`,
            bodyMarkdown: `Executor thread for plan **${plan.planId}** failed.\n\n> ${plan.error}`,
            bodyText: `Executor failed: ${plan.error}`,
            copyText: `plan-runner: ${plan.planId} executor failed — ${plan.error}`,
            payload: {
              phase: "step.finished",
              outcome: "failed",
              planId: plan.planId,
              error: plan.error,
            },
            createdAt: now() as any,
          });
          yield* markDependentsSkippedAndPublish(run, plan.planId);
          return;
        }

        // Mark reviewing
        plan.state = "reviewing";
        yield* persistStepStateTransition(run, plan);
        yield* publishPlanStateChanged(run, plan.planId);
        yield* emitSyntheticLogEntry(run, plan.stepKey, {
          kind: "runner.status",
          title: `Plan "${plan.planId}" entered review`,
          bodyMarkdown: `Reviewer attached to verify plan **${plan.planId}**.`,
          bodyText: `Review phase started for ${plan.planId}.`,
          copyText: `plan-runner: ${plan.planId} entered review`,
          payload: {
            phase: "step.review",
            planId: plan.planId,
          },
          createdAt: now() as any,
        });

        // Bootstrap reviewer thread when missing. The reviewer plays a dual
        // role:
        //  1. Verify the executor's work and report findings.
        //  2. On REVIEW_FAIL, apply the fixes itself in follow-up turns
        //     (we no longer re-run the executor on failure).
        // The same thread persists across the fix-and-reverify loop so the
        // reviewer keeps its full context (prior findings, verifier output).
        let reviewerThreadId = plan.reviewerThreadId;
        if (!reviewerThreadId) {
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

          const bootstrapped = yield* bootstrapThreadWithPrompt({
            projectId: run.projectId,
            title: `[PlanRunner] Review: ${plan.planId}`,
            prompt: reviewerPrompt,
            modelSelection: run.modelSelection,
            branch: run.branch,
            worktreePath: run.worktreePath,
          });
          reviewerThreadId = bootstrapped.threadId;
          plan.reviewerThreadId = reviewerThreadId;
          yield* persistInternalThread(run, plan.stepKey, reviewerThreadId, "reviewer");
        }

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
          yield* persistStepStateTransition(run, plan);
          yield* publishPlanStateChanged(run, plan.planId);
          yield* emitSyntheticLogEntry(run, plan.stepKey, {
            kind: "runner.retry",
            title: `Plan "${plan.planId}" retry ${plan.retriesUsed}/${plan.maxRetries}`,
            bodyMarkdown: `Reviewer reported failures; starting fix attempt **${plan.retriesUsed} of ${plan.maxRetries}**.`,
            bodyText: `Retry ${plan.retriesUsed}/${plan.maxRetries} for ${plan.planId}.`,
            copyText: `plan-runner: ${plan.planId} retry ${plan.retriesUsed}/${plan.maxRetries}`,
            payload: {
              phase: "step.retry",
              planId: plan.planId,
              attempt: plan.retriesUsed,
              maxRetries: plan.maxRetries,
            },
            createdAt: now() as any,
          });

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
          yield* persistStepStateTransition(run, plan);
          yield* publishPlanStateChanged(run, plan.planId);
          yield* emitSyntheticLogEntry(run, plan.stepKey, {
            kind: "runner.status",
            title: `Plan "${plan.planId}" completed`,
            bodyMarkdown: `Reviewer signalled REVIEW_PASS after ${plan.retriesUsed} fix ${plan.retriesUsed === 1 ? "attempt" : "attempts"}.`,
            bodyText: `Plan ${plan.planId} done after ${plan.retriesUsed} retries.`,
            copyText: `plan-runner: ${plan.planId} done`,
            payload: {
              phase: "step.finished",
              outcome: "done",
              planId: plan.planId,
              retriesUsed: plan.retriesUsed,
            },
            createdAt: now() as any,
          });

          // Unblock dependents and notify UI
          for (const node of run.plans.values()) {
            if (node.state === "blocked" && node.dependsOn.includes(plan.planId)) {
              const allDepsResolved = node.dependsOn.every((dep) => {
                const depNode = run.plans.get(dep);
                return !depNode || depNode.state === "done";
              });
              if (allDepsResolved) {
                node.state = "ready";
                yield* persistStepStateTransition(run, node);
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
          yield* persistStepStateTransition(run, plan);
          yield* publishPlanStateChanged(run, plan.planId);
          yield* emitSyntheticLogEntry(run, plan.stepKey, {
            kind: "runner.status",
            title: `Plan "${plan.planId}" failed`,
            bodyMarkdown: `Plan **${plan.planId}** failed: ${plan.error}.`,
            bodyText: `Plan ${plan.planId} failed: ${plan.error}.`,
            copyText: `plan-runner: ${plan.planId} failed — ${plan.error}`,
            payload: {
              phase: "step.finished",
              outcome: "failed",
              planId: plan.planId,
              error: plan.error,
              retriesUsed: plan.retriesUsed,
            },
            createdAt: now() as any,
          });
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
            yield* persistStepStateTransition(run, plan);
            yield* publishPlanStateChanged(run, plan.planId);
            yield* emitSyntheticLogEntry(run, plan.stepKey, {
              kind: "runner.status",
              title: `Plan "${plan.planId}" errored`,
              bodyMarkdown: `Unexpected error driving plan **${plan.planId}**: ${plan.error}.`,
              bodyText: `Plan ${plan.planId} errored: ${plan.error}.`,
              copyText: `plan-runner: ${plan.planId} errored — ${plan.error}`,
              payload: {
                phase: "step.finished",
                outcome: "errored",
                planId: plan.planId,
                error: plan.error,
              },
              createdAt: now() as any,
            });
            yield* markDependentsSkippedAndPublish(run, plan.planId);
          }),
        ),
      );

    // ── Main orchestration flow ───────────────────────────────────────

    /**
     * Drive the executor loop from whatever state the run is currently in.
     * Used both for fresh starts (post-`replaceFeatureRun`) and for
     * recovered runs (post-`recoverRun`). Plans frozen at start time stay
     * frozen — `.plans/` edits during execution are intentionally ignored.
     */
    const driveExecution = (run: PlanRunState) =>
      Effect.gen(function* () {
        // Handle the analyzer phase only if we never finished it. On
        // recovery we may have already moved past analyzing, in which case
        // the snapshot already has plans + dependsOn validated, so we skip
        // straight to executing.
        if (run.state === "analyzing") {
          yield* persistSyntheticStepStateTransition(run, {
            stepKey: ANALYZER_STEP_KEY,
            state: "running",
            startedAt: now(),
            completedAt: null,
            error: null,
            failureSummary: null,
          });
          yield* emitSyntheticLogEntry(run, ANALYZER_STEP_KEY, {
            kind: "runner.status",
            title: `Analyzer started for "${run.featureName}"`,
            bodyMarkdown: `Validating frozen plan graph for **${run.featureName}** (${run.plans.size} plan${run.plans.size === 1 ? "" : "s"}).`,
            bodyText: `Analyzer started for ${run.featureName} (${run.plans.size} plans).`,
            copyText: `plan-runner: analyzer started ${run.featureName}`,
            payload: {
              phase: "step.started",
              stepKind: "analyzer",
              planCount: run.plans.size,
            },
            createdAt: now() as any,
          });
          // Plans were frozen at start; we already populated `run.plans` and
          // `run.planContent`. Validate depends_on, detect cycles, mark
          // root-ready plans, then transition to executing.
          for (const node of run.plans.values()) {
            node.dependsOn = node.dependsOn.filter(
              (dep) => run.plans.has(dep) && dep !== node.planId,
            );
          }

          if (run.plans.size === 0) {
            run.state = "failed";
            run.summary = "All plan files have empty content";
            run.completedAt = now();
            yield* persistSyntheticStepStateTransition(run, {
              stepKey: ANALYZER_STEP_KEY,
              state: "failed",
              completedAt: run.completedAt,
              error: run.summary,
              failureSummary: run.summary,
            });
            yield* persistRunSummary(run);
            yield* emitSyntheticLogEntry(run, ANALYZER_STEP_KEY, {
              kind: "runner.status",
              title: `Analyzer failed for "${run.featureName}"`,
              bodyMarkdown: run.summary,
              bodyText: run.summary,
              copyText: `plan-runner: analyzer failed ${run.featureName}`,
              payload: {
                phase: "step.finished",
                stepKind: "analyzer",
                outcome: "failed",
                reason: "empty-plans",
              },
              createdAt: now() as any,
            });
            yield* publishEvent({
              type: "planRunner.completed",
              runId: run.runId,
              state: run.state,
              summary: run.summary,
              completedAt: run.completedAt!,
            });
            return;
          }

          const depGraph = new Map<string, string[]>();
          for (const [id, node] of run.plans) {
            depGraph.set(id, node.dependsOn);
          }
          const cycleNodes = detectCycles(depGraph);
          if (cycleNodes) {
            run.state = "failed";
            run.summary = `Circular dependency detected among: ${cycleNodes.join(", ")}`;
            run.completedAt = now();
            yield* persistSyntheticStepStateTransition(run, {
              stepKey: ANALYZER_STEP_KEY,
              state: "failed",
              completedAt: run.completedAt,
              error: run.summary,
              failureSummary: run.summary,
            });
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
              yield* persistStepStateTransition(run, node);
              yield* publishPlanStateChanged(run, node.planId);
            }
            yield* persistRunSummary(run);
            yield* emitSyntheticLogEntry(run, ANALYZER_STEP_KEY, {
              kind: "runner.status",
              title: `Analyzer failed for "${run.featureName}"`,
              bodyMarkdown: run.summary,
              bodyText: run.summary,
              copyText: `plan-runner: analyzer failed ${run.featureName}`,
              payload: {
                phase: "step.finished",
                stepKind: "analyzer",
                outcome: "failed",
                reason: "cycle",
                cycleNodes,
              },
              createdAt: now() as any,
            });
            yield* publishEvent({
              type: "planRunner.completed",
              runId: run.runId,
              state: run.state,
              summary: run.summary,
              completedAt: run.completedAt!,
            });
            return;
          }

          for (const node of run.plans.values()) {
            const allDepsResolved = node.dependsOn.every((dep) => {
              const depNode = run.plans.get(dep);
              return !depNode || depNode.state === "done";
            });
            if (allDepsResolved && node.state === "blocked") {
              node.state = "ready";
              yield* persistStepStateTransition(run, node);
              yield* publishPlanStateChanged(run, node.planId);
            }
          }

          run.state = "executing";
          yield* persistRunStateTransition(run);
          yield* persistSyntheticStepStateTransition(run, {
            stepKey: ANALYZER_STEP_KEY,
            state: "done",
            completedAt: now(),
            error: null,
            failureSummary: null,
          });
          yield* emitSyntheticLogEntry(run, ANALYZER_STEP_KEY, {
            kind: "runner.status",
            title: `Analyzer finished for "${run.featureName}"`,
            bodyMarkdown: `Plan graph validated; transitioning to execution.`,
            bodyText: `Analyzer finished for ${run.featureName}.`,
            copyText: `plan-runner: analyzer finished ${run.featureName}`,
            payload: {
              phase: "step.finished",
              stepKind: "analyzer",
              outcome: "done",
            },
            createdAt: now() as any,
          });
        }

        if (run.state === "executing") {
          let continueLoop = true;
          while (continueLoop) {
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

            yield* Effect.forEach(readyPlans, (plan) => executePlan(run, plan), {
              concurrency: run.maxConcurrency,
            });
          }
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
          yield* persistSyntheticStepStateTransition(run, {
            stepKey: INTEGRATION_STEP_KEY,
            state: "skipped",
            startedAt: now(),
            completedAt: run.completedAt,
            error: run.summary,
            failureSummary: run.summary,
          });
          yield* persistRunSummary(run);
          yield* emitSyntheticLogEntry(run, INTEGRATION_STEP_KEY, {
            kind: "runner.status",
            title: `Integration skipped for "${run.featureName}"`,
            bodyMarkdown: run.summary,
            bodyText: run.summary,
            copyText: `plan-runner: integration skipped ${run.featureName}`,
            payload: {
              phase: "step.finished",
              stepKind: "integration",
              outcome: "skipped",
              reason: "no-done-plans",
            },
            createdAt: now() as any,
          });
          yield* publishEvent({
            type: "planRunner.completed",
            runId: run.runId,
            state: run.state,
            summary: run.summary,
            completedAt: run.completedAt!,
          });
          return;
        }

        if (run.state !== "integrating") {
          run.state = "integrating";
          yield* persistRunStateTransition(run);
          yield* persistSyntheticStepStateTransition(run, {
            stepKey: INTEGRATION_STEP_KEY,
            state: "running",
            startedAt: now(),
            completedAt: null,
            error: null,
            failureSummary: null,
          });
          yield* emitSyntheticLogEntry(run, INTEGRATION_STEP_KEY, {
            kind: "runner.status",
            title: `Integration started for "${run.featureName}"`,
            bodyMarkdown: `Reconciling parallel implementations across ${donePlans.length} completed plan${donePlans.length === 1 ? "" : "s"}.`,
            bodyText: `Integration started for ${run.featureName}.`,
            copyText: `plan-runner: integration started ${run.featureName}`,
            payload: {
              phase: "step.started",
              stepKind: "integration",
              donePlans: donePlans.map((p) => p.planId),
              failedPlans: failedPlans.map((p) => p.planId),
            },
            createdAt: now() as any,
          });
        }

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

        // Run integration — graceful degradation on failure. Reuse an
        // existing integration thread on recovery rather than spawn a
        // duplicate.
        const integrationResponse: string | null = yield* Effect.gen(function* () {
          let threadId = run.integrationThreadId;
          if (!threadId) {
            const bootstrapped = yield* bootstrapThreadWithPrompt({
              projectId: run.projectId,
              title: `[PlanRunner] Integration: ${run.featureName}`,
              prompt: integrationPrompt,
              modelSelection: run.modelSelection,
              branch: run.branch,
              worktreePath: run.worktreePath,
            });
            threadId = bootstrapped.threadId;
            run.integrationThreadId = threadId;
            yield* persistInternalThread(run, INTEGRATION_STEP_KEY, threadId, "integration");
          }
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
        yield* persistSyntheticStepStateTransition(run, {
          stepKey: INTEGRATION_STEP_KEY,
          state: run.state === "completed" ? "done" : "failed",
          completedAt: run.completedAt,
          error: run.state === "completed" ? null : run.summary,
          failureSummary: run.state === "completed" ? null : run.summary,
        });
        yield* persistRunSummary(run);
        yield* emitSyntheticLogEntry(run, INTEGRATION_STEP_KEY, {
          kind: "runner.status",
          title: `Integration ${run.state === "completed" ? "passed" : "failed"} for "${run.featureName}"`,
          bodyMarkdown: run.summary ?? null,
          bodyText: run.summary,
          copyText: `plan-runner: integration ${run.state === "completed" ? "passed" : "failed"} ${run.featureName}`,
          payload: {
            phase: "step.finished",
            stepKind: "integration",
            outcome: run.state === "completed" ? "done" : "failed",
          },
          createdAt: now() as any,
        });
        yield* publishEvent({
          type: "planRunner.completed",
          runId: run.runId,
          state: run.state,
          summary: run.summary,
          completedAt: run.completedAt!,
        });
      }).pipe(
        // Defect-only safety net: every fail-prone effect inside is already
        // ignored or wrapped — but a runtime defect (e.g. unexpected throw
        // in a sync helper) still needs to terminate the run cleanly so the
        // UI doesn't render stale blocked/ready/running states forever.
        Effect.catchDefect((defect: unknown) =>
          Effect.gen(function* () {
            run.state = "failed";
            run.summary =
              defect instanceof Error
                ? `Plan execution error: ${defect.message}`
                : "Unexpected error during plan execution";
            run.completedAt = now();
            for (const node of run.plans.values()) {
              if (node.state !== "done" && node.state !== "failed" && node.state !== "skipped") {
                node.state = "skipped";
                node.error = node.error ?? "Skipped: run failed";
                node.completedAt = now();
                yield* persistStepStateTransition(run, node);
                yield* publishPlanStateChanged(run, node.planId);
              }
            }
            yield* persistRunSummary(run);
            yield* emitSyntheticLogEntry(run, INTEGRATION_STEP_KEY, {
              kind: "runner.status",
              title: `Run errored for "${run.featureName}"`,
              bodyMarkdown: run.summary,
              bodyText: run.summary,
              copyText: `plan-runner: run errored ${run.runId}`,
              payload: {
                phase: "run.errored",
                runId: run.runId,
              },
              createdAt: now() as any,
            });
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

    // ── Plan freeze (read .plans/ once at start time) ─────────────────

    const freezePlans = (projectId: ProjectId, featureName: string, projectCwd: string) =>
      Effect.gen(function* () {
        const plansDir = pathService.join(projectCwd, ".plans", featureName);
        const entries = yield* fs.readDirectory(plansDir).pipe(
          Effect.mapError(
            () =>
              new PlanRunnerError({
                message: `Plan directory not found: .plans/${featureName}/` as any,
              }),
          ),
        );
        const mdFiles = entries.filter((f) => f.endsWith(".md")).toSorted();
        if (mdFiles.length === 0) {
          return yield* new PlanRunnerError({
            message: `No .md plan files found in .plans/${featureName}/` as any,
          });
        }

        const frozen: Array<{
          planId: string;
          filename: string;
          dependsOn: string[];
          maxRetries: number;
          content: string;
        }> = [];
        for (const file of mdFiles) {
          const filePath = pathService.join(plansDir, file);
          const rawContent = yield* fs.readFileString(filePath).pipe(
            Effect.mapError(
              () =>
                new PlanRunnerError({
                  message: `Failed to read plan file: ${file}` as any,
                }),
            ),
          );
          const fallbackId = file.replace(/\.md$/, "");
          const parsed = parseFrontmatter(rawContent, fallbackId);
          if (!parsed.body.trim()) continue;
          frozen.push({
            planId: parsed.id,
            filename: file,
            dependsOn: parsed.depends_on,
            maxRetries: parsed.max_retries,
            content: parsed.body,
          });
        }

        // Strip refs to non-existent plan IDs / self-deps now so the
        // persisted snapshot is the authoritative graph.
        const planIdSet = new Set(frozen.map((p) => p.planId));
        for (const plan of frozen) {
          plan.dependsOn = plan.dependsOn.filter(
            (dep) => planIdSet.has(dep) && dep !== plan.planId,
          );
        }

        if (frozen.length === 0) {
          return yield* new PlanRunnerError({
            message: `All plan files in .plans/${featureName}/ have empty content` as any,
          });
        }
        void projectId;
        return frozen;
      });

    // ── Build run + step rows for fresh start ────────────────────────
    // (Hoisted to module scope; see top-of-file definitions.)

    // ── Recovery ─────────────────────────────────────────────────────

    /**
     * Reconstruct the in-memory `PlanRunState` from a persisted snapshot.
     * The snapshot's `plans` covers the frozen graph; per-step thread refs
     * come from the persisted internal threads list.
     */
    const rehydrateRun = (snapshot: PlanRunSnapshot) =>
      Effect.gen(function* () {
        const threadRows = yield* repo
          .listInternalThreadRefs({ runId: snapshot.runId })
          .pipe(
            Effect.catch(() => Effect.succeed([] as ReadonlyArray<PlanRunnerInternalThreadRow>)),
          );

        const planContent = new Map<string, string>();
        const plans = new Map<string, MutablePlanNode>();

        // `PlanRunSnapshot.plans` does not carry `planMarkdown` (the
        // frozen body), so we fall back to re-reading `.plans/<feature>/`
        // from disk for any plan that still needs to run after recovery.
        // This is best-effort — the persisted `plan_markdown` row remains
        // the durable source of truth for monitoring views, but the prompt
        // body is regenerated from disk for the executor turn.
        const projectCwd = yield* resolveProjectCwd(snapshot.projectId).pipe(
          Effect.catch(() => Effect.succeed(null as string | null)),
        );

        for (const plan of snapshot.plans) {
          const stepKey = planStepKey(plan.planId);
          const threadsForStep = threadRows.filter((t) => t.stepKey === stepKey);
          const executor = threadsForStep.find((t) => t.threadRole === "executor");
          const reviewer = threadsForStep.find((t) => t.threadRole === "reviewer");

          // Best-effort markdown rehydrate from disk if the file still
          // matches the frozen filename. The persisted plan_markdown is the
          // ground truth — this fallback covers the period before a
          // dedicated repo read is added.
          let content = "";
          if (projectCwd) {
            const planPath = pathService.join(
              projectCwd,
              ".plans",
              snapshot.featureName,
              plan.filename,
            );
            content = yield* fs.readFileString(planPath).pipe(
              Effect.map((raw) => parseFrontmatter(raw, plan.planId).body),
              Effect.catch(() => Effect.succeed("")),
            );
          }

          planContent.set(plan.planId, content);

          plans.set(plan.planId, {
            planId: plan.planId,
            filename: plan.filename,
            stepKey,
            state: plan.state,
            dependsOn: [...plan.dependsOn],
            maxRetries: plan.maxRetries,
            retriesUsed: plan.retriesUsed,
            executorThreadId: executor?.threadId ?? plan.executorThreadId ?? null,
            reviewerThreadId: reviewer?.threadId ?? plan.reviewerThreadId ?? null,
            error: plan.error,
            startedAt: plan.startedAt,
            completedAt: plan.completedAt,
            content,
            reviewFeedback: [],
            executionOrderAssigned: plan.startedAt !== null,
          });
        }

        const analyzerThread = threadRows.find((t) => t.threadRole === "analyzer");
        const integrationThread = threadRows.find((t) => t.threadRole === "integration");

        const nextExecutionOrder = Math.max(
          0,
          ...snapshot.steps.map((s) => (s.executionOrder ?? 0) + 1),
          plans.size + 2,
        );

        const run: PlanRunState = {
          runId: snapshot.runId,
          featureName: snapshot.featureName,
          projectId: snapshot.projectId,
          branch: snapshot.branch,
          worktreePath: snapshot.worktreePath,
          ownsWorktree: false, // Conservative: don't remove a worktree we may not own.
          state: snapshot.state,
          plans,
          nextExecutionOrder,
          analyzerThreadId: analyzerThread?.threadId ?? snapshot.analyzerThreadId ?? null,
          integrationThreadId: integrationThread?.threadId ?? snapshot.integrationThreadId ?? null,
          startedAt: snapshot.startedAt,
          completedAt: snapshot.completedAt,
          summary: snapshot.summary,
          cancelled: false,
          modelSelection: { provider: "codex", model: "" } as ModelSelection,
          maxConcurrency: snapshot.maxConcurrency,
          planContent,
        };

        // `PlanRunSnapshot` does not surface `modelSelection`; fall back
        // to the project default when reconstructing the run state.
        // Functionally equivalent for resumption since recovered turns
        // re-attach to the existing thread, which already carries its
        // original model selection.
        const readModel = yield* orchestrationEngine.getReadModel();
        const project = readModel.projects.find((p) => p.id === snapshot.projectId);
        if (project?.defaultModelSelection) {
          run.modelSelection = project.defaultModelSelection;
        }

        // Repopulate the thread→step index from durable rows so live event
        // routing keeps working across server restarts.
        for (const row of threadRows) {
          yield* registerThreadForStep(
            run.runId,
            row.stepKey as string,
            row.threadId as string,
            row.threadRole,
          );
        }

        return run;
      });

    /**
     * Validate that every running/reviewing step has a live backing thread
     * + session in the orchestration read model. If any are missing the
     * run is unrecoverable: the runtime can't resume an execution whose
     * thread state was lost.
     *
     * Polls the read model with bounded retries so we don't race against
     * orchestration projection replay during server boot. The read model
     * is empty at first construction but populates once
     * `OrchestrationReactor.start()` finishes replaying persisted events.
     */
    const validateRecoverableThreads = (run: PlanRunState) =>
      Effect.gen(function* () {
        type Expected = {
          kind: "executor" | "reviewer" | "integration";
          planId: string | null;
          id: string;
        };
        const expectedThreadIds: Expected[] = [];
        for (const plan of run.plans.values()) {
          if (plan.state === "running" && plan.executorThreadId) {
            expectedThreadIds.push({
              kind: "executor",
              planId: plan.planId,
              id: plan.executorThreadId,
            });
          }
          if (plan.state === "reviewing" && plan.reviewerThreadId) {
            expectedThreadIds.push({
              kind: "reviewer",
              planId: plan.planId,
              id: plan.reviewerThreadId,
            });
          }
        }
        if (run.state === "integrating" && run.integrationThreadId) {
          expectedThreadIds.push({
            kind: "integration",
            planId: null,
            id: run.integrationThreadId,
          });
        }
        // Trivially ok when nothing is mid-flight (e.g. blocked-only runs).
        if (expectedThreadIds.length === 0) {
          return { ok: true } as const;
        }

        const POLL_MS = 500;
        const MAX_POLL_MS = 30_000;
        const startedAtMs = Date.now();
        let lastDetail = "";

        while (true) {
          const readModel = yield* orchestrationEngine.getReadModel();
          const liveThreadIds = new Set(
            readModel.threads.filter((t) => t.deletedAt === null).map((t) => t.id),
          );

          let missing: Expected | null = null;
          for (const expected of expectedThreadIds) {
            if (!liveThreadIds.has(expected.id as any)) {
              missing = expected;
              break;
            }
          }

          if (!missing) return { ok: true } as const;

          lastDetail =
            missing.kind === "integration"
              ? `Integration thread for run "${run.runId}" was lost.`
              : `${missing.kind === "executor" ? "Executor" : "Reviewer"} thread for plan "${missing.planId}" was lost.`;

          if (Date.now() - startedAtMs > MAX_POLL_MS) {
            return { ok: false, detail: lastDetail } as const;
          }
          yield* Effect.sleep(`${POLL_MS} millis`);
        }
      });

    /**
     * Reconcile a single recovered run. Orders:
     *  1. Mark feature state = "recovering" + publish synthetic recovery log.
     *  2. Validate live threads. If any are missing → fail run + publish.
     *  3. Otherwise, restore the prior feature state (executing/integrating)
     *     and resume `driveExecution` from the last durable point.
     */
    const recoverRun = (snapshot: PlanRunSnapshot) =>
      Effect.gen(function* () {
        const fkey = featureKey(snapshot.projectId, snapshot.featureName);
        // Persist the recovering transition first so the read APIs reflect
        // the in-flight reconcile to UI subscribers immediately.
        const previousState = snapshot.state;
        const recoveringRun = yield* rehydrateRun(snapshot);
        recoveringRun.state = "recovering";

        yield* repo
          .updateRunState({
            runId: recoveringRun.runId,
            patch: {
              state: "recovering",
              lastUpdatedAt: now() as any,
            },
          })
          .pipe(Effect.ignoreCause({ log: true }));

        yield* publishPersistedSnapshot(recoveringRun.runId);

        // Cache the run in memory BEFORE emitting the recovery synthetic
        // log entry so the live publish path is gated by an active-run
        // check that finds it. (Cache add also happens below; doing it here
        // does not affect `validateRecoverableThreads` which only reads the
        // orchestration read model.)
        yield* Ref.update(activeRuns, (m) => {
          if (m.has(recoveringRun.runId)) return m;
          const next = new Map(m);
          next.set(recoveringRun.runId, recoveringRun);
          return next;
        });

        yield* emitSyntheticLogEntry(recoveringRun, ANALYZER_STEP_KEY, {
          kind: "runner.recovery",
          title: `Recovering run for "${recoveringRun.featureName}"`,
          bodyMarkdown: `Server boot detected an in-progress run (\`state=${previousState}\`). Reconciling thread state before resuming execution.`,
          bodyText: `Recovering run for "${recoveringRun.featureName}" (previous state: ${previousState}).`,
          copyText: `plan-runner: recovering run ${recoveringRun.runId} for ${recoveringRun.featureName}`,
          payload: { phase: "run.recovery.started", previousState },
          createdAt: now() as any,
        });

        // Cache the run in memory so subsequent gating checks see it as
        // active. We do this BEFORE thread validation so concurrent reads
        // observe a consistent state.
        yield* Ref.update(activeRuns, (m) => {
          const next = new Map(m);
          next.set(recoveringRun.runId, recoveringRun);
          return next;
        });

        const validation = yield* validateRecoverableThreads(recoveringRun);
        if (!validation.ok) {
          recoveringRun.state = "failed";
          recoveringRun.summary = `Recovery failed: ${validation.detail}`;
          recoveringRun.completedAt = now();
          yield* persistRunSummary(recoveringRun);
          yield* emitSyntheticLogEntry(recoveringRun, ANALYZER_STEP_KEY, {
            kind: "runner.recovery",
            title: `Recovery failed for "${recoveringRun.featureName}"`,
            bodyMarkdown: recoveringRun.summary,
            bodyText: recoveringRun.summary,
            copyText: `plan-runner: recovery failed ${recoveringRun.runId}`,
            payload: {
              phase: "run.recovery.failed",
              previousState,
              detail: validation.detail,
            },
            createdAt: now() as any,
          });
          // Mark any non-terminal plan steps skipped so persistence
          // reflects a fully terminated graph.
          for (const node of recoveringRun.plans.values()) {
            if (node.state !== "done" && node.state !== "failed" && node.state !== "skipped") {
              node.state = "skipped";
              node.error = node.error ?? "Skipped: run unrecoverable";
              node.completedAt = now();
              yield* persistStepStateTransition(recoveringRun, node);
              yield* publishPlanStateChanged(recoveringRun, node.planId);
            }
          }
          yield* publishEvent({
            type: "planRunner.completed",
            runId: recoveringRun.runId,
            state: recoveringRun.state,
            summary: recoveringRun.summary,
            completedAt: recoveringRun.completedAt!,
          });
          // Drop the run from the hot cache; reads can fall through to
          // persistence for terminal data.
          yield* Ref.update(activeRuns, (m) => {
            const next = new Map(m);
            next.delete(recoveringRun.runId);
            return next;
          });
          yield* Ref.update(recoveringFeatures, (s) => {
            const next = new Set(s);
            next.delete(fkey);
            return next;
          });
          return;
        }

        // Restore the prior feature state and resume execution. The state
        // tracker the executor uses (`run.state`) decides the entry point —
        // analyzer phase is skipped because plans are already frozen +
        // validated in persistence.
        recoveringRun.state =
          previousState === "analyzing"
            ? "analyzing"
            : previousState === "executing"
              ? "executing"
              : previousState === "integrating"
                ? "integrating"
                : "executing";

        yield* persistRunStateTransition(recoveringRun);

        yield* emitSyntheticLogEntry(recoveringRun, ANALYZER_STEP_KEY, {
          kind: "runner.recovery",
          title: `Recovery resumed for "${recoveringRun.featureName}"`,
          bodyMarkdown: `Threads validated; resuming execution from \`${previousState}\`.`,
          bodyText: `Recovery resumed for "${recoveringRun.featureName}".`,
          copyText: `plan-runner: recovery resumed ${recoveringRun.runId}`,
          payload: {
            phase: "run.recovery.resumed",
            previousState,
            resumedAs: recoveringRun.state,
          },
          createdAt: now() as any,
        });

        // Drive execution. Once the run finishes (success or failure), drop
        // the recovering gate so new starts can proceed.
        yield* driveExecution(recoveringRun).pipe(
          Effect.ensuring(
            Ref.update(recoveringFeatures, (s) => {
              const next = new Set(s);
              next.delete(fkey);
              return next;
            }),
          ),
        );
      }).pipe(
        // Catch defects from the recovery flow (sync throws in helpers).
        // Every fail-prone effect inside `recoverRun` is already ignored,
        // so we only need a defect catcher to keep the gate consistent.
        Effect.catchDefect((defect: unknown) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("plan-runner recovery failed", {
              runId: snapshot.runId,
              cause: defect,
            });
            yield* Ref.update(recoveringFeatures, (s) => {
              const next = new Set(s);
              next.delete(featureKey(snapshot.projectId, snapshot.featureName));
              return next;
            });
          }),
        ),
      );

    // Boot recovery: list non-terminal runs and reconcile each. Populating
    // `recoveringFeatures` synchronously ensures `start()` rejects cleanly
    // for the same feature even before the recovery fiber executes.
    const recoverableRuns = yield* repo
      .listRecoverableRuns()
      .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<PlanRunSnapshot>)));

    for (const snapshot of recoverableRuns) {
      yield* Ref.update(recoveringFeatures, (s) => {
        const next = new Set(s);
        next.add(featureKey(snapshot.projectId, snapshot.featureName));
        return next;
      });
    }

    yield* Effect.forEach(
      recoverableRuns,
      (snapshot) => recoverRun(snapshot).pipe(Effect.forkIn(runtimeScope)),
      { discard: true },
    );

    // ── Orchestration domain-event → step-log bridge ─────────────────
    //
    // Translate `thread.message-sent` and `thread.activity-appended`
    // events that target an internal plan-runner thread into normalized
    // `planRunner.stepLogAppended` events on the live stream. Only fires
    // for active runs — terminal runs are reconstructed on demand by
    // `getStepLog`, which dedupes against any live appends a client may
    // have already received.
    yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
      Effect.gen(function* () {
        if (event.type !== "thread.message-sent" && event.type !== "thread.activity-appended") {
          return;
        }

        const threadId =
          event.type === "thread.message-sent"
            ? (event.payload.threadId as string)
            : (event.payload.threadId as string);

        const index = yield* Ref.get(threadStepIndex);
        const ref = index.get(threadId);
        if (!ref) return;

        const runs = yield* Ref.get(activeRuns);
        const run = runs.get(ref.runId);
        if (!run) return;
        if (isTerminalFeatureState(run.state)) return;

        if (event.type === "thread.message-sent") {
          const payload = event.payload;
          const sequence = yield* allocateLiveSequence(ref.runId, ref.stepKey);
          const entry = messageToLogEntry({
            runId: ref.runId,
            stepKey: ref.stepKey,
            threadId,
            threadRole: ref.threadRole,
            messageId: payload.messageId as string,
            role: payload.role,
            text: payload.text,
            streaming: payload.streaming,
            turnId: (payload.turnId as string | null) ?? null,
            createdAt: payload.createdAt,
            sequence,
          });
          if (!entry) return;
          yield* publishEvent({
            type: "planRunner.stepLogAppended",
            runId: ref.runId,
            stepKey: ref.stepKey as any,
            entry,
          });
          return;
        }

        // thread.activity-appended
        const activity = event.payload.activity;
        const sequence = yield* allocateLiveSequence(ref.runId, ref.stepKey);
        const entry = activityToLogEntry({
          runId: ref.runId,
          stepKey: ref.stepKey,
          threadId,
          threadRole: ref.threadRole,
          activityId: activity.id as string,
          kind: activity.kind as string,
          tone: activity.tone as string,
          summary: activity.summary as string,
          payload: activity.payload,
          turnId: (activity.turnId as string | null) ?? null,
          activitySequence: (activity.sequence ?? null) as number | null,
          createdAt: activity.createdAt,
          sequence,
        });
        if (!entry) return;
        yield* publishEvent({
          type: "planRunner.stepLogAppended",
          runId: ref.runId,
          stepKey: ref.stepKey as any,
          entry,
        });
      }).pipe(Effect.ignoreCause({ log: true })),
    ).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(runtimeScope), Effect.asVoid);

    // ── Service implementation ────────────────────────────────────────

    return {
      start: (input) =>
        Effect.gen(function* () {
          const branchName = `feature/${input.featureName}`;
          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const fkey = featureKey(input.projectId, input.featureName);

          // Gate: feature must not be in boot recovery for this feature.
          const recovering = yield* Ref.get(recoveringFeatures);
          if (recovering.has(fkey)) {
            return yield* new PlanRunnerError({
              message:
                `Run for feature "${input.featureName}" is being recovered after a server restart. Wait for recovery to finish before starting a new run.` as any,
            });
          }

          // Gate: no in-memory active run for this feature.
          const memoryRuns = yield* Ref.get(activeRuns);
          for (const existing of memoryRuns.values()) {
            if (
              existing.featureName === input.featureName &&
              existing.projectId === input.projectId &&
              !isTerminalFeatureState(existing.state)
            ) {
              return yield* new PlanRunnerError({
                message: `Run already active for feature "${input.featureName}"` as any,
              });
            }
          }

          // Gate: no persisted active run for this feature (defense in
          // depth — recovery should have caught this already).
          const persistedRun = yield* repo
            .getFeatureRun({
              projectId: input.projectId,
              featureName: input.featureName as any,
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new PlanRunnerError({
                    message:
                      `Failed to read persisted run for feature "${input.featureName}": ${(err as { message?: string }).message ?? "unknown"}` as any,
                    cause: err,
                  }),
              ),
            );
          if (Option.isSome(persistedRun) && !isTerminalFeatureState(persistedRun.value.state)) {
            return yield* new PlanRunnerError({
              message:
                `Persisted run for feature "${input.featureName}" is still ${persistedRun.value.state}; cannot start a new run.` as any,
            });
          }

          // Invalidate feature plans cache — disk content may have changed
          yield* Ref.update(featurePlansCache, (m) => {
            const next = new Map(m);
            next.delete(`${input.projectId}:${input.featureName}`);
            return next;
          });

          // Step 1: freeze plans from disk into persisted snapshot
          const frozenPlans = yield* freezePlans(input.projectId, input.featureName, projectCwd);

          // Get model selection — use provided or get from project default
          let modelSelection: ModelSelection | undefined = input.modelSelection;
          if (!modelSelection) {
            const readModel = yield* orchestrationEngine.getReadModel();
            const project = readModel.projects.find((p) => p.id === input.projectId);
            if (project?.defaultModelSelection) {
              modelSelection = project.defaultModelSelection;
            } else {
              return yield* new PlanRunnerError({
                message: "No model selection provided and no project default found" as any,
              });
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
                  Effect.mapError(
                    (err: any) =>
                      new PlanRunnerError({
                        message:
                          `Failed to create worktree for existing branch "${branchName}": ${err.message ?? err}` as any,
                        cause: err,
                      }),
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
                Effect.mapError(
                  (err: any) =>
                    new PlanRunnerError({
                      message:
                        `Failed to create worktree for "${branchName}": ${err.message ?? err}` as any,
                      cause: err,
                    }),
                ),
              );
            worktreePath = worktreeResult.worktree.path;
          }

          // Construct run state
          const runId = PlanRunIdSchema.makeUnsafe(makeId());
          const startedAt = now();
          const MAX_CONCURRENCY = 3;

          const planContentMap = new Map<string, string>();
          const plans = new Map<string, MutablePlanNode>();
          for (const fp of frozenPlans) {
            planContentMap.set(fp.planId, fp.content);
            plans.set(fp.planId, {
              planId: fp.planId,
              filename: fp.filename,
              stepKey: planStepKey(fp.planId),
              state: "blocked",
              dependsOn: fp.dependsOn,
              maxRetries: fp.maxRetries,
              retriesUsed: 0,
              executorThreadId: null,
              reviewerThreadId: null,
              error: null,
              startedAt: null,
              completedAt: null,
              content: fp.content,
              reviewFeedback: [],
              executionOrderAssigned: false,
            });
          }

          // Reserve the first execution_order slots for the bookkeeping
          // analyzer/integration steps so plan steps line up monotonically
          // after them.
          const analyzerOrder = 0;
          const integrationOrder = 1;
          const planBaseOrder = 2;

          const run: PlanRunState = {
            runId,
            featureName: input.featureName,
            projectId: input.projectId,
            branch: branchName,
            worktreePath,
            ownsWorktree,
            state: "analyzing",
            plans,
            nextExecutionOrder: planBaseOrder + plans.size,
            analyzerThreadId: null,
            integrationThreadId: null,
            startedAt,
            completedAt: null,
            summary: null,
            cancelled: false,
            modelSelection,
            maxConcurrency: MAX_CONCURRENCY,
            planContent: planContentMap,
          };

          // Build snapshot rows and call replaceFeatureRun. Capture the
          // OLD run's internal threads BEFORE the transaction so we can
          // dispatch thread.delete after the row has been replaced.
          const oldThreadRefs = yield* Effect.gen(function* () {
            if (Option.isNone(persistedRun)) return [] as ReadonlyArray<string>;
            const refs = yield* repo
              .listInternalThreadRefs({ runId: persistedRun.value.runId })
              .pipe(
                Effect.catch(() =>
                  Effect.succeed([] as ReadonlyArray<PlanRunnerInternalThreadRow>),
                ),
              );
            return refs.map((r) => r.threadId as string);
          });

          const stepRows: PlanRunnerStepRow[] = [
            buildSyntheticStepRow(run, ANALYZER_STEP_KEY, "analyzer", analyzerOrder),
            buildSyntheticStepRow(run, INTEGRATION_STEP_KEY, "integration", integrationOrder),
          ];
          let nextOrder = planBaseOrder;
          for (const plan of run.plans.values()) {
            stepRows.push(buildPlanStepRow(run, plan, nextOrder));
            nextOrder += 1;
          }

          const runRow = buildRunRow(run);

          yield* repo
            .replaceFeatureRun({
              projectId: run.projectId,
              featureName: run.featureName as any,
              run: runRow,
              steps: stepRows,
              internalThreads: [],
              ...(Option.isSome(persistedRun) ? { oldRunId: persistedRun.value.runId } : {}),
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new PlanRunnerError({
                    message:
                      `Failed to persist new run for feature "${run.featureName}": ${(err as { message?: string }).message ?? "unknown"}` as any,
                    cause: err,
                  }),
              ),
            );

          // Step 2: dispatch thread.delete for old internal threads. If any
          // dispatch fails, abort: roll back the new run so persistence is
          // not left holding a half-started replacement.
          for (const oldThreadId of oldThreadRefs) {
            const dispatchResult = yield* orchestrationEngine
              .dispatch({
                type: "thread.delete",
                commandId: CommandId.makeUnsafe(`plan-runner:replace-delete:${makeId()}`),
                threadId: ThreadId.makeUnsafe(oldThreadId),
              })
              .pipe(Effect.exit);
            if (dispatchResult._tag === "Failure") {
              yield* repo.deleteRun({ runId: run.runId }).pipe(Effect.ignoreCause({ log: true }));
              return yield* new PlanRunnerError({
                message:
                  `Failed to delete prior run threads when replacing feature "${run.featureName}". New run aborted.` as any,
                cause: dispatchResult.cause,
              });
            }
          }

          // Cache the new run in memory.
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
          yield* publishPersistedSnapshot(run.runId);

          // Fork execution into detached background fiber bound to the
          // runtime scope so the layer scope tears it down on shutdown.
          yield* driveExecution(run).pipe(
            Effect.ignoreCause({ log: true }),
            Effect.forkIn(runtimeScope),
            Effect.asVoid,
          );

          return { runId, branch: branchName };
        }),

      getStatus: (runId) =>
        Effect.gen(function* () {
          const persisted = yield* repo.getRunById({ runId }).pipe(
            Effect.mapError(
              (err) =>
                new PlanRunnerNotFoundError({
                  runId,
                  message:
                    `Failed to read persisted run "${runId}": ${(err as { message?: string }).message ?? "unknown"}` as any,
                }),
            ),
          );
          if (Option.isNone(persisted)) {
            return yield* new PlanRunnerNotFoundError({
              runId,
              message: `Plan run "${runId}" not found` as any,
            });
          }
          return persisted.value;
        }),

      cancel: (runId) =>
        Effect.gen(function* () {
          const runs = yield* Ref.get(activeRuns);
          const run = runs.get(runId);
          if (!run) {
            return yield* new PlanRunnerNotFoundError({
              runId,
              message: `Plan run "${runId}" not found` as any,
            });
          }

          // Signal cancellation
          run.cancelled = true;

          // Stop all active thread sessions and mark non-terminal plans
          // skipped. Persist + publish each transition so the UI doesn't
          // render stale running/reviewing states after termination.
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
              yield* persistStepStateTransition(run, node);
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
          yield* persistRunSummary(run);

          // Run-level cancellation summary lands on whichever step is
          // currently "in front" so the user sees it at the top of the
          // active log view. Integration during integrate phase, analyzer
          // otherwise.
          const cancelStepKey =
            run.integrationThreadId !== null ? INTEGRATION_STEP_KEY : ANALYZER_STEP_KEY;
          yield* emitSyntheticLogEntry(run, cancelStepKey, {
            kind: "runner.status",
            title: `Run cancelled for "${run.featureName}"`,
            bodyMarkdown: `User cancelled run \`${run.runId}\` for **${run.featureName}**.`,
            bodyText: `Run cancelled for ${run.featureName}.`,
            copyText: `plan-runner: cancelled ${run.runId}`,
            payload: {
              phase: "run.cancelled",
              runId: run.runId,
            },
            createdAt: now() as any,
          });

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
          const features = yield* scanFeatures(input.projectId, projectCwd);

          // Start file watcher for this project (idempotent)
          yield* ensurePlansWatcher(input.projectId, projectCwd).pipe(
            Effect.ignoreCause({ log: true }),
          );

          return { features };
        }).pipe(
          Effect.catch((err) => {
            if (Schema.is(PlanRunnerError)(err)) return Effect.fail(err);
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
          const cacheKey = `${input.projectId}:${input.featureName}`;

          // Return cached result if available (5 min TTL)
          const cache = yield* Ref.get(featurePlansCache);
          const cached = cache.get(cacheKey);
          if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
            return { featureName: input.featureName, plans: cached.plans };
          }

          const projectCwd = yield* resolveProjectCwd(input.projectId);
          const featureDir = pathService.join(projectCwd, ".plans", input.featureName);

          const dirEntries = yield* fs.readDirectory(featureDir).pipe(
            Effect.mapError(
              () =>
                new PlanRunnerError({
                  message: `Feature directory not found: .plans/${input.featureName}` as any,
                }),
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
              Effect.mapError(
                () =>
                  new PlanRunnerError({
                    message: `Failed to read plan file: ${filename}` as any,
                  }),
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

          // Validate depends_on: strip refs to non-existent plan IDs
          const planIdSet = new Set(plans.map((p) => p.planId));
          for (const plan of plans) {
            plan.dependsOn = plan.dependsOn.filter(
              (dep) => planIdSet.has(dep) && dep !== plan.planId,
            );
          }

          // Cache result
          yield* Ref.update(featurePlansCache, (m) => {
            const next = new Map(m);
            next.set(cacheKey, { plans, cachedAt: Date.now() });
            return next;
          });

          return { featureName: input.featureName, plans };
        }).pipe(
          Effect.catch((err) => {
            if (Schema.is(PlanRunnerError)(err)) return Effect.fail(err);
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
          const runs = yield* repo
            .listRuns(input.projectId ? { projectId: input.projectId } : {})
            .pipe(
              Effect.mapError(
                (err) =>
                  new PlanRunnerError({
                    message:
                      `Failed to list persisted runs: ${(err as { message?: string }).message ?? "unknown"}` as any,
                    cause: err,
                  }),
              ),
            );
          return { runs: [...runs] };
        }),

      getFeatureRun: (input) =>
        Effect.gen(function* () {
          const persisted = yield* repo
            .getFeatureRun({
              projectId: input.projectId,
              featureName: input.featureName as any,
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new PlanRunnerError({
                    message:
                      `Failed to read feature run "${input.featureName}": ${(err as { message?: string }).message ?? "unknown"}` as any,
                    cause: err,
                  }),
              ),
            );
          return { run: Option.isSome(persisted) ? persisted.value : null };
        }),

      getStepLog: (input) =>
        Effect.gen(function* () {
          const runs = yield* Ref.get(activeRuns);
          const memoryRun = runs.get(input.runId);
          if (!memoryRun) {
            // Confirm the run exists in persistence before claiming "not
            // found" so callers reading historical runs get terminal data.
            const persisted = yield* repo.getRunById({ runId: input.runId }).pipe(
              Effect.mapError(
                (err) =>
                  new PlanRunnerNotFoundError({
                    runId: input.runId,
                    message:
                      `Failed to read persisted run "${input.runId}": ${(err as { message?: string }).message ?? "unknown"}` as any,
                  }),
              ),
            );
            if (Option.isNone(persisted)) {
              return yield* new PlanRunnerNotFoundError({
                runId: input.runId,
                message: `Run not found: ${input.runId}` as any,
              });
            }
          }

          // ── 1. Synthetic entries (durable runner-native log rows). ──
          const syntheticRows = yield* repo
            .listSyntheticLogEntries({ runId: input.runId, stepKey: input.stepKey as any })
            .pipe(
              Effect.catch(() =>
                Effect.succeed([] as ReadonlyArray<PlanRunnerSyntheticLogEntryRow>),
              ),
            );

          // ── 2. Thread-derived entries (messages + activities for any
          //      internal thread bound to this step). ──
          const threadRows = yield* repo
            .listInternalThreadRefs({ runId: input.runId })
            .pipe(
              Effect.catch(() => Effect.succeed([] as ReadonlyArray<PlanRunnerInternalThreadRow>)),
            );
          const stepThreads = threadRows.filter((row) => row.stepKey === input.stepKey);
          const readModel = yield* orchestrationEngine.getReadModel();

          /**
           * Intermediate shape carries enough context for a deterministic
           * merge before sequence numbers are assigned. Tie-breaking is:
           *   1. createdAt (ISO 8601 strings sort lexicographically)
           *   2. tieRank (synthetic < message < activity)
           *   3. tieKey (durable identifier per kind)
           */
          type Combined = {
            createdAt: string;
            kind: PlanRunnerLogEntryKind;
            threadId: string | null;
            threadRole: PlanRunnerThreadRole | null;
            entryId: string;
            title: string;
            bodyMarkdown: string | null;
            bodyText: string | null;
            copyText: string;
            payload: unknown;
            tieRank: number;
            tieKey: string;
          };
          const combined: Combined[] = [];

          for (const row of syntheticRows) {
            const fallbackTitle = "Plan runner event";
            const title = (row.title ?? fallbackTitle).trim() || fallbackTitle;
            const copy =
              ((row.copyText ?? row.title ?? row.bodyText ?? title) as string).trim() || title;
            combined.push({
              createdAt: row.createdAt,
              kind: row.kind,
              threadId: null,
              threadRole: null,
              entryId: `${row.runId}:${row.stepKey}:syn:${row.sequence}`,
              title,
              bodyMarkdown: row.bodyMarkdown,
              bodyText: row.bodyText,
              copyText: copy,
              payload: row.payload,
              tieRank: 0,
              tieKey: String(row.sequence),
            });
          }

          for (const ref of stepThreads) {
            const thread = readModel.threads.find((t) => t.id === (ref.threadId as string));
            if (!thread) continue;

            for (const msg of thread.messages) {
              if (msg.role === "system") continue;
              if (msg.streaming) continue;
              const text = (msg.text ?? "").trim();
              if (text.length === 0) continue;
              const kind: PlanRunnerLogEntryKind = msg.role === "user" ? "prompt" : "assistant";
              const title = kind === "prompt" ? "User prompt" : "Assistant message";
              combined.push({
                createdAt: msg.createdAt,
                kind,
                threadId: ref.threadId as string,
                threadRole: ref.threadRole,
                entryId: `${input.runId}:${input.stepKey}:msg:${msg.id}`,
                title,
                bodyMarkdown: msg.text,
                bodyText: msg.text,
                copyText: msg.text,
                payload: {
                  messageId: msg.id,
                  role: msg.role,
                  turnId: msg.turnId,
                },
                tieRank: 1,
                tieKey: msg.id as string,
              });
            }

            for (const activity of thread.activities) {
              const summary = (activity.summary ?? "").trim();
              if (summary.length === 0) continue;
              combined.push({
                createdAt: activity.createdAt,
                kind: "activity",
                threadId: ref.threadId as string,
                threadRole: ref.threadRole,
                entryId: `${input.runId}:${input.stepKey}:act:${activity.id}`,
                title: summary,
                bodyMarkdown: null,
                bodyText: activity.summary,
                copyText: activity.summary,
                payload: {
                  kind: activity.kind,
                  tone: activity.tone,
                  payload: activity.payload,
                  turnId: activity.turnId,
                  sequence: activity.sequence ?? null,
                },
                tieRank: 2,
                tieKey: String(activity.sequence ?? activity.id),
              });
            }
          }

          combined.sort((a, b) => {
            if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
            if (a.tieRank !== b.tieRank) return a.tieRank - b.tieRank;
            return a.tieKey < b.tieKey ? -1 : a.tieKey > b.tieKey ? 1 : 0;
          });

          const entries: PlanRunnerLogEntry[] = combined.map((c, i) => ({
            entryId: PlanRunnerLogEntryId.makeUnsafe(c.entryId),
            runId: input.runId,
            stepKey: input.stepKey,
            kind: c.kind,
            sequence: NonNegativeInt.makeUnsafe(i),
            createdAt: c.createdAt,
            threadId: c.threadId === null ? null : ThreadId.makeUnsafe(c.threadId),
            threadRole: c.threadRole,
            title: c.title as PlanRunnerLogEntry["title"],
            bodyMarkdown: c.bodyMarkdown,
            bodyText: c.bodyText,
            copyText: c.copyText,
            payload: c.payload,
          }));

          // Bump the live counter so any subsequent live append is emitted
          // with a sequence greater than every entry we just returned.
          // Keeps the client's append-by-sequence ordering monotonic across
          // load + live append boundaries.
          yield* ensureSequenceAtLeast(input.runId, input.stepKey, entries.length);

          return {
            runId: input.runId,
            stepKey: input.stepKey,
            entries,
          };
        }),

      get streamEvents() {
        return Stream.fromPubSub(eventPubSub);
      },
    } satisfies PlanRunnerServiceShape;
  }),
);
