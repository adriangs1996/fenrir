import { describe, expect, it, vi } from "vitest";

import { createBackendReadinessWaiter } from "./backendReadinessWait";

describe("createBackendReadinessWaiter", () => {
  it("shares an in-flight wait for the same backend URL", async () => {
    let resolveReady: (() => void) | undefined;
    const waitForReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
    );
    const waiter = createBackendReadinessWaiter(waitForReady);

    const first = waiter.wait("http://127.0.0.1:3773");
    const second = waiter.wait("http://127.0.0.1:3773");

    expect(second).toBe(first);
    expect(waitForReady).toHaveBeenCalledTimes(1);

    resolveReady?.();
    await expect(first).resolves.toBeUndefined();
  });

  it("cancels the previous wait when a different backend URL starts waiting", async () => {
    const abortedSignals: Array<AbortSignal> = [];
    const waitForReady = vi.fn(
      (_baseUrl: string, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              abortedSignals.push(signal);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    const waiter = createBackendReadinessWaiter(waitForReady);

    const first = waiter.wait("http://127.0.0.1:3773");
    const second = waiter.wait("http://127.0.0.1:3774");

    await expect(first).rejects.toThrow("aborted");
    expect(abortedSignals).toHaveLength(1);
    expect(waitForReady).toHaveBeenCalledTimes(2);

    second.catch(() => undefined);
    waiter.cancel();
  });

  it("cancels the active wait explicitly", async () => {
    const waitForReady = vi.fn(
      (_baseUrl: string, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    const waiter = createBackendReadinessWaiter(waitForReady);

    const waitPromise = waiter.wait("http://127.0.0.1:3773");
    waiter.cancel();

    await expect(waitPromise).rejects.toThrow("aborted");
  });
});
