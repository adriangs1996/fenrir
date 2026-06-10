import {
  type EnvironmentId,
  McpServerId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  ProviderInstanceId,
  ProviderSelectionKind,
  ProviderModelOptions,
  ProviderOptionSelections,
  RuntimeMode,
  type ScopedProjectRef,
  type ScopedThreadRef,
  ThreadId,
} from "@fenrir/contracts";
import * as Schema from "effect/Schema";
import { type ChatImageAttachment } from "../types";
import { type TerminalContextDraft } from "../modules/terminal";

export const COMPOSER_DRAFT_STORAGE_KEY = "fenrir:composer-drafts:v1";
export const COMPOSER_DRAFT_STORAGE_VERSION = 6;
export const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);
export const isRuntimeMode = Schema.is(RuntimeMode);
export type DraftThreadEnvMode = typeof DraftThreadEnvModeSchema.Type;

export const DraftId = Schema.String.pipe(Schema.brand("DraftId"));
export type DraftId = typeof DraftId.Type;

export const PersistedComposerImageAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});
export type PersistedComposerImageAttachment = typeof PersistedComposerImageAttachment.Type;

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

export const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});
export type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

export const PersistedComposerThreadDraftState = Schema.Struct({
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  modelSelectionByProvider: Schema.optionalKey(Schema.Record(Schema.String, ModelSelection)),
  providerInstanceIdByProvider: Schema.optionalKey(
    Schema.Record(Schema.String, ProviderInstanceId),
  ),
  activeProvider: Schema.optionalKey(Schema.NullOr(Schema.String)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
  mcpServerIds: Schema.optionalKey(Schema.NullOr(Schema.Array(McpServerId))),
});
export type PersistedComposerThreadDraftState = typeof PersistedComposerThreadDraftState.Type;

export const PersistedDraftThreadState = Schema.Struct({
  threadId: ThreadId,
  environmentId: Schema.String,
  projectId: ProjectId,
  logicalProjectKey: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  envMode: DraftThreadEnvModeSchema,
  promotedTo: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        environmentId: Schema.String,
        threadId: Schema.String,
      }),
    ),
  ),
});
export type PersistedDraftThreadState = typeof PersistedDraftThreadState.Type;

