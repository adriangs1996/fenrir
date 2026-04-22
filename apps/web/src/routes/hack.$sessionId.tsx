import { createFileRoute } from "@tanstack/react-router";
import { TargetWorkspace } from "../components/hack/TargetWorkspace";
import { useEffect } from "react";
import { useMetasploitStore } from "../metasploitStore";

function HackSessionRouteView() {
  const { sessionId } = Route.useParams();
  const setActiveSessionId = useMetasploitStore((s) => s.setActiveSessionId);

  useEffect(() => {
    setActiveSessionId(sessionId);
    return () => setActiveSessionId(null);
  }, [sessionId, setActiveSessionId]);

  return <TargetWorkspace sessionId={sessionId} />;
}

export const Route = createFileRoute("/hack/$sessionId")({
  component: HackSessionRouteView,
});
