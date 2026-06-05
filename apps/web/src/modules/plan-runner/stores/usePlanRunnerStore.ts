import { useMemo } from "react";
import { create } from "zustand";
import {
  type PlanRunSnapshot,
  type PlanRunnerEvent,
  type PlanRunId,
  type ProjectId,
  type ThreadId,
  type PlanRunnerLogEntry,
  type PlanRunnerStepSnapshot,
  FeatureSummary as FeatureSummarySchema,
  PlanFileSummary as PlanFileSummarySchema,
  ArchivedFeatureSummary as ArchivedFeatureSummarySchema,
} from "@fenrir/contracts";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";

type FeatureSummary = typeof FeatureSummarySchema.Type;
type PlanFileSummary = typeof PlanFileSummarySchema.Type;
export type ArchivedFeatureSummary = typeof ArchivedFeatureSummarySchema.Type;
const EMPTY_FEATURE_PLANS: readonly PlanFileSummary[] = [];
const EMPTY_ARCHIVED: readonly ArchivedFeatureSummary[] = [];

/** Build the composite cache key for per-step log entries. */
export function stepLogCacheKey(runId: string, stepKey: string): string {
  return `${runId}::${stepKey}`;
}

/**
 * Step states considered "active" — i.e. the step is currently producing
 * output and should be surfaced as an active tab in run views.
 */
const ACTIVE_STEP_STATES = new Set(["ready", "running"]);

interface PlanRunnerState {
  // Feature discovery (keyed by projectId)
  featuresByProjectId: Record<string, readonly FeatureSummary[]>;
  // Active/recent runs (keyed by runId)
  runById: Record<string, PlanRunSnapshot>;
  // Plan content cache (keyed by "projectId:featureName")
  plansByFeatureKey: Record<string, readonly PlanFileSummary[]>;
  /**
   * Per-step log entry cache, keyed by `stepLogCacheKey(runId, stepKey)`.
   * Populated by `getStepLog` reads and `planRunner.stepLogAppended`
   * streaming events.
   */
  stepLogsByKey: Record<string, readonly PlanRunnerLogEntry[]>;
  // Archived features (keyed by projectId)
  archivedFeaturesByProjectId: Record<string, readonly ArchivedFeatureSummary[]>;

  // Actions
  setFeatures: (projectId: string, features: readonly FeatureSummary[]) => void;
  upsertRun: (snapshot: PlanRunSnapshot) => void;
  removeRun: (runId: string) => void;
  setPlans: (key: string, plans: readonly PlanFileSummary[]) => void;
  setStepLog: (runId: string, stepKey: string, entries: readonly PlanRunnerLogEntry[]) => void;
  applyEvent: (event: PlanRunnerEvent) => void;
  archiveFeature: (projectId: ProjectId, featureName: string) => Promise<void>;
  fetchArchivedFeatures: (projectId?: ProjectId) => Promise<void>;
  unarchiveFeature: (
    projectId: ProjectId,
    archivedDirName: string,
  ) => Promise<{ featureName: string }>;
  renameFeature: (
    projectId: ProjectId,
    featureName: string,
    newFeatureName: string,
  ) => Promise<{ featureName: string }>;
}

export function selectFeaturePlans(
  plansByFeatureKey: Record<string, readonly PlanFileSummary[]>,
  featureKey: string | null,
): readonly PlanFileSummary[] {
  if (!featureKey) {
    return EMPTY_FEATURE_PLANS;
  }
  return plansByFeatureKey[featureKey] ?? EMPTY_FEATURE_PLANS;
}

/**
 * Hidden-thread policy
 * --------------------
 * Plan-runner runs spawn executor threads as internal implementation details.
 * Legacy analyzer/integration thread refs may also exist in persisted runs.
 * Their snapshots are persisted in
 * orchestration so logs can be reconstructed, but they must NOT appear in
 * normal navigation surfaces (sidebar, archive panel, project counts/previews)
 * and direct route access must be blocked / redirected to the owning run.
 *
 * Hidden thread ids are derived data-driven from `runById` step snapshots —
 * never from title-based inference. When a run is deleted or replaced via
 * `removeRun` / `upsertRun`, the derived set updates automatically because the
 * selectors re-read from `runById`.
 */

