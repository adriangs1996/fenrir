import { Schema } from "effect";

import type {
  GitActionProgressEvent,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitResolvePullRequestResult,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
} from "./git";
import type {
  AmendGitDiffStagedChangesInput,
  AmendGitDiffStagedChangesResult,
  CommentGitDiffChangeRequestLinesInput,
  CreateGitDiffIgnoreListInput,
  CreateGitDiffReviewNoteInput,
  CreateGitDiffStashInput,
  CreateGitDiffStashResult,
  DeleteGitDiffIgnoreListInput,
  DeleteGitDiffReviewNoteInput,
  DiscardGitDiffWorktreeChangesInput,
  DiscardGitDiffWorktreeChangesResult,
  DiscardGitDiffWorktreeHunkInput,
  DiscardGitDiffWorktreeHunkResult,
  GitDiffActionResult,
  GitDiffChangeRequestReferenceInput,
  GitDiffCommitActionResult,
  GitDiffCommitReferenceInput,
  GitDiffMergeChangeRequestInput,
  GitDiffOperationActionInput,
  GitDiffOperationActionResult,
  GitDiffReviewNote,
  GitDiffStashReferenceInput,
  LoadActiveChangeRequestStackedDiffFileIndexInput,
  LoadActiveChangeRequestStackedDiffFileIndexResult,
  LoadDiffFileInput,
  LoadDiffFileIndexInput,
  LoadDiffFileIndexResult,
  LoadDiffFileResult,
  LoadGitDiffChangeSignatureInput,
  LoadGitDiffChangeSignatureResult,
  LoadGitDiffChangeRequestChecksInput,
  LoadGitDiffChangeRequestChecksResult,
  LoadGitDiffChangeRequestReviewThreadsInput,
  LoadGitDiffChangeRequestReviewThreadsResult,
  LoadGitDiffHistoryInput,
  LoadGitDiffHistoryResult,
  LoadGitDiffIgnoreListsInput,
  LoadGitDiffIgnoreListsResult,
  LoadGitDiffOperationInput,
  LoadGitDiffOperationResult,
  LoadGitDiffRepositoriesInput,
  LoadGitDiffRepositoriesResult,
  LoadGitDiffReviewNotesInput,
  LoadGitDiffReviewNotesResult,
  LoadGitDiffReviewSessionInput,
  LoadGitDiffReviewSessionResult,
  LoadGitDiffStashesInput,
  LoadGitDiffStashesResult,
  LoadStackedDiffFileIndexInput,
  LoadStackedDiffFileIndexResult,
  RequestGitDiffReviewNavigationInput,
  RevertGitDiffChangeRequestLinesInput,
  RevertGitDiffChangeRequestLinesResult,
  StageGitDiffWorktreeChangesInput,
  StageGitDiffWorktreeChangesResult,
  UnstageGitDiffStagedChangesInput,
  UnstageGitDiffStagedChangesResult,
  UpdateGitDiffIgnoreListInput,
  UpdateGitDiffReviewSessionInput,
} from "./gitDiff";
import type {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl";
import type {
  SourceControlStackAbortOperationInput,
  SourceControlStackContinueOperationInput,
  SourceControlStackCreateEntryInput,
  SourceControlStackDropEntryInput,
  SourceControlStackGetSnapshotInput,
  SourceControlStackMutationResult,
  SourceControlStackPublishInput,
  SourceControlStackRenameEntryInput,
  SourceControlStackReorderInput,
  SourceControlStackRestackInput,
  SourceControlStackSnapshot,
  SourceControlStackSplitEntryInput,
  SourceControlStackSquashEntryInput,
  SourceControlStackStreamEvent,
  SourceControlStackSwitchEntryInput,
  SourceControlStackSyncInput,
} from "./sourceControlStack";
import type {
  ProjectCopyEntryInput,
  ProjectCopyEntryResult,
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectCreateFileInput,
  ProjectCreateFileResult,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectMoveEntryInput,
  ProjectMoveEntryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectRemoveEntryInput,
  ProjectRemoveEntryResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ServerConfig,
  ServerClearLogsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProviderUpdateInput,
  ServerProviderUpdatedPayload,
  ServerRemoveKeybindingResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerTraceDiagnosticsResult,
  ServerUpsertKeybindingResult,
} from "./server";
import type { ServerListProviderSkillsInput, ServerListProviderSkillsResult } from "./skill";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  TmuxAttachInput,
  TmuxDetachInput,
  TmuxWriteInput,
  TmuxResizeInput,
} from "./terminal";

