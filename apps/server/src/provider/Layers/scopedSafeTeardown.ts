import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

/**
 * Run a scope-requiring effect while preserving the body's result if scope
 * finalizers fail during teardown.
 */
export const scopedSafeTeardown =
  (label: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const bodyExit = yield* effect.pipe(Effect.provideService(Scope.Scope, scope), Effect.exit);
      yield* Scope.close(scope, Exit.void).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`${label} teardown errored; preserving body result`, cause),
        ),
      );
      return yield* bodyExit;
    }) as Effect.Effect<A, E, Exclude<R, Scope.Scope>>;
