import "../../../index.css";

import type { DesktopBridge, EnvironmentId, ThreadId } from "@fenrir/contracts";
import { scopedThreadKey, scopeThreadRef } from "@fenrir/client-runtime";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "~/localApi";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { getRouter } from "~/router";
import { selectBootstrapCompleteForActiveEnvironment, useStore } from "~/store";

import { useReviewStore } from "../store";

interface LiveReviewBrowserConfig {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly bootstrapToken: string;
  readonly expectedFilePath: string;
  readonly expectedChunkText: string;
}

interface MountedLiveReviewRoute {
  readonly cleanup: () => Promise<void>;
}

type LiveReviewMode = "raw" | "review";

const COMMITTED_FILE_PATH = "src/committed-only.ts";
const UNSTAGED_FILE_PATH = "src/unstaged-only.ts";
const COMMENT_BODY = `Live browser local chunk note ${crypto.randomUUID()}`;

function readRequiredBrowserEnv(name: string): string | null {
  const value = import.meta.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readLiveReviewBrowserConfig(): LiveReviewBrowserConfig | null {
  const httpBaseUrl = readRequiredBrowserEnv("VITE_HTTP_URL");
  const wsBaseUrl = readRequiredBrowserEnv("VITE_WS_URL");
  const environmentId = readRequiredBrowserEnv("VITE_REVIEW_E2E_ENVIRONMENT_ID");
  const threadId = readRequiredBrowserEnv("VITE_REVIEW_E2E_THREAD_ID");
  const bootstrapToken = readRequiredBrowserEnv("VITE_REVIEW_E2E_BOOTSTRAP_TOKEN");

  if (!httpBaseUrl || !wsBaseUrl || !environmentId || !threadId || !bootstrapToken) {
    return null;
  }

  return {
    httpBaseUrl,
    wsBaseUrl,
    environmentId: environmentId as EnvironmentId,
    threadId: threadId as ThreadId,
    bootstrapToken,
    expectedFilePath:
      readRequiredBrowserEnv("VITE_REVIEW_E2E_EXPECTED_FILE_PATH") ?? "src/chunk-target.ts",
    expectedChunkText:
      readRequiredBrowserEnv("VITE_REVIEW_E2E_EXPECTED_CHUNK_TEXT") ?? "TOP CHUNK CHANGE",
  } satisfies LiveReviewBrowserConfig;
}

function createLiveDesktopBridgeStub(config: LiveReviewBrowserConfig): DesktopBridge {
  const httpBaseUrl = window.location.origin;
  const wsUrl = new URL(window.location.origin);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const idleUpdateState = {
    enabled: false,
    status: "idle" as const,
    currentVersion: "0.0.0-test",
    hostArch: "arm64" as const,
    appArch: "arm64" as const,
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };

  return {
    getLocalEnvironmentBootstrap: () => ({
      label: "Local environment",
      httpBaseUrl,
      wsBaseUrl: wsUrl.toString(),
      bootstrapToken: config.bootstrapToken,
    }),
    getClientSettings: vi.fn().mockResolvedValue(null),
    setClientSettings: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentRegistry: vi.fn().mockResolvedValue([]),
    setSavedEnvironmentRegistry: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentSecret: vi.fn().mockResolvedValue(null),
    setSavedEnvironmentSecret: vi.fn().mockResolvedValue(true),
    removeSavedEnvironmentSecret: vi.fn().mockResolvedValue(undefined),
    getServerExposureState: vi.fn().mockResolvedValue({
      mode: "local-only" as const,
      endpointUrl: null,
      advertisedHost: null,
    }),
    setServerExposureMode: vi.fn().mockResolvedValue({
      mode: "local-only" as const,
      endpointUrl: null,
      advertisedHost: null,
    }),
    pickFolder: vi.fn().mockResolvedValue(null),
    confirm: vi.fn().mockResolvedValue(true),
    setTheme: vi.fn().mockResolvedValue(undefined),
    showContextMenu: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    onMenuAction: () => () => {},
    getUpdateState: vi.fn().mockResolvedValue(idleUpdateState),
    checkForUpdate: vi.fn().mockResolvedValue({ checked: false, state: idleUpdateState }),
    downloadUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    installUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    onUpdateState: () => () => {},
    getVpnState: vi.fn().mockResolvedValue({
      status: "disconnected" as const,
      activeProfileId: null,
      assignedIp: null,
      connectedAt: null,
      errorMessage: null,
    }),
    getVpnProfiles: vi.fn().mockResolvedValue([]),
    addVpnProfile: vi.fn().mockResolvedValue({
      id: "vpn-profile-test",
      label: "VPN Test",
      configPath: "/tmp/test.ovpn",
      createdAt: new Date().toISOString(),
    }),
    removeVpnProfile: vi.fn().mockResolvedValue(undefined),
    connectVpn: vi.fn().mockResolvedValue({
      status: "connected" as const,
      activeProfileId: "vpn-profile-test",
      assignedIp: null,
      connectedAt: new Date().toISOString(),
      errorMessage: null,
    }),
    disconnectVpn: vi.fn().mockResolvedValue({
      status: "disconnected" as const,
      activeProfileId: null,
      assignedIp: null,
      connectedAt: null,
      errorMessage: null,
    }),
    pickFile: vi.fn().mockResolvedValue(null),
    onVpnStateChange: () => () => {},
    trafficLensCreateTab: vi.fn().mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensCreateTabInProfile: vi
      .fn()
      .mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensCloseTab: vi.fn().mockResolvedValue(undefined),
    trafficLensNavigate: vi.fn().mockResolvedValue(undefined),
    trafficLensGoBack: vi.fn().mockResolvedValue(undefined),
    trafficLensGoForward: vi.fn().mockResolvedValue(undefined),
    trafficLensReload: vi.fn().mockResolvedValue(undefined),
    trafficLensGetTabs: vi.fn().mockResolvedValue([]),
    trafficLensSetBounds: vi.fn().mockResolvedValue(undefined),
    trafficLensShowTab: vi.fn().mockResolvedValue(undefined),
    trafficLensHideAllTabs: vi.fn().mockResolvedValue(undefined),
    trafficLensListRules: vi.fn().mockResolvedValue([]),
    trafficLensCreateRule: vi.fn().mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensUpdateRule: vi.fn().mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensDeleteRule: vi.fn().mockResolvedValue(undefined),
    trafficLensSetRuleEnabled: vi.fn().mockResolvedValue(undefined),
    trafficLensListPaused: vi.fn().mockResolvedValue([]),
    trafficLensContinuePaused: vi.fn().mockResolvedValue(undefined),
    trafficLensDropPaused: vi.fn().mockResolvedValue(undefined),
    trafficLensListProfiles: vi.fn().mockResolvedValue([]),
    trafficLensCreateProfile: vi
      .fn()
      .mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensUpdateProfile: vi
      .fn()
      .mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensDeleteProfile: vi.fn().mockResolvedValue(undefined),
    trafficLensGetCookies: vi.fn().mockResolvedValue([]),
    trafficLensSetCookie: vi.fn().mockResolvedValue(undefined),
    trafficLensDeleteCookie: vi.fn().mockResolvedValue(undefined),
    trafficLensGetStorage: vi.fn().mockResolvedValue([]),
    trafficLensSetStorageEntry: vi.fn().mockResolvedValue(undefined),
    trafficLensDeleteStorageEntry: vi.fn().mockResolvedValue(undefined),
    trafficLensListStorageOrigins: vi.fn().mockResolvedValue([]),
    trafficLensCaptureStorageOrigin: vi.fn().mockResolvedValue(undefined),
    trafficLensGetApplicableCookies: vi.fn().mockResolvedValue([]),
    trafficLensSetCookieForOrigin: vi.fn().mockResolvedValue(undefined),
    trafficLensDeleteCookieForOrigin: vi.fn().mockResolvedValue(undefined),
    trafficLensGetLocalStorage: vi.fn().mockResolvedValue([]),
    trafficLensSetLocalStorageItem: vi.fn().mockResolvedValue(undefined),
    trafficLensDeleteLocalStorageItem: vi.fn().mockResolvedValue(undefined),
    trafficLensClearLocalStorage: vi.fn().mockResolvedValue(undefined),
    trafficLensGetLiveSessionStorage: vi.fn().mockResolvedValue([]),
    trafficLensSetLiveSessionStorageItem: vi.fn().mockResolvedValue(undefined),
    trafficLensDeleteLiveSessionStorageItem: vi.fn().mockResolvedValue(undefined),
    trafficLensClearLiveSessionStorage: vi.fn().mockResolvedValue(undefined),
    trafficLensListSessionStorageSnapshots: vi.fn().mockResolvedValue([]),
    trafficLensGetSessionStorageSnapshot: vi.fn().mockResolvedValue([]),
    trafficLensUpdateSessionStorageSnapshot: vi.fn().mockResolvedValue(undefined),
    trafficLensRehydrateSessionStorageSnapshot: vi
      .fn()
      .mockResolvedValue({ tabId: "traffic-lens-tab-1" }),
    trafficLensListOverrides: vi.fn().mockResolvedValue([]),
    trafficLensCreateOverride: vi
      .fn()
      .mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensUpdateOverride: vi
      .fn()
      .mockRejectedValue(new Error("Traffic Lens unavailable in test")),
    trafficLensDeleteOverride: vi.fn().mockResolvedValue(undefined),
    trafficLensSetOverrideEnabled: vi.fn().mockResolvedValue(undefined),
    onTrafficLensTabEvent: () => () => {},
    onTrafficLensPausedEvent: () => () => {},
    onTrafficLensStorageChanged: () => () => {},
    onTrafficLensStorageEvent: () => () => {},
    neovimAttach: vi.fn().mockResolvedValue(undefined),
    neovimDetach: vi.fn().mockResolvedValue(undefined),
    neovimInput: vi.fn().mockResolvedValue(undefined),
    neovimResize: vi.fn().mockResolvedValue(undefined),
    onNeovimRedraw: () => () => {},
    neovimSetCwd: vi.fn().mockResolvedValue(undefined),
    isMainWindow: () => false,
    nvimAvailable: vi.fn().mockResolvedValue(false),
    nvimProbeDetail: vi.fn().mockResolvedValue({
      available: false,
      version: null,
      binary: null,
      error: null,
    }),
    renderStart: vi.fn().mockResolvedValue(undefined),
    renderStop: vi.fn().mockResolvedValue(undefined),
    renderSetFps: vi.fn().mockResolvedValue(undefined),
    renderSyncViewport: vi.fn().mockResolvedValue(undefined),
    setEditorFontMetrics: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn(),
    onFrame: () => () => {},
    editor: {
      openFile: vi.fn().mockResolvedValue(undefined),
      onEvent: () => () => {},
      onSendToComposer: () => () => {},
      onCmd: () => () => {},
      invokeBridge: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function buildLiveReviewRoute(config: LiveReviewBrowserConfig, reviewMode: LiveReviewMode): string {
  const query = new URLSearchParams({
    tab: "review",
    reviewMode,
    reviewScope: "combined",
  });
  return `/${config.environmentId}/${config.threadId}?${query.toString()}`;
}

async function ensureAuthenticatedBrowserSession(config: LiveReviewBrowserConfig): Promise<void> {
  const existingSessionResponse = await fetch("/api/auth/session", {
    credentials: "include",
  });
  if (existingSessionResponse.ok) {
    const existingSessionBody = (await existingSessionResponse.json()) as {
      readonly authenticated?: boolean;
    };
    if (existingSessionBody.authenticated) {
      return;
    }
  }

  const bootstrapResponse = await fetch("/api/auth/bootstrap", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      credential: config.bootstrapToken,
    }),
  });

  if (!bootstrapResponse.ok) {
    const responseText = await bootstrapResponse.text();
    throw new Error(
      `Bootstrap auth failed (${bootstrapResponse.status}): ${responseText || "<empty body>"}`,
    );
  }

  await vi.waitFor(async () => {
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "include",
    });
    expect(sessionResponse.ok).toBe(true);

    const sessionBody = (await sessionResponse.json()) as {
      readonly authenticated?: boolean;
    };
    expect(sessionBody.authenticated).toBe(true);
  });
}

