import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  ManagedProcess,
  ManagedProcessInstance,
  ManagedProcessRpcError,
  OrchestrationEvent,
} from "./orchestration";

import {
  ManagedProcessLogClientMessage,
  ManagedProcessLogServerMessage,
} from "./managedProcessLog";

const decodeManagedProcess = Schema.decodeUnknownEffect(ManagedProcess);
const encodeManagedProcess = Schema.encodeSync(ManagedProcess);
const decodeManagedProcessInstance = Schema.decodeUnknownEffect(ManagedProcessInstance);
const encodeManagedProcessInstance = Schema.encodeSync(ManagedProcessInstance);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeLogClientMessage = Schema.decodeUnknownEffect(ManagedProcessLogClientMessage);
const decodeLogServerMessage = Schema.decodeUnknownEffect(ManagedProcessLogServerMessage);

const validProcessDef = {
  id: "proc-1",
  name: "Dev Server",
  command: "npm run dev",
  icon: "play" as const,
  scope: "worktree" as const,
  cwd: null,
  env: { NODE_ENV: "development" },
  proxy: null,
  readiness: { kind: "none" as const },
  autoRestart: null,
};

const validInstance = {
  instanceId: "inst-1",
  projectId: "project-1",
  processDefId: "proc-1",
  worktreePath: null,
  scope: "worktree" as const,
  status: "running" as const,
  ready: true,
  executor: "tmux" as const,
  url: { estimate: null, confirmed: null },
  startedAt: "2026-01-01T00:00:00.000Z",
  stoppedAt: null,
  exitCode: null,
  exitSignal: null,
  restartAttempt: 0,
  lastError: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const eventBase = {
  sequence: 1,
  eventId: "event-mp-1",
  aggregateKind: "project" as const,
  aggregateId: "project-1",
  occurredAt: "2026-01-01T00:00:00.000Z",
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

// ---------- ManagedProcess definition round-trip ----------

it.effect("round-trips a ManagedProcess definition", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeManagedProcess(validProcessDef);
    assert.strictEqual(parsed.id, "proc-1");
    assert.strictEqual(parsed.name, "Dev Server");
    assert.strictEqual(parsed.scope, "worktree");
    assert.deepStrictEqual(parsed.env, { NODE_ENV: "development" });
    const encoded = encodeManagedProcess(parsed);
    assert.deepStrictEqual(encoded, validProcessDef);
  }),
);

it.effect("round-trips ManagedProcess with portless proxy", () =>
  Effect.gen(function* () {
    const input = {
      ...validProcessDef,
      proxy: { kind: "portless" as const, appName: "my-app" },
      readiness: { kind: "portless-http" as const },
    };
    const parsed = yield* decodeManagedProcess(input);
    assert.strictEqual(parsed.proxy?.kind, "portless");
    assert.strictEqual(parsed.proxy?.appName, "my-app");
    assert.strictEqual(parsed.readiness.kind, "portless-http");
    const encoded = encodeManagedProcess(parsed);
    assert.deepStrictEqual(encoded, input);
  }),
);

it.effect("round-trips ManagedProcess with log-pattern readiness", () =>
  Effect.gen(function* () {
    const input = {
      ...validProcessDef,
      readiness: { kind: "log-pattern" as const, pattern: "Server listening on port" },
    };
    const parsed = yield* decodeManagedProcess(input);
    assert.strictEqual(parsed.readiness.kind, "log-pattern");
    if (parsed.readiness.kind === "log-pattern") {
      assert.strictEqual(parsed.readiness.pattern, "Server listening on port");
    }
  }),
);

it.effect("round-trips ManagedProcess with autoRestart", () =>
  Effect.gen(function* () {
    const input = {
      ...validProcessDef,
      autoRestart: { onCrash: true, maxAttempts: 5, backoffMs: 1000 },
    };
    const parsed = yield* decodeManagedProcess(input);
    assert.strictEqual(parsed.autoRestart?.onCrash, true);
    assert.strictEqual(parsed.autoRestart?.maxAttempts, 5);
    assert.strictEqual(parsed.autoRestart?.backoffMs, 1000);
  }),
);

it.effect("rejects autoRestart maxAttempts > 20", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeManagedProcess({
        ...validProcessDef,
        autoRestart: { onCrash: true, maxAttempts: 21, backoffMs: 1000 },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects autoRestart backoffMs > 60000", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeManagedProcess({
        ...validProcessDef,
        autoRestart: { onCrash: true, maxAttempts: 5, backoffMs: 60_001 },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects log-pattern readiness with oversized pattern", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeManagedProcess({
        ...validProcessDef,
        readiness: { kind: "log-pattern", pattern: "x".repeat(501) },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects empty name after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decodeManagedProcess({ ...validProcessDef, name: "   " }));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims whitespace from definition fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeManagedProcess({
      ...validProcessDef,
      id: " proc-trimmed ",
      name: " My Server ",
      command: " npm start ",
    });
    assert.strictEqual(parsed.id, "proc-trimmed");
    assert.strictEqual(parsed.name, "My Server");
    assert.strictEqual(parsed.command, "npm start");
  }),
);

// ---------- ManagedProcessInstance round-trip ----------

it.effect("round-trips a ManagedProcessInstance", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeManagedProcessInstance(validInstance);
    assert.strictEqual(parsed.instanceId, "inst-1");
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.ready, true);
    assert.strictEqual(parsed.executor, "tmux");
    assert.strictEqual(parsed.restartAttempt, 0);
    const encoded = encodeManagedProcessInstance(parsed);
    assert.deepStrictEqual(encoded, validInstance);
  }),
);

