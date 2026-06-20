import * as Schema from "effect/Schema";
import type { DiscoveredLocalServer, TrafficLensTabSnapshot } from "@fenrir/contracts";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SquareStackIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SidebarInset, SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { useDesktopBridgeAvailable, useIsMainWindow } from "~/hooks/useDesktopBridge";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "~/lib/desktopTitleBar";
import { cn } from "~/lib/utils";
import {
  FindingsPanel,
  InterceptPanel,
  OverridesPanel,
  ProfilePanel,
  StoragePanel,
  TrafficLensAddressBar,
  TrafficLensInspector,
  TrafficLensRepeater,
  TrafficLensTable,
  TrafficLensViewContainer,
  useTrafficLensLifecycle,
  useTrafficLensStore,
} from "~/modules/traffic-lens";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime/service";
import {
  subscribeToLocalServers,
  useLocalServersStore,
  type LocalServersEnvironmentState,
} from "~/localServersStore";
import {
  toOverrideInput,
  toProfileInput,
  toRuleInput,
} from "~/modules/traffic-lens/workbenchModels";
import { createBrowserLabTab } from "./openBrowserLabUrl";

const BROWSER_LAB_DEFAULT_URL = "https://example.com";
const BROWSER_LAB_DOCK_HEIGHT_KEY = "fenrir:browser-lab:dock-height";
const BROWSER_LAB_DOCK_COLLAPSED_KEY = "fenrir:browser-lab:dock-collapsed";
const BROWSER_LAB_RAIL_WIDTH_KEY = "fenrir:browser-lab:rail-width";
const BROWSER_LAB_RAIL_COLLAPSED_KEY = "fenrir:browser-lab:rail-collapsed";
const MIN_DOCK_HEIGHT = 220;
const MIN_BROWSER_STAGE_HEIGHT = 220;
const DEFAULT_RAIL_WIDTH = 320;
const MIN_RAIL_WIDTH = 248;
const MAX_RAIL_WIDTH = 520;
const COLLAPSED_RAIL_WIDTH = 52;

type BrowserLabBootstrapState = "booting" | "ready" | "error";
type BrowserLabRailSection = "servers" | "tabs";

function ensureTrafficLensTabSnapshot(snapshot: unknown): {
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
} {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    typeof (snapshot as { tabId?: unknown }).tabId !== "string"
  ) {
    throw new Error("Traffic Lens did not return a valid tab snapshot.");
  }

  return snapshot as { tabId: string; url: string; title: string; loading: boolean };
}

function clampDockHeight(height: number, maxHeight: number): number {
  const safeMaxHeight = Math.max(MIN_DOCK_HEIGHT, Math.round(maxHeight));
  return Math.max(MIN_DOCK_HEIGHT, Math.min(safeMaxHeight, Math.round(height)));
}

function clampRailWidth(width: number): number {
  return Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, Math.round(width)));
}

