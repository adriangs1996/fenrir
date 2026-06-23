import { useMemo } from "react";

import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useWorkflowSync } from "./useWorkflowSync";

export function useWorkflowLifecycle() {
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  useWorkflowSync(rpcClient);
}
