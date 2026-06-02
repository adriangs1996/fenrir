import type { RemoteCommandRunSnapshot, RemoteConnectionSnapshot } from "@fenrir/contracts";
import { CheckCircle2, Loader2, Plug, Send, Square, Terminal, XCircle } from "lucide-react";
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
import { Textarea } from "../ui/textarea";
import { useSidebar } from "../ui/sidebar";
import { useRemoteControllerSync } from "./useRemoteControllerSync";

interface Props {
  hostId: string;
}

function runStatusVariant(status: RemoteCommandRunSnapshot["status"]) {
  switch (status) {
    case "succeeded":
      return "success" as const;
    case "failed":
      return "error" as const;
    case "running":
      return "secondary" as const;
  }
}

function RunStatusIcon({ status }: { status: RemoteCommandRunSnapshot["status"] }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="size-4 text-emerald-500" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  }
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

function CommandRunBlock({ run }: { run: RemoteCommandRunSnapshot }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <RunStatusIcon status={run.status} />
        <div className="min-w-0 flex-1 truncate font-mono text-sm">{run.command}</div>
        <Badge size="sm" variant={runStatusVariant(run.status)} className="uppercase">
          {run.status}
        </Badge>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-3 py-3 font-mono text-xs leading-6 text-zinc-100">
        {run.output || (run.status === "running" ? "Running..." : "No output")}
      </pre>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span>{run.runId}</span>
        <span>
          exit {run.exitCode === null ? "-" : run.exitCode}
          {run.signal ? ` / ${run.signal}` : ""}
        </span>
      </div>
    </section>
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
  const commandInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setSelectedHostId(hostId);
    return () => setSelectedHostId(null);
  }, [hostId, setSelectedHostId]);

  const hostConnections = useMemo(
    () => selectHostConnections(connections, hostId),
    [connections, hostId],
  );
  const activeConnection = latestConnectedConnection(hostConnections);
  const runs = useMemo(() => {
    const connectionIds = new Set(hostConnections.map((connection) => connection.connectionId));
    return Object.values(commandRuns)
      .filter((run) => connectionIds.has(run.connectionId))
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  }, [commandRuns, hostConnections]);

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
    if (!api || !activeConnection || !trimmed || busy) return;
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

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5">
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Start the host and send a command to create the first run.
            </div>
          ) : (
            runs.map((run) => <CommandRunBlock key={run.runId} run={run} />)
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-end gap-2 rounded-lg border border-border bg-background p-2">
          <div className="hidden items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground sm:flex">
            <span>{host.label}</span>
            <span className="max-w-40 truncate text-muted-foreground">
              {activeConnection?.state.path ?? "."}
            </span>
            <span className="text-primary">$</span>
          </div>
          <Textarea
            ref={commandInputRef}
            aria-label="Command input"
            className="min-h-10 flex-1 resize-none border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
            value={command}
            disabled={!activeConnection}
            onChange={(event) => setCommand(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendCommand();
              }
            }}
          />
          <Button
            size="icon"
            disabled={!activeConnection || busy || !command.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void sendCommand()}
            aria-label="Send command"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <div className="mx-auto mt-1 max-w-5xl text-xs text-muted-foreground">
          {activeConnection
            ? "Enter sends command. Shift+Enter adds a line."
            : "Start the host first."}
        </div>
      </div>
    </div>
  );
}
