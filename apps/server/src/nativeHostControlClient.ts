import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export const NATIVE_HOST_CONTROL_PROTOCOL_VERSION = 1;
export const NATIVE_HOST_CONTROL_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const NATIVE_HOST_CONTROL_DEFAULT_TIMEOUT_MS = 1_500;

export type NativeHostControlCommand =
  | "open"
  | "switch"
  | "list"
  | "attach"
  | "remove"
  | "focus"
  | "control"
  | "palette"
  | "workflow"
  | "diagnostics";

export interface NativeHostControlWireRequest {
  readonly protocolVersion: typeof NATIVE_HOST_CONTROL_PROTOCOL_VERSION;
  readonly requestID: string;
  readonly command: NativeHostControlCommand;
  readonly parameters?: Readonly<Record<string, string>>;
}

export interface NativeHostControlWireResponse {
  readonly protocolVersion: typeof NATIVE_HOST_CONTROL_PROTOCOL_VERSION;
  readonly requestID: string;
  readonly command: NativeHostControlCommand;
  readonly ok: boolean;
  readonly resultKind: string;
  readonly payload?: Readonly<Record<string, string>>;
  readonly error?: string;
}

export type NativeHostControlClientErrorCode =
  | "no-app-running"
  | "stale-socket"
  | "permission-denied"
  | "payload-too-large"
  | "malformed-response"
  | "timeout"
  | "connection-failed";

export class NativeHostControlClientError extends Error {
  readonly code: NativeHostControlClientErrorCode;

  constructor(code: NativeHostControlClientErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NativeHostControlClientError";
    this.code = code;
  }
}

interface NativeHostControlClientOptions {
  readonly socketPath?: string;
  readonly timeoutMs?: number;
  readonly ownerUid?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export const resolveNativeHostControlSocketPath = (
  env: NodeJS.ProcessEnv = process.env,
  uid: number = process.getuid?.() ?? os.userInfo().uid,
): string => {
  if (env.FENRIR_NATIVE_CONTROL_SOCKET) {
    return env.FENRIR_NATIVE_CONTROL_SOCKET;
  }
  if (env.XDG_RUNTIME_DIR) {
    return path.join(env.XDG_RUNTIME_DIR, "fenrir", "native-control.sock");
  }
  const tmpDir = env.TMPDIR ?? os.tmpdir();
  return path.join(tmpDir, `fenrir-${uid}`, "native-control.sock");
};

export const encodeNativeHostControlFrame = (payload: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.byteLength > NATIVE_HOST_CONTROL_MAX_PAYLOAD_BYTES) {
    throw new NativeHostControlClientError(
      "payload-too-large",
      `Native control payload is ${body.byteLength} bytes; maximum is ${NATIVE_HOST_CONTROL_MAX_PAYLOAD_BYTES}.`,
    );
  }
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
};

export const decodeNativeHostControlFrame = (frame: Buffer): NativeHostControlWireResponse => {
  if (frame.byteLength < 4) {
    throw new NativeHostControlClientError(
      "malformed-response",
      "Native control frame is truncated.",
    );
  }

  const length = frame.readUInt32BE(0);
  if (length > NATIVE_HOST_CONTROL_MAX_PAYLOAD_BYTES) {
    throw new NativeHostControlClientError(
      "payload-too-large",
      `Native control response is ${length} bytes; maximum is ${NATIVE_HOST_CONTROL_MAX_PAYLOAD_BYTES}.`,
    );
  }
  if (frame.byteLength !== length + 4) {
    throw new NativeHostControlClientError(
      "malformed-response",
      `Native control frame length mismatch: expected ${length + 4}, received ${frame.byteLength}.`,
    );
  }

  try {
    const decoded = JSON.parse(frame.subarray(4).toString("utf8")) as NativeHostControlWireResponse;
    if (
      decoded.protocolVersion !== NATIVE_HOST_CONTROL_PROTOCOL_VERSION ||
      typeof decoded.requestID !== "string" ||
      typeof decoded.command !== "string" ||
      typeof decoded.ok !== "boolean" ||
      typeof decoded.resultKind !== "string"
    ) {
      throw new Error("Invalid native control response envelope.");
    }
    return decoded;
  } catch (cause) {
    throw new NativeHostControlClientError(
      "malformed-response",
      "Native control response is not a valid versioned JSON envelope.",
      { cause },
    );
  }
};

export const sendNativeHostControlRequest = async (
  request: NativeHostControlWireRequest,
  options: NativeHostControlClientOptions = {},
): Promise<NativeHostControlWireResponse> => {
  const ownerUid = options.ownerUid ?? process.getuid?.() ?? os.userInfo().uid;
  const socketPath =
    options.socketPath ?? resolveNativeHostControlSocketPath(options.env, ownerUid);
  const timeoutMs = options.timeoutMs ?? NATIVE_HOST_CONTROL_DEFAULT_TIMEOUT_MS;
  const stats = await statNativeSocket(socketPath, ownerUid);
  if (!stats.isSocket()) {
    throw new NativeHostControlClientError(
      "stale-socket",
      `Native control endpoint exists but is not a socket: ${socketPath}`,
    );
  }

  const frame = encodeNativeHostControlFrame(request);
  const responseFrame = await roundTrip(socketPath, frame, timeoutMs);
  return decodeNativeHostControlFrame(responseFrame);
};

const statNativeSocket = async (socketPath: string, ownerUid: number) => {
  try {
    const stats = await fs.stat(socketPath);
    if (stats.uid !== ownerUid) {
      throw new NativeHostControlClientError(
        "permission-denied",
        `Native control socket owner uid ${stats.uid} does not match current uid ${ownerUid}.`,
      );
    }
    return stats;
  } catch (error) {
    if (error instanceof NativeHostControlClientError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new NativeHostControlClientError(
        "no-app-running",
        `Fenrir Native is not running; socket was not found at ${socketPath}.`,
        { cause: error },
      );
    }
    throw new NativeHostControlClientError(
      "connection-failed",
      `Could not inspect native control socket at ${socketPath}.`,
      { cause: error },
    );
  }
};

const roundTrip = (socketPath: string, frame: Buffer, timeoutMs: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks: Array<Buffer> = [];
    let expectedLength: number | undefined;
    let settled = false;

    const settle = (result: Buffer | Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      settle(new NativeHostControlClientError("timeout", "Timed out waiting for Fenrir Native."));
    }, timeoutMs);

    socket.once("connect", () => {
      socket.write(frame);
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const buffered = Buffer.concat(chunks);
      if (expectedLength === undefined && buffered.byteLength >= 4) {
        expectedLength = buffered.readUInt32BE(0) + 4;
      }
      if (expectedLength !== undefined && buffered.byteLength >= expectedLength) {
        settle(buffered.subarray(0, expectedLength));
      }
    });
    socket.once("error", (error) => {
      const code =
        isNodeError(error) &&
        typeof error.code === "string" &&
        ["ENOENT", "ECONNREFUSED"].includes(error.code)
          ? "stale-socket"
          : "connection-failed";
      settle(
        new NativeHostControlClientError(code, `Failed to reach Fenrir Native at ${socketPath}.`, {
          cause: error,
        }),
      );
    });
  });

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
