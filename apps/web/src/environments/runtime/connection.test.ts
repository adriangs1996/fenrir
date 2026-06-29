import { EnvironmentId } from "@fenrir/contracts";
import { describe, expect, it, vi } from "vitest";

import { createEnvironmentConnection } from "./connection";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

function createTestClient(options?: {
  readonly getBootstrapSnapshot?: () => Promise<{ readonly snapshotSequence: number }>;
  readonly getSnapshot?: () => Promise<{ readonly snapshotSequence: number }>;
  readonly replayEvents?: () => Promise<ReadonlyArray<any>>;
  readonly reconnect?: () => Promise<void>;
  readonly isHeartbeatFresh?: () => boolean;
}) {
  const lifecycleListeners = new Set<(event: any) => void>();
  const configListeners = new Set<(event: any) => void>();
  const terminalListeners = new Set<(event: any) => void>();
  const shellListeners = new Set<(item: any) => void>();
  const managedProcessListeners = new Set<(item: any) => void>();
  const domainListeners = new Set<(event: any) => void>();
  let domainResubscribe: (() => void) | undefined;
  let shellResubscribe: (() => void) | undefined;
  let managedProcessResubscribe: (() => void) | undefined;

  const getBootstrapSnapshot = vi.fn(
    options?.getBootstrapSnapshot ??
      (async () =>
        ({
          snapshotSequence: 1,
          projects: [],
          threads: [],
        }) as any),
  );
  const getSnapshot = vi.fn(
    options?.getSnapshot ??
      (async () =>
        ({
          snapshotSequence: 1,
          projects: [],
          threads: [],
        }) as any),
  );
  const replayEvents = vi.fn(options?.replayEvents ?? (async () => []));

  const client = {
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(options?.reconnect ?? (async () => undefined)),
    isHeartbeatFresh: vi.fn(options?.isHeartbeatFresh ?? (() => false)),
    server: {
      getConfig: vi.fn(async () => ({
        environment: {
          environmentId: EnvironmentId.make("env-1"),
        },
      })),
      listProviderSkills: vi.fn(async () => ({ skills: [] })),
      subscribeConfig: (listener: (event: any) => void) => {
        configListeners.add(listener);
        return () => configListeners.delete(listener);
      },
      subscribeLifecycle: (listener: (event: any) => void) => {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      },
      subscribeAuthAccess: () => () => undefined,
      refreshProviders: vi.fn(async () => undefined),
      updateProvider: vi.fn(async () => undefined),
      upsertKeybinding: vi.fn(async () => undefined),
      removeKeybinding: vi.fn(async () => undefined),
      getTraceDiagnostics: vi.fn(async () => undefined),
      getProcessDiagnostics: vi.fn(async () => undefined),
      getProcessResourceHistory: vi.fn(async () => undefined),
      signalProcess: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
    },
    orchestration: {
      getBootstrapSnapshot,
      getArchivedShellSnapshot: vi.fn(async () => ({
        snapshotSequence: 1,
        projects: [],
        threads: [],
      })),
      getSnapshot,
      subscribeShell: vi.fn(
        (listener: (item: any) => void, options?: { onResubscribe?: () => void }) => {
          shellListeners.add(listener);
          shellResubscribe = options?.onResubscribe;
          listener({
            kind: "snapshot",
            snapshot: {
              snapshotSequence: 1,
              projects: [],
              threads: [],
              updatedAt: "2026-04-22T10:00:00.000Z",
            },
          });
          return () => {
            shellListeners.delete(listener);
            if (shellResubscribe === options?.onResubscribe) {
              shellResubscribe = undefined;
            }
          };
        },
      ),
      subscribeManagedProcesses: vi.fn(
        (listener: (item: any) => void, options?: { onResubscribe?: () => void }) => {
          managedProcessListeners.add(listener);
          managedProcessResubscribe = options?.onResubscribe;
          listener({
            kind: "snapshot",
            snapshot: {
              instances: [],
              updatedAt: "2026-04-22T10:00:00.000Z",
            },
          });
          return () => {
            managedProcessListeners.delete(listener);
            if (managedProcessResubscribe === options?.onResubscribe) {
              managedProcessResubscribe = undefined;
            }
          };
        },
      ),
      dispatchCommand: vi.fn(async () => undefined),
      getTurnDiff: vi.fn(async () => undefined),
      getFullThreadDiff: vi.fn(async () => undefined),
      replayEvents,
      onDomainEvent: vi.fn(
        (listener: (event: any) => void, options?: { onResubscribe?: () => void }) => {
          domainListeners.add(listener);
          domainResubscribe = options?.onResubscribe;
          return () => {
            domainListeners.delete(listener);
            if (domainResubscribe === options?.onResubscribe) {
              domainResubscribe = undefined;
            }
          };
        },
      ),
    },
    terminal: {
      open: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: (listener: (event: any) => void) => {
        terminalListeners.add(listener);
        return () => terminalListeners.delete(listener);
      },
    },
    projects: {
      listEntries: vi.fn(async () => ({ entries: [], truncated: false })),
      searchEntries: vi.fn(async () => []),
      readFile: vi.fn(async () => ({
        relativePath: "README.md",
        contents: "",
        byteLength: 0,
        truncated: false,
      })),
      writeFile: vi.fn(async () => undefined),
      createFile: vi.fn(async () => undefined),
      createDirectory: vi.fn(async () => undefined),
      removeEntry: vi.fn(async () => undefined),
      moveEntry: vi.fn(async () => undefined),
      copyEntry: vi.fn(async () => undefined),
    },
    shell: {
      openInEditor: vi.fn(async () => undefined),
    },
    git: {
      pull: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
      runStackedAction: vi.fn(async () => ({}) as any),
      listBranches: vi.fn(async () => []),
      createWorktree: vi.fn(async () => undefined),
      removeWorktree: vi.fn(async () => undefined),
      createBranch: vi.fn(async () => undefined),
      checkout: vi.fn(async () => undefined),
      init: vi.fn(async () => undefined),
      resolvePullRequest: vi.fn(async () => undefined),
      preparePullRequestThread: vi.fn(async () => undefined),
    },
  } as unknown as WsRpcClient;

  return {
    client,
    getBootstrapSnapshot,
    getSnapshot,
    replayEvents,
    emitWelcome: (environmentId: EnvironmentId) => {
      for (const listener of lifecycleListeners) {
        listener({
          type: "welcome",
          payload: {
            environment: {
              environmentId,
            },
          },
        });
      }
    },
    emitConfigSnapshot: (environmentId: EnvironmentId) => {
      for (const listener of configListeners) {
        listener({
          type: "snapshot",
          config: {
            environment: {
              environmentId,
            },
          },
        });
      }
    },
    emitDomainEvent: (sequence: number) => {
      for (const listener of domainListeners) {
        listener({
          sequence,
          type: "thread.updated",
          payload: {},
        });
      }
    },
    triggerDomainResubscribe: () => {
      domainResubscribe?.();
    },
    emitShellSnapshot: (snapshotSequence: number) => {
      for (const listener of shellListeners) {
        listener({
          kind: "snapshot",
          snapshot: {
            snapshotSequence,
            projects: [],
            threads: [],
            updatedAt: "2026-04-22T10:00:00.000Z",
          },
        });
      }
    },
    triggerShellResubscribe: () => {
      shellResubscribe?.();
    },
    emitManagedProcessSnapshot: (instances: ReadonlyArray<unknown>) => {
      for (const listener of managedProcessListeners) {
        listener({
          kind: "snapshot",
          snapshot: {
            instances,
            updatedAt: "2026-04-22T10:00:00.000Z",
          },
        });
      }
    },
    triggerManagedProcessResubscribe: () => {
      managedProcessResubscribe?.();
    },
  };
}

