import {
  CommandId,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type DesktopBridge,
  EnvironmentId,
  EventId,
  ProjectId,
  type OrchestrationEvent,
  type ServerConfig,
  type ServerProvider,
  type TerminalEvent,
  ThreadId,
  type VcsStatusResult,
} from "@fenrir/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "@fenrir/contracts";

const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();

function registerListener<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const terminalEventListeners = new Set<(event: TerminalEvent) => void>();
const orchestrationEventListeners = new Set<(event: OrchestrationEvent) => void>();
const orchestrationShellListeners = new Set<(item: unknown) => void>();
const orchestrationManagedProcessListeners = new Set<(item: unknown) => void>();
const vcsStatusListeners = new Set<(event: VcsStatusResult) => void>();

const rpcClientMock = {
  dispose: vi.fn(),
  terminal: {
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    restart: vi.fn(),
    close: vi.fn(),
    attachTmux: vi.fn(),
    detachTmux: vi.fn(),
    writeTmux: vi.fn(),
    resizeTmux: vi.fn(),
    onEvent: vi.fn((listener: (event: TerminalEvent) => void) =>
      registerListener(terminalEventListeners, listener),
    ),
  },
  rawTcp: {
    createListener: vi.fn(),
    stopListener: vi.fn(),
    listListeners: vi.fn(),
    listSessions: vi.fn(),
    sessionWrite: vi.fn(),
    sessionUpgradePty: vi.fn(),
    sessionClose: vi.fn(),
    onEvent: vi.fn(),
  },
  projects: {
    searchEntries: vi.fn(),
    writeFile: vi.fn(),
  },
  filesystem: {
    browse: vi.fn(),
  },
  sourceControl: {
    lookupRepository: vi.fn(),
    cloneRepository: vi.fn(),
    publishRepository: vi.fn(),
  },
  shell: {
    openInEditor: vi.fn(),
  },
  git: {
    runStackedAction: vi.fn(),
    resolvePullRequest: vi.fn(),
    preparePullRequestThread: vi.fn(),
  },
  vcs: {
    pull: vi.fn(),
    refreshStatus: vi.fn(),
    onStatus: vi.fn((input: { cwd: string }, listener: (event: VcsStatusResult) => void) =>
      registerListener(vcsStatusListeners, listener),
    ),
    listRefs: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    createRef: vi.fn(),
    switchRef: vi.fn(),
    init: vi.fn(),
  },
  server: {
    getConfig: vi.fn(),
    refreshProviders: vi.fn(),
    updateProvider: vi.fn(),
    upsertKeybinding: vi.fn(),
    removeKeybinding: vi.fn(),
    getTraceDiagnostics: vi.fn(),
    getProcessDiagnostics: vi.fn(),
    getProcessResourceHistory: vi.fn(),
    signalProcess: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    subscribeConfig: vi.fn(),
    subscribeLifecycle: vi.fn(),
    subscribeAuthAccess: vi.fn(),
  },
  orchestration: {
    getArchivedShellSnapshot: vi.fn(),
    subscribeShell: vi.fn((listener: (item: unknown) => void) =>
      registerListener(orchestrationShellListeners, listener),
    ),
    subscribeManagedProcesses: vi.fn((listener: (item: unknown) => void) =>
      registerListener(orchestrationManagedProcessListeners, listener),
    ),
    getThreadSnapshot: vi.fn(),
    getSnapshot: vi.fn(),
    dispatchCommand: vi.fn(),
    getTurnDiff: vi.fn(),
    getFullThreadDiff: vi.fn(),
    replayEvents: vi.fn(),
    onDomainEvent: vi.fn((listener: (event: OrchestrationEvent) => void) =>
      registerListener(orchestrationEventListeners, listener),
    ),
  },
};

