import { createFileRoute } from "@tanstack/react-router";
import { PlanRunnerFeatureRunResolver } from "../modules/plan-runner";

export const Route = createFileRoute("/_chat/plan-runner/$featureName/run")({
  component: PlanRunnerFeatureRunRoute,
});

function PlanRunnerFeatureRunRoute() {
  const { featureName } = Route.useParams();
  return <PlanRunnerFeatureRunResolver featureName={featureName} />;
}
