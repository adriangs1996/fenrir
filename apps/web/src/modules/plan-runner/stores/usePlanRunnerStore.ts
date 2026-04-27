import { create } from "zustand";
import {
  type PlanRunSnapshot,
  type PlanRunnerEvent,
  FeatureSummary as FeatureSummarySchema,
  PlanFileSummary as PlanFileSummarySchema,
} from "@fenrir/contracts";

type FeatureSummary = typeof FeatureSummarySchema.Type;
type PlanFileSummary = typeof PlanFileSummarySchema.Type;

interface PlanRunnerState {
  // Feature discovery (keyed by projectId)
  featuresByProjectId: Record<string, readonly FeatureSummary[]>;
  // Active/recent runs (keyed by runId)
  runById: Record<string, PlanRunSnapshot>;
  // Plan content cache (keyed by "projectId:featureName")
  plansByFeatureKey: Record<string, readonly PlanFileSummary[]>;

  // Actions
  setFeatures: (projectId: string, features: readonly FeatureSummary[]) => void;
  upsertRun: (snapshot: PlanRunSnapshot) => void;
  removeRun: (runId: string) => void;
  setPlans: (key: string, plans: readonly PlanFileSummary[]) => void;
  applyEvent: (event: PlanRunnerEvent) => void;
}

export const usePlanRunnerStore = create<PlanRunnerState>((set) => ({
  featuresByProjectId: {},
  runById: {},
  plansByFeatureKey: {},

  setFeatures: (projectId, features) =>
    set((state) => ({
      featuresByProjectId: {
        ...state.featuresByProjectId,
        [projectId]: features,
      },
    })),

  upsertRun: (snapshot) =>
    set((state) => ({
      runById: { ...state.runById, [snapshot.runId]: snapshot },
    })),

  removeRun: (runId) =>
    set((state) => {
      const { [runId]: _, ...rest } = state.runById;
      return { runById: rest };
    }),

  setPlans: (key, plans) =>
    set((state) => ({
      plansByFeatureKey: { ...state.plansByFeatureKey, [key]: plans },
    })),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "planRunner.stateChanged": {
          const nextRunById = {
            ...state.runById,
            [event.runId]: event.snapshot,
          };
          // Update feature active-run flags for affected project
          const projectId = event.snapshot.projectId;
          const features = state.featuresByProjectId[projectId];
          if (features) {
            const nextFeatures = features.map((f) => {
              if (f.featureName === event.snapshot.featureName) {
                const isActive =
                  event.snapshot.state !== "completed" &&
                  event.snapshot.state !== "failed";
                return {
                  ...f,
                  hasActiveRun: isActive,
                  activeRunId: isActive ? event.runId : null,
                };
              }
              return f;
            });
            return {
              runById: nextRunById,
              featuresByProjectId: {
                ...state.featuresByProjectId,
                [projectId]: nextFeatures,
              },
            };
          }
          return { runById: nextRunById };
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
            const nextFeatures = features.map((f) =>
              f.activeRunId === event.runId
                ? { ...f, hasActiveRun: false, activeRunId: null }
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

        default:
          return state;
      }
    }),
}));