vi.mock("./environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    kind: "primary" as const,
    knownEnvironment: {
      id: "environment-local",
      label: "Primary",
      source: "manual" as const,
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
      environmentId: EnvironmentId.make("environment-local"),
    },
    client: rpcClientMock,
    environmentId: EnvironmentId.make("environment-local"),
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  }),
  resetEnvironmentServiceForTests: vi.fn(),
  resetSavedEnvironmentRegistryStoreForTests: vi.fn(),
  resetSavedEnvironmentRuntimeStoreForTests: vi.fn(),
}));

vi.mock("./contextMenuFallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

function emitEvent<T>(listeners: Set<(event: T) => void>, event: T) {
  for (const listener of listeners) {
    listener(event);
  }
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getLocalEnvironmentBootstrap: () => null,
    getClientSettings: async () => null,
    setClientSettings: async () => undefined,
    getSavedEnvironmentRegistry: async () => [],
    setSavedEnvironmentRegistry: async () => undefined,
    getSavedEnvironmentSecret: async () => null,
    setSavedEnvironmentSecret: async () => true,
    removeSavedEnvironmentSecret: async () => undefined,
    getServerExposureState: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    setServerExposureMode: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    pickFolder: async () => null,
    confirm: async () => true,
    setTheme: async () => undefined,
    showContextMenu: async () => null,
    openExternal: async () => true,
    onMenuAction: () => () => undefined,
    getUpdateState: async () => {
      throw new Error("getUpdateState not implemented in test");
    },
    checkForUpdate: async () => {
      throw new Error("checkForUpdate not implemented in test");
    },
    downloadUpdate: async () => {
      throw new Error("downloadUpdate not implemented in test");
    },
    installUpdate: async () => {
      throw new Error("installUpdate not implemented in test");
    },
    onUpdateState: () => () => undefined,
    getVpnState: async () => ({
      status: "disconnected" as const,
      activeProfileId: null,
      assignedIp: null,
      connectedAt: null,
      errorMessage: null,
    }),
    getVpnProfiles: async () => [],
    addVpnProfile: async () => {
      throw new Error("addVpnProfile not implemented in test");
    },
    removeVpnProfile: async () => undefined,
    connectVpn: async () => {
      throw new Error("connectVpn not implemented in test");
    },
    disconnectVpn: async () => ({
      status: "disconnected" as const,
      activeProfileId: null,
      assignedIp: null,
      connectedAt: null,
      errorMessage: null,
    }),
    pickFile: async () => null,
    onVpnStateChange: () => () => undefined,
    trafficLensCreateTab: async () => {
      throw new Error("trafficLensCreateTab not implemented in test");
    },
    trafficLensCreateTabInProfile: async () => {
      throw new Error("trafficLensCreateTabInProfile not implemented in test");
    },
    trafficLensCloseTab: async () => undefined,
    trafficLensNavigate: async () => undefined,
    trafficLensGoBack: async () => undefined,
    trafficLensGoForward: async () => undefined,
    trafficLensReload: async () => undefined,
    trafficLensGetTabs: async () => [],
    trafficLensSetTabViewMode: async () => {
      throw new Error("trafficLensSetTabViewMode not implemented in test");
    },
    trafficLensSetTabMobilePreset: async () => {
      throw new Error("trafficLensSetTabMobilePreset not implemented in test");
    },
    trafficLensSetBounds: async () => undefined,
    trafficLensShowTab: async () => undefined,
    trafficLensHideAllTabs: async () => undefined,
    trafficLensListRules: async () => [],
    trafficLensCreateRule: async () => {
      throw new Error("trafficLensCreateRule not implemented in test");
    },
    trafficLensUpdateRule: async () => {
      throw new Error("trafficLensUpdateRule not implemented in test");
    },
    trafficLensDeleteRule: async () => undefined,
    trafficLensSetRuleEnabled: async () => undefined,
    trafficLensListPaused: async () => [],
    trafficLensContinuePaused: async () => undefined,
    trafficLensDropPaused: async () => undefined,
    trafficLensListProfiles: async () => [],
    trafficLensCreateProfile: async () => {
      throw new Error("trafficLensCreateProfile not implemented in test");
    },
    trafficLensUpdateProfile: async () => {
      throw new Error("trafficLensUpdateProfile not implemented in test");
    },
    trafficLensDeleteProfile: async () => undefined,
    trafficLensGetCookies: async () => [],
    trafficLensSetCookie: async () => undefined,
    trafficLensDeleteCookie: async () => undefined,
    trafficLensGetStorage: async () => [],
    trafficLensSetStorageEntry: async () => undefined,
    trafficLensDeleteStorageEntry: async () => undefined,
    trafficLensListStorageOrigins: async () => [],
    trafficLensCaptureStorageOrigin: async () => undefined,
    trafficLensGetApplicableCookies: async () => [],
    trafficLensSetCookieForOrigin: async () => undefined,
    trafficLensDeleteCookieForOrigin: async () => undefined,
    trafficLensGetLocalStorage: async () => [],
    trafficLensSetLocalStorageItem: async () => undefined,
    trafficLensDeleteLocalStorageItem: async () => undefined,
    trafficLensClearLocalStorage: async () => undefined,
    trafficLensGetLiveSessionStorage: async () => [],
    trafficLensSetLiveSessionStorageItem: async () => undefined,
    trafficLensDeleteLiveSessionStorageItem: async () => undefined,
    trafficLensClearLiveSessionStorage: async () => undefined,
    trafficLensListSessionStorageSnapshots: async () => [],
    trafficLensGetSessionStorageSnapshot: async () => [],
    trafficLensUpdateSessionStorageSnapshot: async () => undefined,
    trafficLensRehydrateSessionStorageSnapshot: async () => ({ tabId: "tab-1" }),
    trafficLensListOverrides: async () => [],
    trafficLensCreateOverride: async () => {
      throw new Error("trafficLensCreateOverride not implemented in test");
    },
    trafficLensUpdateOverride: async () => {
      throw new Error("trafficLensUpdateOverride not implemented in test");
    },
    trafficLensDeleteOverride: async () => undefined,
    trafficLensSetOverrideEnabled: async () => undefined,
    onTrafficLensTabEvent: () => () => undefined,
    onTrafficLensPausedEvent: () => () => undefined,
    onTrafficLensStorageChanged: () => () => undefined,
    onTrafficLensStorageEvent: () => () => undefined,
    neovimAttach: async () => undefined,
    neovimDetach: async () => undefined,
    neovimInput: async () => undefined,
    neovimResize: async () => undefined,
    neovimSetCwd: async () => undefined,
    onNeovimRedraw: () => () => undefined,
    renderStart: async () => undefined,
    renderStop: async () => undefined,
    renderSetFps: async () => undefined,
    renderSyncViewport: async () => undefined,
    setEditorFontMetrics: async () => undefined,
    sendInput: () => undefined,
    onFrame: () => () => undefined,
    isMainWindow: () => true,
    nvimAvailable: async () => true,
    nvimProbeDetail: async () => ({
      available: true,
      version: "NVIM v0.10.0",
      binary: "nvim",
      error: null,
    }),
    editor: {
      openFile: async () => undefined,
      onEvent: () => () => undefined,
      onSendToComposer: () => () => undefined,
      onCmd: () => () => undefined,
      invokeBridge: async () => undefined,
    },
    ...overrides,
  };
}

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
  },
];

