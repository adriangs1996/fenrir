import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectId,
  ThreadId,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowInputRequestSnapshot,
  WorkflowRunId,
  WorkflowRunSnapshot,
  WorkflowThreadSummary,
} from "@fenrir/contracts";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  ListTodoIcon,
  MessageSquareWarningIcon,
  NotebookTextIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  UsersIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import {
  canAttemptWorkflowRun,
  isRunnableWorkflow,
  selectThreadWorkflowCounts,
  selectThreadWorkflowRuns,
  selectThreadWorkflowSummaries,
  useWorkflowStore,
} from "../stores/useWorkflowStore";

export interface WorkflowPanelProps {
  readonly projectId: ProjectId | null;
  readonly originThreadId: ThreadId | null;
  readonly initialRunId?: WorkflowRunId | undefined;
  readonly onClose: () => void;
}

type BusyKey = string | null;

const EMPTY_WORKFLOW_EVENTS: readonly WorkflowEvent[] = [];

function isActiveRun(run: WorkflowRunSnapshot): boolean {
  return run.status === "running" || run.status === "paused";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseInputResponse(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function runStatusVariant(status: WorkflowRunSnapshot["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "failed":
    case "interrupted":
      return "error" as const;
    case "cancelled":
      return "outline" as const;
    case "paused":
      return "warning" as const;
    case "running":
      return "info" as const;
  }
}

function validationBadge(workflow: WorkflowDraft) {
  if (workflow.validationStatus === "valid") {
    return <Badge variant="success">Valid</Badge>;
  }
  if (workflow.validationStatus === "invalid") {
    return <Badge variant="error">Invalid</Badge>;
  }
  return <Badge variant="outline">Draft</Badge>;
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  readonly icon: typeof WorkflowIcon;
  readonly title: string;
  readonly count?: number;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
      <Icon className="size-3.5" />
      <span>{title}</span>
      {count !== undefined ? (
        <Badge variant="outline" size="sm" className="ml-auto">
          {count}
        </Badge>
      ) : null}
    </div>
  );
}

function PendingInputForm({
  run,
  request,
  busy,
  onRespond,
}: {
  readonly run: WorkflowRunSnapshot;
  readonly request: WorkflowInputRequestSnapshot;
  readonly busy: boolean;
  readonly onRespond: (
    runId: WorkflowRunSnapshot["runId"],
    requestId: WorkflowInputRequestSnapshot["requestId"],
    response: unknown,
  ) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="mx-3 rounded-md border border-warning/30 bg-warning/5 p-3">
      <div className="flex items-start gap-2">
        <MessageSquareWarningIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{request.title}</div>
          {request.body ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{request.body}</p>
          ) : null}
          {request.fields !== null && request.fields !== undefined ? (
            <pre className="mt-2 max-h-28 overflow-auto rounded bg-background/70 p-2 text-xs text-muted-foreground">
              {stringifyUnknown(request.fields)}
            </pre>
          ) : null}
        </div>
        <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
      </div>
      <Textarea
        size="sm"
        className="mt-3"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder='Response, or JSON such as {"accept": true}'
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="xs"
          disabled={busy}
          onClick={() => onRespond(run.runId, request.requestId, parseInputResponse(value))}
        >
          {busy ? <Spinner className="size-3.5" /> : <CheckCircle2Icon className="size-3.5" />}
          Respond
        </Button>
      </div>
    </div>
  );
}

function TimelineEventRow({ event }: { readonly event: WorkflowEvent }) {
  return (
    <div className="flex gap-2 px-3 py-2">
      <div className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{event.title}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatDate(event.createdAt)}
          </span>
        </div>
        {event.body ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.body}</p>
        ) : null}
      </div>
    </div>
  );
}

