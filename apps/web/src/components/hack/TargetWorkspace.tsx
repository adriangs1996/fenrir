import { useState } from "react";
import { useMetasploitStore } from "../../metasploitStore";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { TargetShellTab } from "./TargetShellTab";
import { TargetFilesTab } from "./TargetFilesTab";
import { TargetProcessesTab } from "./TargetProcessesTab";
import { TargetNetworkTab } from "./TargetNetworkTab";
import { TargetAgentInput } from "./TargetAgentInput";

type Tab = "shell" | "files" | "processes" | "network";

interface TargetWorkspaceProps {
  sessionId: string;
}

export function TargetWorkspace({ sessionId }: TargetWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>("shell");
  const session = useMetasploitStore((s) => s.sessions[sessionId]);

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
          <Badge variant={isMeterpreter ? "default" : "outline"}>
            {session.type}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {session.platform} · {session.info}
          </span>
        </div>
        {!isMeterpreter && (
          <Button variant="outline" size="sm">
            Upgrade to Meterpreter
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
