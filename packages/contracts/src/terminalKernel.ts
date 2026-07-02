import { Schema } from "effect";
import {
  AuthSessionId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  makeEntityId,
} from "./baseSchemas";

export const TmuxWorkspaceId = makeEntityId("TmuxWorkspaceId");
export type TmuxWorkspaceId = typeof TmuxWorkspaceId.Type;

export const TmuxWindowId = makeEntityId("TmuxWindowId");
export type TmuxWindowId = typeof TmuxWindowId.Type;

export const TmuxPaneId = makeEntityId("TmuxPaneId");
export type TmuxPaneId = typeof TmuxPaneId.Type;

export const TmuxPaneStreamId = makeEntityId("TmuxPaneStreamId");
export type TmuxPaneStreamId = typeof TmuxPaneStreamId.Type;

export const TmuxNativeId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
export type TmuxNativeId = typeof TmuxNativeId.Type;

export const TmuxName = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
export type TmuxName = typeof TmuxName.Type;

export const TmuxPath = TrimmedNonEmptyString.check(Schema.isMaxLength(2048));
export type TmuxPath = typeof TmuxPath.Type;

export const TmuxPaneCols = Schema.Int.check(Schema.isGreaterThanOrEqualTo(20)).check(
  Schema.isLessThanOrEqualTo(1000),
);
export type TmuxPaneCols = typeof TmuxPaneCols.Type;

export const TmuxPaneRows = Schema.Int.check(Schema.isGreaterThanOrEqualTo(5)).check(
  Schema.isLessThanOrEqualTo(500),
);
export type TmuxPaneRows = typeof TmuxPaneRows.Type;

export const TmuxSequence = NonNegativeInt;
export type TmuxSequence = typeof TmuxSequence.Type;

export const TmuxWorkspaceStatus = Schema.Literals([
  "starting",
  "running",
  "detached",
  "exited",
  "error",
]);
export type TmuxWorkspaceStatus = typeof TmuxWorkspaceStatus.Type;

export const TmuxWindowStatus = Schema.Literals(["active", "inactive", "closed", "error"]);
export type TmuxWindowStatus = typeof TmuxWindowStatus.Type;

export const TmuxPaneStatus = Schema.Literals(["starting", "running", "exited", "closed", "error"]);
export type TmuxPaneStatus = typeof TmuxPaneStatus.Type;

export const TmuxPaneKind = Schema.Literals([
  "shell",
  "neovim",
  "agent",
  "workflow",
  "managed-process",
  "remote-process",
  "browser-lab",
  "custom",
]);
export type TmuxPaneKind = typeof TmuxPaneKind.Type;

export const TmuxPanePermission = Schema.Literals([
  "workspace:read",
  "workspace:control",
  "window:control",
  "pane:read",
  "pane:write",
  "pane:control",
  "process:spawn",
  "neovim:launch",
  "session:destroy",
  "permissions:admin",
]);
export type TmuxPanePermission = typeof TmuxPanePermission.Type;

export const TmuxActor = Schema.Struct({
  sessionId: AuthSessionId,
  subject: TrimmedNonEmptyString,
});
export type TmuxActor = typeof TmuxActor.Type;

export const TmuxPermissionGrant = Schema.Struct({
  actor: TmuxActor,
  permissions: Schema.Array(TmuxPanePermission),
  grantedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type TmuxPermissionGrant = typeof TmuxPermissionGrant.Type;

export const TmuxPaneProcessMetadata = Schema.Struct({
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  argv: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(Schema.isMaxLength(256)),
  envKeys: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(128))).check(
    Schema.isMaxLength(256),
  ),
  pid: Schema.NullOr(PositiveInt),
  startedAt: Schema.NullOr(IsoDateTime),
  exitedAt: Schema.NullOr(IsoDateTime),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
});
export type TmuxPaneProcessMetadata = typeof TmuxPaneProcessMetadata.Type;

export const TmuxNeovimBootstrapMetadata = Schema.Struct({
  bootstrapId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  cwd: TmuxPath,
  profileId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  themeId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  keybindingProfileId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  bridgeSocketPath: TmuxPath,
  files: Schema.Array(TmuxPath).check(Schema.isMaxLength(128)),
  line: Schema.optional(PositiveInt),
  column: Schema.optional(PositiveInt),
  launchSource: Schema.Literals(["user", "agent", "workflow", "restore"]),
  bootstrapEnvKeys: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(128))).check(
    Schema.isMaxLength(128),
  ),
});
export type TmuxNeovimBootstrapMetadata = typeof TmuxNeovimBootstrapMetadata.Type;

