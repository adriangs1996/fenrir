import {
  TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL,
  TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL,
  TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL,
  TRAFFIC_LENS_CLOSE_TAB_CHANNEL,
  TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL,
  TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_CREATE_PROFILE_CHANNEL,
  TRAFFIC_LENS_CREATE_RULE_CHANNEL,
  TRAFFIC_LENS_CREATE_TAB_CHANNEL,
  TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL,
  TRAFFIC_LENS_DELETE_COOKIE_CHANNEL,
  TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL,
  TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_DELETE_PROFILE_CHANNEL,
  TRAFFIC_LENS_DELETE_RULE_CHANNEL,
  TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL,
  TRAFFIC_LENS_DROP_PAUSED_CHANNEL,
  TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL,
  TRAFFIC_LENS_GET_COOKIES_CHANNEL,
  TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL,
  TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL,
  TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL,
  TRAFFIC_LENS_GET_STORAGE_CHANNEL,
  TRAFFIC_LENS_GET_TABS_CHANNEL,
  TRAFFIC_LENS_GO_BACK_CHANNEL,
  TRAFFIC_LENS_GO_FORWARD_CHANNEL,
  TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL,
  TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL,
  TRAFFIC_LENS_LIST_PAUSED_CHANNEL,
  TRAFFIC_LENS_LIST_PROFILES_CHANNEL,
  TRAFFIC_LENS_LIST_RULES_CHANNEL,
  TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL,
  TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL,
  TRAFFIC_LENS_NAVIGATE_CHANNEL,
  TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
  TRAFFIC_LENS_RELOAD_CHANNEL,
  TRAFFIC_LENS_SET_BOUNDS_CHANNEL,
  TRAFFIC_LENS_SET_COOKIE_CHANNEL,
  TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL,
  TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL,
  TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL,
  TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL,
  TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL,
  TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL,
  TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL,
  TRAFFIC_LENS_SHOW_TAB_CHANNEL,
  TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL,
  TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL,
  TRAFFIC_LENS_UPDATE_RULE_CHANNEL,
  TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
} from "@fenrir/contracts";

import type { TrafficLensManager } from "../window/DesktopWindow";
import { registerHandler } from "./registerHandler";
import { requireBoolean, requireObject, requireString, ValidationError } from "./validators";

export interface TrafficLensHandlersDeps {
  readonly ensureManager: () => TrafficLensManager;
}

