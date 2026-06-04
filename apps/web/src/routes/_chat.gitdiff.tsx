import { createFileRoute } from "@tanstack/react-router";
import { GitCompareIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { SidebarInset } from "~/components/ui/sidebar";

export const Route = createFileRoute("/_chat/gitdiff")({
  component: GitDiffCompatibilityRoute,
});

function GitDiffCompatibilityRoute() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCompareIcon />
          </EmptyMedia>
          <EmptyTitle>Open a thread first</EmptyTitle>
          <EmptyDescription>
            The Git Diff Workbench is scoped to a thread so it can use that thread&apos;s worktree
            and review session.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}
