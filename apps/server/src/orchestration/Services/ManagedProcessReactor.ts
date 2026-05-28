/**
 * ManagedProcessReactor - Bridges the ManagedProcessManager lifecycle event
 * stream into the orchestration domain event pipeline and handles side-effects
 * for definition deletion (force-killing running instances).
 *
 * @module ManagedProcessReactor
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

/**
 * ManagedProcessReactorShape - Service API for managed process domain integration.
 */
export interface ManagedProcessReactorShape {
  /**
   * Start reacting to:
   * 1. ManagedProcessManager lifecycle events → inject into orchestration engine
   * 2. managed-process.definition-deleted domain events → force-kill affected instances
   *
   * Must be run in a scope so worker fibers are finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

/**
 * ManagedProcessReactor - Service tag.
 */
export class ManagedProcessReactor extends Context.Service<
  ManagedProcessReactor,
  ManagedProcessReactorShape
>()("t3/orchestration/Services/ManagedProcessReactor") {}
