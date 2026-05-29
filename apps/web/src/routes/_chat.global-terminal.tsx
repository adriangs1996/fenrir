import { createFileRoute } from "@tanstack/react-router";

import { GlobalTerminalRouteView } from "~/modules/terminal";

export const Route = createFileRoute("/_chat/global-terminal")({
  component: GlobalTerminalRouteView,
});
