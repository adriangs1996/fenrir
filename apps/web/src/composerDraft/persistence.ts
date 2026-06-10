import {
  type EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ProviderKind,
  ProviderModelOptions,
  ProviderSelectionKind,
  ThreadId,
} from "@fenrir/contracts";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@fenrir/client-runtime";
import * as Schema from "effect/Schema";
import { DeepMutable } from "effect/Types";
import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { ensureInlineTerminalContextPlaceholders } from "../modules/terminal";
import { createDebouncedStorage, createMemoryStorage } from "../lib/storage";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  type ComposerDraftStoreState,
  type ComposerImageAttachment,
  type ComposerThreadDraftState,
  type DraftThreadEnvMode,
  type DraftThreadState,
  EMPTY_PERSISTED_DRAFT_STORE_STATE,
  type PersistedComposerDraftStoreState,
  PersistedComposerDraftStoreStorage,
  type PersistedComposerImageAttachment,
  type PersistedComposerThreadDraftState,
  type PersistedDraftThreadState,
  type PersistedTerminalContextDraft,
  isRuntimeMode,
} from "./types";
import {
  type LegacyCodexFields,
  legacyMergeModelSelectionIntoProviderModelOptions,
  legacySyncModelSelectionOptions,
  legacyToModelSelectionByProvider,
  normalizeModelSelection,
  normalizeProviderInstanceIdByProvider,
  normalizeProviderKind,
  normalizeProviderModelOptions,
  normalizeProviderSelectionMap,
} from "./modelSelection";
import {
  composerThreadRefFromKey,
  normalizeLegacyComposerStorageKey,
  projectDraftKey,
  shouldRemoveDraft,
} from "./draftState";

const COMPOSER_PERSIST_DEBOUNCE_MS = 300;

export const composerDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS,
);

// Flush pending composer draft writes before page unload to prevent data loss.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    composerDebouncedStorage.flush();
  });
}

const LegacyThreadModelFields = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String),
  modelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
type LegacyThreadModelFields = typeof LegacyThreadModelFields.Type;

type LegacyV2ThreadDraftFields = {
  modelSelection?: ModelSelection | null;
  modelOptions?: ProviderModelOptions | null;
};

type LegacyPersistedComposerThreadDraftState = PersistedComposerThreadDraftState &
  LegacyCodexFields &
  LegacyThreadModelFields &
  LegacyV2ThreadDraftFields;

const LegacyStickyModelFields = Schema.Struct({
  stickyProvider: Schema.optionalKey(ProviderKind),
  stickyModel: Schema.optionalKey(Schema.String),
  stickyModelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
type LegacyStickyModelFields = typeof LegacyStickyModelFields.Type;

type LegacyV2StoreFields = {
  stickyModelSelection?: ModelSelection | null;
  stickyModelOptions?: ProviderModelOptions | null;
  projectDraftThreadIdByProjectId?: Record<string, string> | null;
  draftsByThreadId?: Record<string, PersistedComposerThreadDraftState> | null;
  draftThreadsByThreadId?: Record<string, PersistedDraftThreadState> | null;
  projectDraftThreadIdByProjectKey?: Record<string, string> | null;
  draftsByThreadKey?: Record<string, PersistedComposerThreadDraftState> | null;
  draftThreadsByThreadKey?: Record<string, PersistedDraftThreadState> | null;
  projectDraftThreadKeyByProjectKey?: Record<string, string> | null;
  logicalProjectDraftThreadKeyByLogicalProjectKey?: Record<string, string> | null;
};

type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields;

function normalizePersistedAttachment(value: unknown): PersistedComposerImageAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  const dataUrl = candidate.dataUrl;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    typeof dataUrl !== "string" ||
    id.length === 0 ||
    dataUrl.length === 0
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const threadId = candidate.threadId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart));
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd));
  return {
    id,
    threadId: threadId as ThreadId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  };
}

function normalizeDraftThreadEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftThreadEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

