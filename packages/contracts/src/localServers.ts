import { Schema } from "effect";

import { PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const LocalServerSource = Schema.Literals(["lsof", "powershell", "common-port-probe"]);
export type LocalServerSource = typeof LocalServerSource.Type;

export const LocalServerTerminalOwner = Schema.Struct({
  threadId: ThreadId,
  terminalId: TrimmedNonEmptyString,
});
export type LocalServerTerminalOwner = typeof LocalServerTerminalOwner.Type;

export const LocalServerPort = PositiveInt.check(Schema.isLessThanOrEqualTo(65535));
export type LocalServerPort = typeof LocalServerPort.Type;

export const DiscoveredLocalServer = Schema.Struct({
  host: TrimmedNonEmptyString,
  port: LocalServerPort,
  url: TrimmedNonEmptyString,
  processName: Schema.NullOr(TrimmedNonEmptyString),
  pid: Schema.NullOr(PositiveInt),
  source: LocalServerSource,
  terminal: Schema.NullOr(LocalServerTerminalOwner),
});
export type DiscoveredLocalServer = typeof DiscoveredLocalServer.Type;

export const LocalServersSnapshot = Schema.Struct({
  servers: Schema.Array(DiscoveredLocalServer),
  scannedAt: TrimmedNonEmptyString,
});
export type LocalServersSnapshot = typeof LocalServersSnapshot.Type;
