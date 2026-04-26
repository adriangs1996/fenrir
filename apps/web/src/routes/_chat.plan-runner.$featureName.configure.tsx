import { createFileRoute } from "@tanstack/react-router";
import { PlanRunnerConfigureView } from "../modules/plan-runner";

export const Route = createFileRoute("/_chat/plan-runner/$featureName/configure")({
  component: PlanRunnerConfigureViewRoute,
});

function PlanRunnerConfigureViewRoute() {
  const { featureName } = Route.useParams();
  return <PlanRunnerConfigureView featureName={featureName} />;
}
