import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, Frame, InputEvent } from "@fenrir/contracts";

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
const TRAFFIC_LENS_SET_BOUNDS_CHANNEL = "desktop:traffic-lens-set-bounds";
const TRAFFIC_LENS_SHOW_TAB_CHANNEL = "desktop:traffic-lens-show-tab";
const TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL = "desktop:traffic-lens-hide-all-tabs";
const TRAFFIC_LENS_TAB_EVENT_CHANNEL = "desktop:traffic-lens-tab-event";
const NEOVIM_ATTACH_CHANNEL = "desktop:neovim-attach";
const NEOVIM_DETACH_CHANNEL = "desktop:neovim-detach";
const NEOVIM_INPUT_CHANNEL = "desktop:neovim-input";
const NEOVIM_RESIZE_CHANNEL = "desktop:neovim-resize";
const NEOVIM_REDRAW_CHANNEL = "desktop:neovim-redraw";
const RENDER_START_CHANNEL = "desktop:render-start";
const RENDER_STOP_CHANNEL = "desktop:render-stop";
const RENDER_SET_FPS_CHANNEL = "desktop:render-set-fps";
const RENDER_INPUT_CHANNEL = "desktop:render-input";
const RENDER_FRAME_CHANNEL = "desktop:render-frame";

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
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
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
  trafficLensSetBounds: (
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => ipcRenderer.invoke(TRAFFIC_LENS_SET_BOUNDS_CHANNEL, tabId, bounds),
  trafficLensShowTab: (tabId: string) => ipcRenderer.invoke(TRAFFIC_LENS_SHOW_TAB_CHANNEL, tabId),
  trafficLensHideAllTabs: () => ipcRenderer.invoke(TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL),
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

  // Neovim
  neovimAttach: (cwd: string, cols: number, rows: number) =>
    ipcRenderer.invoke(NEOVIM_ATTACH_CHANNEL, cwd, cols, rows),
  neovimDetach: () => ipcRenderer.invoke(NEOVIM_DETACH_CHANNEL),
  neovimInput: (keys: string) => ipcRenderer.invoke(NEOVIM_INPUT_CHANNEL, keys),
  neovimResize: (cols: number, rows: number) =>
    ipcRenderer.invoke(NEOVIM_RESIZE_CHANNEL, cols, rows),
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
  sendInput: (event: InputEvent) => {
    ipcRenderer.send(RENDER_INPUT_CHANNEL, event);
  },
  onFrame: (listener: (frame: Frame) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, frame: unknown) => {
      if (typeof frame !== "object" || frame === null) return;
      listener(frame as Frame);
    };
    ipcRenderer.on(RENDER_FRAME_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(RENDER_FRAME_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
