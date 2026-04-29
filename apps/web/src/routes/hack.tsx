import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { cn } from "../lib/utils";
import {
  useTrafficLensStore,
  useTrafficLensLifecycle,
  TrafficLensAddressBar,
  TrafficLensTabBar,
  TrafficLensViewContainer,
  TrafficLensTable,
  TrafficLensInspector,
  TrafficLensRepeater,
} from "../modules/traffic-lens";

function HackRouteLayout() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);
  const selectedTrafficId = useTrafficLensStore((s) => s.selectedTrafficId);
  const bottomTab = useTrafficLensStore((s) => s.bottomTab);
  const repeaterDetail = useTrafficLensStore((s) => s.repeaterDetail);

  useTrafficLensLifecycle();

  return (
    <div className="flex h-full flex-1 flex-col">
      {activeTabId ? (
        <div className="flex h-full flex-col">
          <TrafficLensTabBar />
          <TrafficLensAddressBar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TrafficLensViewContainer />
            <div className="flex h-80 flex-col border-t">
              {/* Tab bar */}
              <div className="flex items-center gap-1 border-b px-2 py-1 text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5",
                    bottomTab === "traffic"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => useTrafficLensStore.getState().setBottomTab("traffic")}
                >
                  Traffic
                </button>
                {selectedTrafficId !== null && (
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-0.5",
                      bottomTab === "inspector"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => useTrafficLensStore.getState().setBottomTab("inspector")}
                  >
                    Inspector
                  </button>
                )}
                {repeaterDetail && (
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-0.5",
                      bottomTab === "repeater"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => useTrafficLensStore.getState().setBottomTab("repeater")}
                  >
                    Repeater
                  </button>
                )}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {bottomTab === "traffic" && (
                  <TrafficLensTable
                    onSelectEntry={(entry) =>
                      useTrafficLensStore.getState().setSelectedTraffic(entry.id)
                    }
                    selectedId={selectedTrafficId}
                  />
                )}
                {bottomTab === "inspector" && selectedTrafficId !== null && (
                  <TrafficLensInspector
                    trafficId={selectedTrafficId}
                    onSendToRepeater={(detail) =>
                      useTrafficLensStore.getState().openRepeater(detail)
                    }
                  />
                )}
                {bottomTab === "repeater" && repeaterDetail && (
                  <TrafficLensRepeater
                    initialDetail={repeaterDetail}
                    onClose={() => useTrafficLensStore.getState().closeRepeater()}
                  />
                )}
              </div>
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
