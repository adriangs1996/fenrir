import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { TrafficLensService } from "../Services/TrafficLensService";
import { TrafficLensServiceLive } from "../Layers/TrafficLensService";

const layer = it.layer(TrafficLensServiceLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const makeReplayTarget = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{
        readonly baseUrl: string;
        readonly close: () => Promise<void>;
      }>((resolve, reject) => {
        const server = NodeHttp.createServer((request, response) => {
          const chunks: Buffer[] = [];

          request.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          request.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");

            if (request.url === "/get") {
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ method: request.method, url: request.url }));
              return;
            }

            if (request.url === "/post") {
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify({
                  json: body ? JSON.parse(body) : null,
                  method: request.method,
                }),
              );
              return;
            }

            if (request.url === "/redirect/1") {
              response.statusCode = 302;
              response.setHeader("Location", "/get");
              response.end();
              return;
            }

            response.statusCode = 404;
            response.end();
          });
        });

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address() as AddressInfo | null;
          if (!address) {
            reject(new Error("Expected replay target to listen on a TCP address"));
            return;
          }

          resolve({
            baseUrl: `http://127.0.0.1:${address.port}`,
            close: () =>
              new Promise<void>((resolveClose, rejectClose) => {
                server.close((error) => {
                  if (error) {
                    rejectClose(error);
                    return;
                  }
                  resolveClose();
                });
              }),
          });
        });
      }),
  ),
  (server) => Effect.promise(() => server.close()),
);

layer("TrafficLensService — replayRequest", (it) => {
  it.effect("sends GET and returns response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* makeReplayTarget;
        const service = yield* TrafficLensService;
        const result = yield* service.replayRequest({
          method: "GET",
          url: `${target.baseUrl}/get`,
          headers: { Accept: "application/json" },
        });

        assert.strictEqual(result.statusCode, 200);
        assert.ok(result.body);
        assert.ok(result.timing > 0);
        assert.ok(result.headers["content-type"]);
      }),
    ),
  );

  it.effect("sends POST with body", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* makeReplayTarget;
        const service = yield* TrafficLensService;
        const result = yield* service.replayRequest({
          method: "POST",
          url: `${target.baseUrl}/post`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify({ test: true })).toString("base64"),
        });

        assert.strictEqual(result.statusCode, 200);
        const body = JSON.parse(Buffer.from(result.body!, "base64").toString());
        assert.deepStrictEqual(body.json, { test: true });
      }),
    ),
  );

  it.effect("does not follow redirects (manual mode)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = yield* makeReplayTarget;
        const service = yield* TrafficLensService;
        const result = yield* service.replayRequest({
          method: "GET",
          url: `${target.baseUrl}/redirect/1`,
          headers: {},
        });

        assert.strictEqual(result.statusCode, 302);
      }),
    ),
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
