import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useMetasploitStore } from "../../metasploitStore";
import { useTrafficLensStore, TrafficLensSidebarSection } from "../../modules/traffic-lens";
import { CreateListenerDialog } from "./CreateListenerDialog";
import { PayloadCommandsDialog } from "./PayloadCommandsDialog";
import { useMetasploitSync } from "./useMetasploitSync";
import { isElectron } from "../../env";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { toastManager } from "../ui/toast";
import type { ListenerSnapshot } from "@fenrir/contracts";

export function HackSidebar() {
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [payloadDialogListener, setPayloadDialogListener] = useState<ListenerSnapshot | null>(null);

  const rpcClient = useMemo(() => getPrimaryEnvironmentConnection().client, []);
  useMetasploitSync(rpcClient);
  const listeners = useMetasploitStore((s) => s.listeners);
  const sessions = useMetasploitStore((s) => s.sessions);
  const activeSessionId = useMetasploitStore((s) => s.activeSessionId);
  const connected = useMetasploitStore((s) => s.connected);
  const setActiveTab = useTrafficLensStore((state) => state.setActiveTab);

  return (
    <>
      <SidebarHeader
        className={
          isElectron
            ? "drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]"
            : "gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3"
        }
      >
        <span className="truncate text-sm font-medium tracking-tight text-foreground">
          Hack Mode
        </span>
      </SidebarHeader>
      <SidebarContent>
        <TrafficLensSidebarSection />
        <SidebarGroup>
          <div className="flex items-center justify-between px-2">
            <SidebarGroupLabel>Listeners</SidebarGroupLabel>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setCreateDialogOpen(true)}
            >
              +
            </Button>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {Object.values(listeners).map((listener) => (
                <SidebarMenuItem key={listener.listenerId}>
                  <SidebarMenuButton className="w-full">
                    <div className="flex w-full items-center justify-between">
                      <span className="truncate text-sm">{listener.name}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-xs"
                          title="Copy payload commands"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPayloadDialogListener(listener);
                          }}
                        >
                          &lt;/&gt;
                        </Button>
                        <Badge
                          variant={
                            listener.status === "waiting"
                              ? "outline"
                              : listener.status === "active"
                                ? "default"
                                : "secondary"
                          }
                          className="text-xs"
                        >
                          {listener.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {listener.lhost}:{listener.lport}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {Object.keys(listeners).length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No active listeners
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {Object.values(sessions).map((session) => (
                <SidebarMenuItem key={session.sessionId}>
                  <SidebarMenuButton
                    isActive={session.sessionId === activeSessionId}
                    onClick={() => {
                      setActiveTab(null);
                      void window.desktopBridge?.trafficLensHideAllTabs();
                      void navigate({
                        to: `/hack/${session.sessionId}` as string,
                      });
                    }}
                    className="w-full"
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="truncate text-sm">{session.targetHost}</span>
                      <Badge
                        variant={session.type === "meterpreter" ? "default" : "outline"}
                        className="ml-2 text-xs"
                      >
                        {session.type}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {session.platform} · {session.info}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {Object.keys(sessions).length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No active sessions
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          Metasploit {connected ? "Connected" : "Disconnected"}
        </div>
      </SidebarFooter>
      <CreateListenerDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateListener={(input) => {
          rpcClient.metasploit
            .createListener(input)
            .then((snapshot) => {
              toastManager.add({
                type: "success",
                title: "Listener created",
                description: `${snapshot.name} listening on ${snapshot.lhost}:${snapshot.lport}`,
              });
            })
            .catch((err) => {
              console.error("createListener failed:", err);
              toastManager.add({
                type: "error",
                title: "Failed to create listener",
                description: err instanceof Error ? err.message : String(err),
              });
            });
        }}
      />
      <PayloadCommandsDialog
        listener={payloadDialogListener}
        onOpenChange={(open) => {
          if (!open) setPayloadDialogListener(null);
        }}
      />
    </>
  );
}
