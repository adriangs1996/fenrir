/**
 * SQLite client that owns its `node:sqlite` DatabaseSync connection inside a
 * `node:worker_threads` worker.
 *
 * `DatabaseSync` executes statements synchronously on the calling thread, so
 * hosting it on the server main thread freezes the entire event loop (WS
 * pings, upgrades, timers) for the duration of every statement — observed as
 * multi-second full-server stalls on slow queries over a multi-GB database.
 * Executing statements in a worker keeps the main event loop responsive while
 * preserving the strict single-connection statement ordering the rest of the
 * persistence layer assumes (the client serializes access with a
 * single-permit semaphore, so the worker sees a strict FIFO and transactions
 * hold the connection for their whole span).
 *
 * The worker source is embedded as a self-contained CommonJS string and
 * spawned with `eval: true`: it only uses node builtins, so no separate
 * worker entry file has to be emitted by the bundler or resolved inside the
 * packaged app (asar), in dev, or under vitest.
 *
 * @module NodeSqliteWorkerClient
 */
/* eslint-disable unicorn/require-post-message-target-origin -- worker_threads postMessage has no targetOrigin parameter */
import { Worker } from "node:worker_threads";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

import * as NodeSqliteClient from "./NodeSqliteClient.ts";
import type { SqliteClientConfig } from "./NodeSqliteClient.ts";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const TypeId: TypeId = "~local/sqlite-node-worker/SqliteClient";

export type TypeId = "~local/sqlite-node-worker/SqliteClient";

/**
 * SqliteWorkerClient - Effect service tag for the worker-hosted sqlite client.
 */
export const SqliteWorkerClient = Context.Service<Client.SqlClient>(
  "t3/persistence/NodeSqliteWorkerClient",
);

const READY_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 3_000;

type ExecuteMode = "objects" | "values" | "raw";

interface WorkerFailure {
  readonly message: string;
  readonly code?: string;
  readonly errcode?: number;
  readonly errstr?: string;
}

/**
 * Self-contained CommonJS worker. Mirrors the statement semantics of
 * `NodeSqliteClient` exactly: prepared-statement LRU cache, `columns()`-based
 * reader detection, `all()` for reads / `run()` for writes, `setReturnArrays`
 * for positional values, and `setReadBigInts` per request for SafeIntegers.
 */
const WORKER_SOURCE = /* js */ `
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

let db;
try {
  db = new DatabaseSync(workerData.filename, {
    readOnly: workerData.readonly === true,
    allowExtension: workerData.allowExtension === true,
  });
} catch (cause) {
  parentPort.postMessage({ kind: "init-error", error: serializeError(cause) });
  process.exit(0);
}

const cacheCapacity = workerData.prepareCacheSize > 0 ? workerData.prepareCacheSize : 200;
const prepareCache = new Map();
const readerCache = new WeakMap();

function serializeError(cause) {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      code: typeof cause.code === "string" ? cause.code : undefined,
      errcode: typeof cause.errcode === "number" ? cause.errcode : undefined,
      errstr: typeof cause.errstr === "string" ? cause.errstr : undefined,
    };
  }
  return { message: String(cause) };
}

function prepare(sql, useCache) {
  if (!useCache) {
    return db.prepare(sql);
  }
  let statement = prepareCache.get(sql);
  if (statement !== undefined) {
    // Refresh recency so hot statements survive the capacity cap.
    prepareCache.delete(sql);
    prepareCache.set(sql, statement);
    return statement;
  }
  statement = db.prepare(sql);
  prepareCache.set(sql, statement);
  if (prepareCache.size > cacheCapacity) {
    prepareCache.delete(prepareCache.keys().next().value);
  }
  return statement;
}

function hasRows(statement) {
  let value = readerCache.get(statement);
  if (value === undefined) {
    value = statement.columns().length > 0;
    readerCache.set(statement, value);
  }
  return value;
}

parentPort.on("message", (message) => {
  if (message.kind === "close") {
    try {
      db.close();
    } catch {}
    parentPort.postMessage({ kind: "closed" });
    return;
  }
  try {
    const statement = prepare(message.sql, message.cache === true);
    statement.setReadBigInts(message.safeIntegers === true);
    let rows;
    if (message.mode === "values") {
      if (hasRows(statement)) {
        statement.setReturnArrays(true);
        try {
          rows = statement.all(...message.params);
        } finally {
          statement.setReturnArrays(false);
        }
      } else {
        statement.run(...message.params);
        rows = [];
      }
    } else if (hasRows(statement)) {
      rows = statement.all(...message.params);
    } else {
      const result = statement.run(...message.params);
      rows = message.mode === "raw" ? result : [];
    }
    parentPort.postMessage({ id: message.id, rows });
  } catch (cause) {
    parentPort.postMessage({ id: message.id, error: serializeError(cause) });
  }
});

parentPort.postMessage({ kind: "ready" });
`;