export const TmuxAgentPaneMetadata = Schema.Struct({
  providerId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  providerInstanceId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  threadId: Schema.NullOr(ThreadId),
});
export type TmuxAgentPaneMetadata = typeof TmuxAgentPaneMetadata.Type;

export const TmuxWorkflowPaneMetadata = Schema.Struct({
  workflowId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  runId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  stepId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  threadId: Schema.NullOr(ThreadId),
});
export type TmuxWorkflowPaneMetadata = typeof TmuxWorkflowPaneMetadata.Type;

export const TmuxManagedProcessPaneMetadata = Schema.Struct({
  instanceId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  processDefId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type TmuxManagedProcessPaneMetadata = typeof TmuxManagedProcessPaneMetadata.Type;

export const TmuxRemoteProcessPaneMetadata = Schema.Struct({
  hostId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  connectionId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  commandRunId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type TmuxRemoteProcessPaneMetadata = typeof TmuxRemoteProcessPaneMetadata.Type;

export const TmuxBrowserLabPaneMetadata = Schema.Struct({
  profileId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  tabId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  origin: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
});
export type TmuxBrowserLabPaneMetadata = typeof TmuxBrowserLabPaneMetadata.Type;

const TmuxPaneMetadataBase = Schema.Struct({
  title: Schema.NullOr(TmuxName),
  process: Schema.NullOr(TmuxPaneProcessMetadata),
  labels: Schema.Record(
    TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    Schema.String.check(Schema.isMaxLength(512)),
  ).check(Schema.isMaxProperties(128)),
});

export const TmuxShellPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("shell"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxShellPaneMetadata = typeof TmuxShellPaneMetadata.Type;

export const TmuxNeovimPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("neovim"),
  process: TmuxPaneProcessMetadata,
  neovim: TmuxNeovimBootstrapMetadata,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxNeovimPaneMetadata = typeof TmuxNeovimPaneMetadata.Type;

export const TmuxAgentOperationalPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("agent"),
  neovim: Schema.Null,
  agent: TmuxAgentPaneMetadata,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxAgentOperationalPaneMetadata = typeof TmuxAgentOperationalPaneMetadata.Type;

export const TmuxWorkflowOperationalPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("workflow"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: TmuxWorkflowPaneMetadata,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxWorkflowOperationalPaneMetadata = typeof TmuxWorkflowOperationalPaneMetadata.Type;

export const TmuxManagedProcessOperationalPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("managed-process"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: TmuxManagedProcessPaneMetadata,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxManagedProcessOperationalPaneMetadata =
  typeof TmuxManagedProcessOperationalPaneMetadata.Type;

export const TmuxRemoteProcessOperationalPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("remote-process"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: TmuxRemoteProcessPaneMetadata,
  browserLab: Schema.Null,
});
export type TmuxRemoteProcessOperationalPaneMetadata =
  typeof TmuxRemoteProcessOperationalPaneMetadata.Type;

export const TmuxBrowserLabOperationalPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("browser-lab"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: TmuxBrowserLabPaneMetadata,
});
export type TmuxBrowserLabOperationalPaneMetadata =
  typeof TmuxBrowserLabOperationalPaneMetadata.Type;

export const TmuxCustomPaneMetadata = Schema.Struct({
  ...TmuxPaneMetadataBase.fields,
  kind: Schema.Literal("custom"),
  neovim: Schema.Null,
  agent: Schema.Null,
  workflow: Schema.Null,
  managedProcess: Schema.Null,
  remoteProcess: Schema.Null,
  browserLab: Schema.Null,
});
export type TmuxCustomPaneMetadata = typeof TmuxCustomPaneMetadata.Type;

export const TmuxOperationalPaneMetadata = Schema.Union([
  TmuxAgentOperationalPaneMetadata,
  TmuxWorkflowOperationalPaneMetadata,
  TmuxManagedProcessOperationalPaneMetadata,
  TmuxRemoteProcessOperationalPaneMetadata,
  TmuxBrowserLabOperationalPaneMetadata,
  TmuxCustomPaneMetadata,
]);
export type TmuxOperationalPaneMetadata = typeof TmuxOperationalPaneMetadata.Type;

export const TmuxPaneMetadata = Schema.Union([
  TmuxShellPaneMetadata,
  TmuxNeovimPaneMetadata,
  TmuxAgentOperationalPaneMetadata,
  TmuxWorkflowOperationalPaneMetadata,
  TmuxManagedProcessOperationalPaneMetadata,
  TmuxRemoteProcessOperationalPaneMetadata,
  TmuxBrowserLabOperationalPaneMetadata,
  TmuxCustomPaneMetadata,
]);
export type TmuxPaneMetadata = typeof TmuxPaneMetadata.Type;

export const TmuxPaneStreamEncoding = Schema.Literals(["utf8"]);
export type TmuxPaneStreamEncoding = typeof TmuxPaneStreamEncoding.Type;

export const TmuxPaneStreamDescriptor = Schema.Struct({
  streamId: TmuxPaneStreamId,
  paneId: TmuxPaneId,
  encoding: TmuxPaneStreamEncoding,
  lowSeq: TmuxSequence,
  highSeq: TmuxSequence,
  droppedCount: NonNegativeInt,
  backfillAvailable: Schema.Boolean,
  maxChunkBytes: PositiveInt.check(Schema.isLessThanOrEqualTo(256 * 1024)),
});
export type TmuxPaneStreamDescriptor = typeof TmuxPaneStreamDescriptor.Type;

export const TmuxWorkspace = Schema.Struct({
  workspaceId: TmuxWorkspaceId,
  projectId: ProjectId,
  tmuxSessionName: TmuxName,
  cwd: TmuxPath,
  status: TmuxWorkspaceStatus,
  activeWindowId: Schema.NullOr(TmuxWindowId),
  grants: Schema.Array(TmuxPermissionGrant),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TmuxWorkspace = typeof TmuxWorkspace.Type;

export const TmuxWindow = Schema.Struct({
  windowId: TmuxWindowId,
  workspaceId: TmuxWorkspaceId,
  tmuxWindowId: TmuxNativeId,
  tmuxWindowIndex: NonNegativeInt,
  name: TmuxName,
  cwd: TmuxPath,
  status: TmuxWindowStatus,
  activePaneId: Schema.NullOr(TmuxPaneId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TmuxWindow = typeof TmuxWindow.Type;

export const TmuxPane = Schema.Struct({
  paneId: TmuxPaneId,
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  tmuxPaneId: TmuxNativeId,
  cwd: TmuxPath,
  x: Schema.optional(NonNegativeInt),
  y: Schema.optional(NonNegativeInt),
  cols: TmuxPaneCols,
  rows: TmuxPaneRows,
  status: TmuxPaneStatus,
  metadata: TmuxPaneMetadata,
  stream: TmuxPaneStreamDescriptor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TmuxPane = typeof TmuxPane.Type;

export const TmuxWorkspaceSnapshot = Schema.Struct({
  workspace: TmuxWorkspace,
  windows: Schema.Array(TmuxWindow),
  panes: Schema.Array(TmuxPane),
  revision: NonNegativeInt,
});
export type TmuxWorkspaceSnapshot = typeof TmuxWorkspaceSnapshot.Type;

export const TmuxWorkspaceListResult = Schema.Struct({
  workspaces: Schema.Array(TmuxWorkspace),
  revision: NonNegativeInt,
});
export type TmuxWorkspaceListResult = typeof TmuxWorkspaceListResult.Type;

export const TmuxKernelEventBase = Schema.Struct({
  revision: NonNegativeInt,
  workspaceId: TmuxWorkspaceId,
  occurredAt: IsoDateTime,
});

export const TmuxWorkspaceSnapshotEvent = Schema.Struct({
  ...TmuxKernelEventBase.fields,
  type: Schema.Literal("workspace.snapshot"),
  snapshot: TmuxWorkspaceSnapshot,
});

export const TmuxWorkspaceChangedEvent = Schema.Struct({
  ...TmuxKernelEventBase.fields,
  type: Schema.Literal("workspace.changed"),
  workspace: TmuxWorkspace,
});

export const TmuxWindowChangedEvent = Schema.Struct({
  ...TmuxKernelEventBase.fields,
  type: Schema.Literal("window.changed"),
  window: TmuxWindow,
});

export const TmuxPaneChangedEvent = Schema.Struct({
  ...TmuxKernelEventBase.fields,
  type: Schema.Literal("pane.changed"),
  pane: TmuxPane,
});

export const TmuxPaneStreamOverflowLifecycleEvent = Schema.Struct({
  ...TmuxKernelEventBase.fields,
  type: Schema.Literal("pane.stream-overflow"),
  paneId: TmuxPaneId,
  stream: TmuxPaneStreamDescriptor,
  reason: Schema.Literals(["ring-buffer-overflow", "slow-client", "server-restart"]),
});

export const TmuxKernelEvent = Schema.Union([
  TmuxWorkspaceSnapshotEvent,
  TmuxWorkspaceChangedEvent,
  TmuxWindowChangedEvent,
  TmuxPaneChangedEvent,
  TmuxPaneStreamOverflowLifecycleEvent,
]);
export type TmuxKernelEvent = typeof TmuxKernelEvent.Type;

export const TmuxPaneStreamBackfillMode = Schema.Literals(["none", "from-seq", "latest"]);
export type TmuxPaneStreamBackfillMode = typeof TmuxPaneStreamBackfillMode.Type;

export const TmuxPaneSlowClientPolicy = Schema.Literals(["close", "fast-forward"]);
export type TmuxPaneSlowClientPolicy = typeof TmuxPaneSlowClientPolicy.Type;

export const TmuxPaneStreamSubscribeInput = Schema.Struct({
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  actor: TmuxActor,
  afterSeq: Schema.optional(TmuxSequence),
  backfill: TmuxPaneStreamBackfillMode,
  slowClientPolicy: TmuxPaneSlowClientPolicy,
  maxBufferedChunks: PositiveInt.check(Schema.isLessThanOrEqualTo(10_000)),
});
export type TmuxPaneStreamSubscribeInput = typeof TmuxPaneStreamSubscribeInput.Type;

export const TmuxPaneStreamBackfillStartedEvent = Schema.Struct({
  type: Schema.Literal("backfill-started"),
  descriptor: TmuxPaneStreamDescriptor,
  fromSeq: TmuxSequence,
  toSeq: TmuxSequence,
});

export const TmuxPaneStreamChunkEvent = Schema.Struct({
  type: Schema.Literal("chunk"),
  descriptor: TmuxPaneStreamDescriptor,
  seq: TmuxSequence,
  data: Schema.String.check(Schema.isMaxLength(256 * 1024)),
  emittedAt: IsoDateTime,
});

export const TmuxPaneStreamGapEvent = Schema.Struct({
  type: Schema.Literal("gap"),
  descriptor: TmuxPaneStreamDescriptor,
  requestedAfterSeq: Schema.NullOr(TmuxSequence),
  resumedAtSeq: TmuxSequence,
  reason: Schema.Literals(["buffer-overflow", "server-restart", "slow-client"]),
});

export const TmuxPaneStreamOverflowEvent = Schema.Struct({
  type: Schema.Literal("overflow"),
  descriptor: TmuxPaneStreamDescriptor,
  droppedCount: PositiveInt,
  policy: TmuxPaneSlowClientPolicy,
  reason: Schema.Literals(["buffer-overflow", "slow-client"]),
});

export const TmuxPaneStreamClosedEvent = Schema.Struct({
  type: Schema.Literal("closed"),
  descriptor: TmuxPaneStreamDescriptor,
  reason: Schema.Literals(["pane-closed", "permission-revoked", "slow-client", "server-shutdown"]),
});

export const TmuxPaneStreamEvent = Schema.Union([
  TmuxPaneStreamBackfillStartedEvent,
  TmuxPaneStreamChunkEvent,
  TmuxPaneStreamGapEvent,
  TmuxPaneStreamOverflowEvent,
  TmuxPaneStreamClosedEvent,
]);
export type TmuxPaneStreamEvent = typeof TmuxPaneStreamEvent.Type;

export const TmuxWorkspaceListInput = Schema.Struct({
  actor: TmuxActor,
  projectId: Schema.optional(ProjectId),
});
export type TmuxWorkspaceListInput = typeof TmuxWorkspaceListInput.Type;

export const TmuxWorkspaceEnsureInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: Schema.optional(TmuxWorkspaceId),
  projectId: ProjectId,
  cwd: TmuxPath,
  initialGrants: Schema.optional(Schema.Array(TmuxPermissionGrant).check(Schema.isMaxLength(128))),
});
export type TmuxWorkspaceEnsureInput = typeof TmuxWorkspaceEnsureInput.Type;

export const TmuxWorkspaceGetSnapshotInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
});
export type TmuxWorkspaceGetSnapshotInput = typeof TmuxWorkspaceGetSnapshotInput.Type;

export const TmuxKernelSubscribeInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  afterRevision: Schema.optional(NonNegativeInt),
});
export type TmuxKernelSubscribeInput = typeof TmuxKernelSubscribeInput.Type;

export const TmuxWindowCreateInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  name: Schema.optional(TmuxName),
  cwd: Schema.optional(TmuxPath),
});
export type TmuxWindowCreateInput = typeof TmuxWindowCreateInput.Type;

export const TmuxWindowCloseInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  mode: Schema.Literals(["detach", "destroy"]),
});
export type TmuxWindowCloseInput = typeof TmuxWindowCloseInput.Type;

const TmuxPaneCreateInputBase = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  cwd: Schema.optional(TmuxPath),
  command: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
  split: Schema.Literals(["same-window", "horizontal", "vertical"]),
});

