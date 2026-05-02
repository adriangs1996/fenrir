import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const RawTcpListenerId = TrimmedNonEmptyString.pipe(Schema.brand("RawTcpListenerId"));
export type RawTcpListenerId = typeof RawTcpListenerId.Type;

export const RawTcpSessionId = TrimmedNonEmptyString.pipe(Schema.brand("RawTcpSessionId"));
export type RawTcpSessionId = typeof RawTcpSessionId.Type;

export const RawTcpTerminalMode = Schema.Union([Schema.Literal("raw"), Schema.Literal("pty")]);
export type RawTcpTerminalMode = typeof RawTcpTerminalMode.Type;

export const RawTcpListenerSnapshot = Schema.Struct({
  listenerId: RawTcpListenerId,
  label: Schema.String,
  host: Schema.String,
  port: PositiveInt,
  createdAt: Schema.String,
});
export type RawTcpListenerSnapshot = typeof RawTcpListenerSnapshot.Type;

export const RawTcpSessionSnapshot = Schema.Struct({
  sessionId: RawTcpSessionId,
  listenerId: RawTcpListenerId,
  remoteAddress: Schema.String,
  connectedAt: Schema.String,
  terminalMode: RawTcpTerminalMode,
});
export type RawTcpSessionSnapshot = typeof RawTcpSessionSnapshot.Type;

export const CreateRawTcpListenerInput = Schema.Struct({
  label: Schema.String,
  host: Schema.String,
  port: PositiveInt,
});
export type CreateRawTcpListenerInput = typeof CreateRawTcpListenerInput.Type;

export const StopRawTcpListenerInput = Schema.Struct({
  listenerId: RawTcpListenerId,
});
export type StopRawTcpListenerInput = typeof StopRawTcpListenerInput.Type;

export const RawTcpSessionWriteInput = Schema.Struct({
  sessionId: RawTcpSessionId,
  data: Schema.String,
});
export type RawTcpSessionWriteInput = typeof RawTcpSessionWriteInput.Type;

export const RawTcpSessionCloseInput = Schema.Struct({
  sessionId: RawTcpSessionId,
});
export type RawTcpSessionCloseInput = typeof RawTcpSessionCloseInput.Type;

export const RawTcpSessionUpgradePtyInput = Schema.Struct({
  sessionId: RawTcpSessionId,
  cols: PositiveInt,
  rows: PositiveInt,
});
export type RawTcpSessionUpgradePtyInput = typeof RawTcpSessionUpgradePtyInput.Type;

export const RawTcpListenerCreatedEvent = Schema.Struct({
  type: Schema.Literal("listener.created"),
  snapshot: RawTcpListenerSnapshot,
});

export const RawTcpListenerStoppedEvent = Schema.Struct({
  type: Schema.Literal("listener.stopped"),
  listenerId: RawTcpListenerId,
});

export const RawTcpSessionConnectedEvent = Schema.Struct({
  type: Schema.Literal("session.connected"),
  snapshot: RawTcpSessionSnapshot,
});

export const RawTcpSessionDataEvent = Schema.Struct({
  type: Schema.Literal("session.data"),
  sessionId: RawTcpSessionId,
  data: Schema.String,
});

export const RawTcpSessionUpdatedEvent = Schema.Struct({
  type: Schema.Literal("session.updated"),
  snapshot: RawTcpSessionSnapshot,
});

export const RawTcpSessionClosedEvent = Schema.Struct({
  type: Schema.Literal("session.closed"),
  sessionId: RawTcpSessionId,
});

export const RawTcpEvent = Schema.Union([
  RawTcpListenerCreatedEvent,
  RawTcpListenerStoppedEvent,
  RawTcpSessionConnectedEvent,
  RawTcpSessionDataEvent,
  RawTcpSessionUpdatedEvent,
  RawTcpSessionClosedEvent,
]);
export type RawTcpEvent = typeof RawTcpEvent.Type;

export class RawTcpListenerError extends Schema.TaggedErrorClass<RawTcpListenerError>()(
  "RawTcpListenerError",
  {
    message: Schema.String,
  },
) {}

export class RawTcpSessionError extends Schema.TaggedErrorClass<RawTcpSessionError>()(
  "RawTcpSessionError",
  {
    sessionId: Schema.String,
    message: Schema.String,
  },
) {}