const toSqlError = (failure: WorkerFailure, operation: "prepare" | "execute"): SqlError => {
  const cause = Object.assign(new Error(failure.message), {
    code: failure.code,
    errcode: failure.errcode,
    errstr: failure.errstr,
  });
  return new SqlError({
    reason: classifySqliteError(cause, {
      message:
        operation === "prepare" ? "Failed to prepare statement" : "Failed to execute statement",
      operation,
    }),
  });
};

interface WorkerBridge {
  readonly execute: (input: {
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
    readonly mode: ExecuteMode;
    readonly safeIntegers: boolean;
    readonly cache: boolean;
  }) => Effect.Effect<ReadonlyArray<any>, SqlError>;
}

const spawnWorkerBridge = Effect.fn("spawnWorkerBridge")(function* (
  options: SqliteClientConfig,
): Effect.fn.Return<WorkerBridge, Error, Scope.Scope> {
  const scope = yield* Effect.scope;

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      filename: options.filename,
      readonly: options.readonly ?? false,
      allowExtension: options.allowExtension ?? false,
      prepareCacheSize: options.prepareCacheSize ?? 200,
    },
  });

  interface Pending {
    readonly resolve: (rows: ReadonlyArray<any>) => void;
    readonly reject: (error: SqlError) => void;
  }
  const pending = new Map<number, Pending>();
  let nextRequestId = 0;
  let terminalFailure: Error | null = null;

  const failAllPending = (cause: Error) => {
    terminalFailure = cause;
    for (const [, entry] of pending) {
      entry.reject(
        new SqlError({
          reason: classifySqliteError(cause, {
            message: "SQLite worker terminated",
            operation: "execute",
          }),
        }),
      );
    }
    pending.clear();
  };

  yield* Effect.callback<void, Error>((resume) => {
    const onReady = (message: { kind?: string; id?: number; error?: WorkerFailure }) => {
      if (message.kind === "ready") {
        cleanup();
        resume(Effect.void);
      } else if (message.kind === "init-error") {
        cleanup();
        resume(
          Effect.fail(
            new Error(`SQLite worker failed to open database: ${message.error?.message}`),
          ),
        );
      }
    };
    const onError = (cause: Error) => {
      cleanup();
      resume(Effect.fail(cause));
    };
    const onExit = (code: number) => {
      cleanup();
      resume(Effect.fail(new Error(`SQLite worker exited during startup (code ${code})`)));
    };
    const timeout = setTimeout(() => {
      cleanup();
      resume(Effect.fail(new Error("SQLite worker did not become ready in time")));
    }, READY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off("message", onReady);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onReady);
    worker.on("error", onError);
    worker.on("exit", onExit);
  }).pipe(
    Effect.onError(() =>
      Effect.promise(() => worker.terminate().then(() => undefined)).pipe(Effect.ignore),
    ),
  );

  worker.on(
    "message",
    (message: { id?: number; rows?: ReadonlyArray<any>; error?: WorkerFailure }) => {
      if (message.id === undefined) {
        return;
      }
      const entry = pending.get(message.id);
      if (entry === undefined) {
        return;
      }
      pending.delete(message.id);
      if (message.error !== undefined) {
        entry.reject(toSqlError(message.error, "execute"));
      } else {
        entry.resolve(message.rows ?? []);
      }
    },
  );
  worker.on("error", (cause) => {
    failAllPending(cause);
  });
  worker.on("exit", (code) => {
    if (terminalFailure === null) {
      failAllPending(new Error(`SQLite worker exited unexpectedly (code ${code})`));
    }
  });

  yield* Scope.addFinalizer(
    scope,
    Effect.promise(async () => {
      // Ask the worker to close the database cleanly (flushes the WAL); fall
      // back to termination if it does not answer in time.
      const closed = new Promise<void>((resolve) => {
        const onMessage = (message: { kind?: string }) => {
          if (message.kind === "closed") {
            worker.off("message", onMessage);
            resolve();
          }
        };
        worker.on("message", onMessage);
        try {
          worker.postMessage({ kind: "close" });
        } catch {
          resolve();
        }
      });
      await Promise.race([
        closed,
        new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
      ]);
      await worker.terminate();
    }).pipe(Effect.ignore),
  );

  const execute: WorkerBridge["execute"] = (input) =>
    Effect.callback<ReadonlyArray<any>, SqlError>((resume) => {
      if (terminalFailure !== null) {
        resume(
          Effect.fail(
            new SqlError({
              reason: classifySqliteError(terminalFailure, {
                message: "SQLite worker terminated",
                operation: "execute",
              }),
            }),
          ),
        );
        return;
      }
      const id = nextRequestId++;
      pending.set(id, {
        resolve: (rows) => resume(Effect.succeed(rows)),
        reject: (error) => resume(Effect.fail(error)),
      });
      worker.postMessage({
        id,
        sql: input.sql,
        params: input.params,
        mode: input.mode,
        safeIntegers: input.safeIntegers,
        cache: input.cache,
      });
    });

  return { execute };
});

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, Error, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const bridge = yield* spawnWorkerBridge(options);

    const run = (sql: string, params: ReadonlyArray<unknown>, mode: ExecuteMode, cache: boolean) =>
      Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) =>
        bridge.execute({
          sql,
          params,
          mode,
          safeIntegers: Boolean(Context.get(fiber.context, Client.SafeIntegers)),
          cache,
        }),
      );

    const connection: Connection = {
      execute(sql, params, rowTransform) {
        const effect = run(sql, params, "objects", true);
        return rowTransform ? Effect.map(effect, rowTransform) : effect;
      },
      executeRaw(sql, params) {
        return run(sql, params, "raw", true);
      },
      executeValues(sql, params) {
        return run(sql, params, "values", true);
      },
      executeUnprepared(sql, params, rowTransform) {
        const effect = run(sql, params ?? [], "objects", false);
        return rowTransform ? Effect.map(effect, rowTransform) : effect;
      },
      executeStream(_sql, _params) {
        return Stream.die("executeStream not implemented");
      },
    };

    const semaphore = yield* Semaphore.make(1);
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = Context.getUnsafe(fiber.context, Scope.Scope);
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () =>
          Scope.addFinalizer(scope, semaphore.release(1)),
        ),
        connection,
      );
    });

    return yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transformRows,
    });
  });

/**
 * Build the worker-hosted client, degrading to the in-process synchronous
 * driver when the worker cannot start (exotic packaging, missing
 * worker_threads support). A degraded server is slower under heavy queries
 * but never fails to boot because of the worker.
 */
const makeWithFallback = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  make(options).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("SQLite worker unavailable, using in-process driver").pipe(
        Effect.annotateLogs({ cause: String(cause) }),
        Effect.andThen(NodeSqliteClient.make(options)),
      ),
    ),
  );

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(makeWithFallback(config), (client) =>
      Context.make(SqliteWorkerClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
  Layer.effectContext(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(makeWithFallback),
        Effect.map((client) =>
          Context.make(SqliteWorkerClient, client).pipe(Context.add(Client.SqlClient, client)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));
