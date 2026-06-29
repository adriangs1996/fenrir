import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensCookieEntry,
  TrafficLensDomStorageEntry,
  TrafficLensStorageAreaVersion,
  TrafficLensStorageOriginSummary,
} from "@fenrir/contracts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentClient } from "~/environments/runtime";
import {
  type TrafficLensStoragePanelArea,
  useTrafficLensStore,
} from "../stores/useTrafficLensStore";

type CookieEditorState = {
  mode: "create" | "edit";
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
  expirationDate: string;
};

type StorageEntryEditorState = {
  key: string;
  value: string;
};

const STORAGE_AREAS: ReadonlyArray<{
  id: TrafficLensStoragePanelArea;
  label: string;
}> = [
  { id: "cookies", label: "Cookies" },
  { id: "localStorage", label: "Local Storage" },
  { id: "sessionStorage", label: "Session Storage" },
  { id: "history", label: "History" },
];

const EMPTY_COOKIE_EDITOR: CookieEditorState = {
  mode: "create",
  name: "",
  value: "",
  domain: "",
  path: "/",
  secure: false,
  httpOnly: false,
  sameSite: "lax",
  expirationDate: "",
};

const EMPTY_STORAGE_EDITOR: StorageEntryEditorState = {
  key: "",
  value: "",
};

function originKey(profileId: string, origin: string): string {
  return `${profileId}:${origin}`;
}

