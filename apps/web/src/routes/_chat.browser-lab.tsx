import { createFileRoute } from "@tanstack/react-router";

import { BrowserLabRouteView } from "~/modules/browser-lab";

export const Route = createFileRoute("/_chat/browser-lab")({
  component: BrowserLabRouteView,
});
