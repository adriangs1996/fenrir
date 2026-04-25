import { useEffect } from "react";
import { usePlanRunnerStore } from "../stores/usePlanRunnerStore";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

export function usePlanRunnerSync(rpcClient: WsRpcClient | null) {
  const applyEvent = usePlanRunnerStore((s) => s.applyEvent);
  const upsertRun = usePlanRunnerStore((s) => s.upsertRun);

  useEffect(() => {
    if (!rpcClient) return;

    // Fetch active runs on mount
    rpcClient.planRunner.listRuns({}).then(
      (result) => result.runs.forEach((run) => upsertRun(run)),
      (err) => console.error("planRunner.listRuns failed:", err),
    );

    // Subscribe to real-time events
    const unsubscribe = rpcClient.planRunner.onEvent((event) => {
      applyEvent(event);
    });

    return () => {
      unsubscribe();
    };
  }, [rpcClient, applyEvent, upsertRun]);
}