function normalizePersistedDraftThreads(
  rawDraftThreadsByThreadId: unknown,
  rawProjectDraftThreadIdByProjectKey: unknown,
): Pick<
  PersistedComposerDraftStoreState,
  "draftThreadsByThreadKey" | "logicalProjectDraftThreadKeyByLogicalProjectKey"
> {
  const draftThreadsByThreadKey: Record<string, PersistedDraftThreadState> = {};
  const environmentIdByThreadId = new Map<ThreadId, EnvironmentId>();
  if (
    rawProjectDraftThreadIdByProjectKey &&
    typeof rawProjectDraftThreadIdByProjectKey === "object"
  ) {
    for (const [projectKey, threadId] of Object.entries(
      rawProjectDraftThreadIdByProjectKey as Record<string, unknown>,
    )) {
      if (typeof threadId !== "string" || threadId.length === 0) {
        continue;
      }
      const projectRef = parseScopedProjectKey(projectKey);
      if (!projectRef) {
        continue;
      }
      const parsedThreadRef = parseScopedThreadKey(threadId);
      if (parsedThreadRef) {
        environmentIdByThreadId.set(parsedThreadRef.threadId, parsedThreadRef.environmentId);
        continue;
      }
      environmentIdByThreadId.set(threadId as ThreadId, projectRef.environmentId);
    }
  }
  if (rawDraftThreadsByThreadId && typeof rawDraftThreadsByThreadId === "object") {
    for (const [threadKeyOrId, rawDraftThread] of Object.entries(
      rawDraftThreadsByThreadId as Record<string, unknown>,
    )) {
      if (typeof threadKeyOrId !== "string" || threadKeyOrId.length === 0) {
        continue;
      }
      if (!rawDraftThread || typeof rawDraftThread !== "object") {
        continue;
      }
      const candidateDraftThread = rawDraftThread as Record<string, unknown>;
      const parsedThreadRef = parseScopedThreadKey(threadKeyOrId);
      const threadKey = normalizeLegacyComposerStorageKey(threadKeyOrId);
      const threadId =
        parsedThreadRef?.threadId ??
        (typeof candidateDraftThread.threadId === "string" &&
        candidateDraftThread.threadId.length > 0
          ? (candidateDraftThread.threadId as ThreadId)
          : (threadKeyOrId as ThreadId));
      const environmentId =
        parsedThreadRef?.environmentId ??
        (typeof candidateDraftThread.environmentId === "string" &&
        candidateDraftThread.environmentId.length > 0
          ? (candidateDraftThread.environmentId as EnvironmentId)
          : environmentIdByThreadId.get(threadKeyOrId as ThreadId));
      const projectId = candidateDraftThread.projectId;
      const createdAt = candidateDraftThread.createdAt;
      const branch = candidateDraftThread.branch;
      const worktreePath = candidateDraftThread.worktreePath;
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;
      const promotedToCandidate = candidateDraftThread.promotedTo;
      const promotedToRecord =
        promotedToCandidate && typeof promotedToCandidate === "object"
          ? (promotedToCandidate as Record<string, unknown>)
          : null;
      const promotedTo =
        promotedToRecord &&
        typeof promotedToRecord.environmentId === "string" &&
        promotedToRecord.environmentId.length > 0 &&
        typeof promotedToRecord.threadId === "string" &&
        promotedToRecord.threadId.length > 0
          ? scopeThreadRef(
              promotedToRecord.environmentId as EnvironmentId,
              promotedToRecord.threadId as ThreadId,
            )
          : null;
      if (typeof projectId !== "string" || projectId.length === 0 || environmentId === undefined) {
        continue;
      }
      const normalizedEnvironmentId = environmentId as EnvironmentId;
      draftThreadsByThreadKey[threadKey] = {
        threadId,
        environmentId: normalizedEnvironmentId,
        projectId: projectId as ProjectId,
        logicalProjectKey:
          typeof candidateDraftThread.logicalProjectKey === "string" &&
          candidateDraftThread.logicalProjectKey.length > 0
            ? candidateDraftThread.logicalProjectKey
            : parsedThreadRef
              ? projectDraftKey(scopeProjectRef(normalizedEnvironmentId, projectId as ProjectId))
              : threadKeyOrId,
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        runtimeMode: isRuntimeMode(candidateDraftThread.runtimeMode)
          ? candidateDraftThread.runtimeMode
          : DEFAULT_RUNTIME_MODE,
        interactionMode:
          candidateDraftThread.interactionMode === "plan" ||
          candidateDraftThread.interactionMode === "default"
            ? candidateDraftThread.interactionMode
            : DEFAULT_INTERACTION_MODE,
        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        envMode: normalizeDraftThreadEnvMode(candidateDraftThread.envMode, normalizedWorktreePath),
        promotedTo,
      };
    }
  }

  const logicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string> = {};
  if (
    rawProjectDraftThreadIdByProjectKey &&
    typeof rawProjectDraftThreadIdByProjectKey === "object"
  ) {
    for (const [logicalProjectKey, threadKeyOrId] of Object.entries(
      rawProjectDraftThreadIdByProjectKey as Record<string, unknown>,
    )) {
      if (typeof threadKeyOrId !== "string" || threadKeyOrId.length === 0) {
        continue;
      }
      const projectRef = parseScopedProjectKey(logicalProjectKey);
      const parsedThreadRef = parseScopedThreadKey(threadKeyOrId);
      const threadKey = normalizeLegacyComposerStorageKey(threadKeyOrId);
      logicalProjectDraftThreadKeyByLogicalProjectKey[logicalProjectKey] = threadKey;
      if (parsedThreadRef) {
        environmentIdByThreadId.set(parsedThreadRef.threadId, parsedThreadRef.environmentId);
      }
      if (!projectRef) {
        const existingDraftThread = draftThreadsByThreadKey[threadKey];
        if (existingDraftThread && !existingDraftThread.logicalProjectKey) {
          draftThreadsByThreadKey[threadKey] = {
            ...existingDraftThread,
            logicalProjectKey,
          };
        }
        continue;
      }
      if (!draftThreadsByThreadKey[threadKey]) {
        draftThreadsByThreadKey[threadKey] = {
          threadId: parsedThreadRef?.threadId ?? (threadKey as ThreadId),
          environmentId: projectRef.environmentId,
          projectId: projectRef.projectId,
          logicalProjectKey,
          createdAt: new Date().toISOString(),
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          envMode: "local",
          promotedTo: null,
        };
      } else if (
        draftThreadsByThreadKey[threadKey]?.projectId !== projectRef.projectId ||
        draftThreadsByThreadKey[threadKey]?.environmentId !== projectRef.environmentId
      ) {
        draftThreadsByThreadKey[threadKey] = {
          ...draftThreadsByThreadKey[threadKey]!,
          threadId: draftThreadsByThreadKey[threadKey]!.threadId,
          environmentId: projectRef.environmentId,
          projectId: projectRef.projectId,
          logicalProjectKey,
        };
      }
    }
  }

  return { draftThreadsByThreadKey, logicalProjectDraftThreadKeyByLogicalProjectKey };
}

