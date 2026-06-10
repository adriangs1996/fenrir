import {
  ModelSelection,
  ProviderSelectionKind,
  type ScopedThreadRef,
  type ServerProvider,
  ThreadId,
} from "@fenrir/contracts";
import { scopedThreadKey, scopeThreadRef } from "@fenrir/client-runtime";
import * as Equal from "effect/Equal";
import { useMemo } from "react";
import { ensureInlineTerminalContextPlaceholders } from "./modules/terminal";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { UnifiedSettings } from "@fenrir/contracts/settings";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  type ComposerDraftModelState,
  type ComposerDraftStoreState,
  type ComposerImageAttachment,
  type ComposerThreadDraftState,
  type ComposerThreadTarget,
  type DraftThreadState,
  DraftId,
  type EffectiveComposerModelState,
  EMPTY_COMPOSER_DRAFT_MODEL_STATE,
  EMPTY_THREAD_DRAFT,
  createEmptyThreadDraft,
  isRuntimeMode,
} from "./composerDraft/types";
import {
  deriveEffectiveComposerModelState,
  getDefaultModelForProvider,
  normalizeModelSelection,
  normalizeProviderInstanceId,
  normalizeProviderKind,
  normalizeProviderModelOptions,
  normalizeProviderSpecificModelOptions,
} from "./composerDraft/modelSelection";
import {
  composerImageDedupKey,
  createDraftThreadState,
  draftThreadsEqual,
  getComposerDraftState,
  isComposerThreadKeyInUse,
  isDraftThreadPromoting,
  logicalProjectDraftKey,
  normalizeTerminalContextForThread,
  normalizeTerminalContextsForThread,
  projectDraftKey,
  removeDraftThreadReferences,
  resolveComposerDraftKey,
  resolveComposerThreadId,
  revokeObjectPreviewUrl,
  scopedThreadRefsEqual,
  setComposerDraftPrompt,
  shouldRemoveDraft,
  terminalContextDedupKey,
  toProjectDraftSession,
} from "./composerDraft/draftState";
import {
  composerDebouncedStorage,
  migratePersistedComposerDraftStoreState,
  normalizeCurrentPersistedComposerDraftStoreState,
  partializeComposerDraftStoreState,
  toHydratedDraftThreadState,
  toHydratedThreadDraft,
  verifyPersistedAttachments,
} from "./composerDraft/persistence";

// Public API re-exports. The composer draft store internals live under
// ./composerDraft/ split by concern (types, model selection, draft state,
// persistence); existing call sites keep importing from this module.
export {
  COMPOSER_DRAFT_STORAGE_KEY,
  DraftId,
  PersistedComposerImageAttachment,
} from "./composerDraft/types";
export type {
  ComposerImageAttachment,
  ComposerThreadDraftState,
  DraftSessionState,
  DraftThreadEnvMode,
  DraftThreadState,
  EffectiveComposerModelState,
} from "./composerDraft/types";
export { deriveEffectiveComposerModelState } from "./composerDraft/modelSelection";

const composerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (setBase, get) => {
      const set = setBase;

      return {
        draftsByThreadKey: {},
        draftThreadsByThreadKey: {},
        logicalProjectDraftThreadKeyByLogicalProjectKey: {},
        stickyModelSelectionByProvider: {},
        stickyProviderInstanceIdByProvider: {},
        stickyActiveProvider: null,
        getComposerDraft: (target) => getComposerDraftState(get(), target),
        getDraftThreadByLogicalProjectKey: (logicalProjectKey) => {
          return get().getDraftSessionByLogicalProjectKey(logicalProjectKey);
        },
        getDraftSessionByLogicalProjectKey: (logicalProjectKey) => {
          const normalizedLogicalProjectKey = logicalProjectDraftKey(logicalProjectKey);
          if (normalizedLogicalProjectKey.length === 0) {
            return null;
          }
          const draftId =
            get().logicalProjectDraftThreadKeyByLogicalProjectKey[normalizedLogicalProjectKey];
          if (!draftId) {
            return null;
          }
          const draftThread = get().draftThreadsByThreadKey[draftId];
          if (!draftThread || isDraftThreadPromoting(draftThread)) {
            return null;
          }
          return toProjectDraftSession(DraftId.make(draftId), draftThread);
        },
        getDraftThreadByProjectRef: (projectRef) => {
          return get().getDraftSessionByProjectRef(projectRef);
        },
        getDraftSessionByProjectRef: (projectRef) => {
          for (const [draftId, draftThread] of Object.entries(get().draftThreadsByThreadKey)) {
            if (isDraftThreadPromoting(draftThread)) {
              continue;
            }
            if (
              draftThread.projectId === projectRef.projectId &&
              draftThread.environmentId === projectRef.environmentId
            ) {
              return toProjectDraftSession(DraftId.make(draftId), draftThread);
            }
          }
          return null;
        },
        getDraftSession: (draftId) => get().draftThreadsByThreadKey[draftId] ?? null,
        getDraftSessionByRef: (threadRef) => {
          for (const draftSession of Object.values(get().draftThreadsByThreadKey)) {
            if (
              draftSession.environmentId === threadRef.environmentId &&
              draftSession.threadId === threadRef.threadId
            ) {
              return draftSession;
            }
          }
          return null;
        },
        getDraftThread: (threadRef) => {
          if (typeof threadRef === "string") {
            return get().getDraftSession(DraftId.make(threadRef));
          }
          return get().getDraftSessionByRef(threadRef);
        },
        getDraftThreadByRef: (threadRef) => {
          return get().getDraftSessionByRef(threadRef);
        },
        listDraftThreadKeys: () =>
          Object.values(get().draftThreadsByThreadKey).map((draftThread) =>
            scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
          ),
        hasDraftThreadsInEnvironment: (environmentId) =>
          Object.values(get().draftThreadsByThreadKey).some(
            (draftThread) => draftThread.environmentId === environmentId,
          ),
        setLogicalProjectDraftThreadId: (logicalProjectKey, projectRef, draftId, options) => {
          const normalizedLogicalProjectKey = logicalProjectDraftKey(logicalProjectKey);
          if (normalizedLogicalProjectKey.length === 0 || draftId.length === 0) {
            return;
          }
          set((state) => {
            const existingThread = state.draftThreadsByThreadKey[draftId];
            const previousThreadKeyForLogicalProject =
              state.logicalProjectDraftThreadKeyByLogicalProjectKey[normalizedLogicalProjectKey];
            const nextDraftThread = createDraftThreadState(
              projectRef,
              options?.threadId ?? existingThread?.threadId ?? ThreadId.make(draftId),
              normalizedLogicalProjectKey,
              existingThread,
              options,
            );
            const hasSameLogicalMapping = previousThreadKeyForLogicalProject === draftId;
            const nextLogicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string> = {
              ...state.logicalProjectDraftThreadKeyByLogicalProjectKey,
              [normalizedLogicalProjectKey]: draftId,
            };
            const nextDraftThreadsByThreadKey: Record<string, DraftThreadState> = {
              ...state.draftThreadsByThreadKey,
              [draftId]: nextDraftThread,
            };
            let nextDraftsByThreadKey = state.draftsByThreadKey;
            const previousDraftThread =
              previousThreadKeyForLogicalProject === undefined
                ? undefined
                : nextDraftThreadsByThreadKey[previousThreadKeyForLogicalProject];
            if (
              previousThreadKeyForLogicalProject &&
              previousThreadKeyForLogicalProject !== draftId &&
              !isComposerThreadKeyInUse(
                nextLogicalProjectDraftThreadKeyByLogicalProjectKey,
                previousThreadKeyForLogicalProject,
              ) &&
              !isDraftThreadPromoting(previousDraftThread)
            ) {
              delete nextDraftThreadsByThreadKey[previousThreadKeyForLogicalProject];
              if (state.draftsByThreadKey[previousThreadKeyForLogicalProject] !== undefined) {
                nextDraftsByThreadKey = { ...state.draftsByThreadKey };
                delete nextDraftsByThreadKey[previousThreadKeyForLogicalProject];
              }
            }
            const promptUpdate = setComposerDraftPrompt(
              nextDraftsByThreadKey,
              draftId,
              options?.initialPrompt,
            );
            nextDraftsByThreadKey = promptUpdate.draftsByThreadKey;
            if (
              hasSameLogicalMapping &&
              draftThreadsEqual(existingThread, nextDraftThread) &&
              !promptUpdate.changed
            ) {
              return state;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: nextDraftThreadsByThreadKey,
              logicalProjectDraftThreadKeyByLogicalProjectKey:
                nextLogicalProjectDraftThreadKeyByLogicalProjectKey,
            };
          });
        },
        setProjectDraftThreadId: (projectRef, draftId, options) => {
          get().setLogicalProjectDraftThreadId(
            projectDraftKey(projectRef),
            projectRef,
            draftId,
            options,
          );
        },
        setDraftThreadContext: (threadRef, options) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!existing) {
              return state;
            }
            const nextProjectRef = options.projectRef ?? {
              environmentId: existing.environmentId,
              projectId: existing.projectId,
            };
            if (
              nextProjectRef.projectId.length === 0 ||
              nextProjectRef.environmentId.length === 0
            ) {
              return state;
            }
            const projectChanged =
              nextProjectRef.environmentId !== existing.environmentId ||
              nextProjectRef.projectId !== existing.projectId;
            const nextWorktreePath =
              options.worktreePath === undefined
                ? projectChanged
                  ? null
                  : existing.worktreePath
                : (options.worktreePath ?? null);
            const nextBranch =
              options.branch === undefined
                ? projectChanged
                  ? null
                  : existing.branch
                : (options.branch ?? null);
            const nextDraftThread: DraftThreadState = {
              threadId: existing.threadId,
              environmentId: nextProjectRef.environmentId,
              projectId: nextProjectRef.projectId,
              logicalProjectKey: existing.logicalProjectKey,
              createdAt:
                options.createdAt === undefined
                  ? existing.createdAt
                  : options.createdAt || existing.createdAt,
              runtimeMode: options.runtimeMode ?? existing.runtimeMode,
              interactionMode: options.interactionMode ?? existing.interactionMode,
              branch: nextBranch,
              worktreePath: nextWorktreePath,
              envMode:
                options.envMode ??
                (nextWorktreePath
                  ? "worktree"
                  : projectChanged
                    ? "local"
                    : (existing.envMode ?? "local")),
              promotedTo: existing.promotedTo ?? null,
            };
            const isUnchanged =
              nextDraftThread.environmentId === existing.environmentId &&
              nextDraftThread.projectId === existing.projectId &&
              nextDraftThread.logicalProjectKey === existing.logicalProjectKey &&
              nextDraftThread.createdAt === existing.createdAt &&
              nextDraftThread.runtimeMode === existing.runtimeMode &&
              nextDraftThread.interactionMode === existing.interactionMode &&
              nextDraftThread.branch === existing.branch &&
              nextDraftThread.worktreePath === existing.worktreePath &&
              nextDraftThread.envMode === existing.envMode &&
              scopedThreadRefsEqual(nextDraftThread.promotedTo, existing.promotedTo);
            if (isUnchanged) {
              return state;
            }
            return {
              draftThreadsByThreadKey: {
                ...state.draftThreadsByThreadKey,
                [threadKey]: nextDraftThread,
              },
            };
          });
        },
        clearProjectDraftThreadId: (projectRef) => {
          set((state) => {
            const matchingThreadEntry = Object.entries(state.draftThreadsByThreadKey).find(
              ([, draftThread]) =>
                draftThread.projectId === projectRef.projectId &&
                draftThread.environmentId === projectRef.environmentId,
            );
            if (!matchingThreadEntry) {
              return state;
            }
            return removeDraftThreadReferences(state, matchingThreadEntry[0]);
          });
        },
        clearProjectDraftThreadById: (projectRef, threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const draftThread = state.draftThreadsByThreadKey[threadKey];
            if (
              !draftThread ||
              draftThread.projectId !== projectRef.projectId ||
              draftThread.environmentId !== projectRef.environmentId
            ) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        markDraftThreadPromoting: (threadRef, promotedTo) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          if (!threadKey) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!existing) {
              return state;
            }
            const nextPromotedTo =
              promotedTo ?? scopeThreadRef(existing.environmentId, existing.threadId);
            if (scopedThreadRefsEqual(existing.promotedTo, nextPromotedTo)) {
              return state;
            }
            return {
              draftThreadsByThreadKey: {
                ...state.draftThreadsByThreadKey,
                [threadKey]: {
                  ...existing,
                  promotedTo: nextPromotedTo,
                },
              },
            };
          });
        },
        finalizePromotedDraftThread: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!isDraftThreadPromoting(existing)) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        clearDraftThread: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const hasDraftThread = state.draftThreadsByThreadKey[threadKey] !== undefined;
            const hasLogicalProjectMapping = Object.values(
              state.logicalProjectDraftThreadKeyByLogicalProjectKey,
            ).includes(threadKey);
            const hasComposerDraft = state.draftsByThreadKey[threadKey] !== undefined;
            if (!hasDraftThread && !hasLogicalProjectMapping && !hasComposerDraft) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        setStickyModelSelection: (modelSelection) => {
          const normalized = normalizeModelSelection(modelSelection);
          set((state) => {
            if (!normalized) {
              return state;
            }
            const nextMap: Partial<Record<ProviderSelectionKind, ModelSelection>> = {
              ...state.stickyModelSelectionByProvider,
              [normalized.provider]: normalized,
            };
            if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
              return state.stickyActiveProvider === normalized.provider
                ? state
                : { stickyActiveProvider: normalized.provider };
            }
            return {
              stickyModelSelectionByProvider: nextMap,
              stickyActiveProvider: normalized.provider,
            };
          });
        },
        setStickyProviderInstanceId: (provider, providerInstanceId) => {
          const normalizedProvider = normalizeProviderKind(provider);
          if (normalizedProvider === null) {
            return;
          }
          const normalizedInstanceId = normalizeProviderInstanceId(providerInstanceId);
          set((state) => {
            const nextMap = { ...state.stickyProviderInstanceIdByProvider };
            if (normalizedInstanceId === null) {
              delete nextMap[normalizedProvider];
            } else {
              nextMap[normalizedProvider] = normalizedInstanceId;
            }
            if (
              Equal.equals(state.stickyProviderInstanceIdByProvider, nextMap) &&
              state.stickyActiveProvider === normalizedProvider
            ) {
              return state;
            }
            return {
              stickyProviderInstanceIdByProvider: nextMap,
              stickyActiveProvider: normalizedProvider,
            };
          });
        },
        applyStickyState: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const stickyMap = state.stickyModelSelectionByProvider;
            const stickyProviderInstanceIdMap = state.stickyProviderInstanceIdByProvider;
            const stickyActiveProvider = state.stickyActiveProvider;
            if (
              Object.keys(stickyMap).length === 0 &&
              Object.keys(stickyProviderInstanceIdMap).length === 0 &&
              stickyActiveProvider === null
            ) {
              return state;
            }
            const existing = state.draftsByThreadKey[threadKey];
            const base = existing ?? createEmptyThreadDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            const nextProviderInstanceMap = { ...base.providerInstanceIdByProvider };
            for (const [provider, selection] of Object.entries(stickyMap)) {
              if (selection) {
                const normalizedProvider = provider as ProviderSelectionKind;
                const current = nextMap[normalizedProvider];
                nextMap[normalizedProvider] = {
                  ...selection,
                  model: current?.model ?? selection.model,
                };
              }
            }
            for (const [provider, instanceId] of Object.entries(stickyProviderInstanceIdMap)) {
              if (instanceId) {
                nextProviderInstanceMap[provider as ProviderSelectionKind] = instanceId;
              }
            }
            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              Equal.equals(base.providerInstanceIdByProvider, nextProviderInstanceMap) &&
              base.activeProvider === stickyActiveProvider
            ) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              providerInstanceIdByProvider: nextProviderInstanceMap,
              activeProvider: stickyActiveProvider,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setPrompt: (threadRef, prompt) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const nextDraft: ComposerThreadDraftState = {
              ...existing,
              prompt,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setTerminalContexts: (threadRef, contexts) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          const normalizedContexts = normalizeTerminalContextsForThread(threadId, contexts);
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const nextDraft: ComposerThreadDraftState = {
              ...existing,
              prompt: ensureInlineTerminalContextPlaceholders(
                existing.prompt,
                normalizedContexts.length,
              ),
              terminalContexts: normalizedContexts,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setModelSelection: (threadRef, modelSelection) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const normalized = normalizeModelSelection(modelSelection);
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            if (!existing && normalized === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            if (normalized) {
              const current = nextMap[normalized.provider];
              if (normalized.options !== undefined) {
                // Explicit options provided → use them
                nextMap[normalized.provider] = normalized;
              } else {
                // No options in selection → preserve existing options, update provider+model
                nextMap[normalized.provider] = {
                  provider: normalized.provider,
                  model: normalized.model,
                  ...(current?.options ? { options: current.options } : {}),
                };
              }
            }
            const nextActiveProvider = normalized?.provider ?? base.activeProvider;
            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              base.activeProvider === nextActiveProvider
            ) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              providerInstanceIdByProvider: base.providerInstanceIdByProvider,
              activeProvider: nextActiveProvider,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setModelOptions: (threadRef, modelOptions) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const normalizedOpts = normalizeProviderModelOptions(modelOptions);
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            if (!existing && normalizedOpts === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            const nextMap = { ...base.modelSelectionByProvider };
            for (const provider of ["codex", "claudeAgent"] as const) {
              // Only touch providers explicitly present in the input
              if (!normalizedOpts || !(provider in normalizedOpts)) continue;
              const opts = normalizedOpts[provider];
              const current = nextMap[provider];
              if (opts) {
                nextMap[provider] = {
                  provider,
                  model: current?.model ?? getDefaultModelForProvider(provider),
                  options: opts,
                };
              } else if (current?.options) {
                // Remove options but keep the selection
                const { options: _, ...rest } = current;
                nextMap[provider] = rest as ModelSelection;
              }
            }
            if (Equal.equals(base.modelSelectionByProvider, nextMap)) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              providerInstanceIdByProvider: base.providerInstanceIdByProvider,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setProviderModelOptions: (threadRef, provider, nextProviderOptions, options) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const normalizedProvider = normalizeProviderKind(provider);
          if (normalizedProvider === null) {
            return;
          }
          // Normalize just this provider's options
          const normalizedOpts = normalizeProviderSpecificModelOptions(
            normalizedProvider,
            nextProviderOptions,
          );
          const providerOpts = normalizedOpts?.[normalizedProvider];

          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            const base = existing ?? createEmptyThreadDraft();

            // Update the map entry for this provider
            const nextMap = { ...base.modelSelectionByProvider };
            const currentForProvider = nextMap[normalizedProvider];
            if (providerOpts) {
              const model =
                currentForProvider?.model ?? getDefaultModelForProvider(normalizedProvider);
              if (model.length === 0) {
                return state;
              }
              nextMap[normalizedProvider] = {
                provider: normalizedProvider,
                model,
                options: providerOpts,
              };
            } else if (currentForProvider?.options) {
              const { options: _, ...rest } = currentForProvider;
              nextMap[normalizedProvider] = rest as ModelSelection;
            }

            // Handle sticky persistence
            let nextStickyMap = state.stickyModelSelectionByProvider;
            let nextStickyProviderInstanceMap = state.stickyProviderInstanceIdByProvider;
            let nextStickyActiveProvider = state.stickyActiveProvider;
            if (options?.persistSticky === true) {
              nextStickyMap = { ...state.stickyModelSelectionByProvider };
              const stickyBase =
                nextStickyMap[normalizedProvider] ??
                base.modelSelectionByProvider[normalizedProvider] ??
                ({
                  provider: normalizedProvider,
                  model: getDefaultModelForProvider(normalizedProvider),
                } as ModelSelection);
              if (providerOpts) {
                if (stickyBase.model.length === 0) {
                  return state;
                }
                nextStickyMap[normalizedProvider] = {
                  ...stickyBase,
                  provider: normalizedProvider,
                  options: providerOpts,
                };
              } else if (stickyBase.options) {
                const { options: _, ...rest } = stickyBase;
                nextStickyMap[normalizedProvider] = rest as ModelSelection;
              }
              nextStickyActiveProvider = base.activeProvider ?? normalizedProvider;
              nextStickyProviderInstanceMap = { ...state.stickyProviderInstanceIdByProvider };
            }

            if (
              Equal.equals(base.modelSelectionByProvider, nextMap) &&
              Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
              Equal.equals(
                state.stickyProviderInstanceIdByProvider,
                nextStickyProviderInstanceMap,
              ) &&
              state.stickyActiveProvider === nextStickyActiveProvider
            ) {
              return state;
            }

            const nextDraft: ComposerThreadDraftState = {
              ...base,
              modelSelectionByProvider: nextMap,
              providerInstanceIdByProvider: base.providerInstanceIdByProvider,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }

            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              ...(options?.persistSticky === true
                ? {
                    stickyModelSelectionByProvider: nextStickyMap,
                    stickyProviderInstanceIdByProvider: nextStickyProviderInstanceMap,
                    stickyActiveProvider: nextStickyActiveProvider,
                  }
                : {}),
            };
          });
        },
        setProviderInstanceId: (threadRef, provider, providerInstanceId, options) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const normalizedProvider = normalizeProviderKind(provider);
          if (normalizedProvider === null) {
            return;
          }
          const normalizedInstanceId = normalizeProviderInstanceId(providerInstanceId);
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            const base = existing ?? createEmptyThreadDraft();
            const nextProviderInstanceMap = { ...base.providerInstanceIdByProvider };
            if (normalizedInstanceId === null) {
              delete nextProviderInstanceMap[normalizedProvider];
            } else {
              nextProviderInstanceMap[normalizedProvider] = normalizedInstanceId;
            }

            let nextStickyProviderInstanceMap = state.stickyProviderInstanceIdByProvider;
            let nextStickyActiveProvider = state.stickyActiveProvider;
            if (options?.persistSticky === true) {
              nextStickyProviderInstanceMap = { ...state.stickyProviderInstanceIdByProvider };
              if (normalizedInstanceId === null) {
                delete nextStickyProviderInstanceMap[normalizedProvider];
              } else {
                nextStickyProviderInstanceMap[normalizedProvider] = normalizedInstanceId;
              }
              nextStickyActiveProvider = base.activeProvider ?? normalizedProvider;
            }

            if (
              Equal.equals(base.providerInstanceIdByProvider, nextProviderInstanceMap) &&
              Equal.equals(
                state.stickyProviderInstanceIdByProvider,
                nextStickyProviderInstanceMap,
              ) &&
              state.stickyActiveProvider === nextStickyActiveProvider
            ) {
              return state;
            }

            const nextDraft: ComposerThreadDraftState = {
              ...base,
              providerInstanceIdByProvider: nextProviderInstanceMap,
              activeProvider: base.activeProvider ?? normalizedProvider,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }

            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              ...(options?.persistSticky === true
                ? {
                    stickyProviderInstanceIdByProvider: nextStickyProviderInstanceMap,
                    stickyActiveProvider: nextStickyActiveProvider,
                  }
                : {}),
            };
          });
        },
        setRuntimeMode: (threadRef, runtimeMode) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const nextRuntimeMode = isRuntimeMode(runtimeMode) ? runtimeMode : null;
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            if (!existing && nextRuntimeMode === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            if (base.runtimeMode === nextRuntimeMode) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              runtimeMode: nextRuntimeMode,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setInteractionMode: (threadRef, interactionMode) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const nextInteractionMode =
            interactionMode === "plan" || interactionMode === "default" ? interactionMode : null;
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            if (!existing && nextInteractionMode === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            if (base.interactionMode === nextInteractionMode) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              interactionMode: nextInteractionMode,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        setMcpServerIds: (threadRef, mcpServerIds) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const nextMcpServerIds =
            mcpServerIds === undefined || mcpServerIds === null ? null : [...mcpServerIds];
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            if (!existing && nextMcpServerIds === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            if (Equal.equals(base.mcpServerIds, nextMcpServerIds)) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              mcpServerIds: nextMcpServerIds,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        addImage: (threadRef, image) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          get().addImages(typeof threadRef === "string" ? DraftId.make(threadKey) : threadRef, [
            image,
          ]);
        },
        addImages: (threadRef, images) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0 || images.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const existingIds = new Set(existing.images.map((image) => image.id));
            const existingDedupKeys = new Set(
              existing.images.map((image) => composerImageDedupKey(image)),
            );
            const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
            const dedupedIncoming: ComposerImageAttachment[] = [];
            for (const image of images) {
              const dedupKey = composerImageDedupKey(image);
              if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
                // Avoid revoking a blob URL that's still referenced by an accepted image.
                if (!acceptedPreviewUrls.has(image.previewUrl)) {
                  revokeObjectPreviewUrl(image.previewUrl);
                }
                continue;
              }
              dedupedIncoming.push(image);
              existingIds.add(image.id);
              existingDedupKeys.add(dedupKey);
              acceptedPreviewUrls.add(image.previewUrl);
            }
            if (dedupedIncoming.length === 0) {
              return state;
            }
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: {
                  ...existing,
                  images: [...existing.images, ...dedupedIncoming],
                },
              },
            };
          });
        },
        removeImage: (threadRef, imageId) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const existing = get().draftsByThreadKey[threadKey];
          if (!existing) {
            return;
          }
          const removedImage = existing.images.find((image) => image.id === imageId);
          if (removedImage) {
            revokeObjectPreviewUrl(removedImage.previewUrl);
          }
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              images: current.images.filter((image) => image.id !== imageId),
              nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
              persistedAttachments: current.persistedAttachments.filter(
                (attachment) => attachment.id !== imageId,
              ),
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        insertTerminalContext: (threadRef, prompt, context, index) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return false;
          }
          let inserted = false;
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const normalizedContext = normalizeTerminalContextForThread(threadId, context);
            if (!normalizedContext) {
              return state;
            }
            const dedupKey = terminalContextDedupKey(normalizedContext);
            if (
              existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
              existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
            ) {
              return state;
            }
            inserted = true;
            const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
            const nextDraft: ComposerThreadDraftState = {
              ...existing,
              prompt,
              terminalContexts: [
                ...existing.terminalContexts.slice(0, boundedIndex),
                normalizedContext,
                ...existing.terminalContexts.slice(boundedIndex),
              ],
            };
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: nextDraft,
              },
            };
          });
          return inserted;
        },
        addTerminalContext: (threadRef, context) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          get().addTerminalContexts(
            typeof threadRef === "string" ? DraftId.make(threadKey) : threadRef,
            [context],
          );
        },
        addTerminalContexts: (threadRef, contexts) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId || contexts.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const acceptedContexts = normalizeTerminalContextsForThread(threadId, [
              ...existing.terminalContexts,
              ...contexts,
            ]).slice(existing.terminalContexts.length);
            if (acceptedContexts.length === 0) {
              return state;
            }
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: {
                  ...existing,
                  prompt: ensureInlineTerminalContextPlaceholders(
                    existing.prompt,
                    existing.terminalContexts.length + acceptedContexts.length,
                  ),
                  terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
                },
              },
            };
          });
        },
        removeTerminalContext: (threadRef, contextId) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0 || contextId.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              terminalContexts: current.terminalContexts.filter(
                (context) => context.id !== contextId,
              ),
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        clearTerminalContexts: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current || current.terminalContexts.length === 0) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              terminalContexts: [],
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        clearPersistedAttachments: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              persistedAttachments: [],
              nonPersistedImageIds: [],
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
        syncPersistedAttachments: (threadRef, attachments) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          if (!threadKey) {
            return;
          }
          const attachmentIdSet = new Set(attachments.map((attachment) => attachment.id));
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              // Stage attempted attachments so persist middleware can try writing them.
              persistedAttachments: attachments,
              nonPersistedImageIds: current.nonPersistedImageIds.filter(
                (id) => !attachmentIdSet.has(id),
              ),
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
          Promise.resolve().then(() => {
            verifyPersistedAttachments(threadKey, attachments, set);
          });
        },
        clearComposerContent: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              prompt: "",
              images: [],
              nonPersistedImageIds: [],
              persistedAttachments: [],
              terminalContexts: [],
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return { draftsByThreadKey: nextDraftsByThreadKey };
          });
        },
      };
    },
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: createJSONStorage(() => composerDebouncedStorage),
      migrate: migratePersistedComposerDraftStoreState,
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState) => {
        const normalizedPersisted =
          normalizeCurrentPersistedComposerDraftStoreState(persistedState);
        const draftsByThreadKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadKey).map(([threadKey, draft]) => [
            threadKey,
            toHydratedThreadDraft(draft),
          ]),
        );
        const draftThreadsByThreadKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftThreadsByThreadKey).map(
            ([threadKey, draftThread]) => [threadKey, toHydratedDraftThreadState(draftThread)],
          ),
        ) as Record<string, DraftThreadState>;
        return {
          ...currentState,
          draftsByThreadKey,
          draftThreadsByThreadKey,
          logicalProjectDraftThreadKeyByLogicalProjectKey:
            normalizedPersisted.logicalProjectDraftThreadKeyByLogicalProjectKey,
          stickyModelSelectionByProvider: normalizedPersisted.stickyModelSelectionByProvider ?? {},
          stickyProviderInstanceIdByProvider:
            normalizedPersisted.stickyProviderInstanceIdByProvider ?? {},
          stickyActiveProvider: normalizedPersisted.stickyActiveProvider ?? null,
        } as ComposerDraftStoreState;
      },
    },
  ),
);

