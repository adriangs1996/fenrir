import { Schema } from "effect";

import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
  GitCreateBranchResult,
} from "./git";
import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from "./server";
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
import type { ServerUpsertKeybindingInput } from "./server";
import type {
  ClientOrchestrationCommand,
  GlobalScript,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectScriptIcon,
} from "./orchestration";
import type { EnvironmentId } from "./baseSchemas";
import { EditorId } from "./editor";
import { ClientSettings, ServerSettings, ServerSettingsPatch } from "./settings";
import type { VpnConnectionState, VpnProfile, VpnProfileId } from "./vpn";
import type { TrafficLensTabSnapshot, TrafficLensTabEvent } from "./trafficLens";
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
  ServerProviderSkill,
  CreateSkillInput,
  GetSkillDetailsInput,
  UpdateSkillInput,
  ResolveSkillConflictInput,
  ServerSkillDetails,
} from "./skill";

// ── Editor IPC channels ──────────────────────────────────────
export const EDITOR_OPEN_FILE_CHANNEL = "fenrir:editor:openFile";
export const EDITOR_EVENT_CHANNEL = "fenrir:editor:event";
export const EDITOR_SEND_TO_COMPOSER_CHANNEL = "fenrir:editor:sendToComposer";
export const EDITOR_CMD_CHANNEL = "fenrir:editor:cmd";
export const EDITOR_INVOKE_BRIDGE_CHANNEL = "fenrir:editor:invokeBridge";

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
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
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
  trafficLensCloseTab: (tabId: string) => Promise<void>;
  trafficLensNavigate: (tabId: string, url: string) => Promise<void>;
  trafficLensGoBack: (tabId: string) => Promise<void>;
  trafficLensGoForward: (tabId: string) => Promise<void>;
  trafficLensReload: (tabId: string) => Promise<void>;
  trafficLensGetTabs: () => Promise<readonly TrafficLensTabSnapshot[]>;
  trafficLensSetBounds: (
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => Promise<void>;
  trafficLensShowTab: (tabId: string) => Promise<void>;
  trafficLensHideAllTabs: () => Promise<void>;
  onTrafficLensTabEvent: (listener: (event: TrafficLensTabEvent) => void) => () => void;

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

  // Bridge availability detection
  /** True when this BrowserWindow is the main (first) window. */
  isMainWindow: () => boolean;
  /** Resolves to true when nvim binary is found on PATH. Cached after first probe. */
  nvimAvailable: () => Promise<boolean>;
  /** Full probe result with version, binary path, and error detail. */
  nvimProbeDetail: () => Promise<NvimProbeResult>;

  // Render loop (backend-agnostic frame pipeline)
  renderStart: () => Promise<void>;
  renderStop: () => Promise<void>;
  renderSetFps: (fps: number) => Promise<void>;
  setEditorFontMetrics: (metrics: EditorFontMetrics) => Promise<void>;
  sendInput: (event: InputEvent) => void;
  onFrame: (listener: (frame: Frame) => void) => () => void;

  // Editor IPC (nvim ↔ renderer)
  editor: {
    openFile: (input: EditorOpenFileInput) => Promise<void>;
    onEvent: (cb: (ev: EditorEvent) => void) => () => void;
    onSendToComposer: (cb: (ev: EditorSendToComposer) => void) => () => void;
    onCmd: (cb: (ev: EditorCmd) => void) => () => void;
    /** Invoke a whitelisted Lua bridge function on the embedded nvim. */
    invokeBridge: (fn: string) => Promise<void>;
  };
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
    pickFolder: () => Promise<string | null>;
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
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    getGlobalActions: () => Promise<GlobalScript[]>;
    createGlobalAction: (input: CreateGlobalActionInput) => Promise<GlobalScript>;
    updateGlobalAction: (id: string, input: UpdateGlobalActionInput) => Promise<GlobalScript>;
    deleteGlobalAction: (id: string) => Promise<void>;
    listSkills: () => Promise<ServerProviderSkill[]>;
    getSkillDetails: (input: GetSkillDetailsInput) => Promise<ServerSkillDetails>;
    createSkill: (input: CreateSkillInput) => Promise<ServerProviderSkill>;
    updateSkill: (input: UpdateSkillInput) => Promise<ServerProviderSkill>;
    deleteSkill: (name: string) => Promise<void>;
    resolveSkillConflict: (input: ResolveSkillConflictInput) => Promise<ServerProviderSkill>;
    setActiveSkillProject: (input: { cwd: string }) => Promise<void>;
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
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  git: {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  orchestration: {
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
