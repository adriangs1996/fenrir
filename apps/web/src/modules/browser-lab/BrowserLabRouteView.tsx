import * as Schema from "effect/Schema";
import { ChevronDownIcon, ChevronUpIcon, GlobeIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
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
  TrafficLensTabBar,
  TrafficLensTable,
  TrafficLensViewContainer,
  useTrafficLensLifecycle,
  useTrafficLensStore,
} from "~/modules/traffic-lens";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime/service";
import {
  toOverrideInput,
  toProfileInput,
  toRuleInput,
} from "~/modules/traffic-lens/workbenchModels";

const BROWSER_LAB_DEFAULT_URL = "https://example.com";
const BROWSER_LAB_DOCK_HEIGHT_KEY = "fenrir:browser-lab:dock-height";
const BROWSER_LAB_DOCK_COLLAPSED_KEY = "fenrir:browser-lab:dock-collapsed";
const MIN_DOCK_HEIGHT = 220;
const MIN_BROWSER_STAGE_HEIGHT = 220;

type BrowserLabBootstrapState = "booting" | "ready" | "error";

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
  const selectedProfileId = useTrafficLensStore((state) => state.selectedProfileId);
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
  const workbenchBodyRef = useRef<HTMLDivElement>(null);
  const [maxDockHeight, setMaxDockHeight] = useState<number>(1024);
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);
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
  }, [setDockCollapsed, setDockHeight]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_DOCK_HEIGHT_KEY, dockHeight, Schema.Number);
  }, [dockHeight]);

  useEffect(() => {
    setLocalStorageItem(BROWSER_LAB_DOCK_COLLAPSED_KEY, dockCollapsed, Schema.Boolean);
  }, [dockCollapsed]);

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

  const handleCreateTab = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setBootstrapState("error");
      setBootstrapError("Browser Lab requires the Electron desktop app.");
      return;
    }

    try {
      const snapshot = ensureTrafficLensTabSnapshot(
        selectedProfileId && selectedProfileId !== "default"
          ? await bridge.trafficLensCreateTabInProfile({
              profileId: selectedProfileId,
              url: BROWSER_LAB_DEFAULT_URL,
            })
          : await bridge.trafficLensCreateTab(BROWSER_LAB_DEFAULT_URL),
      );
      setActiveTab(snapshot.tabId);
      setBootstrapState("ready");
      setBootstrapError(null);
    } catch (error) {
      setBootstrapState("error");
      setBootstrapError(error instanceof Error ? error.message : "Could not create browser tab.");
    }
  }, [selectedProfileId, setActiveTab]);

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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Browser Lab</span>
              <span className="rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Workbench
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
              Browser Lab
            </span>
            <span className="rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Workbench
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {desktopBridgeAvailable && isMainWindow ? (
            <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
              <TrafficLensTabBar onCreateTab={() => void handleCreateTab()} />
              <TrafficLensAddressBar onOpenExternal={handleOpenExternal} />
              <div
                ref={workbenchBodyRef}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
              >
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
