import type { RemoteControllerEvent } from "@fenrir/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useRemoteControllerStore } from "./remoteControllerStore";

beforeEach(() => {
  useRemoteControllerStore.setState({
    hosts: {},
    connections: {},
    commandRuns: {},
    selectedHostId: null,
  });
});

describe("remoteControllerStore", () => {
  it("applies host, connection, and command run events", () => {
    const hostEvent = {
      type: "host.upserted",
      snapshot: {
        hostId: "host-1" as never,
        label: "edge-01",
        transport: {
          type: "command-template",
          command: "sh",
          args: ["-lc", "{command}"],
        },
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    } satisfies RemoteControllerEvent;
    const connectionEvent = {
      type: "connection.updated",
      snapshot: {
        connectionId: "connection-1" as never,
        hostId: "host-1" as never,
        label: "edge-01",
        transportType: "command-template",
        status: "connected",
        state: { path: "." },
        startedAt: "2026-06-02T00:00:01.000Z",
      },
    } satisfies RemoteControllerEvent;
    const runEvent = {
      type: "commandRun.updated",
      snapshot: {
        runId: "run-1" as never,
        connectionId: "connection-1" as never,
        command: "whoami",
        status: "succeeded",
        output: "fenrir",
        exitCode: 0,
        signal: null,
        startedAt: "2026-06-02T00:00:02.000Z",
        finishedAt: "2026-06-02T00:00:03.000Z",
      },
    } satisfies RemoteControllerEvent;

    useRemoteControllerStore.getState().applyEvent(hostEvent);
    useRemoteControllerStore.getState().applyEvent(connectionEvent);
    useRemoteControllerStore.getState().applyEvent(runEvent);

    const state = useRemoteControllerStore.getState();
    expect(state.hosts["host-1"]?.label).toBe("edge-01");
    expect(state.selectedHostId).toBe("host-1");
    expect(state.connections["connection-1"]?.status).toBe("connected");
    expect(state.commandRuns["run-1"]?.output).toBe("fenrir");
  });

  it("moves selection after deleting the selected host", () => {
    useRemoteControllerStore.getState().resetHosts([
      {
        hostId: "host-1" as never,
        label: "first",
        transport: { type: "command-template", command: "sh" },
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      {
        hostId: "host-2" as never,
        label: "second",
        transport: { type: "command-template", command: "sh" },
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    ]);
    useRemoteControllerStore.getState().setSelectedHostId("host-1");

    useRemoteControllerStore.getState().applyEvent({
      type: "host.deleted",
      hostId: "host-1" as never,
    });

    expect(useRemoteControllerStore.getState().selectedHostId).toBe("host-2");
  });
});