export const TmuxShellPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("shell"),
  metadata: Schema.optional(TmuxShellPaneMetadata),
});
export type TmuxShellPaneCreateInput = typeof TmuxShellPaneCreateInput.Type;

export const TmuxNeovimPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("neovim"),
  metadata: Schema.optional(TmuxNeovimPaneMetadata),
});
export type TmuxNeovimPaneCreateInput = typeof TmuxNeovimPaneCreateInput.Type;

export const TmuxAgentPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("agent"),
  metadata: Schema.optional(TmuxAgentOperationalPaneMetadata),
});
export type TmuxAgentPaneCreateInput = typeof TmuxAgentPaneCreateInput.Type;

export const TmuxWorkflowPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("workflow"),
  metadata: Schema.optional(TmuxWorkflowOperationalPaneMetadata),
});
export type TmuxWorkflowPaneCreateInput = typeof TmuxWorkflowPaneCreateInput.Type;

export const TmuxManagedProcessPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("managed-process"),
  metadata: Schema.optional(TmuxManagedProcessOperationalPaneMetadata),
});
export type TmuxManagedProcessPaneCreateInput = typeof TmuxManagedProcessPaneCreateInput.Type;

export const TmuxRemoteProcessPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("remote-process"),
  metadata: Schema.optional(TmuxRemoteProcessOperationalPaneMetadata),
});
export type TmuxRemoteProcessPaneCreateInput = typeof TmuxRemoteProcessPaneCreateInput.Type;