/**
 * Drop every step-log cache entry that belongs to `runId`. Used when a run
 * is replaced for a feature so stale per-step caches don't bleed between
 * different run ids.
 */
function pruneStepLogsForRun(
  stepLogsByKey: Record<string, readonly PlanRunnerLogEntry[]>,
  runId: string,
): Record<string, readonly PlanRunnerLogEntry[]> {
  const prefix = `${runId}::`;
  let mutated = false;
  const next: Record<string, readonly PlanRunnerLogEntry[]> = {};
  for (const [key, entries] of Object.entries(stepLogsByKey)) {
    if (key.startsWith(prefix)) {
      mutated = true;
      continue;
    }
    next[key] = entries;
  }
  return mutated ? next : stepLogsByKey;
}

/**
 * Insert `entry` into `existing` keeping ordering by `sequence` ascending and
 * deduplicating on `entryId`. Live appends arrive in order in the common case
 * but may interleave with a backfill `getStepLog` read, so the merge handles
 * both shapes.
 */
function mergeStepLogEntry(
  existing: readonly PlanRunnerLogEntry[] | undefined,
  entry: PlanRunnerLogEntry,
): readonly PlanRunnerLogEntry[] {
  if (!existing || existing.length === 0) return [entry];
  for (const e of existing) {
    if (e.entryId === entry.entryId) {
      return existing;
    }
  }
  // Append fast-path when entry comes after the current tail.
  const tail = existing[existing.length - 1];
  if (tail && tail.sequence <= entry.sequence) {
    return [...existing, entry];
  }
  // Out-of-order insert: splice into sequence-sorted position.
  return [...existing, entry].toSorted((a, b) => a.sequence - b.sequence);
}

