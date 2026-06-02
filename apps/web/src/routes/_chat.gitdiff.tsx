import { createFileRoute } from "@tanstack/react-router";

import { GitDiffPrototypeRoute } from "~/components/gitdiff-prototype/GitDiffPrototypeRoute";

export const Route = createFileRoute("/_chat/gitdiff")({
  component: GitDiffPrototypeRoute,
});
