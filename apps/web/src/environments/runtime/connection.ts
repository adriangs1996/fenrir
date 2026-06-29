import type {
  EnvironmentId,
  OrchestrationManagedProcessSnapshot,
  OrchestrationBootstrapSnapshot,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  ServerConfig,
  ServerLifecycleWelcomePayload,
  TerminalEvent,
} from "@fenrir/contracts";
import type { KnownEnvironment } from "@fenrir/client-runtime";

import {
  deriveReplayRetryDecision,
  type OrchestrationRecoveryReason,
} from "../../orchestrationRecovery";
import {
  createOrchestrationRecoveryCoordinator,
  type ReplayRetryTracker,
} from "../../orchestrationRecovery";
import { isTransportConnectionErrorMessage } from "~/rpc/transportError";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

const REPLAY_RECOVERY_RETRY_DELAY_MS = 100;
const MAX_NO_PROGRESS_REPLAY_RETRIES = 3;
const RECOVERY_TRANSPORT_RETRY_DELAY_MS = 250;
const MAX_RECOVERY_TRANSPORT_RETRIES = 20;
const RECONNECT_SNAPSHOT_GATE_TIMEOUT_MS = 5_000;

export interface EnvironmentConnection {
  readonly kind: "primary" | "saved";
  readonly environmentId: EnvironmentId;
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly ensureBootstrapped: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly requestReconnect: (reason: EnvironmentReconnectReason) => Promise<boolean>;
  readonly dispose: () => Promise<void>;
}

export type EnvironmentReconnectReason = "browser-resume" | "user-retry";

export type EnvironmentDomainSyncFailureReason =
  | "projection-replay-failed"
  | "projection-snapshot-failed"
  | "shell-event-failed"
  | "shell-snapshot-failed"
  | "managed-process-snapshot-failed"
  | "thread-snapshot-failed";

export interface EnvironmentDomainSyncFailure {
  readonly reason: EnvironmentDomainSyncFailureReason;
  readonly error: unknown;
}

interface OrchestrationHandlers {
  readonly syncManagedProcessSnapshot: (
    snapshot: OrchestrationManagedProcessSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  readonly syncShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  readonly applyShellEvent: (
    event: OrchestrationShellStreamEvent,
    environmentId: EnvironmentId,
  ) => void;
  readonly applyEventBatch: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  readonly syncSnapshot: (
    snapshot: OrchestrationBootstrapSnapshot | OrchestrationReadModel,
    environmentId: EnvironmentId,
    detailLevel: "bootstrap" | "full",
  ) => void;
  readonly applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => void;
}

interface EnvironmentConnectionInput extends OrchestrationHandlers {
  readonly kind: "primary" | "saved";
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly refreshMetadata?: () => Promise<void>;
  readonly onDomainSyncFailure?: (failure: EnvironmentDomainSyncFailure) => void;
  readonly onDomainSyncSuccess?: (reason: EnvironmentDomainSyncFailureReason) => void;
  readonly onConfigSnapshot?: (config: ServerConfig) => void;
  readonly onWelcome?: (payload: ServerLifecycleWelcomePayload) => void;
}

class SnapshotGateResetError extends Error {
  constructor() {
    super("Snapshot gate was reset.");
    this.name = "SnapshotGateResetError";
  }
}

function isSnapshotGateResetError(error: unknown): error is SnapshotGateResetError {
  return error instanceof SnapshotGateResetError;
}

function createSnapshotGate() {
  let resolve: (() => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  let waiterCount = 0;
  let promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    wait: () => {
      waiterCount += 1;
      return promise.finally(() => {
        waiterCount = Math.max(0, waiterCount - 1);
      });
    },
    resolve: () => {
      resolve?.();
      resolve = null;
      reject = null;
    },
    reject: (error: unknown) => {
      if (waiterCount > 0) {
        reject?.(error);
      }
      resolve = null;
      reject = null;
    },
    reset: () => {
      if (waiterCount > 0) {
        reject?.(new SnapshotGateResetError());
      }
      promise = new Promise<void>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      });
    },
  };
}

async function waitForSnapshotGate(input: {
  readonly wait: () => Promise<void>;
  readonly timeoutMs: number;
  readonly label: string;
}): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    const remainingMs = input.timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for ${input.label} snapshot after reconnect.`);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${input.label} snapshot after reconnect.`));
        }, remainingMs);
        input
          .wait()
          .then(resolve, reject)
          .finally(() => {
            clearTimeout(timeoutId);
          });
      });
      return;
    } catch (error) {
      if (isSnapshotGateResetError(error)) {
        continue;
      }
      throw error;
    }
  }
}

