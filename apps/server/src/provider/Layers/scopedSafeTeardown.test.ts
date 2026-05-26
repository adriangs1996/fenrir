import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { describe, expect, it } from "vitest";

import { scopedSafeTeardown } from "./scopedSafeTeardown";

describe("scopedSafeTeardown", () => {
  it("preserves a successful body result when finalizer teardown dies", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        yield* Scope.addFinalizer(scope, Effect.die(new Error("teardown failed")));
        return "provider-ready";
      }).pipe(scopedSafeTeardown("test-provider-probe")),
    );

    expect(result).toBe("provider-ready");
  });
});