import type { TmuxSessionSnapshot } from "./terminal";
import type { ServerRemoveKeybindingInput, ServerUpsertKeybindingInput } from "./server";
import type { ProviderInstanceId } from "./providerInstance";
import type {
  ClientOrchestrationCommand,
  GlobalScript,
  OrchestrationGetThreadSnapshotInput,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationManagedProcessStreamItem,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThread,
  ProjectScriptIcon,
} from "./orchestration";
import type { EnvironmentId } from "./baseSchemas";
import { EditorId, type NeovimThemeSelection } from "./editor";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import { ClientSettings, ServerSettings, ServerSettingsPatch } from "./settings";
import type { VpnConnectionState, VpnProfile, VpnProfileId } from "./vpn";
import type {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensClearLiveSessionStorageInput,
  TrafficLensClearLocalStorageInput,
  TrafficLensDeleteCookieForOriginInput,
  TrafficLensContinueInput,
  TrafficLensCookieEntry,
  TrafficLensDomStorageEntry,
  TrafficLensDeleteCookieInput,
  TrafficLensDeleteLiveSessionStorageItemInput,
  TrafficLensDeleteLocalStorageItemInput,
  TrafficLensDeleteStorageEntryInput,
  TrafficLensGetApplicableCookiesInput,
  TrafficLensGetLiveSessionStorageInput,
  TrafficLensGetLocalStorageInput,
  TrafficLensGetSessionStorageSnapshotInput,
  TrafficLensListSessionStorageSnapshotsInput,
  TrafficLensListStorageOriginsInput,
  TrafficLensOverride,
  TrafficLensOverrideInput,
  TrafficLensPausedEvent,
  TrafficLensPausedRequest,
  TrafficLensProfile,
  TrafficLensProfileInput,
  TrafficLensRehydrateSessionStorageSnapshotInput,
  TrafficLensRule,
  TrafficLensRuleInput,
  TrafficLensSetCookieForOriginInput,
  TrafficLensSetCookieInput,
  TrafficLensSetLiveSessionStorageItemInput,
  TrafficLensSetLocalStorageItemInput,
  TrafficLensSetStorageEntryInput,
  TrafficLensStorageEvent,
  TrafficLensStorageEntry,
  TrafficLensStorageOriginSummary,
  TrafficLensSetTabMobilePresetInput,
  TrafficLensSetTabViewModeInput,
  TrafficLensTabEvent,
  TrafficLensTabSnapshot,
  TrafficLensUpdateSessionStorageSnapshotInput,
} from "./trafficLens";
import type {
  CreateRawTcpListenerInput,
  RawTcpEvent,
  RawTcpListenerSnapshot,
  RawTcpSessionCloseInput,
  RawTcpSessionSnapshot,
  RawTcpSessionUpgradePtyInput,
  RawTcpSessionWriteInput,
  StopRawTcpListenerInput,
} from "./rawTcpListener";
import type {
  CreateRemoteHostInput,
  DeleteRemoteHostInput,
  ListRemoteCommandRunsInput,
  ListRemoteDirectoryInput,
  ListRemoteDirectoryResult,
  RemoteCommandRunSnapshot,
  RemoteConnectionSnapshot,
  RemoteControllerEvent,
  RemoteHostSnapshot,
  SendRemoteCommandInput,
  SetRemoteConnectionPathInput,
  StartRemoteConnectionInput,
  StopRemoteConnectionInput,
  UpdateRemoteHostInput,
} from "./remoteController";
import type {
  WorkflowArchiveInput,
  WorkflowArchiveResult,
  WorkflowCancelScheduledRunInput,
  WorkflowCancelScheduledRunResult,
  WorkflowCreateDraftInput,
  WorkflowCreateDraftResult,
  WorkflowEventStreamItem,
  WorkflowGetTimelineInput,
  WorkflowGetTimelineResult,
  WorkflowLinkThreadInput,
  WorkflowLinkThreadResult,
  WorkflowListMemoryInput,
  WorkflowListMemoryResult,
  WorkflowListProjectWorkflowsInput,
  WorkflowListProjectWorkflowsResult,
  WorkflowListThreadInput,
  WorkflowListThreadResult,
  WorkflowListThreadWorkflowLinksInput,
  WorkflowListThreadWorkflowLinksResult,
  WorkflowOpenSourceInput,
  WorkflowOpenSourceResult,
  WorkflowRespondToInputInput,
  WorkflowRunByIdInput,
  WorkflowRunInput,
  WorkflowRunResult,
  WorkflowRunSnapshot,
  WorkflowScheduleRunInput,
  WorkflowScheduleRunResult,
  WorkflowStopInput,
  WorkflowSuppressMemoryItemInput,
  WorkflowSuppressMemoryItemResult,
  WorkflowSyncSourceInput,
  WorkflowSyncSourceResult,
  WorkflowUnlinkThreadInput,
  WorkflowUnlinkThreadResult,
  WorkflowValidateInput,
  WorkflowValidateResult,
} from "./workflows";
import type { KeybindingCommand, ResolvedKeybindingsConfig } from "./keybindings";

// Editor IPC channel names live in ./ipcChannels (single source of truth for
// every desktop IPC channel string).

// ── Editor IPC payloads ──────────────────────────────────────
export const EditorOpenFileInput = Schema.Struct({
  path: Schema.NonEmptyString,
  line: Schema.optional(Schema.Number),
  col: Schema.optional(Schema.Number),
});
export type EditorOpenFileInput = typeof EditorOpenFileInput.Type;

export const EditorEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("buf_enter"),
    file: Schema.String,
    ft: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("buf_write_post"),
    file: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("buf_modified_set"),
    file: Schema.String,
    modified: Schema.Boolean,
  }),
]);
export type EditorEvent = typeof EditorEvent.Type;