export const usePlanRunnerStore = create<PlanRunnerState>((set, get) => ({
  featuresByProjectId: {},
  runById: {},
  plansByFeatureKey: {},
  stepLogsByKey: {},
  archivedFeaturesByProjectId: {},

  setFeatures: (projectId, features) =>
    set((state) => ({
      featuresByProjectId: {
        ...state.featuresByProjectId,
        [projectId]: features,
      },
    })),

  upsertRun: (snapshot) =>
    set((state) => {
      // Find any prior run for the same (projectId, featureName) pair so we
      // can blow away its step-log cache when the feature has rolled over to
      // a new runId. This prevents stale logs from the previous run leaking
      // into views that key by runId+stepKey.
      let stepLogsByKey = state.stepLogsByKey;
      for (const prior of Object.values(state.runById)) {
        if (
          prior.projectId === snapshot.projectId &&
          prior.featureName === snapshot.featureName &&
          prior.runId !== snapshot.runId
        ) {
          stepLogsByKey = pruneStepLogsForRun(stepLogsByKey, prior.runId);
        }
      }
      return {
        runById: { ...state.runById, [snapshot.runId]: snapshot },
        stepLogsByKey,
      };
    }),

  removeRun: (runId) =>
    set((state) => {
      const { [runId]: _, ...rest } = state.runById;
      return {
        runById: rest,
        stepLogsByKey: pruneStepLogsForRun(state.stepLogsByKey, runId),
      };
    }),

  setPlans: (key, plans) =>
    set((state) => ({
      plansByFeatureKey: { ...state.plansByFeatureKey, [key]: plans },
    })),

  setStepLog: (runId, stepKey, entries) =>
    set((state) => ({
      stepLogsByKey: {
        ...state.stepLogsByKey,
        [stepLogCacheKey(runId, stepKey)]: entries,
      },
    })),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "planRunner.stateChanged": {
          // Step-log cache rollover: if the snapshot belongs to a new runId
          // for the same (project, feature), drop logs for the prior run.
          let stepLogsByKey = state.stepLogsByKey;
          for (const prior of Object.values(state.runById)) {
            if (
              prior.projectId === event.snapshot.projectId &&
              prior.featureName === event.snapshot.featureName &&
              prior.runId !== event.runId
            ) {
              stepLogsByKey = pruneStepLogsForRun(stepLogsByKey, prior.runId);
            }
          }
          const nextRunById = {
            ...state.runById,
            [event.runId]: event.snapshot,
          };
          // Update feature active-run flags for affected project
          const projectId = event.snapshot.projectId;
          const features = state.featuresByProjectId[projectId];
          if (features) {
            // oxlint-disable-next-line oxc/no-map-spread -- immutable Zustand state update requires copy-on-write
            const nextFeatures = features.map((f) => {
              if (f.featureName === event.snapshot.featureName) {
                const isActive =
                  event.snapshot.state !== "completed" && event.snapshot.state !== "failed";
                return {
                  ...f,
                  hasActiveRun: isActive,
                  activeRunId: isActive ? event.runId : null,
                  lastRunId: event.runId,
                  lastRunState: event.snapshot.state,
                  lastRunUpdatedAt: event.snapshot.lastUpdatedAt,
                };
              }
              return f;
            });
            return {
              runById: nextRunById,
              stepLogsByKey,
              featuresByProjectId: {
                ...state.featuresByProjectId,
                [projectId]: nextFeatures,
              },
            };
          }
          return { runById: nextRunById, stepLogsByKey };
        }

        case "planRunner.planStateChanged": {
          const run = state.runById[event.runId];
          if (!run) return state;
          const nextPlans = run.plans.map((p) =>
            p.planId === event.planId
              ? {
                  ...p,
                  state: event.state,
                  retriesUsed: event.retriesUsed,
                  error: event.error,
                }
              : p,
          );
          return {
            runById: {
              ...state.runById,
              [event.runId]: { ...run, plans: nextPlans },
            },
          };
        }

        case "planRunner.completed": {
          const run = state.runById[event.runId];
          if (!run) return state;
          const nextRun = {
            ...run,
            state: event.state,
            summary: event.summary,
            completedAt: event.completedAt,
          };
          // Clear active run from features
          const features = state.featuresByProjectId[run.projectId];
          if (features) {
            // oxlint-disable-next-line oxc/no-map-spread -- immutable Zustand state update requires copy-on-write
            const nextFeatures = features.map((f) =>
              f.activeRunId === event.runId
                ? {
                    ...f,
                    hasActiveRun: false,
                    activeRunId: null,
                    lastRunId: event.runId,
                    lastRunState: event.state,
                    lastRunUpdatedAt: event.completedAt,
                  }
                : f,
            );
            return {
              runById: { ...state.runById, [event.runId]: nextRun },
              featuresByProjectId: {
                ...state.featuresByProjectId,
                [run.projectId]: nextFeatures,
              },
            };
          }
          return {
            runById: { ...state.runById, [event.runId]: nextRun },
          };
        }

        case "planRunner.featuresChanged": {
          // Invalidate cached plans for features in this project
          const nextPlansByFeatureKey = { ...state.plansByFeatureKey };
          for (const key of Object.keys(nextPlansByFeatureKey)) {
            if (key.startsWith(`${event.projectId}:`)) {
              delete nextPlansByFeatureKey[key];
            }
          }
          return {
            featuresByProjectId: {
              ...state.featuresByProjectId,
              [event.projectId]: event.features,
            },
            plansByFeatureKey: nextPlansByFeatureKey,
          };
        }

        case "planRunner.stepLogAppended": {
          const key = stepLogCacheKey(event.runId, event.stepKey);
          const next = mergeStepLogEntry(state.stepLogsByKey[key], event.entry);
          if (next === state.stepLogsByKey[key]) {
            return state;
          }
          return {
            stepLogsByKey: {
              ...state.stepLogsByKey,
              [key]: next,
            },
          };
        }

        case "planRunner.archivedFeaturesChanged": {
          return {
            archivedFeaturesByProjectId: {
              ...state.archivedFeaturesByProjectId,
              [event.projectId]: event.features,
            },
          };
        }

        default:
          return state;
      }
    }),

  archiveFeature: async (projectId, featureName) => {
    // Optimistically remove feature from sidebar list
    const prev = get().featuresByProjectId[projectId] ?? [];
    set((state) => ({
      featuresByProjectId: {
        ...state.featuresByProjectId,
        [projectId]: (state.featuresByProjectId[projectId] ?? []).filter(
          (f) => f.featureName !== featureName,
        ),
      },
    }));

    try {
      const client = getPrimaryEnvironmentConnection().client;
      await client.planRunner.archiveFeature({ projectId, featureName });
    } catch (err) {
      // Roll back optimistic removal
      set((state) => ({
        featuresByProjectId: {
          ...state.featuresByProjectId,
          [projectId]: prev,
        },
      }));
      throw err;
    }
  },

  fetchArchivedFeatures: async (projectId) => {
    try {
      const client = getPrimaryEnvironmentConnection().client;
      const result = await client.planRunner.listArchivedFeatures(projectId ? { projectId } : {});
      // Group returned features by projectId
      const grouped: Record<string, ArchivedFeatureSummary[]> = {};
      for (const feature of result.features) {
        const list = grouped[feature.projectId] ?? [];
        list.push(feature);
        grouped[feature.projectId] = list;
      }
      set((state) => ({
        archivedFeaturesByProjectId: {
          ...state.archivedFeaturesByProjectId,
          ...grouped,
        },
      }));
    } catch (err) {
      console.error("planRunner.listArchivedFeatures failed:", err);
    }
  },

  unarchiveFeature: async (projectId, archivedDirName) => {
    const client = getPrimaryEnvironmentConnection().client;
    const result = await client.planRunner.unarchiveFeature({
      projectId,
      archivedDirName,
    });
    // Watcher events refresh both lists via archivedFeaturesChanged / featuresChanged.
    return { featureName: result.featureName };
  },

  renameFeature: async (projectId, featureName, newFeatureName) => {
    if (featureName === newFeatureName) {
      return { featureName: newFeatureName };
    }
    const oldKey = `${projectId}:${featureName}`;
    const newKey = `${projectId}:${newFeatureName}`;

    // Snapshot previous state for rollback.
    const prevFeatures = get().featuresByProjectId[projectId] ?? [];
    const prevPlansByFeatureKey = get().plansByFeatureKey;
    const prevRunById = get().runById;

    // Optimistic in-place rename: features list, plans cache, run snapshots.
    set((state) => {
      const features = state.featuresByProjectId[projectId];
      const nextFeaturesByProjectId = features
        ? {
            ...state.featuresByProjectId,
            // oxlint-disable-next-line oxc/no-map-spread -- immutable Zustand state update requires copy-on-write
            [projectId]: features.map((f) =>
              f.featureName === featureName
                ? { ...f, featureName: newFeatureName as FeatureSummary["featureName"] }
                : f,
            ),
          }
        : state.featuresByProjectId;

      let nextPlansByFeatureKey = state.plansByFeatureKey;
      if (oldKey in state.plansByFeatureKey) {
        const { [oldKey]: moved, ...rest } = state.plansByFeatureKey;
        nextPlansByFeatureKey = moved ? { ...rest, [newKey]: moved } : rest;
      }

      let nextRunById = state.runById;
      let runMutated = false;
      const draftRunById: Record<string, PlanRunSnapshot> = { ...state.runById };
      for (const [runId, run] of Object.entries(state.runById)) {
        if (run.projectId === projectId && run.featureName === featureName) {
          draftRunById[runId] = {
            ...run,
            featureName: newFeatureName as PlanRunSnapshot["featureName"],
          };
          runMutated = true;
        }
      }
      if (runMutated) nextRunById = draftRunById;

      return {
        featuresByProjectId: nextFeaturesByProjectId,
        plansByFeatureKey: nextPlansByFeatureKey,
        runById: nextRunById,
      };
    });

    try {
      const client = getPrimaryEnvironmentConnection().client;
      const result = await client.planRunner.renameFeature({
        projectId,
        featureName,
        newFeatureName,
      });
      return { featureName: result.featureName };
    } catch (err) {
      // Roll back optimistic mutation.
      set((state) => ({
        featuresByProjectId: {
          ...state.featuresByProjectId,
          [projectId]: prevFeatures,
        },
        plansByFeatureKey: prevPlansByFeatureKey,
        runById: prevRunById,
      }));
      throw err;
    }
  },
}));

