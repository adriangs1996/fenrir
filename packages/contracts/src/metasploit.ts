import { Schema } from "effect";
import { makeEntityId, TrimmedNonEmptyString } from "./baseSchemas";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const ListenerId = makeEntityId("ListenerId");
export type ListenerId = typeof ListenerId.Type;

export const MsfSessionId = makeEntityId("MsfSessionId");
export type MsfSessionId = typeof MsfSessionId.Type;

// ─── Schemas ────────────────────────────────────────────────────────────────

const TerminalColsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(20)).check(
  Schema.isLessThanOrEqualTo(400),
);
const TerminalRowsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(5)).check(
  Schema.isLessThanOrEqualTo(200),
);

export const ListenerStatus = Schema.Literals([
  "starting",
  "waiting",
  "active",
  "stopped",
  "error",
]);
export type ListenerStatus = typeof ListenerStatus.Type;

export const MsfSessionStatus = Schema.Literals(["open", "upgrading", "closed"]);
export type MsfSessionStatus = typeof MsfSessionStatus.Type;

export const MsfSessionType = Schema.Literals(["shell", "meterpreter"]);
export type MsfSessionType = typeof MsfSessionType.Type;

export const PayloadType = Schema.Literals([
  "windows/meterpreter/reverse_tcp",
  "windows/shell/reverse_tcp",
  "linux/x86/meterpreter/reverse_tcp",
  "linux/x86/shell/reverse_tcp",
  "java/meterpreter/reverse_tcp",
  "php/meterpreter/reverse_tcp",
  "cmd/unix/reverse_bash",
  "generic/shell_reverse_tcp",
]);
export type PayloadType = typeof PayloadType.Type;

export const ListenerConfig = Schema.Struct({
  listenerId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  payload: PayloadType,
  lhost: TrimmedNonEmptyString,
  lport: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
    Schema.isLessThanOrEqualTo(65535),
  ),
});
export type ListenerConfig = typeof ListenerConfig.Type;

export const ListenerSnapshot = Schema.Struct({
  listenerId: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String.check(Schema.isNonEmpty()),
  payload: PayloadType,
  lhost: Schema.String.check(Schema.isNonEmpty()),
  lport: Schema.Int,
  status: ListenerStatus,
  jobId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type ListenerSnapshot = typeof ListenerSnapshot.Type;

export const MsfSessionSnapshot = Schema.Struct({
  sessionId: Schema.String.check(Schema.isNonEmpty()),
  type: MsfSessionType,
  info: Schema.String,
  targetHost: Schema.String,
  platform: Schema.String,
  via: Schema.String,
  listenerId: Schema.NullOr(Schema.String),
  openedAt: Schema.String,
});
export type MsfSessionSnapshot = typeof MsfSessionSnapshot.Type;

// ─── Input Schemas ──────────────────────────────────────────────────────────

export const CreateListenerInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  payload: PayloadType,
  lhost: TrimmedNonEmptyString,
  lport: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
    Schema.isLessThanOrEqualTo(65535),
  ),
});
export type CreateListenerInput = typeof CreateListenerInput.Type;

export const StopListenerInput = Schema.Struct({
  listenerId: TrimmedNonEmptyString,
});
export type StopListenerInput = typeof StopListenerInput.Type;

export const SessionWriteInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
});
export type SessionWriteInput = typeof SessionWriteInput.Type;

export const SessionResizeInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
});
export type SessionResizeInput = typeof SessionResizeInput.Type;

export const SessionUpgradeInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type SessionUpgradeInput = typeof SessionUpgradeInput.Type;

export const SessionCloseInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type SessionCloseInput = typeof SessionCloseInput.Type;

export const MetasploitStatusSnapshot = Schema.Struct({
  connected: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  listenersCount: Schema.Int,
  sessionsCount: Schema.Int,
});
export type MetasploitStatusSnapshot = typeof MetasploitStatusSnapshot.Type;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class MetasploitConnectionError extends Schema.TaggedErrorClass<MetasploitConnectionError>()(
  "MetasploitConnectionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class MetasploitListenerError extends Schema.TaggedErrorClass<MetasploitListenerError>()(
  "MetasploitListenerError",
  {
    listenerId: Schema.optional(Schema.String),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class MetasploitSessionError extends Schema.TaggedErrorClass<MetasploitSessionError>()(
  "MetasploitSessionError",
  {
    sessionId: Schema.optional(Schema.String),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class MetasploitNotFoundError extends Schema.TaggedErrorClass<MetasploitNotFoundError>()(
  "MetasploitNotFoundError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  static readonly default = () =>
    new MetasploitNotFoundError({
      message:
        "msfrpcd binary not found on $PATH. Install Metasploit Framework or ensure it is in your $PATH",
    });
}

export const MetasploitError = Schema.Union([
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitSessionError,
  MetasploitNotFoundError,
]);
export type MetasploitError = typeof MetasploitError.Type;

// ─── Events ─────────────────────────────────────────────────────────────────

const MetasploitEventBaseSchema = Schema.Struct({
  createdAt: Schema.String,
});

const ListenerCreatedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("listener.created"),
  snapshot: ListenerSnapshot,
});

const ListenerStoppedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("listener.stopped"),
  listenerId: Schema.String.check(Schema.isNonEmpty()),
});

const SessionOpenedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("session.opened"),
  snapshot: MsfSessionSnapshot,
});

const SessionClosedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("session.closed"),
  sessionId: Schema.String.check(Schema.isNonEmpty()),
});

const SessionOutputEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("session.output"),
  sessionId: Schema.String.check(Schema.isNonEmpty()),
  data: Schema.String,
});

const SessionUpgradedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("session.upgraded"),
  snapshot: MsfSessionSnapshot,
});

export const MetasploitEvent = Schema.Union([
  ListenerCreatedEvent,
  ListenerStoppedEvent,
  SessionOpenedEvent,
  SessionClosedEvent,
  SessionOutputEvent,
  SessionUpgradedEvent,
]);
export type MetasploitEvent = typeof MetasploitEvent.Type;
