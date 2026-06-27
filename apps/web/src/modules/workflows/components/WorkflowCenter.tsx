import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectId,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowId,
  WorkflowRunSnapshot,
  WorkflowSchedule,
  WorkflowThreadSummary,
} from "@fenrir/contracts";
import {
  ArchiveIcon,
  CalendarClockIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import {
  canAttemptWorkflowRun,
  isRunnableWorkflow,
  selectProjectWorkflowRuns,
  selectProjectWorkflowSchedules,
  selectProjectWorkflowSummaries,
  selectWorkflowMemoryItems,
  useWorkflowStore,
} from "../stores/useWorkflowStore";

export interface WorkflowCenterProps {
  readonly projectId: ProjectId;
}

type BusyKey = string | null;

const EMPTY_EVENTS: readonly WorkflowEvent[] = [];

function isActiveRun(run: WorkflowRunSnapshot): boolean {
  return run.status === "queued" || run.status === "running" || run.status === "paused";
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function runBadgeVariant(status: WorkflowRunSnapshot["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "failed":
    case "interrupted":
      return "error" as const;
    case "paused":
      return "warning" as const;
    case "running":
    case "queued":
      return "info" as const;
    case "cancelled":
      return "outline" as const;
  }
}

function workflowBadge(workflow: WorkflowDraft) {
  if (workflow.validationStatus === "valid") return <Badge variant="success">Valid</Badge>;
  if (workflow.validationStatus === "invalid") return <Badge variant="error">Invalid</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

function nextOneShotDateTime(): string {
  const value = new Date(Date.now() + 5 * 60_000);
  value.setSeconds(0, 0);
  return value.toISOString().slice(0, 16);
}

function workflowCapabilities(workflow: WorkflowDraft): readonly string[] {
  return workflow.declaredCapabilities ?? [];
}

function WorkflowListRow({
  summary,
  selected,
  busyKey,
  onSelect,
  onRun,
  onOpen,
  onArchive,
}: {
  readonly summary: WorkflowThreadSummary;
  readonly selected: boolean;
  readonly busyKey: BusyKey;
  readonly onSelect: (workflowId: WorkflowId) => void;
  readonly onRun: (workflow: WorkflowDraft) => void;
  readonly onOpen: (workflow: WorkflowDraft) => void;
  readonly onArchive: (workflow: WorkflowDraft) => void;
}) {
  const workflow = summary.workflow;
  const active = Number(summary.activeRunCount) > 0;
  const canRun = canAttemptWorkflowRun(workflow);

  return (
    <div
      className={cn(
        "border-b border-border/60 px-3 py-3",
        selected ? "bg-accent/45" : "hover:bg-accent/25",
      )}
    >
      <button
        type="button"
        className="block w-full min-w-0 text-left"
        onClick={() => onSelect(workflow.workflowId)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{workflow.name}</span>
          {workflowBadge(workflow)}
        </div>
        {workflow.description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {workflow.description}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {active ? <Badge variant="info">{summary.activeRunCount} active</Badge> : null}
          {summary.pendingInputCount > 0 ? (
            <Badge variant="warning">{summary.pendingInputCount} input</Badge>
          ) : null}
          {summary.latestRun ? (
            <Badge variant={runBadgeVariant(summary.latestRun.status)}>
              {summary.latestRun.status}
            </Badge>
          ) : null}
        </div>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="icon-xs"
          disabled={!canRun || busyKey === `run:${workflow.workflowId}`}
          onClick={() => onRun(workflow)}
          aria-label="Run workflow"
        >
          {busyKey === `run:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </Button>
        <Button
          size="icon-xs"
          variant="outline"
          disabled={busyKey === `open:${workflow.workflowId}`}
          onClick={() => onOpen(workflow)}
          aria-label="Open source"
        >
          {busyKey === `open:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <ExternalLinkIcon className="size-3.5" />
          )}
        </Button>
        <Button
          size="icon-xs"
          variant="destructive-outline"
          disabled={active || busyKey === `archive:${workflow.workflowId}`}
          onClick={() => onArchive(workflow)}
          aria-label="Archive workflow"
        >
          {busyKey === `archive:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <ArchiveIcon className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function WorkflowCenter({ projectId }: WorkflowCenterProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<WorkflowId | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runAt, setRunAt] = useState(nextOneShotDateTime);
  const [busyKey, setBusyKey] = useState<BusyKey>(null);
  const {
    summaries,
    runs,
    schedules,
    eventsByRunId,
    memory,
    fetching,
    fetchProject,
    fetchTimeline,
    fetchMemory,
    runWorkflow,
    scheduleWorkflow,
    cancelScheduledRun,
    stopRun,
    validateWorkflow,
    archiveWorkflow,
    openWorkflowSource,
    suppressMemoryItem,
  } = useWorkflowStore(
    useShallow((state) => {
      const workflowId = selectedWorkflowId;
      return {
        summaries: selectProjectWorkflowSummaries(state, projectId),
        runs: selectProjectWorkflowRuns(state, projectId),
        schedules: selectProjectWorkflowSchedules(state, projectId),
        eventsByRunId: state.eventsByRunId,
        memory: selectWorkflowMemoryItems(state, workflowId),
        fetching: state.fetchingProjectIds.has(projectId),
        fetchProject: state.fetchProject,
        fetchTimeline: state.fetchTimeline,
        fetchMemory: state.fetchMemory,
        runWorkflow: state.runWorkflow,
        scheduleWorkflow: state.scheduleWorkflow,
        cancelScheduledRun: state.cancelScheduledRun,
        stopRun: state.stopRun,
        validateWorkflow: state.validateWorkflow,
        archiveWorkflow: state.archiveWorkflow,
        openWorkflowSource: state.openWorkflowSource,
        suppressMemoryItem: state.suppressMemoryItem,
      };
    }),
  );

  const selectedSummary = summaries.find(
    (summary) => summary.workflow.workflowId === selectedWorkflowId,
  );
  const selectedWorkflow = selectedSummary?.workflow ?? summaries[0]?.workflow ?? null;
  const selectedWorkflowRuns = selectedWorkflow
    ? runs.filter((run) => run.workflowId === selectedWorkflow.workflowId)
    : [];
  const selectedRun = selectedRunId
    ? (runs.find((run) => run.runId === selectedRunId) ?? null)
    : (selectedWorkflowRuns[0] ?? null);
  const timeline = selectedRun ? (eventsByRunId[selectedRun.runId] ?? EMPTY_EVENTS) : EMPTY_EVENTS;
  const activeRuns = useMemo(() => runs.filter(isActiveRun), [runs]);
  const selectedSchedules = selectedWorkflow
    ? schedules.filter((schedule) => schedule.workflowId === selectedWorkflow.workflowId)
    : [];

  useEffect(() => {
    void fetchProject(projectId).catch((error) => {
      console.error("workflows.listProjectWorkflows failed:", error);
    });
  }, [fetchProject, projectId]);

  useEffect(() => {
    if (!selectedWorkflow && summaries[0]) {
      setSelectedWorkflowId(summaries[0].workflow.workflowId);
    }
  }, [selectedWorkflow, summaries]);

  useEffect(() => {
    if (!selectedWorkflow) return;
    void fetchMemory(selectedWorkflow.workflowId).catch((error) => {
      console.error("workflows.listMemory failed:", error);
    });
  }, [fetchMemory, selectedWorkflow]);

  useEffect(() => {
    if (!selectedRun || eventsByRunId[selectedRun.runId]) return;
    void fetchTimeline(selectedRun.runId).catch((error) => {
      console.error("workflows.getTimeline failed:", error);
    });
  }, [eventsByRunId, fetchTimeline, selectedRun]);

  const withBusy = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Workflow action failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyKey(null);
    }
  }, []);

  const handleRun = useCallback(
    (workflow: WorkflowDraft) => {
      void withBusy(`run:${workflow.workflowId}`, async () => {
        if (!isRunnableWorkflow(workflow)) {
          const validated = await validateWorkflow(workflow.workflowId);
          if (!isRunnableWorkflow(validated)) {
            throw new Error(validated.validationError ?? "Workflow validation failed.");
          }
        }
        const run = await runWorkflow(projectId, null, workflow.workflowId);
        setSelectedRunId(run.runId);
      });
    },
    [projectId, runWorkflow, validateWorkflow, withBusy],
  );

  const handleSchedule = useCallback(() => {
    if (!selectedWorkflow) return;
    void withBusy(`schedule:${selectedWorkflow.workflowId}`, async () => {
      await scheduleWorkflow(selectedWorkflow.workflowId, new Date(runAt).toISOString());
      await fetchProject(projectId);
    });
  }, [fetchProject, projectId, runAt, scheduleWorkflow, selectedWorkflow, withBusy]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <WorkflowIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Workflow Center</div>
          <div className="truncate text-xs text-muted-foreground">
            {summaries.length} workflows · {activeRuns.length} active · {schedules.length} schedules
          </div>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={busyKey === "refresh" || fetching}
          onClick={() => void withBusy("refresh", () => fetchProject(projectId))}
          aria-label="Refresh workflows"
        >
          {busyKey === "refresh" || fetching ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)_minmax(18rem,24rem)]">
        <ScrollArea className="min-h-0 border-r border-border/60" scrollbarGutter>
          {summaries.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No workflows in this project.</div>
          ) : (
            summaries.map((summary) => (
              <WorkflowListRow
                key={summary.workflow.workflowId}
                summary={summary}
                selected={summary.workflow.workflowId === selectedWorkflow?.workflowId}
                busyKey={busyKey}
                onSelect={(workflowId) => {
                  setSelectedWorkflowId(workflowId);
                  setSelectedRunId(null);
                }}
                onRun={handleRun}
                onOpen={(workflow) =>
                  void withBusy(`open:${workflow.workflowId}`, () =>
                    openWorkflowSource(workflow.workflowId).then(() => undefined),
                  )
                }
                onArchive={(workflow) =>
                  void withBusy(`archive:${workflow.workflowId}`, () =>
                    archiveWorkflow(workflow.workflowId).then(() => fetchProject(projectId)),
                  )
                }
              />
            ))
          )}
        </ScrollArea>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="border-b border-border/60 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-base font-semibold">
                    {selectedWorkflow?.name ?? "Workflow"}
                  </h1>
                  {selectedWorkflow ? workflowBadge(selectedWorkflow) : null}
                </div>
                {selectedWorkflow?.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {selectedWorkflow.description}
                  </p>
                ) : null}
              </div>
              {selectedRun && isActiveRun(selectedRun) ? (
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={busyKey === `stop:${selectedRun.runId}`}
                  onClick={() =>
                    void withBusy(`stop:${selectedRun.runId}`, () => stopRun(selectedRun.runId))
                  }
                >
                  {busyKey === `stop:${selectedRun.runId}` ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <SquareIcon className="size-3.5" />
                  )}
                  Stop
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid min-h-0 grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
            <ScrollArea className="min-h-0 border-r border-border/60" scrollbarGutter>
              <div className="px-3 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Runs
              </div>
              {selectedWorkflowRuns.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  className={cn(
                    "block w-full border-t border-border/50 px-3 py-3 text-left hover:bg-accent/25",
                    selectedRun?.runId === run.runId ? "bg-accent/45" : "",
                  )}
                  onClick={() => setSelectedRunId(run.runId)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                    <span className="truncate text-xs text-muted-foreground">
                      {run.trigger ?? "thread"}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {formatDate(run.startedAt)}
                  </div>
                </button>
              ))}
            </ScrollArea>

            <ScrollArea className="min-h-0" scrollbarGutter>
              <div className="px-4 py-3 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Timeline
              </div>
              {timeline.length === 0 ? (
                <div className="px-4 text-sm text-muted-foreground">No timeline events.</div>
              ) : (
                timeline.map((event) => (
                  <div key={event.eventId} className="border-t border-border/50 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{event.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                    {event.body ? (
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {event.body}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </div>

        <ScrollArea className="min-h-0 border-l border-border/60" scrollbarGutter>
          <div className="space-y-5 p-4">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                <CalendarClockIcon className="size-3.5" />
                Schedule
              </div>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={runAt}
                  onChange={(event) => setRunAt(event.target.value)}
                  className="h-8 text-xs"
                />
                <Button
                  size="icon-xs"
                  disabled={
                    !selectedWorkflow || busyKey === `schedule:${selectedWorkflow.workflowId}`
                  }
                  onClick={handleSchedule}
                  aria-label="Schedule workflow"
                >
                  {selectedWorkflow && busyKey === `schedule:${selectedWorkflow.workflowId}` ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <CalendarClockIcon className="size-3.5" />
                  )}
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {selectedSchedules.map((schedule: WorkflowSchedule) => (
                  <div key={schedule.scheduleId} className="rounded-md border border-border/70 p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={schedule.status === "scheduled" ? "info" : "outline"}>
                        {schedule.status}
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDate(schedule.runAt)}
                      </span>
                      {schedule.status === "scheduled" ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() =>
                            void withBusy(`cancel-schedule:${schedule.scheduleId}`, () =>
                              cancelScheduledRun(schedule.scheduleId).then(() => undefined),
                            )
                          }
                          aria-label="Cancel schedule"
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section>
              <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedWorkflow && workflowCapabilities(selectedWorkflow).length > 0 ? (
                  workflowCapabilities(selectedWorkflow).map((capability) => (
                    <Badge key={capability} variant="outline">
                      {capability}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No declared capabilities.</span>
                )}
              </div>
            </section>

            <Separator />

            <section>
              <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Memory
              </div>
              <div className="space-y-2">
                {memory.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No active memory.</div>
                ) : (
                  memory.map((item) => (
                    <div key={item.memoryId} className="rounded-md border border-border/70 p-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={item.status === "active" ? "success" : "outline"}>
                          {item.kind}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {Math.round(item.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">
                        {item.content}
                      </p>
                      {item.status === "active" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="mt-2"
                          onClick={() =>
                            void withBusy(`suppress:${item.memoryId}`, () =>
                              suppressMemoryItem(item.memoryId).then(() => undefined),
                            )
                          }
                        >
                          Suppress
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
