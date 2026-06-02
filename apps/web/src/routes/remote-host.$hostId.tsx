import { createFileRoute } from "@tanstack/react-router";

import { RemoteHostWorkspace } from "../components/remote-host/RemoteHostWorkspace";

function RemoteHostDetailRouteView() {
  const { hostId } = Route.useParams();
  return <RemoteHostWorkspace hostId={hostId} />;
}

export const Route = createFileRoute("/remote-host/$hostId")({
  component: RemoteHostDetailRouteView,
});
