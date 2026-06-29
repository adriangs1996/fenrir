import { usePrimaryEnvironmentClient } from "~/environments/runtime";
import { useWorkflowSync } from "./useWorkflowSync";

export function useWorkflowLifecycle() {
  const rpcClient = usePrimaryEnvironmentClient();

  useWorkflowSync(rpcClient);
}