function toOriginUrl(origin: string): string {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function waitForTabOriginReady(tabId: string, origin: string): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge) {
    throw new Error("Desktop bridge unavailable.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const tabs = await bridge.trafficLensGetTabs();
    const tab = tabs.find((candidate) => candidate.tabId === tabId);
    if (tab && !tab.loading) {
      try {
        if (new URL(tab.url).origin === origin) {
          return;
        }
      } catch {
        // ignore transient invalid urls
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for ${origin} to finish loading.`);
}

function mergeOrigins(
  persistedOrigins: readonly TrafficLensStorageOriginSummary[],
  runtimeOrigins: readonly TrafficLensStorageOriginSummary[],
): TrafficLensStorageOriginSummary[] {
  const merged = new Map<string, TrafficLensStorageOriginSummary>();

  for (const origin of persistedOrigins) {
    merged.set(originKey(origin.profileId, origin.origin), origin);
  }

  for (const origin of runtimeOrigins) {
    const key = originKey(origin.profileId, origin.origin);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, origin);
      continue;
    }
    merged.set(key, {
      ...existing,
      lastDocumentUrl: origin.lastDocumentUrl ?? existing.lastDocumentUrl,
      lastSeenAt:
        origin.lastSeenAt.localeCompare(existing.lastSeenAt) > 0
          ? origin.lastSeenAt
          : existing.lastSeenAt,
      hasLiveSessionStorage: origin.hasLiveSessionStorage || existing.hasLiveSessionStorage,
      liveSessionTabIds:
        origin.liveSessionTabIds.length > 0 ? origin.liveSessionTabIds : existing.liveSessionTabIds,
    });
  }

  return [...merged.values()].toSorted((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

function AreaTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2 py-1 text-xs",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function StoragePanel() {
  const tabs = useTrafficLensStore((state) => state.tabs);
  const activeTabId = useTrafficLensStore((state) => state.activeTabId);
  const selectedProfileId = useTrafficLensStore((state) => state.selectedProfileId);
  const storageOrigins = useTrafficLensStore((state) => state.storageOrigins);
  const selectedStorageOrigin = useTrafficLensStore((state) => state.selectedStorageOrigin);
  const selectedStorageArea = useTrafficLensStore((state) => state.selectedStorageArea);
  const cookieEntries = useTrafficLensStore((state) => state.cookieEntries);
  const localStorageEntries = useTrafficLensStore((state) => state.localStorageEntries);
  const liveSessionStorageEntries = useTrafficLensStore((state) => state.liveSessionStorageEntries);
  const archivedSessionSnapshots = useTrafficLensStore((state) => state.archivedSessionSnapshots);
  const selectedSessionSnapshotId = useTrafficLensStore((state) => state.selectedSessionSnapshotId);
  const storageHistory = useTrafficLensStore((state) => state.storageHistory);
  const storageSyncStateByOrigin = useTrafficLensStore((state) => state.storageSyncStateByOrigin);
  const setStorageOrigins = useTrafficLensStore((state) => state.setStorageOrigins);
  const setSelectedStorageOrigin = useTrafficLensStore((state) => state.setSelectedStorageOrigin);
  const setSelectedStorageArea = useTrafficLensStore((state) => state.setSelectedStorageArea);
  const setCookieEntries = useTrafficLensStore((state) => state.setCookieEntries);
  const setLocalStorageEntries = useTrafficLensStore((state) => state.setLocalStorageEntries);
  const setLiveSessionStorageEntries = useTrafficLensStore(
    (state) => state.setLiveSessionStorageEntries,
  );
  const setArchivedSessionSnapshots = useTrafficLensStore(
    (state) => state.setArchivedSessionSnapshots,
  );
  const setSelectedSessionSnapshotId = useTrafficLensStore(
    (state) => state.setSelectedSessionSnapshotId,
  );
  const setStorageHistory = useTrafficLensStore((state) => state.setStorageHistory);
  const applyStorageEvent = useTrafficLensStore((state) => state.applyStorageEvent);
  const [originSearch, setOriginSearch] = useState("");
  const [cookieEditor, setCookieEditor] = useState<CookieEditorState>(EMPTY_COOKIE_EDITOR);
  const [localStorageEditor, setLocalStorageEditor] =
    useState<StorageEntryEditorState>(EMPTY_STORAGE_EDITOR);
  const [liveSessionEditor, setLiveSessionEditor] =
    useState<StorageEntryEditorState>(EMPTY_STORAGE_EDITOR);
  const [sessionSnapshotEntries, setSessionSnapshotEntries] = useState<
    TrafficLensDomStorageEntry[]
  >([]);
  const [selectedHistoryVersionId, setSelectedHistoryVersionId] = useState<number | null>(null);
  const [selectedHistoryEntries, setSelectedHistoryEntries] = useState<
    TrafficLensDomStorageEntry[]
  >([]);
  const [busyState, setBusyState] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const rpcClient = usePrimaryEnvironmentClient();
  const profileId = selectedProfileId as any;

  const activeTab = activeTabId ? tabs[activeTabId] : null;
  const activeTabOrigin =
    activeTab && activeTab.profileId === selectedProfileId && activeTab.url
      ? (() => {
          try {
            return new URL(activeTab.url).origin;
          } catch {
            return null;
          }
        })()
      : null;

  const selectedOriginSummary =
    storageOrigins.find((origin) => origin.origin === selectedStorageOrigin) ?? null;
  const liveSessionTabId =
    selectedOriginSummary?.liveSessionTabIds.find((tabId) => tabs[tabId] !== undefined) ??
    (activeTabOrigin === selectedStorageOrigin && activeTabId ? activeTabId : null);
  const filteredOrigins = storageOrigins.filter((origin) => {
    if (!originSearch.trim()) {
      return true;
    }
    const query = originSearch.trim().toLowerCase();
    return (
      origin.origin.toLowerCase().includes(query) ||
      (origin.lastDocumentUrl ?? "").toLowerCase().includes(query)
    );
  });

  const refreshOrigins = useCallback(async () => {
    if (!rpcClient || !window.desktopBridge) {
      setStorageOrigins([]);
      return;
    }

    const [persistedOrigins, runtimeOrigins] = await Promise.all([
      rpcClient.trafficLens.listStorageOrigins({ profileId }),
      window.desktopBridge.trafficLensListStorageOrigins({ profileId }),
    ]);
    const mergedOrigins = mergeOrigins(persistedOrigins, runtimeOrigins);
    setStorageOrigins(mergedOrigins);

    if (!selectedStorageOrigin && activeTabOrigin) {
      const match = mergedOrigins.find((origin) => origin.origin === activeTabOrigin);
      if (match) {
        setSelectedStorageOrigin(match.origin);
      }
    }
  }, [
    activeTabOrigin,
    profileId,
    rpcClient,
    selectedStorageOrigin,
    setSelectedStorageOrigin,
    setStorageOrigins,
  ]);

  const refreshSelectedOrigin = useCallback(
    async (origin: string | null) => {
      if (!origin || !rpcClient || !window.desktopBridge) {
        setCookieEntries([]);
        setLocalStorageEntries([]);
        setLiveSessionStorageEntries([]);
        setArchivedSessionSnapshots([]);
        setStorageHistory([]);
        return;
      }

      const runtimeOrigin =
        storageOrigins.find((candidate) => candidate.origin === origin) ?? selectedOriginSummary;
      const preferredTabId =
        runtimeOrigin?.liveSessionTabIds.find((tabId) => tabs[tabId] !== undefined) ??
        (activeTabOrigin === origin && activeTabId ? activeTabId : undefined);

      let nextCookies: readonly TrafficLensCookieEntry[] = [];
      let nextLocalStorage: readonly TrafficLensDomStorageEntry[] = [];
      let nextLiveSessionStorage: readonly TrafficLensDomStorageEntry[] = [];
      let nextArchivedSnapshots: readonly TrafficLensArchivedSessionStorageSummary[] = [];
      let nextHistory: readonly TrafficLensStorageAreaVersion[] = [];

      try {
        nextCookies = await window.desktopBridge.trafficLensGetApplicableCookies({
          profileId,
          origin,
        });
      } catch {
        nextCookies =
          (
            await rpcClient.trafficLens.getCookieSnapshot({
              profileId,
              origin,
            })
          )?.cookies ?? [];
      }

      try {
        nextLocalStorage = await window.desktopBridge.trafficLensGetLocalStorage({
          profileId,
          origin,
          ...(preferredTabId ? { tabId: preferredTabId } : {}),
        });
      } catch {
        nextLocalStorage =
          (
            await rpcClient.trafficLens.getLocalStorageSnapshot({
              profileId,
              origin,
            })
          )?.entries ?? [];
      }

      if (preferredTabId) {
        try {
          nextLiveSessionStorage = await window.desktopBridge.trafficLensGetLiveSessionStorage({
            tabId: preferredTabId,
            origin,
          });
        } catch {
          nextLiveSessionStorage = [];
        }
      }

      [nextArchivedSnapshots, nextHistory] = await Promise.all([
        rpcClient.trafficLens.listSessionStorageSnapshots({
          profileId,
          origin,
        }),
        rpcClient.trafficLens.getStorageVersions({
          profileId,
          origin,
        }),
      ]);

      setCookieEntries(nextCookies);
      setLocalStorageEntries(nextLocalStorage);
      setLiveSessionStorageEntries(nextLiveSessionStorage);
      setArchivedSessionSnapshots(nextArchivedSnapshots);
      setStorageHistory(nextHistory);
    },
    [
      activeTabId,
      activeTabOrigin,
      profileId,
      rpcClient,
      selectedOriginSummary,
      setArchivedSessionSnapshots,
      setCookieEntries,
      setLiveSessionStorageEntries,
      setLocalStorageEntries,
      setStorageHistory,
      storageOrigins,
      tabs,
    ],
  );

  const refreshAll = async () => {
    setPanelError(null);
    try {
      setBusyState("refresh");
      await refreshOrigins();
      await refreshSelectedOrigin(selectedStorageOrigin ?? activeTabOrigin);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to refresh browser storage.");
    } finally {
      setBusyState(null);
    }
  };

  useEffect(() => {
    void refreshOrigins();
  }, [refreshOrigins]);

  useEffect(() => {
    if (!selectedStorageOrigin && activeTabOrigin) {
      setSelectedStorageOrigin(activeTabOrigin);
    }
  }, [activeTabOrigin, selectedStorageOrigin, setSelectedStorageOrigin]);

  useEffect(() => {
    void refreshSelectedOrigin(selectedStorageOrigin);
  }, [refreshSelectedOrigin, selectedStorageOrigin]);

  useEffect(() => {
    if (!window.desktopBridge) {
      return;
    }
    const unsubscribe = window.desktopBridge.onTrafficLensStorageEvent((event) => {
      applyStorageEvent(event);
      if (event.profileId !== selectedProfileId) {
        return;
      }
      void refreshOrigins();
      if (!selectedStorageOrigin || event.origin === selectedStorageOrigin) {
        void refreshSelectedOrigin(selectedStorageOrigin ?? event.origin);
      }
    });
    return () => unsubscribe();
  }, [
    applyStorageEvent,
    refreshOrigins,
    refreshSelectedOrigin,
    selectedProfileId,
    selectedStorageOrigin,
  ]);

  useEffect(() => {
    if (!rpcClient || selectedSessionSnapshotId === null) {
      setSessionSnapshotEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entries = await rpcClient.trafficLens.getSessionStorageSnapshot({
          versionId: selectedSessionSnapshotId,
        });
        if (!cancelled) {
          setSessionSnapshotEntries([...entries]);
        }
      } catch (error) {
        if (!cancelled) {
          setPanelError(
            error instanceof Error ? error.message : "Failed to load session snapshot entries.",
          );
          setSessionSnapshotEntries([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpcClient, selectedSessionSnapshotId]);

  useEffect(() => {
    if (!rpcClient || selectedHistoryVersionId === null) {
      setSelectedHistoryEntries([]);
      return;
    }
    const selectedHistory = storageHistory.find((entry) => entry.id === selectedHistoryVersionId);
    if (!selectedHistory || selectedHistory.areaKind !== "sessionStorage") {
      setSelectedHistoryEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entries = await rpcClient.trafficLens.getSessionStorageSnapshot({
          versionId: selectedHistory.id,
        });
        if (!cancelled) {
          setSelectedHistoryEntries([...entries]);
        }
      } catch {
        if (!cancelled) {
          setSelectedHistoryEntries([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpcClient, selectedHistoryVersionId, storageHistory]);

  const handleCaptureOrigin = async () => {
    if (!window.desktopBridge || !selectedStorageOrigin) {
      return;
    }
    try {
      setBusyState("capture");
      await window.desktopBridge.trafficLensCaptureStorageOrigin({
        profileId,
        origin: selectedStorageOrigin,
        ...(liveSessionTabId ? { tabId: liveSessionTabId } : {}),
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
      await refreshOrigins();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to capture storage state.");
    } finally {
      setBusyState(null);
    }
  };

  const handleSaveCookie = async () => {
    if (!window.desktopBridge || !selectedStorageOrigin || !cookieEditor.name.trim()) {
      return;
    }
    try {
      setBusyState("cookie");
      await window.desktopBridge.trafficLensSetCookieForOrigin({
        profileId,
        url: toOriginUrl(selectedStorageOrigin),
        name: cookieEditor.name.trim(),
        value: cookieEditor.value,
        domain: cookieEditor.domain.trim() || undefined,
        path: cookieEditor.path.trim() || undefined,
        secure: cookieEditor.secure,
        httpOnly: cookieEditor.httpOnly,
        sameSite: cookieEditor.sameSite,
        expirationDate: cookieEditor.expirationDate
          ? Number(cookieEditor.expirationDate)
          : undefined,
      });
      setCookieEditor(EMPTY_COOKIE_EDITOR);
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to save cookie.");
    } finally {
      setBusyState(null);
    }
  };

  const handleDeleteCookie = async (cookie: TrafficLensCookieEntry) => {
    if (!window.desktopBridge || !selectedStorageOrigin) {
      return;
    }
    try {
      setBusyState("cookie");
      await window.desktopBridge.trafficLensDeleteCookieForOrigin({
        profileId,
        url: toOriginUrl(selectedStorageOrigin),
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to delete cookie.");
    } finally {
      setBusyState(null);
    }
  };

  const handleSaveLocalStorage = async () => {
    if (!window.desktopBridge || !selectedStorageOrigin || !localStorageEditor.key.trim()) {
      return;
    }
    try {
      setBusyState("localStorage");
      await window.desktopBridge.trafficLensSetLocalStorageItem({
        profileId,
        origin: selectedStorageOrigin,
        ...(liveSessionTabId ? { tabId: liveSessionTabId } : {}),
        key: localStorageEditor.key.trim(),
        value: localStorageEditor.value,
      });
      setLocalStorageEditor(EMPTY_STORAGE_EDITOR);
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to save localStorage entry.");
    } finally {
      setBusyState(null);
    }
  };

  const handleDeleteLocalStorage = async (entry: TrafficLensDomStorageEntry) => {
    if (!window.desktopBridge || !selectedStorageOrigin) {
      return;
    }
    try {
      setBusyState("localStorage");
      await window.desktopBridge.trafficLensDeleteLocalStorageItem({
        profileId,
        origin: selectedStorageOrigin,
        ...(liveSessionTabId ? { tabId: liveSessionTabId } : {}),
        key: entry.key,
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to delete localStorage entry.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const handleClearLocalStorage = async () => {
    if (!window.desktopBridge || !selectedStorageOrigin) {
      return;
    }
    try {
      setBusyState("localStorage");
      await window.desktopBridge.trafficLensClearLocalStorage({
        profileId,
        origin: selectedStorageOrigin,
        ...(liveSessionTabId ? { tabId: liveSessionTabId } : {}),
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to clear localStorage.");
    } finally {
      setBusyState(null);
    }
  };

  const handleSaveLiveSessionStorage = async () => {
    if (
      !window.desktopBridge ||
      !selectedStorageOrigin ||
      !liveSessionTabId ||
      !liveSessionEditor.key.trim()
    ) {
      return;
    }
    try {
      setBusyState("sessionStorage");
      await window.desktopBridge.trafficLensSetLiveSessionStorageItem({
        tabId: liveSessionTabId,
        origin: selectedStorageOrigin,
        key: liveSessionEditor.key.trim(),
        value: liveSessionEditor.value,
      });
      setLiveSessionEditor(EMPTY_STORAGE_EDITOR);
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to save live sessionStorage entry.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const handleDeleteLiveSessionStorage = async (entry: TrafficLensDomStorageEntry) => {
    if (!window.desktopBridge || !selectedStorageOrigin || !liveSessionTabId) {
      return;
    }
    try {
      setBusyState("sessionStorage");
      await window.desktopBridge.trafficLensDeleteLiveSessionStorageItem({
        tabId: liveSessionTabId,
        origin: selectedStorageOrigin,
        key: entry.key,
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to delete live sessionStorage entry.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const handleClearLiveSessionStorage = async () => {
    if (!window.desktopBridge || !selectedStorageOrigin || !liveSessionTabId) {
      return;
    }
    try {
      setBusyState("sessionStorage");
      await window.desktopBridge.trafficLensClearLiveSessionStorage({
        tabId: liveSessionTabId,
        origin: selectedStorageOrigin,
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to clear live sessionStorage.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const handleSaveArchivedSnapshot = async () => {
    if (!rpcClient || selectedSessionSnapshotId === null) {
      return;
    }
    try {
      setBusyState("archivedSessionStorage");
      await rpcClient.trafficLens.updateSessionStorageSnapshot({
        versionId: selectedSessionSnapshotId,
        entries: sessionSnapshotEntries,
      });
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to save archived session snapshot.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const handleRehydrateSnapshot = async (
    snapshot: TrafficLensArchivedSessionStorageSummary,
    target: "current" | "new",
  ) => {
    if (!window.desktopBridge || !selectedStorageOrigin || !rpcClient) {
      return;
    }
    try {
      setBusyState("rehydrate");
      const entries = await rpcClient.trafficLens.getSessionStorageSnapshot({
        versionId: snapshot.versionId,
      });
      const destinationTabId =
        target === "current" && liveSessionTabId
          ? liveSessionTabId
          : (
              await window.desktopBridge.trafficLensCreateTabInProfile({
                profileId: snapshot.profileId,
                url:
                  snapshot.sourceUrl ??
                  selectedOriginSummary?.lastDocumentUrl ??
                  selectedStorageOrigin,
              })
            ).tabId;

      await waitForTabOriginReady(destinationTabId, snapshot.origin);
      await window.desktopBridge.trafficLensClearLiveSessionStorage({
        tabId: destinationTabId,
        origin: snapshot.origin,
      });
      for (const entry of entries) {
        await window.desktopBridge.trafficLensSetLiveSessionStorageItem({
          tabId: destinationTabId,
          origin: snapshot.origin,
          key: entry.key,
          value: entry.value ?? "",
        });
      }
      await window.desktopBridge.trafficLensReload(destinationTabId);
      useTrafficLensStore.getState().setActiveTab(destinationTabId);
      await refreshSelectedOrigin(selectedStorageOrigin);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Failed to rehydrate session snapshot.",
      );
    } finally {
      setBusyState(null);
    }
  };

  const selectedSyncState = selectedStorageOrigin
    ? (storageSyncStateByOrigin[originKey(selectedProfileId, selectedStorageOrigin)] ?? "idle")
    : "idle";

  const renderCookies = () => (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {cookieEditor.mode === "edit" ? "Edit cookie" : "Add cookie"}
        </div>
        <Input
          nativeInput
          value={cookieEditor.name}
          onChange={(event) =>
            setCookieEditor((current) => ({ ...current, name: event.currentTarget.value }))
          }
          placeholder="name"
        />
        <Input
          nativeInput
          value={cookieEditor.value}
          onChange={(event) =>
            setCookieEditor((current) => ({ ...current, value: event.currentTarget.value }))
          }
          placeholder="value"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            nativeInput
            value={cookieEditor.domain}
            onChange={(event) =>
              setCookieEditor((current) => ({ ...current, domain: event.currentTarget.value }))
            }
            placeholder="domain override"
          />
          <Input
            nativeInput
            value={cookieEditor.path}
            onChange={(event) =>
              setCookieEditor((current) => ({ ...current, path: event.currentTarget.value }))
            }
            placeholder="/"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              checked={cookieEditor.secure}
              type="checkbox"
              onChange={(event) =>
                setCookieEditor((current) => ({ ...current, secure: event.currentTarget.checked }))
              }
            />
            Secure
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              checked={cookieEditor.httpOnly}
              type="checkbox"
              onChange={(event) =>
                setCookieEditor((current) => ({
                  ...current,
                  httpOnly: event.currentTarget.checked,
                }))
              }
            />
            HttpOnly
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="h-8.5 rounded-lg border border-input bg-background px-3 text-sm"
            value={cookieEditor.sameSite}
            onChange={(event) =>
              setCookieEditor((current) => ({
                ...current,
                sameSite: event.currentTarget.value as CookieEditorState["sameSite"],
              }))
            }
          >
            <option value="unspecified">SameSite: unspecified</option>
            <option value="no_restriction">SameSite: none</option>
            <option value="lax">SameSite: lax</option>
            <option value="strict">SameSite: strict</option>
          </select>
          <Input
            nativeInput
            value={cookieEditor.expirationDate}
            onChange={(event) =>
              setCookieEditor((current) => ({
                ...current,
                expirationDate: event.currentTarget.value,
              }))
            }
            placeholder="expiry epoch seconds"
          />
        </div>
        <div className="flex gap-2">
          <Button size="xs" onClick={() => void handleSaveCookie()}>
            {cookieEditor.mode === "edit" ? "Update" : "Add"}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setCookieEditor(EMPTY_COOKIE_EDITOR)}>
            Reset
          </Button>
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">Applicable cookies</div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void refreshSelectedOrigin(selectedStorageOrigin)}
          >
            Refresh
          </Button>
        </div>
        <div className="min-h-0 overflow-auto">
          {cookieEntries.length === 0 ? (
            <div className="p-3">
              <EmptyState>No cookies are currently visible for this origin.</EmptyState>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background/95 text-left text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Domain</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cookieEntries.map((cookie) => (
                  <tr
                    key={`${cookie.domain}:${cookie.path}:${cookie.name}`}
                    className="border-b border-border/40 align-top last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium">{cookie.name}</td>
                    <td className="max-w-96 break-all px-3 py-2 font-mono text-[11px]">
                      {cookie.value}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{cookie.domain}</td>
                    <td className="px-3 py-2 text-muted-foreground">{cookie.path}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {[
                        cookie.secure ? "Secure" : null,
                        cookie.httpOnly ? "HttpOnly" : null,
                        cookie.sameSite ? `SameSite=${cookie.sameSite}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "None"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setCookieEditor({
                              mode: "edit",
                              name: cookie.name,
                              value: cookie.value,
                              domain: cookie.domain,
                              path: cookie.path,
                              secure: cookie.secure,
                              httpOnly: cookie.httpOnly,
                              sameSite:
                                cookie.sameSite === "unspecified" ||
                                cookie.sameSite === "no_restriction" ||
                                cookie.sameSite === "lax" ||
                                cookie.sameSite === "strict"
                                  ? cookie.sameSite
                                  : "lax",
                              expirationDate:
                                cookie.expirationDate !== undefined
                                  ? String(cookie.expirationDate)
                                  : "",
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void handleDeleteCookie(cookie)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  const renderLocalStorage = () => (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div className="text-xs font-medium text-muted-foreground">Edit localStorage</div>
        <Input
          nativeInput
          value={localStorageEditor.key}
          onChange={(event) =>
            setLocalStorageEditor((current) => ({ ...current, key: event.currentTarget.value }))
          }
          placeholder="key"
        />
        <textarea
          className="min-h-40 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none"
          value={localStorageEditor.value}
          onChange={(event) =>
            setLocalStorageEditor((current) => ({ ...current, value: event.currentTarget.value }))
          }
          placeholder="value"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="xs" onClick={() => void handleSaveLocalStorage()}>
            Save
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setLocalStorageEditor(EMPTY_STORAGE_EDITOR)}
          >
            Reset
          </Button>
          <Button size="xs" variant="outline" onClick={() => void handleClearLocalStorage()}>
            Clear All
          </Button>
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">Current origin storage</div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void refreshSelectedOrigin(selectedStorageOrigin)}
          >
            Refresh
          </Button>
        </div>
        <div className="min-h-0 overflow-auto">
          {localStorageEntries.length === 0 ? (
            <div className="p-3">
              <EmptyState>
                No `localStorage` values are currently stored for this origin.
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {localStorageEntries.map((entry) => (
                <div
                  key={entry.key}
                  className="rounded-lg border border-border/70 px-3 py-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{entry.key}</div>
                      <div className="mt-1 break-all font-mono text-muted-foreground">
                        {entry.value ?? "(null)"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          setLocalStorageEditor({ key: entry.key, value: entry.value ?? "" })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleDeleteLocalStorage(entry)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSessionStorage = () => (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Live sessionStorage</div>
          <Button size="xs" variant="outline" onClick={() => void handleCaptureOrigin()}>
            Capture Snapshot
          </Button>
        </div>
        {!liveSessionTabId ? (
          <EmptyState>
            No live tab is attached to this origin. Archived snapshots are still available below.
          </EmptyState>
        ) : (
          <>
            <Input
              nativeInput
              value={liveSessionEditor.key}
              onChange={(event) =>
                setLiveSessionEditor((current) => ({ ...current, key: event.currentTarget.value }))
              }
              placeholder="key"
            />
            <textarea
              className="min-h-32 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none"
              value={liveSessionEditor.value}
              onChange={(event) =>
                setLiveSessionEditor((current) => ({
                  ...current,
                  value: event.currentTarget.value,
                }))
              }
              placeholder="value"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="xs" onClick={() => void handleSaveLiveSessionStorage()}>
                Save
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setLiveSessionEditor(EMPTY_STORAGE_EDITOR)}
              >
                Reset
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void handleClearLiveSessionStorage()}
              >
                Clear All
              </Button>
            </div>
            <div className="space-y-2">
              {liveSessionStorageEntries.length === 0 ? (
                <EmptyState>No live `sessionStorage` keys exist for the selected tab.</EmptyState>
              ) : (
                liveSessionStorageEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-lg border border-border/70 px-3 py-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{entry.key}</div>
                        <div className="mt-1 break-all font-mono text-muted-foreground">
                          {entry.value ?? "(null)"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setLiveSessionEditor({ key: entry.key, value: entry.value ?? "" })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void handleDeleteLiveSessionStorage(entry)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
          Archived snapshots
        </div>
        <div className="min-h-0 overflow-auto p-3">
          {archivedSessionSnapshots.length === 0 ? (
            <EmptyState>
              No archived `sessionStorage` snapshots exist for this origin yet.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {archivedSessionSnapshots.map((snapshot) => (
                <button
                  key={snapshot.versionId}
                  type="button"
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-xs",
                    selectedSessionSnapshotId === snapshot.versionId
                      ? "border-border bg-muted/40"
                      : "border-border/70 hover:bg-muted/20",
                  )}
                  onClick={() => setSelectedSessionSnapshotId(snapshot.versionId)}
                >
                  <div className="font-medium">Snapshot #{snapshot.versionId}</div>
                  <div className="mt-1 text-muted-foreground">
                    {formatTimestamp(snapshot.capturedAt)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {snapshot.snapshotReason}
                    {snapshot.sourceUrl ? ` • ${snapshot.sourceUrl}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">Snapshot editor</div>
          {selectedSessionSnapshotId !== null ? (
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => void handleSaveArchivedSnapshot()}>
                Save
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const snapshot = archivedSessionSnapshots.find(
                    (candidate) => candidate.versionId === selectedSessionSnapshotId,
                  );
                  if (snapshot) {
                    void handleRehydrateSnapshot(snapshot, "current");
                  }
                }}
              >
                Rehydrate Current
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const snapshot = archivedSessionSnapshots.find(
                    (candidate) => candidate.versionId === selectedSessionSnapshotId,
                  );
                  if (snapshot) {
                    void handleRehydrateSnapshot(snapshot, "new");
                  }
                }}
              >
                Rehydrate New Tab
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 overflow-auto p-3">
          {selectedSessionSnapshotId === null ? (
            <EmptyState>Select an archived snapshot to inspect or edit it.</EmptyState>
          ) : (
            <div className="space-y-2">
              {sessionSnapshotEntries.length === 0 ? (
                <EmptyState>
                  This snapshot does not contain any `sessionStorage` entries.
                </EmptyState>
              ) : (
                sessionSnapshotEntries.map((entry, index) => (
                  <div
                    key={`${entry.key}:${entry.value ?? ""}`}
                    className="rounded-lg border border-border/70 px-3 py-2 text-xs"
                  >
                    <Input
                      nativeInput
                      value={entry.key}
                      onChange={(event) =>
                        setSessionSnapshotEntries((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, key: event.currentTarget.value }
                              : candidate,
                          ),
                        )
                      }
                      placeholder="key"
                    />
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none"
                      value={entry.value ?? ""}
                      onChange={(event) =>
                        setSessionSnapshotEntries((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, value: event.currentTarget.value }
                              : candidate,
                          ),
                        )
                      }
                      placeholder="value"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          setSessionSnapshotEntries((current) =>
                            current.filter((_, candidateIndex) => candidateIndex !== index),
                          )
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setSessionSnapshotEntries((current) => [...current, { key: "", value: "" }])
                }
              >
                Add Entry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
          Persisted history
        </div>
        <div className="min-h-0 overflow-auto">
          {storageHistory.length === 0 ? (
            <div className="p-3">
              <EmptyState>No persisted storage versions exist for this origin yet.</EmptyState>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {storageHistory.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-xs",
                    selectedHistoryVersionId === version.id
                      ? "border-border bg-muted/40"
                      : "border-border/70 hover:bg-muted/20",
                  )}
                  onClick={() => setSelectedHistoryVersionId(version.id)}
                >
                  <div className="font-medium">
                    {version.areaKind} #{version.id}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {version.snapshotReason} • {formatTimestamp(version.capturedAt)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {version.sourceUrl ?? version.origin}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 rounded-xl border border-border/70">
        <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
          Version detail
        </div>
        <div className="min-h-0 overflow-auto p-3">
          {selectedHistoryVersionId === null ? (
            <EmptyState>Select a version on the left to inspect it.</EmptyState>
          ) : (
            (() => {
              const selectedVersion =
                storageHistory.find((candidate) => candidate.id === selectedHistoryVersionId) ??
                null;
              if (!selectedVersion) {
                return <EmptyState>The selected version no longer exists.</EmptyState>;
              }
              if (selectedVersion.areaKind !== "sessionStorage") {
                return (
                  <EmptyState>
                    The exact historical payload for cookies and `localStorage` is persisted
                    server-side, but the detailed viewer in Browser Lab currently exposes full
                    payload inspection only for archived `sessionStorage` versions. Use the Cookies
                    and Local Storage tabs for latest-state editing.
                  </EmptyState>
                );
              }
              if (selectedHistoryEntries.length === 0) {
                return (
                  <EmptyState>This historical snapshot does not contain any entries.</EmptyState>
                );
              }
              return (
                <div className="space-y-2">
                  {selectedHistoryEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-lg border border-border/70 px-3 py-2 text-xs"
                    >
                      <div className="font-medium">{entry.key}</div>
                      <div className="mt-1 break-all font-mono text-muted-foreground">
                        {entry.value ?? "(null)"}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
      <div className="border-r border-border/70 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Storage inventory</div>
            <div className="mt-1 text-[11px] text-amber-600/90 dark:text-amber-400/90">
              Persisted plaintext snapshots for cookies, `localStorage`, and archived
              `sessionStorage`.
            </div>
          </div>
          <Button size="xs" variant="outline" onClick={() => void refreshAll()}>
            {busyState === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="space-y-2">
          <Input
            nativeInput
            type="search"
            value={originSearch}
            onChange={(event) => setOriginSearch(event.currentTarget.value)}
            placeholder="Search origins"
          />

          <div className="space-y-1">
            {filteredOrigins.length === 0 ? (
              <EmptyState>No origins are known for the selected profile yet.</EmptyState>
            ) : (
              filteredOrigins.map((origin) => (
                <button
                  key={origin.origin}
                  type="button"
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-xs",
                    selectedStorageOrigin === origin.origin
                      ? "border-border bg-muted/40"
                      : "border-border/70 hover:bg-muted/20",
                  )}
                  onClick={() => setSelectedStorageOrigin(origin.origin)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{origin.origin}</div>
                      <div className="mt-1 truncate text-muted-foreground">
                        {origin.lastDocumentUrl ?? "No recorded document URL"}
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] uppercase text-muted-foreground">
                      {origin.hasLiveSessionStorage ? "Live" : "Stored"}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    <span>{origin.latestCookieVersionId ? "cookies" : "no cookies"}</span>
                    <span>
                      {origin.latestLocalStorageVersionId ? "localStorage" : "no localStorage"}
                    </span>
                    <span>
                      {origin.latestSessionStorageVersionId || origin.hasLiveSessionStorage
                        ? "sessionStorage"
                        : "no sessionStorage"}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Last seen {formatTimestamp(origin.lastSeenAt)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-border/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {selectedStorageOrigin ?? "Select an origin"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedOriginSummary?.lastDocumentUrl ??
                  "Origin-scoped browser storage workbench"}
              </div>
            </div>
            <div className="rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase text-muted-foreground">
              {selectedSyncState}
            </div>
            <Button
              size="xs"
              variant="outline"
              disabled={!selectedStorageOrigin}
              onClick={() => void handleCaptureOrigin()}
            >
              {busyState === "capture" ? "Capturing…" : "Capture now"}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {STORAGE_AREAS.map((area) => (
              <AreaTab
                key={area.id}
                active={selectedStorageArea === area.id}
                label={area.label}
                onClick={() => setSelectedStorageArea(area.id)}
              />
            ))}
          </div>
        </div>

        {panelError ? (
          <div className="border-b border-border/70 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            {panelError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!selectedStorageOrigin ? (
            <EmptyState>
              Select an origin from the inventory to inspect or mutate its storage.
            </EmptyState>
          ) : selectedStorageArea === "cookies" ? (
            renderCookies()
          ) : selectedStorageArea === "localStorage" ? (
            renderLocalStorage()
          ) : selectedStorageArea === "sessionStorage" ? (
            renderSessionStorage()
          ) : (
            renderHistory()
          )}
        </div>
      </div>
    </div>
  );
}