async function mountLiveReviewRoute(
  config: LiveReviewBrowserConfig,
  reviewMode: LiveReviewMode,
): Promise<MountedLiveReviewRoute> {
  window.desktopBridge = createLiveDesktopBridgeStub(config) as DesktopBridge;
  await ensureAuthenticatedBrowserSession(config);

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [buildLiveReviewRoute(config, reviewMode)],
    }),
  );

  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    {
      container: host,
    },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rawFileButton(path: string, lane: string) {
  return page.getByTestId(`review-raw-file-button:${path}:${lane}`);
}

function rawFileExpandButton(path: string, lane: string) {
  return page.getByTestId(`review-raw-file-expand:${path}:${lane}`);
}

function rawChunkCheckbox(path: string, lane: string, chunkId: string) {
  return page.getByTestId(`review-raw-chunk-checkbox:${path}:${lane}:${chunkId}`);
}

function reviewFileButton(path: string) {
  return page.getByRole("button", {
    name: new RegExp(escapeRegExp(path), "i"),
  });
}

function readThreadState(config: LiveReviewBrowserConfig) {
  const threadKey = scopedThreadKey(scopeThreadRef(config.environmentId, config.threadId));
  return useReviewStore.getState().threads[threadKey] ?? null;
}

async function waitForRawChunkId(
  config: LiveReviewBrowserConfig,
  path: string,
  lane: string,
): Promise<string> {
  return vi.waitFor(() => {
    const threadState = readThreadState(config);
    const patchEntry = Object.values(threadState?.filePatchCache ?? {}).find(
      (entry) => entry.value?.normalizedPath === path && entry.value?.lane === lane,
    );
    const chunkIds = patchEntry?.value?.chunks.map((chunk) => chunk.chunkId) ?? [];
    expect(chunkIds.length).toBeGreaterThan(0);

    return chunkIds[0]!;
  });
}