export const TmuxBrowserLabPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("browser-lab"),
  metadata: Schema.optional(TmuxBrowserLabOperationalPaneMetadata),
});
export type TmuxBrowserLabPaneCreateInput = typeof TmuxBrowserLabPaneCreateInput.Type;

export const TmuxCustomPaneCreateInput = Schema.Struct({
  ...TmuxPaneCreateInputBase.fields,
  kind: Schema.Literal("custom"),
  metadata: Schema.optional(TmuxCustomPaneMetadata),
});
export type TmuxCustomPaneCreateInput = typeof TmuxCustomPaneCreateInput.Type;

export const TmuxPaneCreateInput = Schema.Union([
  TmuxShellPaneCreateInput,
  TmuxNeovimPaneCreateInput,
  TmuxAgentPaneCreateInput,
  TmuxWorkflowPaneCreateInput,
  TmuxManagedProcessPaneCreateInput,
  TmuxRemoteProcessPaneCreateInput,
  TmuxBrowserLabPaneCreateInput,
  TmuxCustomPaneCreateInput,
]);
export type TmuxPaneCreateInput = typeof TmuxPaneCreateInput.Type;

export const TmuxPaneAttachMetadataInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  metadata: TmuxOperationalPaneMetadata,
});
export type TmuxPaneAttachMetadataInput = typeof TmuxPaneAttachMetadataInput.Type;

export const TmuxOperationalPaneStatusInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
});
export type TmuxOperationalPaneStatusInput = typeof TmuxOperationalPaneStatusInput.Type;

export const TmuxOperationalPaneStatus = Schema.Struct({
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  paneId: TmuxPaneId,
  kind: TmuxPaneKind,
  status: TmuxPaneStatus,
  metadata: TmuxOperationalPaneMetadata,
  stream: TmuxPaneStreamDescriptor,
  updatedAt: IsoDateTime,
});
export type TmuxOperationalPaneStatus = typeof TmuxOperationalPaneStatus.Type;

export const TmuxOperationalPaneStatusResult = Schema.Struct({
  workspaceId: TmuxWorkspaceId,
  panes: Schema.Array(TmuxOperationalPaneStatus),
  revision: NonNegativeInt,
});
export type TmuxOperationalPaneStatusResult = typeof TmuxOperationalPaneStatusResult.Type;

export const TmuxNeovimPaneInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
  cwd: Schema.optional(TmuxPath),
  files: Schema.optional(Schema.Array(TmuxPath).check(Schema.isMaxLength(128))),
  line: Schema.optional(PositiveInt),
  column: Schema.optional(PositiveInt),
  profileId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  themeId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  keybindingProfileId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  split: Schema.optional(Schema.Literals(["same-window", "horizontal", "vertical"])),
  launchSource: Schema.optional(Schema.Literals(["user", "agent", "workflow", "restore"])),
});
export type TmuxNeovimPaneInput = typeof TmuxNeovimPaneInput.Type;

