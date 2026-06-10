import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Server, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import { isElectron } from "../../env";
import { rpcErrorMessage, runEnvironmentRpc } from "../../hooks/useRpc";
import { useRemoteControllerStore } from "../../remoteControllerStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SidebarRouteNavFooter } from "../sidebar/SidebarRouteNavFooter";
import { SidebarHeader } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { RemoteFileTree } from "./RemoteFileTree";
import { useRemoteControllerSync } from "./useRemoteControllerSync";

const DEFAULT_ARGS_TEXT = "-lc\n{command}";

export function remoteHostSidebarHeaderClassName(input: { isElectron: boolean }): string {
  return input.isElectron
    ? "drag-region h-[52px] flex-row items-center gap-2 border-b border-border px-4 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)]"
    : "flex-row items-center justify-between border-b border-border px-3 py-2";
}

export function parseRemoteHostArgsText(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function RemoteHostSidebar() {
  const environmentId = usePrimaryEnvironmentId();
  useRemoteControllerSync(environmentId);

  const navigate = useNavigate();
  const hosts = useRemoteControllerStore((state) => state.hosts);
  const connections = useRemoteControllerStore((state) => state.connections);
  const selectedHostId = useRemoteControllerStore((state) => state.selectedHostId);
  const [label, setLabel] = useState("Local shell");
  const [command, setCommand] = useState("sh");
  const [argsText, setArgsText] = useState(DEFAULT_ARGS_TEXT);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostList = useMemo(
    () => Object.values(hosts).sort((left, right) => left.label.localeCompare(right.label)),
    [hosts],
  );

  const activeConnectionByHost = useMemo(() => {
    const result = new Map<string, number>();
    for (const connection of Object.values(connections)) {
      if (connection.hostId && connection.status === "connected") {
        result.set(connection.hostId, (result.get(connection.hostId) ?? 0) + 1);
      }
    }
    return result;
  }, [connections]);
  const selectedActiveConnection = useMemo(() => {
    if (!selectedHostId) return null;
    return (
      Object.values(connections).find(
        (connection) => connection.hostId === selectedHostId && connection.status === "connected",
      ) ?? null
    );
  }, [connections, selectedHostId]);

  const createHost = async () => {
    setCreating(true);
    setError(null);
    try {
      await runEnvironmentRpc(environmentId, async (api) => {
        const host = await api.remoteController.createHost({
          label,
          transport: {
            type: "command-template",
            command,
            args: parseRemoteHostArgsText(argsText),
          },
        });
        await navigate({ to: "/remote-host/$hostId", params: { hostId: host.hostId } });
      });
    } catch (cause) {
      setError(rpcErrorMessage(cause, "Failed to create host"));
    } finally {
      setCreating(false);
    }
  };

  const deleteHost = async (hostId: string) => {
    await runEnvironmentRpc(environmentId, async (api) => {
      await api.remoteController.deleteHost({ hostId: hostId as never });
      if (selectedHostId === hostId) {
        await navigate({ to: "/remote-host" });
      }
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <SidebarHeader className={remoteHostSidebarHeaderClassName({ isElectron })}>
        <Link to="/remote-host" className="inline-flex items-center gap-2 font-medium">
          <Server className="size-4 text-muted-foreground" />
          Remote Host
        </Link>
      </SidebarHeader>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <section className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Plus className="size-3.5" />
            New Host
          </div>
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="remote-host-label">
              Label
            </Label>
            <Input
              id="remote-host-label"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="remote-host-command">
              Runner
            </Label>
            <Input
              id="remote-host-command"
              value={command}
              onChange={(event) => setCommand(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="remote-host-args">
              Args
            </Label>
            <Textarea
              id="remote-host-args"
              className="min-h-20 font-mono text-xs"
              value={argsText}
              onChange={(event) => setArgsText(event.currentTarget.value)}
            />
          </div>
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
          <Button
            className="w-full"
            size="sm"
            disabled={creating}
            onClick={() => void createHost()}
          >
            <Plus className="size-4" />
            {creating ? "Creating" : "Create"}
          </Button>
        </section>

        <section className="mt-4">
          <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Hosts ({hostList.length})
          </h3>
          {hostList.length === 0 ? (
            <p className="text-xs text-muted-foreground">No remote hosts</p>
          ) : (
            <ul className="space-y-1">
              {hostList.map((host) => {
                const activeCount = activeConnectionByHost.get(host.hostId) ?? 0;
                const isActive = host.hostId === selectedHostId;
                return (
                  <li key={host.hostId}>
                    <div
                      className={`group flex items-center gap-1 rounded border border-border px-2 py-1 ${
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <Link
                        to="/remote-host/$hostId"
                        params={{ hostId: host.hostId }}
                        className="min-w-0 flex-1"
                      >
                        <div className="truncate font-medium">{host.label}</div>
                        <div className="truncate font-mono text-xs opacity-75">
                          {host.transport.command} {(host.transport.args ?? []).join(" ")}
                        </div>
                      </Link>
                      {activeCount > 0 ? (
                        <Badge size="sm" variant="success" className="shrink-0">
                          <Zap className="size-3" />
                          {activeCount}
                        </Badge>
                      ) : null}
                      <Button
                        aria-label={`Delete ${host.label}`}
                        size="icon-xs"
                        variant="ghost"
                        className="opacity-60 group-hover:opacity-100"
                        onClick={() => void deleteHost(host.hostId)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <RemoteFileTree
          environmentId={environmentId}
          connectionId={selectedActiveConnection?.connectionId ?? null}
          currentPath={selectedActiveConnection?.state.path ?? "."}
        />
      </div>
      <SidebarRouteNavFooter />
    </div>
  );
}
