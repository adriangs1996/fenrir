import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { useBrowserStore } from "../browserStore";
import { BrowserAddressBar } from "../components/browser/BrowserAddressBar";
import { BrowserTabBar } from "../components/browser/BrowserTabBar";
import { BrowserViewContainer } from "../components/browser/BrowserViewContainer";
import { TrafficTable } from "../components/browser/TrafficTable";
import { useBrowserSync } from "../components/browser/useBrowserSync";

function HackRouteLayout() {
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  useBrowserSync(rpcClient);

  // Subscribe to browser tab events from main process
  useEffect(() => {
    const unsubscribe = window.desktopBridge?.onBrowserTabEvent((event) => {
      useBrowserStore.getState().applyEvent(event as any);
    });
    return () => unsubscribe?.();
  }, []);

  // Restore tabs on mount
  useEffect(() => {
    const loadTabs = async () => {
      const tabs = await window.desktopBridge?.browserGetTabs();
      if (tabs) {
        for (const tab of tabs) {
          useBrowserStore.getState().upsertTab(tab);
        }
      }
    };
    void loadTabs();
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col">
      {activeTabId ? (
        <div className="flex h-full flex-col">
          <BrowserTabBar />
          <BrowserAddressBar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <BrowserViewContainer />
            <div className="h-64 border-t">
              <TrafficTable
                onSelectEntry={() => {
                  // Phase 3 will handle inspector
                }}
                selectedId={null}
              />
            </div>
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

export const Route = createFileRoute("/hack")({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    if (authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: HackRouteLayout,
});