async function waitForReviewChunkId(
  config: LiveReviewBrowserConfig,
  path: string,
  excerpt: string,
): Promise<string> {
  return vi.waitFor(() => {
    const threadState = readThreadState(config);
    const file = Object.values(threadState?.snapshot.filesById ?? {}).find(
      (entry) => entry.normalizedPath === path,
    );
    expect(file).toBeTruthy();

    const chunkIds = file ? (threadState?.snapshot.chunkIdsByFileId[file.id] ?? []) : [];
    const chunkId =
      chunkIds.find((candidateId) => {
        const chunk = threadState?.snapshot.chunksById[candidateId];
        return chunk?.anchor.excerpt.includes(excerpt);
      }) ?? null;

    expect(chunkId).not.toBeNull();
    return chunkId!;
  });
}

async function waitForReviewChunkSelection(
  config: LiveReviewBrowserConfig,
  path: string,
  chunkId: string,
): Promise<void> {
  await vi.waitFor(() => {
    const threadState = readThreadState(config);
    expect(threadState?.selection.chunkId).toBe(chunkId);

    const patchEntry = Object.values(threadState?.filePatchCache ?? {}).find(
      (entry) =>
        entry.status === "ready" &&
        entry.value?.normalizedPath === path &&
        (entry.value?.chunks.some((chunk) => chunk.chunkId === chunkId) ?? false),
    );
    expect(patchEntry).toBeTruthy();
  });
}