it.effect("accepts all instance statuses", () =>
  Effect.gen(function* () {
    const statuses = ["idle", "starting", "running", "stopping", "stopped", "crashed"] as const;
    for (const status of statuses) {
      const parsed = yield* decodeManagedProcessInstance({ ...validInstance, status });
      assert.strictEqual(parsed.status, status);
    }
  }),
);

it.effect("rejects unknown instance status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeManagedProcessInstance({ ...validInstance, status: "exploded" }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts both executor kinds", () =>
  Effect.gen(function* () {
    for (const executor of ["tmux", "direct"] as const) {
      const parsed = yield* decodeManagedProcessInstance({ ...validInstance, executor });
      assert.strictEqual(parsed.executor, executor);
    }
  }),
);

// ---------- Domain events ----------

it.effect("decodes managed-process.instance-started event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "managed-process.instance-started",
      payload: { instance: validInstance },
    });
    assert.strictEqual(parsed.type, "managed-process.instance-started");
  }),
);

it.effect("decodes managed-process.instance-state-changed event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "managed-process.instance-state-changed",
      payload: {
        instanceId: "inst-1",
        prev: "starting",
        next: "running",
        exitCode: null,
        exitSignal: null,
        lastError: null,
        occurredAt: "2026-01-01T00:00:01.000Z",
      },
    });
    assert.strictEqual(parsed.type, "managed-process.instance-state-changed");
  }),
);

it.effect("decodes managed-process.instance-ready-changed event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "managed-process.instance-ready-changed",
      payload: {
        instanceId: "inst-1",
        ready: true,
        url: { estimate: "http://localhost:3000", confirmed: "http://localhost:3000" },
        occurredAt: "2026-01-01T00:00:02.000Z",
      },
    });
    assert.strictEqual(parsed.type, "managed-process.instance-ready-changed");
  }),
);

it.effect("decodes managed-process.instance-exited event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "managed-process.instance-exited",
      payload: {
        instanceId: "inst-1",
        exitCode: 1,
        exitSignal: null,
        userInitiated: false,
        occurredAt: "2026-01-01T00:00:03.000Z",
      },
    });
    assert.strictEqual(parsed.type, "managed-process.instance-exited");
  }),
);

it.effect("rejects unknown orchestration event type", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeOrchestrationEvent({
        ...eventBase,
        type: "managed-process.unknown-event",
        payload: {},
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

// ---------- Log streaming schemas ----------

it.effect("round-trips log subscribe client message", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeLogClientMessage({
      type: "subscribe",
      instanceId: "inst-1",
    });
    assert.strictEqual(parsed.type, "subscribe");
    assert.strictEqual(parsed.instanceId, "inst-1");
  }),
);

it.effect("round-trips log unsubscribe client message", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeLogClientMessage({
      type: "unsubscribe",
      instanceId: "inst-1",
    });
    assert.strictEqual(parsed.type, "unsubscribe");
  }),
);

it.effect("round-trips log backfill server message", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeLogServerMessage({
      type: "backfill",
      instanceId: "inst-1",
      bytes: "server started\r\n",
      ringBufferBytes: 16,
      truncated: false,
      sequenceNumber: 5,
    });
    assert.strictEqual(parsed.type, "backfill");
    assert.strictEqual(parsed.bytes, "server started\r\n");
    assert.strictEqual(parsed.truncated, false);
    assert.strictEqual(parsed.sequenceNumber, 5);
  }),
);

it.effect("round-trips log chunk server message", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeLogServerMessage({
      type: "chunk",
      instanceId: "inst-1",
      bytes: "new output line\r\n",
      sequenceNumber: 6,
    });
    assert.strictEqual(parsed.type, "chunk");
    assert.strictEqual(parsed.sequenceNumber, 6);
  }),
);

// ---------- Negative: oversized stdin ----------

it.effect("rejects oversized stdin data via schema check", () =>
  Effect.gen(function* () {
    const StdinDataSchema = Schema.String.check(Schema.isMaxLength(64 * 1024));
    const decode = Schema.decodeUnknownEffect(StdinDataSchema);
    const result = yield* Effect.exit(decode("x".repeat(64 * 1024 + 1)));
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts stdin data within limit", () =>
  Effect.gen(function* () {
    const StdinDataSchema = Schema.String.check(Schema.isMaxLength(64 * 1024));
    const decode = Schema.decodeUnknownEffect(StdinDataSchema);
    const parsed = yield* decode("x".repeat(64 * 1024));
    assert.strictEqual(parsed.length, 64 * 1024);
  }),
);

// ---------- Negative: scope validation ----------

it.effect("rejects invalid scope value", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeManagedProcess({ ...validProcessDef, scope: "global" }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

// ---------- ManagedProcessRpcError ----------

it.effect("round-trips ManagedProcessRpcError", () =>
  Effect.sync(() => {
    const err = new ManagedProcessRpcError({
      code: "not-found",
      message: "Process not found",
    });
    assert.strictEqual(err.code, "not-found");
    assert.strictEqual(err.message, "Process not found");
    assert.strictEqual(err._tag, "ManagedProcessRpcError");
  }),
);

it.effect("accepts all ManagedProcessRpcError codes", () =>
  Effect.sync(() => {
    const codes = [
      "not-found",
      "invalid-state",
      "spawn-failed",
      "portless-not-found",
      "executor-unavailable",
      "io-error",
    ] as const;
    for (const code of codes) {
      const err = new ManagedProcessRpcError({ code, message: `Error: ${code}` });
      assert.strictEqual(err.code, code);
    }
  }),
);