function normalizePersistedDraftsByThreadId(
  rawDraftMap: unknown,
  draftThreadsByThreadKey: PersistedComposerDraftStoreState["draftThreadsByThreadKey"],
): PersistedComposerDraftStoreState["draftsByThreadKey"] {
  if (!rawDraftMap || typeof rawDraftMap !== "object") {
    return {};
  }

  const environmentIdByThreadId = new Map<ThreadId, EnvironmentId>();
  for (const [threadKey, draftThread] of Object.entries(draftThreadsByThreadKey)) {
    const parsedThreadRef = composerThreadRefFromKey(threadKey);
    if (!parsedThreadRef) {
      continue;
    }
    environmentIdByThreadId.set(
      parsedThreadRef.threadId,
      draftThread.environmentId as EnvironmentId,
    );
  }

  const nextDraftsByThreadKey: DeepMutable<PersistedComposerDraftStoreState["draftsByThreadKey"]> =
    {};
  for (const [threadKeyOrId, draftValue] of Object.entries(
    rawDraftMap as Record<string, unknown>,
  )) {
    if (typeof threadKeyOrId !== "string" || threadKeyOrId.length === 0) {
      continue;
    }
    if (!draftValue || typeof draftValue !== "object") {
      continue;
    }
    const draftCandidate = draftValue as PersistedComposerThreadDraftState;
    const promptCandidate = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    const attachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizePersistedAttachment(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
      ? draftCandidate.terminalContexts.flatMap((entry) => {
          const normalized = normalizePersistedTerminalContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const runtimeMode = isRuntimeMode(draftCandidate.runtimeMode)
      ? draftCandidate.runtimeMode
      : null;
    const interactionMode =
      draftCandidate.interactionMode === "plan" || draftCandidate.interactionMode === "default"
        ? draftCandidate.interactionMode
        : null;
    const prompt = ensureInlineTerminalContextPlaceholders(
      promptCandidate,
      terminalContexts.length,
    );
    // If the draft already has the v3 shape, use it directly
    const legacyDraftCandidate = draftValue as LegacyPersistedComposerThreadDraftState;
    let modelSelectionByProvider: Partial<Record<ProviderSelectionKind, ModelSelection>> = {};
    let providerInstanceIdByProvider: Partial<Record<ProviderSelectionKind, ProviderInstanceId>> =
      {};
    let activeProvider: ProviderSelectionKind | null = null;

    if (
      draftCandidate.modelSelectionByProvider &&
      typeof draftCandidate.modelSelectionByProvider === "object"
    ) {
      // v3 format
      modelSelectionByProvider = normalizeProviderSelectionMap(
        draftCandidate.modelSelectionByProvider,
      );
      providerInstanceIdByProvider = normalizeProviderInstanceIdByProvider(
        draftCandidate.providerInstanceIdByProvider,
      );
      activeProvider = normalizeProviderKind(draftCandidate.activeProvider);
    } else {
      // v2 or legacy format: migrate
      const normalizedModelOptions =
        normalizeProviderModelOptions(
          legacyDraftCandidate.modelOptions,
          undefined,
          legacyDraftCandidate,
        ) ?? null;
      const normalizedModelSelection = normalizeModelSelection(
        legacyDraftCandidate.modelSelection,
        {
          provider: legacyDraftCandidate.provider,
          model: legacyDraftCandidate.model,
          modelOptions: normalizedModelOptions ?? legacyDraftCandidate.modelOptions,
          legacyCodex: legacyDraftCandidate,
        },
      );
      const mergedModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
        normalizedModelSelection,
        normalizedModelOptions,
      );
      const modelSelection = legacySyncModelSelectionOptions(
        normalizedModelSelection,
        mergedModelOptions,
      );
      modelSelectionByProvider = legacyToModelSelectionByProvider(
        modelSelection,
        mergedModelOptions,
      );
      activeProvider = modelSelection?.provider ?? null;
    }

    const hasModelData =
      Object.keys(modelSelectionByProvider).length > 0 ||
      Object.keys(providerInstanceIdByProvider).length > 0 ||
      activeProvider !== null;
    if (
      promptCandidate.length === 0 &&
      attachments.length === 0 &&
      terminalContexts.length === 0 &&
      !hasModelData &&
      !runtimeMode &&
      !interactionMode
    ) {
      continue;
    }
    const parsedThreadRef = parseScopedThreadKey(threadKeyOrId);
    const normalizedThreadKey =
      parsedThreadRef !== null
        ? normalizeLegacyComposerStorageKey(threadKeyOrId)
        : draftThreadsByThreadKey[threadKeyOrId] !== undefined
          ? threadKeyOrId
          : (() => {
              const environmentId = environmentIdByThreadId.get(threadKeyOrId as ThreadId);
              return environmentId
                ? normalizeLegacyComposerStorageKey(threadKeyOrId, { environmentId })
                : threadKeyOrId;
            })();
    const migratedDraft = {
      prompt,
      attachments: [...attachments],
      ...(terminalContexts.length > 0 ? { terminalContexts: [...terminalContexts] } : {}),
      ...(hasModelData
        ? { modelSelectionByProvider, providerInstanceIdByProvider, activeProvider }
        : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(interactionMode ? { interactionMode } : {}),
    } as PersistedComposerThreadDraftState;
    nextDraftsByThreadKey[normalizedThreadKey] = migratedDraft as any;
  }

  return nextDraftsByThreadKey;
}

export function migratePersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const candidate = persistedState as LegacyPersistedComposerDraftStoreState;
  const rawDraftMap = candidate.draftsByThreadKey ?? candidate.draftsByThreadId;
  const rawDraftThreadsByThreadId =
    candidate.draftThreadsByThreadKey ?? candidate.draftThreadsByThreadId;
  const rawProjectDraftThreadIdByProjectKey =
    candidate.logicalProjectDraftThreadKeyByLogicalProjectKey ??
    candidate.projectDraftThreadKeyByProjectKey ??
    candidate.projectDraftThreadIdByProjectKey ??
    candidate.projectDraftThreadIdByProjectId;

  // Migrate sticky state from v2 (dual) to v3 (consolidated)
  const stickyModelOptions = normalizeProviderModelOptions(candidate.stickyModelOptions) ?? {};
  const normalizedStickyModelSelection = normalizeModelSelection(candidate.stickyModelSelection, {
    provider: candidate.stickyProvider ?? "codex",
    model: candidate.stickyModel,
    modelOptions: stickyModelOptions,
  });
  const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
    normalizedStickyModelSelection,
    stickyModelOptions,
  );
  const stickyModelSelection = legacySyncModelSelectionOptions(
    normalizedStickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
    stickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyActiveProvider = normalizeProviderKind(candidate.stickyProvider) ?? null;

  const { draftThreadsByThreadKey, logicalProjectDraftThreadKeyByLogicalProjectKey } =
    normalizePersistedDraftThreads(rawDraftThreadsByThreadId, rawProjectDraftThreadIdByProjectKey);
  const draftsByThreadKey = normalizePersistedDraftsByThreadId(
    rawDraftMap,
    draftThreadsByThreadKey,
  );
  return {
    draftsByThreadKey,
    draftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey,
    stickyModelSelectionByProvider,
    stickyProviderInstanceIdByProvider: {},
    stickyActiveProvider,
  } as PersistedComposerDraftStoreState;
}

export function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState,
): PersistedComposerDraftStoreState {
  const persistedDraftsByThreadKey: DeepMutable<
    PersistedComposerDraftStoreState["draftsByThreadKey"]
  > = {};
  for (const [threadKey, draft] of Object.entries(state.draftsByThreadKey)) {
    if (typeof threadKey !== "string" || threadKey.length === 0) {
      continue;
    }
    const hasModelData =
      Object.keys(draft.modelSelectionByProvider).length > 0 ||
      Object.keys(draft.providerInstanceIdByProvider).length > 0 ||
      draft.activeProvider !== null;
    if (
      draft.prompt.length === 0 &&
      draft.persistedAttachments.length === 0 &&
      draft.terminalContexts.length === 0 &&
      !hasModelData &&
      draft.runtimeMode === null &&
      draft.interactionMode === null &&
      draft.mcpServerIds === null
    ) {
      continue;
    }
    const persistedDraft = {
      prompt: draft.prompt,
      attachments: draft.persistedAttachments,
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((context) => ({
              id: context.id,
              threadId: context.threadId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: draft.modelSelectionByProvider,
            providerInstanceIdByProvider: draft.providerInstanceIdByProvider,
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
      ...(draft.mcpServerIds !== null ? { mcpServerIds: draft.mcpServerIds } : {}),
    } as DeepMutable<PersistedComposerThreadDraftState>;
    persistedDraftsByThreadKey[threadKey] = persistedDraft;
  }
  return {
    draftsByThreadKey: persistedDraftsByThreadKey,
    draftThreadsByThreadKey: state.draftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey:
      state.logicalProjectDraftThreadKeyByLogicalProjectKey,
    stickyModelSelectionByProvider: state.stickyModelSelectionByProvider,
    stickyProviderInstanceIdByProvider: state.stickyProviderInstanceIdByProvider,
    stickyActiveProvider: state.stickyActiveProvider,
  } as PersistedComposerDraftStoreState;
}

export function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const normalizedPersistedState = persistedState as LegacyPersistedComposerDraftStoreState;
  const { draftThreadsByThreadKey, logicalProjectDraftThreadKeyByLogicalProjectKey } =
    normalizePersistedDraftThreads(
      normalizedPersistedState.draftThreadsByThreadKey ??
        normalizedPersistedState.draftThreadsByThreadId,
      normalizedPersistedState.logicalProjectDraftThreadKeyByLogicalProjectKey ??
        normalizedPersistedState.projectDraftThreadKeyByProjectKey ??
        normalizedPersistedState.projectDraftThreadIdByProjectKey ??
        normalizedPersistedState.projectDraftThreadIdByProjectId,
    );

  // Handle both v3 (modelSelectionByProvider) and v2/legacy formats
  let stickyModelSelectionByProvider: Partial<Record<ProviderSelectionKind, ModelSelection>> = {};
  let stickyProviderInstanceIdByProvider: Partial<
    Record<ProviderSelectionKind, ProviderInstanceId>
  > = {};
  let stickyActiveProvider: ProviderSelectionKind | null = null;
  if (
    normalizedPersistedState.stickyModelSelectionByProvider &&
    typeof normalizedPersistedState.stickyModelSelectionByProvider === "object"
  ) {
    stickyModelSelectionByProvider = normalizeProviderSelectionMap(
      normalizedPersistedState.stickyModelSelectionByProvider,
    );
    stickyProviderInstanceIdByProvider = normalizeProviderInstanceIdByProvider(
      normalizedPersistedState.stickyProviderInstanceIdByProvider,
    );
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyActiveProvider);
  } else {
    // Legacy migration path
    const stickyModelOptions =
      normalizeProviderModelOptions(normalizedPersistedState.stickyModelOptions) ?? {};
    const normalizedStickyModelSelection = normalizeModelSelection(
      normalizedPersistedState.stickyModelSelection,
      {
        provider: normalizedPersistedState.stickyProvider,
        model: normalizedPersistedState.stickyModel,
        modelOptions: stickyModelOptions,
      },
    );
    const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
      normalizedStickyModelSelection,
      stickyModelOptions,
    );
    const stickyModelSelection = legacySyncModelSelectionOptions(
      normalizedStickyModelSelection,
      nextStickyModelOptions,
    );
    stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
      stickyModelSelection,
      nextStickyModelOptions,
    );
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyProvider);
  }

  return {
    draftsByThreadKey: normalizePersistedDraftsByThreadId(
      normalizedPersistedState.draftsByThreadKey ?? normalizedPersistedState.draftsByThreadId,
      draftThreadsByThreadKey,
    ),
    draftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey,
    stickyModelSelectionByProvider,
    stickyProviderInstanceIdByProvider,
    stickyActiveProvider,
  } as PersistedComposerDraftStoreState;
}

