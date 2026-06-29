import { Schema } from "effect";

import { makeEntityId, TrimmedNonEmptyString } from "./baseSchemas";

export const RemoteHostId = makeEntityId("RemoteHostId");
export type RemoteHostId = typeof RemoteHostId.Type;

export const RemoteConnectionId = makeEntityId("RemoteConnectionId");
export type RemoteConnectionId = typeof RemoteConnectionId.Type;

export const RemoteCommandRunId = makeEntityId("RemoteCommandRunId");
export type RemoteCommandRunId = typeof RemoteCommandRunId.Type;

const StringRecord = Schema.Record(Schema.String, Schema.String);

export const CommandTemplateRemoteTransport = Schema.Struct({
  type: Schema.Literal("command-template"),
  command: TrimmedNonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)),
  commandPlaceholder: Schema.optional(TrimmedNonEmptyString),
  cwd: Schema.optional(TrimmedNonEmptyString),
  env: Schema.optional(StringRecord),
});
export type CommandTemplateRemoteTransport = typeof CommandTemplateRemoteTransport.Type;

export const RemoteTransport = CommandTemplateRemoteTransport;
export type RemoteTransport = typeof RemoteTransport.Type;

export const RemoteConnectionStatus = Schema.Literals(["connected", "disconnected"]);
export type RemoteConnectionStatus = typeof RemoteConnectionStatus.Type;

export const RemoteCommandRunStatus = Schema.Literals(["running", "succeeded", "failed"]);
export type RemoteCommandRunStatus = typeof RemoteCommandRunStatus.Type;

// Remote controller payloads describe server-side host, connection, and command
// run state for any client. Command output is bounded snapshot metadata, not an
// interactive terminal byte stream or browser/Electron UI contract.
export const RemoteDirectoryEntryKind = Schema.Literals(["directory", "file", "symlink", "other"]);
export type RemoteDirectoryEntryKind = typeof RemoteDirectoryEntryKind.Type;

export const RemoteConnectionState = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type RemoteConnectionState = typeof RemoteConnectionState.Type;

export const RemoteHostSnapshot = Schema.Struct({
  hostId: RemoteHostId,
  label: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  transport: RemoteTransport,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type RemoteHostSnapshot = typeof RemoteHostSnapshot.Type;

export const RemoteConnectionSnapshot = Schema.Struct({
  connectionId: RemoteConnectionId,
  hostId: Schema.optional(RemoteHostId),
  label: TrimmedNonEmptyString,
  transportType: Schema.Literal("command-template"),
  status: RemoteConnectionStatus,
  state: RemoteConnectionState,
  startedAt: Schema.String,
  stoppedAt: Schema.optional(Schema.String),
});
export type RemoteConnectionSnapshot = typeof RemoteConnectionSnapshot.Type;

export const RemoteCommandRunSnapshot = Schema.Struct({
  runId: RemoteCommandRunId,
  connectionId: RemoteConnectionId,
  command: Schema.String,
  status: RemoteCommandRunStatus,
  output: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
});
export type RemoteCommandRunSnapshot = typeof RemoteCommandRunSnapshot.Type;

export const CreateRemoteHostInput = Schema.Struct({
  hostId: Schema.optional(RemoteHostId),
  label: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  transport: RemoteTransport,
});
export type CreateRemoteHostInput = typeof CreateRemoteHostInput.Type;

export const UpdateRemoteHostInput = Schema.Struct({
  hostId: RemoteHostId,
  label: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  transport: Schema.optional(RemoteTransport),
});
export type UpdateRemoteHostInput = typeof UpdateRemoteHostInput.Type;

export const DeleteRemoteHostInput = Schema.Struct({
  hostId: RemoteHostId,
});
export type DeleteRemoteHostInput = typeof DeleteRemoteHostInput.Type;

export const StartRemoteConnectionInput = Schema.Struct({
  hostId: Schema.optional(RemoteHostId),
  connectionId: Schema.optional(RemoteConnectionId),
  label: Schema.optional(TrimmedNonEmptyString),
  transport: Schema.optional(RemoteTransport),
  path: Schema.optional(TrimmedNonEmptyString),
});
export type StartRemoteConnectionInput = typeof StartRemoteConnectionInput.Type;

export const StopRemoteConnectionInput = Schema.Struct({
  connectionId: RemoteConnectionId,
});
export type StopRemoteConnectionInput = typeof StopRemoteConnectionInput.Type;

export const SetRemoteConnectionPathInput = Schema.Struct({
  connectionId: RemoteConnectionId,
  path: TrimmedNonEmptyString,
});
export type SetRemoteConnectionPathInput = typeof SetRemoteConnectionPathInput.Type;

export const SendRemoteCommandInput = Schema.Struct({
  connectionId: RemoteConnectionId,
  command: Schema.String,
});
export type SendRemoteCommandInput = typeof SendRemoteCommandInput.Type;

export const ListRemoteCommandRunsInput = Schema.Struct({
  connectionId: Schema.optional(RemoteConnectionId),
});
export type ListRemoteCommandRunsInput = typeof ListRemoteCommandRunsInput.Type;

export const RemoteDirectoryEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  kind: RemoteDirectoryEntryKind,
  sizeBytes: Schema.NullOr(Schema.Number),
  modifiedAtMs: Schema.NullOr(Schema.Number),
});
export type RemoteDirectoryEntry = typeof RemoteDirectoryEntry.Type;

export const ListRemoteDirectoryInput = Schema.Struct({
  connectionId: RemoteConnectionId,
  path: TrimmedNonEmptyString,
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(500)),
  ),
});
export type ListRemoteDirectoryInput = typeof ListRemoteDirectoryInput.Type;

export const ListRemoteDirectoryResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  entries: Schema.Array(RemoteDirectoryEntry),
  truncated: Schema.Boolean,
  parseError: Schema.optional(Schema.String),
});
export type ListRemoteDirectoryResult = typeof ListRemoteDirectoryResult.Type;

export const RemoteHostUpsertedEvent = Schema.Struct({
  type: Schema.Literal("host.upserted"),
  snapshot: RemoteHostSnapshot,
});

export const RemoteHostDeletedEvent = Schema.Struct({
  type: Schema.Literal("host.deleted"),
  hostId: RemoteHostId,
});

export const RemoteConnectionUpdatedEvent = Schema.Struct({
  type: Schema.Literal("connection.updated"),
  snapshot: RemoteConnectionSnapshot,
});

export const RemoteCommandRunUpdatedEvent = Schema.Struct({
  type: Schema.Literal("commandRun.updated"),
  snapshot: RemoteCommandRunSnapshot,
});

export const RemoteControllerEvent = Schema.Union([
  RemoteHostUpsertedEvent,
  RemoteHostDeletedEvent,
  RemoteConnectionUpdatedEvent,
  RemoteCommandRunUpdatedEvent,
]);
export type RemoteControllerEvent = typeof RemoteControllerEvent.Type;

export class RemoteControllerRpcError extends Schema.TaggedErrorClass<RemoteControllerRpcError>()(
  "RemoteControllerRpcError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
