import { Effect, Schema } from "effect";
import { ExecutionEnvironmentDescriptor } from "./environment";
import { ServerAuthDescriptor } from "./auth";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  KeybindingCommand,
  KeybindingValue,
  KeybindingWhen,
  ResolvedKeybindingsConfig,
} from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { GlobalScript, ProviderKind } from "./orchestration";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance";
import { ServerSettings } from "./settings";
import { ServerProviderSkill } from "./skill";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProviderVersionAdvisoryStatus = Schema.Literals([
  "current",
  "behind_latest",
  "unknown",
]);
export type ServerProviderVersionAdvisoryStatus = typeof ServerProviderVersionAdvisoryStatus.Type;

export const ServerProviderVersionAdvisory = Schema.Struct({
  status: ServerProviderVersionAdvisoryStatus,
  currentVersion: Schema.NullOr(TrimmedNonEmptyString),
  latestVersion: Schema.NullOr(TrimmedNonEmptyString),
  updateCommand: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  canUpdate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  checkedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderVersionAdvisory = typeof ServerProviderVersionAdvisory.Type;

export const ServerProviderUpdateStatus = Schema.Literals([
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
  "unchanged",
]);
export type ServerProviderUpdateStatus = typeof ServerProviderUpdateStatus.Type;

export const ServerProviderUpdateState = Schema.Struct({
  status: ServerProviderUpdateStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
  output: Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000))),
});
export type ServerProviderUpdateState = typeof ServerProviderUpdateState.Type;

export const ServerProviderAvailability = Schema.Literals(["available", "unavailable"]);
export type ServerProviderAvailability = typeof ServerProviderAvailability.Type;

export const ServerProviderMcpCapabilities = Schema.Struct({
  supported: Schema.Boolean,
  transports: Schema.Struct({
    stdio: Schema.Boolean,
    http: Schema.Boolean,
    sse: Schema.Boolean,
  }),
});
export type ServerProviderMcpCapabilities = typeof ServerProviderMcpCapabilities.Type;

export const ServerProvider = Schema.Struct({
  provider: Schema.optional(ProviderKind),
  instanceId: Schema.optional(ProviderInstanceId),
  driver: Schema.optional(ProviderDriverKind),
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  availability: Schema.optional(ServerProviderAvailability),
  unavailableReason: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
  versionAdvisory: Schema.optional(ServerProviderVersionAdvisory),
  updateState: Schema.optional(ServerProviderUpdateState),
  mcpCapabilities: Schema.optional(ServerProviderMcpCapabilities),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const isProviderAvailable = (snapshot: ServerProvider): boolean =>
  snapshot.availability !== "unavailable";

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerTraceDiagnosticsErrorKind = Schema.Literals([
  "trace-file-not-found",
  "trace-file-read-failed",
]);
export type ServerTraceDiagnosticsErrorKind = typeof ServerTraceDiagnosticsErrorKind.Type;

export const ServerTraceDiagnosticsSpanSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  count: NonNegativeInt,
  failureCount: NonNegativeInt,
  totalDurationMs: Schema.Number,
  averageDurationMs: Schema.Number,
  maxDurationMs: Schema.Number,
});
export type ServerTraceDiagnosticsSpanSummary = typeof ServerTraceDiagnosticsSpanSummary.Type;

export const ServerTraceDiagnosticsFailureSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  cause: TrimmedNonEmptyString,
  count: NonNegativeInt,
  lastSeenAt: Schema.DateTimeUtc,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
});
export type ServerTraceDiagnosticsFailureSummary = typeof ServerTraceDiagnosticsFailureSummary.Type;

export const ServerTraceDiagnosticsRecentFailure = Schema.Struct({
  name: TrimmedNonEmptyString,
  cause: TrimmedNonEmptyString,
  durationMs: Schema.Number,
  endedAt: Schema.DateTimeUtc,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
});
export type ServerTraceDiagnosticsRecentFailure = typeof ServerTraceDiagnosticsRecentFailure.Type;