function readPersistedAttachmentIdsFromStorage(threadKey: string): string[] {
  if (threadKey.length === 0) {
    return [];
  }
  try {
    const persisted = getLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      PersistedComposerDraftStoreStorage,
    );
    if (!persisted || persisted.version !== COMPOSER_DRAFT_STORAGE_VERSION) {
      return [];
    }
    return (persisted.state.draftsByThreadKey[threadKey]?.attachments ?? []).map(
      (attachment) => attachment.id,
    );
  } catch {
    return [];
  }
}

export function verifyPersistedAttachments(
  threadKey: string,
  attachments: PersistedComposerImageAttachment[],
  set: (
    partial:
      | ComposerDraftStoreState
      | Partial<ComposerDraftStoreState>
      | ((
          state: ComposerDraftStoreState,
        ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
    replace?: false,
  ) => void,
): void {
  let persistedIdSet = new Set<string>();
  try {
    composerDebouncedStorage.flush();
    persistedIdSet = new Set(readPersistedAttachmentIdsFromStorage(threadKey));
  } catch {
    persistedIdSet = new Set();
  }
  set((state) => {
    const current = state.draftsByThreadKey[threadKey];
    if (!current) {
      return state;
    }
    const imageIdSet = new Set(current.images.map((image) => image.id));
    const persistedAttachments = attachments.filter(
      (attachment) => imageIdSet.has(attachment.id) && persistedIdSet.has(attachment.id),
    );
    const nonPersistedImageIds = current.images
      .map((image) => image.id)
      .filter((imageId) => !persistedIdSet.has(imageId));
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      persistedAttachments,
      nonPersistedImageIds,
    };
    const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
    if (shouldRemoveDraft(nextDraft)) {
      delete nextDraftsByThreadKey[threadKey];
    } else {
      nextDraftsByThreadKey[threadKey] = nextDraft;
    }
    return { draftsByThreadKey: nextDraftsByThreadKey };
  });
}

function hydratePersistedComposerImageAttachment(
  attachment: PersistedComposerImageAttachment,
): File | null {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex);
  const payload = commaIndex === -1 ? "" : attachment.dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    return null;
  }
  try {
    const isBase64 = header.includes(";base64");
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload);
      const inferredMimeType =
        header.startsWith("data:") && header.includes(";")
          ? header.slice("data:".length, header.indexOf(";"))
          : attachment.mimeType;
      return new File([decodedText], attachment.name, {
        type: inferredMimeType || attachment.mimeType,
      });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], attachment.name, { type: attachment.mimeType });
  } catch {
    return null;
  }
}

