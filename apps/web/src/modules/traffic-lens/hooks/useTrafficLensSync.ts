import { useEffect } from "react";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import type { WsRpcClient } from "../../../rpc/wsRpcClient";

export function useTrafficLensSync(rpcClient: WsRpcClient | null) {
  useEffect(() => {
    if (!rpcClient) return;

    const unsubscribe = rpcClient.trafficLens.onEvent((event) => {
      if (event.type === "traffic.captured") {
        useTrafficLensStore.getState().appendTraffic(event.entry);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [rpcClient]);
}
