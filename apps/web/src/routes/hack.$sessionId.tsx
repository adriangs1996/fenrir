import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { TargetWorkspace } from "../components/hack/TargetWorkspace";
import { useRawTcpStore } from "../rawTcpStore";

function HackSessionRouteView() {
  const { sessionId } = Route.useParams();
  const setActiveSessionId = useRawTcpStore((s) => s.setActiveSessionId);

  useEffect(() => {
    setActiveSessionId(sessionId);
    return () => setActiveSessionId(null);
  }, [sessionId, setActiveSessionId]);

  return <TargetWorkspace sessionId={sessionId} />;
}

export const Route = createFileRoute("/hack/$sessionId")({
  component: HackSessionRouteView,
});
