import type {
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusStreamEvent,
} from "@fenrir/contracts";
import { AuthSessionId, TmuxPaneId, TmuxWorkspaceId, WS_METHODS } from "@fenrir/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import { createWsRpcClient } from "./wsRpcClient";
import { type WsRpcProtocolClient } from "./protocol";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: 0,
  pr: null,
};

describe("wsRpcClient", () => {
  it("ignores remote-only vcs status events until an initial snapshot arrives", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
      ] satisfies VcsStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.vcs.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      ],
    ]);
  });

  it("reduces git status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies VcsStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.vcs.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });

  it("adapts tmux kernel RPC methods without legacy terminal routes", async () => {
    const calls: Array<{ readonly method: string; readonly input: unknown }> = [];
    const workspaceId = TmuxWorkspaceId.make("workspace-web-native-1");
    const paneId = TmuxPaneId.make("pane-web-native-1");
    const actor = {
      sessionId: AuthSessionId.make("auth-session-web-native-1"),
      subject: "web-user",
    };
    const rpcClient = new Proxy(
      {},
      {
        get: (_target, property) => {
          const method = String(property);
          if (method === WS_METHODS.tmuxPaneSubscribeStream) {
            return (input: unknown) => {
              calls.push({ method, input });
              return Stream.empty;
            };
          }
          return (input: unknown) => {
            calls.push({ method, input });
            return Effect.succeed({ ok: true });
          };
        },
      },
    ) as unknown as WsRpcProtocolClient;
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      isHeartbeatFresh: vi.fn(() => true),
      request: vi.fn(
        <TSuccess>(
          execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
        ) => Effect.runPromise(execute(rpcClient)),
      ),
      requestStream: vi.fn(),
      subscribe: vi.fn(
        <TValue>(
          connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
          _listener: (value: TValue) => void,
        ) => {
          void Effect.runPromise(Stream.runDrain(connect(rpcClient)));
          return () => undefined;
        },
      ),
    };

    const client = createWsRpcClient(transport as unknown as WsTransport);

    await client.tmuxKernel.reconnectWorkspace({ actor, workspaceId });
    client.tmuxKernel.subscribePaneStream(
      {
        actor,
        workspaceId,
        paneId,
        afterSeq: 10,
        backfill: "from-seq",
        slowClientPolicy: "fast-forward",
        maxBufferedChunks: 128,
      },
      vi.fn(),
    );

    expect(calls).toEqual([
      {
        method: WS_METHODS.tmuxWorkspaceReconnect,
        input: { actor, workspaceId },
      },
      {
        method: WS_METHODS.tmuxPaneSubscribeStream,
        input: {
          actor,
          workspaceId,
          paneId,
          afterSeq: 10,
          backfill: "from-seq",
          slowClientPolicy: "fast-forward",
          maxBufferedChunks: 128,
        },
      },
    ]);
  });
});