function selectReviewChunkInStore(
  config: LiveReviewBrowserConfig,
  input: { chunkId: string; fileId: string; groupId: string },
): void {
  const threadKey = scopedThreadKey(scopeThreadRef(config.environmentId, config.threadId));
  const threadState = readThreadState(config);
  if (!threadState) {
    throw new Error("Review thread state was not available.");
  }
  useReviewStore.getState().setRouteState(threadKey, {
    ...threadState.routeState,
    reviewGroupId: input.groupId,
    reviewFileId: input.fileId,
    reviewChunkId: input.chunkId,
    reviewCommentId: undefined,
  });
}

async function waitForDiffRefresh(
  config: LiveReviewBrowserConfig,
  previousToken: string | null | undefined,
): Promise<void> {
  await vi.waitFor(
    () => {
      const nextToken = readThreadState(config)?.diffCacheToken ?? null;
      expect(nextToken).not.toBeNull();
      expect(nextToken).not.toBe(previousToken ?? null);
    },
    { timeout: 30_000 },
  );
}

async function waitForLiveReviewBootstrap(
  config: LiveReviewBrowserConfig,
  reviewMode: LiveReviewMode,
): Promise<void> {
  await vi.waitFor(() => {
    expect(selectBootstrapCompleteForActiveEnvironment(useStore.getState())).toBe(true);
  });

  await vi.waitFor(
    () => {
      const threadState = readThreadState(config);
      expect(threadState?.diffCacheToken).not.toBeNull();
      expect(threadState?.routeState.reviewMode).toBe(reviewMode);
      expect((threadState?.explorer.laneIds.length ?? 0) > 0).toBe(true);
    },
    { timeout: 15_000 },
  );
}

