/**
 * MSFRPC MessagePack-RPC client — HTTP transport over localhost.
 *
 * Stateful: holds an auth token after `authenticate()`.
 * Disposable: `dispose()` invalidates the client for further calls.
 */
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { msgpackDecode } from "@fenrir/shared/msgpack";

import { MSFRPC_USER } from "./constants";

// ─── Interface ─────────────────────────────────────────────────────────────

export interface MsfrpcClient {
  call(method: string, params?: unknown[]): Promise<any>;
  authenticate(): Promise<void>;
  dispose(): void;
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createMsfrpcClient(host: string, port: number, password: string): MsfrpcClient {
  let token: string | null = null;
  let disposed = false;

  const call = async (method: string, params: unknown[] = []): Promise<any> => {
    if (disposed) {
      throw new Error("MSFRPC client disposed");
    }
    const body = token ? [method, token, ...params] : [method, ...params];

    const response = await fetch(`http://${host}:${port}/api/`, {
      method: "POST",
      headers: { "Content-Type": "binary/message-pack" },
      body: msgpackEncode(body),
    });

    if (!response.ok) {
      throw new Error(`MSFRPC request failed: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return msgpackDecode(new Uint8Array(buffer));
  };

  return {
    call,
    authenticate: async () => {
      const result = await call("auth.login", [MSFRPC_USER, password]);
      if (result?.result === "success" && result?.token) {
        token = result.token;
      } else {
        throw new Error("MSFRPC authentication failed");
      }
    },
    dispose: () => {
      disposed = true;
      token = null;
    },
  };
}
