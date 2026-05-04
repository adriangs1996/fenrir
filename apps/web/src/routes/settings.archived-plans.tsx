import { createFileRoute } from "@tanstack/react-router";

import { ArchivedPlansPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/archived-plans")({
  component: ArchivedPlansPanel,
});