function createSnapshotBootstrapController(input: {
  readonly isBootstrapped: () => boolean;
  readonly runSnapshotRecovery: (
    reason: Extract<OrchestrationRecoveryReason, "bootstrap" | "replay-failed">,
  ) => Promise<void>;
}) {
  let inFlight: Promise<void> | null = null;

  return {
    ensureSnapshotRecovery(
      reason: Extract<OrchestrationRecoveryReason, "bootstrap" | "replay-failed">,
    ): Promise<void> {
      if (input.isBootstrapped()) {
        return Promise.resolve();
      }

      if (inFlight !== null) {
        return inFlight;
      }

      const nextInFlight = input.runSnapshotRecovery(reason).finally(() => {
        if (inFlight === nextInFlight) {
          inFlight = null;
        }
      });
      inFlight = nextInFlight;
      return inFlight;
    },
  };
}

export function createEnvironmentConnection(
  input: EnvironmentConnectionInput,
): EnvironmentConnection {
  const recovery = createOrchestrationRecoveryCoordinator();
  let replayRetryTracker: ReplayRetryTracker | null = null;
  const pendingDomainEvents: OrchestrationEvent[] = [];
  let flushPendingDomainEventsScheduled = false;
  const environmentId = input.knownEnvironment.environmentId;

  if (!environmentId) {
    throw new Error(
      `Known environment ${input.knownEnvironment.label} is missing its environmentId.`,
    );
  }

  let disposed = false;
  let reconnectChain: Promise<void> = Promise.resolve();
  let browserResumeReconnectInFlight: Promise<boolean> | null = null;
  const shellSnapshotGate = createSnapshotGate();
  const managedProcessSnapshotGate = createSnapshotGate();

  const observeEnvironmentIdentity = (nextEnvironmentId: EnvironmentId, source: string) => {
    if (environmentId !== nextEnvironmentId) {
      throw new Error(
        `Environment connection ${environmentId} changed identity to ${nextEnvironmentId} via ${source}.`,
      );
    }
  };

  const flushPendingDomainEvents = () => {
    flushPendingDomainEventsScheduled = false;
    if (disposed || pendingDomainEvents.length === 0) {
      return;
    }

    const events = pendingDomainEvents.splice(0, pendingDomainEvents.length);
    applyProjectionEvents(events);
  };

  const schedulePendingDomainEventFlush = () => {
    if (flushPendingDomainEventsScheduled) {
      return;
    }

    flushPendingDomainEventsScheduled = true;
    queueMicrotask(flushPendingDomainEvents);
  };

  const retryTransportRecoveryOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          disposed ||
          !isTransportConnectionErrorMessage(message) ||
          attempt >= MAX_RECOVERY_TRANSPORT_RETRIES - 1
        ) {
          throw error;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, RECOVERY_TRANSPORT_RETRY_DELAY_MS);
        });

        if (disposed) {
          throw error;
        }
      }
    }
  };
  const reportDomainSyncFailure = (failure: EnvironmentDomainSyncFailure) => {
    input.onDomainSyncFailure?.(failure);
  };
  const reportDomainSyncSuccess = (reason: EnvironmentDomainSyncFailureReason) => {
    input.onDomainSyncSuccess?.(reason);
  };

  const applyDomainSync = (
    reason: EnvironmentDomainSyncFailureReason,
    operation: () => void,
  ): boolean => {
    try {
      operation();
      reportDomainSyncSuccess(reason);
      return true;
    } catch (error) {
      reportDomainSyncFailure({ reason, error });
      return false;
    }
  };

  const applyProjectionEvents = (events: ReadonlyArray<OrchestrationEvent>): boolean => {
    const latestSequence = recovery.getState().latestSequence;
    const nextEvents = events
      .filter((event) => event.sequence > latestSequence)
      .toSorted((left, right) => left.sequence - right.sequence);
    if (nextEvents.length === 0) {
      return true;
    }

    const didSync = applyDomainSync("projection-replay-failed", () => {
      input.applyEventBatch(nextEvents, environmentId);
    });
    if (!didSync) {
      return false;
    }

    recovery.markEventBatchApplied(nextEvents);
    return true;
  };

  const scheduleReplayRecovery = (reason: "sequence-gap" | "resubscribe") => {
    void runReplayRecovery(reason).catch((error: unknown) => {
      if (!disposed) {
        reportDomainSyncFailure({ reason: "projection-replay-failed", error });
      }
    });
  };

  const runReplayRecovery = async (reason: "sequence-gap" | "resubscribe"): Promise<void> => {
    if (!recovery.beginReplayRecovery(reason)) {
      return;
    }

    const fromSequenceExclusive = recovery.getState().latestSequence;
    try {
      const events = await retryTransportRecoveryOperation(() =>
        input.client.orchestration.replayEvents({ fromSequenceExclusive }),
      );
      if (!disposed) {
        const didSync = applyProjectionEvents(events);
        if (!didSync) {
          replayRetryTracker = null;
          recovery.failReplayRecovery();
          try {
            await snapshotBootstrap.ensureSnapshotRecovery("replay-failed");
          } catch (snapshotError) {
            reportDomainSyncFailure({
              reason: "projection-snapshot-failed",
              error: snapshotError,
            });
          }
          return;
        }
      }
    } catch (error) {
      replayRetryTracker = null;
      recovery.failReplayRecovery();
      if (disposed) {
        return;
      }
      try {
        await snapshotBootstrap.ensureSnapshotRecovery("replay-failed");
      } catch (snapshotError) {
        reportDomainSyncFailure({ reason: "projection-snapshot-failed", error: snapshotError });
      }
      reportDomainSyncFailure({ reason: "projection-replay-failed", error });
      return;
    }

    if (disposed) {
      return;
    }

    const replayCompletion = recovery.completeReplayRecovery();
    const retryDecision = deriveReplayRetryDecision({
      previousTracker: replayRetryTracker,
      completion: replayCompletion,
      recoveryState: recovery.getState(),
      baseDelayMs: REPLAY_RECOVERY_RETRY_DELAY_MS,
      maxNoProgressRetries: MAX_NO_PROGRESS_REPLAY_RETRIES,
    });
    replayRetryTracker = retryDecision.tracker;

    if (retryDecision.shouldRetry) {
      if (retryDecision.delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, retryDecision.delayMs);
        });
        if (disposed) {
          return;
        }
      }
      scheduleReplayRecovery(reason);
    } else if (replayCompletion.shouldReplay && import.meta.env.MODE !== "test") {
      console.warn(
        "[orchestration-recovery]",
        "Stopping replay recovery after no-progress retries.",
        {
          environmentId,
          state: recovery.getState(),
        },
      );
    }
  };

  const runSnapshotRecovery = async (
    reason: Extract<OrchestrationRecoveryReason, "bootstrap" | "replay-failed">,
  ): Promise<void> => {
    const started = recovery.beginSnapshotRecovery(reason);
    if (!started) {
      return;
    }

    try {
      const snapshot: OrchestrationBootstrapSnapshot | OrchestrationReadModel =
        reason === "bootstrap"
          ? await retryTransportRecoveryOperation(() =>
              input.client.orchestration.getBootstrapSnapshot(),
            )
          : await retryTransportRecoveryOperation(() => input.client.orchestration.getSnapshot());
      if (!disposed) {
        const didSync = applyDomainSync("projection-snapshot-failed", () => {
          input.syncSnapshot(
            snapshot,
            environmentId,
            reason === "bootstrap" ? "bootstrap" : "full",
          );
        });
        if (!didSync) {
          recovery.failSnapshotRecovery();
          return;
        }
        if (recovery.completeSnapshotRecovery(snapshot.snapshotSequence)) {
          scheduleReplayRecovery("sequence-gap");
        }
      }
    } catch (error) {
      recovery.failSnapshotRecovery();
      throw error;
    }
  };

  const snapshotBootstrap = createSnapshotBootstrapController({
    isBootstrapped: () => recovery.getState().bootstrapped,
    runSnapshotRecovery,
  });

  const unsubLifecycle = input.client.server.subscribeLifecycle(
    (event: Parameters<Parameters<WsRpcClient["server"]["subscribeLifecycle"]>[0]>[0]) => {
      if (event.type !== "welcome") {
        return;
      }
      observeEnvironmentIdentity(
        event.payload.environment.environmentId,
        "server lifecycle welcome",
      );
      input.onWelcome?.(event.payload);
    },
  );

  const unsubConfig = input.client.server.subscribeConfig(
    (event: Parameters<Parameters<WsRpcClient["server"]["subscribeConfig"]>[0]>[0]) => {
      if (event.type !== "snapshot") {
        return;
      }
      observeEnvironmentIdentity(event.config.environment.environmentId, "server config snapshot");
      input.onConfigSnapshot?.(event.config);
    },
  );

  const unsubShell = input.client.orchestration.subscribeShell(
    (item: Parameters<Parameters<WsRpcClient["orchestration"]["subscribeShell"]>[0]>[0]) => {
      if (item.kind === "snapshot") {
        if (recovery.getState().bootstrapped) {
          applyDomainSync("shell-snapshot-failed", () => {
            input.syncShellSnapshot(item.snapshot, environmentId);
          });
        }
        shellSnapshotGate.resolve();
        return;
      }
      applyDomainSync("shell-event-failed", () => {
        input.applyShellEvent(item, environmentId);
      });
    },
    {
      onResubscribe: () => {
        if (disposed) {
          return;
        }
        shellSnapshotGate.reset();
      },
    },
  );

  const unsubManagedProcesses = input.client.orchestration.subscribeManagedProcesses(
    (
      item: Parameters<Parameters<WsRpcClient["orchestration"]["subscribeManagedProcesses"]>[0]>[0],
    ) => {
      applyDomainSync("managed-process-snapshot-failed", () => {
        input.syncManagedProcessSnapshot(item.snapshot, environmentId);
      });
      managedProcessSnapshotGate.resolve();
    },
    {
      onResubscribe: () => {
        if (disposed) {
          return;
        }
        managedProcessSnapshotGate.reset();
      },
    },
  );

  const unsubDomainEvent = input.client.orchestration.onDomainEvent(
    (event: Parameters<Parameters<WsRpcClient["orchestration"]["onDomainEvent"]>[0]>[0]) => {
      const action = recovery.classifyDomainEvent(event.sequence);
      if (action === "apply") {
        pendingDomainEvents.push(event);
        schedulePendingDomainEventFlush();
        return;
      }
      if (action === "recover") {
        flushPendingDomainEvents();
        scheduleReplayRecovery("sequence-gap");
      }
    },
    {
      onResubscribe: () => {
        if (disposed) {
          return;
        }
        flushPendingDomainEvents();
        scheduleReplayRecovery("resubscribe");
      },
    },
  );

  const unsubTerminalEvent = input.client.terminal.onEvent(
    (event: Parameters<Parameters<WsRpcClient["terminal"]["onEvent"]>[0]>[0]) => {
      input.applyTerminalEvent(event, environmentId);
    },
  );

  void snapshotBootstrap.ensureSnapshotRecovery("bootstrap").catch(() => undefined);

  const cleanup = () => {
    disposed = true;
    flushPendingDomainEventsScheduled = false;
    pendingDomainEvents.length = 0;
    unsubShell();
    unsubManagedProcesses();
    unsubDomainEvent();
    unsubTerminalEvent();
    unsubLifecycle();
    unsubConfig();
    shellSnapshotGate.reject(new Error("Environment connection disposed."));
    managedProcessSnapshotGate.reject(new Error("Environment connection disposed."));
  };

  const reconnect = async (): Promise<void> => {
    const reconnectOperation = reconnectChain.then(async () => {
      if (disposed) {
        throw new Error("Environment connection disposed.");
      }

      shellSnapshotGate.reset();
      managedProcessSnapshotGate.reset();
      await input.client.reconnect();
      await input.refreshMetadata?.();
      await Promise.all([
        waitForSnapshotGate({
          wait: shellSnapshotGate.wait,
          timeoutMs: RECONNECT_SNAPSHOT_GATE_TIMEOUT_MS,
          label: "shell",
        }),
        waitForSnapshotGate({
          wait: managedProcessSnapshotGate.wait,
          timeoutMs: RECONNECT_SNAPSHOT_GATE_TIMEOUT_MS,
          label: "managed process",
        }),
      ]);
      await snapshotBootstrap.ensureSnapshotRecovery("bootstrap");
    });
    reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  };

  return {
    kind: input.kind,
    environmentId,
    knownEnvironment: input.knownEnvironment,
    client: input.client,
    ensureBootstrapped: () => snapshotBootstrap.ensureSnapshotRecovery("bootstrap"),
    reconnect,
    requestReconnect: async (reason) => {
      if (reason === "user-retry") {
        await reconnect();
        return true;
      }

      if (input.client.isHeartbeatFresh()) {
        return false;
      }

      if (browserResumeReconnectInFlight) {
        return browserResumeReconnectInFlight;
      }

      const reconnectRequest = reconnect()
        .then(() => true)
        .finally(() => {
          if (browserResumeReconnectInFlight === reconnectRequest) {
            browserResumeReconnectInFlight = null;
          }
        });
      browserResumeReconnectInFlight = reconnectRequest;
      return reconnectRequest;
    },
    dispose: async () => {
      cleanup();
      await input.client.dispose();
    },
  };
}
