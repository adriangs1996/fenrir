import {
  type AuthSessionRole,
  type EnvironmentId,
  type OrchestrationBootstrapSnapshot,
  type OrchestrationEvent,
  type OrchestrationManagedProcessSnapshot,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  type ServerConfig,
  type TerminalEvent,
  ThreadId,
} from "@fenrir/contracts";
import { type QueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";
import {
  createKnownEnvironment,
  getKnownEnvironmentWsBaseUrl,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@fenrir/client-runtime";

import {
  markPromotedDraftThreadByRef,
  markPromotedDraftThreadsByRef,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { ensureLocalApi } from "~/localApi";
import { collectActiveTerminalThreadIds, isGlobalTerminalThreadId } from "~/modules/terminal";
import { deriveOrchestrationBatchEffects } from "~/orchestrationEventEffects";
import { projectQueryKeys } from "~/lib/projectReactQuery";
import { providerQueryKeys } from "~/lib/providerReactQuery";
import { getPrimaryKnownEnvironment, resolvePrimaryWebSocketConnectionUrl } from "../primary";
import {
  bootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState,
  isRemoteAuthBlockedStatus,
  isRemoteEnvironmentAuthHttpError,
  resolveRemoteWebSocketConnectionUrl,
} from "../remote/api";
import { resolveRemotePairingTarget } from "../remote/target";
import {
  getSavedEnvironmentRuntimeState,
  getSavedEnvironmentRecord,
  hasSavedEnvironmentRegistryHydrated,
  listSavedEnvironmentRecords,
  persistSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken,
  type SavedEnvironmentRecord,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken,
} from "./catalog";
import {
  createEnvironmentConnection,
  type EnvironmentConnection,
  type EnvironmentDomainSyncFailure,
  type EnvironmentDomainSyncFailureReason,
} from "./connection";
import {
  useStore,
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectThreadsAcrossEnvironments,
} from "~/store";
import { useTerminalStateStore } from "~/modules/terminal";
import { useActionRunStore } from "~/modules/action-runs";
import { useUiStateStore } from "~/uiStateStore";
import { WsTransport } from "../../rpc/wsTransport";
import { createWsRpcClient, type WsRpcClient } from "../../rpc/wsRpcClient";
import { emitWelcome, setServerConfigSnapshot } from "../../rpc/serverState";

type EnvironmentServiceState = {
  readonly queryClient: QueryClient;
  readonly queryInvalidationThrottler: Throttler<() => void>;
  refCount: number;
  stop: () => void;
};

const environmentConnections = new Map<EnvironmentId, EnvironmentConnection>();
const environmentConnectionListeners = new Set<() => void>();
const lastAppliedProjectionVersionByEnvironment = new Map<
  EnvironmentId,
  {
    readonly sequence: number;
    readonly updatedAt: string | null;
  }
>();

let activeService: EnvironmentServiceState | null = null;
let needsProviderInvalidation = false;
let lastBrowserHiddenAt: number | null = null;
let lastBrowserResumeReconnectAt = Number.NEGATIVE_INFINITY;
let browserResumeReconnectSweep: Promise<void> | null = null;
const BROWSER_RESUME_RECONNECT_COOLDOWN_MS = 2_000;
const BROWSER_RESUME_MIN_HIDDEN_MS = 1_500;
const NOOP = () => undefined;
const threadSnapshotHydrationInFlight = new Map<string, Promise<void>>();
let rendererUnloading = false;

function compareAppliedProjectionVersion(
  left: { readonly sequence: number; readonly updatedAt: string | null },
  right: { readonly sequence: number; readonly updatedAt: string | null },
): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  const leftUpdatedAt = left.updatedAt ?? "";
  const rightUpdatedAt = right.updatedAt ?? "";
  if (leftUpdatedAt === rightUpdatedAt) {
    return 0;
  }

  return leftUpdatedAt < rightUpdatedAt ? -1 : 1;
}

type ProjectionSnapshotVersion = Pick<
  OrchestrationBootstrapSnapshot | OrchestrationReadModel | OrchestrationShellSnapshot,
  "snapshotSequence" | "updatedAt"
>;

function toAppliedProjectionVersion(snapshot: ProjectionSnapshotVersion): {
  readonly sequence: number;
  readonly updatedAt: string;
} {
  return {
    sequence: snapshot.snapshotSequence,
    updatedAt: snapshot.updatedAt,
  };
}

export function shouldApplyProjectionSnapshot(input: {
  readonly current: {
    readonly sequence: number;
    readonly updatedAt: string | null;
  } | null;
  readonly next: ProjectionSnapshotVersion;
}): boolean {
  if (input.current === null) {
    return true;
  }

  return compareAppliedProjectionVersion(input.current, toAppliedProjectionVersion(input.next)) < 0;
}

export function shouldApplyProjectionEvent(input: {
  readonly current: {
    readonly sequence: number;
    readonly updatedAt: string | null;
  } | null;
  readonly sequence: number;
}): boolean {
  if (input.current === null) {
    return true;
  }

  return input.sequence > input.current.sequence;
}

function readLastAppliedProjectionVersion(environmentId: EnvironmentId): {
  readonly sequence: number;
  readonly updatedAt: string | null;
} | null {
  return lastAppliedProjectionVersionByEnvironment.get(environmentId) ?? null;
}

function markAppliedProjectionSnapshot(
  environmentId: EnvironmentId,
  snapshot: ProjectionSnapshotVersion,
): void {
  const nextVersion = toAppliedProjectionVersion(snapshot);
  const currentVersion = readLastAppliedProjectionVersion(environmentId);
  if (
    currentVersion !== null &&
    compareAppliedProjectionVersion(currentVersion, nextVersion) >= 0
  ) {
    return;
  }

  lastAppliedProjectionVersionByEnvironment.set(environmentId, nextVersion);
}

function markAppliedProjectionEvent(environmentId: EnvironmentId, sequence: number): void {
  const currentVersion = readLastAppliedProjectionVersion(environmentId);
  if (currentVersion !== null && sequence <= currentVersion.sequence) {
    return;
  }

  lastAppliedProjectionVersionByEnvironment.set(environmentId, {
    sequence,
    updatedAt: currentVersion?.updatedAt ?? null,
  });
}
function emitEnvironmentConnectionRegistryChange() {
  for (const listener of environmentConnectionListeners) {
    listener();
  }
}

function getRuntimeErrorFields(error: unknown) {
  return {
    lastError: error instanceof Error ? error.message : String(error),
    lastErrorAt: new Date().toISOString(),
  } as const;
}

function getRuntimeSyncErrorFields(failure: EnvironmentDomainSyncFailure) {
  return {
    syncState: "error",
    lastSyncError: failure.error instanceof Error ? failure.error.message : String(failure.error),
    lastSyncErrorAt: new Date().toISOString(),
    lastSyncFailureReason: failure.reason,
  } as const;
}

function isoNow(): string {
  return new Date().toISOString();
}

function setRuntimeConnecting(environmentId: EnvironmentId) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connecting",
    lastError: null,
    lastErrorAt: null,
  });
}