export const EditorSendToComposer = Schema.Struct({
  file: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
  text: Schema.String,
});
export type EditorSendToComposer = typeof EditorSendToComposer.Type;

export interface EditorCaptureSelectionOptions {
  readonly activeOnly?: boolean;
}

export const EditorActiveFile = Schema.Struct({
  file: Schema.String,
  cursorLine: Schema.Number,
  lineCount: Schema.Number,
});
export type EditorActiveFile = typeof EditorActiveFile.Type;

export interface VSCodeShortcutContext {
  readonly terminalFocus: boolean;
  readonly terminalOpen: boolean;
  readonly [key: string]: boolean;
}

export interface VSCodeShortcutState {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
  readonly context: Partial<VSCodeShortcutContext>;
}

export const EditorCmd = Schema.Struct({
  subcommand: Schema.Literals(["focus-chat", "new-thread", "submit"]),
});
export type EditorCmd = typeof EditorCmd.Type;

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export interface PersistedSavedEnvironmentRecord {
  environmentId: EnvironmentId;
  label: string;
  wsBaseUrl: string;
  httpBaseUrl: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export interface NvimProbeResult {
  available: boolean;
  version: string | null;
  binary: string | null;
  error: string | null;
}

export type VSCodeWebServerKind = "code-server" | "openvscode-server";

export interface VSCodeProbeResult {
  available: boolean;
  serverKind: VSCodeWebServerKind | null;
  command: string | null;
  version: string | null;
  error: string | null;
}

export interface VSCodeWebSession {
  cwd: string;
  url: string;
  serverKind: VSCodeWebServerKind;
  command: string;
}

export interface EmbeddedViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopBridge {
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
  removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  pickFolder: (options?: { initialPath?: string }) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  onPowerResumed: (listener: () => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;

  // VPN
  getVpnState: () => Promise<VpnConnectionState>;
  getVpnProfiles: () => Promise<readonly VpnProfile[]>;
  addVpnProfile: (label: string, configPath: string) => Promise<VpnProfile>;
  removeVpnProfile: (profileId: VpnProfileId) => Promise<void>;
  connectVpn: (profileId: VpnProfileId) => Promise<VpnConnectionState>;
  disconnectVpn: () => Promise<VpnConnectionState>;
  pickFile: (options: {
    filters: Array<{ name: string; extensions: string[] }>;
  }) => Promise<string | null>;
  onVpnStateChange: (listener: (state: VpnConnectionState) => void) => () => void;

  // Traffic Lens
  trafficLensCreateTab: (url?: string) => Promise<TrafficLensTabSnapshot>;
  trafficLensCreateTabInProfile: (input: {
    url?: string;
    profileId: string;
  }) => Promise<TrafficLensTabSnapshot>;
  trafficLensCloseTab: (tabId: string) => Promise<void>;
  trafficLensNavigate: (tabId: string, url: string) => Promise<void>;
  trafficLensGoBack: (tabId: string) => Promise<void>;
  trafficLensGoForward: (tabId: string) => Promise<void>;
  trafficLensReload: (tabId: string) => Promise<void>;
  trafficLensGetTabs: () => Promise<readonly TrafficLensTabSnapshot[]>;
  trafficLensSetTabViewMode: (
    input: TrafficLensSetTabViewModeInput,
  ) => Promise<TrafficLensTabSnapshot>;
  trafficLensSetTabMobilePreset: (
    input: TrafficLensSetTabMobilePresetInput,
  ) => Promise<TrafficLensTabSnapshot>;
  trafficLensSetBounds: (
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => Promise<void>;
  trafficLensShowTab: (tabId: string) => Promise<void>;
  trafficLensHideAllTabs: () => Promise<void>;
  trafficLensListRules: () => Promise<readonly TrafficLensRule[]>;
  trafficLensCreateRule: (
    input: TrafficLensRuleInput & { id?: string },
  ) => Promise<TrafficLensRule>;
  trafficLensUpdateRule: (id: string, input: TrafficLensRuleInput) => Promise<TrafficLensRule>;
  trafficLensDeleteRule: (id: string) => Promise<void>;
  trafficLensSetRuleEnabled: (id: string, enabled: boolean) => Promise<void>;
  trafficLensListPaused: () => Promise<readonly TrafficLensPausedRequest[]>;
  trafficLensContinuePaused: (input: TrafficLensContinueInput) => Promise<void>;
  trafficLensDropPaused: (input: { pauseId: string }) => Promise<void>;
  trafficLensListProfiles: () => Promise<readonly TrafficLensProfile[]>;
  trafficLensCreateProfile: (
    input: TrafficLensProfileInput & { id?: string },
  ) => Promise<TrafficLensProfile>;
  trafficLensUpdateProfile: (
    id: string,
    input: TrafficLensProfileInput,
  ) => Promise<TrafficLensProfile>;
  trafficLensDeleteProfile: (id: string) => Promise<void>;
  trafficLensGetCookies: (tabId: string) => Promise<readonly TrafficLensCookieEntry[]>;
  trafficLensSetCookie: (input: TrafficLensSetCookieInput) => Promise<void>;
  trafficLensDeleteCookie: (input: TrafficLensDeleteCookieInput) => Promise<void>;
  trafficLensGetStorage: (tabId: string) => Promise<readonly TrafficLensStorageEntry[]>;
  trafficLensSetStorageEntry: (input: TrafficLensSetStorageEntryInput) => Promise<void>;
  trafficLensDeleteStorageEntry: (input: TrafficLensDeleteStorageEntryInput) => Promise<void>;
  trafficLensListStorageOrigins: (
    input: TrafficLensListStorageOriginsInput,
  ) => Promise<readonly TrafficLensStorageOriginSummary[]>;
  trafficLensCaptureStorageOrigin: (input: {
    profileId: string;
    origin: string;
    tabId?: string;
  }) => Promise<void>;
  trafficLensGetApplicableCookies: (
    input: TrafficLensGetApplicableCookiesInput,
  ) => Promise<readonly TrafficLensCookieEntry[]>;
  trafficLensSetCookieForOrigin: (input: TrafficLensSetCookieForOriginInput) => Promise<void>;
  trafficLensDeleteCookieForOrigin: (input: TrafficLensDeleteCookieForOriginInput) => Promise<void>;
  trafficLensGetLocalStorage: (
    input: TrafficLensGetLocalStorageInput,
  ) => Promise<readonly TrafficLensDomStorageEntry[]>;
  trafficLensSetLocalStorageItem: (input: TrafficLensSetLocalStorageItemInput) => Promise<void>;
  trafficLensDeleteLocalStorageItem: (
    input: TrafficLensDeleteLocalStorageItemInput,
  ) => Promise<void>;
  trafficLensClearLocalStorage: (input: TrafficLensClearLocalStorageInput) => Promise<void>;
  trafficLensGetLiveSessionStorage: (
    input: TrafficLensGetLiveSessionStorageInput,
  ) => Promise<readonly TrafficLensDomStorageEntry[]>;
  trafficLensSetLiveSessionStorageItem: (
    input: TrafficLensSetLiveSessionStorageItemInput,
  ) => Promise<void>;
  trafficLensDeleteLiveSessionStorageItem: (
    input: TrafficLensDeleteLiveSessionStorageItemInput,
  ) => Promise<void>;
  trafficLensClearLiveSessionStorage: (
    input: TrafficLensClearLiveSessionStorageInput,
  ) => Promise<void>;
  trafficLensListSessionStorageSnapshots: (
    input: TrafficLensListSessionStorageSnapshotsInput,
  ) => Promise<readonly TrafficLensArchivedSessionStorageSummary[]>;
  trafficLensGetSessionStorageSnapshot: (
    input: TrafficLensGetSessionStorageSnapshotInput,
  ) => Promise<readonly TrafficLensDomStorageEntry[]>;
  trafficLensUpdateSessionStorageSnapshot: (
    input: TrafficLensUpdateSessionStorageSnapshotInput,
  ) => Promise<void>;
  trafficLensRehydrateSessionStorageSnapshot: (
    input: TrafficLensRehydrateSessionStorageSnapshotInput,
  ) => Promise<{ tabId: string }>;
  trafficLensListOverrides: () => Promise<readonly TrafficLensOverride[]>;
  trafficLensCreateOverride: (
    input: TrafficLensOverrideInput & { id?: string },
  ) => Promise<TrafficLensOverride>;
  trafficLensUpdateOverride: (
    id: string,
    input: TrafficLensOverrideInput,
  ) => Promise<TrafficLensOverride>;
  trafficLensDeleteOverride: (id: string) => Promise<void>;
  trafficLensSetOverrideEnabled: (id: string, enabled: boolean) => Promise<void>;
  onTrafficLensTabEvent: (listener: (event: TrafficLensTabEvent) => void) => () => void;
  onTrafficLensPausedEvent: (listener: (event: TrafficLensPausedEvent) => void) => () => void;
  onTrafficLensStorageChanged: (listener: (tabId: string) => void) => () => void;
  onTrafficLensStorageEvent: (listener: (event: TrafficLensStorageEvent) => void) => () => void;

  // Neovim
  neovimAttach: (cwd: string, cols: number, rows: number) => Promise<void>;
  neovimDetach: () => Promise<void>;
  neovimInput: (keys: string) => Promise<void>;
  neovimResize: (cols: number, rows: number) => Promise<void>;
  onNeovimRedraw: (listener: (events: unknown[]) => void) => () => void;
  /**
   * Update the working directory used by the render-loop NeovimSource.
   * Triggers a respawn of the embedded nvim if one is already running.
   */
  neovimSetCwd: (cwd: string) => Promise<void>;
  neovimSetTheme: (selection: NeovimThemeSelection) => Promise<void>;

  // Bridge availability detection
  /** True when this BrowserWindow is the main (first) window. */
  isMainWindow: () => boolean;
  /** Resolves to true when nvim binary is found on PATH. Cached after first probe. */
  nvimAvailable: () => Promise<boolean>;
  /** Full probe result with version, binary path, and error detail. */
  nvimProbeDetail: () => Promise<NvimProbeResult>;

  // Embedded VS Code
  /** Resolves to true when a supported local VS Code web server binary is found on PATH. */
  vscodeAvailable?: () => Promise<boolean>;
  /** Full probe result with selected server command and error detail. */
  vscodeProbeDetail?: () => Promise<VSCodeProbeResult>;
  /** Start or reuse the embedded VS Code web session for a workspace cwd. */
  vscodeStart?: (cwd: string) => Promise<VSCodeWebSession>;
  /** Start/reuse embedded VS Code for a file or folder target. */
  vscodeOpenFile?: (input: EditorOpenFileInput) => Promise<VSCodeWebSession>;
  vscodeSetBounds?: (bounds: EmbeddedViewBounds) => Promise<void>;
  vscodeShow?: () => Promise<void>;
  vscodeHide?: () => Promise<void>;
  vscodeSetShortcutState?: (state: VSCodeShortcutState) => Promise<void>;
  vscodeOnShortcutCommand?: (cb: (command: KeybindingCommand) => void) => () => void;

  // Render loop (backend-agnostic frame pipeline)
  renderStart: () => Promise<void>;
  renderStop: () => Promise<void>;
  renderSetFps: (fps: number) => Promise<void>;
  /**
   * Sync the embedded renderer viewport after the editor surface is restored
   * from a hidden state, then force a full repaint from the main process.
   */
  renderSyncViewport: (w: number, h: number) => Promise<void>;
  setEditorFontMetrics: (metrics: EditorFontMetrics) => Promise<void>;
  sendInput: (event: InputEvent) => void;
  onFrame: (listener: (frame: Frame) => void) => () => void;

  // Editor IPC (nvim ↔ renderer)
  editor: {
    openFile: (input: EditorOpenFileInput) => Promise<void>;
    onEvent: (cb: (ev: EditorEvent) => void) => () => void;
    onSendToComposer: (cb: (ev: EditorSendToComposer) => void) => () => void;
    onCmd: (cb: (ev: EditorCmd) => void) => () => void;
    captureSelection: (
      options?: EditorCaptureSelectionOptions,
    ) => Promise<EditorSendToComposer | null>;
    captureActiveFile: () => Promise<EditorActiveFile | null>;
    /** Invoke a whitelisted Lua bridge function on the embedded nvim. */
    invokeBridge: (fn: string) => Promise<void>;
  };
}

/**
 * Adapter boundary for host-shell capabilities exposed to the web runtime.
 *
 * `DesktopBridge` is the current Electron preload implementation. Web code that
 * only needs to know "am I running inside a desktop host?" should depend on this
 * wrapper rather than treating `window.desktopBridge` as an Electron-specific
 * global. A future native terminal shell can provide an equivalent host adapter
 * while keeping server/backend interactions on WebSocket contracts.
 */
export type DesktopHostKind = "electron" | "native-terminal";

export interface DesktopHostAdapter {
  readonly kind: DesktopHostKind;
  readonly bridge: DesktopBridge;
}

export interface CellMetrics {
  width: number;
  height: number;
  ascent: number;
  /**
   * CSS font shorthand WITHOUT a weight or style component, e.g.
   * `14px "JetBrains Mono", monospace`. Consumers prepend their own
   * `italic` / weight tokens (used by the glyph atlas to render bold/italic
   * variants without colliding with the user-chosen base weight).
   */
  font: string;
  fontWeight: number;
  ligatures: boolean;
}

export interface EditorFontMetrics {
  width: number;
  height: number;
  ascent: number;
  font: string;
  fontWeight: number;
  ligatures: boolean;
}

export interface HlAttrEntry {
  id: number;
  fg?: number;
  bg?: number;
  sp?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

export interface DefaultColorsEntry {
  fg: number;
  bg: number;
  sp: number;
}

export interface GridDelta {
  gridId: number;
  cols: number;
  rowIndexes: Uint32Array;
  cellChars: Uint32Array;
  cellHl: Uint32Array;
}

export interface ResizedGrid {
  id: number;
  w: number;
  h: number;
}

export type WindowKind = "default" | "float" | "external" | "msg";

export interface WindowEntry {
  gridId: number;
  kind: WindowKind;
  row: number;
  col: number;
  zIndex: number;
  hidden: boolean;
}

export type CursorShape = "block" | "horizontal" | "vertical";

export interface CursorEntry {
  gridId: number;
  row: number;
  col: number;
  shape: CursorShape;
  text?: string;
}

export interface NeovimFrame {
  kind: "neovim";
  seq: number;
  cellMetrics?: CellMetrics;
  hl?: HlAttrEntry[];
  defaultColors?: DefaultColorsEntry;
  resizedGrids?: ResizedGrid[];
  closedGrids?: number[];
  gridDeltas?: GridDelta[];
  windows?: WindowEntry[];
  cursor?: CursorEntry;
}

export type Frame = NeovimFrame;

export interface InputModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type InputEvent =
  | {
      kind: "key";
      type: "down" | "up";
      key: string;
      code: string;
      mods: InputModifiers;
    }
  | {
      kind: "paste";
      text: string;
    }
  | {
      kind: "mouse";
      type: "down" | "up" | "move" | "wheel";
      x: number;
      y: number;
      button?: 0 | 1 | 2;
      deltaX?: number;
      deltaY?: number;
      mods: InputModifiers;
    }
  | { kind: "resize"; w: number; h: number };

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface CreateGlobalActionInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
}

export interface UpdateGlobalActionInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
}

export interface LocalApi {
  dialogs: {
    pickFolder: (options?: { initialPath?: string }) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
    setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
    removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    listProviderSkills: (
      input: ServerListProviderSkillsInput,
    ) => Promise<ServerListProviderSkillsResult>;
    refreshProviders: (input?: {
      readonly instanceId?: ProviderInstanceId;
    }) => Promise<ServerProviderUpdatedPayload>;
    updateProvider: (input: ServerProviderUpdateInput) => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    removeKeybinding: (input: ServerRemoveKeybindingInput) => Promise<ServerRemoveKeybindingResult>;
    getTraceDiagnostics: () => Promise<ServerTraceDiagnosticsResult>;
    getProcessDiagnostics: () => Promise<ServerProcessDiagnosticsResult>;
    getProcessResourceHistory: (
      input: ServerProcessResourceHistoryInput,
    ) => Promise<ServerProcessResourceHistoryResult>;
    signalProcess: (input: ServerSignalProcessInput) => Promise<ServerSignalProcessResult>;
    clearLogs: () => Promise<ServerClearLogsResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>;
    getGlobalActions: () => Promise<GlobalScript[]>;
    createGlobalAction: (input: CreateGlobalActionInput) => Promise<GlobalScript>;
    updateGlobalAction: (id: string, input: UpdateGlobalActionInput) => Promise<GlobalScript>;
    deleteGlobalAction: (id: string) => Promise<void>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, and git operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  server: {
    listProviderSkills: (
      input: ServerListProviderSkillsInput,
    ) => Promise<ServerListProviderSkillsResult>;
  };
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
    attachTmux: (input: typeof TmuxAttachInput.Encoded) => Promise<TmuxSessionSnapshot>;
    detachTmux: (input: typeof TmuxDetachInput.Encoded) => Promise<void>;
    writeTmux: (input: typeof TmuxWriteInput.Encoded) => Promise<void>;
    resizeTmux: (input: typeof TmuxResizeInput.Encoded) => Promise<void>;
  };
  rawTcp: {
    createListener: (input: CreateRawTcpListenerInput) => Promise<RawTcpListenerSnapshot>;
    stopListener: (input: StopRawTcpListenerInput) => Promise<void>;
    listListeners: () => Promise<readonly RawTcpListenerSnapshot[]>;
    listSessions: () => Promise<readonly RawTcpSessionSnapshot[]>;
    sessionWrite: (input: RawTcpSessionWriteInput) => Promise<void>;
    sessionUpgradePty: (input: RawTcpSessionUpgradePtyInput) => Promise<RawTcpSessionSnapshot>;
    sessionClose: (input: RawTcpSessionCloseInput) => Promise<void>;
    onEvent: (callback: (event: RawTcpEvent) => void) => () => void;
  };
  remoteController: {
    listHosts: () => Promise<readonly RemoteHostSnapshot[]>;
    createHost: (input: CreateRemoteHostInput) => Promise<RemoteHostSnapshot>;
    updateHost: (input: UpdateRemoteHostInput) => Promise<RemoteHostSnapshot>;
    deleteHost: (input: DeleteRemoteHostInput) => Promise<void>;
    startConnection: (input: StartRemoteConnectionInput) => Promise<RemoteConnectionSnapshot>;
    stopConnection: (input: StopRemoteConnectionInput) => Promise<RemoteConnectionSnapshot>;
    setConnectionPath: (input: SetRemoteConnectionPathInput) => Promise<RemoteConnectionSnapshot>;
    listConnections: () => Promise<readonly RemoteConnectionSnapshot[]>;
    sendCommand: (input: SendRemoteCommandInput) => Promise<RemoteCommandRunSnapshot>;
    listCommandRuns: (
      input: ListRemoteCommandRunsInput,
    ) => Promise<readonly RemoteCommandRunSnapshot[]>;
    listDirectory: (input: ListRemoteDirectoryInput) => Promise<ListRemoteDirectoryResult>;
    onEvent: (callback: (event: RemoteControllerEvent) => void) => () => void;
  };
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    createFile: (input: ProjectCreateFileInput) => Promise<ProjectCreateFileResult>;
    createDirectory: (input: ProjectCreateDirectoryInput) => Promise<ProjectCreateDirectoryResult>;
    removeEntry: (input: ProjectRemoveEntryInput) => Promise<ProjectRemoveEntryResult>;
    moveEntry: (input: ProjectMoveEntryInput) => Promise<ProjectMoveEntryResult>;
    copyEntry: (input: ProjectCopyEntryInput) => Promise<ProjectCopyEntryResult>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  sourceControl: {
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
    publishRepository: (
      input: SourceControlPublishRepositoryInput,
    ) => Promise<SourceControlPublishRepositoryResult>;
    stack: {
      getSnapshot: (
        input: SourceControlStackGetSnapshotInput,
      ) => Promise<SourceControlStackSnapshot>;
      createEntry: (
        input: SourceControlStackCreateEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      switchEntry: (
        input: SourceControlStackSwitchEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      renameEntry: (
        input: SourceControlStackRenameEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      dropEntry: (
        input: SourceControlStackDropEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      reorderEntries: (
        input: SourceControlStackReorderInput,
      ) => Promise<SourceControlStackMutationResult>;
      restack: (input: SourceControlStackRestackInput) => Promise<SourceControlStackMutationResult>;
      sync: (input: SourceControlStackSyncInput) => Promise<SourceControlStackMutationResult>;
      squashEntry: (
        input: SourceControlStackSquashEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      splitEntry: (
        input: SourceControlStackSplitEntryInput,
      ) => Promise<SourceControlStackMutationResult>;
      publish: (input: SourceControlStackPublishInput) => Promise<SourceControlStackMutationResult>;
      continueOperation: (
        input: SourceControlStackContinueOperationInput,
      ) => Promise<SourceControlStackMutationResult>;
      abortOperation: (
        input: SourceControlStackAbortOperationInput,
      ) => Promise<SourceControlStackMutationResult>;
      onEvent: (
        input: SourceControlStackGetSnapshotInput,
        callback: (event: SourceControlStackStreamEvent) => void,
        options?: { onResubscribe?: () => void },
      ) => () => void;
    };
  };
  vcs: {
    listRefs: (input: VcsListRefsInput) => Promise<VcsListRefsResult>;
    createWorktree: (input: VcsCreateWorktreeInput) => Promise<VcsCreateWorktreeResult>;
    removeWorktree: (input: VcsRemoveWorktreeInput) => Promise<void>;
    createRef: (input: VcsCreateRefInput) => Promise<VcsCreateRefResult>;
    switchRef: (input: VcsSwitchRefInput) => Promise<VcsSwitchRefResult>;
    init: (input: VcsInitInput) => Promise<void>;
    pull: (input: VcsPullInput) => Promise<VcsPullResult>;
    refreshStatus: (input: VcsStatusInput) => Promise<VcsStatusResult>;
    onStatus: (
      input: VcsStatusInput,
      callback: (status: VcsStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  git: {
    runStackedAction: (
      input: GitRunStackedActionInput,
      options?: { readonly onProgress?: (event: GitActionProgressEvent) => void },
    ) => Promise<GitRunStackedActionResult>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
  };
  gitDiff: {
    listRepositories: (
      input: LoadGitDiffRepositoriesInput,
    ) => Promise<LoadGitDiffRepositoriesResult>;
    loadChangeSignature: (
      input: LoadGitDiffChangeSignatureInput,
    ) => Promise<LoadGitDiffChangeSignatureResult>;
    loadFile: (input: LoadDiffFileInput) => Promise<LoadDiffFileResult>;
    loadFileIndex: (input: LoadDiffFileIndexInput) => Promise<LoadDiffFileIndexResult>;
    loadActiveChangeRequestStackedFileIndex: (
      input: LoadActiveChangeRequestStackedDiffFileIndexInput,
    ) => Promise<LoadActiveChangeRequestStackedDiffFileIndexResult>;
    loadStackedFileIndex: (
      input: LoadStackedDiffFileIndexInput,
    ) => Promise<LoadStackedDiffFileIndexResult>;
    loadHistory: (input: LoadGitDiffHistoryInput) => Promise<LoadGitDiffHistoryResult>;
    loadIgnoreLists: (input: LoadGitDiffIgnoreListsInput) => Promise<LoadGitDiffIgnoreListsResult>;
    createIgnoreList: (
      input: CreateGitDiffIgnoreListInput,
    ) => Promise<LoadGitDiffIgnoreListsResult>;
    updateIgnoreList: (
      input: UpdateGitDiffIgnoreListInput,
    ) => Promise<LoadGitDiffIgnoreListsResult>;
    deleteIgnoreList: (
      input: DeleteGitDiffIgnoreListInput,
    ) => Promise<LoadGitDiffIgnoreListsResult>;
    loadReviewNotes: (input: LoadGitDiffReviewNotesInput) => Promise<LoadGitDiffReviewNotesResult>;
    createReviewNote: (input: CreateGitDiffReviewNoteInput) => Promise<GitDiffReviewNote>;
    deleteReviewNote: (input: DeleteGitDiffReviewNoteInput) => Promise<GitDiffActionResult>;
    updateReviewSession: (input: UpdateGitDiffReviewSessionInput) => Promise<GitDiffActionResult>;
    loadReviewSession: (
      input: LoadGitDiffReviewSessionInput,
    ) => Promise<LoadGitDiffReviewSessionResult>;
    requestReviewNavigation: (
      input: RequestGitDiffReviewNavigationInput,
    ) => Promise<GitDiffActionResult>;
    stageWorktreeChanges: (
      input: StageGitDiffWorktreeChangesInput,
    ) => Promise<StageGitDiffWorktreeChangesResult>;
    unstageStagedChanges: (
      input: UnstageGitDiffStagedChangesInput,
    ) => Promise<UnstageGitDiffStagedChangesResult>;
    discardWorktreeChanges: (
      input: DiscardGitDiffWorktreeChangesInput,
    ) => Promise<DiscardGitDiffWorktreeChangesResult>;
    discardWorktreeHunk: (
      input: DiscardGitDiffWorktreeHunkInput,
    ) => Promise<DiscardGitDiffWorktreeHunkResult>;
    amendStagedChanges: (
      input: AmendGitDiffStagedChangesInput,
    ) => Promise<AmendGitDiffStagedChangesResult>;
    revertCommit: (input: GitDiffCommitReferenceInput) => Promise<GitDiffCommitActionResult>;
    cherryPickCommit: (input: GitDiffCommitReferenceInput) => Promise<GitDiffCommitActionResult>;
    loadOperation: (input: LoadGitDiffOperationInput) => Promise<LoadGitDiffOperationResult>;
    continueOperation: (
      input: GitDiffOperationActionInput,
    ) => Promise<GitDiffOperationActionResult>;
    abortOperation: (input: GitDiffOperationActionInput) => Promise<GitDiffOperationActionResult>;
    loadStashes: (input: LoadGitDiffStashesInput) => Promise<LoadGitDiffStashesResult>;
    createStash: (input: CreateGitDiffStashInput) => Promise<CreateGitDiffStashResult>;
    applyStash: (input: GitDiffStashReferenceInput) => Promise<GitDiffActionResult>;
    popStash: (input: GitDiffStashReferenceInput) => Promise<GitDiffActionResult>;
    dropStash: (input: GitDiffStashReferenceInput) => Promise<GitDiffActionResult>;
    closeChangeRequest: (input: GitDiffChangeRequestReferenceInput) => Promise<GitDiffActionResult>;
    mergeChangeRequest: (input: GitDiffMergeChangeRequestInput) => Promise<GitDiffActionResult>;
    loadChangeRequestChecks: (
      input: LoadGitDiffChangeRequestChecksInput,
    ) => Promise<LoadGitDiffChangeRequestChecksResult>;
    loadChangeRequestReviewThreads: (
      input: LoadGitDiffChangeRequestReviewThreadsInput,
    ) => Promise<LoadGitDiffChangeRequestReviewThreadsResult>;
    commentChangeRequestLines: (
      input: CommentGitDiffChangeRequestLinesInput,
    ) => Promise<GitDiffActionResult>;
    revertChangeRequestLines: (
      input: RevertGitDiffChangeRequestLinesInput,
    ) => Promise<RevertGitDiffChangeRequestLinesResult>;
  };
  workflows: {
    createDraft: (input: WorkflowCreateDraftInput) => Promise<WorkflowCreateDraftResult>;
    listThread: (input: WorkflowListThreadInput) => Promise<WorkflowListThreadResult>;
    listProjectWorkflows: (
      input: WorkflowListProjectWorkflowsInput,
    ) => Promise<WorkflowListProjectWorkflowsResult>;
    listThreadLinks: (
      input: WorkflowListThreadWorkflowLinksInput,
    ) => Promise<WorkflowListThreadWorkflowLinksResult>;
    linkThread: (input: WorkflowLinkThreadInput) => Promise<WorkflowLinkThreadResult>;
    unlinkThread: (input: WorkflowUnlinkThreadInput) => Promise<WorkflowUnlinkThreadResult>;
    openSource: (input: WorkflowOpenSourceInput) => Promise<WorkflowOpenSourceResult>;
    syncSource: (input: WorkflowSyncSourceInput) => Promise<WorkflowSyncSourceResult>;
    validate: (input: WorkflowValidateInput) => Promise<WorkflowValidateResult>;
    archive: (input: WorkflowArchiveInput) => Promise<WorkflowArchiveResult>;
    run: (input: WorkflowRunInput) => Promise<WorkflowRunResult>;
    scheduleRun: (input: WorkflowScheduleRunInput) => Promise<WorkflowScheduleRunResult>;
    cancelScheduledRun: (
      input: WorkflowCancelScheduledRunInput,
    ) => Promise<WorkflowCancelScheduledRunResult>;
    stop: (input: WorkflowStopInput) => Promise<void>;
    respondToInput: (input: WorkflowRespondToInputInput) => Promise<void>;
    getRun: (input: WorkflowRunByIdInput) => Promise<WorkflowRunSnapshot>;
    getTimeline: (input: WorkflowGetTimelineInput) => Promise<WorkflowGetTimelineResult>;
    listMemory: (input: WorkflowListMemoryInput) => Promise<WorkflowListMemoryResult>;
    suppressMemoryItem: (
      input: WorkflowSuppressMemoryItemInput,
    ) => Promise<WorkflowSuppressMemoryItemResult>;
    onEvent: (callback: (event: WorkflowEventStreamItem) => void) => () => void;
  };
  orchestration: {
    getArchivedShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    subscribeShell: (
      callback: (item: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeManagedProcesses: (
      callback: (item: OrchestrationManagedProcessStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    getThreadSnapshot: (
      input: OrchestrationGetThreadSnapshotInput,
    ) => Promise<OrchestrationThread | null>;
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (
      callback: (event: OrchestrationEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
}
