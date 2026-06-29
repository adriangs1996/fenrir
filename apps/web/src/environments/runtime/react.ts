import { useSyncExternalStore } from "react";

import { readPrimaryEnvironmentDescriptor } from "../primary";
import type { EnvironmentConnection } from "./connection";
import type { WsRpcClient } from "~/rpc/wsRpcClient";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "./service";

function readPrimaryEnvironmentConnectionSnapshot(): EnvironmentConnection | null {
  const environmentId = readPrimaryEnvironmentDescriptor()?.environmentId ?? null;
  return environmentId ? readEnvironmentConnection(environmentId) : null;
}

export function usePrimaryEnvironmentConnection(): EnvironmentConnection | null {
  return useSyncExternalStore(
    subscribeEnvironmentConnections,
    readPrimaryEnvironmentConnectionSnapshot,
    () => null,
  );
}

export function usePrimaryEnvironmentClient(): WsRpcClient | null {
  return usePrimaryEnvironmentConnection()?.client ?? null;
}
