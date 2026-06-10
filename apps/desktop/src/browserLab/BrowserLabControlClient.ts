import { formatErrorMessage } from "../errorMessage";
import type { TrafficLensManager } from "../window/DesktopWindow";

export interface BrowserLabControlClientDeps {
  readonly isQuitting: () => boolean;
  readonly getBackendWsUrl: () => string;
  readonly getBootstrapToken: () => string;
  readonly ensureTrafficLensManager: () => TrafficLensManager;
}

export interface BrowserLabControlClient {
  readonly start: () => void;
  readonly stop: () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNullableString(
  input: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in input)) {
    return undefined;
  }
  const value = input[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string or null.`);
  }
  return value;
}

function makeProfilePartitionKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `persist:traffic-lens:${slug || "profile"}`;
}

function normalizeStorageOrigin(value: string): string {
  return URL.canParse(value) ? new URL(value).origin : value;
}

function getTabSnapshot(manager: TrafficLensManager, tabId: string) {
  const tab = manager.getTabs().find((candidate) => candidate.tabId === tabId);
  if (!tab) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  return tab;
}

function activeTabStorageScope(
  manager: TrafficLensManager,
  input: Record<string, unknown>,
  options?: { readonly requireLiveTab?: boolean },
) {
  const tabId = optionalString(input, "tabId");
  const profileId = optionalString(input, "profileId");
  const requestedOrigin = optionalString(input, "origin");
  if (profileId && requestedOrigin && !options?.requireLiveTab) {
    return {
      profileId,
      origin: normalizeStorageOrigin(requestedOrigin),
      ...(tabId ? { tabId } : {}),
    };
  }

  const activeTab = tabId ? getTabSnapshot(manager, tabId) : manager.ensureActiveTab();
  const url = requestedOrigin ?? (activeTab.url ? activeTab.url : "about:blank");
  const origin = normalizeStorageOrigin(url);
  return {
    profileId: profileId ?? activeTab.profileId,
    origin,
    tabId: tabId ?? activeTab.tabId,
  };
}

function browserLabProfileInput(input: Record<string, unknown>) {
  const name = requiredString(input, "name");
  const id = optionalString(input, "id");
  const userAgentPreset = optionalString(input, "userAgentPreset");
  const proxyPreset = optionalNullableString(input, "proxyPreset");
  const notes = optionalNullableString(input, "notes");
  return {
    ...(id ? { id } : {}),
    name,
    partitionKey: optionalString(input, "partitionKey") ?? makeProfilePartitionKey(name),
    ...(userAgentPreset ? { userAgentPreset } : {}),
    ...(proxyPreset !== undefined ? { proxyPreset } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function browserLabProfilePatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  const name = optionalString(input, "name");
  if (name) {
    patch.name = name;
  }
  const partitionKey = optionalString(input, "partitionKey");
  if (partitionKey) {
    patch.partitionKey = partitionKey;
  }
  const userAgentPreset = optionalString(input, "userAgentPreset");
  if (userAgentPreset) {
    patch.userAgentPreset = userAgentPreset;
  }
  const proxyPreset = optionalNullableString(input, "proxyPreset");
  if (proxyPreset !== undefined) {
    patch.proxyPreset = proxyPreset;
  }
  const notes = optionalNullableString(input, "notes");
  if (notes !== undefined) {
    patch.notes = notes;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("At least one profile field is required.");
  }
  return patch;
}

export function createBrowserLabControlClient(
  deps: BrowserLabControlClientDeps,
): BrowserLabControlClient {
  let browserLabControlSocket: WebSocket | null = null;
  let browserLabControlReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let browserLabControlReconnectAttempt = 0;

  async function handleBrowserLabControlMethod(method: string, params: unknown): Promise<unknown> {
    const manager = deps.ensureTrafficLensManager();
    const input = asRecord(params);

    switch (method) {
      case "browser_lab_list_tabs":
        return manager.getTabs();
      case "browser_lab_get_active_tab":
        return manager.getActiveTab() ?? manager.ensureActiveTab();
      case "browser_lab_create_tab":
        return typeof input.profileId === "string"
          ? manager.createTabInProfile({
              profileId: input.profileId,
              ...(typeof input.url === "string" ? { url: input.url } : {}),
            })
          : manager.createTab(typeof input.url === "string" ? input.url : undefined);
      case "browser_lab_create_tab_in_profile": {
        const profileId = requiredString(input, "profileId");
        return manager.createTabInProfile({
          profileId,
          ...(typeof input.url === "string" ? { url: input.url } : {}),
        });
      }
      case "browser_lab_select_tab": {
        if (typeof input.tabId !== "string") throw new Error("tabId is required.");
        return manager.setActiveTab(input.tabId);
      }
      case "browser_lab_close_tab": {
        if (typeof input.tabId !== "string") throw new Error("tabId is required.");
        manager.closeTab(input.tabId);
        return { closed: true };
      }
      case "browser_lab_navigate": {
        const tab = typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId;
        const url = typeof input.url === "string" ? input.url : "";
        if (!url) throw new Error("url is required.");
        manager.navigateTab(tab, url);
        return manager.getActiveTab();
      }
      case "browser_lab_back": {
        manager.goBack(
          typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
        );
        return { ok: true };
      }
      case "browser_lab_forward": {
        manager.goForward(
          typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
        );
        return { ok: true };
      }
      case "browser_lab_reload": {
        manager.reloadTab(
          typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
        );
        return { ok: true };
      }
      case "browser_lab_wait_for_load":
        return manager.waitForTabLoad(input as any);
      case "browser_lab_snapshot":
        return manager.capturePageSnapshot(
          typeof input.tabId === "string" ? input.tabId : undefined,
        );
      case "browser_lab_screenshot":
        return manager.captureScreenshot(typeof input.tabId === "string" ? input.tabId : undefined);
      case "browser_lab_click":
        await manager.clickPage(input as any);
        return { ok: true };
      case "browser_lab_type":
        if (typeof input.text !== "string") throw new Error("text is required.");
        await manager.typeIntoPage(input as any);
        return { ok: true };
      case "browser_lab_press":
        if (typeof input.key !== "string") throw new Error("key is required.");
        await manager.pressPage(input as any);
        return { ok: true };
      case "browser_lab_get_cookies":
        return manager.getCookies(
          typeof input.tabId === "string" ? input.tabId : manager.ensureActiveTab().tabId,
        );
      case "browser_lab_get_local_storage": {
        const scope = activeTabStorageScope(manager, input);
        return manager.getLocalStorage(scope as any);
      }
      case "browser_lab_set_local_storage_item": {
        const scope = activeTabStorageScope(manager, input);
        await manager.setLocalStorageItem({ ...scope, ...input } as any);
        return { ok: true };
      }
      case "browser_lab_delete_local_storage_item": {
        const scope = activeTabStorageScope(manager, input);
        await manager.deleteLocalStorageItem({ ...scope, ...input } as any);
        return { ok: true };
      }
      case "browser_lab_get_session_storage": {
        const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
        return manager.getLiveSessionStorage(scope as any);
      }
      case "browser_lab_set_session_storage_item": {
        const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
        await manager.setLiveSessionStorageItem({ ...scope, ...input } as any);
        return { ok: true };
      }
      case "browser_lab_delete_session_storage_item": {
        const scope = activeTabStorageScope(manager, input, { requireLiveTab: true });
        await manager.deleteLiveSessionStorageItem({ ...scope, ...input } as any);
        return { ok: true };
      }
      case "traffic_lens_list_paused_requests":
        return manager.listPaused();
      case "traffic_lens_continue_paused_request":
        await manager.continuePaused(input as any);
        return { ok: true };
      case "traffic_lens_drop_paused_request":
        await manager.dropPaused(input as any);
        return { ok: true };
      case "traffic_lens_list_profiles":
        return manager.listProfiles();
      case "traffic_lens_create_profile":
        return manager.createProfile(browserLabProfileInput(input) as any);
      case "traffic_lens_update_profile":
        return manager.updateProfile(
          requiredString(input, "id"),
          browserLabProfilePatch(input) as any,
        );
      case "traffic_lens_delete_profile":
        manager.deleteProfile(requiredString(input, "id"));
        return { ok: true };
      case "traffic_lens_list_rules":
        return manager.listRules();
      case "traffic_lens_upsert_rule": {
        const ruleInput = asRecord(input.input ?? input);
        return typeof input.id === "string"
          ? manager.updateRule(input.id, ruleInput as any)
          : manager.createRule(ruleInput as any);
      }
      case "traffic_lens_delete_rule":
        if (typeof input.id !== "string") throw new Error("id is required.");
        manager.deleteRule(input.id);
        return { ok: true };
      case "traffic_lens_set_rule_enabled":
        if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
          throw new Error("id and enabled are required.");
        }
        manager.setRuleEnabled(input.id, input.enabled);
        return { ok: true };
      case "traffic_lens_list_overrides":
        return manager.listOverrides();
      case "traffic_lens_upsert_override": {
        const overrideInput = asRecord(input.input ?? input);
        return typeof input.id === "string"
          ? manager.updateOverride(input.id, overrideInput as any)
          : manager.createOverride(overrideInput as any);
      }
      case "traffic_lens_delete_override":
        if (typeof input.id !== "string") throw new Error("id is required.");
        manager.deleteOverride(input.id);
        return { ok: true };
      case "traffic_lens_set_override_enabled":
        if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
          throw new Error("id and enabled are required.");
        }
        manager.setOverrideEnabled(input.id, input.enabled);
        return { ok: true };
      case "traffic_lens_list_storage_origins":
        return manager.listStorageOrigins(requiredString(input, "profileId"));
      case "traffic_lens_capture_storage_origin":
        await manager.captureStorageOrigin({
          profileId: requiredString(input, "profileId") as any,
          origin: normalizeStorageOrigin(requiredString(input, "origin")),
          ...(typeof input.tabId === "string" ? { tabId: input.tabId } : {}),
        });
        return { ok: true };
      case "traffic_lens_get_cookies_for_origin":
        return manager.getApplicableCookies({
          profileId: requiredString(input, "profileId") as any,
          origin: normalizeStorageOrigin(requiredString(input, "origin")),
        });
      case "traffic_lens_set_cookie_for_origin":
        await manager.setCookieForOrigin(input as any);
        return { ok: true };
      case "traffic_lens_delete_cookie_for_origin":
        await manager.deleteCookieForOrigin(input as any);
        return { ok: true };
      case "browser_lab_clear_local_storage": {
        const scope = activeTabStorageScope(manager, input);
        await manager.clearLocalStorage(scope as any);
        return { ok: true };
      }
      default:
        throw new Error(`Unsupported Browser Lab control method: ${method}`);
    }
  }

  function stop(): void {
    if (browserLabControlReconnectTimer) {
      clearTimeout(browserLabControlReconnectTimer);
      browserLabControlReconnectTimer = null;
    }
    const socket = browserLabControlSocket;
    browserLabControlSocket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  function scheduleReconnect(): void {
    if (
      deps.isQuitting() ||
      browserLabControlReconnectTimer ||
      !deps.getBackendWsUrl() ||
      !deps.getBootstrapToken()
    ) {
      return;
    }
    const delayMs = Math.min(500 * 2 ** browserLabControlReconnectAttempt, 10_000);
    browserLabControlReconnectAttempt += 1;
    browserLabControlReconnectTimer = setTimeout(() => {
      browserLabControlReconnectTimer = null;
      start();
    }, delayMs);
    browserLabControlReconnectTimer.unref?.();
  }

  function start(): void {
    const backendWsUrl = deps.getBackendWsUrl();
    const bootstrapToken = deps.getBootstrapToken();
    if (deps.isQuitting() || !backendWsUrl || !bootstrapToken) return;
    if (
      browserLabControlSocket &&
      (browserLabControlSocket.readyState === WebSocket.CONNECTING ||
        browserLabControlSocket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const url = `${backendWsUrl}/api/browser-lab/control/ws?token=${encodeURIComponent(
      bootstrapToken,
    )}`;
    const socket = new WebSocket(url);
    browserLabControlSocket = socket;

    socket.addEventListener("open", () => {
      browserLabControlReconnectAttempt = 0;
    });
    socket.addEventListener("message", (event) => {
      void (async () => {
        const request = JSON.parse(String(event.data)) as {
          id?: unknown;
          method?: unknown;
          params?: unknown;
        };
        if (typeof request.id !== "number" || typeof request.method !== "string") {
          return;
        }
        try {
          const result = await handleBrowserLabControlMethod(request.method, request.params);
          socket.send(JSON.stringify({ id: request.id, result }));
        } catch (error) {
          socket.send(
            JSON.stringify({
              id: request.id,
              error: { message: formatErrorMessage(error) },
            }),
          );
        }
      })().catch(() => undefined);
    });
    socket.addEventListener("close", () => {
      if (browserLabControlSocket === socket) {
        browserLabControlSocket = null;
      }
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (browserLabControlSocket === socket) {
        browserLabControlSocket = null;
      }
      try {
        socket.close();
      } catch {
        // Ignore close failures from already-closed sockets.
      }
      scheduleReconnect();
    });
  }

  return { start, stop };
}