export const useComposerDraftStore = composerDraftStore;

export function useComposerThreadDraft(threadRef: ComposerThreadTarget): ComposerThreadDraftState {
  return useComposerDraftStore((state) => {
    return getComposerDraftState(state, threadRef) ?? EMPTY_THREAD_DRAFT;
  });
}

export function useComposerDraftModelState(
  threadRef: ComposerThreadTarget,
): ComposerDraftModelState {
  return useComposerDraftStore(
    useShallow((state) => {
      const draft = getComposerDraftState(state, threadRef);
      return draft
        ? {
            activeProvider: draft.activeProvider,
            modelSelectionByProvider: draft.modelSelectionByProvider,
          }
        : EMPTY_COMPOSER_DRAFT_MODEL_STATE;
    }),
  );
}

export function useEffectiveComposerModelState(input: {
  threadRef?: ComposerThreadTarget;
  draftId?: DraftId;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderSelectionKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveComposerModelState {
  const draft = useComposerDraftModelState(input.threadRef ?? input.draftId ?? DraftId.make(""));

  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        providers: input.providers,
        selectedProvider: input.selectedProvider,
        threadModelSelection: input.threadModelSelection,
        projectModelSelection: input.projectModelSelection,
        settings: input.settings,
      }),
    [
      draft,
      input.providers,
      input.settings,
      input.projectModelSelection,
      input.selectedProvider,
      input.threadModelSelection,
    ],
  );
}