function setRuntimeConnected(environmentId: EnvironmentId) {
  const connectedAt = isoNow();
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connected",
    authState: "authenticated",
    connectedAt,
    disconnectedAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  useSavedEnvironmentRegistryStore.getState().markConnected(environmentId, connectedAt);
}

function setRuntimeDisconnected(environmentId: EnvironmentId, reason?: string | null) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "disconnected",
    disconnectedAt: isoNow(),
    ...(reason && reason.trim().length > 0
      ? {
          lastError: reason,
          lastErrorAt: isoNow(),
        }
      : {}),
  });
}

function setRuntimeAuthFailure(environmentId: EnvironmentId, error: unknown) {
  const authState =
    isRemoteEnvironmentAuthHttpError(error) && error.status === 403 ? "blocked" : "requires-auth";
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    authState,
    role: null,
    connectionState: "disconnected",
    disconnectedAt: isoNow(),
    ...getRuntimeErrorFields(error),
  });
}

function setRuntimeError(environmentId: EnvironmentId, error: unknown) {
  if (isRemoteEnvironmentAuthHttpError(error) && isRemoteAuthBlockedStatus(error.status)) {
    setRuntimeAuthFailure(environmentId, error);
    return;
  }

  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "error",
    ...getRuntimeErrorFields(error),
  });
}

function setRuntimeSyncFailure(
  environmentId: EnvironmentId,
  failure: EnvironmentDomainSyncFailure,
) {
  useSavedEnvironmentRuntimeStore
    .getState()
    .patch(environmentId, getRuntimeSyncErrorFields(failure));
}

function getSyncFailureDomain(
  reason: string | null,
): "projection" | "shell" | "managed-process" | "thread" | null {
  switch (reason) {
    case "projection-replay-failed":
    case "projection-snapshot-failed":
      return "projection";
    case "shell-event-failed":
    case "shell-snapshot-failed":
      return "shell";
    case "managed-process-snapshot-failed":
      return "managed-process";
    case "thread-snapshot-failed":
      return "thread";
    default:
      return null;
  }
}

