import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";

function HackRouteLayout() {
  return (
    <div className="flex h-full flex-1 flex-col">
      <Outlet />
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
