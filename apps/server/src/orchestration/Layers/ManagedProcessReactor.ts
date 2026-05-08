/**
 * ManagedProcessReactor - Layer implementation.
 *
 * Two concurrent subscriptions:
 *
 * 1. **Lifecycle fan-in**: Subscribes to ManagedProcessManager.events and
 *    converts each ManagerLifecycleEvent into an OrchestrationEvent, then
 *    injects it into the OrchestrationEngine (read-model update + PubSub
 *    fan-out). These events are ephemeral — they are NOT persisted to the
 *    event store and are reconstructed from the manager on restart.
 *
 * 2. **Definition-delete side-effect**: Subscribes to orchestration domain
 *    events and force-kills running instances when their definition is
 *    deleted.
 *
 * @module ManagedProcessReactor
 */
import type { OrchestrationEvent } from "@fenrir/contracts";
import { Cause, Effect, Layer, Stream } from "effect";

import type { ManagerLifecycleEvent } from "../../managedProcess/Services/Manager.ts";
import { ManagedProcessManager } from "../../managedProcess/Services/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ManagedProcessReactor,
  type ManagedProcessReactorShape,
} from "../Services/ManagedProcessReactor.ts";

// ---------------------------------------------------------------------------
// ManagerLifecycleEvent → OrchestrationEvent (sans sequence)
// ---------------------------------------------------------------------------

function toOrchestrationEvent(event: ManagerLifecycleEvent): Omit<OrchestrationEvent, "sequence"> {
  const base = {
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: "project" as const,
    aggregateId: "" as OrchestrationEvent["aggregateId"],
    occurredAt: new Date().toISOString(),
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };

  switch (event.type) {
    case "started":
      return {
        ...base,
        aggregateId: event.instance.projectId as unknown as OrchestrationEvent["aggregateId"],
        type: "managed-process.instance-started",
        payload: { instance: event.instance },
      };
    case "stateChanged":
      return {
        ...base,
        type: "managed-process.instance-state-changed",
        payload: {
          instanceId: event.instanceId,
          prev: event.prev,
          next: event.next,
          exitCode: event.exitCode,
          exitSignal: event.exitSignal,
          lastError: event.lastError,
          occurredAt: base.occurredAt,
        },
      };
    case "readyChanged":
      return {
        ...base,
        type: "managed-process.instance-ready-changed",
        payload: {
          instanceId: event.instanceId,
          ready: event.ready,
          url: event.url,
          occurredAt: base.occurredAt,
        },
      };
    case "exited":
      return {
        ...base,
        type: "managed-process.instance-exited",
        payload: {
          instanceId: event.instanceId,
          exitCode: event.exitCode,
          exitSignal: event.exitSignal,
          userInitiated: event.userInitiated,
          occurredAt: base.occurredAt,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const manager = yield* ManagedProcessManager;

  const start: ManagedProcessReactorShape["start"] = Effect.fn("start")(function* () {
    // 1. Fan-in: manager lifecycle events → orchestration engine
    yield* Effect.forkScoped(
      Stream.runForEach(manager.events, (lifecycleEvent) =>
        orchestrationEngine.injectExternalEvent(toOrchestrationEvent(lifecycleEvent)).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.failCause(cause);
            }
            return Effect.logWarning("ManagedProcessReactor: failed to inject lifecycle event", {
              eventType: lifecycleEvent.type,
              cause: Cause.pretty(cause),
            });
          }),
        ),
      ),
    );

    // 2. Side-effect: force-kill instances when their definition is deleted
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "managed-process.definition-deleted") {
          return Effect.void;
        }
        const { projectId, processDefId } = event.payload;
        return Effect.gen(function* () {
          const instances = yield* manager.list(projectId);
          const affected = instances.filter(
            (inst) =>
              inst.processDefId === processDefId &&
              inst.status !== "stopped" &&
              inst.status !== "idle",
          );
          for (const inst of affected) {
            yield* manager.forceKill(inst.instanceId).pipe(
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) {
                  return Effect.failCause(cause);
                }
                return Effect.logWarning(
                  "ManagedProcessReactor: failed to force-kill instance after definition delete",
                  {
                    instanceId: inst.instanceId,
                    processDefId,
                    cause: Cause.pretty(cause),
                  },
                );
              }),
            );
          }
        });
      }),
    );
  });

  return { start } satisfies ManagedProcessReactorShape;
});

export const ManagedProcessReactorLive = Layer.effect(ManagedProcessReactor, make);
