import { useEffect } from "react";
import { useBrowserStore } from "../../browserStore";
import type { WsRpcClient } from "../../rpc/wsRpcClient";

export function useBrowserSync(rpcClient: WsRpcClient | null) {
  useEffect(() => {
    if (!rpcClient) return;

    const unsubscribe = rpcClient.browser.onEvent((event) => {
      if (event.type === "traffic.captured") {
        useBrowserStore.getState().appendTraffic(event.entry);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [rpcClient]);
}
