export interface BackendReadinessWaiter {
  readonly wait: (baseUrl: string) => Promise<void>;
  readonly cancel: () => void;
}

export function createBackendReadinessWaiter(
  waitForReady: (baseUrl: string, signal: AbortSignal) => Promise<void>,
): BackendReadinessWaiter {
  let activeWait: {
    readonly baseUrl: string;
    readonly controller: AbortController;
    readonly promise: Promise<void>;
  } | null = null;

  const cancel = (): void => {
    activeWait?.controller.abort();
    activeWait = null;
  };

  const wait = (baseUrl: string): Promise<void> => {
    if (activeWait?.baseUrl === baseUrl) {
      return activeWait.promise;
    }

    cancel();
    const controller = new AbortController();
    const promise = waitForReady(baseUrl, controller.signal).finally(() => {
      if (activeWait?.controller === controller) {
        activeWait = null;
      }
    });

    activeWait = { baseUrl, controller, promise };
    return promise;
  };

  return { wait, cancel };
}
