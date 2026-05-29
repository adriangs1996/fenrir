import { scopedThreadKey } from "@fenrir/client-runtime";
import {
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type TerminalEvent,
  type ThreadId,
} from "@fenrir/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

export type ActionRunStatus =
  | "needs-input"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ActionRunSource = "project" | "global";

export interface ActionRun {
  readonly id: string;
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | string;
  readonly source: ActionRunSource;
  readonly scriptId: string;
  readonly scriptName: string;
  readonly command: string;
  readonly cwd: string;
  readonly tmuxProjectId: string;
  readonly status: ActionRunStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly exitCode: number | null;
  readonly outputTail: string;
  readonly errorMessage: string | null;
  readonly placeholderNames: readonly string[];
  readonly cancelRequested: boolean;
  readonly receiptDismissed: boolean;
  readonly updatedAt: string;
}

interface CreateActionRunInput {
  readonly id: string;
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | string;
  readonly source: ActionRunSource;
  readonly scriptId: string;
  readonly scriptName: string;
  readonly command: string;
  readonly cwd: string;
  readonly status?: ActionRunStatus;
  readonly placeholderNames?: readonly string[];
}

interface PersistedActionRunState {
  readonly runsById: Record<string, ActionRun>;
}

interface ActionRunStoreState extends PersistedActionRunState {
  readonly createActionRun: (input: CreateActionRunInput) => ActionRun;
  readonly markRunning: (runId: string) => void;
  readonly markNeedsInput: (runId: string, placeholderNames: readonly string[]) => void;
  readonly failActionRun: (runId: string, message: string) => void;
  readonly requestCancel: (runId: string) => void;
  readonly dismissReceipt: (runId: string) => void;
  readonly removeActionRun: (runId: string) => void;
  readonly clearCompletedForThread: (threadRef: ScopedThreadRef) => void;
  readonly applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => void;
}

const ACTION_RUN_STORAGE_KEY = "fenrir:action-runs:v1";
const ACTION_RUN_TMUX_PROJECT_PREFIX = "action-run-";
const ACTION_RUN_DONE_MARKER_PREFIX = "__FENRIR_ACTION_DONE__";
const MAX_OUTPUT_TAIL_LENGTH = 12_000;
const ESCAPE = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const BELL = String.fromCharCode(0x07);
const ANSI_CONTROL_SEQUENCE_RE = new RegExp(
  `[${ESCAPE}${CSI}][[\\]()#;?]*(?:(?:(?:[A-Za-z0-9]*(?:;[A-Za-z0-9]*)*)?${BELL})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))`,
  "g",
);

function nowIso(): string {
  return new Date().toISOString();
}

function actionRunThreadKey(threadRef: ScopedThreadRef): string {
  return scopedThreadKey(threadRef);
}

