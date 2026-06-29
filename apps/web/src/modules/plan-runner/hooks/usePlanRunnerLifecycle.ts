import { usePlanRunnerSync } from "./usePlanRunnerSync";
import { usePrimaryEnvironmentClient } from "~/environments/runtime";

/**
 * Manages the Plan Runner lifecycle:
 * - Fetches active runs on mount
 * - Subscribes to WS plan runner events via usePlanRunnerSync
 * - Cleans up on unmount
 */
export function usePlanRunnerLifecycle() {
  const rpcClient = usePrimaryEnvironmentClient();

  usePlanRunnerSync(rpcClient);
}