function clearRuntimeSyncFailure(
  environmentId: EnvironmentId,
  reason: EnvironmentDomainSyncFailureReason,
) {
  const runtime = getSavedEnvironmentRuntimeState(environmentId);
  if (runtime.syncState === "ok") {
    return;
  }
  if (getSyncFailureDomain(runtime.lastSyncFailureReason) !== getSyncFailureDomain(reason)) {
    return;
  }

  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    syncState: "ok",
    lastSyncError: null,
    lastSyncErrorAt: null,
    lastSyncFailureReason: null,
  });
}

function createSavedEnvironmentRuntimeStatusOwner(environmentId: EnvironmentId) {
  return {
    connecting: () => {
      setRuntimeConnecting(environmentId);
    },
    connected: () => {
      setRuntimeConnected(environmentId);
    },
    disconnected: (reason?: string | null) => {
      setRuntimeDisconnected(environmentId, reason);
    },
    failed: (error: unknown) => {
      setRuntimeError(environmentId, error);
    },
    syncFailed: (failure: EnvironmentDomainSyncFailure) => {
      setRuntimeSyncFailure(environmentId, failure);
    },
    syncSucceeded: (reason: EnvironmentDomainSyncFailureReason) => {
      clearRuntimeSyncFailure(environmentId, reason);
    },
  };
}

type SavedEnvironmentRuntimeStatusOwner = ReturnType<
  typeof createSavedEnvironmentRuntimeStatusOwner
>;

function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments: event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }

    coalesced.push(event);
  }

  return coalesced;
}

function reconcileSnapshotDerivedState() {
  const storeState = useStore.getState();
  const threads = selectThreadsAcrossEnvironments(storeState);
  const projects = selectProjectsAcrossEnvironments(storeState);

  useUiStateStore.getState().syncProjects(
    projects.map((project) => ({
      key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      cwd: project.cwd,
    })),
  );
  useUiStateStore.getState().syncThreads(
    threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    })),
  );
  markPromotedDraftThreadsByRef(
    threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
  );

  const activeThreadKeys = collectActiveTerminalThreadIds({
    snapshotThreads: threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      deletedAt: null,
      archivedAt: thread.archivedAt,
    })),
    draftThreadKeys: useComposerDraftStore.getState().listDraftThreadKeys(),
  });
  useTerminalStateStore.getState().removeOrphanedTerminalStates(activeThreadKeys);
}

export function shouldApplyTerminalEvent(input: {
  serverThreadArchivedAt: string | null | undefined;
  hasDraftThread: boolean;
}): boolean {
  if (input.serverThreadArchivedAt !== undefined) {
    return input.serverThreadArchivedAt === null;
  }

  return input.hasDraftThread;
}

