/**
 * OrchestrationEngineService - Service interface for orchestration command handling.
 *
 * Owns command validation/dispatch and in-memory read-model updates backed by
 * `OrchestrationEventStore` persistence. It does not own provider process
 * management or transport concerns (e.g. websocket request parsing).
 *
 * Uses Effect `ServiceMap.Service` for dependency injection. Command dispatch,
 * replay, and unknown-input decoding all return typed domain errors.
 *
 * @module OrchestrationEngineService
 */
import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@fenrir/contracts";
import { Context } from "effect";
import type { Effect, Scope, Stream } from "effect";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";

/**
 * OrchestrationEngineShape - Service API for orchestration command and event flow.
 */
export interface OrchestrationEngineShape {
  /**
   * Read the current in-memory orchestration read model.
   *
   * @returns Effect containing the latest read model.
   */
  readonly getReadModel: () => Effect.Effect<OrchestrationReadModel, never, never>;

  /**
   * Replay persisted orchestration events from an exclusive sequence cursor.
   *
   * @param fromSequenceExclusive - Sequence cursor (exclusive).
   * @returns Stream containing ordered events.
   */
  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  /**
   * Dispatch a validated orchestration command.
   *
   * @param command - Valid orchestration command.
   * @returns Effect containing the sequence of the persisted event.
   *
   * Dispatch is serialized through an internal queue and deduplicated via
   * command receipts.
   */
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never>;

  /**
   * Stream persisted domain events in dispatch order.
   *
   * This is a hot runtime stream (new events only), not a historical replay.
   * The underlying PubSub subscription is only created when the stream is
   * first pulled — events published before that are not delivered.
   */
  readonly streamDomainEvents: Stream.Stream<OrchestrationEvent>;

  /**
   * Eagerly subscribe to domain events, buffering from the moment the effect
   * runs. Use this instead of `streamDomainEvents` when events must not be
   * lost between a snapshot read and stream consumption: subscribe first,
   * then read the snapshot, then drain the returned stream. The subscription
   * is released when the provided Scope closes.
   */
  readonly subscribeDomainEvents: Effect.Effect<
    Stream.Stream<OrchestrationEvent>,
    never,
    Scope.Scope
  >;

  /**
   * Inject an external (non-command-originated) event into the read model and
   * event fan-out. The event is NOT persisted to the event store — it is
   * ephemeral and must be reconstructed on restart (e.g. managed process
   * lifecycle events rebuilt from manager reconciliation).
   */
  readonly injectExternalEvent: (
    event: Omit<OrchestrationEvent, "sequence">,
  ) => Effect.Effect<void>;
}

/**
 * OrchestrationEngineService - Service tag for orchestration engine access.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const engine = yield* OrchestrationEngineService
 *   return yield* engine.getReadModel()
 * })
 * ```
 */
export class OrchestrationEngineService extends Context.Service<
  OrchestrationEngineService,
  OrchestrationEngineShape
>()("t3/orchestration/Services/OrchestrationEngine/OrchestrationEngineService") {}
