import { createFileRoute } from "@tanstack/react-router";

import { GitDiffWorkbenchRoute } from "~/components/gitdiff-workbench/GitDiffWorkbenchRoute";

export const Route = createFileRoute("/_chat/$environmentId/$threadId/gitdiff")({
  component: GitDiffWorkbenchRoute,
});
