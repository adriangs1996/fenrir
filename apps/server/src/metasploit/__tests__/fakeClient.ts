/**
 * Scriptable fake of the internal `MsfrpcClient` interface used by
 * `MetasploitServiceLive`. Tests configure per-method responses and assert
 * call shapes via `vi.fn` mocks.
 */
import type { Mock } from "vitest";
import { vi } from "vitest";

export interface FakeMsfrpcClient {
  call: Mock<(method: string, params?: unknown[]) => Promise<unknown>>;
  authenticate: Mock<() => Promise<void>>;
  dispose: Mock<() => void>;
  /** Register a handler for a specific RPC method. */
  whenCalled: (method: string, handler: (params: unknown[]) => unknown) => void;
  /** Make a specific RPC method throw on invocation. */
  failCall: (method: string, error?: Error) => void;
  /** Clear all handlers, failures, and mock call history. */
  reset: () => void;
}

export function createFakeMsfrpcClient(): FakeMsfrpcClient {
  const handlers = new Map<string, (params: unknown[]) => unknown>();
  const failures = new Map<string, Error>();

  const call = vi.fn(async (method: string, params: unknown[] = []) => {
    if (failures.has(method)) throw failures.get(method)!;
    const handler = handlers.get(method);
    if (!handler) return null;
    return handler(params);
  });

  const authenticate = vi.fn(async () => {});
  const dispose = vi.fn(() => {});

  return {
    call,
    authenticate,
    dispose,
    whenCalled: (method, handler) => {
      handlers.set(method, handler);
      failures.delete(method);
    },
    failCall: (method, error = new Error(`Mock failure for ${method}`)) => {
      failures.set(method, error);
      handlers.delete(method);
    },
    reset: () => {
      handlers.clear();
      failures.clear();
      call.mockClear();
      authenticate.mockClear();
      dispose.mockClear();
    },
  };
}
