import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useEditorStore } from "~/modules/neovim-editor";

export const Route = createFileRoute("/_chat/$environmentId/$threadId/gitdiff")({
  component: GitDiffRouteRedirect,
});

function GitDiffRouteRedirect() {
  const navigate = useNavigate();
  const { environmentId, threadId } = Route.useParams();

  useEffect(() => {
    useEditorStore.getState().setActiveChatTab("gitdiff");
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      replace: true,
    });
  }, [environmentId, navigate, threadId]);

  return null;
}
