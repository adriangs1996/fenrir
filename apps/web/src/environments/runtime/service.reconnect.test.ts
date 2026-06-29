import { EnvironmentId } from "@fenrir/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environmentId = EnvironmentId.make("env-remote");
const record = {
  environmentId,
  label: "Remote",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-22T10:00:00.000Z",
  lastConnectedAt: null,
};

const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockResolveRemoteWebSocketConnectionUrl = vi.fn();
const mockFetchRemoteSessionState = vi.fn();
const mockReadSavedEnvironmentBearerToken = vi.fn();
const mockRegistrySubscribe = vi.fn();
const mockRuntimeEnsure = vi.fn();
const mockRuntimePatch = vi.fn();
const mockRuntimeClear = vi.fn();

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: () => ({
    id: "primary",
    label: "Primary",
    source: "local",
    target: {
      httpBaseUrl: "http://localhost:3000",
      wsBaseUrl: "ws://localhost:3000",
    },
    environmentId: EnvironmentId.make("primary"),
  }),
  resolvePrimaryWebSocketConnectionUrl: vi.fn(async () => "ws://localhost:3000/ws"),
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: vi.fn(),
  fetchRemoteEnvironmentDescriptor: vi.fn(),
  fetchRemoteSessionState: mockFetchRemoteSessionState,
  isRemoteAuthBlockedStatus: (status: number) => status === 401 || status === 403,
  isRemoteEnvironmentAuthHttpError: vi.fn(() => false),
  resolveRemoteWebSocketConnectionUrl: mockResolveRemoteWebSocketConnectionUrl,
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: vi.fn(() => record),
  getSavedEnvironmentRuntimeState: vi.fn(() => ({
    connectionState: "disconnected",
    authState: "unknown",
    syncState: "ok",
  })),
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: vi.fn(() => []),
  persistSavedEnvironmentRecord: vi.fn(),
  readSavedEnvironmentBearerToken: mockReadSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    subscribe: mockRegistrySubscribe,
    getState: () => ({
      upsert: vi.fn(),
      remove: vi.fn(),
      markConnected: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: mockRuntimeEnsure,
      patch: mockRuntimePatch,
      clear: mockRuntimeClear,
    }),
  },
  waitForSavedEnvironmentRegistryHydration: vi.fn(async () => undefined),
  writeSavedEnvironmentBearerToken: vi.fn(),
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: class {
    constructor(
      readonly urlProvider: () => Promise<string>,
      readonly lifecycleHandlers?: unknown,
    ) {}
  },
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

function createClient(label: string) {
  return {
    label,
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    isHeartbeatFresh: vi.fn(() => false),
    server: {
      getConfig: vi.fn(async () => ({
        environment: {
          environmentId,
          label: "Remote",
        },
        availableEditors: [],
      })),
      subscribeConfig: vi.fn(() => () => undefined),
      subscribeLifecycle: vi.fn(() => () => undefined),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRegistrySubscribe.mockReturnValue(() => undefined);
  mockResolveRemoteWebSocketConnectionUrl.mockResolvedValue("wss://remote.example.com/ws");
  mockFetchRemoteSessionState.mockResolvedValue({
    authenticated: true,
    role: "client",
  });
  mockCreateWsRpcClient.mockImplementation((transport: { urlProvider: () => Promise<string> }) => {
    void transport.urlProvider();
    return createClient(`client-${mockCreateWsRpcClient.mock.calls.length}`);
  });
  mockCreateEnvironmentConnection.mockImplementation((input: any) => ({
    kind: input.kind,
    environmentId: input.knownEnvironment.environmentId,
    knownEnvironment: input.knownEnvironment,
    client: input.client,
    ensureBootstrapped: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    requestReconnect: vi.fn(async () => true),
    dispose: vi.fn(async () => undefined),
  }));
});

afterEach(async () => {
  const { resetEnvironmentServiceForTests } = await import("./service");
  await resetEnvironmentServiceForTests();
  vi.unstubAllGlobals();
});

describe("environment reconnect service", () => {
  it("does not consume browser-resume cooldown when heartbeats are fresh", async () => {
    vi.useFakeTimers();
    try {
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      const documentMock = {
        visibilityState: "visible",
        addEventListener,
        removeEventListener,
      };
      vi.stubGlobal("document", documentMock);
      vi.stubGlobal("window", {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { startEnvironmentConnectionService } = await import("./service");
      const stop = startEnvironmentConnectionService({
        invalidateQueries: vi.fn(),
      } as any);
      const connection = mockCreateEnvironmentConnection.mock.results[0]?.value;
      connection.requestReconnect.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const visibilityHandler = addEventListener.mock.calls.find(
        ([eventName]) => eventName === "visibilitychange",
      )?.[1] as (() => void) | undefined;

      expect(visibilityHandler).toBeDefined();
      documentMock.visibilityState = "hidden";
      visibilityHandler?.();
      documentMock.visibilityState = "visible";
      visibilityHandler?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(connection.requestReconnect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      documentMock.visibilityState = "hidden";
      visibilityHandler?.();
      documentMock.visibilityState = "visible";
      visibilityHandler?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(connection.requestReconnect).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds saved connections with the latest bearer token before explicit retry", async () => {
    mockReadSavedEnvironmentBearerToken
      .mockResolvedValueOnce("old-token")
      .mockResolvedValueOnce("new-token");

    const { reconnectSavedEnvironment } = await import("./service");

    await reconnectSavedEnvironment(environmentId);
    const firstConnection = mockCreateEnvironmentConnection.mock.results[0]?.value;

    await reconnectSavedEnvironment(environmentId);
    const secondConnection = mockCreateEnvironmentConnection.mock.results[1]?.value;

    expect(firstConnection.dispose).toHaveBeenCalledOnce();
    expect(secondConnection.requestReconnect).toHaveBeenCalledWith("user-retry");
    expect(mockResolveRemoteWebSocketConnectionUrl).toHaveBeenLastCalledWith({
      wsBaseUrl: record.wsBaseUrl,
      httpBaseUrl: record.httpBaseUrl,
      bearerToken: "new-token",
    });
    expect(mockFetchRemoteSessionState).toHaveBeenLastCalledWith({
      httpBaseUrl: record.httpBaseUrl,
      bearerToken: "new-token",
    });
  });
});