function hydrateImagesFromPersisted(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): ComposerImageAttachment[] {
  return attachments.flatMap((attachment) => {
    const file = hydratePersistedComposerImageAttachment(attachment);
    if (!file) return [];

    return [
      {
        type: "image" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: attachment.dataUrl,
        file,
      } satisfies ComposerImageAttachment,
    ];
  });
}

export function toHydratedThreadDraft(
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  // The persisted draft is already in v3 shape (migration handles older formats)
  const modelSelectionByProvider = normalizeProviderSelectionMap(
    persistedDraft.modelSelectionByProvider,
  );
  const providerInstanceIdByProvider = normalizeProviderInstanceIdByProvider(
    persistedDraft.providerInstanceIdByProvider,
  );
  const activeProvider = normalizeProviderKind(persistedDraft.activeProvider) ?? null;

  return {
    prompt: persistedDraft.prompt,
    images: hydrateImagesFromPersisted(persistedDraft.attachments),
    nonPersistedImageIds: [],
    persistedAttachments: [...persistedDraft.attachments],
    terminalContexts:
      persistedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    modelSelectionByProvider,
    providerInstanceIdByProvider,
    activeProvider,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
    mcpServerIds: persistedDraft.mcpServerIds ? [...persistedDraft.mcpServerIds] : null,
  };
}

export function toHydratedDraftThreadState(
  persistedDraftThread: PersistedDraftThreadState,
): DraftThreadState {
  return {
    threadId: persistedDraftThread.threadId,
    environmentId: persistedDraftThread.environmentId as EnvironmentId,
    projectId: persistedDraftThread.projectId,
    logicalProjectKey:
      persistedDraftThread.logicalProjectKey ??
      projectDraftKey(
        scopeProjectRef(
          persistedDraftThread.environmentId as EnvironmentId,
          persistedDraftThread.projectId,
        ),
      ),
    createdAt: persistedDraftThread.createdAt,
    runtimeMode: persistedDraftThread.runtimeMode,
    interactionMode: persistedDraftThread.interactionMode,
    branch: persistedDraftThread.branch,
    worktreePath: persistedDraftThread.worktreePath,
    envMode: persistedDraftThread.envMode,
    promotedTo: persistedDraftThread.promotedTo
      ? scopeThreadRef(
          persistedDraftThread.promotedTo.environmentId as EnvironmentId,
          persistedDraftThread.promotedTo.threadId as ThreadId,
        )
      : null,
  };
}