export function registerTrafficLensHandlers(deps: TrafficLensHandlersDeps): void {
  const { ensureManager } = deps;

  registerHandler(TRAFFIC_LENS_CREATE_TAB_CHANNEL, async (_event, url: unknown) => {
    // Silent semantics: non-string URLs are coerced to `undefined`.
    const validUrl = typeof url === "string" ? url : undefined;
    return ensureManager().createTab(validUrl);
  });

  registerHandler(TRAFFIC_LENS_CREATE_TAB_IN_PROFILE_CHANNEL, async (_event, input: unknown) => {
    const payload = requireObject("profile tab input", input) as {
      url?: unknown;
      profileId?: unknown;
    };
    const profileId = requireString("profile ID", payload.profileId);
    return ensureManager().createTabInProfile({
      profileId,
      ...(typeof payload.url === "string" ? { url: payload.url } : {}),
    });
  });

  registerHandler(TRAFFIC_LENS_CLOSE_TAB_CHANNEL, async (_event, tabId: unknown) => {
    ensureManager().closeTab(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_NAVIGATE_CHANNEL, async (_event, tabId: unknown, url: unknown) => {
    ensureManager().navigateTab(requireString("tab ID", tabId), requireString("URL", url));
  });

  registerHandler(TRAFFIC_LENS_GO_BACK_CHANNEL, async (_event, tabId: unknown) => {
    ensureManager().goBack(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_GO_FORWARD_CHANNEL, async (_event, tabId: unknown) => {
    ensureManager().goForward(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_RELOAD_CHANNEL, async (_event, tabId: unknown) => {
    ensureManager().reloadTab(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_GET_TABS_CHANNEL, async () => ensureManager().getTabs());

  registerHandler(TRAFFIC_LENS_SET_TAB_VIEW_MODE_CHANNEL, async (_event, input: unknown) => {
    const payload = requireObject("tab view mode payload", input);
    if (
      typeof payload.tabId !== "string" ||
      (payload.viewMode !== "desktop" && payload.viewMode !== "mobile")
    ) {
      throw new ValidationError("tab view mode payload");
    }
    return ensureManager().setTabViewMode({
      tabId: payload.tabId as any,
      viewMode: payload.viewMode,
    });
  });

  registerHandler(TRAFFIC_LENS_SET_TAB_MOBILE_PRESET_CHANNEL, async (_event, input: unknown) => {
    const payload = requireObject("tab mobile preset payload", input);
    if (
      typeof payload.tabId !== "string" ||
      (payload.mobilePreset !== "iphone-15-pro" &&
        payload.mobilePreset !== "pixel-8" &&
        payload.mobilePreset !== "ipad-mini")
    ) {
      throw new ValidationError("tab mobile preset payload");
    }
    return ensureManager().setTabMobilePreset({
      tabId: payload.tabId as any,
      mobilePreset: payload.mobilePreset,
    });
  });

  registerHandler(
    TRAFFIC_LENS_SET_BOUNDS_CHANNEL,
    async (_event, tabId: unknown, bounds: unknown) => {
      const validTabId = requireString("tab ID", tabId);
      const b = requireObject("bounds", bounds);
      if (
        typeof b.x !== "number" ||
        typeof b.y !== "number" ||
        typeof b.width !== "number" ||
        typeof b.height !== "number"
      ) {
        throw new ValidationError("bounds shape");
      }
      ensureManager().setTabBounds(validTabId, {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      });
    },
  );

  registerHandler(TRAFFIC_LENS_SHOW_TAB_CHANNEL, async (_event, tabId: unknown) => {
    ensureManager().showTab(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_HIDE_ALL_TABS_CHANNEL, async () => ensureManager().hideAllTabs());

  registerHandler(TRAFFIC_LENS_LIST_RULES_CHANNEL, async () => ensureManager().listRules());

  registerHandler(TRAFFIC_LENS_CREATE_RULE_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().createRule(requireObject("rule input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_UPDATE_RULE_CHANNEL, async (_event, id: unknown, input: unknown) => {
    const ruleId = requireString("rule update input", id);
    const ruleInput = requireObject("rule update input", input);
    return ensureManager().updateRule(ruleId, ruleInput as any);
  });

  registerHandler(TRAFFIC_LENS_DELETE_RULE_CHANNEL, async (_event, id: unknown) => {
    ensureManager().deleteRule(requireString("rule ID", id));
  });

  registerHandler(
    TRAFFIC_LENS_SET_RULE_ENABLED_CHANNEL,
    async (_event, id: unknown, enabled: unknown) => {
      const ruleId = requireString("rule enabled payload", id);
      const ruleEnabled = requireBoolean("rule enabled payload", enabled);
      ensureManager().setRuleEnabled(ruleId, ruleEnabled);
    },
  );

  registerHandler(TRAFFIC_LENS_LIST_PAUSED_CHANNEL, async () => ensureManager().listPaused());

  registerHandler(TRAFFIC_LENS_CONTINUE_PAUSED_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().continuePaused(requireObject("paused continuation input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_DROP_PAUSED_CHANNEL, async (_event, input: unknown) => {
    const payload = requireObject("paused drop input", input) as { pauseId?: unknown };
    const pauseId = requireString("pause ID", payload.pauseId);
    await ensureManager().dropPaused({ pauseId });
  });

  registerHandler(TRAFFIC_LENS_LIST_PROFILES_CHANNEL, async () => ensureManager().listProfiles());

  registerHandler(TRAFFIC_LENS_CREATE_PROFILE_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().createProfile(requireObject("profile input", input) as any);
  });

  registerHandler(
    TRAFFIC_LENS_UPDATE_PROFILE_CHANNEL,
    async (_event, id: unknown, input: unknown) => {
      const profileId = requireString("profile update input", id);
      const profileInput = requireObject("profile update input", input);
      return ensureManager().updateProfile(profileId, profileInput as any);
    },
  );

  registerHandler(TRAFFIC_LENS_DELETE_PROFILE_CHANNEL, async (_event, id: unknown) => {
    ensureManager().deleteProfile(requireString("profile ID", id));
  });

  registerHandler(TRAFFIC_LENS_GET_COOKIES_CHANNEL, async (_event, tabId: unknown) => {
    return ensureManager().getCookies(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_SET_COOKIE_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().setCookie(requireObject("cookie input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_DELETE_COOKIE_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().deleteCookie(requireObject("cookie delete input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_GET_STORAGE_CHANNEL, async (_event, tabId: unknown) => {
    return ensureManager().getStorage(requireString("tab ID", tabId));
  });

  registerHandler(TRAFFIC_LENS_SET_STORAGE_ENTRY_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().setStorageEntry(requireObject("storage input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_DELETE_STORAGE_ENTRY_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().deleteStorageEntry(requireObject("storage delete input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_LIST_STORAGE_ORIGINS_CHANNEL, async (_event, input: unknown) => {
    const payload = requireObject("storage origins input", input);
    const profileId = requireString("storage origins input", payload.profileId);
    return ensureManager().listStorageOrigins(profileId);
  });

  registerHandler(TRAFFIC_LENS_CAPTURE_STORAGE_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().captureStorageOrigin(
      requireObject("storage capture input", input) as any,
    );
  });

  registerHandler(TRAFFIC_LENS_GET_APPLICABLE_COOKIES_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().getApplicableCookies(
      requireObject("applicable cookies input", input) as any,
    );
  });

  registerHandler(TRAFFIC_LENS_SET_COOKIE_FOR_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().setCookieForOrigin(requireObject("origin cookie input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_DELETE_COOKIE_FOR_ORIGIN_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().deleteCookieForOrigin(
      requireObject("origin cookie delete input", input) as any,
    );
  });

  registerHandler(TRAFFIC_LENS_GET_LOCAL_STORAGE_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().getLocalStorage(requireObject("localStorage input", input) as any);
  });

  registerHandler(TRAFFIC_LENS_SET_LOCAL_STORAGE_ITEM_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().setLocalStorageItem(
      requireObject("localStorage set input", input) as any,
    );
  });

  registerHandler(
    TRAFFIC_LENS_DELETE_LOCAL_STORAGE_ITEM_CHANNEL,
    async (_event, input: unknown) => {
      await ensureManager().deleteLocalStorageItem(
        requireObject("localStorage delete input", input) as any,
      );
    },
  );

  registerHandler(TRAFFIC_LENS_CLEAR_LOCAL_STORAGE_CHANNEL, async (_event, input: unknown) => {
    await ensureManager().clearLocalStorage(
      requireObject("localStorage clear input", input) as any,
    );
  });

  registerHandler(TRAFFIC_LENS_GET_LIVE_SESSION_STORAGE_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().getLiveSessionStorage(
      requireObject("live sessionStorage input", input) as any,
    );
  });

  registerHandler(
    TRAFFIC_LENS_SET_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
    async (_event, input: unknown) => {
      await ensureManager().setLiveSessionStorageItem(
        requireObject("live sessionStorage set input", input) as any,
      );
    },
  );

  registerHandler(
    TRAFFIC_LENS_DELETE_LIVE_SESSION_STORAGE_ITEM_CHANNEL,
    async (_event, input: unknown) => {
      await ensureManager().deleteLiveSessionStorageItem(
        requireObject("live sessionStorage delete input", input) as any,
      );
    },
  );

  registerHandler(
    TRAFFIC_LENS_CLEAR_LIVE_SESSION_STORAGE_CHANNEL,
    async (_event, input: unknown) => {
      await ensureManager().clearLiveSessionStorage(
        requireObject("live sessionStorage clear input", input) as any,
      );
    },
  );

  registerHandler(
    TRAFFIC_LENS_LIST_SESSION_STORAGE_SNAPSHOTS_CHANNEL,
    async (_event, input: unknown) => {
      const payload = requireObject("sessionStorage snapshot list input", input);
      const profileId = requireString("sessionStorage snapshot list input", payload.profileId);
      const origin = requireString("sessionStorage snapshot list input", payload.origin);
      return ensureManager().listSessionStorageSnapshots(profileId as any, origin);
    },
  );

  registerHandler(
    TRAFFIC_LENS_GET_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      return ensureManager().getSessionStorageSnapshot(
        requireObject("sessionStorage snapshot input", input) as any,
      );
    },
  );

  registerHandler(
    TRAFFIC_LENS_UPDATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      ensureManager().updateSessionStorageSnapshot(
        requireObject("sessionStorage snapshot update input", input) as any,
      );
    },
  );

  registerHandler(
    TRAFFIC_LENS_REHYDRATE_SESSION_STORAGE_SNAPSHOT_CHANNEL,
    async (_event, input: unknown) => {
      return ensureManager().rehydrateSessionStorageSnapshot(
        requireObject("sessionStorage snapshot rehydrate input", input) as any,
      );
    },
  );

  registerHandler(TRAFFIC_LENS_LIST_OVERRIDES_CHANNEL, async () => ensureManager().listOverrides());

  registerHandler(TRAFFIC_LENS_CREATE_OVERRIDE_CHANNEL, async (_event, input: unknown) => {
    return ensureManager().createOverride(requireObject("override input", input) as any);
  });

  registerHandler(
    TRAFFIC_LENS_UPDATE_OVERRIDE_CHANNEL,
    async (_event, id: unknown, input: unknown) => {
      const overrideId = requireString("override update input", id);
      const overrideInput = requireObject("override update input", input);
      return ensureManager().updateOverride(overrideId, overrideInput as any);
    },
  );

  registerHandler(TRAFFIC_LENS_DELETE_OVERRIDE_CHANNEL, async (_event, id: unknown) => {
    ensureManager().deleteOverride(requireString("override ID", id));
  });

  registerHandler(
    TRAFFIC_LENS_SET_OVERRIDE_ENABLED_CHANNEL,
    async (_event, id: unknown, enabled: unknown) => {
      const overrideId = requireString("override enabled payload", id);
      const overrideEnabled = requireBoolean("override enabled payload", enabled);
      ensureManager().setOverrideEnabled(overrideId, overrideEnabled);
    },
  );
}
