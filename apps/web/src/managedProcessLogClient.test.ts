import type { ManagedProcessLogServerMessage } from "@fenrir/contracts";
import { describe, expect, it, vi } from "vitest";

import { subscribeToInstanceLog } from "./managedProcessLogClient";
import type { WsRpcClient } from "./rpc/wsRpcClient";

type LogListener = (msg: ManagedProcessLogServerMessage) => void;

function createMockClient() {
  let capturedListener: LogListener | null = null;
  const unsubscribe = vi.fn();

  const client = {
    managedProcess: {
      subscribeLog: vi.fn((_input: { instanceId: string }, listener: LogListener) => {
        capturedListener = listener;
        return unsubscribe;
      }),
    },
  } as unknown as WsRpcClient;

  return {
    client,
    unsubscribe,
    sendMessage(msg: ManagedProcessLogServerMessage) {
      capturedListener?.(msg);
    },
    get subscribeLog() {
      return client.managedProcess.subscribeLog;
    },
  };
}

describe("subscribeToInstanceLog", () => {
  it("subscribes and resolves backfill when received", async () => {
    const mock = createMockClient();
    const onChunk = vi.fn();

    const handle = subscribeToInstanceLog({
      instanceId: "inst-1",
      onChunk,
      client: mock.client,
    });

    expect(mock.subscribeLog).toHaveBeenCalledWith({ instanceId: "inst-1" }, expect.any(Function));

    mock.sendMessage({
      type: "backfill",
      instanceId: "inst-1",
      bytes: "initial log data\n",
      ringBufferBytes: 4096,
      truncated: false,
      sequenceNumber: 0,
    } as ManagedProcessLogServerMessage);

    const backfill = await handle.backfillReceived;
    expect(backfill).toEqual({
      bytes: "initial log data\n",
      truncated: false,
      sequenceNumber: 0,
    });

    expect(onChunk).not.toHaveBeenCalled();
  });

  it("calls onChunk for chunk messages after backfill", async () => {
    const mock = createMockClient();
    const onChunk = vi.fn();

    const handle = subscribeToInstanceLog({
      instanceId: "inst-1",
      onChunk,
      client: mock.client,
    });

    // Send backfill first
    mock.sendMessage({
      type: "backfill",
      instanceId: "inst-1",
      bytes: "",
      ringBufferBytes: 0,
      truncated: false,
      sequenceNumber: 0,
    } as ManagedProcessLogServerMessage);

    await handle.backfillReceived;

    // Now send a chunk
    mock.sendMessage({
      type: "chunk",
      instanceId: "inst-1",
      bytes: "new line\n",
      sequenceNumber: 1,
    } as ManagedProcessLogServerMessage);

    expect(onChunk).toHaveBeenCalledWith({
      bytes: "new line\n",
      sequenceNumber: 1,
    });
  });

  it("unsubscribe stops stream", () => {
    const mock = createMockClient();
    const onChunk = vi.fn();

    const handle = subscribeToInstanceLog({
      instanceId: "inst-1",
      onChunk,
      client: mock.client,
    });

    handle.unsubscribe();

    expect(mock.unsubscribe).toHaveBeenCalled();
  });
});
