import { useNavigate } from "@tanstack/react-router";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import { readEnvironmentApi } from "../../environmentApi";
import { useRawTcpStore } from "../../rawTcpStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CreateListenerDialog } from "./CreateListenerDialog";
import { useRawTcpSync } from "./useRawTcpSync";

export function HackSidebar() {
  const environmentId = usePrimaryEnvironmentId();
  useRawTcpSync(environmentId);

  const listeners = useRawTcpStore((s) => s.listeners);
  const sessions = useRawTcpStore((s) => s.sessions);
  const activeSessionId = useRawTcpStore((s) => s.activeSessionId);
  const navigate = useNavigate();

  const stopListener = async (listenerId: string) => {
    if (!environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    await api.rawTcp.stopListener({
      listenerId: listenerId as never,
    });
  };

  const listenerList = Object.values(listeners);
  const sessionList = Object.values(sessions);

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-medium">Hack</span>
        <CreateListenerDialog
          environmentId={environmentId}
          trigger={
            <Button size="xs" variant="outline">
              + Listener
            </Button>
          }
        />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Listeners ({listenerList.length})
          </h3>
          {listenerList.length === 0 ? (
            <p className="text-xs text-muted-foreground">No listeners</p>
          ) : (
            <ul className="space-y-1">
              {listenerList.map((l) => (
                <li
                  key={l.listenerId}
                  className="flex items-center justify-between rounded border border-border px-2 py-1"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.host}:{l.port}
                    </div>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => void stopListener(l.listenerId)}>
                    Stop
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Sessions ({sessionList.length})
          </h3>
          {sessionList.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active sessions</p>
          ) : (
            <ul className="space-y-1">
              {sessionList.map((s) => {
                const isActive = s.sessionId === activeSessionId;
                return (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      className={`block w-full rounded px-2 py-1 text-left ${
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      }`}
                      onClick={() =>
                        void navigate({
                          to: "/hack/$sessionId",
                          params: { sessionId: s.sessionId },
                        })
                      }
                    >
                      <div className="flex items-center gap-1.5">
                        <div className="truncate font-mono text-xs">{s.sessionId}</div>
                        <Badge
                          variant={s.terminalMode === "pty" ? "secondary" : "outline"}
                          size="sm"
                          className="shrink-0 uppercase"
                        >
                          {s.terminalMode}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{s.remoteAddress}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