function applyRecoveredEventBatch(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
) {
  if (events.length === 0) {
    return;
  }

  const batchEffects = deriveOrchestrationBatchEffects(events);
  const uiEvents = coalesceOrchestrationUiEvents(events);
  const needsProjectUiSync = events.some(
    (event) =>
      event.type === "project.created" ||
      event.type === "project.meta-updated" ||
      event.type === "project.deleted",
  );

  if (batchEffects.needsProviderInvalidation) {
    needsProviderInvalidation = true;
    void activeService?.queryInvalidationThrottler.maybeExecute();
  }

  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
  if (needsProjectUiSync) {
    const projects = selectProjectsAcrossEnvironments(useStore.getState());
    useUiStateStore.getState().syncProjects(
      projects.map((project) => ({
        key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        cwd: project.cwd,
      })),
    );
  }

  const needsThreadUiSync = events.some(
    (event) => event.type === "thread.created" || event.type === "thread.deleted",
  );
  if (needsThreadUiSync) {
    const threads = selectThreadsAcrossEnvironments(useStore.getState());
    useUiStateStore.getState().syncThreads(
      threads.map((thread) => ({
        key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        seedVisitedAt: thread.updatedAt ?? thread.createdAt,
      })),
    );
  }

  const draftStore = useComposerDraftStore.getState();
  for (const threadId of batchEffects.promoteDraftThreadIds) {
    markPromotedDraftThreadByRef(scopeThreadRef(environmentId, threadId));
  }
  for (const threadId of batchEffects.clearDeletedThreadIds) {
    draftStore.clearDraftThread(scopeThreadRef(environmentId, threadId));
    useUiStateStore
      .getState()
      .clearThreadUi(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  }
  for (const event of events) {
    if (event.type === "project.deleted") {
      draftStore.clearProjectDraftThreadId(scopeProjectRef(environmentId, event.payload.projectId));
    }
  }
  for (const threadId of batchEffects.removeTerminalStateThreadIds) {
    useTerminalStateStore.getState().removeTerminalState(scopeThreadRef(environmentId, threadId));
  }
}

function applyShellEvent(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) {
  if (
    !shouldApplyProjectionEvent({
      current: readLastAppliedProjectionVersion(environmentId),
      sequence: event.sequence,
    })
  ) {
    return;
  }

  const threadId =
    event.kind === "thread-upserted"
      ? event.thread.id
      : event.kind === "thread-removed"
        ? event.threadId
        : null;
  const threadRef = threadId ? scopeThreadRef(environmentId, threadId) : null;
  const previousThread = threadRef ? selectThreadByRef(useStore.getState(), threadRef) : undefined;

  useStore.getState().applyShellEvent(event, environmentId);
  markAppliedProjectionEvent(environmentId, event.sequence);

  switch (event.kind) {
    case "thread-upserted":
      if (!previousThread && threadRef) {
        markPromotedDraftThreadByRef(threadRef);
      }
      reconcileSnapshotDerivedState();
      return;
    case "thread-removed":
      if (threadRef) {
        useComposerDraftStore.getState().clearDraftThread(threadRef);
        useUiStateStore.getState().clearThreadUi(scopedThreadKey(threadRef));
        useTerminalStateStore.getState().removeTerminalState(threadRef);
      }
      reconcileSnapshotDerivedState();
      return;
    default:
      reconcileSnapshotDerivedState();
      return;
  }
}

function createEnvironmentConnectionHandlers() {
  return {
    syncShellSnapshot: (snapshot: OrchestrationShellSnapshot, environmentId: EnvironmentId) => {
      if (
        !shouldApplyProjectionSnapshot({
          current: readLastAppliedProjectionVersion(environmentId),
          next: snapshot,
        })
      ) {
        return;
      }
      useStore.getState().syncServerShellSnapshot(snapshot, environmentId);
      markAppliedProjectionSnapshot(environmentId, snapshot);
      reconcileSnapshotDerivedState();
    },
    syncManagedProcessSnapshot: (
      snapshot: OrchestrationManagedProcessSnapshot,
      environmentId: EnvironmentId,
    ) => {
      useStore.getState().syncServerManagedProcessSnapshot(snapshot, environmentId);
      reconcileSnapshotDerivedState();
    },
    applyShellEvent,
    applyEventBatch: (events: ReadonlyArray<OrchestrationEvent>, environmentId: EnvironmentId) => {
      const filtered = events.filter((event) =>
        shouldApplyProjectionEvent({
          current: readLastAppliedProjectionVersion(environmentId),
          sequence: event.sequence,
        }),
      );
      if (filtered.length === 0) return;
      applyRecoveredEventBatch(filtered, environmentId);
      const lastSequence = filtered[filtered.length - 1]?.sequence;
      if (typeof lastSequence === "number") {
        markAppliedProjectionEvent(environmentId, lastSequence);
      }
    },
    syncSnapshot: (
      snapshot: OrchestrationBootstrapSnapshot | OrchestrationReadModel,
      environmentId: EnvironmentId,
      detailLevel: "bootstrap" | "full",
    ) => {
      if (
        !shouldApplyProjectionSnapshot({
          current: readLastAppliedProjectionVersion(environmentId),
          next: snapshot,
        })
      ) {
        return;
      }
      const store = useStore.getState();
      if (detailLevel === "bootstrap") {
        store.syncServerBootstrapSnapshot(
          snapshot as OrchestrationBootstrapSnapshot,
          environmentId,
        );
      } else {
        store.syncServerReadModel(snapshot as OrchestrationReadModel, environmentId);
        store.setEnvironmentThreadDetailsHydrated(environmentId, true);
      }
      markAppliedProjectionSnapshot(environmentId, snapshot);
      reconcileSnapshotDerivedState();
    },
    applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => {
      const threadRef = scopeThreadRef(environmentId, ThreadId.make(event.threadId));
      const isTmuxEvent = event.threadId.startsWith("tmux:");
      const isGlobalTerminalEvent = isGlobalTerminalThreadId(event.threadId);
      if (!isTmuxEvent && !isGlobalTerminalEvent) {
        const serverThread = selectThreadByRef(useStore.getState(), threadRef);
        const hasDraftThread =
          useComposerDraftStore.getState().getDraftThreadByRef(threadRef) !== null;
        if (
          !shouldApplyTerminalEvent({
            serverThreadArchivedAt: serverThread?.archivedAt,
            hasDraftThread,
          })
        ) {
          return;
        }
      }
      useActionRunStore.getState().applyTerminalEvent(event, environmentId);
      useTerminalStateStore.getState().applyTerminalEvent(threadRef, event);
    },
  };
}

function createPrimaryEnvironmentClient(
  knownEnvironment: ReturnType<typeof getPrimaryKnownEnvironment>,
) {
  const wsBaseUrl = getKnownEnvironmentWsBaseUrl(knownEnvironment);
  if (!wsBaseUrl) {
    throw new Error(
      `Unable to resolve websocket URL for ${knownEnvironment?.label ?? "primary environment"}.`,
    );
  }

  return createWsRpcClient(new WsTransport(() => resolvePrimaryWebSocketConnectionUrl(wsBaseUrl)));
}

function createSavedEnvironmentClient(
  record: SavedEnvironmentRecord,
  bearerToken: string,
  statusOwner: SavedEnvironmentRuntimeStatusOwner,
): WsRpcClient {
  useSavedEnvironmentRuntimeStore.getState().ensure(record.environmentId);

  return createWsRpcClient(
    new WsTransport(
      () =>
        resolveRemoteWebSocketConnectionUrl({
          wsBaseUrl: record.wsBaseUrl,
          httpBaseUrl: record.httpBaseUrl,
          bearerToken,
        }),
      {
        reportGlobalStatus: false,
        onAttempt: () => {
          statusOwner.connecting();
        },
        onError: (message: string) => {
          statusOwner.failed(new Error(message));
        },
        onClose: (details: { readonly code: number; readonly reason: string }) => {
          statusOwner.disconnected(details.reason);
        },
      },
    ),
  );
}

export async function refreshSavedEnvironmentMetadata(
  record: SavedEnvironmentRecord,
  bearerToken: string,
  client: WsRpcClient,
  roleHint?: AuthSessionRole | null,
  configHint?: ServerConfig | null,
  statusOwner = createSavedEnvironmentRuntimeStatusOwner(record.environmentId),
): Promise<void> {
  const [serverConfig, sessionState] = await Promise.all([
    configHint ? Promise.resolve(configHint) : client.server.getConfig(),
    fetchRemoteSessionState({
      httpBaseUrl: record.httpBaseUrl,
      bearerToken,
    }),
  ]);

  useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
    authState: sessionState.authenticated ? "authenticated" : "requires-auth",
    descriptor: serverConfig.environment,
    serverConfig,
    role: sessionState.authenticated ? (sessionState.role ?? roleHint ?? null) : null,
  });
  if (sessionState.authenticated) {
    statusOwner.connected();
  } else {
    statusOwner.disconnected();
  }
}

