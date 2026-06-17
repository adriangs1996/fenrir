import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  EditorActiveFile,
  EditorCmd,
  EditorCaptureSelectionOptions,
  EditorEvent,
  EditorFontMetrics,
  EditorOpenFileInput,
  EditorSendToComposer,
  Frame,
  InputEvent,
  KeybindingCommand,
  VSCodeShortcutState,
} from "@fenrir/contracts";

import {
  PICK_FOLDER_CHANNEL,
  CONFIRM_CHANNEL,
  SET_THEME_CHANNEL,
  CONTEXT_MENU_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  MENU_ACTION_CHANNEL,
  UPDATE_STATE_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL,
  GET_CLIENT_SETTINGS_CHANNEL,
  SET_CLIENT_SETTINGS_CHANNEL,
  GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  GET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  SET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  GET_SERVER_EXPOSURE_STATE_CHANNEL,
  SET_SERVER_EXPOSURE_MODE_CHANNEL,
  VPN_GET_STATE_CHANNEL,
  VPN_GET_PROFILES_CHANNEL,
  VPN_ADD_PROFILE_CHANNEL,
  VPN_REMOVE_PROFILE_CHANNEL,
  VPN_CONNECT_CHANNEL,
  VPN_DISCONNECT_CHANNEL,
  VPN_STATE_CHANNEL,
  PICK_FILE_CHANNEL,
  TRAFFIC_LENS_CREATE_TAB_CHANNEL,
  TRAFFIC_LENS_CLOSE_TAB_CHANNEL,
  TRAFFIC_LENS_NAVIGATE_CHANNEL,
  TRAFFIC_LENS_GO_BACK_CHANNEL,
  TRAFFIC_LENS_GO_FORWARD_CHANNEL,
  TRAFFIC_LENS_RELOAD_CHANNEL,
  TRAFFIC_LENS_GET_TABS_CHANNEL,
  TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL,
  TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL,
  TRAFFIC_LENS_SET_BOUNDS_CHANNEL,
  TRAFFIC_LENS_SHOW_TAB_CHANNEL,
  TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL,
  TRAFFIC_LENS_TAB_EVENT_CHANNEL,
  TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL,
  TRAFFIC_LENS_LIST_RULES_CHANNEL,
  TRAFFIC_LENS_CREATE_RULE_CHANNEL,
  TRAFFIC_LENS_UPDATE_RULE_CHANNEL,
  TRAFFIC_LENS_DELETE_RULE_CHANNEL,
  TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL,
  TRAFFIC_LENS_LIST_PAUSED_CHANNEL,
  TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL,
  TRAFFIC_LENS_DROP_PAUSED_CHANNEL,
  TRAFFIC_LENS_LIST_PROFILES_CHANNEL,
  TRAFFIC_LENS_CREATE_PROFILE_CHANNEL,
  TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL,
  TRAFFIC_LENS_DELETE_PROFILE_CHANNEL,
  TRAFFIC_LENS_GET_COOKIES_CHANNEL,
  TRAFFIC_LENS_SET_COOKIE_CHANNEL,
  TRAFFIC_LENS_DELETE_COOKIE_CHANNEL,
  TRAFFIC_LENS_GET_STORAGE_CHANNEL,
  TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL,
  TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL,
  TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL,
  TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL,
  TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL,
  TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL,
  TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL,
  TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL,
  TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL,
  TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL,
  TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL,
  TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL,
  TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL,
  TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
  TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
  TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL,
  TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL,
  TRAFFIC_LENS_PAUSED_EVENT_CHANNEL,
  TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL,
  TRAFFIC_LENS_STORAGE_EVENT_CHANNEL,
  NEOVIM_ATTACH_CHANNEL,
  NEOVIM_DETACH_CHANNEL,
  NEOVIM_INPUT_CHANNEL,
  NEOVIM_RESIZE_CHANNEL,
  NEOVIM_REDRAW_CHANNEL,
  NEOVIM_SET_CWD_CHANNEL,
  NEOVIM_SET_THEME_CHANNEL,
  RENDER_START_CHANNEL,
  RENDER_STOP_CHANNEL,
  RENDER_SET_FPS_CHANNEL,
  RENDER_SYNC_VIEWPORT_CHANNEL,
  RENDER_INPUT_CHANNEL,
  RENDER_FRAME_CHANNEL,
  RENDER_FRAME_PORT_CHANNEL,
  RENDER_SET_EDITOR_FONT_METRICS_CHANNEL,
  NVIM_AVAILABLE_CHANNEL,
  NVIM_PROBE_DETAIL_CHANNEL,
  VSCODE_AVAILABLE_CHANNEL,
  VSCODE_PROBE_DETAIL_CHANNEL,
  VSCODE_START_CHANNEL,
  VSCODE_OPEN_FILE_CHANNEL,
  VSCODE_SET_BOUNDS_CHANNEL,
  VSCODE_SHOW_CHANNEL,
  VSCODE_HIDE_CHANNEL,
  VSCODE_SET_SHORTCUT_STATE_CHANNEL,
  VSCODE_SHORTCUT_COMMAND_CHANNEL,
  EDITOR_OPEN_FILE_CHANNEL,
  EDITOR_EVENT_CHANNEL,
  EDITOR_SEND_TO_COMPOSER_CHANNEL,
  EDITOR_CMD_CHANNEL,
  EDITOR_CAPTURE_ACTIVE_FILE_CHANNEL,
  EDITOR_CAPTURE_SELECTION_CHANNEL,
  EDITOR_INVOKE_BRIDGE_CHANNEL,
} from "@fenrir/contracts/ipcChannels";