export const ServerTraceDiagnosticsSpanOccurrence = Schema.Struct({
  name: TrimmedNonEmptyString,
  durationMs: Schema.Number,
  endedAt: Schema.DateTimeUtc,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
});
export type ServerTraceDiagnosticsSpanOccurrence = typeof ServerTraceDiagnosticsSpanOccurrence.Type;

export const ServerTraceDiagnosticsLogEvent = Schema.Struct({
  spanName: TrimmedNonEmptyString,
  level: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  seenAt: Schema.DateTimeUtc,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
});
export type ServerTraceDiagnosticsLogEvent = typeof ServerTraceDiagnosticsLogEvent.Type;

export const ServerTraceDiagnosticsResult = Schema.Struct({
  traceFilePath: TrimmedNonEmptyString,
  scannedFilePaths: Schema.Array(TrimmedNonEmptyString),
  readAt: Schema.DateTimeUtc,
  recordCount: NonNegativeInt,
  parseErrorCount: NonNegativeInt,
  firstSpanAt: Schema.Option(Schema.DateTimeUtc),
  lastSpanAt: Schema.Option(Schema.DateTimeUtc),
  failureCount: NonNegativeInt,
  interruptionCount: NonNegativeInt,
  slowSpanThresholdMs: NonNegativeInt,
  slowSpanCount: NonNegativeInt,
  logLevelCounts: Schema.Record(TrimmedNonEmptyString, NonNegativeInt),
  topSpansByCount: Schema.Array(ServerTraceDiagnosticsSpanSummary),
  slowestSpans: Schema.Array(ServerTraceDiagnosticsSpanOccurrence),
  commonFailures: Schema.Array(ServerTraceDiagnosticsFailureSummary),
  latestFailures: Schema.Array(ServerTraceDiagnosticsRecentFailure),
  latestWarningAndErrorLogs: Schema.Array(ServerTraceDiagnosticsLogEvent),
  partialFailure: Schema.Option(Schema.Boolean),
  error: Schema.Option(
    Schema.Struct({
      kind: ServerTraceDiagnosticsErrorKind,
      message: TrimmedNonEmptyString,
    }),
  ),
});
export type ServerTraceDiagnosticsResult = typeof ServerTraceDiagnosticsResult.Type;

export const ServerProcessSignal = Schema.Literals(["SIGINT", "SIGKILL"]);
export type ServerProcessSignal = typeof ServerProcessSignal.Type;

export const ServerProcessDiagnosticsEntry = Schema.Struct({
  pid: PositiveInt,
  ppid: NonNegativeInt,
  pgid: Schema.Option(Schema.Int),
  status: TrimmedNonEmptyString,
  cpuPercent: Schema.Number,
  rssBytes: NonNegativeInt,
  elapsed: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  depth: NonNegativeInt,
  childPids: Schema.Array(PositiveInt),
});
export type ServerProcessDiagnosticsEntry = typeof ServerProcessDiagnosticsEntry.Type;

export const ServerProcessDiagnosticsResult = Schema.Struct({
  serverPid: PositiveInt,
  readAt: Schema.DateTimeUtc,
  processCount: NonNegativeInt,
  totalRssBytes: NonNegativeInt,
  totalCpuPercent: Schema.Number,
  processes: Schema.Array(ServerProcessDiagnosticsEntry),
  error: Schema.Option(
    Schema.Struct({
      message: TrimmedNonEmptyString,
    }),
  ),
});
export type ServerProcessDiagnosticsResult = typeof ServerProcessDiagnosticsResult.Type;

export const ServerProcessResourceHistoryInput = Schema.Struct({
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
});
export type ServerProcessResourceHistoryInput = typeof ServerProcessResourceHistoryInput.Type;

export const ServerProcessResourceHistoryBucket = Schema.Struct({
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  maxRssBytes: NonNegativeInt,
  maxProcessCount: NonNegativeInt,
});
export type ServerProcessResourceHistoryBucket = typeof ServerProcessResourceHistoryBucket.Type;

