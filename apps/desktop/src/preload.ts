import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@fenrir/contracts";

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
const BROWSER_CREATE_TAB_CHANNEL = "desktop:browser-create-tab";
const BROWSER_CLOSE_TAB_CHANNEL = "desktop:browser-close-tab";
const BROWSER_NAVIGATE_CHANNEL = "desktop:browser-navigate";
const BROWSER_GO_BACK_CHANNEL = "desktop:browser-go-back";
const BROWSER_GO_FORWARD_CHANNEL = "desktop:browser-go-forward";
const BROWSER_RELOAD_CHANNEL = "desktop:browser-reload";
const BROWSER_GET_TABS_CHANNEL = "desktop:browser-get-tabs";
const BROWSER_SET_BOUNDS_CHANNEL = "desktop:browser-set-bounds";
const BROWSER_SHOW_TAB_CHANNEL = "desktop:browser-show-tab";
const BROWSER_HIDE_ALL_TABS_CHANNEL = "desktop:browser-hide-all-tabs";
const BROWSER_TAB_EVENT_CHANNEL = "desktop:browser-tab-event";

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

  // Browser
  browserCreateTab: (url?: string) =>
    ipcRenderer.invoke(BROWSER_CREATE_TAB_CHANNEL, url),
  browserCloseTab: (tabId: string) =>
    ipcRenderer.invoke(BROWSER_CLOSE_TAB_CHANNEL, tabId),
  browserNavigate: (tabId: string, url: string) =>
    ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, tabId, url),
  browserGoBack: (tabId: string) =>
    ipcRenderer.invoke(BROWSER_GO_BACK_CHANNEL, tabId),
  browserGoForward: (tabId: string) =>
    ipcRenderer.invoke(BROWSER_GO_FORWARD_CHANNEL, tabId),
  browserReload: (tabId: string) =>
    ipcRenderer.invoke(BROWSER_RELOAD_CHANNEL, tabId),
  browserGetTabs: () =>
    ipcRenderer.invoke(BROWSER_GET_TABS_CHANNEL),
  browserSetBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke(BROWSER_SET_BOUNDS_CHANNEL, tabId, bounds),
  browserShowTab: (tabId: string) =>
    ipcRenderer.invoke(BROWSER_SHOW_TAB_CHANNEL, tabId),
  browserHideAllTabs: () =>
    ipcRenderer.invoke(BROWSER_HIDE_ALL_TABS_CHANNEL),
  onBrowserTabEvent: (listener: (event: unknown) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      listener(data);
    };
    ipcRenderer.on(BROWSER_TAB_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_TAB_EVENT_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
