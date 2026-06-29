import type { ContextMenuItem, LocalApi } from "@fenrir/contracts";

import { resetGitStatusStateForTests } from "./lib/gitStatusState";
import { resetSourceControlDiscoveryStateForTests } from "./lib/sourceControlDiscoveryState";
import { resetRequestLatencyStateForTests } from "./rpc/requestLatencyState";
import { resetServerStateForTests } from "./rpc/serverState";
import { resetWsConnectionStateForTests } from "./rpc/wsConnectionState";
import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
} from "./environments/runtime";
import {
  getPrimaryEnvironmentConnection,
  resetEnvironmentServiceForTests,
} from "./environments/runtime";
import { type WsRpcClient } from "./rpc/wsRpcClient";
import { showContextMenuFallback } from "./contextMenuFallback";
import {
  readBrowserClientSettings,
  readBrowserSavedEnvironmentRegistry,
  readBrowserSavedEnvironmentSecret,
  removeBrowserSavedEnvironmentSecret,
  writeBrowserClientSettings,
  writeBrowserSavedEnvironmentRegistry,
  writeBrowserSavedEnvironmentSecret,
} from "./clientPersistenceStorage";

let cachedApi: LocalApi | undefined;

type LocalClientResolver = WsRpcClient | (() => WsRpcClient);

function createLocalClientResolver(rpcClientOrResolver: LocalClientResolver): () => WsRpcClient {
  if (typeof rpcClientOrResolver === "function") {
    return rpcClientOrResolver;
  }
  return () => rpcClientOrResolver;
}

export function createLocalApi(rpcClientOrResolver: LocalClientResolver): LocalApi {
  const resolveClient = createLocalClientResolver(rpcClientOrResolver);

  return {
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: (cwd, editor) => resolveClient().shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
      getSavedEnvironmentRegistry: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentRegistry();
        }
        return readBrowserSavedEnvironmentRegistry();
      },
      setSavedEnvironmentRegistry: async (records) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentRegistry(records);
        }
        writeBrowserSavedEnvironmentRegistry(records);
      },
      getSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentSecret(environmentId);
        }
        return readBrowserSavedEnvironmentSecret(environmentId);
      },
      setSavedEnvironmentSecret: async (environmentId, secret) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentSecret(environmentId, secret);
        }
        return writeBrowserSavedEnvironmentSecret(environmentId, secret);
      },
      removeSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.removeSavedEnvironmentSecret(environmentId);
        }
        removeBrowserSavedEnvironmentSecret(environmentId);
      },
    },
    server: {
      getConfig: () => resolveClient().server.getConfig(),
      listProviderSkills: (input) => resolveClient().server.listProviderSkills(input),
      refreshProviders: (input) =>
        input === undefined
          ? resolveClient().server.refreshProviders()
          : resolveClient().server.refreshProviders(input),
      updateProvider: (input) => resolveClient().server.updateProvider(input),
      upsertKeybinding: (input) => resolveClient().server.upsertKeybinding(input),
      removeKeybinding: (input) => resolveClient().server.removeKeybinding(input),
      getTraceDiagnostics: () => resolveClient().server.getTraceDiagnostics(),
      getProcessDiagnostics: () => resolveClient().server.getProcessDiagnostics(),
      getProcessResourceHistory: (input) => resolveClient().server.getProcessResourceHistory(input),
      signalProcess: (input) => resolveClient().server.signalProcess(input),
      clearLogs: () => resolveClient().server.clearLogs(),
      getSettings: () => resolveClient().server.getSettings(),
      updateSettings: (patch) => resolveClient().server.updateSettings(patch),
      discoverSourceControl: () => resolveClient().server.discoverSourceControl(),
      getGlobalActions: async () => [...(await resolveClient().server.getGlobalActions())],
      createGlobalAction: (input) => resolveClient().server.createGlobalAction(input),
      updateGlobalAction: (id, input) => resolveClient().server.updateGlobalAction(id, input),
      deleteGlobalAction: (id) => resolveClient().server.deleteGlobalAction(id),
    },
  };
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createLocalApi(() => getPrimaryEnvironmentConnection().client);
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  const { __resetClientSettingsPersistenceForTests } = await import("./hooks/useSettings");
  __resetClientSettingsPersistenceForTests();
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetSourceControlDiscoveryStateForTests();
  resetRequestLatencyStateForTests();
  resetSavedEnvironmentRegistryStoreForTests();
  resetSavedEnvironmentRuntimeStoreForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
