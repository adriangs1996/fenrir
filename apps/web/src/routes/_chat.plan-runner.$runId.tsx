import { createFileRoute } from "@tanstack/react-router";
import { PlanRunnerRunView } from "../modules/plan-runner";

export const Route = createFileRoute("/_chat/plan-runner/$runId")({
  component: PlanRunnerRunViewRoute,
});

function PlanRunnerRunViewRoute() {
  const { runId } = Route.useParams();
  return <PlanRunnerRunView runId={runId} />;
}
