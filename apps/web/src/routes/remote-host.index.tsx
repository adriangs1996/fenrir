import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plug, Server, Terminal } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { readEnvironmentApi } from "../environmentApi";
import { useRemoteControllerStore } from "../remoteControllerStore";
import { useRemoteControllerSync } from "../components/remote-host/useRemoteControllerSync";

function RemoteHostIndexRouteView() {
  const environmentId = usePrimaryEnvironmentId();
  useRemoteControllerSync(environmentId);
  const navigate = useNavigate();
  const hostsById = useRemoteControllerStore((state) => state.hosts);
  const hosts = useMemo(() => Object.values(hostsById), [hostsById]);
  const [creating, setCreating] = useState(false);

  const createLocalShell = async () => {
    if (!environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    setCreating(true);
    try {
      const host = await api.remoteController.createHost({
        label: "Local shell",
        transport: {
          type: "command-template",
          command: "sh",
          args: ["-lc", "{command}"],
        },
      });
      await navigate({ to: "/remote-host/$hostId", params: { hostId: host.hostId } });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-1 items-center justify-center bg-background text-muted-foreground">
      <div className="w-full max-w-md px-6 text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-lg border border-border bg-card">
          <Server className="size-7 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Remote hosts</h1>
        <p className="mt-2 text-sm leading-6">
          Manage command-template connections for SSH wrappers, exploit runners, and local shells.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button disabled={creating} onClick={() => void createLocalShell()}>
            <Plug className="size-4" />
            {creating ? "Creating" : "Create local shell"}
          </Button>
          {hosts[0] ? (
            <Button
              variant="outline"
              onClick={() =>
                void navigate({ to: "/remote-host/$hostId", params: { hostId: hosts[0]!.hostId } })
              }
            >
              <Terminal className="size-4" />
              Open first host
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/remote-host/")({
  component: RemoteHostIndexRouteView,
});
