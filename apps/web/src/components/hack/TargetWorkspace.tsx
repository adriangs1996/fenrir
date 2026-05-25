import { useEffect, useEffectEvent, useRef, useState } from "react";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import { readEnvironmentApi } from "../../environmentApi";
import { isElectron } from "../../env";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "../../lib/desktopTitleBar";
import { cn } from "../../lib/utils";
import { terminalHandlerStore } from "../../modules/reverse-shells/stores/terminalHandlerStore";
import { useRawTcpStore } from "../../rawTcpStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { useRawTcpSync } from "./useRawTcpSync";

interface Props {
  sessionId: string;
}

export function TargetWorkspace({ sessionId }: Props) {
  const environmentId = usePrimaryEnvironmentId();
  useRawTcpSync(environmentId);
  const { isMobile, open: sidebarOpen } = useSidebar();

  const session = useRawTcpStore((s) => s.sessions[sessionId]);
  const output = useRawTcpStore((s) => s.sessionOutput[sessionId] ?? "");
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const [upgradingPty, setUpgradingPty] = useState(false);
  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });

  const sendData = useEffectEvent((data: string) => {
    if (!session || !environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    void api.rawTcp
      .sessionWrite({
        sessionId: sessionId as never,
        data,
      })
      .catch((error) => {
        terminalHandlerStore
          .getState()
          .writeSystemMessage(error instanceof Error ? error.message : "Failed to send input");
      });
  });

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const terminalHandler = terminalHandlerStore.getState();
    terminalHandler.mount({
      container,
      onData: (data) => {
        sendData(data);
      },
    });

    const focusFrame = window.requestAnimationFrame(() => {
      terminalHandlerStore.getState().focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      terminalHandlerStore.getState().dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    terminalHandlerStore.getState().syncOutput(output);
  }, [output]);

  useEffect(() => {
    terminalHandlerStore.getState().setInputEnabled(Boolean(session));
  }, [session]);

  const closeSession = async () => {
    if (!session || !environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    try {
      await api.rawTcp.sessionClose({
        sessionId: sessionId as never,
      });
    } catch (error) {
      terminalHandlerStore
        .getState()
        .writeSystemMessage(error instanceof Error ? error.message : "Failed to close session");
    }
  };

  const upgradeSessionPty = async () => {
    if (!session || !environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    const viewport = terminalHandlerStore.getState().getViewport();
    const cols = Math.max(1, viewport?.cols ?? 80);
    const rows = Math.max(1, viewport?.rows ?? 24);

    setUpgradingPty(true);
    try {
      await api.rawTcp.sessionUpgradePty({
        sessionId: sessionId as never,
        cols,
        rows,
      });
      terminalHandlerStore.getState().writeSystemMessage("PTY upgrade command sent");
    } catch (error) {
      terminalHandlerStore
        .getState()
        .writeSystemMessage(error instanceof Error ? error.message : "Failed to upgrade PTY");
    } finally {
      setUpgradingPty(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "flex items-center justify-between border-b border-border px-3 py-2",
          reserveLeadingTitlebarInset && DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate font-mono text-sm">{sessionId}</div>
            {session ? (
              <Badge
                variant={session.terminalMode !== "raw" ? "secondary" : "outline"}
                size="sm"
                className="uppercase"
              >
                {session.terminalMode}
              </Badge>
            ) : null}
          </div>
          {session ? (
            <div className="text-xs text-muted-foreground">
              from {session.remoteAddress} · listener {session.listenerId}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">session disconnected</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={!session || upgradingPty}
            onClick={() => void upgradeSessionPty()}
          >
            {upgradingPty
              ? "Upgrading…"
              : session?.terminalMode !== "raw"
                ? "Re-run PTY"
                : "Upgrade PTY"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!session}
            onClick={() => void closeSession()}
          >
            Close
          </Button>
        </div>
      </div>
      <div
        data-xterm-theme-surface
        className="target-workspace-terminal min-h-0 flex-1 overflow-hidden bg-zinc-950 text-zinc-100"
      >
        <div ref={terminalContainerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