const mainWindowFlag = process.argv.find((a) => a.startsWith("--fenrir-main-window="));
const isMainWindow = mainWindowFlag === "--fenrir-main-window=1";
const frameListeners = new Set<(frame: Frame) => void>();
let renderFramePort: MessagePort | null = null;
let renderFramePortListener: ((event: MessageEvent) => void) | null = null;

function dispatchFrame(frame: unknown): void {
  if (typeof frame !== "object" || frame === null) return;
  for (const listener of frameListeners) {
    listener(frame as Frame);
  }
}

ipcRenderer.on(RENDER_FRAME_PORT_CHANNEL, (event) => {
  const [port] = event.ports;
  if (!(port instanceof MessagePort)) return;
  if (renderFramePort) {
    if (renderFramePortListener) {
      renderFramePort.removeEventListener("message", renderFramePortListener);
    }
    renderFramePort.close();
  }
  renderFramePort = port;
  renderFramePortListener = (messageEvent) => dispatchFrame(messageEvent.data);
  renderFramePort.addEventListener("message", renderFramePortListener);
  renderFramePort.start();
});

ipcRenderer.on(RENDER_FRAME_CHANNEL, (_event, frame: unknown) => {
  dispatchFrame(frame);
});

contextBridge.exposeInMainWorld("desktopBridge", {
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getClientSettings: () => ipcRenderer.invoke(GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) => ipcRenderer.invoke(SET_CLIENT_SETTINGS_CHANNEL, settings),
  getSavedEnvironmentRegistry: () => ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId, secret),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  getServerExposureState: () => ipcRenderer.invoke(GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) => ipcRenderer.invoke(SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  pickFolder: (options?: { initialPath?: string }) =>
    ipcRenderer.invoke(PICK_FOLDER_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },

  // VPN
  getVpnState: () => ipcRenderer.invoke(VPN_GET_STATE_CHANNEL),
  getVpnProfiles: () => ipcRenderer.invoke(VPN_GET_PROFILES_CHANNEL),
  addVpnProfile: (label, configPath) =>
    ipcRenderer.invoke(VPN_ADD_PROFILE_CHANNEL, label, configPath),
  removeVpnProfile: (profileId) => ipcRenderer.invoke(VPN_REMOVE_PROFILE_CHANNEL, profileId),
  connectVpn: (profileId) => ipcRenderer.invoke(VPN_CONNECT_CHANNEL, profileId),
  disconnectVpn: () => ipcRenderer.invoke(VPN_DISCONNECT_CHANNEL),
  pickFile: (options) => ipcRenderer.invoke(PICK_FILE_CHANNEL, options),
  onVpnStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(VPN_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(VPN_STATE_CHANNEL, wrappedListener);
    };
  },

  // Traffic Lens
  trafficLensCreateTab: (url?: string) => ipcRenderer.invoke(TRAFFIC_LENS_CREATE_TAB_CHANNEL, url),
  trafficLensCloseTab: (tabId: string) => ipcRenderer.invoke(TRAFFIC_LENS_CLOSE_TAB_CHANNEL, tabId),
  trafficLensNavigate: (tabId: string, url: string) =>
    ipcRenderer.invoke(TRAFFIC_LENS_NAVIGATE_CHANNEL, tabId, url),
  trafficLensGoBack: (tabId: string) => ipcRenderer.invoke(TRAFFIC_LENS_GO_BACK_CHANNEL, tabId),
  trafficLensGoForward: (tabId: string) =>
    ipcRenderer.invoke(TRAFFIC_LENS_GO_FORWARD_CHANNEL, tabId),
  trafficLensReload: (tabId: string) => ipcRenderer.invoke(TRAFFIC_LENS_RELOAD_CHANNEL, tabId),
  trafficLensGetTabs: () => ipcRenderer.invoke(TRAFFIC_LENS_GET_TABS_CHANNEL),
  trafficLensSetTabViewMode: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL, input),
  trafficLensSetTabMobilePreset: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL, input),
  trafficLensSetBounds: (
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => ipcRenderer.invoke(TRAFFIC_LENS_SET_BOUNDS_CHANNEL, tabId, bounds),
  trafficLensShowTab: (tabId: string) => ipcRenderer.invoke(TRAFFIC_LENS_SHOW_TAB_CHANNEL, tabId),
  trafficLensHideAllTabs: () => ipcRenderer.invoke(TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL),
  trafficLensCreateTabInProfile: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL, input),
  trafficLensListRules: () => ipcRenderer.invoke(TRAFFIC_LENS_LIST_RULES_CHANNEL),
  trafficLensCreateRule: (input) => ipcRenderer.invoke(TRAFFIC_LENS_CREATE_RULE_CHANNEL, input),
  trafficLensUpdateRule: (id, input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_UPDATE_RULE_CHANNEL, id, input),
  trafficLensDeleteRule: (id) => ipcRenderer.invoke(TRAFFIC_LENS_DELETE_RULE_CHANNEL, id),
  trafficLensSetRuleEnabled: (id, enabled) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL, id, enabled),
  trafficLensListPaused: () => ipcRenderer.invoke(TRAFFIC_LENS_LIST_PAUSED_CHANNEL),
  trafficLensContinuePaused: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL, input),
  trafficLensDropPaused: (input) => ipcRenderer.invoke(TRAFFIC_LENS_DROP_PAUSED_CHANNEL, input),
  trafficLensListProfiles: () => ipcRenderer.invoke(TRAFFIC_LENS_LIST_PROFILES_CHANNEL),
  trafficLensCreateProfile: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CREATE_PROFILE_CHANNEL, input),
  trafficLensUpdateProfile: (id, input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL, id, input),
  trafficLensDeleteProfile: (id) => ipcRenderer.invoke(TRAFFIC_LENS_DELETE_PROFILE_CHANNEL, id),
  trafficLensGetCookies: (tabId) => ipcRenderer.invoke(TRAFFIC_LENS_GET_COOKIES_CHANNEL, tabId),
  trafficLensSetCookie: (input) => ipcRenderer.invoke(TRAFFIC_LENS_SET_COOKIE_CHANNEL, input),
  trafficLensDeleteCookie: (input) => ipcRenderer.invoke(TRAFFIC_LENS_DELETE_COOKIE_CHANNEL, input),
  trafficLensGetStorage: (tabId) => ipcRenderer.invoke(TRAFFIC_LENS_GET_STORAGE_CHANNEL, tabId),
  trafficLensSetStorageEntry: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL, input),
  trafficLensDeleteStorageEntry: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL, input),
  trafficLensListStorageOrigins: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL, input),
  trafficLensCaptureStorageOrigin: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL, input),
  trafficLensGetApplicableCookies: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL, input),
  trafficLensSetCookieForOrigin: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL, input),
  trafficLensDeleteCookieForOrigin: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL, input),
  trafficLensGetLocalStorage: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL, input),
  trafficLensSetLocalStorageItem: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL, input),
  trafficLensDeleteLocalStorageItem: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL, input),
  trafficLensClearLocalStorage: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL, input),
  trafficLensGetLiveSessionStorage: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL, input),
  trafficLensSetLiveSessionStorageItem: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL, input),
  trafficLensDeleteLiveSessionStorageItem: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL, input),
  trafficLensClearLiveSessionStorage: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL, input),
  trafficLensListSessionStorageSnapshots: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL, input),
  trafficLensGetSessionStorageSnapshot: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL, input),
  trafficLensUpdateSessionStorageSnapshot: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL, input),
  trafficLensRehydrateSessionStorageSnapshot: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL, input),
  trafficLensListOverrides: () => ipcRenderer.invoke(TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL),
  trafficLensCreateOverride: (input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL, input),
  trafficLensUpdateOverride: (id, input) =>
    ipcRenderer.invoke(TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL, id, input),
  trafficLensDeleteOverride: (id) => ipcRenderer.invoke(TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL, id),
  trafficLensSetOverrideEnabled: (id, enabled) =>
    ipcRenderer.invoke(TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL, id, enabled),
  onTrafficLensTabEvent: (listener: (event: any) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      listener(data);
    };
    ipcRenderer.on(TRAFFIC_LENS_TAB_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(TRAFFIC_LENS_TAB_EVENT_CHANNEL, wrappedListener);
    };
  },
  onTrafficLensPausedEvent: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      listener(data as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(TRAFFIC_LENS_PAUSED_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(TRAFFIC_LENS_PAUSED_EVENT_CHANNEL, wrappedListener);
    };
  },
  onTrafficLensStorageChanged: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data !== "string") return;
      listener(data);
    };
    ipcRenderer.on(TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL, wrappedListener);
    };
  },
  onTrafficLensStorageEvent: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      listener(data as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(TRAFFIC_LENS_STORAGE_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(TRAFFIC_LENS_STORAGE_EVENT_CHANNEL, wrappedListener);
    };
  },

  // Neovim
  neovimAttach: (cwd: string, cols: number, rows: number) =>
    ipcRenderer.invoke(NEOVIM_ATTACH_CHANNEL, cwd, cols, rows),
  neovimDetach: () => ipcRenderer.invoke(NEOVIM_DETACH_CHANNEL),
  neovimInput: (keys: string) => ipcRenderer.invoke(NEOVIM_INPUT_CHANNEL, keys),
  neovimResize: (cols: number, rows: number) =>
    ipcRenderer.invoke(NEOVIM_RESIZE_CHANNEL, cols, rows),
  neovimSetCwd: (cwd: string) => ipcRenderer.invoke(NEOVIM_SET_CWD_CHANNEL, cwd),
  neovimSetTheme: (selection) => ipcRenderer.invoke(NEOVIM_SET_THEME_CHANNEL, selection),
  onNeovimRedraw: (listener: (events: unknown[]) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, events: unknown) => {
      if (!Array.isArray(events)) return;
      listener(events);
    };
    ipcRenderer.on(NEOVIM_REDRAW_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(NEOVIM_REDRAW_CHANNEL, wrappedListener);
    };
  },

  // Render loop
  renderStart: () => ipcRenderer.invoke(RENDER_START_CHANNEL),
  renderStop: () => ipcRenderer.invoke(RENDER_STOP_CHANNEL),
  renderSetFps: (fps: number) => ipcRenderer.invoke(RENDER_SET_FPS_CHANNEL, fps),
  renderSyncViewport: (w: number, h: number) =>
    ipcRenderer.invoke(RENDER_SYNC_VIEWPORT_CHANNEL, w, h),
  setEditorFontMetrics: (metrics: EditorFontMetrics) =>
    ipcRenderer.invoke(RENDER_SET_EDITOR_FONT_METRICS_CHANNEL, metrics),
  sendInput: (event: InputEvent) => {
    ipcRenderer.send(RENDER_INPUT_CHANNEL, event);
  },
  onFrame: (listener: (frame: Frame) => void) => {
    frameListeners.add(listener);
    return () => {
      frameListeners.delete(listener);
    };
  },

  // Bridge availability detection
  isMainWindow: () => isMainWindow,
  nvimAvailable: () => ipcRenderer.invoke(NVIM_AVAILABLE_CHANNEL) as Promise<boolean>,
  nvimProbeDetail: () => ipcRenderer.invoke(NVIM_PROBE_DETAIL_CHANNEL),
  vscodeAvailable: () => ipcRenderer.invoke(VSCODE_AVAILABLE_CHANNEL) as Promise<boolean>,
  vscodeProbeDetail: () => ipcRenderer.invoke(VSCODE_PROBE_DETAIL_CHANNEL),
  vscodeStart: (cwd: string) => ipcRenderer.invoke(VSCODE_START_CHANNEL, cwd),
  vscodeOpenFile: (input: EditorOpenFileInput) =>
    ipcRenderer.invoke(VSCODE_OPEN_FILE_CHANNEL, input),
  vscodeSetBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke(VSCODE_SET_BOUNDS_CHANNEL, bounds),
  vscodeShow: () => ipcRenderer.invoke(VSCODE_SHOW_CHANNEL),
  vscodeHide: () => ipcRenderer.invoke(VSCODE_HIDE_CHANNEL),
  vscodeSetShortcutState: (state: VSCodeShortcutState) =>
    ipcRenderer.invoke(VSCODE_SET_SHORTCUT_STATE_CHANNEL, state),
  vscodeOnShortcutCommand: (cb: (command: KeybindingCommand) => void) => {
    const wrap = (_e: Electron.IpcRendererEvent, command: KeybindingCommand) => cb(command);
    ipcRenderer.on(VSCODE_SHORTCUT_COMMAND_CHANNEL, wrap);
    return () => {
      ipcRenderer.removeListener(VSCODE_SHORTCUT_COMMAND_CHANNEL, wrap);
    };
  },

  // Editor IPC (nvim ↔ renderer)
  editor: {
    openFile: (input: EditorOpenFileInput) =>
      ipcRenderer.invoke(EDITOR_OPEN_FILE_CHANNEL, input) as Promise<void>,
    onEvent: (cb: (ev: EditorEvent) => void) => {
      const wrap = (_e: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        cb(payload as EditorEvent);
      };
      ipcRenderer.on(EDITOR_EVENT_CHANNEL, wrap);
      return () => {
        ipcRenderer.removeListener(EDITOR_EVENT_CHANNEL, wrap);
      };
    },
    onSendToComposer: (cb: (ev: EditorSendToComposer) => void) => {
      const wrap = (_e: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        cb(payload as EditorSendToComposer);
      };
      ipcRenderer.on(EDITOR_SEND_TO_COMPOSER_CHANNEL, wrap);
      return () => {
        ipcRenderer.removeListener(EDITOR_SEND_TO_COMPOSER_CHANNEL, wrap);
      };
    },
    onCmd: (cb: (ev: EditorCmd) => void) => {
      const wrap = (_e: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        cb(payload as EditorCmd);
      };
      ipcRenderer.on(EDITOR_CMD_CHANNEL, wrap);
      return () => {
        ipcRenderer.removeListener(EDITOR_CMD_CHANNEL, wrap);
      };
    },
    captureSelection: (options?: EditorCaptureSelectionOptions) =>
      ipcRenderer.invoke(
        EDITOR_CAPTURE_SELECTION_CHANNEL,
        options,
      ) as Promise<EditorSendToComposer | null>,
    captureActiveFile: () =>
      ipcRenderer.invoke(EDITOR_CAPTURE_ACTIVE_FILE_CHANNEL) as Promise<EditorActiveFile | null>,
    invokeBridge: (fn: string) =>
      ipcRenderer.invoke(EDITOR_INVOKE_BRIDGE_CHANNEL, fn) as Promise<void>,
  },
} satisfies DesktopBridge);