export const TmuxPaneCloseInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  mode: Schema.Literals(["detach", "terminate", "kill"]),
});
export type TmuxPaneCloseInput = typeof TmuxPaneCloseInput.Type;

export const TmuxPaneFocusInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
});
export type TmuxPaneFocusInput = typeof TmuxPaneFocusInput.Type;

export const TmuxWindowFocusInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  windowId: TmuxWindowId,
});
export type TmuxWindowFocusInput = typeof TmuxWindowFocusInput.Type;

export const TmuxPaneResizeInput = Schema.Struct({
  actor: TmuxActor,
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  cols: TmuxPaneCols,
  rows: TmuxPaneRows,
});
export type TmuxPaneResizeInput = typeof TmuxPaneResizeInput.Type;

export const TmuxPaneWriteInput = Schema.Struct({
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  actor: TmuxActor,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
});
export type TmuxPaneWriteInput = typeof TmuxPaneWriteInput.Type;

export const TmuxPaneWriteAcceptedResult = Schema.Struct({
  type: Schema.Literal("accepted"),
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  inputSeq: TmuxSequence,
  acceptedAt: IsoDateTime,
});
export type TmuxPaneWriteAcceptedResult = typeof TmuxPaneWriteAcceptedResult.Type;

export const TmuxPaneWriteRejectedResult = Schema.Struct({
  type: Schema.Literal("rejected"),
  workspaceId: TmuxWorkspaceId,
  paneId: TmuxPaneId,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  code: Schema.Literals(["not-running", "permission-denied", "backpressure", "invalid-state"]),
  message: TrimmedNonEmptyString,
  rejectedAt: IsoDateTime,
});
export type TmuxPaneWriteRejectedResult = typeof TmuxPaneWriteRejectedResult.Type;

export const TmuxPaneWriteResult = Schema.Union([
  TmuxPaneWriteAcceptedResult,
  TmuxPaneWriteRejectedResult,
]);
export type TmuxPaneWriteResult = typeof TmuxPaneWriteResult.Type;

export class TmuxKernelError extends Schema.TaggedErrorClass<TmuxKernelError>()("TmuxKernelError", {
  code: Schema.Literals([
    "not-found",
    "permission-denied",
    "tmux-unavailable",
    "control-mode-unavailable",
    "nvim-unavailable",
    "invalid-state",
    "stream-overflow",
    "io-error",
  ]),
  message: TrimmedNonEmptyString,
  workspaceId: Schema.optional(TmuxWorkspaceId),
  windowId: Schema.optional(TmuxWindowId),
  paneId: Schema.optional(TmuxPaneId),
  cause: Schema.optional(Schema.Defect),
}) {}
