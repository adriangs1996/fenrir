import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  CreateRemoteHostInput,
  ListRemoteDirectoryInput,
  RemoteControllerEvent,
  SendRemoteCommandInput,
  StartRemoteConnectionInput,
} from "./remoteController";

const decodeCreateRemoteHostInput = Schema.decodeUnknownSync(CreateRemoteHostInput);
const decodeRemoteControllerEvent = Schema.decodeUnknownSync(RemoteControllerEvent);
const decodeSendRemoteCommandInput = Schema.decodeUnknownSync(SendRemoteCommandInput);
const decodeStartRemoteConnectionInput = Schema.decodeUnknownSync(StartRemoteConnectionInput);
const decodeListRemoteDirectoryInput = Schema.decodeUnknownSync(ListRemoteDirectoryInput);

describe("remoteController contracts", () => {
  it("decodes command-template host input", () => {
    const input = decodeCreateRemoteHostInput({
      label: "edge-01",
      transport: {
        type: "command-template",
        command: "ssh",
        args: ["edge-01", "sh", "-lc", "{command}"],
      },
    });

    expect(input.label).toBe("edge-01");
    expect(input.transport.command).toBe("ssh");
  });

  it("rejects empty command-template runner commands", () => {
    expect(() =>
      decodeCreateRemoteHostInput({
        label: "bad",
        transport: {
          type: "command-template",
          command: "",
        },
      }),
    ).toThrow();
  });

  it("decodes start and command inputs with branded ids", () => {
    const start = decodeStartRemoteConnectionInput({
      hostId: "host-1",
    });
    const command = decodeSendRemoteCommandInput({
      connectionId: "connection-1",
      command: "whoami",
    });

    expect(start.hostId).toBe("host-1");
    expect(command.command).toBe("whoami");
  });

  it("decodes command run events", () => {
    const event = decodeRemoteControllerEvent({
      type: "commandRun.updated",
      snapshot: {
        runId: "run-1",
        connectionId: "connection-1",
        command: "id",
        status: "succeeded",
        output: "uid=501",
        exitCode: 0,
        signal: null,
        startedAt: "2026-06-02T00:00:00.000Z",
        finishedAt: "2026-06-02T00:00:00.100Z",
      },
    });

    expect(event.type).toBe("commandRun.updated");
  });

  it("decodes directory listing input", () => {
    const input = decodeListRemoteDirectoryInput({
      connectionId: "connection-1",
      path: ".",
      limit: 50,
    });

    expect(input.connectionId).toBe("connection-1");
    expect(input.path).toBe(".");
    expect(input.limit).toBe(50);
  });
});