function registerConnection(connection: EnvironmentConnection): EnvironmentConnection {
  const existing = environmentConnections.get(connection.environmentId);
  if (existing && existing !== connection) {
    throw new Error(`Environment ${connection.environmentId} already has an active connection.`);
  }
  environmentConnections.set(connection.environmentId, connection);
  emitEnvironmentConnectionRegistryChange();
  return connection;
}

async function removeConnection(environmentId: EnvironmentId): Promise<boolean> {
  const connection = environmentConnections.get(environmentId);
  if (!connection) {
    return false;
  }

  lastAppliedProjectionVersionByEnvironment.delete(environmentId);
  environmentConnections.delete(environmentId);
  emitEnvironmentConnectionRegistryChange();
  await connection.dispose();
  return true;
}

function createPrimaryEnvironmentConnection(): EnvironmentConnection {
  const knownEnvironment = getPrimaryKnownEnvironment();
  if (!knownEnvironment?.environmentId) {
    throw new Error("Unable to resolve the primary environment.");
  }

  const existing = environmentConnections.get(knownEnvironment.environmentId);
  if (existing) {
    return existing;
  }

  return registerConnection(
    createEnvironmentConnection({
      kind: "primary",
      knownEnvironment,
      client: createPrimaryEnvironmentClient(knownEnvironment),
      onConfigSnapshot: setServerConfigSnapshot,
      onWelcome: emitWelcome,
      ...createEnvironmentConnectionHandlers(),
    }),
  );
}

