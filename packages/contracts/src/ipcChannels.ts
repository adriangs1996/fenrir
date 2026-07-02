/**
 * Single source of truth for every Electron IPC channel name used between the
 * desktop main process (`apps/desktop/src/app/DesktopApp.ts` + handler
 * modules), the preload bridge (`apps/desktop/src/preload.ts`), and renderer
 * consumers.
 *
 * This module must stay schema-only: plain string-literal constants, no
 * runtime logic.
 */

// ── Settings & environment ───────────────────────────────────
export const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
export const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
export const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
export const GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:get-saved-environment-registry";
export const SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:set-saved-environment-registry";
export const GET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:get-saved-environment-secret";
export const SET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:set-saved-environment-secret";
export const REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:remove-saved-environment-secret";
export const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
export const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";

// ── Dialogs, theme, shell & menu ─────────────────────────────
export const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
export const PICK_FILE_CHANNEL = "desktop:pick-file";
export const CONFIRM_CHANNEL = "desktop:confirm";
export const SET_THEME_CHANNEL = "desktop:set-theme";
export const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
export const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
export const MENU_ACTION_CHANNEL = "desktop:menu-action";

// ── Power management ─────────────────────────────────────────
export const POWER_RESUMED_CHANNEL = "desktop:power-resumed";

// ── Updater ──────────────────────────────────────────────────
export const UPDATE_STATE_CHANNEL = "desktop:update-state";
export const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
export const UPDATE_CHECK_CHANNEL = "desktop:update-check";
export const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
export const UPDATE_INSTALL_CHANNEL = "desktop:update-install";

// ── VPN ──────────────────────────────────────────────────────
export const VPN_GET_STATE_CHANNEL = "desktop:vpn-get-state";
export const VPN_GET_PROFILES_CHANNEL = "desktop:vpn-get-profiles";
export const VPN_ADD_PROFILE_CHANNEL = "desktop:vpn-add-profile";
export const VPN_REMOVE_PROFILE_CHANNEL = "desktop:vpn-remove-profile";
export const VPN_CONNECT_CHANNEL = "desktop:vpn-connect";
export const VPN_DISCONNECT_CHANNEL = "desktop:vpn-disconnect";
export const VPN_STATE_CHANNEL = "desktop:vpn-state";

// ── Traffic Lens ─────────────────────────────────────────────
export const TRAFFIC_LENS_CREATE_TAB_CHANNEL = "desktop:traffic-lens-create-tab";
export const TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL =
  "desktop:traffic-lens-create-tab-in-profile";
export const TRAFFIC_LENS_CLOSE_TAB_CHANNEL = "desktop:traffic-lens-close-tab";
export const TRAFFIC_LENS_NAVIGATE_CHANNEL = "desktop:traffic-lens-navigate";
export const TRAFFIC_LENS_GO_BACK_CHANNEL = "desktop:traffic-lens-go-back";
export const TRAFFIC_LENS_GO_FORWARD_CHANNEL = "desktop:traffic-lens-go-forward";
export const TRAFFIC_LENS_RELOAD_CHANNEL = "desktop:traffic-lens-reload";
export const TRAFFIC_LENS_GET_TABS_CHANNEL = "desktop:traffic-lens-get-tabs";
export const TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL = "desktop:traffic-lens-set-tab-view-mode";
export const TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL =
  "desktop:traffic-lens-set-tab-mobile-preset";
export const TRAFFIC_LENS_SET_BOUNDS_CHANNEL = "desktop:traffic-lens-set-bounds";
export const TRAFFIC_LENS_SHOW_TAB_CHANNEL = "desktop:traffic-lens-show-tab";
export const TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL = "desktop:traffic-lens-hide-all-tabs";
export const TRAFFIC_LENS_TAB_EVENT_CHANNEL = "desktop:traffic-lens-tab-event";
export const TRAFFIC_LENS_LIST_RULES_CHANNEL = "desktop:traffic-lens-list-rules";
export const TRAFFIC_LENS_CREATE_RULE_CHANNEL = "desktop:traffic-lens-create-rule";
export const TRAFFIC_LENS_UPDATE_RULE_CHANNEL = "desktop:traffic-lens-update-rule";
export const TRAFFIC_LENS_DELETE_RULE_CHANNEL = "desktop:traffic-lens-delete-rule";
export const TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL = "desktop:traffic-lens-set-rule-enabled";
export const TRAFFIC_LENS_LIST_PAUSED_CHANNEL = "desktop:traffic-lens-list-paused";
export const TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL = "desktop:traffic-lens-continue-paused";
export const TRAFFIC_LENS_DROP_PAUSED_CHANNEL = "desktop:traffic-lens-drop-paused";
export const TRAFFIC_LENS_LIST_PROFILES_CHANNEL = "desktop:traffic-lens-list-profiles";
export const TRAFFIC_LENS_CREATE_PROFILE_CHANNEL = "desktop:traffic-lens-create-profile";
export const TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL = "desktop:traffic-lens-update-profile";
export const TRAFFIC_LENS_DELETE_PROFILE_CHANNEL = "desktop:traffic-lens-delete-profile";
export const TRAFFIC_LENS_GET_COOKIES_CHANNEL = "desktop:traffic-lens-get-cookies";
export const TRAFFIC_LENS_SET_COOKIE_CHANNEL = "desktop:traffic-lens-set-cookie";
export const TRAFFIC_LENS_DELETE_COOKIE_CHANNEL = "desktop:traffic-lens-delete-cookie";
export const TRAFFIC_LENS_GET_STORAGE_CHANNEL = "desktop:traffic-lens-get-storage";
export const TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL = "desktop:traffic-lens-set-storage-entry";
export const TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL =
  "desktop:traffic-lens-delete-storage-entry";
