import { useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  GlobeIcon,
  MessageSquareTextIcon,
  ServerIcon,
  SettingsIcon,
  TerminalIcon,
} from "lucide-react";

import { GLOBAL_TERMINAL_ROUTE } from "../../modules/terminal";
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

export function SidebarRouteNavFooter() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isRemoteHostRoute = pathname.startsWith("/remote-host");
  const isBrowserLabRoute = pathname === "/browser-lab";
  const isGlobalTerminalRoute = pathname === GLOBAL_TERMINAL_ROUTE;
  const isSettingsRoute = pathname.startsWith("/settings");

  const handlePrimaryWorkspaceClick = useCallback(() => {
    void navigate({ to: isRemoteHostRoute ? "/" : "/remote-host" });
  }, [isRemoteHostRoute, navigate]);

  const handleBrowserLabClick = useCallback(() => {
    void navigate({ to: "/browser-lab" });
  }, [navigate]);

  const handleSettingsClick = useCallback(() => {
    void navigate({ to: "/settings" });
  }, [navigate]);

  const handleGlobalTerminalClick = useCallback(() => {
    void navigate({ to: GLOBAL_TERMINAL_ROUTE });
  }, [navigate]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={false}
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={handlePrimaryWorkspaceClick}
          >
            {isRemoteHostRoute ? (
              <MessageSquareTextIcon className="size-3.5" />
            ) : (
              <ServerIcon className="size-3.5" />
            )}
            <span className="text-xs">
              {isRemoteHostRoute ? "Agents Workspace" : "Remote Host"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={isBrowserLabRoute}
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={handleBrowserLabClick}
          >
            <GlobeIcon className="size-3.5" />
            <span className="text-xs">Browser Lab</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={isGlobalTerminalRoute}
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={handleGlobalTerminalClick}
          >
            <TerminalIcon className="size-3.5" />
            <span className="text-xs">Global Terminal</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={isSettingsRoute}
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={handleSettingsClick}
          >
            <SettingsIcon className="size-3.5" />
            <span className="text-xs">Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
