import {
  AlertTriangleIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  SignalIcon,
  TimerResetIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  type ServerProcessDiagnosticsEntry,
  type ServerProcessResourceHistorySummary,
  type ServerProcessSignal,
} from "@fenrir/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { openInPreferredEditor } from "../../editorPreferences";
import { ensureLocalApi } from "../../localApi";
import {
  useProcessDiagnostics,
  useProcessResourceHistory,
} from "../../lib/processDiagnosticsState";
import { useTraceDiagnostics } from "../../lib/traceDiagnosticsState";
import { formatRelativeTime } from "../../lib/formatting";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  SettingsPageContainer,
  SettingsSection,
  SettingsRow,
  useRelativeTimeTick,
} from "./settingsLayout";
import { useServerObservability } from "../../rpc/serverState";

const NUMBER_FORMAT = new Intl.NumberFormat();

const HISTORY_WINDOW_OPTIONS = [
  { label: "15 minutes", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "1 hour", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
  { label: "6 hours", windowMs: 6 * 60 * 60_000, bucketMs: 30 * 60_000 },
] as const;

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value;
  let unitIndex = -1;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDurationMs(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function toIso(value: DateTime.Utc): string {
  return DateTime.formatIso(value);
}

function formatRelativeUtc(value: DateTime.Utc | null): string {
  if (!value) return "n/a";
  const relative = formatRelativeTime(toIso(value));
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}

function relativeFromOption(value: Option.Option<DateTime.Utc>): string {
  return Option.match(value, {
    onNone: () => "n/a",
    onSome: (date) => formatRelativeUtc(date),
  });
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="space-y-1 rounded-xl border border-border/60 bg-background/70 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-base font-semibold text-foreground sm:text-lg",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-xs text-warning-foreground">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: ReadonlyArray<string>; rows: ReactNode }) {
  return (
    <ScrollArea className="w-full">
      <table className="min-w-[720px] w-full text-left text-xs">
        <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-2.5 font-semibold first:sm:pl-5 last:sm:pr-5">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{rows}</tbody>
      </table>
    </ScrollArea>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div className="px-4 py-4 text-xs text-muted-foreground sm:px-5">{label}</div>;
}

function ProcessSignalButtons({
  pid,
  disabled,
  onSignal,
}: {
  pid: number;
  disabled: boolean;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => onSignal(pid, "SIGINT")}
      >
        Stop
      </Button>
      <Button
        size="xs"
        variant="destructive-outline"
        disabled={disabled}
        onClick={() => onSignal(pid, "SIGKILL")}
      >
        Kill
      </Button>
    </div>
  );
}

function ProcessCommandCell({ process }: { process: ServerProcessDiagnosticsEntry }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[11px] text-foreground">{process.command}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        pid {process.pid} · parent {process.ppid}
      </div>
    </div>
  );
}

function DiagnosticsHeaderActions({
  clearingLogs,
  onRefresh,
  onOpenLogs,
  onClearLogs,
  refreshing,
}: {
  clearingLogs?: boolean;
  onRefresh: () => void;
  onOpenLogs: () => void;
  onClearLogs: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="xs" variant="outline" onClick={onOpenLogs}>
        <FolderOpenIcon className="size-3.5" />
        Open logs
      </Button>
      <Button size="xs" variant="destructive-outline" disabled={clearingLogs} onClick={onClearLogs}>
        <Trash2Icon className="size-3.5" />
        {clearingLogs ? "Clearing..." : "Clear logs"}
      </Button>
      <Button size="xs" variant="outline" onClick={onRefresh}>
        <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}

function TopProcessesTable({
  processes,
}: {
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
}) {
  if (processes.length === 0) {
    return <EmptyTable label="No process history samples have been collected yet." />;
  }

  return (
    <DataTable
      headers={["Process", "Depth", "CPU now", "CPU avg", "CPU max", "RSS now", "RSS max", "Seen"]}
      rows={processes.slice(0, 15).map((process) => (
        <tr key={process.processKey}>
          <td className="px-4 py-3 first:sm:pl-5">
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-foreground">
                {process.command}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">pid {process.pid}</div>
            </div>
          </td>
          <td className="px-4 py-3">{process.depth}</td>
          <td className="px-4 py-3 font-mono">{formatPercent(process.currentCpuPercent)}</td>
          <td className="px-4 py-3 font-mono">{formatPercent(process.avgCpuPercent)}</td>
          <td className="px-4 py-3 font-mono">{formatPercent(process.maxCpuPercent)}</td>
          <td className="px-4 py-3 font-mono">{formatBytes(process.currentRssBytes)}</td>
          <td className="px-4 py-3 font-mono">{formatBytes(process.maxRssBytes)}</td>
          <td className="px-4 py-3 last:sm:pr-5">
            <div>{formatRelativeUtc(process.lastSeenAt)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {formatCount(process.sampleCount)} samples
            </div>
          </td>
        </tr>
      ))}
    />
  );
}

export function DiagnosticsSettingsPanel() {
  useRelativeTimeTick();
  const navigate = useNavigate();
  const observability = useServerObservability();
  const traceDiagnostics = useTraceDiagnostics();
  const processDiagnostics = useProcessDiagnostics();
  const [selectedWindowLabel, setSelectedWindowLabel] = useState<
    (typeof HISTORY_WINDOW_OPTIONS)[number]["label"]
  >(HISTORY_WINDOW_OPTIONS[1]!.label);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  const selectedWindow =
    HISTORY_WINDOW_OPTIONS.find((option) => option.label === selectedWindowLabel) ??
    HISTORY_WINDOW_OPTIONS[1]!;
  const processHistory = useProcessResourceHistory({
    windowMs: selectedWindow.windowMs,
    bucketMs: selectedWindow.bucketMs,
  });

  const traceData = traceDiagnostics.data;
  const processData = processDiagnostics.data;
  const historyData = processHistory.data;

  const diagnosticsDirectoryPath =
    observability?.diagnosticsDirectoryPath ?? observability?.logsDirectoryPath;

  const openLogsDirectory = async () => {
    if (!diagnosticsDirectoryPath) return;
    try {
      await openInPreferredEditor(ensureLocalApi(), diagnosticsDirectoryPath);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to open diagnostics folder",
        description:
          error instanceof Error ? error.message : "Unknown error opening diagnostics folder.",
      });
    }
  };

  const refreshAll = () => {
    traceDiagnostics.refresh();
    processDiagnostics.refresh();
    processHistory.refresh();
  };

  const clearLogs = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Clear all application logs? This removes local trace, provider, terminal, desktop, and backend log files.",
    );
    if (!confirmed) return;

    setClearingLogs(true);
    try {
      const result = await ensureLocalApi().server.clearLogs();
      toastManager.add({
        type: "success",
        title: "Logs cleared",
        description: `${formatCount(result.removedEntryCount)} log entries removed.`,
      });
      refreshAll();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to clear logs",
        description: error instanceof Error ? error.message : "Unknown error clearing logs.",
      });
    } finally {
      setClearingLogs(false);
    }
  };

  const signalProcess = async (pid: number, signal: ServerProcessSignal) => {
    if (
      signal === "SIGKILL" &&
      !(await ensureLocalApi().dialogs.confirm(`Force kill process ${pid}?`))
    ) {
      return;
    }

    setSignalingPid(pid);
    try {
      const result = await ensureLocalApi().server.signalProcess({ pid, signal });
      if (!result.signaled) {
        toastManager.add({
          type: "warning",
          title: `Could not send ${signal}`,
          description: Option.getOrNull(result.message) ?? `Failed to send ${signal}.`,
        });
        return;
      }

      toastManager.add({
        type: "success",
        title: `${signal} sent`,
        description: `Signal sent to process ${pid}.`,
      });
      processDiagnostics.refresh();
      processHistory.refresh();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not send ${signal}`,
        description: error instanceof Error ? error.message : `Failed to send ${signal}.`,
      });
    } finally {
      setSignalingPid(null);
    }
  };

  const traceLogLevelEntries = useMemo(
    () =>
      Object.entries(traceData?.logLevelCounts ?? {}).toSorted((left, right) =>
        left[0].localeCompare(right[0]),
      ),
    [traceData],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Diagnostics"
        icon={<SignalIcon className="size-3.5" />}
        headerAction={
          <DiagnosticsHeaderActions
            clearingLogs={clearingLogs}
            onRefresh={refreshAll}
            onOpenLogs={openLogsDirectory}
            onClearLogs={clearLogs}
            refreshing={
              traceDiagnostics.isPending || processDiagnostics.isPending || processHistory.isPending
            }
          />
        }
      >
        <SettingsRow
          title="Overview"
          description="Inspect local traces, live server child processes, and recent process resource history."
          control={
            <Button
              size="xs"
              variant="outline"
              onClick={() => void navigate({ to: "/settings/general" })}
            >
              <TimerResetIcon className="size-3.5" />
              General settings
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="Trace Diagnostics">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Records" value={formatCount(traceData?.recordCount ?? 0)} />
          <Stat label="Failures" value={formatCount(traceData?.failureCount ?? 0)} />
          <Stat
            label="Parse errors"
            value={formatCount(traceData?.parseErrorCount ?? 0)}
            tone={(traceData?.parseErrorCount ?? 0) > 0 ? "warning" : "default"}
          />
          <Stat label="Slow spans" value={formatCount(traceData?.slowSpanCount ?? 0)} />
        </div>
        {traceDiagnostics.error ? <SectionError message={traceDiagnostics.error} /> : null}
        {traceData?.error._tag === "Some" ? (
          <SectionError message={traceData.error.value.message} />
        ) : null}
        {traceData ? (
          <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Trace file</div>
                <div className="mt-1 break-all font-mono text-[11px]">
                  {traceData.traceFilePath}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground">First span</div>
                <div className="mt-1">{relativeFromOption(traceData.firstSpanAt)}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Last span</div>
                <div className="mt-1">{relativeFromOption(traceData.lastSpanAt)}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Threshold</div>
                <div className="mt-1">{formatDurationMs(traceData.slowSpanThresholdMs)}</div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                  Top spans by count
                </div>
                {traceData.topSpansByCount.length === 0 ? (
                  <EmptyTable label="No trace spans recorded yet." />
                ) : (
                  <DataTable
                    headers={["Span", "Count", "Failures", "Avg", "Max"]}
                    rows={traceData.topSpansByCount.map((span) => (
                      <tr key={span.name}>
                        <td className="px-4 py-3 first:sm:pl-5 font-mono text-[11px]">
                          {span.name}
                        </td>
                        <td className="px-4 py-3">{formatCount(span.count)}</td>
                        <td className="px-4 py-3">{formatCount(span.failureCount)}</td>
                        <td className="px-4 py-3">{formatDurationMs(span.averageDurationMs)}</td>
                        <td className="px-4 py-3 last:sm:pr-5">
                          {formatDurationMs(span.maxDurationMs)}
                        </td>
                      </tr>
                    ))}
                  />
                )}
              </div>

              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                  Log levels
                </div>
                {traceLogLevelEntries.length === 0 ? (
                  <EmptyTable label="No warning or error logs captured yet." />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {traceLogLevelEntries.map(([level, count]) => (
                      <Stat key={level} label={level} value={formatCount(count)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                Latest failures
              </div>
              {traceData.latestFailures.length === 0 ? (
                <EmptyTable label="No recent trace failures." />
              ) : (
                <DataTable
                  headers={["Span", "Cause", "Duration", "When"]}
                  rows={traceData.latestFailures.slice(0, 10).map((failure) => (
                    <tr key={`${failure.traceId}:${failure.spanId}`}>
                      <td className="px-4 py-3 first:sm:pl-5 font-mono text-[11px]">
                        {failure.name}
                      </td>
                      <td className="px-4 py-3">{failure.cause}</td>
                      <td className="px-4 py-3">{formatDurationMs(failure.durationMs)}</td>
                      <td className="px-4 py-3 last:sm:pr-5">
                        {formatRelativeUtc(failure.endedAt)}
                      </td>
                    </tr>
                  ))}
                />
              )}
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Process Diagnostics">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Processes" value={formatCount(processData?.processCount ?? 0)} />
          <Stat label="Total CPU" value={formatPercent(processData?.totalCpuPercent ?? 0)} />
          <Stat label="Total RSS" value={formatBytes(processData?.totalRssBytes ?? 0)} />
          <Stat label="Server pid" value={processData ? String(processData.serverPid) : "n/a"} />
        </div>
        {processDiagnostics.error ? <SectionError message={processDiagnostics.error} /> : null}
        {processData?.error._tag === "Some" ? (
          <SectionError message={processData.error.value.message} />
        ) : null}
        {processData ? (
          <DataTable
            headers={["Command", "Status", "CPU", "RSS", "Elapsed", "Actions"]}
            rows={
              processData.processes.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyTable label="No child processes are currently running under the Fenrir server." />
                  </td>
                </tr>
              ) : (
                processData.processes.map((process) => (
                  <tr key={process.pid}>
                    <td className="px-4 py-3 first:sm:pl-5">
                      <ProcessCommandCell process={process} />
                    </td>
                    <td className="px-4 py-3">{process.status}</td>
                    <td className="px-4 py-3">{formatPercent(process.cpuPercent)}</td>
                    <td className="px-4 py-3">{formatBytes(process.rssBytes)}</td>
                    <td className="px-4 py-3">{process.elapsed}</td>
                    <td className="px-4 py-3 last:sm:pr-5">
                      <ProcessSignalButtons
                        pid={process.pid}
                        disabled={signalingPid === process.pid}
                        onSignal={signalProcess}
                      />
                    </td>
                  </tr>
                ))
              )
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Resource History"
        headerAction={
          <div className="w-44">
            <Select
              value={selectedWindow.label}
              onValueChange={(value) => {
                if (value !== null) {
                  setSelectedWindowLabel(value);
                }
              }}
            >
              <SelectTrigger aria-label="Resource history window">
                <SelectValue>{selectedWindow.label}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {HISTORY_WINDOW_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.label} value={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Samples kept" value={formatCount(historyData?.retainedSampleCount ?? 0)} />
          <Stat label="Buckets" value={formatCount(historyData?.buckets.length ?? 0)} />
          <Stat label="CPU seconds" value={(historyData?.totalCpuSecondsApprox ?? 0).toFixed(1)} />
          <Stat label="Top processes" value={formatCount(historyData?.topProcesses.length ?? 0)} />
        </div>
        {processHistory.error ? <SectionError message={processHistory.error} /> : null}
        {historyData?.error._tag === "Some" ? (
          <SectionError message={historyData.error.value.message} />
        ) : null}
        {historyData ? (
          <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                Bucket summary
              </div>
              {historyData.buckets.length === 0 ? (
                <EmptyTable label="No history buckets available yet." />
              ) : (
                <DataTable
                  headers={["Window", "CPU avg", "CPU max", "RSS max", "Process max"]}
                  rows={historyData.buckets.map((bucket) => (
                    <tr key={`${toIso(bucket.startedAt)}:${toIso(bucket.endedAt)}`}>
                      <td className="px-4 py-3 first:sm:pl-5">
                        {formatRelativeUtc(bucket.startedAt)} to {formatRelativeUtc(bucket.endedAt)}
                      </td>
                      <td className="px-4 py-3">{formatPercent(bucket.avgCpuPercent)}</td>
                      <td className="px-4 py-3">{formatPercent(bucket.maxCpuPercent)}</td>
                      <td className="px-4 py-3">{formatBytes(bucket.maxRssBytes)}</td>
                      <td className="px-4 py-3 last:sm:pr-5">
                        {formatCount(bucket.maxProcessCount)}
                      </td>
                    </tr>
                  ))}
                />
              )}
            </div>

            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                Top processes
              </div>
              <TopProcessesTable processes={historyData.topProcesses} />
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