export const TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL =
  "desktop:traffic-lens-list-storage-origins";
export const TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL =
  "desktop:traffic-lens-capture-storage-origin";
export const TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL =
  "desktop:traffic-lens-get-applicable-cookies";
export const TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL =
  "desktop:traffic-lens-set-cookie-for-origin";
export const TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL =
  "desktop:traffic-lens-delete-cookie-for-origin";
export const TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-get-local-storage";
export const TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-set-local-storage-item";
export const TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-local-storage-item";
export const TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL = "desktop:traffic-lens-clear-local-storage";
export const TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-get-live-session-storage";
export const TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-set-live-session-storage-item";
export const TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL =
  "desktop:traffic-lens-delete-live-session-storage-item";
export const TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL =
  "desktop:traffic-lens-clear-live-session-storage";
export const TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL =
  "desktop:traffic-lens-list-session-storage-snapshots";
export const TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-get-session-storage-snapshot";
export const TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-update-session-storage-snapshot";
export const TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL =
  "desktop:traffic-lens-rehydrate-session-storage-snapshot";
export const TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL = "desktop:traffic-lens-list-overrides";
export const TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-create-override";
export const TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL = "desktop:traffic-lens-update-override";
export const TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL = "desktop:traffic-lens-delete-override";
export const TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL =
  "desktop:traffic-lens-set-override-enabled";
export const TRAFFIC_LENS_PAUSED_EVENT_CHANNEL = "desktop:traffic-lens-paused-event";
export const TRAFFIC_LENS_STORAGE_CHANGED_CHANNEL = "desktop:traffic-lens-storage-changed";
export const TRAFFIC_LENS_STORAGE_EVENT_CHANNEL = "desktop:traffic-lens-storage-event";

// ── Neovim (embedded editor host) ────────────────────────────
export const NEOVIM_ATTACH_CHANNEL = "desktop:neovim-attach";
export const NEOVIM_DETACH_CHANNEL = "desktop:neovim-detach";
export const NEOVIM_INPUT_CHANNEL = "desktop:neovim-input";
export const NEOVIM_RESIZE_CHANNEL = "desktop:neovim-resize";
export const NEOVIM_REDRAW_CHANNEL = "desktop:neovim-redraw";
export const NEOVIM_SET_CWD_CHANNEL = "desktop:neovim-set-cwd";
export const NEOVIM_SET_THEME_CHANNEL = "desktop:neovim-set-theme";
export const NVIM_AVAILABLE_CHANNEL = "desktop:nvim-available";
export const NVIM_PROBE_DETAIL_CHANNEL = "desktop:nvim-probe-detail";

// ── Embedded VS Code ─────────────────────────────────────────
export const VSCODE_AVAILABLE_CHANNEL = "desktop:vscode-available";
export const VSCODE_PROBE_DETAIL_CHANNEL = "desktop:vscode-probe-detail";
export const VSCODE_START_CHANNEL = "desktop:vscode-start";
export const VSCODE_OPEN_FILE_CHANNEL = "desktop:vscode-open-file";
export const VSCODE_SET_BOUNDS_CHANNEL = "desktop:vscode-set-bounds";
export const VSCODE_SHOW_CHANNEL = "desktop:vscode-show";
export const VSCODE_HIDE_CHANNEL = "desktop:vscode-hide";
export const VSCODE_SET_SHORTCUT_STATE_CHANNEL = "desktop:vscode-set-shortcut-state";
export const VSCODE_SHORTCUT_COMMAND_CHANNEL = "fenrir:vscode:shortcutCommand";

// ── Render loop (backend-agnostic frame pipeline) ────────────
export const RENDER_START_CHANNEL = "desktop:render-start";
export const RENDER_STOP_CHANNEL = "desktop:render-stop";
export const RENDER_SET_FPS_CHANNEL = "desktop:render-set-fps";
export const RENDER_SYNC_VIEWPORT_CHANNEL = "desktop:render-sync-viewport";
export const RENDER_INPUT_CHANNEL = "desktop:render-input";
export const RENDER_FRAME_CHANNEL = "desktop:render-frame";
export const RENDER_FRAME_PORT_CHANNEL = "desktop:render-frame-port";
export const RENDER_SET_EDITOR_FONT_METRICS_CHANNEL = "desktop:render-set-editor-font-metrics";

// ── Editor IPC (nvim ↔ renderer) ─────────────────────────────
export const EDITOR_OPEN_FILE_CHANNEL = "fenrir:editor:openFile";
export const EDITOR_EVENT_CHANNEL = "fenrir:editor:event";
export const EDITOR_SEND_TO_COMPOSER_CHANNEL = "fenrir:editor:sendToComposer";
export const EDITOR_CMD_CHANNEL = "fenrir:editor:cmd";
export const EDITOR_INVOKE_BRIDGE_CHANNEL = "fenrir:editor:invokeBridge";
export const EDITOR_CAPTURE_SELECTION_CHANNEL = "fenrir:editor:captureSelection";
export const EDITOR_CAPTURE_ACTIVE_FILE_CHANNEL = "fenrir:editor:captureActiveFile";