async function ensureSavedEnvironmentConnection(
  record: SavedEnvironmentRecord,
  options?: {
    readonly client?: WsRpcClient;
    readonly bearerToken?: string;
    readonly role?: AuthSessionRole | null;
    readonly serverConfig?: ServerConfig | null;
  },
): Promise<EnvironmentConnection> {
  const existing = environmentConnections.get(record.environmentId);
  if (existing) {
    return existing;
  }

  const bearerToken =
    options?.bearerToken ?? (await readSavedEnvironmentBearerToken(record.environmentId));
  if (!bearerToken) {
    useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
      authState: "requires-auth",
      role: null,
      connectionState: "disconnected",
      lastError: "Saved environment is missing its saved credential. Pair it again.",
      lastErrorAt: isoNow(),
    });
    throw new Error("Saved environment is missing its saved credential.");
  }

  const statusOwner = createSavedEnvironmentRuntimeStatusOwner(record.environmentId);
  const client = options?.client ?? createSavedEnvironmentClient(record, bearerToken, statusOwner);
  const knownEnvironment = createKnownEnvironment({
    id: record.environmentId,
    label: record.label,
    source: "manual",
    target: {
      httpBaseUrl: record.httpBaseUrl,
      wsBaseUrl: record.wsBaseUrl,
    },
  });
  const connection = createEnvironmentConnection({
    kind: "saved",
    knownEnvironment: {
      ...knownEnvironment,
      environmentId: record.environmentId,
    },
    client,
    refreshMetadata: async () => {
      await refreshSavedEnvironmentMetadata(record, bearerToken, client, null, null, statusOwner);
    },
    onDomainSyncFailure: statusOwner.syncFailed,
    onDomainSyncSuccess: statusOwner.syncSucceeded,
    onConfigSnapshot: (config) => {
      useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
        descriptor: config.environment,
        serverConfig: config,
      });
    },
    onWelcome: (payload) => {
      useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
        descriptor: payload.environment,
      });
    },
    ...createEnvironmentConnectionHandlers(),
  });

  registerConnection(connection);

  try {
    await refreshSavedEnvironmentMetadata(
      record,
      bearerToken,
      client,
      options?.role ?? null,
      options?.serverConfig ?? null,
      statusOwner,
    );
    return connection;
  } catch (error) {
    statusOwner.failed(error);
    await removeConnection(record.environmentId).catch(() => false);
    throw error;
  }
}

async function syncSavedEnvironmentConnections(
  records: ReadonlyArray<SavedEnvironmentRecord>,
): Promise<void> {
  const expectedEnvironmentIds = new Set(records.map((record) => record.environmentId));
  const staleEnvironmentIds = [...environmentConnections.values()]
    .filter((connection) => connection.kind === "saved")
    .map((connection) => connection.environmentId)
    .filter((environmentId) => !expectedEnvironmentIds.has(environmentId));

  await Promise.all(
    staleEnvironmentIds.map((environmentId) => disconnectSavedEnvironment(environmentId)),
  );
  await Promise.all(
    records.map((record) => ensureSavedEnvironmentConnection(record).catch(() => undefined)),
  );
}

function stopActiveService() {
  activeService?.stop();
  activeService = null;
}

function reconnectEnvironmentConnectionsAfterBrowserResume(reason: string): void {
  if (rendererUnloading) {
    return;
  }

  const now = Date.now();
  if (now - lastBrowserResumeReconnectAt < BROWSER_RESUME_RECONNECT_COOLDOWN_MS) {
    return;
  }
  if (browserResumeReconnectSweep) {
    return;
  }

  const reconnectRequests = [...environmentConnections.values()].map(async (connection) => {
    try {
      return await connection.requestReconnect("browser-resume");
    } catch (error) {
      console.warn("Environment reconnect after browser resume failed", {
        environmentId: connection.environmentId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  });

  const reconnectSweep = Promise.all(reconnectRequests)
    .then((results) => {
      if (results.some(Boolean)) {
        lastBrowserResumeReconnectAt = now;
      }
    })
    .finally(() => {
      if (browserResumeReconnectSweep === reconnectSweep) {
        browserResumeReconnectSweep = null;
      }
    });
  browserResumeReconnectSweep = reconnectSweep;
}

function subscribeBrowserResumeReconnects(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return NOOP;
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      lastBrowserHiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === "visible" && lastBrowserHiddenAt !== null) {
      const hiddenDurationMs = Date.now() - lastBrowserHiddenAt;
      lastBrowserHiddenAt = null;
      if (hiddenDurationMs < BROWSER_RESUME_MIN_HIDDEN_MS) {
        return;
      }
      reconnectEnvironmentConnectionsAfterBrowserResume("visibilitychange");
    }
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      return;
    }
    lastBrowserHiddenAt = null;
    reconnectEnvironmentConnectionsAfterBrowserResume("pageshow");
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handlePageShow);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);
  };
}

