import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const MANAGED_PROCESS_STDIN_MAX_CHARS = 64 * 1024;

/**
 * Client-neutral stdin write input.
 *
 * `data` is a UTF-16 JavaScript string transported over the WebSocket RPC
 * control plane and forwarded to the process executor unchanged. Clients should
 * chunk interactive input at or below `MANAGED_PROCESS_STDIN_MAX_CHARS`; this
 * contract is not a byte-stream backpressure boundary.
 */
export const ManagedProcessStdinWriteInput = Schema.Struct({
  instanceId: TrimmedNonEmptyString,
  data: Schema.String.check(Schema.isMaxLength(MANAGED_PROCESS_STDIN_MAX_CHARS)),
});
export type ManagedProcessStdinWriteInput = typeof ManagedProcessStdinWriteInput.Type;

/**
 * Client-neutral log subscription input.
 *
 * The stream returns exactly one backfill message followed by zero or more live
 * chunk messages. Sequence numbers are per instance and monotonically
 * increasing; clients should use them for ordering/deduplication rather than
 * UI timing.
 */
export const ManagedProcessLogSubscribeInput = Schema.Struct({
  instanceId: TrimmedNonEmptyString,
});
export type ManagedProcessLogSubscribeInput = typeof ManagedProcessLogSubscribeInput.Type;