describe("createEnvironmentConnection", () => {
  it("bootstraps a snapshot immediately for a new connection", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const { client, getBootstrapSnapshot } = createTestClient();
    const syncSnapshot = vi.fn();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot,
      applyTerminalEvent: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(getBootstrapSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotSequence: 1 }),
      environmentId,
      "bootstrap",
    );

    await connection.dispose();
  });

  it("rejects welcome/config identity drift", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const { client, emitWelcome } = createTestClient();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    expect(() => emitWelcome(EnvironmentId.make("env-2"))).toThrow(
      "Environment connection env-1 changed identity to env-2 via server lifecycle welcome.",
    );

    await connection.dispose();
  });

  it("rejects ensureBootstrapped when snapshot recovery fails", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const snapshotError = new Error("snapshot failed");
    const { client } = createTestClient({
      getBootstrapSnapshot: async () => {
        throw snapshotError;
      },
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    await expect(connection.ensureBootstrapped()).rejects.toThrow("snapshot failed");

    await connection.dispose();
  });

  it("retries replay recovery after transport disconnects during resubscribe", async () => {
    const environmentId = EnvironmentId.make("env-1");
    let replayAttempts = 0;
    const applyEventBatch = vi.fn();
    const { client, replayEvents, triggerDomainResubscribe } = createTestClient({
      replayEvents: async () => {
        replayAttempts += 1;
        if (replayAttempts === 1) {
          throw new Error("SocketCloseError: 1006");
        }

        return [
          {
            sequence: 2,
            type: "thread.created",
            payload: {},
          },
        ];
      },
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch,
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    triggerDomainResubscribe();

    await vi.waitFor(() => {
      expect(replayEvents).toHaveBeenCalledTimes(2);
      expect(applyEventBatch).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            sequence: 2,
          }),
        ],
        environmentId,
      );
    });

    await connection.dispose();
  });

  it("does not advance replay sequence when applying a domain event fails", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const applyError = new Error("projection cache write failed");
    let shouldThrowApplyError = true;
    const applyEventBatch = vi.fn(() => {
      if (shouldThrowApplyError) {
        throw applyError;
      }
    });
    const onDomainSyncFailure = vi.fn();
    const { client, emitDomainEvent, replayEvents } = createTestClient({
      replayEvents: async () => [
        {
          sequence: 2,
          type: "thread.updated",
          payload: {},
        },
        {
          sequence: 3,
          type: "thread.updated",
          payload: {},
        },
      ],
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch,
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
      onDomainSyncFailure,
    });

    await connection.ensureBootstrapped();

    emitDomainEvent(2);
    await Promise.resolve();

    expect(onDomainSyncFailure).toHaveBeenCalledWith({
      reason: "projection-replay-failed",
      error: applyError,
    });

    shouldThrowApplyError = false;
    emitDomainEvent(3);

    await vi.waitFor(() => {
      expect(replayEvents).toHaveBeenCalledWith({ fromSequenceExclusive: 1 });
      expect(applyEventBatch).toHaveBeenCalledWith(
        [expect.objectContaining({ sequence: 2 }), expect.objectContaining({ sequence: 3 })],
        environmentId,
      );
    });

    await connection.dispose();
  });

  it("swallows replay recovery failures triggered by resubscribe", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const snapshotError = new Error("snapshot failed");
    let snapshotCalls = 0;
    const { client, triggerDomainResubscribe } = createTestClient({
      getSnapshot: async () => {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          return {
            snapshotSequence: 1,
            projects: [],
            threads: [],
          } as any;
        }

        throw snapshotError;
      },
      replayEvents: async () => {
        throw new Error("SocketCloseError: 1006");
      },
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      triggerDomainResubscribe();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(onUnhandledRejection).not.toHaveBeenCalled();

    await connection.dispose();
  });

  it("waits for fresh shell and managed-process snapshots after reconnect", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const {
      client,
      emitManagedProcessSnapshot,
      emitShellSnapshot,
      triggerManagedProcessResubscribe,
      triggerShellResubscribe,
    } = createTestClient();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    await connection.ensureBootstrapped();

    const reconnectPromise = connection.reconnect();
    await Promise.resolve();
    triggerShellResubscribe();
    triggerManagedProcessResubscribe();
    await Promise.resolve();

    let settled = false;
    void reconnectPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    emitShellSnapshot(2);
    await Promise.resolve();

    expect(settled).toBe(false);

    emitManagedProcessSnapshot([]);
    await reconnectPromise;

    expect(client.reconnect).toHaveBeenCalledTimes(1);

    await connection.dispose();
  });

  it("serializes reconnect calls", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const releaseReconnects: Array<() => void> = [];
    const reconnectStarted: Promise<void>[] = [];
    const { client, emitManagedProcessSnapshot, emitShellSnapshot } = createTestClient({
      reconnect: () => {
        const started = Promise.resolve();
        reconnectStarted.push(started);
        return new Promise<void>((resolve) => {
          releaseReconnects.push(resolve);
        });
      },
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    const firstReconnect = connection.reconnect();
    const secondReconnect = connection.reconnect();
    await Promise.resolve();

    expect(client.reconnect).toHaveBeenCalledTimes(1);

    releaseReconnects.shift()?.();
    emitShellSnapshot(2);
    emitManagedProcessSnapshot([]);
    await reconnectStarted[0];

    await vi.waitFor(() => {
      expect(client.reconnect).toHaveBeenCalledTimes(2);
    });

    releaseReconnects.shift()?.();
    emitShellSnapshot(3);
    emitManagedProcessSnapshot([]);

    await Promise.all([firstReconnect, secondReconnect]);
    expect(client.reconnect).toHaveBeenCalledTimes(2);

    await connection.dispose();
  });

  it("times out reconnect when fresh snapshots never arrive", async () => {
    vi.useFakeTimers();
    const environmentId = EnvironmentId.make("env-1");
    const { client } = createTestClient();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    try {
      const reconnectPromise = connection.reconnect();
      await Promise.resolve();
      const reconnectExpectation = expect(reconnectPromise).rejects.toThrow(
        "Timed out waiting for shell snapshot after reconnect.",
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await reconnectExpectation;
    } finally {
      await connection.dispose();
      vi.useRealTimers();
    }
  });

  it("continues waiting on the newest snapshot gate after a reset", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const {
      client,
      emitManagedProcessSnapshot,
      emitShellSnapshot,
      triggerManagedProcessResubscribe,
      triggerShellResubscribe,
    } = createTestClient();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    const reconnectPromise = connection.reconnect();
    await Promise.resolve();
    await Promise.resolve();

    triggerShellResubscribe();
    triggerManagedProcessResubscribe();
    await Promise.resolve();

    emitShellSnapshot(2);
    emitManagedProcessSnapshot([]);

    await expect(reconnectPromise).resolves.toBeUndefined();
    await connection.dispose();
  });

  it("reports shell snapshot sync failures without throwing from the subscription", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const { client, emitShellSnapshot } = createTestClient();
    const syncError = new Error("shell cache write failed");
    let shouldThrowSyncError = true;
    const syncShellSnapshot = vi.fn(() => {
      if (shouldThrowSyncError) {
        throw syncError;
      }
    });
    const onDomainSyncFailure = vi.fn();
    const onDomainSyncSuccess = vi.fn();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot,
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
      onDomainSyncFailure,
      onDomainSyncSuccess,
    });

    await connection.ensureBootstrapped();

    expect(() => emitShellSnapshot(2)).not.toThrow();
    expect(onDomainSyncFailure).toHaveBeenCalledWith({
      reason: "shell-snapshot-failed",
      error: syncError,
    });

    shouldThrowSyncError = false;
    emitShellSnapshot(3);

    expect(onDomainSyncSuccess).toHaveBeenCalledWith("shell-snapshot-failed");

    await connection.dispose();
  });

  it("reports managed-process snapshot sync failures without throwing from the subscription", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const syncError = new Error("managed process cache write failed");
    const syncManagedProcessSnapshot = vi.fn(() => {
      throw syncError;
    });
    const onDomainSyncFailure = vi.fn();

    const { client } = createTestClient();

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot,
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
      onDomainSyncFailure,
    });

    expect(onDomainSyncFailure).toHaveBeenCalledWith({
      reason: "managed-process-snapshot-failed",
      error: syncError,
    });

    await connection.dispose();
  });

  it("skips browser-resume reconnects while the heartbeat is fresh", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const { client } = createTestClient({
      isHeartbeatFresh: () => true,
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    await expect(connection.requestReconnect("browser-resume")).resolves.toBe(false);

    expect(client.isHeartbeatFresh).toHaveBeenCalledOnce();
    expect(client.reconnect).not.toHaveBeenCalled();

    await connection.dispose();
  });

  it("coalesces stale browser-resume reconnect requests", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const releaseReconnects: Array<() => void> = [];
    const { client, emitManagedProcessSnapshot, emitShellSnapshot } = createTestClient({
      reconnect: () =>
        new Promise<void>((resolve) => {
          releaseReconnects.push(resolve);
        }),
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    const firstReconnect = connection.requestReconnect("browser-resume");
    const secondReconnect = connection.requestReconnect("browser-resume");
    await Promise.resolve();

    expect(client.isHeartbeatFresh).toHaveBeenCalledTimes(2);
    expect(client.reconnect).toHaveBeenCalledOnce();

    releaseReconnects.shift()?.();
    emitShellSnapshot(2);
    emitManagedProcessSnapshot([]);

    await expect(Promise.all([firstReconnect, secondReconnect])).resolves.toEqual([true, true]);
    expect(client.reconnect).toHaveBeenCalledOnce();

    await connection.dispose();
  });

  it("forces user retry reconnects even while the heartbeat is fresh", async () => {
    const environmentId = EnvironmentId.make("env-1");
    const { client, emitManagedProcessSnapshot, emitShellSnapshot } = createTestClient({
      isHeartbeatFresh: () => true,
    });

    const connection = createEnvironmentConnection({
      kind: "saved",
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      syncManagedProcessSnapshot: vi.fn(),
      syncShellSnapshot: vi.fn(),
      applyShellEvent: vi.fn(),
      applyEventBatch: vi.fn(),
      syncSnapshot: vi.fn(),
      applyTerminalEvent: vi.fn(),
    });

    const reconnectPromise = connection.requestReconnect("user-retry");
    await Promise.resolve();

    emitShellSnapshot(2);
    emitManagedProcessSnapshot([]);

    await expect(reconnectPromise).resolves.toBe(true);

    expect(client.isHeartbeatFresh).not.toHaveBeenCalled();
    expect(client.reconnect).toHaveBeenCalledOnce();

    await connection.dispose();
  });
});
