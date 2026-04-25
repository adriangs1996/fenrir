import { createFileRoute } from "@tanstack/react-router";
import { PlanRunnerPlanPreview } from "../modules/plan-runner";

export const Route = createFileRoute("/_chat/plan-runner/$featureName/$planId")({
  component: PlanRunnerPlanPreviewRoute,
});

function PlanRunnerPlanPreviewRoute() {
  const { featureName, planId } = Route.useParams();
  return <PlanRunnerPlanPreview featureName={featureName} planId={planId} />;
}
