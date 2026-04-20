import { createFileRoute } from "@tanstack/react-router";

import { VpnSettings } from "../components/settings/VpnSettings";

export const Route = createFileRoute("/settings/vpn")({
  component: VpnSettings,
});