export const PersistedComposerDraftStoreState = Schema.Struct({
  draftsByThreadKey: Schema.Record(Schema.String, PersistedComposerThreadDraftState),
  draftThreadsByThreadKey: Schema.Record(Schema.String, PersistedDraftThreadState),
  logicalProjectDraftThreadKeyByLogicalProjectKey: Schema.Record(Schema.String, Schema.String),
  stickyModelSelectionByProvider: Schema.optionalKey(Schema.Record(Schema.String, ModelSelection)),
  stickyProviderInstanceIdByProvider: Schema.optionalKey(
    Schema.Record(Schema.String, ProviderInstanceId),
  ),
  stickyActiveProvider: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;

export const PersistedComposerDraftStoreStorage = Schema.Struct({
  version: Schema.Number,
  state: PersistedComposerDraftStoreState,
});

/**
 * Composer content keyed by either a draft session (`DraftId`) or a real server
 * thread (`ScopedThreadRef`). This is the editable payload shown in the composer.
 */
export interface ComposerThreadDraftState {
  prompt: string;
  images: ComposerImageAttachment[];
  nonPersistedImageIds: string[];
  persistedAttachments: PersistedComposerImageAttachment[];
  terminalContexts: TerminalContextDraft[];
  modelSelectionByProvider: Partial<Record<ProviderSelectionKind, ModelSelection>>;
  providerInstanceIdByProvider: Partial<Record<ProviderSelectionKind, ProviderInstanceId>>;
  activeProvider: ProviderSelectionKind | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
  mcpServerIds: McpServerId[] | null;
}

/**
 * Mutable routing and execution context for a pre-thread draft session.
 *
 * Unlike a real server thread, a draft session can still change target
 * environment/worktree configuration before the first send.
 */
export interface DraftSessionState {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  logicalProjectKey: string;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
  promotedTo?: ScopedThreadRef | null;
  initialPrompt?: string;
}

export type DraftThreadState = DraftSessionState;

/**
 * Draft session metadata paired with its stable draft-session identity.
 */
export interface ProjectDraftSession extends DraftSessionState {
  draftId: DraftId;
}

/**
 * App-facing composer identity:
 * - `DraftId` for pre-thread draft sessions
 * - `ScopedThreadRef` for server-backed threads
 *
 * Raw `ThreadId` is intentionally excluded so callers cannot drop environment
 * identity for real threads.
 */
export type ComposerThreadTarget = ScopedThreadRef | DraftId;

/**
 * Persisted store for composer content plus draft-session metadata.
 *
 * The store intentionally models two domains:
 * - draft sessions keyed by `DraftId`
 * - server thread composer state keyed by `ScopedThreadRef`
 */
export interface ComposerDraftStoreState {
  draftsByThreadKey: Record<string, ComposerThreadDraftState>;
  draftThreadsByThreadKey: Record<string, DraftThreadState>;
  logicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string>;
  stickyModelSelectionByProvider: Partial<Record<ProviderSelectionKind, ModelSelection>>;
  stickyProviderInstanceIdByProvider: Partial<Record<ProviderSelectionKind, ProviderInstanceId>>;
  stickyActiveProvider: ProviderSelectionKind | null;
  /** Returns the editable composer content for a draft session or server thread. */
  getComposerDraft: (target: ComposerThreadTarget) => ComposerThreadDraftState | null;
  /** Looks up the active draft session for a logical project identity. */
  getDraftThreadByLogicalProjectKey: (logicalProjectKey: string) => ProjectDraftSession | null;
  getDraftSessionByLogicalProjectKey: (logicalProjectKey: string) => ProjectDraftSession | null;
  getDraftThreadByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  getDraftSessionByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  /** Reads mutable draft-session metadata by `DraftId`. */
  getDraftSession: (draftId: DraftId) => DraftSessionState | null;
  /** Resolves a server-thread ref back to a matching draft session when one exists. */
  getDraftSessionByRef: (threadRef: ScopedThreadRef) => DraftSessionState | null;
  getDraftThreadByRef: (threadRef: ScopedThreadRef) => DraftThreadState | null;
  getDraftThread: (threadRef: ComposerThreadTarget) => DraftThreadState | null;
  listDraftThreadKeys: () => string[];
  hasDraftThreadsInEnvironment: (environmentId: EnvironmentId) => boolean;
  /** Creates or updates the draft session tracked for a logical project. */
  setLogicalProjectDraftThreadId: (
    logicalProjectKey: string,
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      threadId?: ThreadId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      initialPrompt?: string;
    },
  ) => void;
  /** Creates or updates the draft session tracked for a concrete project ref. */
  setProjectDraftThreadId: (
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      threadId?: ThreadId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      initialPrompt?: string;
    },
  ) => void;
  /** Updates mutable draft-session metadata without touching composer content. */
  setDraftThreadContext: (
    threadRef: ComposerThreadTarget,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      projectRef?: ScopedProjectRef;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  clearProjectDraftThreadId: (projectRef: ScopedProjectRef) => void;
  clearProjectDraftThreadById: (
    projectRef: ScopedProjectRef,
    threadRef: ComposerThreadTarget,
  ) => void;
  /** Marks a draft session as being promoted to a real server thread. */
  markDraftThreadPromoting: (threadRef: ComposerThreadTarget, promotedTo?: ScopedThreadRef) => void;
  /** Removes draft-session metadata after promotion is complete. */
  finalizePromotedDraftThread: (threadRef: ComposerThreadTarget) => void;
  clearDraftThread: (threadRef: ComposerThreadTarget) => void;
  setStickyModelSelection: (modelSelection: ModelSelection | null | undefined) => void;
  setStickyProviderInstanceId: (
    provider: ProviderSelectionKind,
    providerInstanceId: ProviderInstanceId | null | undefined,
  ) => void;
  setPrompt: (threadRef: ComposerThreadTarget, prompt: string) => void;
  setTerminalContexts: (threadRef: ComposerThreadTarget, contexts: TerminalContextDraft[]) => void;
  setModelSelection: (
    threadRef: ComposerThreadTarget,
    modelSelection: ModelSelection | null | undefined,
  ) => void;
  setModelOptions: (
    threadRef: ComposerThreadTarget,
    modelOptions: ProviderModelOptions | null | undefined,
  ) => void;
  applyStickyState: (threadRef: ComposerThreadTarget) => void;
  setProviderModelOptions: (
    threadRef: ComposerThreadTarget,
    provider: ProviderSelectionKind,
    nextProviderOptions: ProviderOptionSelections | null | undefined,
    options?: {
      persistSticky?: boolean;
    },
  ) => void;
  setProviderInstanceId: (
    threadRef: ComposerThreadTarget,
    provider: ProviderSelectionKind,
    providerInstanceId: ProviderInstanceId | null | undefined,
    options?: {
      persistSticky?: boolean;
    },
  ) => void;
  setRuntimeMode: (
    threadRef: ComposerThreadTarget,
    runtimeMode: RuntimeMode | null | undefined,
  ) => void;
  setInteractionMode: (
    threadRef: ComposerThreadTarget,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  setMcpServerIds: (
    threadRef: ComposerThreadTarget,
    mcpServerIds: ReadonlyArray<McpServerId> | null | undefined,
  ) => void;
  addImage: (threadRef: ComposerThreadTarget, image: ComposerImageAttachment) => void;
  addImages: (threadRef: ComposerThreadTarget, images: ComposerImageAttachment[]) => void;
  removeImage: (threadRef: ComposerThreadTarget, imageId: string) => void;
  insertTerminalContext: (
    threadRef: ComposerThreadTarget,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  addTerminalContext: (threadRef: ComposerThreadTarget, context: TerminalContextDraft) => void;
  addTerminalContexts: (threadRef: ComposerThreadTarget, contexts: TerminalContextDraft[]) => void;
  removeTerminalContext: (threadRef: ComposerThreadTarget, contextId: string) => void;
  clearTerminalContexts: (threadRef: ComposerThreadTarget) => void;
  clearPersistedAttachments: (threadRef: ComposerThreadTarget) => void;
  syncPersistedAttachments: (
    threadRef: ComposerThreadTarget,
    attachments: PersistedComposerImageAttachment[],
  ) => void;
  clearComposerContent: (threadRef: ComposerThreadTarget) => void;
}

export interface EffectiveComposerModelState {
  selectedModel: string;
  modelOptions: ProviderModelOptions | null;
}

export interface ComposerDraftModelState {
  activeProvider: ProviderSelectionKind | null;
  modelSelectionByProvider: Partial<Record<ProviderSelectionKind, ModelSelection>>;
}

export const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsByThreadKey: {},
  draftThreadsByThreadKey: {},
  logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  stickyModelSelectionByProvider: {},
  stickyProviderInstanceIdByProvider: {},
  stickyActiveProvider: null,
});

const EMPTY_IMAGES: ComposerImageAttachment[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_PERSISTED_ATTACHMENTS: PersistedComposerImageAttachment[] = [];
const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENTS);
export const EMPTY_MODEL_SELECTION_BY_PROVIDER: Partial<
  Record<ProviderSelectionKind, ModelSelection>
> = Object.freeze({});
const EMPTY_PROVIDER_INSTANCE_ID_BY_PROVIDER: Partial<
  Record<ProviderSelectionKind, ProviderInstanceId>
> = Object.freeze({});
export const EMPTY_COMPOSER_DRAFT_MODEL_STATE = Object.freeze<ComposerDraftModelState>({
  activeProvider: null,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
});

export const EMPTY_THREAD_DRAFT = Object.freeze<ComposerThreadDraftState>({
  prompt: "",
  images: EMPTY_IMAGES,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachments: EMPTY_PERSISTED_ATTACHMENTS,
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
  providerInstanceIdByProvider: EMPTY_PROVIDER_INSTANCE_ID_BY_PROVIDER,
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
  mcpServerIds: null,
});

export function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    modelSelectionByProvider: {},
    providerInstanceIdByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
    mcpServerIds: null,
  };
}
