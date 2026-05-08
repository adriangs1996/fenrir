import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const MANAGED_PROCESS_LOG_CHANNEL = "managedProcess.logStream" as const;

export const ManagedProcessLogSubscribe = Schema.Struct({
  type: Schema.Literal("subscribe"),
  instanceId: TrimmedNonEmptyString,
});

export const ManagedProcessLogUnsubscribe = Schema.Struct({
  type: Schema.Literal("unsubscribe"),
  instanceId: TrimmedNonEmptyString,
});

export const ManagedProcessLogClientMessage = Schema.Union([
  ManagedProcessLogSubscribe,
  ManagedProcessLogUnsubscribe,
]);
export type ManagedProcessLogClientMessage = typeof ManagedProcessLogClientMessage.Type;

export const ManagedProcessLogBackfill = Schema.Struct({
  type: Schema.Literal("backfill"),
  instanceId: TrimmedNonEmptyString,
  bytes: Schema.String,
  ringBufferBytes: NonNegativeInt,
  truncated: Schema.Boolean,
  sequenceNumber: NonNegativeInt,
});

export const ManagedProcessLogChunk = Schema.Struct({
  type: Schema.Literal("chunk"),
  instanceId: TrimmedNonEmptyString,
  bytes: Schema.String,
  sequenceNumber: NonNegativeInt,
});

export const ManagedProcessLogServerMessage = Schema.Union([
  ManagedProcessLogBackfill,
  ManagedProcessLogChunk,
]);
export type ManagedProcessLogServerMessage = typeof ManagedProcessLogServerMessage.Type;
