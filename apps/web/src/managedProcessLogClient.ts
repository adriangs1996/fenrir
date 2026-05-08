import {
  MANAGED_PROCESS_LOG_CHANNEL,
  type ManagedProcessLogServerMessage,
} from "@fenrir/contracts";
import type { WsRpcClient } from "./rpc/wsRpcClient";

export interface LogStreamHandle {
  unsubscribe(): void;
  readonly backfillReceived: Promise<{
    bytes: string;
    truncated: boolean;
    sequenceNumber: number;
  }>;
}

export function subscribeToInstanceLog(input: {
  instanceId: string;
  onChunk: (chunk: { bytes: string; sequenceNumber: number }) => void;
  client: WsRpcClient;
}): LogStreamHandle {
  let resolveBackfill!: (b: { bytes: string; truncated: boolean; sequenceNumber: number }) => void;
  const backfillReceived = new Promise<{
    bytes: string;
    truncated: boolean;
    sequenceNumber: number;
  }>((resolve) => {
    resolveBackfill = resolve;
  });

  const unsubscribeStream = input.client.managedProcess.subscribeLog(
    { instanceId: input.instanceId },
    (msg: ManagedProcessLogServerMessage) => {
      if (msg.type === "backfill") {
        resolveBackfill({
          bytes: msg.bytes,
          truncated: msg.truncated,
          sequenceNumber: msg.sequenceNumber,
        });
      } else {
        input.onChunk({
          bytes: msg.bytes,
          sequenceNumber: msg.sequenceNumber,
        });
      }
    },
  );

  return {
    backfillReceived,
    unsubscribe() {
      unsubscribeStream();
    },
  };
}
