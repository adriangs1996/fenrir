import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";

function HackRouteLayout() {
  return <Outlet />;
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
