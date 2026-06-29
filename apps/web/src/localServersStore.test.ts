import type { DiscoveredLocalServer, EnvironmentId, ThreadId } from "@fenrir/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import {
  formatLocalServerShortLabel,
  selectLocalServersForTerminal,
  selectLocalServersForThread,
  selectPreferredLocalServer,
  subscribeToLocalServers,
  useLocalServersStore,
} from "./localServersStore";

const environmentId = "local" as EnvironmentId;
const threadId = "thread-1" as ThreadId;

function makeServer(overrides: Partial<DiscoveredLocalServer> = {}): DiscoveredLocalServer {
  return {
    host: "127.0.0.1",
    port: 3000 as DiscoveredLocalServer["port"],
    url: "http://127.0.0.1:3000",
    processName: "node",
    pid: 1234 as NonNullable<DiscoveredLocalServer["pid"]>,
    source: "lsof",
    terminal: null,
    ...overrides,
  };
}

describe("localServersStore", () => {
  beforeEach(() => {
    useLocalServersStore.setState({ byEnvironmentId: {} });
  });

  it("selects local servers by thread and terminal owner", () => {
    const terminalServer = makeServer({
      terminal: { threadId, terminalId: "default" },
    });
    const secondTerminalServer = makeServer({
      port: 5173 as DiscoveredLocalServer["port"],
      url: "http://127.0.0.1:5173",
      terminal: { threadId, terminalId: "term-2" },
    });
    const otherThreadServer = makeServer({
      port: 8080 as DiscoveredLocalServer["port"],
      url: "http://127.0.0.1:8080",
      terminal: { threadId: "thread-2" as ThreadId, terminalId: "default" },
    });

    useLocalServersStore.getState().setSnapshot(environmentId, {
      scannedAt: "2026-06-17T10:00:00.000Z",
      servers: [terminalServer, secondTerminalServer, otherThreadServer],
    });

    const state = useLocalServersStore.getState();
    expect(selectLocalServersForThread(state, environmentId, threadId)).toEqual([
      terminalServer,
      secondTerminalServer,
    ]);
    expect(selectLocalServersForTerminal(state, environmentId, threadId, "default")).toEqual([
      terminalServer,
    ]);
    expect(
      selectPreferredLocalServer(selectLocalServersForThread(state, environmentId, threadId)),
    ).toBe(terminalServer);
    expect(formatLocalServerShortLabel(secondTerminalServer)).toBe(":5173");
  });

  it("shares one websocket subscription per environment", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const client = {
      localServers: {
        subscribe,
      },
    } as unknown as WsRpcClient;

    const stopFirst = subscribeToLocalServers({ client, environmentId });
    const stopSecond = subscribeToLocalServers({ client, environmentId });

    expect(subscribe).toHaveBeenCalledTimes(1);

    stopFirst();
    expect(unsubscribe).not.toHaveBeenCalled();

    stopSecond();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("replaces the websocket subscription when the environment client changes", () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();
    const subscribeFirst = vi.fn(() => unsubscribeFirst);
    const subscribeSecond = vi.fn(() => unsubscribeSecond);
    const firstClient = {
      localServers: {
        subscribe: subscribeFirst,
      },
    } as unknown as WsRpcClient;
    const secondClient = {
      localServers: {
        subscribe: subscribeSecond,
      },
    } as unknown as WsRpcClient;

    const stopFirst = subscribeToLocalServers({ client: firstClient, environmentId });
    const stopSecond = subscribeToLocalServers({ client: secondClient, environmentId });

    expect(subscribeFirst).toHaveBeenCalledTimes(1);
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(subscribeSecond).toHaveBeenCalledTimes(1);

    stopFirst();
    expect(unsubscribeSecond).not.toHaveBeenCalled();

    stopSecond();
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
  });
});
