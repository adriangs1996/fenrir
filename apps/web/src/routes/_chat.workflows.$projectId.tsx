import { createFileRoute } from "@tanstack/react-router";
import { ProjectId } from "@fenrir/contracts";

import { WorkflowCenter } from "~/modules/workflows";

export const Route = createFileRoute("/_chat/workflows/$projectId")({
  component: WorkflowCenterRoute,
});

function WorkflowCenterRoute() {
  const { projectId } = Route.useParams() as { readonly projectId: string };
  return <WorkflowCenter projectId={ProjectId.make(projectId)} />;
}