export const ServerProcessResourceHistorySummary = Schema.Struct({
  processKey: TrimmedNonEmptyString,
  pid: PositiveInt,
  ppid: NonNegativeInt,
  command: TrimmedNonEmptyString,
  depth: NonNegativeInt,
  isServerRoot: Schema.Boolean,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
  currentCpuPercent: Schema.Number,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  cpuSecondsApprox: Schema.Number,
  currentRssBytes: NonNegativeInt,
  maxRssBytes: NonNegativeInt,
  sampleCount: NonNegativeInt,
});
export type ServerProcessResourceHistorySummary = typeof ServerProcessResourceHistorySummary.Type;

export const ServerProcessResourceHistoryResult = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
  sampleIntervalMs: NonNegativeInt,
  retainedSampleCount: NonNegativeInt,
  totalCpuSecondsApprox: Schema.Number,
  buckets: Schema.Array(ServerProcessResourceHistoryBucket),
  topProcesses: Schema.Array(ServerProcessResourceHistorySummary),
  error: Schema.Option(
    Schema.Struct({
      message: TrimmedNonEmptyString,
    }),
  ),
});
export type ServerProcessResourceHistoryResult = typeof ServerProcessResourceHistoryResult.Type;

export const ServerSignalProcessInput = Schema.Struct({
  pid: PositiveInt,
  signal: ServerProcessSignal,
});
export type ServerSignalProcessInput = typeof ServerSignalProcessInput.Type;

export const ServerSignalProcessResult = Schema.Struct({
  pid: PositiveInt,
  signal: ServerProcessSignal,
  signaled: Schema.Boolean,
  message: Schema.Option(TrimmedNonEmptyString),
});
export type ServerSignalProcessResult = typeof ServerSignalProcessResult.Type;

export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  homeDirectoryPath: Schema.optional(TrimmedNonEmptyString),
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
  globalActions: Schema.Array(GlobalScript),
  skills: Schema.Array(ServerProviderSkill),
});
export type ServerConfig = typeof ServerConfig.Type;

const ServerUpsertKeybindingReplaceTarget = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
});

export const ServerUpsertKeybindingInput = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
  replace: Schema.optional(ServerUpsertKeybindingReplaceTarget),
});
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerRemoveKeybindingInput = ServerUpsertKeybindingReplaceTarget;
export type ServerRemoveKeybindingInput = typeof ServerRemoveKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerRemoveKeybindingResult = ServerUpsertKeybindingResult;
export type ServerRemoveKeybindingResult = typeof ServerRemoveKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigGlobalActionsUpdatedPayload = Schema.Struct({
  globalActions: Schema.Array(GlobalScript),
});
export type ServerConfigGlobalActionsUpdatedPayload =
  typeof ServerConfigGlobalActionsUpdatedPayload.Type;

const ServerConfigStreamGlobalActionsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("globalActionsUpdated"),
  payload: ServerConfigGlobalActionsUpdatedPayload,
});

export const ServerConfigSkillsUpdatedPayload = Schema.Struct({
  skills: Schema.Array(ServerProviderSkill),
});
export type ServerConfigSkillsUpdatedPayload = typeof ServerConfigSkillsUpdatedPayload.Type;

const ServerConfigStreamSkillsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("skillsUpdated"),
  payload: ServerConfigSkillsUpdatedPayload,
});

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
  ServerConfigStreamGlobalActionsUpdatedEvent,
  ServerConfigStreamSkillsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
  environment: ExecutionEnvironmentDescriptor,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const ServerProviderUpdateInput = Schema.Struct({
  provider: ProviderDriverKind,
  instanceId: Schema.optionalKey(ProviderInstanceId),
});
export type ServerProviderUpdateInput = typeof ServerProviderUpdateInput.Type;

export class ServerProviderUpdateError extends Schema.TaggedErrorClass<ServerProviderUpdateError>()(
  "ServerProviderUpdateError",
  {
    provider: ProviderDriverKind,
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Provider update failed for ${this.provider}: ${this.reason}`;
  }
}