function disposeEnvironmentConnectionsForRendererUnload(reason: string): void {
  if (rendererUnloading) {
    return;
  }
  rendererUnloading = true;
  stopActiveService();

  const connections = [...environmentConnections.values()];
  environmentConnections.clear();
  lastAppliedProjectionVersionByEnvironment.clear();
  threadSnapshotHydrationInFlight.clear();
  emitEnvironmentConnectionRegistryChange();

  for (const connection of connections) {
    void connection.dispose().catch((error) => {
      console.warn("Environment connection dispose during renderer unload failed", {
        environmentId: connection.environmentId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function subscribeRendererUnloadCleanup(): () => void {
  if (typeof window === "undefined") {
    return NOOP;
  }

  const handleBeforeUnload = () => {
    disposeEnvironmentConnectionsForRendererUnload("beforeunload");
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      return;
    }
    disposeEnvironmentConnectionsForRendererUnload("pagehide");
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pagehide", handlePageHide);
  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("pagehide", handlePageHide);
  };
}
export function subscribeEnvironmentConnections(listener: () => void): () => void {
  environmentConnectionListeners.add(listener);
  return () => {
    environmentConnectionListeners.delete(listener);
  };
}

export function listEnvironmentConnections(): ReadonlyArray<EnvironmentConnection> {
  return [...environmentConnections.values()];
}

export function readEnvironmentConnection(
  environmentId: EnvironmentId,
): EnvironmentConnection | null {
  return environmentConnections.get(environmentId) ?? null;
}

export function requireEnvironmentConnection(environmentId: EnvironmentId): EnvironmentConnection {
  const connection = readEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`No websocket client registered for environment ${environmentId}.`);
  }
  return connection;
}

export function getPrimaryEnvironmentConnection(): EnvironmentConnection {
  return createPrimaryEnvironmentConnection();
}

export function withEnvironmentClient<T>(
  environmentId: EnvironmentId,
  operation: (client: WsRpcClient, connection: EnvironmentConnection) => T | Promise<T>,
): Promise<T> {
  const connection = requireEnvironmentConnection(environmentId);
  return Promise.resolve(operation(connection.client, connection));
}

export function withPrimaryEnvironmentClient<T>(
  operation: (client: WsRpcClient, connection: EnvironmentConnection) => T | Promise<T>,
): Promise<T> {
  const connection = getPrimaryEnvironmentConnection();
  return Promise.resolve(operation(connection.client, connection));
}

export async function disconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const connection = environmentConnections.get(environmentId);
  if (connection?.kind !== "saved") {
    return;
  }

  useSavedEnvironmentRuntimeStore.getState().clear(environmentId);
  await removeConnection(environmentId).catch(() => false);
}

export async function reconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const record = getSavedEnvironmentRecord(environmentId);
  if (!record) {
    throw new Error("Saved environment not found.");
  }

  const connection = environmentConnections.get(environmentId);
  if (!connection) {
    await ensureSavedEnvironmentConnection(record);
    return;
  }

  const statusOwner = createSavedEnvironmentRuntimeStatusOwner(environmentId);
  statusOwner.connecting();
  try {
    if (connection.kind === "saved") {
      await removeConnection(environmentId);
      const nextConnection = await ensureSavedEnvironmentConnection(record);
      await nextConnection.requestReconnect("user-retry");
      return;
    }
    await connection.requestReconnect("user-retry");
  } catch (error) {
    statusOwner.failed(error);
    throw error;
  }
}

export async function removeSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  useSavedEnvironmentRegistryStore.getState().remove(environmentId);
  await removeSavedEnvironmentBearerToken(environmentId);
  await disconnectSavedEnvironment(environmentId);
}

export async function addSavedEnvironment(input: {
  readonly label: string;
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}): Promise<SavedEnvironmentRecord> {
  const resolvedTarget = resolveRemotePairingTarget({
    ...(input.pairingUrl !== undefined ? { pairingUrl: input.pairingUrl } : {}),
    ...(input.host !== undefined ? { host: input.host } : {}),
    ...(input.pairingCode !== undefined ? { pairingCode: input.pairingCode } : {}),
  });
  const descriptor = await fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: resolvedTarget.httpBaseUrl,
  });
  const environmentId = descriptor.environmentId;

  if (environmentConnections.has(environmentId)) {
    throw new Error("This environment is already connected.");
  }

  const bearerSession = await bootstrapRemoteBearerSession({
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    credential: resolvedTarget.credential,
  });

  const record: SavedEnvironmentRecord = {
    environmentId,
    label: input.label.trim() || descriptor.label,
    wsBaseUrl: resolvedTarget.wsBaseUrl,
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    createdAt: isoNow(),
    lastConnectedAt: isoNow(),
  };

  await persistSavedEnvironmentRecord(record);
  const didPersistBearerToken = await writeSavedEnvironmentBearerToken(
    environmentId,
    bearerSession.sessionToken,
  );
  if (!didPersistBearerToken) {
    await ensureLocalApi().persistence.setSavedEnvironmentRegistry(
      listSavedEnvironmentRecords().map((entry) => ({
        environmentId: entry.environmentId,
        label: entry.label,
        httpBaseUrl: entry.httpBaseUrl,
        wsBaseUrl: entry.wsBaseUrl,
        createdAt: entry.createdAt,
        lastConnectedAt: entry.lastConnectedAt,
      })),
    );
    throw new Error("Unable to persist saved environment credentials.");
  }
  await ensureSavedEnvironmentConnection(record, {
    bearerToken: bearerSession.sessionToken,
    role: bearerSession.role,
  });
  useSavedEnvironmentRegistryStore.getState().upsert(record);
  return record;
}