export function actionRunTmuxProjectId(runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${ACTION_RUN_TMUX_PROJECT_PREFIX}${safeRunId}`;
}

export function actionRunDoneMarker(runId: string): string {
  return `${ACTION_RUN_DONE_MARKER_PREFIX}${runId}__`;
}

function appendOutputTail(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= MAX_OUTPUT_TAIL_LENGTH) return next;
  return next.slice(next.length - MAX_OUTPUT_TAIL_LENGTH);
}

export function stripActionRunControlSequences(output: string): string {
  return output.replace(ANSI_CONTROL_SEQUENCE_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseExitCodeFromOutput(runId: string, output: string): number | null {
  const marker = escapeRegExp(actionRunDoneMarker(runId));
  const match = new RegExp(`${marker}(-?\\d+)`).exec(output);
  if (!match?.[1]) return null;
  const exitCode = Number.parseInt(match[1], 10);
  return Number.isFinite(exitCode) ? exitCode : null;
}

function tmuxProjectIdFromTerminalEvent(event: TerminalEvent): string | null {
  if (!event.threadId.startsWith("tmux:")) return null;
  return event.threadId.slice("tmux:".length);
}

function shouldShowReceipt(run: ActionRun): boolean {
  return !run.receiptDismissed;
}

function isTerminalStatus(status: ActionRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function normalizePersistedState(persistedState: unknown): PersistedActionRunState {
  if (!persistedState || typeof persistedState !== "object") {
    return { runsById: {} };
  }
  const candidate = persistedState as Partial<PersistedActionRunState>;
  return { runsById: candidate.runsById ?? {} };
}

function createActionRunStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useActionRunStore = create<ActionRunStoreState>()(
  persist(
    (set) => ({
      runsById: {},

      createActionRun: (input) => {
        const timestamp = nowIso();
        const run: ActionRun = {
          id: input.id,
          threadKey: actionRunThreadKey(input.threadRef),
          environmentId: input.threadRef.environmentId,
          threadId: input.threadRef.threadId,
          projectId: input.projectId,
          source: input.source,
          scriptId: input.scriptId,
          scriptName: input.scriptName,
          command: input.command,
          cwd: input.cwd,
          tmuxProjectId: actionRunTmuxProjectId(input.id),
          status: input.status ?? "starting",
          createdAt: timestamp,
          startedAt: input.status === "needs-input" ? null : timestamp,
          completedAt: null,
          exitCode: null,
          outputTail: "",
          errorMessage: null,
          placeholderNames: input.placeholderNames ?? [],
          cancelRequested: false,
          receiptDismissed: false,
          updatedAt: timestamp,
        };
        set((state) => ({
          runsById: {
            ...state.runsById,
            [run.id]: run,
          },
        }));
        return run;
      },

      markRunning: (runId) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run || isTerminalStatus(run.status)) return state;
          const timestamp = nowIso();
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                status: "running",
                startedAt: run.startedAt ?? timestamp,
                updatedAt: timestamp,
              },
            },
          };
        }),

      markNeedsInput: (runId, placeholderNames) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run || isTerminalStatus(run.status)) return state;
          const timestamp = nowIso();
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                status: "needs-input",
                placeholderNames,
                startedAt: null,
                updatedAt: timestamp,
              },
            },
          };
        }),

      failActionRun: (runId, message) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run || run.status === "cancelled") return state;
          const timestamp = nowIso();
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                status: "failed",
                completedAt: run.completedAt ?? timestamp,
                errorMessage: message,
                updatedAt: timestamp,
              },
            },
          };
        }),

      requestCancel: (runId) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run || isTerminalStatus(run.status)) return state;
          const timestamp = nowIso();
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                status: "cancelled",
                cancelRequested: true,
                completedAt: timestamp,
                updatedAt: timestamp,
              },
            },
          };
        }),

      dismissReceipt: (runId) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run) return state;
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                receiptDismissed: true,
                updatedAt: nowIso(),
              },
            },
          };
        }),

      removeActionRun: (runId) =>
        set((state) => {
          if (!state.runsById[runId]) return state;
          const { [runId]: _removed, ...runsById } = state.runsById;
          return { runsById };
        }),

      clearCompletedForThread: (threadRef) =>
        set((state) => {
          const threadKey = actionRunThreadKey(threadRef);
          const runsById = Object.fromEntries(
            Object.entries(state.runsById).filter(
              ([, run]) => run.threadKey !== threadKey || !isTerminalStatus(run.status),
            ),
          );
          if (Object.keys(runsById).length === Object.keys(state.runsById).length) return state;
          return { runsById };
        }),

      applyTerminalEvent: (event, environmentId) =>
        set((state) => {
          const tmuxProjectId = tmuxProjectIdFromTerminalEvent(event);
          if (!tmuxProjectId) return state;
          const run = Object.values(state.runsById).find(
            (candidate) =>
              candidate.environmentId === environmentId &&
              candidate.tmuxProjectId === tmuxProjectId,
          );
          if (!run) return state;

          const timestamp = nowIso();
          if (event.type === "output") {
            const outputTail = appendOutputTail(run.outputTail, event.data);
            const exitCode = parseExitCodeFromOutput(run.id, outputTail);
            const nextRun: ActionRun =
              exitCode === null
                ? {
                    ...run,
                    status:
                      run.status === "starting" || run.status === "needs-input"
                        ? "running"
                        : run.status,
                    startedAt: run.startedAt ?? timestamp,
                    outputTail,
                    updatedAt: timestamp,
                  }
                : {
                    ...run,
                    status: run.cancelRequested
                      ? "cancelled"
                      : exitCode === 0
                        ? "succeeded"
                        : "failed",
                    startedAt: run.startedAt ?? timestamp,
                    completedAt: run.completedAt ?? timestamp,
                    exitCode,
                    outputTail,
                    updatedAt: timestamp,
                  };
            return {
              runsById: {
                ...state.runsById,
                [run.id]: nextRun,
              },
            };
          }

          if (event.type === "error") {
            return {
              runsById: {
                ...state.runsById,
                [run.id]: {
                  ...run,
                  status: run.cancelRequested ? "cancelled" : "failed",
                  completedAt: run.completedAt ?? timestamp,
                  errorMessage: event.message,
                  updatedAt: timestamp,
                },
              },
            };
          }

          return state;
        }),
    }),
    {
      name: ACTION_RUN_STORAGE_KEY,
      storage: createJSONStorage(createActionRunStorage),
      version: 1,
      migrate: (persistedState) => normalizePersistedState(persistedState),
      partialize: (state): PersistedActionRunState => ({ runsById: state.runsById }),
    },
  ),
);

export function selectActionRunsForThread(
  state: Pick<ActionRunStoreState, "runsById">,
  threadRef: ScopedThreadRef,
): ActionRun[] {
  const threadKey = actionRunThreadKey(threadRef);
  return Object.values(state.runsById)
    .filter((run) => run.threadKey === threadKey)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function selectActionRunReceiptsForThread(
  state: Pick<ActionRunStoreState, "runsById">,
  threadRef: ScopedThreadRef,
): ActionRun[] {
  return selectActionRunsForThread(state, threadRef)
    .filter(shouldShowReceipt)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function countActiveActionRuns(runs: ReadonlyArray<ActionRun>): number {
  return runs.filter(
    (run) => run.status === "starting" || run.status === "running" || run.status === "needs-input",
  ).length;
}

export function countFailedActionRuns(runs: ReadonlyArray<ActionRun>): number {
  return runs.filter((run) => run.status === "failed").length;
}

export function actionRunStatusLabel(status: ActionRunStatus): string {
  switch (status) {
    case "needs-input":
      return "Needs input";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "succeeded":
      return "Passed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function actionRunElapsedLabel(run: Pick<ActionRun, "startedAt" | "completedAt">): string {
  if (!run.startedAt) return "not started";
  const startedAt = Date.parse(run.startedAt);
  const endedAt = Date.parse(run.completedAt ?? new Date().toISOString());
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return "unknown";
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