/**
 * Build the set of internal plan-runner thread ids from the persisted
 * step `threadRefs` on every stored run snapshot. Returning a fresh `Set`
 * keeps the derivation explicit and data-driven; consumers should memoize
 * over `runById` reference equality.
 */
export function selectInternalThreadIds(runById: Record<string, PlanRunSnapshot>): Set<ThreadId> {
  const ids = new Set<ThreadId>();
  for (const run of Object.values(runById)) {
    for (const step of run.steps) {
      for (const ref of step.threadRefs) {
        ids.add(ref.threadId);
      }
    }
  }
  return ids;
}

/**
 * Build a `threadId → owning runId` lookup for all internal plan-runner
 * threads. Used to redirect direct thread-route access to the owning run
 * view. If the same thread id appears across multiple runs (which should
 * not happen but is handled defensively), the first encountered run wins.
 */
export function selectRunIdByInternalThreadId(
  runById: Record<string, PlanRunSnapshot>,
): Map<ThreadId, PlanRunId> {
  const map = new Map<ThreadId, PlanRunId>();
  for (const run of Object.values(runById)) {
    for (const step of run.steps) {
      for (const ref of step.threadRefs) {
        if (!map.has(ref.threadId)) {
          map.set(ref.threadId, run.runId);
        }
      }
    }
  }
  return map;
}

