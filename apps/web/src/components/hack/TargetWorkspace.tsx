import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMetasploitStore } from "../../metasploitStore";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { TargetShellTab } from "./TargetShellTab";
import { TargetFilesTab } from "./TargetFilesTab";
import { TargetProcessesTab } from "./TargetProcessesTab";
import { TargetNetworkTab } from "./TargetNetworkTab";
import { TargetAgentInput } from "./TargetAgentInput";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";

type Tab = "shell" | "files" | "processes" | "network";

interface TargetWorkspaceProps {
  sessionId: string;
}

export function TargetWorkspace({ sessionId }: TargetWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>("shell");
  const session = useMetasploitStore((s) => s.sessions[sessionId]);
  const consumeUpgradeRedirect = useMetasploitStore((s) => s.consumeUpgradeRedirect);
  const rpcClient = useMemo(() => getPrimaryEnvironmentConnection().client, []);
  const navigate = useNavigate();
  const [upgrading, setUpgrading] = useState(false);

  // Auto-navigate to upgraded session when this session disappears due to upgrade.
  useEffect(() => {
    if (session) return; // Session still exists — nothing to redirect.
    const newSessionId = consumeUpgradeRedirect(sessionId);
    if (newSessionId) {
      void navigate({ to: `/hack/${newSessionId}` as string });
    }
  }, [session, sessionId, consumeUpgradeRedirect, navigate]);

  const canUpgrade = session?.type === "shell" && session?.listenerId != null;

  const handleUpgrade = useCallback(async () => {
    if (!canUpgrade) return;
    setUpgrading(true);
    try {
      await rpcClient.metasploit.sessionUpgrade({ sessionId });
      // Success: store updates via session.closed + session.upgraded events.
      // Component will re-render with new sessionId or unmount if active changed.
      // Don't reset `upgrading` on success — re-mount handles it.
    } catch (err) {
      console.warn(`[upgrade] failed for ${sessionId}:`, err);
      setUpgrading(false);
    }
  }, [rpcClient, sessionId, canUpgrade]);

  if (!session) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        Session not found
      </div>
    );
  }

  const isMeterpreter = session.type === "meterpreter";

  return (
    <div className="flex h-full flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-medium">{session.targetHost}</span>
          <Badge variant={isMeterpreter ? "default" : "outline"}>{session.type}</Badge>
          <span className="text-sm text-muted-foreground">
            {session.platform} · {session.info}
          </span>
        </div>
        {!isMeterpreter && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpgrade}
            disabled={upgrading || !canUpgrade}
            title={
              !canUpgrade ? "Cannot upgrade: orphan session has no associated listener." : undefined
            }
          >
            {upgrading ? "Upgrading…" : "Upgrade to Meterpreter"}
          </Button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {(["shell", "files", "processes", "network"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "shell" && <TargetShellTab sessionId={sessionId} />}
        {activeTab === "files" && <TargetFilesTab sessionType={session.type} />}
        {activeTab === "processes" && <TargetProcessesTab sessionType={session.type} />}
        {activeTab === "network" && <TargetNetworkTab sessionType={session.type} />}
      </div>

      {/* Docked Agent Input */}
      <TargetAgentInput sessionId={sessionId} />
    </div>
  );
}