const liveConfig = readLiveReviewBrowserConfig();

describe.skipIf(liveConfig === null)("ReviewTabShell live server browser harness", () => {
  afterEach(async () => {
    Reflect.deleteProperty(window, "desktopBridge");
    await __resetLocalApiForTests();
    useReviewStore.setState({ threads: {} });
    document.body.innerHTML = "";
  });

  it("loads raw review explorer content from a live Fenrir server", async () => {
    const config = liveConfig!;
    const mounted = await mountLiveReviewRoute(config, "raw");

    try {
      await waitForLiveReviewBootstrap(config, "raw");

      await expect.element(page.getByRole("heading", { name: /^Review$/ })).toBeInTheDocument();
      await expect.element(page.getByText("Raw Review Surface")).toBeInTheDocument();
      await expect.element(page.getByText("Choose a file")).toBeInTheDocument();
      await expect.element(rawFileButton(config.expectedFilePath, "unstaged")).toBeInTheDocument();

      await rawFileButton(config.expectedFilePath, "unstaged").click();

      await expect.element(page.getByText(/^Patch chunks$/)).toBeInTheDocument();
      await expect.element(page.getByText(config.expectedChunkText)).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("stages a chunk from the raw review surface against the live Fenrir server", async () => {
    const config = liveConfig!;
    const mounted = await mountLiveReviewRoute(config, "raw");

    try {
      await waitForLiveReviewBootstrap(config, "raw");

      await rawFileButton(config.expectedFilePath, "unstaged").click();
      await rawFileExpandButton(config.expectedFilePath, "unstaged").click();
      await expect.element(page.getByText(/^Patch chunks$/)).toBeInTheDocument();

      const chunkId = await waitForRawChunkId(config, config.expectedFilePath, "unstaged");
      await expect
        .element(rawChunkCheckbox(config.expectedFilePath, "unstaged", chunkId))
        .toBeVisible();
      await rawChunkCheckbox(config.expectedFilePath, "unstaged", chunkId).click();

      await expect.element(page.getByText(/^Bulk actions \(1 selected\)$/)).toBeInTheDocument();
      await page.getByRole("button", { name: /^Stage$/ }).click();

      await vi.waitFor(() => {
        const threadState = readThreadState(config);
        const entries = Object.values(threadState?.explorer.fileEntryById ?? {}).filter(
          (entry) => entry.normalizedPath === config.expectedFilePath,
        );
        const unstagedEntry = entries.find((entry) => entry.lane === "unstaged");
        const stagedEntry = entries.find((entry) => entry.lane === "staged");

        expect(unstagedEntry).toBeTruthy();
        expect(stagedEntry).toBeTruthy();
        expect((unstagedEntry?.insertions ?? 0) + (unstagedEntry?.deletions ?? 0)).toBeGreaterThan(
          0,
        );
        expect((stagedEntry?.insertions ?? 0) + (stagedEntry?.deletions ?? 0)).toBeGreaterThan(0);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("discards a chunk from the raw review surface against the live Fenrir server", async () => {
    const config = liveConfig!;
    const mounted = await mountLiveReviewRoute(config, "raw");

    try {
      await waitForLiveReviewBootstrap(config, "raw");

      await rawFileButton(UNSTAGED_FILE_PATH, "unstaged").click();
      await rawFileExpandButton(UNSTAGED_FILE_PATH, "unstaged").click();
      await expect.element(page.getByText(/^Patch chunks$/)).toBeInTheDocument();

      const chunkId = await waitForRawChunkId(config, UNSTAGED_FILE_PATH, "unstaged");
      await expect.element(rawChunkCheckbox(UNSTAGED_FILE_PATH, "unstaged", chunkId)).toBeVisible();
      await rawChunkCheckbox(UNSTAGED_FILE_PATH, "unstaged", chunkId).click();

      await expect.element(page.getByText(/^Bulk actions \(1 selected\)$/)).toBeInTheDocument();
      const previousDiffToken = readThreadState(config)?.diffCacheToken ?? null;
      await page.getByRole("button", { name: /^Undo$/ }).click();
      await waitForDiffRefresh(config, previousDiffToken);

      await vi.waitFor(() => {
        const threadState = readThreadState(config);
        const hasUnstagedFile = Object.values(threadState?.explorer.fileEntryById ?? {}).some(
          (entry) => entry.normalizedPath === UNSTAGED_FILE_PATH && entry.lane === "unstaged",
        );

        expect(hasUnstagedFile).toBe(false);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("adds a local chunk comment from the review surface against the live Fenrir server", async () => {
    const config = liveConfig!;
    const mounted = await mountLiveReviewRoute(config, "review");

    try {
      await waitForLiveReviewBootstrap(config, "review");

      await expect
        .element(
          page.getByText("Choose a file to inspect chunks, progress, and review discussion."),
        )
        .toBeInTheDocument();

      await reviewFileButton(COMMITTED_FILE_PATH).click();
      const chunkId = await waitForReviewChunkId(config, COMMITTED_FILE_PATH, "after committed");
      const threadState = readThreadState(config);
      const chunk = threadState?.snapshot.chunksById[chunkId] ?? null;
      if (!chunk) {
        throw new Error(`Expected committed review chunk ${chunkId} to exist.`);
      }
      selectReviewChunkInStore(config, {
        chunkId,
        fileId: chunk.fileId,
        groupId: chunk.groupId,
      });
      await waitForReviewChunkSelection(config, COMMITTED_FILE_PATH, chunkId);

      await expect.element(page.getByTestId("review-chunk-local-note-input")).toBeVisible();
      await page.getByTestId("review-chunk-local-note-input").fill(COMMENT_BODY);
      await page.getByTestId("review-chunk-local-note-submit").click();

      await expect.element(page.getByText(COMMENT_BODY)).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