function DraftRow({
  summary,
  latestRun,
  busyKey,
  onRun,
  onOpen,
  onValidate,
  onArchive,
  onStop,
}: {
  readonly summary: WorkflowThreadSummary;
  readonly latestRun: WorkflowRunSnapshot | null;
  readonly busyKey: BusyKey;
  readonly onRun: (workflow: WorkflowDraft) => void;
  readonly onOpen: (workflow: WorkflowDraft) => void;
  readonly onValidate: (workflow: WorkflowDraft) => void;
  readonly onArchive: (workflow: WorkflowDraft) => void;
  readonly onStop: (run: WorkflowRunSnapshot) => void;
}) {
  const workflow = summary.workflow;
  const activeRun = latestRun && isActiveRun(latestRun) ? latestRun : null;
  const hasActiveRuns = Number(summary.activeRunCount) > 0;
  const canRun = canAttemptWorkflowRun(workflow);

  return (
    <div className="mx-3 rounded-md border border-border/70 bg-background/60 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <WorkflowIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{workflow.name}</span>
            {validationBadge(workflow)}
          </div>
          {workflow.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {workflow.description}
            </p>
          ) : null}
          {workflow.validationError ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-destructive">
              {workflow.validationError}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.activeRunCount > 0 ? (
              <Badge variant="info">{summary.activeRunCount} active</Badge>
            ) : null}
            {summary.pendingInputCount > 0 ? (
              <Badge variant="warning">{summary.pendingInputCount} input</Badge>
            ) : null}
            {latestRun ? (
              <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="xs"
          disabled={!canRun || busyKey === `run:${workflow.workflowId}`}
          onClick={() => onRun(workflow)}
          title={
            canRun
              ? workflow.validationStatus === "pending"
                ? "Validate and run workflow"
                : "Run workflow"
              : "Fix validation errors before running"
          }
        >
          {busyKey === `run:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          Run
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busyKey === `open:${workflow.workflowId}`}
          onClick={() => onOpen(workflow)}
        >
          {busyKey === `open:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <ExternalLinkIcon className="size-3.5" />
          )}
          Open
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busyKey === `validate:${workflow.workflowId}`}
          onClick={() => onValidate(workflow)}
        >
          {busyKey === `validate:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          Validate
        </Button>
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={hasActiveRuns || busyKey === `archive:${workflow.workflowId}`}
          onClick={() => onArchive(workflow)}
          title={hasActiveRuns ? "Stop active runs before removing" : "Remove workflow"}
        >
          {busyKey === `archive:${workflow.workflowId}` ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
          Remove
        </Button>
        {activeRun ? (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busyKey === `stop:${activeRun.runId}`}
            onClick={() => onStop(activeRun)}
          >
            {busyKey === `stop:${activeRun.runId}` ? (
              <Spinner className="size-3.5" />
            ) : (
              <SquareIcon className="size-3.5" />
            )}
            Stop
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowPanel({
  projectId,
  originThreadId,
  initialRunId,
  onClose,
}: WorkflowPanelProps) {
  const [selectedRunId, setSelectedRunId] = useState<WorkflowRunId | null>(initialRunId ?? null);
  const [busyKey, setBusyKey] = useState<BusyKey>(null);
  const {
    summaries,
    runs,
    counts,
    runById,
    eventsByRunId,
    fetching,
    fetchThread,
    fetchTimeline,
    runWorkflow,
    stopRun,
    validateWorkflow,
    archiveWorkflow,
    openWorkflowSource,
    respondToInput,
  } = useWorkflowStore(
    useShallow((state) => {
      const threadKey = projectId && originThreadId ? `${projectId}:${originThreadId}` : null;
      return {
        summaries: selectThreadWorkflowSummaries(state, projectId, originThreadId),
        runs: selectThreadWorkflowRuns(state, projectId, originThreadId),
        counts: selectThreadWorkflowCounts(state, projectId, originThreadId),
        runById: state.runById,
        eventsByRunId: state.eventsByRunId,
        fetching: threadKey ? state.fetchingThreadKeys.has(threadKey) : false,
        fetchThread: state.fetchThread,
        fetchTimeline: state.fetchTimeline,
        runWorkflow: state.runWorkflow,
        stopRun: state.stopRun,
        validateWorkflow: state.validateWorkflow,
        archiveWorkflow: state.archiveWorkflow,
        openWorkflowSource: state.openWorkflowSource,
        respondToInput: state.respondToInput,
      };
    }),
  );

  const selectedRun = selectedRunId ? (runById[selectedRunId] ?? null) : null;
  const timeline = selectedRunId
    ? (eventsByRunId[selectedRunId] ?? EMPTY_WORKFLOW_EVENTS)
    : EMPTY_WORKFLOW_EVENTS;
  const activeRuns = useMemo(() => runs.filter(isActiveRun), [runs]);
  const historicalRuns = useMemo(() => runs.filter((run) => !isActiveRun(run)), [runs]);
  const pendingInputs = useMemo(
    () =>
      runs.flatMap((run) =>
        run.inputRequests
          .filter((request) => request.status === "pending")
          .map((request) => ({ run, request })),
      ),
    [runs],
  );

  useEffect(() => {
    const nextSelectedRunId = runs[0]?.runId ?? null;
    if (selectedRunId === null || !runs.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId(nextSelectedRunId);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!initialRunId) {
      return;
    }
    if (!runs.some((run) => run.runId === initialRunId)) {
      return;
    }
    setSelectedRunId(initialRunId);
  }, [initialRunId, runs]);

  useEffect(() => {
    if (!selectedRunId || eventsByRunId[selectedRunId]) {
      return;
    }
    void fetchTimeline(selectedRunId).catch((error) => {
      console.error("workflows.getTimeline failed:", error);
    });
  }, [eventsByRunId, fetchTimeline, selectedRunId]);

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

  const refresh = useCallback(() => {
    if (!projectId || !originThreadId) {
      return;
    }
    void withBusy("refresh", () => fetchThread(projectId, originThreadId));
  }, [fetchThread, originThreadId, projectId, withBusy]);

  const handleRun = useCallback(
    (workflow: WorkflowDraft) => {
      if (!projectId || !originThreadId) {
        return;
      }
      void withBusy(`run:${workflow.workflowId}`, async () => {
        if (!isRunnableWorkflow(workflow)) {
          const validated = await validateWorkflow(workflow.workflowId);
          if (!isRunnableWorkflow(validated)) {
            throw new Error(validated.validationError ?? "Workflow validation failed.");
          }
        }
        const run = await runWorkflow(projectId, originThreadId, workflow.workflowId);
        setSelectedRunId(run.runId);
      });
    },
    [originThreadId, projectId, runWorkflow, validateWorkflow, withBusy],
  );

  const handleStop = useCallback(
    (run: WorkflowRunSnapshot) => {
      void withBusy(`stop:${run.runId}`, () => stopRun(run.runId));
    },
    [stopRun, withBusy],
  );

  const handleRerun = useCallback(
    (run: WorkflowRunSnapshot) => {
      void withBusy(`rerun:${run.runId}`, async () => {
        const nextRun = await runWorkflow(run.projectId, run.originThreadId, run.workflowId);
        setSelectedRunId(nextRun.runId);
      });
    },
    [runWorkflow, withBusy],
  );

  const handleValidate = useCallback(
    (workflow: WorkflowDraft) => {
      void withBusy(`validate:${workflow.workflowId}`, () =>
        validateWorkflow(workflow.workflowId).then(() => undefined),
      );
    },
    [validateWorkflow, withBusy],
  );

  const handleOpen = useCallback(
    (workflow: WorkflowDraft) => {
      void withBusy(`open:${workflow.workflowId}`, () =>
        openWorkflowSource(workflow.workflowId).then(() => undefined),
      );
    },
    [openWorkflowSource, withBusy],
  );

  const handleArchive = useCallback(
    (workflow: WorkflowDraft) => {
      void withBusy(`archive:${workflow.workflowId}`, () =>
        archiveWorkflow(workflow.workflowId).then(() => undefined),
      );
    },
    [archiveWorkflow, withBusy],
  );

  const handleOpenRunSource = useCallback(
    (run: WorkflowRunSnapshot) => {
      void withBusy(`open-run:${run.runId}`, () =>
        openWorkflowSource(run.workflowId).then(() => undefined),
      );
    },
    [openWorkflowSource, withBusy],
  );

  const handleRespond = useCallback(
    (
      runId: WorkflowRunSnapshot["runId"],
      requestId: WorkflowInputRequestSnapshot["requestId"],
      response: unknown,
    ) => {
      void withBusy(`respond:${requestId}`, () => respondToInput(runId, requestId, response));
    },
    [respondToInput, withBusy],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <WorkflowIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Workflows</div>
          <div className="truncate text-xs text-muted-foreground">
            {counts.hasWorkflows
              ? `${counts.draftCount} draft${counts.draftCount === 1 ? "" : "s"} · ${counts.activeRunCount} active · ${counts.pendingInputCount} input`
              : "No workflow activity"}
          </div>
        </div>
        <Button
          aria-label="Refresh workflows"
          size="icon-xs"
          variant="ghost"
          disabled={busyKey === "refresh" || !projectId || !originThreadId}
          onClick={refresh}
        >
          {busyKey === "refresh" || fetching ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
        </Button>
        <Button aria-label="Close workflows panel" size="icon-xs" variant="ghost" onClick={onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollFade scrollbarGutter>
        <div className="space-y-4 py-3">
          {!projectId || !originThreadId ? (
            <div className="mx-3 rounded-md border border-border/70 p-4 text-sm text-muted-foreground">
              Select a server-backed thread to view workflows.
            </div>
          ) : summaries.length === 0 && runs.length === 0 ? (
            <div className="mx-3 rounded-md border border-border/70 p-4 text-sm text-muted-foreground">
              No workflows belong to this thread yet.
            </div>
          ) : null}

          {pendingInputs.length > 0 ? (
            <section>
              <SectionHeader
                icon={MessageSquareWarningIcon}
                title="Needs Input"
                count={pendingInputs.length}
              />
              <div className="space-y-2">
                {pendingInputs.map(({ run, request }) => (
                  <PendingInputForm
                    key={request.requestId}
                    run={run}
                    request={request}
                    busy={busyKey === `respond:${request.requestId}`}
                    onRespond={handleRespond}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {summaries.length > 0 ? (
            <section>
              <SectionHeader icon={WorkflowIcon} title="Drafts" count={summaries.length} />
              <div className="space-y-2">
                {summaries.map((summary) => (
                  <DraftRow
                    key={summary.workflow.workflowId}
                    summary={summary}
                    latestRun={summary.latestRun}
                    busyKey={busyKey}
                    onRun={handleRun}
                    onOpen={handleOpen}
                    onValidate={handleValidate}
                    onArchive={handleArchive}
                    onStop={handleStop}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {runs.length > 0 ? (
            <section>
              <SectionHeader icon={ListTodoIcon} title="Runs" count={runs.length} />
              <div className="mx-3 space-y-2">
                {[...activeRuns, ...historicalRuns].map((run) => {
                  const selected = selectedRunId === run.runId;
                  return (
                    <button
                      key={run.runId}
                      type="button"
                      onClick={() => setSelectedRunId(run.runId)}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/70 bg-background/60 hover:bg-accent/40",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{run.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDate(run.startedAt)} · {run.runId}
                        </span>
                      </span>
                      <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {selectedRun ? (
            <section>
              <SectionHeader icon={AlertCircleIcon} title="Selected Run" />
              <div className="mx-3 rounded-md border border-border/70 bg-background/60 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{selectedRun.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant={runStatusVariant(selectedRun.status)}>
                        {selectedRun.status}
                      </Badge>
                      <Badge variant="outline">{selectedRun.steps.length} steps</Badge>
                      <Badge variant="outline">{selectedRun.agents.length} agents</Badge>
                      <Badge variant="outline">{selectedRun.tasks.length} tasks</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busyKey === `open-run:${selectedRun.runId}`}
                      onClick={() => handleOpenRunSource(selectedRun)}
                    >
                      {busyKey === `open-run:${selectedRun.runId}` ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <ExternalLinkIcon className="size-3.5" />
                      )}
                      Open
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busyKey === `rerun:${selectedRun.runId}`}
                      onClick={() => handleRerun(selectedRun)}
                    >
                      {busyKey === `rerun:${selectedRun.runId}` ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <RefreshCwIcon className="size-3.5" />
                      )}
                      Rerun
                    </Button>
                    {isActiveRun(selectedRun) ? (
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        disabled={busyKey === `stop:${selectedRun.runId}`}
                        onClick={() => handleStop(selectedRun)}
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
                {selectedRun.summary ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {selectedRun.summary}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {selectedRun && selectedRun.agents.length > 0 ? (
            <section>
              <SectionHeader
                icon={UsersIcon}
                title="Team Agents"
                count={selectedRun.agents.length}
              />
              <div className="mx-3 grid gap-2">
                {selectedRun.agents.map((agent) => (
                  <div
                    key={agent.agentId}
                    className="rounded-md border border-border/70 bg-background/60 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{agent.name}</span>
                      <Badge variant={agent.status === "failed" ? "error" : "outline"}>
                        {agent.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {agent.role}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedRun && selectedRun.tasks.length > 0 ? (
            <section>
              <SectionHeader
                icon={NotebookTextIcon}
                title="Task Proposals"
                count={selectedRun.tasks.length}
              />
              <div className="mx-3 grid gap-2">
                {selectedRun.tasks.map((task) => (
                  <div
                    key={task.taskId}
                    className="rounded-md border border-border/70 bg-background/60 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{task.title}</span>
                      <Badge variant={task.status === "failed" ? "error" : "outline"}>
                        {task.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{task.kind}</Badge>
                      {task.assignee ? <Badge variant="outline">{task.assignee}</Badge> : null}
                    </div>
                    {task.reason ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {task.reason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedRun && selectedRun.state.length > 0 ? (
            <section>
              <SectionHeader
                icon={DatabaseIcon}
                title="Shared State"
                count={selectedRun.state.length}
              />
              <div className="mx-3 overflow-hidden rounded-md border border-border/70 bg-background/60">
                {selectedRun.state.map((entry, index) => (
                  <div key={`${entry.scope}:${entry.key}`} className="p-3">
                    {index > 0 ? <Separator className="-mx-3 mb-3" /> : null}
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-medium">
                        {entry.scope}.{entry.key}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDate(entry.updatedAt)}
                      </span>
                    </div>
                    <pre className="mt-2 max-h-28 overflow-auto text-xs text-muted-foreground">
                      {stringifyUnknown(entry.value)}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedRun ? (
            <section>
              <SectionHeader icon={AlertCircleIcon} title="Timeline" count={timeline.length} />
              <div className="mx-3 overflow-hidden rounded-md border border-border/70 bg-background/60">
                {timeline.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No timeline events yet.</div>
                ) : (
                  timeline.map((event, index) => (
                    <div key={event.eventId}>
                      {index > 0 ? <Separator /> : null}
                      <TimelineEventRow event={event} />
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