export async function ensureEnvironmentConnectionBootstrapped(
  environmentId: EnvironmentId,
): Promise<void> {
  await environmentConnections.get(environmentId)?.ensureBootstrapped();
}

export async function hydrateEnvironmentThreadSnapshot(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): Promise<void> {
  const key = `${input.environmentId}:${input.threadId}`;
  const existing = threadSnapshotHydrationInFlight.get(key);
  if (existing) {
    return existing;
  }

  const next = withEnvironmentClient(input.environmentId, async (client, connection) => {
    const thread = await client.orchestration.getThreadSnapshot({ threadId: input.threadId });
    return { thread, kind: connection.kind };
  })
    .then(({ thread, kind }) => {
      if (thread === null) {
        return;
      }
      try {
        useStore.getState().syncThreadSnapshot(thread, input.environmentId);
        if (kind === "saved") {
          clearRuntimeSyncFailure(input.environmentId, "thread-snapshot-failed");
        }
      } catch (error) {
        if (kind === "saved") {
          setRuntimeSyncFailure(input.environmentId, {
            reason: "thread-snapshot-failed",
            error,
          });
          return;
        }
        throw error;
      }
    })
    .finally(() => {
      if (threadSnapshotHydrationInFlight.get(key) === next) {
        threadSnapshotHydrationInFlight.delete(key);
      }
    });

  threadSnapshotHydrationInFlight.set(key, next);
  return next;
}

export function startEnvironmentConnectionService(queryClient: QueryClient): () => void {
  if (activeService?.queryClient === queryClient) {
    activeService.refCount += 1;
    return () => {
      if (!activeService || activeService.queryClient !== queryClient) {
        return;
      }
      activeService.refCount -= 1;
      if (activeService.refCount === 0) {
        stopActiveService();
      }
    };
  }

  stopActiveService();
  needsProviderInvalidation = false;
  const queryInvalidationThrottler = new Throttler(
    () => {
      if (!needsProviderInvalidation) {
        return;
      }
      needsProviderInvalidation = false;
      void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    },
    {
      wait: 100,
      leading: false,
      trailing: true,
    },
  );

  createPrimaryEnvironmentConnection();

  const unsubscribeSavedEnvironments = useSavedEnvironmentRegistryStore.subscribe(() => {
    if (!hasSavedEnvironmentRegistryHydrated()) {
      return;
    }
    void syncSavedEnvironmentConnections(listSavedEnvironmentRecords());
  });

  void waitForSavedEnvironmentRegistryHydration()
    .then(() => syncSavedEnvironmentConnections(listSavedEnvironmentRecords()))
    .catch(() => undefined);
  const unsubscribeBrowserResumeReconnects = subscribeBrowserResumeReconnects();
  const unsubscribeRendererUnloadCleanup = subscribeRendererUnloadCleanup();

  activeService = {
    queryClient,
    queryInvalidationThrottler,
    refCount: 1,
    stop: () => {
      unsubscribeSavedEnvironments();
      unsubscribeBrowserResumeReconnects();
      unsubscribeRendererUnloadCleanup();
      queryInvalidationThrottler.cancel();
    },
  };

  return () => {
    if (!activeService || activeService.queryClient !== queryClient) {
      return;
    }
    activeService.refCount -= 1;
    if (activeService.refCount === 0) {
      stopActiveService();
    }
  };
}

export async function resetEnvironmentServiceForTests(): Promise<void> {
  stopActiveService();
  lastBrowserHiddenAt = null;
  lastBrowserResumeReconnectAt = Number.NEGATIVE_INFINITY;
  browserResumeReconnectSweep = null;
  rendererUnloading = false;
  lastAppliedProjectionVersionByEnvironment.clear();
  threadSnapshotHydrationInFlight.clear();
  await Promise.all(
    [...environmentConnections.keys()].map((environmentId) => removeConnection(environmentId)),
  );
}
