import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  EditorCmd,
  EditorEvent,
  EditorFontMetrics,
  EditorOpenFileInput,
  EditorSendToComposer,
  Frame,
  InputEvent,
} from "@fenrir/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:get-saved-environment-registry";
const SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:set-saved-environment-registry";
const GET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:get-saved-environment-secret";
const SET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:set-saved-environment-secret";
const REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:remove-saved-environment-secret";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";
const VPN_GET_STATE_CHANNEL = "desktop:vpn-get-state";
const VPN_GET_PROFILES_CHANNEL = "desktop:vpn-get-profiles";
const VPN_ADD_PROFILE_CHANNEL = "desktop:vpn-add-profile";
const VPN_REMOVE_PROFILE_CHANNEL = "desktop:vpn-remove-profile";
const VPN_CONNECT_CHANNEL = "desktop:vpn-connect";
const VPN_DISCONNECT_CHANNEL = "desktop:vpn-disconnect";
const VPN_STATE_CHANNEL = "desktop:vpn-state";
const PICK_FILE_CHANNEL = "desktop:pick-file";
const TRAFFIC_LENS_CREATE_TAB_CHANNEL = "desktop:traffic-lens-create-tab";
const TRAFFIC_LENS_CLOSE_TAB_CHANNEL = "desktop:traffic-lens-close-tab";
const TRAFFIC_LENS_NAVIGATE_CHANNEL = "desktop:traffic-lens-navigate";
const TRAFFIC_LENS_GO_BACK_CHANNEL = "desktop:traffic-lens-go-back";
const TRAFFIC_LENS_GO_FORWARD_CHANNEL = "desktop:traffic-lens-go-forward";
const TRAFFIC_LENS_RELOAD_CHANNEL = "desktop:traffic-lens-reload";
const TRAFFIC_LENS_GET_TABS_CHANNEL = "desktop:traffic-lens-get-tabs";
const TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL = "desktop:traffic-lens-set-tab-view-mode";
const TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL = "desktop:traffic-lens-set-tab-mobile-preset";
const TRAFFIC_LENS_SET_BOUNDS_CHANNEL = "desktop:traffic-lens-set-bounds";
const TRAFFIC_LENS_SHOW_TAB_CHANNEL = "desktop:traffic-lens-show-tab";
const TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL = "desktop:traffic-lens-hide-all-tabs";
const TRAFFIC_LENS_TAB_EVENT_CHANNEL = "desktop:traffic-lens-tab-event";
const TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL = "desktop:traffic-lens-create-tab-in-profile";
const TRAFFIC_LENS_LIST_RULES_CHANNEL = "desktop:traffic-lens-list-rules";
const TRAFFIC_LENS_CREATE_RULE_CHANNEL = "desktop:traffic-lens-create-rule";
const TRAFFIC_LENS_UPDATE_RULE_CHANNEL = "desktop:traffic-lens-update-rule";
const TRAFFIC_LENS_DELETE_RULE_CHANNEL = "desktop:traffic-lens-delete-rule";
const TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL = "desktop:traffic-lens-set-rule-enabled";
const TRAFFIC_LENS_LIST_PAUSED_CHANNEL = "desktop:traffic-lens-list-paused";
const TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL = "desktop:traffic-lens-continue-paused";
const TRAFFIC_LENS_DROP_PAUSED_CHANNEL = "desktop:traffic-lens-drop-paused";
const TRAFFIC_LENS_LIST_PROFILES_CHANNEL = "desktop:traffic-lens-list-profiles";
const TRAFFIC_LENS_CREATE_PROFILE_CHANNEL = "desktop:traffic-lens-create-profile";
const TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL = "desktop:traffic-lens-update-profile";
const TRAFFIC_LENS_DELETE_PROFILE_CHANNEL = "desktop:traffic-lens-delete-profile";
const TRAFFIC_LENS_GET_COOKIES_CHANNEL = "desktop:traffic-lens-get-cookies";
const TRAFFIC_LENS_SET_COOKIE_CHANNEL = "desktop:traffic-lens-set-cookie";
const TRAFFIC_LENS_DELETE_COOKIE_CHANNEL = "desktop:traffic-lens-delete-cookie";
const TRAFFIC_LENS_GET_STORAGE_CHANNEL = "desktop:traffic-lens-get-storage";
const TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL = "desktop:traffic-lens-set-storage-entry";
const TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL = "desktop:traffic-lens-delete-storage-entry";
const TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL = "desktop:traffic-lens-list-storage-origins";
const TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL = "desktop:traffic-lens-capture-storage-origin";
const TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL = "desktop:traffic-lens-get-applicable-cookies";
const TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL = "desktop:traffic-lens-set-cookie-for-origin";
const TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL =
  "desktop:traffic-lens-delete-cookie-for-origin";
const TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-get-local-storage";
const TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL = "desktop:traffic-lens-set-local-storage-item";
const TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-local-storage-item";
const TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-clear-local-storage";
const TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-get-live-session-storage";
const TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-set-live-session-storage-item";
const TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-live-session-storage-item";
const TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-clear-live-session-storage";
const TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL =
  "desktop:traffic-lens-list-session-storage-snapshots";
const TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-get-session-storage-snapshot";
const TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-update-session-storage-snapshot";
const TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-rehydrate-session-storage-snapshot";
const TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL = "desktop:traffic-lens-list-overrides";
const TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-create-override";
const TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-update-override";
const TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL = "desktop:traffic-lens-delete-override";
const TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL = "desktop:traffic-lens-set-override-enabled";
const TRAFFIC_LENS_PAUSED_EVENT_CHANNEL = "desktop:traffic-lens-paused-event";
const TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL = "desktop:traffic-lens-storage-changed";
const TRAFFIC_LENS_STORAGE_EVENT_CHANNEL = "desktop:traffic-lens-storage-event";
const NEOVIM_ATTACH_CHANNEL = "desktop:neovim-attach";
const NEOVIM_DETACH_CHANNEL = "desktop:neovim-detach";
const NEOVIM_INPUT_CHANNEL = "desktop:neovim-input";
const NEOVIM_RESIZE_CHANNEL = "desktop:neovim-resize";
const NEOVIM_REDRAW_CHANNEL = "desktop:neovim-redraw";
const NEOVIM_SET_CWD_CHANNEL = "desktop:neovim-set-cwd";
const RENDER_START_CHANNEL = "desktop:render-start";
const RENDER_STOP_CHANNEL = "desktop:render-stop";
const RENDER_SET_FPS_CHANNEL = "desktop:render-set-fps";
const RENDER_SYNC_VIEWPORT_CHANNEL = "desktop:render-sync-viewport";
const RENDER_INPUT_CHANNEL = "desktop:render-input";
const RENDER_FRAME_CHANNEL = "desktop:render-frame";
const RENDER_FRAME_PORT_CHANNEL = "desktop:render-frame-port";
const RENDER_SET_EDITOR_FONT_METRICS_CHANNEL = "desktop:render-set-editor-font-metrics";
const NVIM_AVAILABLE_CHANNEL = "desktop:nvim-available";
const NVIM_PROBE_DETAIL_CHANNEL = "desktop:nvim-probe-detail";
const EDITOR_OPEN_FILE_CHANNEL = "fenrir:editor:openFile";
const EDITOR_EVENT_CHANNEL = "fenrir:editor:event";
const EDITOR_SEND_TO_COMPOSER_CHANNEL = "fenrir:editor:sendToComposer";
const EDITOR_CMD_CHANNEL = "fenrir:editor:cmd";
const EDITOR_INVOKE_BRIDGE_CHANNEL = "fenrir:editor:invokeBridge";

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
    invokeBridge: (fn: string) =>
      ipcRenderer.invoke(EDITOR_INVOKE_BRIDGE_CHANNEL, fn) as Promise<void>,
  },
} satisfies DesktopBridge);
