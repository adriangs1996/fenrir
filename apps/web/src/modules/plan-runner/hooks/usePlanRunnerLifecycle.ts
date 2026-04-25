import { useMemo } from "react";
import { usePlanRunnerSync } from "./usePlanRunnerSync";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";

/**
 * Manages the Plan Runner lifecycle:
 * - Fetches active runs on mount
 * - Subscribes to WS plan runner events via usePlanRunnerSync
 * - Cleans up on unmount
 */
export function usePlanRunnerLifecycle() {
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  usePlanRunnerSync(rpcClient);
}