/**
 * Mark a draft thread as promoting once the server has materialized the same thread id.
 *
 * Use the single-thread helper for live `thread.created` events and the
 * iterable helper for bootstrap/recovery paths that discover multiple server
 * threads at once.
 */
export function markPromotedDraftThread(threadId: ThreadId): void {
  const store = useComposerDraftStore.getState();
  const draftThreadTargets: ComposerThreadTarget[] = [];
  for (const [draftId, draftThread] of Object.entries(store.draftThreadsByThreadKey)) {
    if (draftThread.threadId === threadId) {
      draftThreadTargets.push(DraftId.make(draftId));
    }
  }
  if (draftThreadTargets.length === 0) {
    return;
  }
  for (const draftThreadTarget of draftThreadTargets) {
    store.markDraftThreadPromoting(draftThreadTarget);
  }
}

export function markPromotedDraftThreadByRef(threadRef: ScopedThreadRef): void {
  const draftStore = useComposerDraftStore.getState();
  for (const [draftId, draftThread] of Object.entries(draftStore.draftThreadsByThreadKey)) {
    if (
      draftThread.environmentId === threadRef.environmentId &&
      draftThread.threadId === threadRef.threadId
    ) {
      draftStore.markDraftThreadPromoting(DraftId.make(draftId), threadRef);
    }
  }
}

export function markPromotedDraftThreads(serverThreadIds: Iterable<ThreadId>): void {
  for (const threadId of serverThreadIds) {
    markPromotedDraftThread(threadId);
  }
}

export function markPromotedDraftThreadsByRef(serverThreadRefs: Iterable<ScopedThreadRef>): void {
  for (const threadRef of serverThreadRefs) {
    markPromotedDraftThreadByRef(threadRef);
  }
}

export function finalizePromotedDraftThreadByRef(threadRef: ScopedThreadRef): void {
  const draftStore = useComposerDraftStore.getState();
  for (const [draftId, draftThread] of Object.entries(draftStore.draftThreadsByThreadKey)) {
    if (
      draftThread.promotedTo &&
      draftThread.promotedTo.environmentId === threadRef.environmentId &&
      draftThread.promotedTo.threadId === threadRef.threadId
    ) {
      draftStore.finalizePromotedDraftThread(DraftId.make(draftId));
    }
  }
}

export function finalizePromotedDraftThreadsByRef(
  serverThreadRefs: Iterable<ScopedThreadRef>,
): void {
  for (const threadRef of serverThreadRefs) {
    finalizePromotedDraftThreadByRef(threadRef);
  }
}
