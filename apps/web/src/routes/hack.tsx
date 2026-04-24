import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import {
  useTrafficLensStore,
  useTrafficLensLifecycle,
  TrafficLensAddressBar,
  TrafficLensTabBar,
  TrafficLensViewContainer,
  TrafficLensTable,
} from "../modules/traffic-lens";

function HackRouteLayout() {
  const activeTabId = useTrafficLensStore((s) => s.activeTabId);

  useTrafficLensLifecycle();

  return (
    <div className="flex h-full flex-1 flex-col">
      {activeTabId ? (
        <div className="flex h-full flex-col">
          <TrafficLensTabBar />
          <TrafficLensAddressBar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TrafficLensViewContainer />
            <div className="h-64 border-t">
              <TrafficLensTable
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
