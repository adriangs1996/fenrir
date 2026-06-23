import { useEffect } from "react";

import type { WsRpcClient } from "~/rpc/wsRpcClient";
import { useWorkflowStore } from "../stores/useWorkflowStore";

export function useWorkflowSync(rpcClient: WsRpcClient | null) {
  const applyEvent = useWorkflowStore((state) => state.applyEvent);

  useEffect(() => {
    if (!rpcClient) {
      return;
    }

    const unsubscribe = rpcClient.workflows.onEvent((event) => {
      applyEvent(event);
    });

    return () => {
      unsubscribe();
    };
  }, [applyEvent, rpcClient]);
}