export function BrowserLabRouteView() {
  useTrafficLensLifecycle();

  const desktopBridgeAvailable = useDesktopBridgeAvailable();
  const isMainWindow = useIsMainWindow();
  const { isMobile, open: sidebarOpen } = useSidebar();
  const tabs = useTrafficLensStore((state) => state.tabs);
  const activeTabId = useTrafficLensStore((state) => state.activeTabId);
  const selectedTrafficId = useTrafficLensStore((state) => state.selectedTrafficId);
  const dockTab = useTrafficLensStore((state) => state.dockTab);
  const repeaterDetail = useTrafficLensStore((state) => state.repeaterDetail);
  const pausedCount = useTrafficLensStore((state) => Object.keys(state.pausedRequests).length);
  const findingCount = useTrafficLensStore((state) => state.findings.length);
  const dockHeight = useTrafficLensStore((state) => state.dockHeight);
  const dockCollapsed = useTrafficLensStore((state) => state.dockCollapsed);
  const setActiveTab = useTrafficLensStore((state) => state.setActiveTab);
  const setDockHeight = useTrafficLensStore((state) => state.setDockHeight);
  const setDockCollapsed = useTrafficLensStore((state) => state.setDockCollapsed);
  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });
  const [bootstrapState, setBootstrapState] = useState<BrowserLabBootstrapState>(() =>
    desktopBridgeAvailable && isMainWindow ? "booting" : "error",
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(() =>
    !desktopBridgeAvailable
      ? "Browser Lab requires the Electron desktop app."
      : !isMainWindow
        ? "Browser Lab is only available in the main desktop window."
        : null,
  );
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const railResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const railSearchInputRef = useRef<HTMLInputElement>(null);
  const workbenchBodyRef = useRef<HTMLDivElement>(null);
  const [maxDockHeight, setMaxDockHeight] = useState<number>(1024);
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL_WIDTH);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railSection, setRailSection] = useState<BrowserLabRailSection>("servers");
  const [railQuery, setRailQuery] = useState("");
  const primaryEnvironmentConnection = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection();
    } catch {
      return null;
    }
  }, []);
  const rpcClient = primaryEnvironmentConnection?.client ?? null;
  const localServersEnvironmentId = primaryEnvironmentConnection?.environmentId ?? null;
  const localServersState = useLocalServersStore((state) =>
    localServersEnvironmentId ? (state.byEnvironmentId[localServersEnvironmentId] ?? null) : null,
  );
  const tabList = useMemo(() => Object.values(tabs), [tabs]);

  useEffect(() => {
    const storedHeight = getLocalStorageItem(BROWSER_LAB_DOCK_HEIGHT_KEY, Schema.Number);
    if (storedHeight !== null) {
      setDockHeight(Math.max(MIN_DOCK_HEIGHT, Math.round(storedHeight)));
    }
    const storedCollapsed = getLocalStorageItem(BROWSER_LAB_DOCK_COLLAPSED_KEY, Schema.Boolean);
    if (storedCollapsed !== null) {
      setDockCollapsed(storedCollapsed);
    }
    const storedRailWidth = getLocalStorageItem(BROWSER_LAB_RAIL_WIDTH_KEY, Schema.Number);
    if (storedRailWidth !== null) {
      setRailWidth(clampRailWidth(storedRailWidth));
    }
    const storedRailCollapsed = getLocalStorageItem(BROWSER_LAB_RAIL_COLLAPSED_KEY, Schema.Boolean);
    if (storedRailCollapsed !== null) {
      setRailCollapsed(storedRailCollapsed);
    }
  }, [setDockCollapsed, setDockHeight]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_DOCK_HEIGHT_KEY, dockHeight, Schema.Number);
  }, [dockHeight]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_DOCK_COLLAPSED_KEY, dockCollapsed, Schema.Boolean);
  }, [dockCollapsed]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_RAIL_WIDTH_KEY, railWidth, Schema.Number);
  }, [railWidth]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_RAIL_COLLAPSED_KEY, railCollapsed, Schema.Boolean);
  }, [railCollapsed]);

  useEffect(() => {
    const element = workbenchBodyRef.current;
    if (!element) {
      return;
    }

    const updateMaxDockHeight = () => {
      const nextMaxDockHeight = Math.max(
        MIN_DOCK_HEIGHT,
        Math.round(element.clientHeight - MIN_BROWSER_STAGE_HEIGHT),
      );
      setMaxDockHeight(nextMaxDockHeight);

      const currentDockHeight = useTrafficLensStore.getState().dockHeight;
      const clampedDockHeight = clampDockHeight(currentDockHeight, nextMaxDockHeight);
      if (currentDockHeight !== clampedDockHeight) {
        useTrafficLensStore.getState().setDockHeight(clampedDockHeight);
      }
    };

    updateMaxDockHeight();

    const observer = new ResizeObserver(updateMaxDockHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!primaryEnvironmentConnection || !desktopBridgeAvailable || !isMainWindow) {
      return;
    }

    return subscribeToLocalServers({
      client: primaryEnvironmentConnection.client,
      environmentId: primaryEnvironmentConnection.environmentId,
    });
  }, [desktopBridgeAvailable, isMainWindow, primaryEnvironmentConnection]);

  const createBrowserTab = useCallback(
    async (url: string) => {
      const bridge = window.desktopBridge;
      if (!bridge) {
        setBootstrapState("error");
        setBootstrapError("Browser Lab requires the Electron desktop app.");
        return;
      }

      try {
        const snapshot = await createBrowserLabTab(url);
        setActiveTab(snapshot.tabId);
        setBootstrapState("ready");
        setBootstrapError(null);
      } catch (error) {
        setBootstrapState("error");
        setBootstrapError(error instanceof Error ? error.message : "Could not create browser tab.");
      }
    },
    [setActiveTab],
  );

  const handleCreateTab = useCallback(async () => {
    await createBrowserTab(BROWSER_LAB_DEFAULT_URL);
  }, [createBrowserTab]);

  const handleOpenLocalServer = useCallback(
    (server: DiscoveredLocalServer) => {
      void createBrowserTab(server.url);
    },
    [createBrowserTab],
  );

  const handleOpenExternal = useCallback(() => {
    if (!activeTabId) {
      return;
    }
    const activeTab = tabs[activeTabId];
    if (!activeTab?.url) {
      return;
    }
    void window.desktopBridge?.openExternal(activeTab.url);
  }, [activeTabId, tabs]);

  const handleSelectBrowserTab = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      void window.desktopBridge?.trafficLensShowTab(tabId);
    },
    [setActiveTab],
  );

  const handleCloseBrowserTab = useCallback((tabId: string) => {
    void window.desktopBridge?.trafficLensCloseTab(tabId);
  }, []);

  const focusRailSearch = useCallback(() => {
    setRailCollapsed(false);
    requestAnimationFrame(() => {
      railSearchInputRef.current?.focus();
      railSearchInputRef.current?.select();
    });
  }, []);

  const handleSelectRailSection = useCallback((section: BrowserLabRailSection) => {
    setRailSection(section);
    setRailCollapsed(false);
  }, []);

  useEffect(() => {
    if (!desktopBridgeAvailable) {
      setBootstrapState("error");
      setBootstrapError("Browser Lab requires the Electron desktop app.");
      return;
    }

    if (!isMainWindow) {
      setBootstrapState("error");
      setBootstrapError("Browser Lab is only available in the main desktop window.");
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const bridge = window.desktopBridge;
        if (!bridge) {
          throw new Error("Desktop bridge unavailable.");
        }

        const existingTabs = await bridge.trafficLensGetTabs();
        if (cancelled) {
          return;
        }

        if (existingTabs.length > 0) {
          const currentActiveTabId = useTrafficLensStore.getState().activeTabId;
          const nextActiveTabId =
            currentActiveTabId && existingTabs.some((tab) => tab.tabId === currentActiveTabId)
              ? currentActiveTabId
              : existingTabs[0]!.tabId;
          useTrafficLensStore.getState().setActiveTab(nextActiveTabId);
          setBootstrapState("ready");
          setBootstrapError(null);
          return;
        }

        const snapshot = ensureTrafficLensTabSnapshot(
          await bridge.trafficLensCreateTab(BROWSER_LAB_DEFAULT_URL),
        );
        if (cancelled) {
          return;
        }

        useTrafficLensStore.getState().setActiveTab(snapshot.tabId);
        setBootstrapState("ready");
        setBootstrapError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBootstrapState("error");
        setBootstrapError(
          error instanceof Error ? error.message : "Could not initialize the embedded browser.",
        );
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [desktopBridgeAvailable, isMainWindow]);

  useEffect(() => {
    if (!desktopBridgeAvailable || activeTabId !== null || tabList.length === 0) {
      return;
    }
    setActiveTab(tabList[0]!.tabId);
  }, [activeTabId, desktopBridgeAvailable, setActiveTab, tabList]);

  useEffect(() => {
    if (!rpcClient || !desktopBridgeAvailable || !isMainWindow || !window.desktopBridge) {
      return;
    }

    let cancelled = false;

    const syncWorkbenchMetadata = async () => {
      try {
        const bridge = window.desktopBridge!;
        const [profiles, rules, overrides, findings] = await Promise.all([
          rpcClient.trafficLens.listProfiles(),
          rpcClient.trafficLens.listRules(),
          rpcClient.trafficLens.listOverrides(),
          rpcClient.trafficLens.listFindings({ limit: 200 }),
        ]);

        if (cancelled) {
          return;
        }

        useTrafficLensStore.getState().setProfiles(profiles);
        useTrafficLensStore.getState().setRules(rules);
        useTrafficLensStore.getState().setOverrides(overrides);
        useTrafficLensStore.getState().setFindings(findings);

        const [runtimeProfiles, runtimeRules, runtimeOverrides] = await Promise.all([
          bridge.trafficLensListProfiles(),
          bridge.trafficLensListRules(),
          bridge.trafficLensListOverrides(),
        ]);

        const runtimeProfilesById = new Map(
          runtimeProfiles.map((profile) => [profile.id, profile]),
        );
        for (const profile of profiles) {
          if (!runtimeProfilesById.has(profile.id)) {
            await bridge.trafficLensCreateProfile({
              ...toProfileInput(profile),
              id: profile.id,
            } as any);
            continue;
          }
          await bridge.trafficLensUpdateProfile(profile.id, toProfileInput(profile));
        }
        for (const runtimeProfile of runtimeProfiles) {
          if (runtimeProfile.id === "default") {
            continue;
          }
          if (!profiles.some((profile) => profile.id === runtimeProfile.id)) {
            await bridge.trafficLensDeleteProfile(runtimeProfile.id);
          }
        }

        const runtimeRulesById = new Map(runtimeRules.map((rule) => [rule.id, rule]));
        for (const rule of rules) {
          if (!runtimeRulesById.has(rule.id)) {
            await bridge.trafficLensCreateRule({ ...toRuleInput(rule), id: rule.id } as any);
            continue;
          }
          await bridge.trafficLensUpdateRule(rule.id, toRuleInput(rule));
        }
        for (const runtimeRule of runtimeRules) {
          if (!rules.some((rule) => rule.id === runtimeRule.id)) {
            await bridge.trafficLensDeleteRule(runtimeRule.id);
          }
        }

        const runtimeOverridesById = new Map(
          runtimeOverrides.map((override) => [override.id, override]),
        );
        for (const override of overrides) {
          if (!runtimeOverridesById.has(override.id)) {
            await bridge.trafficLensCreateOverride({
              ...toOverrideInput(override),
              id: override.id,
            } as any);
            continue;
          }
          await bridge.trafficLensUpdateOverride(override.id, toOverrideInput(override));
        }
        for (const runtimeOverride of runtimeOverrides) {
          if (!overrides.some((override) => override.id === runtimeOverride.id)) {
            await bridge.trafficLensDeleteOverride(runtimeOverride.id);
          }
        }
      } catch (error) {
        console.error("[browser-lab] Failed to sync workbench metadata:", error);
      }
    };

    void syncWorkbenchMetadata();
    return () => {
      cancelled = true;
    };
  }, [desktopBridgeAvailable, isMainWindow, rpcClient]);

  useEffect(() => {
    if (!rpcClient || !activeTabId) {
      useTrafficLensStore.setState({ trafficEntries: [], selectedTrafficId: null });
      return;
    }
    let cancelled = false;
    useTrafficLensStore.setState((state) => {
      const nextEntries = state.trafficEntries.filter((entry) => entry.tabId === activeTabId);
      return {
        trafficEntries: nextEntries,
        selectedTrafficId:
          state.selectedTrafficId !== null &&
          nextEntries.some((entry) => entry.id === state.selectedTrafficId)
            ? state.selectedTrafficId
            : null,
      };
    });
    const loadTraffic = async () => {
      try {
        const entries = await rpcClient.trafficLens.getTraffic({ tabId: activeTabId, limit: 200 });
        if (!cancelled) {
          useTrafficLensStore.getState().hydrateTraffic(activeTabId, entries);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[browser-lab] Failed to hydrate traffic entries:", error);
        }
      }
    };
    void loadTraffic();
    return () => {
      cancelled = true;
    };
  }, [activeTabId, rpcClient]);

  useEffect(() => {
    if (!desktopBridgeAvailable || !isMainWindow) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const primaryModifier = event.metaKey || event.ctrlKey;
      if (!primaryModifier || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const code = event.code;

      if (key === "b" && event.shiftKey) {
        event.preventDefault();
        setRailCollapsed((collapsed) => !collapsed);
        return;
      }

      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        focusRailSearch();
        return;
      }

      if ((key === "1" || code === "Digit1") && event.shiftKey) {
        event.preventDefault();
        handleSelectRailSection("servers");
        return;
      }

      if ((key === "2" || code === "Digit2") && event.shiftKey) {
        event.preventDefault();
        handleSelectRailSection("tabs");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopBridgeAvailable, focusRailSearch, handleSelectRailSection, isMainWindow]);

  const startDockResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: dockHeight,
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      const nextHeight = clampDockHeight(
        resizeState.startHeight - (moveEvent.clientY - resizeState.startY),
        maxDockHeight,
      );
      useTrafficLensStore.getState().setDockHeight(nextHeight);
    };
    const handlePointerUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const startRailResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    railResizeStateRef.current = {
      startX: event.clientX,
      startWidth: railWidth,
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeState = railResizeStateRef.current;
      if (!resizeState) {
        return;
      }
      setRailWidth(clampRailWidth(resizeState.startWidth + moveEvent.clientX - resizeState.startX));
    };
    const handlePointerUp = () => {
      railResizeStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const localServerCount = localServersState?.snapshot?.servers.length ?? 0;
  const browserLabChrome = (
    <div className="flex min-w-0 shrink-0 items-center gap-2 pr-2">
      {!isElectron ? <SidebarTrigger className="size-7 shrink-0 md:hidden" /> : null}
      <span className="text-xs font-medium tracking-wide text-muted-foreground/75">
        Browser Lab
      </span>
      <span className="rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Workbench
      </span>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <TrafficLensAddressBar
          className={
            isElectron
              ? cn(
                  "drag-region h-[52px] shrink-0 gap-2 border-border bg-background/95 wco:h-[env(titlebar-area-height)]",
                  reserveLeadingTitlebarInset
                    ? cn("pr-5", DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME)
                    : "px-5",
                  DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
                )
              : "h-12 shrink-0 border-border bg-background/95 px-3 sm:px-5"
          }
          leadingContent={browserLabChrome}
          onOpenExternal={handleOpenExternal}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {desktopBridgeAvailable && isMainWindow ? (
            <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
              <div
                ref={workbenchBodyRef}
                className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
              >
                <BrowserLabRail
                  activeSection={railSection}
                  activeTabId={activeTabId}
                  collapsed={railCollapsed}
                  localServerCount={localServerCount}
                  query={railQuery}
                  searchInputRef={railSearchInputRef}
                  state={localServersState}
                  tabs={tabList}
                  width={railWidth}
                  onClearQuery={() => setRailQuery("")}
                  onCloseTab={handleCloseBrowserTab}
                  onCollapse={() => setRailCollapsed(true)}
                  onCreateTab={() => void handleCreateTab()}
                  onExpand={() => setRailCollapsed(false)}
                  onFocusSearch={focusRailSearch}
                  onOpenServer={handleOpenLocalServer}
                  onQueryChange={setRailQuery}
                  onResizeStart={startRailResize}
                  onSectionChange={handleSelectRailSection}
                  onSelectTab={handleSelectBrowserTab}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
                  <div className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
                    {bootstrapState === "error" ? (
                      <BrowserLabStateCard
                        actionLabel="Try Again"
                        description={
                          bootstrapError ?? "The embedded browser could not be initialized."
                        }
                        onAction={() => void handleCreateTab()}
                        title="Embedded browser unavailable"
                      />
                    ) : bootstrapState === "booting" ? (
                      <BrowserLabStateCard
                        description="Initializing the Electron browser surface and restoring any existing tabs."
                        title="Starting browser lab"
                      />
                    ) : activeTabId === null ? (
                      <BrowserLabStateCard
                        actionLabel="Open First Tab"
                        description="No embedded tab is active right now."
                        onAction={() => void handleCreateTab()}
                        title="No active browser tab"
                      />
                    ) : (
                      <TrafficLensViewContainer />
                    )}
                  </div>
                  <TrafficLensWorkbenchDock
                    dockTab={dockTab}
                    dockHeight={dockHeight}
                    dockCollapsed={dockCollapsed}
                    findingCount={findingCount}
                    pausedCount={pausedCount}
                    repeaterDetail={repeaterDetail}
                    repeaterOpen={Boolean(repeaterDetail)}
                    selectedTrafficId={selectedTrafficId}
                    onResizeStart={startDockResize}
                  />
                </div>
              </div>
            </section>
          ) : (
            <BrowserLabStateCard
              description={
                desktopBridgeAvailable
                  ? "Open Browser Lab from Fenrir's main desktop window. Secondary windows cannot host the embedded WebContentsView."
                  : "Open Fenrir in the Electron desktop app to use the embedded browser. The web renderer cannot host a WebContentsView."
              }
              title={desktopBridgeAvailable ? "Main-window only feature" : "Desktop-only feature"}
            />
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function localServerLabel(server: DiscoveredLocalServer): string {
  if (server.terminal) {
    return server.terminal.terminalId === "default"
      ? "Terminal"
      : `Terminal ${server.terminal.terminalId}`;
  }
  if (server.processName) {
    return server.pid ? `${server.processName} pid ${server.pid}` : server.processName;
  }
  return `Port ${server.port}`;
}

function localServerDetail(server: DiscoveredLocalServer): string {
  if (server.terminal) {
    return `${server.url} - ${server.processName ?? `pid ${server.pid ?? "unknown"}`}`;
  }
  return server.url;
}

function localServerFilterText(server: DiscoveredLocalServer): string {
  return [
    localServerLabel(server),
    localServerDetail(server),
    server.url,
    server.host,
    server.port,
    server.processName,
    server.pid,
  ]
    .filter((part) => part !== null && part !== undefined)
    .join(" ")
    .toLowerCase();
}

function browserTabLabel(tab: TrafficLensTabSnapshot): string {
  return tab.title || tab.url || "New Tab";
}

function browserTabDetail(tab: TrafficLensTabSnapshot): string {
  const url = tab.url || "about:blank";
  const profileName = tab.profileName ? ` - ${tab.profileName}` : "";
  return `${url}${profileName}`;
}

function browserTabFilterText(tab: TrafficLensTabSnapshot): string {
  return [
    browserTabLabel(tab),
    browserTabDetail(tab),
    tab.url,
    tab.profileName,
    tab.profileId,
    tab.viewMode,
    tab.mobilePreset,
  ]
    .filter((part) => part !== null && part !== undefined)
    .join(" ")
    .toLowerCase();
}

function BrowserLabRail(props: {
  activeSection: BrowserLabRailSection;
  activeTabId: string | null;
  collapsed: boolean;
  localServerCount: number;
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  state: LocalServersEnvironmentState | null;
  tabs: readonly TrafficLensTabSnapshot[];
  width: number;
  onClearQuery: () => void;
  onCloseTab: (tabId: string) => void;
  onCollapse: () => void;
  onCreateTab: () => void;
  onExpand: () => void;
  onFocusSearch: () => void;
  onOpenServer: (server: DiscoveredLocalServer) => void;
  onQueryChange: (query: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSectionChange: (section: BrowserLabRailSection) => void;
  onSelectTab: (tabId: string) => void;
}) {
  const servers = props.state?.snapshot?.servers ?? [];
  const query = props.query.trim().toLowerCase();
  const filteredServers = query
    ? servers.filter((server) => localServerFilterText(server).includes(query))
    : servers;
  const filteredTabs = query
    ? props.tabs.filter((tab) => browserTabFilterText(tab).includes(query))
    : props.tabs;
  const serversStatus =
    props.state === null || props.state.status === "idle"
      ? "Idle"
      : props.state.status === "connecting"
        ? "Scanning"
        : props.state.status === "error"
          ? "Unavailable"
          : `${props.localServerCount}`;
  const railTitle = props.activeSection === "servers" ? "Servidores" : "Tabs abiertas";
  const visibleWidth = props.collapsed ? COLLAPSED_RAIL_WIDTH : props.width;

  return (
    <aside
      aria-label="Browser Lab navigation"
      className={cn(
        "relative z-10 flex h-full min-h-0 shrink-0 border-r border-border/70 bg-muted/15",
        props.collapsed ? "items-stretch justify-center" : "flex-col",
      )}
      style={{ width: visibleWidth }}
    >
      {props.collapsed ? (
        <div className="flex h-full w-full flex-col items-center gap-2 px-2 py-3">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Expand Browser Lab rail"
            title="Expand Browser Lab rail"
            onClick={props.onExpand}
          >
            <PanelLeftOpenIcon className="size-4" />
          </Button>
          <RailCollapsedButton
            active={props.activeSection === "servers"}
            count={props.localServerCount}
            label="Servidores"
            onClick={() => {
              props.onSectionChange("servers");
              props.onExpand();
            }}
          >
            <ServerIcon className="size-4" />
          </RailCollapsedButton>
          <RailCollapsedButton
            active={props.activeSection === "tabs"}
            count={props.tabs.length}
            label="Tabs abiertas"
            onClick={() => {
              props.onSectionChange("tabs");
              props.onExpand();
            }}
          >
            <SquareStackIcon className="size-4" />
          </RailCollapsedButton>
        </div>
      ) : (
        <>
          <div className="flex min-h-12 items-center justify-between border-b border-border/70 px-3">
            <div className="flex min-w-0 items-center gap-2">
              {props.activeSection === "servers" ? (
                <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <SquareStackIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate text-sm font-medium text-foreground">{railTitle}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Focus rail search"
                title="Focus rail search"
                onClick={props.onFocusSearch}
              >
                <SearchIcon className="size-4" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Collapse Browser Lab rail"
                title="Collapse Browser Lab rail"
                onClick={props.onCollapse}
              >
                <PanelLeftCloseIcon className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 border-b border-border/50 p-2">
            <RailSectionButton
              active={props.activeSection === "servers"}
              count={props.localServerCount}
              onClick={() => props.onSectionChange("servers")}
            >
              Servidores
            </RailSectionButton>
            <RailSectionButton
              active={props.activeSection === "tabs"}
              count={props.tabs.length}
              onClick={() => props.onSectionChange("tabs")}
            >
              Tabs abiertas
            </RailSectionButton>
          </div>

          <div className="border-b border-border/50 p-2">
            <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 px-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                ref={props.searchInputRef}
                nativeInput
                type="search"
                value={props.query}
                placeholder="Buscar"
                unstyled
                className="h-8 flex-1 border-0 bg-transparent px-1 text-xs shadow-none"
                onChange={(event) => props.onQueryChange(event.target.value)}
              />
              {props.query ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Clear rail search"
                  title="Clear rail search"
                  onClick={props.onClearQuery}
                >
                  <XIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {props.activeSection === "servers" ? (
              <BrowserLabServerList
                filteredServers={filteredServers}
                servers={servers}
                state={props.state}
                statusLabel={serversStatus}
                onOpenServer={props.onOpenServer}
              />
            ) : (
              <BrowserLabTabList
                activeTabId={props.activeTabId}
                filteredTabs={filteredTabs}
                tabs={props.tabs}
                onCloseTab={props.onCloseTab}
                onCreateTab={props.onCreateTab}
                onSelectTab={props.onSelectTab}
              />
            )}
          </div>

          <button
            type="button"
            aria-label="Resize Browser Lab rail"
            className="absolute top-0 right-[-4px] h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-border/30 focus-visible:bg-border/40 focus-visible:outline-none"
            onPointerDown={props.onResizeStart}
          />
        </>
      )}
    </aside>
  );
}

function BrowserLabServerList(props: {
  filteredServers: readonly DiscoveredLocalServer[];
  servers: readonly DiscoveredLocalServer[];
  state: LocalServersEnvironmentState | null;
  statusLabel: string;
  onOpenServer: (server: DiscoveredLocalServer) => void;
}) {
  if (props.state === null || props.state.status === "idle") {
    return <RailEmptyState title="Local server scan unavailable" />;
  }

  if (props.state.status === "error") {
    return <RailEmptyState title={props.state.error ?? "Scanner unavailable"} />;
  }

  if (props.servers.length === 0) {
    return (
      <RailEmptyState
        title={
          props.state.status === "connecting" ? "Scanning local listeners" : "No local servers"
        }
      />
    );
  }

  if (props.filteredServers.length === 0) {
    return <RailEmptyState title="No matching servers" />;
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-medium text-muted-foreground">
        <span>Locales</span>
        <span>{props.statusLabel}</span>
      </div>
      {props.filteredServers.map((server) => (
        <button
          key={`${server.host}:${server.port}`}
          type="button"
          title={`Open ${server.url}`}
          aria-label={`Open ${server.url}`}
          className="group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/70 hover:bg-accent/45 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => props.onOpenServer(server)}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
            <span className="size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-foreground">
              {localServerLabel(server)}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {localServerDetail(server)}
            </span>
          </span>
          <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        </button>
      ))}
    </div>
  );
}

function BrowserLabTabList(props: {
  activeTabId: string | null;
  filteredTabs: readonly TrafficLensTabSnapshot[];
  tabs: readonly TrafficLensTabSnapshot[];
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
  onSelectTab: (tabId: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-medium text-muted-foreground">
        <span>Sesion actual</span>
        <span>{props.tabs.length}</span>
      </div>
      <button
        type="button"
        className="mb-1 flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-border/70 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/45 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onCreateTab}
      >
        <PlusIcon className="size-4" />
        New tab
      </button>
      {props.tabs.length === 0 ? (
        <RailEmptyState title="No open tabs" />
      ) : props.filteredTabs.length === 0 ? (
        <RailEmptyState title="No matching tabs" />
      ) : (
        props.filteredTabs.map((tab) => (
          <div
            key={tab.tabId}
            className={cn(
              "group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
              tab.tabId === props.activeTabId
                ? "border-primary/35 bg-primary/8"
                : "border-transparent hover:border-border/70 hover:bg-accent/45",
            )}
          >
            <button
              type="button"
              className="contents text-left"
              onClick={() => props.onSelectTab(tab.tabId)}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-sm",
                  tab.tabId === props.activeTabId
                    ? "bg-primary"
                    : tab.loading
                      ? "animate-pulse bg-blue-500"
                      : "bg-muted-foreground/50",
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">
                  {browserTabLabel(tab)}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {browserTabDetail(tab)}
                </span>
              </span>
            </button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Close ${browserTabLabel(tab)}`}
              onClick={() => props.onCloseTab(tab.tabId)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function RailSectionButton(props: {
  active: boolean;
  children: ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/45 hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      <span className="truncate">{props.children}</span>
      <span className="rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {props.count}
      </span>
    </button>
  );
}

function RailCollapsedButton(props: {
  active: boolean;
  children: ReactNode;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border/50 bg-background/50 text-muted-foreground hover:bg-accent/45 hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      {props.children}
      {props.count > 0 ? (
        <span className="absolute -top-1 -right-1 flex min-w-4 justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
          {props.count > 99 ? "99+" : props.count}
        </span>
      ) : null}
    </button>
  );
}

function RailEmptyState(props: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
      {props.title}
    </div>
  );
}

function TrafficLensWorkbenchDock(props: {
  dockTab: ReturnType<typeof useTrafficLensStore.getState>["dockTab"];
  dockHeight: number;
  dockCollapsed: boolean;
  pausedCount: number;
  findingCount: number;
  selectedTrafficId: number | null;
  repeaterDetail: ReturnType<typeof useTrafficLensStore.getState>["repeaterDetail"];
  repeaterOpen: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const setDockTab = useTrafficLensStore((state) => state.setDockTab);
  const setDockCollapsed = useTrafficLensStore((state) => state.setDockCollapsed);

  return (
    <div
      className="relative z-20 shrink-0 border-t border-border bg-background/95 shadow-[0_-18px_48px_rgba(0,0,0,0.24)] backdrop-blur-sm"
      style={{ height: props.dockCollapsed ? 44 : props.dockHeight }}
    >
      <button
        type="button"
        aria-label="Resize browser workbench dock"
        className="flex h-2 w-full cursor-row-resize items-center justify-center hover:bg-muted/40"
        onPointerDown={props.onResizeStart}
      >
        <span className="h-px w-12 rounded-full bg-border" />
      </button>
      <div className="flex h-[calc(100%-0.5rem)] min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1">
          <DockTabButton active={props.dockTab === "traffic"} onClick={() => setDockTab("traffic")}>
            Traffic
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "inspector"}
            disabled={props.selectedTrafficId === null}
            onClick={() => setDockTab("inspector")}
          >
            Inspector
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "repeater"}
            disabled={!props.repeaterOpen}
            onClick={() => setDockTab("repeater")}
          >
            Repeater
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "intercept"}
            onClick={() => setDockTab("intercept")}
          >
            Intercept {props.pausedCount > 0 ? `(${props.pausedCount})` : ""}
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "overrides"}
            onClick={() => setDockTab("overrides")}
          >
            Overrides
          </DockTabButton>
          <DockTabButton active={props.dockTab === "storage"} onClick={() => setDockTab("storage")}>
            Storage
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "profiles"}
            onClick={() => setDockTab("profiles")}
          >
            Profiles
          </DockTabButton>
          <DockTabButton
            active={props.dockTab === "findings"}
            onClick={() => setDockTab("findings")}
          >
            Findings {props.findingCount > 0 ? `(${props.findingCount})` : ""}
          </DockTabButton>
          <div className="ml-auto">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setDockCollapsed(!props.dockCollapsed)}
            >
              {props.dockCollapsed ? (
                <ChevronUpIcon className="h-4 w-4" />
              ) : (
                <ChevronDownIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {!props.dockCollapsed ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            {props.dockTab === "traffic" ? (
              <TrafficLensTable
                onSelectEntry={(entry) =>
                  useTrafficLensStore.getState().setSelectedTraffic(entry.id)
                }
                selectedId={props.selectedTrafficId}
              />
            ) : null}
            {props.dockTab === "inspector" && props.selectedTrafficId !== null ? (
              <TrafficLensInspector
                trafficId={props.selectedTrafficId}
                onSendToRepeater={(detail) => useTrafficLensStore.getState().openRepeater(detail)}
              />
            ) : null}
            {props.dockTab === "repeater" && props.repeaterOpen ? (
              <TrafficLensRepeater
                {...(props.repeaterDetail ? { initialDetail: props.repeaterDetail } : {})}
                onClose={() => useTrafficLensStore.getState().closeRepeater()}
              />
            ) : null}
            {props.dockTab === "intercept" ? <InterceptPanel /> : null}
            {props.dockTab === "overrides" ? <OverridesPanel /> : null}
            {props.dockTab === "storage" ? <StoragePanel /> : null}
            {props.dockTab === "profiles" ? <ProfilePanel /> : null}
            {props.dockTab === "findings" ? <FindingsPanel /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DockTabButton(props: {
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2 py-1 text-xs transition-colors",
        props.active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground",
        props.disabled && "pointer-events-none opacity-40",
      )}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function BrowserLabStateCard(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card/60 p-6 text-center">
        <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background/80">
          <GlobeIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{props.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{props.description}</p>
        {props.actionLabel && props.onAction ? (
          <Button className="mt-4" onClick={props.onAction}>
            {props.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
