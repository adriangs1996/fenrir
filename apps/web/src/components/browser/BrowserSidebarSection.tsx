import { Globe, Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { useBrowserStore } from "../../browserStore";

export function BrowserSidebarSection() {
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);

  const handleNewTab = async () => {
    const snapshot = await window.desktopBridge?.browserCreateTab();
    if (snapshot) {
      setActiveTab(snapshot.tabId);
    }
  };

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between">
        <SidebarGroupLabel>Browser</SidebarGroupLabel>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => void handleNewTab()}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {Object.values(tabs).map((tab) => (
            <SidebarMenuItem key={tab.tabId}>
              <SidebarMenuButton
                isActive={tab.tabId === activeTabId}
                onClick={() => {
                  setActiveTab(tab.tabId);
                  void window.desktopBridge?.browserShowTab(tab.tabId);
                }}
              >
                <Globe className="h-4 w-4" />
                <span className="truncate">
                  {tab.title || tab.url || "New Tab"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {Object.keys(tabs).length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              No tabs open
            </div>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
