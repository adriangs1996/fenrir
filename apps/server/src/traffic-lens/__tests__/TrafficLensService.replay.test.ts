import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { TrafficLensService } from "../Services/TrafficLensService";
import { TrafficLensServiceLive } from "../Layers/TrafficLensService";

const layer = it.layer(TrafficLensServiceLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("TrafficLensService — replayRequest", (it) => {
  it.effect("sends GET and returns response", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/get",
        headers: { Accept: "application/json" },
      });

      assert.strictEqual(result.statusCode, 200);
      assert.ok(result.body);
      assert.ok(result.timing > 0);
      assert.ok(result.headers["content-type"]);
    }),
  );

  it.effect("sends POST with body", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "POST",
        url: "https://httpbin.org/post",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ test: true })).toString("base64"),
      });

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(Buffer.from(result.body!, "base64").toString());
      assert.deepStrictEqual(body.json, { test: true });
    }),
  );

  it.effect("does not follow redirects (manual mode)", () =>
    Effect.gen(function* () {
      const service = yield* TrafficLensService;
      const result = yield* service.replayRequest({
        method: "GET",
        url: "https://httpbin.org/redirect/1",
        headers: {},
      });

      assert.strictEqual(result.statusCode, 302);
    }),
  );

  it.effect("returns TrafficLensError for unreachable host", () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const service = yield* TrafficLensService;
        return yield* service.replayRequest({
          method: "GET",
          url: "https://this-host-does-not-exist-12345.invalid/",
          headers: {},
        });
      }).pipe(Effect.result);

      assert.strictEqual(result._tag, "Failure");
    }),
  );
});
