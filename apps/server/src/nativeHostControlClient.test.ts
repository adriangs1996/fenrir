import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
  NativeHostControlClientError,
  encodeNativeHostControlFrame,
  sendNativeHostControlRequest,
  type NativeHostControlWireRequest,
  type NativeHostControlWireResponse,
} from "./nativeHostControlClient.ts";

const request: NativeHostControlWireRequest = {
  protocolVersion: NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
  requestID: "native-cli-test-1",
  command: "list",
  parameters: { includeServer: "false" },
};

describe("native host control socket client", () => {
  it("reports no app running when the socket is absent", async () => {
    const socketPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "fenrir-native-cli-")),
      "missing.sock",
    );

    await expectClientError(
      sendNativeHostControlRequest(request, { socketPath, timeoutMs: 50 }),
      "no-app-running",
    );
  });

  it("launches the native host and retries when launch is requested", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fenrir-native-cli-launch-"));
    const socketPath = path.join(directory, "native-control.sock");
    let launchCount = 0;
    let received: NativeHostControlWireRequest | undefined;
    const response: NativeHostControlWireResponse = {
      protocolVersion: NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
      requestID: request.requestID,
      command: request.command,
      ok: true,
      resultKind: "WorkspacesListed",
      payload: { workspaceCount: "1" },
    };

    const actual = await sendNativeHostControlRequest(request, {
      socketPath,
      timeoutMs: 100,
      launchIfMissing: true,
      launchTimeoutMs: 500,
      launcher: {
        async launchNativeHost(input) {
          assert.equal(input.socketPath, socketPath);
          launchCount += 1;
          await withServer(
            (socket) => {
              socket.once("data", (data) => {
                const length = data.readUInt32BE(0);
                received = JSON.parse(
                  data.subarray(4, 4 + length).toString("utf8"),
                ) as NativeHostControlWireRequest;
                socket.end(encodeNativeHostControlFrame(response));
              });
            },
            { keepOpen: true, socketPath },
          );
        },
      },
    });

    assert.equal(launchCount, 1);
    assert.deepEqual(received, request);
    assert.deepEqual(actual, response);
  });

  it("surfaces native host launch failures", async () => {
    const socketPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "fenrir-native-cli-launch-failed-")),
      "native-control.sock",
    );

    await expectClientError(
      sendNativeHostControlRequest(request, {
        socketPath,
        timeoutMs: 50,
        launchIfMissing: true,
        launcher: {
          async launchNativeHost() {
            throw new NativeHostControlClientError("launch-failed", "simulated launch failure");
          },
        },
      }),
      "launch-failed",
    );
  });

  it("rejects socket paths owned by a different uid", async () => {
    const socketPath = await withServer(async () => undefined, { keepOpen: true });
    const ownerUid = (process.getuid?.() ?? os.userInfo().uid) + 1;

    await expectClientError(
      sendNativeHostControlRequest(request, { socketPath, ownerUid, timeoutMs: 50 }),
      "permission-denied",
    );
  });

  it("reports stale sockets when no server is listening", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fenrir-native-cli-"));
    const socketPath = path.join(directory, "native-control.sock");
    await fs.writeFile(socketPath, "");

    await expectClientError(
      sendNativeHostControlRequest(request, { socketPath, timeoutMs: 50 }),
      "stale-socket",
    );
  });

  it("reports malformed responses", async () => {
    const socketPath = await withServer(
      (socket) => {
        socket.end(encodeNativeHostControlFrame({ nope: true }));
      },
      { keepOpen: true },
    );

    await expectClientError(
      sendNativeHostControlRequest(request, { socketPath, timeoutMs: 100 }),
      "malformed-response",
    );
  });

  it("times out when the native host accepts but does not respond", async () => {
    const socketPath = await withServer(() => undefined, { keepOpen: true });

    await expectClientError(
      sendNativeHostControlRequest(request, { socketPath, timeoutMs: 30 }),
      "timeout",
    );
  });

  it("sends framed requests and decodes successful responses", async () => {
    let received: NativeHostControlWireRequest | undefined;
    const response: NativeHostControlWireResponse = {
      protocolVersion: NATIVE_HOST_CONTROL_PROTOCOL_VERSION,
      requestID: request.requestID,
      command: request.command,
      ok: true,
      resultKind: "WorkspacesListed",
      payload: { workspaceCount: "0" },
    };
    const socketPath = await withServer(
      (socket) => {
        socket.once("data", (data) => {
          const length = data.readUInt32BE(0);
          received = JSON.parse(
            data.subarray(4, 4 + length).toString("utf8"),
          ) as NativeHostControlWireRequest;
          socket.end(encodeNativeHostControlFrame(response));
        });
      },
      { keepOpen: true },
    );

    const actual = await sendNativeHostControlRequest(request, { socketPath, timeoutMs: 100 });

    assert.deepEqual(received, request);
    assert.deepEqual(actual, response);
  });
});

const expectClientError = async (
  promise: Promise<unknown>,
  code: NativeHostControlClientError["code"],
) => {
  try {
    await promise;
    assert.fail(`Expected NativeHostControlClientError ${code}`);
  } catch (error) {
    assert.instanceOf(error, NativeHostControlClientError);
    assert.equal((error as NativeHostControlClientError).code, code);
  }
};

const withServer = async (
  handler: (socket: net.Socket) => void,
  options: { readonly keepOpen?: boolean; readonly socketPath?: string } = {},
): Promise<string> => {
  const socketPath =
    options.socketPath ??
    path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "fenrir-native-cli-")),
      "native-control.sock",
    );
  const server = net.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  server.unref();
  if (!options.keepOpen) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
  return socketPath;
};
