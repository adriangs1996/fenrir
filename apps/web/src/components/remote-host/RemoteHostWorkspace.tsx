import type { RemoteCommandRunSnapshot, RemoteConnectionSnapshot } from "@fenrir/contracts";
import { Loader2, Plug, Square, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "../../lib/desktopTitleBar";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { readEnvironmentApi } from "../../environmentApi";
import { useRemoteControllerStore } from "../../remoteControllerStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { resolveRemoteHostSpecialCommand } from "./remoteHostSpecialCommands";
import { useRemoteControllerSync } from "./useRemoteControllerSync";

interface Props {
  hostId: string;
}

function selectHostConnections(
  connections: Record<string, RemoteConnectionSnapshot>,
  hostId: string,
): RemoteConnectionSnapshot[] {
  return Object.values(connections)
    .filter((connection) => connection.hostId === hostId)
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function latestConnectedConnection(connections: RemoteConnectionSnapshot[]) {
  return connections.find((connection) => connection.status === "connected") ?? null;
}

function runStatusClassName(status: RemoteCommandRunSnapshot["status"]) {
  switch (status) {
    case "succeeded":
      return "text-success-foreground";
    case "failed":
      return "text-destructive";
    case "running":
      return "text-primary";
  }
}

function runExitLabel(run: RemoteCommandRunSnapshot) {
  if (run.status === "running") return "running";
  const exit = run.exitCode === null ? "-" : String(run.exitCode);
  return run.signal ? `exit ${exit} / ${run.signal}` : `exit ${exit}`;
}

function ShellTranscriptRun({ run }: { run: RemoteCommandRunSnapshot }) {
  return (
    <div className="py-2" data-remote-host-shell-run="true">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-primary">$</span>
        <span className="min-w-0 break-words text-foreground">{run.command}</span>
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-foreground">
        {run.output || (run.status === "running" ? "Running..." : "No output")}
      </pre>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{run.runId}</span>
        <span className={cn("uppercase", runStatusClassName(run.status))}>{run.status}</span>
        <span>{runExitLabel(run)}</span>
      </div>
    </div>
  );
}

export function RemoteHostWorkspace({ hostId }: Props) {
  const environmentId = usePrimaryEnvironmentId();
  useRemoteControllerSync(environmentId);
  const { isMobile, open: sidebarOpen } = useSidebar();
  const setSelectedHostId = useRemoteControllerStore((state) => state.setSelectedHostId);
  const host = useRemoteControllerStore((state) => state.hosts[hostId]);
  const connections = useRemoteControllerStore((state) => state.connections);
  const commandRuns = useRemoteControllerStore((state) => state.commandRuns);
  const [command, setCommand] = useState("whoami");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenRunIds, setHiddenRunIds] = useState<ReadonlySet<string>>(() => new Set());
  const [transcriptCleared, setTranscriptCleared] = useState(false);
  const commandInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedHostId(hostId);
    return () => setSelectedHostId(null);
  }, [hostId, setSelectedHostId]);

  useEffect(() => {
    setHiddenRunIds(new Set());
    setTranscriptCleared(false);
  }, [hostId]);

  const hostConnections = useMemo(
    () => selectHostConnections(connections, hostId),
    [connections, hostId],
  );
  const activeConnection = latestConnectedConnection(hostConnections);
  const runs = useMemo(() => {
    const connectionIds = new Set(hostConnections.map((connection) => connection.connectionId));
    return Object.values(commandRuns)
      .filter((run) => connectionIds.has(run.connectionId))
      .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
  }, [commandRuns, hostConnections]);
  const latestRun = runs.at(-1);
  const latestRunOutput = latestRun?.output;
  const latestRunStatus = latestRun?.status;
  const visibleRuns = useMemo(
    () => runs.filter((run) => !hiddenRunIds.has(run.runId)),
    [hiddenRunIds, runs],
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
    });
  }, [runs.length, latestRunOutput, latestRunStatus, visibleRuns.length]);

  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });

  const api = environmentId ? readEnvironmentApi(environmentId) : undefined;

  const connect = async () => {
    if (!api || !host) return;
    setBusy(true);
    setError(null);
    try {
      await api.remoteController.startConnection({ hostId: host.hostId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to start connection");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!api || !activeConnection) return;
    setBusy(true);
    setError(null);
    try {
      await api.remoteController.stopConnection({ connectionId: activeConnection.connectionId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to stop connection");
    } finally {
      setBusy(false);
    }
  };

  const focusCommandInput = () => {
    requestAnimationFrame(() => {
      commandInputRef.current?.focus();
    });
  };

  const sendCommand = async (value = command) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;

    const specialCommand = resolveRemoteHostSpecialCommand(trimmed);
    if (specialCommand) {
      switch (specialCommand.type) {
        case "clear-terminal":
          setHiddenRunIds(new Set(runs.map((run) => run.runId)));
          setTranscriptCleared(true);
          setError(null);
          setCommand("");
          focusCommandInput();
          return;
      }
    }

    if (!api || !activeConnection) return;
    setBusy(true);
    setError(null);
    setCommand((current) => (current.trim() === trimmed ? "" : current));
    focusCommandInput();
    try {
      await api.remoteController.sendCommand({
        connectionId: activeConnection.connectionId,
        command: trimmed,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send command");
    } finally {
      setBusy(false);
      focusCommandInput();
    }
  };

  if (!host) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <Terminal className="mb-3 size-10" />
        <div className="text-sm">Remote host not found</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div
        className={cn(
          "flex items-center justify-between border-b border-border px-4 py-2",
          reserveLeadingTitlebarInset && DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" />
            <div className="truncate font-mono text-sm font-medium">{host.label}</div>
            <Badge
              size="sm"
              variant={activeConnection ? "success" : "outline"}
              className="uppercase"
            >
              {activeConnection ? "connected" : "idle"}
            </Badge>
          </div>
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="truncate">
              {host.transport.command} {(host.transport.args ?? []).join(" ")}
            </span>
            {activeConnection ? (
              <>
                <span className="shrink-0 opacity-60">·</span>
                <span className="shrink-0 uppercase tracking-wide opacity-70">path</span>
                <span className="truncate text-foreground">{activeConnection.state.path}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeConnection ? (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void disconnect()}>
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void connect()}>
              <Plug className="size-3.5" />
              Start
            </Button>
          )}
        </div>
      </div>

      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-3 font-mono text-sm leading-6 text-foreground"
        data-remote-host-shell="true"
        onClick={() => commandInputRef.current?.focus()}
      >
        <div className="mx-auto max-w-6xl">
          {error ? (
            <div className="mb-3 border-l-2 border-destructive pl-3 text-destructive">{error}</div>
          ) : null}

          {visibleRuns.length === 0 && !transcriptCleared ? (
            <div className="text-muted-foreground">
              {activeConnection
                ? "Remote shell ready. Enter a command."
                : "Start the host to open a remote shell."}
            </div>
          ) : (
            visibleRuns.map((run) => <ShellTranscriptRun key={run.runId} run={run} />)
          )}

          <div className="flex items-start gap-2 py-2" data-remote-host-shell-prompt="true">
            <span className="shrink-0 text-primary">$</span>
            <textarea
              ref={commandInputRef}
              aria-label="Command input"
              className="min-h-6 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-foreground caret-primary outline-none placeholder:text-muted-foreground disabled:opacity-50"
              value={command}
              disabled={!activeConnection}
              rows={1}
              spellCheck={false}
              onChange={(event) => setCommand(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendCommand();
                }
              }}
            />
            {busy ? (
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