const baseEnvironment = {
  environmentId: EnvironmentId.make("environment-local"),
  label: "Local environment",
  platform: {
    os: "darwin" as const,
    arch: "arm64" as const,
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
};

const baseServerConfig: ServerConfig = {
  environment: baseEnvironment,
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-session-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ["cursor"],
  observability: {
    logsDirectoryPath: "/tmp/workspace/.config/logs",
    localTracingEnabled: true,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
  globalActions: [],
  skills: [],
};

const baseGitStatus: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/streamed",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  showContextMenuFallbackMock.mockReset();
  terminalEventListeners.clear();
  orchestrationEventListeners.clear();
  vcsStatusListeners.clear();
  const testWindow = getWindowForTest();
  Reflect.deleteProperty(testWindow, "desktopBridge");
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    value: createLocalStorageStub(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsApi", () => {
  it("forwards server config fetches directly to the RPC client", async () => {
    rpcClientMock.server.getConfig.mockResolvedValue(baseServerConfig);
    const { createLocalApi } = await import("./localApi");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.getConfig()).resolves.toEqual(baseServerConfig);
    expect(rpcClientMock.server.getConfig).toHaveBeenCalledWith();
    expect(rpcClientMock.server.subscribeConfig).not.toHaveBeenCalled();
    expect(rpcClientMock.server.subscribeLifecycle).not.toHaveBeenCalled();
  });

  it("forwards terminal and orchestration stream events", async () => {
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onTerminalEvent = vi.fn();
    const onDomainEvent = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.onDomainEvent(onDomainEvent);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitEvent(terminalEventListeners, terminalEvent);

    const orchestrationEvent = {
      sequence: 1,
      eventId: EventId.make("event-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.make("project-1"),
      occurredAt: "2026-02-24T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        globalScriptDefaults: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies Extract<OrchestrationEvent, { type: "project.created" }>;
    emitEvent(orchestrationEventListeners, orchestrationEvent);

    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onDomainEvent).toHaveBeenCalledWith(orchestrationEvent);
  });

  it("forwards git status stream events", async () => {
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onStatus = vi.fn();

    api.vcs.onStatus({ cwd: "/repo" }, onStatus);

    const gitStatus = baseGitStatus;
    emitEvent(vcsStatusListeners, gitStatus);

    expect(rpcClientMock.vcs.onStatus).toHaveBeenCalledWith({ cwd: "/repo" }, onStatus, undefined);
    expect(onStatus).toHaveBeenCalledWith(gitStatus);
  });

  it("forwards git status refreshes directly to the RPC client", async () => {
    rpcClientMock.vcs.refreshStatus.mockResolvedValue(baseGitStatus);
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);

    await api.vcs.refreshStatus({ cwd: "/repo" });

    expect(rpcClientMock.vcs.refreshStatus).toHaveBeenCalledWith({ cwd: "/repo" });
  });

  it("forwards orchestration stream subscription options to the RPC client", async () => {
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onDomainEvent = vi.fn();
    const onResubscribe = vi.fn();

    api.orchestration.onDomainEvent(onDomainEvent, { onResubscribe });

    expect(rpcClientMock.orchestration.onDomainEvent).toHaveBeenCalledWith(onDomainEvent, {
      onResubscribe,
    });
  });

  it("sends orchestration dispatch commands as the direct RPC payload", async () => {
    rpcClientMock.orchestration.dispatchCommand.mockResolvedValue({ sequence: 1 });
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    const command = {
      type: "project.create",
      commandId: CommandId.make("cmd-1"),
      projectId: ProjectId.make("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(rpcClientMock.orchestration.dispatchCommand).toHaveBeenCalledWith(command);
  });

  it("forwards workspace file writes to the project RPC", async () => {
    rpcClientMock.projects.writeFile.mockResolvedValue({ relativePath: "plan.md" });
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(rpcClientMock.projects.writeFile).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("forwards full-thread diff requests to the orchestration RPC", async () => {
    rpcClientMock.orchestration.getFullThreadDiff.mockResolvedValue({ diff: "patch" });
    const { createEnvironmentApi } = await import("./environmentApi");

    const api = createEnvironmentApi(rpcClientMock as never);
    await api.orchestration.getFullThreadDiff({
      threadId: ThreadId.make("thread-1"),
      toTurnCount: 1,
    });

    expect(rpcClientMock.orchestration.getFullThreadDiff).toHaveBeenCalledWith({
      threadId: "thread-1",
      toTurnCount: 1,
    });
  });

  it("forwards provider refreshes directly to the RPC client", async () => {
    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        checkedAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    rpcClientMock.server.refreshProviders.mockResolvedValue({ providers: nextProviders });
    const { createLocalApi } = await import("./localApi");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.refreshProviders()).resolves.toEqual({ providers: nextProviders });
    expect(rpcClientMock.server.refreshProviders).toHaveBeenCalledWith();
  });

  it("forwards server settings updates directly to the RPC client", async () => {
    const nextSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };
    rpcClientMock.server.updateSettings.mockResolvedValue(nextSettings);
    const { createLocalApi } = await import("./localApi");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.updateSettings({ enableAssistantStreaming: true })).resolves.toEqual(
      nextSettings,
    );
    expect(rpcClientMock.server.updateSettings).toHaveBeenCalledWith({
      enableAssistantStreaming: true,
    });
  });

  it("forwards context menu metadata to the desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    getWindowForTest().desktopBridge = makeDesktopBridge({ showContextMenu });

    const { createLocalApi } = await import("./localApi");
    const api = createLocalApi(rpcClientMock as never);
    const items = [{ id: "delete", label: "Delete" }] as const;

    await expect(api.contextMenu.show(items)).resolves.toBe("delete");
    expect(showContextMenu).toHaveBeenCalledWith(items, undefined);
  });

  it("falls back to the browser context menu helper when the desktop bridge is missing", async () => {
    showContextMenuFallbackMock.mockResolvedValue("rename");
    const { createLocalApi } = await import("./localApi");

    const api = createLocalApi(rpcClientMock as never);
    const items = [{ id: "rename", label: "Rename" }] as const;

    await expect(api.contextMenu.show(items, { x: 4, y: 5 })).resolves.toBe("rename");
    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(items, { x: 4, y: 5 });
  });

  it("reads and writes persistence through the desktop bridge when available", async () => {
    const getClientSettings = vi.fn().mockResolvedValue({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffIgnoreWhitespace: true,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
    const setClientSettings = vi.fn().mockResolvedValue(undefined);
    const getSavedEnvironmentRegistry = vi.fn().mockResolvedValue([]);
    const setSavedEnvironmentRegistry = vi.fn().mockResolvedValue(undefined);
    const getSavedEnvironmentSecret = vi.fn().mockResolvedValue("bearer-token");
    const setSavedEnvironmentSecret = vi.fn().mockResolvedValue(true);
    const removeSavedEnvironmentSecret = vi.fn().mockResolvedValue(undefined);
    getWindowForTest().desktopBridge = makeDesktopBridge({
      getClientSettings,
      setClientSettings,
      getSavedEnvironmentRegistry,
      setSavedEnvironmentRegistry,
      getSavedEnvironmentSecret,
      setSavedEnvironmentSecret,
      removeSavedEnvironmentSecret,
    });

    const { createLocalApi } = await import("./localApi");
    const api = createLocalApi(rpcClientMock as never);

    await api.persistence.getClientSettings();
    await api.persistence.setClientSettings({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffIgnoreWhitespace: true,
      diffWordWrap: true,
      favorites: [],
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      sidebarThreadPreviewCount: 6,
      timestampFormat: "24-hour",
      embeddedEditor: "neovim",
      uiFontFamily: "Geist Mono",
      uiFontSize: 14,
      terminalFontFamily: "GeistMono Nerd Font",
      terminalFontSize: 12,
      terminalLineHeight: 1.2,
      editorFontFamily: "GeistMono Nerd Font",
      editorFontSize: 14,
      editorLineHeight: 1.2,
      editorFontWeight: 400,
      editorLigatures: true,
    });
    await api.persistence.getSavedEnvironmentRegistry();
    await api.persistence.setSavedEnvironmentRegistry([]);
    await api.persistence.getSavedEnvironmentSecret(EnvironmentId.make("environment-local"));
    await api.persistence.setSavedEnvironmentSecret(
      EnvironmentId.make("environment-local"),
      "bearer-token",
    );
    await api.persistence.removeSavedEnvironmentSecret(EnvironmentId.make("environment-local"));

    expect(getClientSettings).toHaveBeenCalledWith();
    expect(setClientSettings).toHaveBeenCalledWith({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffIgnoreWhitespace: true,
      diffWordWrap: true,
      favorites: [],
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      sidebarThreadPreviewCount: 6,
      timestampFormat: "24-hour",
      embeddedEditor: "neovim",
      uiFontFamily: "Geist Mono",
      uiFontSize: 14,
      terminalFontFamily: "GeistMono Nerd Font",
      terminalFontSize: 12,
      terminalLineHeight: 1.2,
      editorFontFamily: "GeistMono Nerd Font",
      editorFontSize: 14,
      editorLineHeight: 1.2,
      editorFontWeight: 400,
      editorLigatures: true,
    });
    expect(getSavedEnvironmentRegistry).toHaveBeenCalledWith();
    expect(setSavedEnvironmentRegistry).toHaveBeenCalledWith([]);
    expect(getSavedEnvironmentSecret).toHaveBeenCalledWith("environment-local");
    expect(setSavedEnvironmentSecret).toHaveBeenCalledWith("environment-local", "bearer-token");
    expect(removeSavedEnvironmentSecret).toHaveBeenCalledWith("environment-local");
  });

  it("falls back to browser storage for persistence when the desktop bridge is missing", async () => {
    const { createLocalApi } = await import("./localApi");
    const api = createLocalApi(rpcClientMock as never);

    await api.persistence.setClientSettings({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffIgnoreWhitespace: true,
      diffWordWrap: true,
      favorites: [],
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      sidebarThreadPreviewCount: 6,
      timestampFormat: "24-hour",
      embeddedEditor: "neovim",
      uiFontFamily: "Geist Mono",
      uiFontSize: 14,
      terminalFontFamily: "GeistMono Nerd Font",
      terminalFontSize: 12,
      terminalLineHeight: 1.2,
      editorFontFamily: "GeistMono Nerd Font",
      editorFontSize: 14,
      editorLineHeight: 1.2,
      editorFontWeight: 400,
      editorLigatures: true,
    });
    await api.persistence.setSavedEnvironmentRegistry([
      {
        environmentId: EnvironmentId.make("environment-local"),
        label: "Primary",
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
        createdAt: "2026-04-09T00:00:00.000Z",
        lastConnectedAt: null,
      },
    ]);
    await api.persistence.setSavedEnvironmentSecret(
      EnvironmentId.make("environment-local"),
      "bearer-token",
    );

    await expect(api.persistence.getClientSettings()).resolves.toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffIgnoreWhitespace: true,
      diffWordWrap: true,
      favorites: [],
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      sidebarThreadPreviewCount: 6,
      timestampFormat: "24-hour",
      embeddedEditor: "neovim",
      uiFontFamily: "Geist Mono",
      uiFontSize: 14,
      terminalFontFamily: "GeistMono Nerd Font",
      terminalFontSize: 12,
      terminalLineHeight: 1.2,
      editorFontFamily: "GeistMono Nerd Font",
      editorFontSize: 14,
      editorLineHeight: 1.2,
      editorFontWeight: 400,
      editorLigatures: true,
    });
    await expect(api.persistence.getSavedEnvironmentRegistry()).resolves.toEqual([
      {
        environmentId: EnvironmentId.make("environment-local"),
        label: "Primary",
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
        createdAt: "2026-04-09T00:00:00.000Z",
        lastConnectedAt: null,
      },
    ]);
    await expect(
      api.persistence.getSavedEnvironmentSecret(EnvironmentId.make("environment-local")),
    ).resolves.toBe("bearer-token");

    await api.persistence.removeSavedEnvironmentSecret(EnvironmentId.make("environment-local"));

    await expect(
      api.persistence.getSavedEnvironmentSecret(EnvironmentId.make("environment-local")),
    ).resolves.toBeNull();
  });
});
