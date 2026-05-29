import { useEffect, useMemo, useRef, useState } from "react";

import { SidebarInset, SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "~/lib/desktopTitleBar";
import { cn } from "~/lib/utils";
import { useServerConfig, useServerKeybindings } from "~/rpc/serverState";
import { DEFAULT_THREAD_TERMINAL_ID } from "~/types";
import {
  GLOBAL_TERMINAL_THREAD_ID,
  GLOBAL_TERMINAL_TMUX_PROJECT_ID,
  globalTerminalThreadRef,
} from "../globalTerminal";
import { TerminalViewport } from "./ThreadTerminalDrawer";

export function GlobalTerminalRouteView() {
  const serverConfig = useServerConfig();
  const keybindings = useServerKeybindings();
  const environmentId = usePrimaryEnvironmentId();
  const { isMobile, open: sidebarOpen } = useSidebar();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const [terminalViewportHeight, setTerminalViewportHeight] = useState(0);
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });
  const threadRef = useMemo(
    () => (environmentId ? globalTerminalThreadRef(environmentId) : null),
    [environmentId],
  );
  const cwd = serverConfig?.homeDirectoryPath ?? serverConfig?.cwd ?? null;

  useEffect(() => {
    const element = terminalContainerRef.current;
    if (!element) {
      return;
    }

    const refreshViewport = () => {
      setTerminalViewportHeight(element.clientHeight);
      setResizeEpoch((value) => value + 1);
    };

    refreshViewport();
    const observer = new ResizeObserver(refreshViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Global Terminal</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {cwd ?? "Starting..."}
              </span>
            </div>
          </header>
        )}

        {isElectron && (
          <div
            className={cn(
              "drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border wco:h-[env(titlebar-area-height)]",
              reserveLeadingTitlebarInset
                ? cn("pr-5", DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME)
                : "px-5",
              DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
            )}
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Global Terminal
            </span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {cwd ?? "Starting..."}
            </span>
          </div>
        )}

        <div
          ref={terminalContainerRef}
          data-xterm-theme-surface
          className="min-h-0 flex-1 overflow-hidden bg-background p-1"
        >
          {threadRef && cwd ? (
            <TerminalViewport
              mode="tmux"
              threadRef={threadRef}
              threadId={GLOBAL_TERMINAL_THREAD_ID}
              terminalId={DEFAULT_THREAD_TERMINAL_ID}
              terminalLabel="Global Terminal"
              cwd={cwd}
              worktreePath={null}
              projectId={GLOBAL_TERMINAL_TMUX_PROJECT_ID}
              onSessionExited={() => undefined}
              focusRequestId={0}
              autoFocus
              resizeEpoch={resizeEpoch}
              drawerHeight={terminalViewportHeight}
              keybindings={keybindings}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading terminal...
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}