/**
 * React hook returning the memoized set of internal plan-runner thread ids.
 * Recomputes only when `runById` changes reference (i.e. when a run is added,
 * replaced, or removed by the reducer).
 */
export function useInternalPlanRunnerThreadIds(): ReadonlySet<ThreadId> {
  const runById = usePlanRunnerStore((s) => s.runById);
  return useMemo(() => selectInternalThreadIds(runById), [runById]);
}

/**
 * React hook returning the memoized `threadId → runId` lookup map for
 * internal plan-runner threads.
 */
export function useInternalPlanRunnerThreadOwners(): ReadonlyMap<ThreadId, PlanRunId> {
  const runById = usePlanRunnerStore((s) => s.runById);
  return useMemo(() => selectRunIdByInternalThreadId(runById), [runById]);
}

// ── Step / log selectors ──────────────────────────────────────────────────

/**
 * Steps a run has actually started, sorted by their persisted
 * `executionOrder`. Steps that have never started (e.g. blocked plans not yet
 * scheduled) are excluded; tied or null orders fall back to `startedAt`.
 */
export function selectStartedStepHistory(
  run: PlanRunSnapshot | undefined,
): readonly PlanRunnerStepSnapshot[] {
  if (!run) return [];
  const started = run.steps.filter((s) => s.startedAt !== null);
  return started.toSorted((a, b) => {
    const ao = a.executionOrder;
    const bo = b.executionOrder;
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    const at = a.startedAt ?? "";
    const bt = b.startedAt ?? "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

/**
 * Active-step tabs for a run: the subset of started steps whose state is
 * still in-flight (`ready`/`running`). Order matches
 * `selectStartedStepHistory`.
 */
export function selectActiveStepTabs(
  run: PlanRunSnapshot | undefined,
): readonly PlanRunnerStepSnapshot[] {
  return selectStartedStepHistory(run).filter((s) => ACTIVE_STEP_STATES.has(s.state));
}

/** Hook variant of `selectStartedStepHistory` for a given runId. */
export function useStartedStepHistory(runId: string): readonly PlanRunnerStepSnapshot[] {
  const run = usePlanRunnerStore((s) => s.runById[runId]);
  return useMemo(() => selectStartedStepHistory(run), [run]);
}

/** Hook variant of `selectActiveStepTabs` for a given runId. */
export function useActiveStepTabs(runId: string): readonly PlanRunnerStepSnapshot[] {
  const run = usePlanRunnerStore((s) => s.runById[runId]);
  return useMemo(() => selectActiveStepTabs(run), [run]);
}

/** Cached log entries for a single step, or an empty array if none cached. */
export function useStepLog(runId: string, stepKey: string): readonly PlanRunnerLogEntry[] {
  return usePlanRunnerStore((s) => s.stepLogsByKey[stepLogCacheKey(runId, stepKey)] ?? EMPTY_LOG);
}

const EMPTY_LOG: readonly PlanRunnerLogEntry[] = [];

/** Archived features for a single project, or empty if none cached. */
export function useArchivedFeatures(projectId: string): readonly ArchivedFeatureSummary[] {
  return usePlanRunnerStore((s) => s.archivedFeaturesByProjectId[projectId] ?? EMPTY_ARCHIVED);
}
