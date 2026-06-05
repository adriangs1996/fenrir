import {
  type ApprovalRequestId,
  DEFAULT_MODEL_BY_PROVIDER,
  type ClaudeAgentEffort,
  type EnvironmentId,
  type McpServerId,
  type MessageId,
  type ModelSelection,
  type ProviderSelectionKind,
  type ProjectId,
  type ProviderApprovalDecision,
  type ServerProvider,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
} from "@fenrir/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@fenrir/client-runtime";
import { applyClaudePromptEffortPrefix } from "@fenrir/shared/model";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@fenrir/shared/projectScripts";
import { truncate } from "@fenrir/shared/String";
import { type LegendListRef } from "@legendapp/list/react";
import { Debouncer } from "@tanstack/react-pacer";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Equal } from "effect";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "~/lib/gitStatusState";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { readEnvironmentApi } from "../environmentApi";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { stripDiffSearchParams } from "../diffRouteSearch";
import {
  collapseExpandedComposerCursor,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  deriveCompletionDividerBeforeEntryId,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  deriveDisplayActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isActivePlanScopedToLatestTurn,
  isLatestTurnSettled,
  formatElapsed,
} from "../session-logic";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { useUiStateStore } from "../uiStateStore";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Thread,
  type TurnDiffSummary,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { useRightPanelStore } from "../rightPanelStore";
import { BranchToolbar } from "./BranchToolbar";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { RightPanelTabs } from "./chat/RightPanelTabs";
import ThreadTerminalDrawer from "~/modules/terminal/components/ThreadTerminalDrawer";
import { ChevronDownIcon } from "lucide-react";
import { cn, randomUUID } from "~/lib/utils";
import {
  DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME,
  DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
  shouldReserveDesktopTitlebarLeadingInset,
} from "~/lib/desktopTitleBar";
import { toastManager } from "./ui/toast";
import PlaceholderInputDialog from "./PlaceholderInputDialog";
import { globalScriptIdFromCommand, projectScriptIdFromCommand } from "~/projectScripts";
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import {
  getProviderModelCapabilities,
  getProviderSnapshot,
  resolveSelectableProvider,
} from "../providerModels";
import { getProviderMcpCompatibility } from "../mcp";
import { getSelectableMcpServers } from "@fenrir/shared/mcpBuiltIns";
import { useSettings } from "../hooks/useSettings";
import { resolveAppModelSelection } from "../modelSelection";
import { isTerminalFocused } from "~/modules/terminal";
import { deriveLogicalProjectKey } from "../logicalProject";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { buildDraftThreadRouteParams } from "../threadRoutes";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  selectThreadTerminalState,
  useTerminalStateStore,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "~/modules/terminal";
import {
  appendEditorContextsToPrompt,
  EditorPane,
  formatEditorContextLabel,
  useEditorStore,
} from "~/modules/neovim-editor";
import { resolveActiveEmbeddedEditor } from "~/modules/neovim-editor/embeddedEditor";
import { resolveTerminalCloseFocusTarget } from "~/modules/neovim-editor/focus";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { ManagedProcessStatusBar } from "./managedProcess/ManagedProcessStatusBar";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { ChatHeader } from "./chat/ChatHeader";
import { ActionRunCenter } from "./action-runs/ActionRunCenter";
import { type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveThreadState } from "./NoActiveThreadState";
import { resolveEffectiveEnvMode, resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import { ProviderStatusBanner } from "./chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import { useSidebar } from "./ui/sidebar";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  buildTemporaryWorktreeBranchName,
  closeTerminalWithFallback,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  cloneComposerImageForRetry,
  deriveLockedProvider,
  readFileAsDataUrl,
  reconcileMountedTerminalThreadIds,
  resolveSidePanelControlLabel,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  shouldWriteThreadErrorToCurrentServerThread,
  waitForStartedServerThread,
} from "./ChatView.logic";
import { useChatViewScripts } from "./chatView/useChatViewScripts";
import { type ChatViewTab, useChatViewTabs } from "./chatView/useChatViewTabs";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useServerConfig, useServerKeybindings } from "~/rpc/serverState";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { RightPanelSheet } from "./RightPanelSheet";
import { useComposerHandleContext } from "../composerHandleContext";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { parseThreadRouteSearch } from "~/threadRouteSearch";
import {
  selectActionRunReceiptsForThread,
  selectActionRunsForProject,
  useActionRunStore,
  type ActionRun,
} from "~/modules/action-runs";

const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
const LazyGitDiffWorkbench = lazy(() =>
  import("./gitdiff-workbench/GitDiffWorkbenchRoute").then((module) => ({
    default: module.GitDiffWorkbench,
  })),
);
const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROPOSED_PLANS: Thread["proposedPlans"] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const ACTION_RUN_OBSERVER_COLS = 120;
const ACTION_RUN_OBSERVER_ROWS = 30;

type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

function useThreadPlanCatalog(threadIds: readonly ThreadId[]): ThreadPlanCatalogEntry[] {
  return useStore(
    useMemo(() => {
      let previousThreadIds: readonly ThreadId[] = [];
      let previousResult: ThreadPlanCatalogEntry[] = [];
      let previousEntries = new Map<
        ThreadId,
        {
          shell: object | null;
          proposedPlanIds: readonly string[] | undefined;
          proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
          entry: ThreadPlanCatalogEntry;
        }
      >();

      return (state) => {
        const sameThreadIds =
          previousThreadIds.length === threadIds.length &&
          previousThreadIds.every((id, index) => id === threadIds[index]);
        const nextEntries = new Map<
          ThreadId,
          {
            shell: object | null;
            proposedPlanIds: readonly string[] | undefined;
            proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
            entry: ThreadPlanCatalogEntry;
          }
        >();
        const nextResult: ThreadPlanCatalogEntry[] = [];
        let changed = !sameThreadIds;

        for (const threadId of threadIds) {
          let shell: object | undefined;
          let proposedPlanIds: readonly string[] | undefined;
          let proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;

          for (const environmentState of Object.values(state.environmentStateById)) {
            const matchedShell = environmentState.threadShellById[threadId];
            if (!matchedShell) {
              continue;
            }
            shell = matchedShell;
            proposedPlanIds = environmentState.proposedPlanIdsByThreadId[threadId];
            proposedPlansById = environmentState.proposedPlanByThreadId[threadId] as
              | Record<string, Thread["proposedPlans"][number]>
              | undefined;
            break;
          }

          if (!shell) {
            const previous = previousEntries.get(threadId);
            if (
              previous &&
              previous.shell === null &&
              previous.proposedPlanIds === undefined &&
              previous.proposedPlansById === undefined
            ) {
              nextEntries.set(threadId, previous);
              continue;
            }
            changed = true;
            nextEntries.set(threadId, {
              shell: null,
              proposedPlanIds: undefined,
              proposedPlansById: undefined,
              entry: { id: threadId, proposedPlans: EMPTY_PROPOSED_PLANS },
            });
            continue;
          }

          const previous = previousEntries.get(threadId);
          if (
            previous &&
            previous.shell === shell &&
            previous.proposedPlanIds === proposedPlanIds &&
            previous.proposedPlansById === proposedPlansById
          ) {
            nextEntries.set(threadId, previous);
            nextResult.push(previous.entry);
            continue;
          }

          changed = true;
          const proposedPlans =
            proposedPlanIds && proposedPlanIds.length > 0 && proposedPlansById
              ? proposedPlanIds.flatMap((planId) => {
                  const proposedPlan = proposedPlansById?.[planId];
                  return proposedPlan ? [proposedPlan] : [];
                })
              : EMPTY_PROPOSED_PLANS;
          const entry = { id: threadId, proposedPlans };
          nextEntries.set(threadId, {
            shell,
            proposedPlanIds,
            proposedPlansById,
            entry,
          });
          nextResult.push(entry);
        }

        if (!changed && previousResult.length === nextResult.length) {
          return previousResult;
        }

        previousThreadIds = threadIds;
        previousEntries = nextEntries;
        previousResult = nextResult;
        return nextResult;
      };
    }, [threadIds]),
  );
}

function formatOutgoingPrompt(params: {
  provider: ProviderSelectionKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeAgentEffort | null);
  }
  return params.text;
}

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

type PersistentTerminalLaunchContext = Pick<TerminalLaunchContext, "cwd" | "worktreePath">;

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        if (current) {
          return current.preparingWorktree === preparingWorktree
            ? current
            : { ...current, preparingWorktree };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread],
  );

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        session: input.activeThread?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        threadError: input.threadError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.session,
      input.phase,
      input.threadError,
      localDispatch,
    ],
  );

  useEffect(() => {
    if (!serverAcknowledgedLocalDispatch) {
      return;
    }
    resetLocalDispatch();
  }, [resetLocalDispatch, serverAcknowledgedLocalDispatch]);

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledgedLocalDispatch,
  };
}

interface PersistentThreadTerminalDrawerProps {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  threadId: ThreadId;
  visible: boolean;
  layoutMode?: "drawer" | "tab";
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

const PersistentThreadTerminalDrawer = memo(function PersistentThreadTerminalDrawer({
  threadRef,
  threadId,
  visible,
  layoutMode = "drawer",
  launchContext,
  focusRequestId,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  keybindings,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, threadRef),
  );
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = useMemo(() => {
    if (launchContext !== null) {
      return launchContext.worktreePath;
    }
    return worktreePath;
  }, [launchContext, worktreePath]);
  const cwd = useMemo(
    () =>
      launchContext?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : null),
    [effectiveWorktreePath, launchContext?.cwd, project],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.cwd },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadRef, height);
    },
    [storeSetTerminalHeight, threadRef],
  );

  const splitTerminal = useCallback(() => {
    storeSplitTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeSplitTerminal, threadRef]);

  const createNewTerminal = useCallback(() => {
    storeNewTerminal(threadRef, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeNewTerminal, threadRef]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) return;

      closeTerminalWithFallback({
        terminalApi: api.terminal,
        threadId,
        terminalId,
        isFinalTerminal: terminalState.terminalIds.length <= 1,
      });

      storeCloseTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeCloseTerminal, terminalState.terminalIds.length, threadId, threadRef],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || !terminalState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div
      className={
        visible && layoutMode === "tab"
          ? "flex min-h-0 flex-1 flex-col"
          : visible
            ? undefined
            : "hidden"
      }
    >
      <ThreadTerminalDrawer
        threadRef={threadRef}
        threadId={threadId}
        cwd={cwd}
        worktreePath={effectiveWorktreePath}
        runtimeEnv={runtimeEnv}
        visible={visible}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalState.terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
        projectId={project?.id}
        onSplitTerminal={splitTerminal}
        onNewTerminal={createNewTerminal}
        splitShortcutLabel={visible ? splitShortcutLabel : undefined}
        newShortcutLabel={visible ? newShortcutLabel : undefined}
        closeShortcutLabel={visible ? closeShortcutLabel : undefined}
        keybindings={keybindings}
        onActiveTerminalChange={activateTerminal}
        onCloseTerminal={closeTerminal}
        onHeightChange={setTerminalHeight}
        onAddTerminalContext={handleAddTerminalContext}
        layoutMode={layoutMode}
      />
    </div>
  );
});

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
  } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  const composerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorByRef(routeKind === "server" ? routeThreadRef : null),
      [routeKind, routeThreadRef],
    ),
  );
  const setStoreThreadError = useStore((store) => store.setError);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore((store) =>
    routeKind === "server" ? store.threadLastVisitedAtById[routeThreadKey] : undefined,
  );
  const settings = useSettings();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseThreadRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerMcpServerIds = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.mcpServerIds ?? null,
  );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setComposerDraftMcpServerIds = useComposerDraftStore((store) => store.setMcpServerIds);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const composerHandleContext = useComposerHandleContext();
  const composerRef = useRef<ChatComposerHandle>(null);
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const setComposerHandle = useCallback(
    (handle: ChatComposerHandle | null) => {
      composerRef.current = handle;
      if (composerHandleContext) {
        composerHandleContext.current = handle;
      }
    },
    [composerHandleContext],
  );
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [actionCenterOpen, setActionCenterOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, string | null>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const { isMobile: isSidebarMobile, open: sidebarOpen } = useSidebar();
  const rightPanel = useRightPanelStore();
  const reserveLeadingTitlebarInset = shouldReserveDesktopTitlebarLeadingInset({
    isElectron,
    isMobile: isSidebarMobile,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    sidebarOpen,
  });
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [editorFocusRequestId, setEditorFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalLaunchContext, setTerminalLaunchContext] = useState<TerminalLaunchContext | null>(
    null,
  );
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [pendingServerThreadEnvMode, setPendingServerThreadEnvMode] =
    useState<DraftThreadEnvMode | null>(null);
  const [pendingServerThreadBranch, setPendingServerThreadBranch] = useState<string | null>();
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const isAtEndRef = useRef(true);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const sendInFlightRef = useRef(false);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  // Editor view visibility — gated by desktop bridge presence, main window,
  // and successful nvim probe. When false, the editor switch disappears and
  // Cmd+E is a no-op.
  const desktopBridgeAvailable = useDesktopBridgeAvailable();
  const isMainWindow = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const editorAvailable = desktopBridgeAvailable && isMainWindow && (nvimReady || vscodeReady);
  const activeEmbeddedEditor = resolveActiveEmbeddedEditor({
    preferredEditor: settings.embeddedEditor,
    nvimReady,
    vscodeReady,
  });
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalStateStore(
    useShallow((state) =>
      Object.entries(state.terminalStateByThreadKey).flatMap(([nextThreadKey, nextTerminalState]) =>
        nextTerminalState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const serverThreadKeys = useStore(
    useShallow((state) =>
      selectThreadsAcrossEnvironments(state).map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    ),
  );
  const storeServerTerminalLaunchContext = useTerminalStateStore(
    (s) => s.terminalLaunchContextByThreadKey[scopedThreadKey(routeThreadRef)] ?? null,
  );
  const storeClearTerminalLaunchContext = useTerminalStateStore(
    (s) => s.clearTerminalLaunchContext,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelectorByRef(fallbackDraftProjectRef), [fallbackDraftProjectRef]),
  );
  const localDraftError =
    routeKind === "server" && serverThread
      ? null
      : ((draftId ? localDraftErrorsByDraftId[draftId] : null) ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const isServerThread = routeKind === "server" && serverThread !== undefined;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const runtimeMode = composerRuntimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const diffOpen = rawSearch.diff === "1";
  const diffPanelOpen = rightPanel.activeTab === "diff";
  const activeThreadId = activeThread?.id ?? null;
  const activeThreadRef = useMemo(
    () => (activeThread ? scopeThreadRef(activeThread.environmentId, activeThread.id) : null),
    [activeThread],
  );
  const activeThreadEnvironmentId = activeThread?.environmentId;
  const activeThreadProjectId = activeThread?.projectId;
  const activeProjectRef = useMemo(
    () =>
      activeThreadEnvironmentId && activeThreadProjectId
        ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
        : null,
    [activeThreadEnvironmentId, activeThreadProjectId],
  );
  const actionRunReceipts = useActionRunStore(
    useShallow((state) => selectActionRunReceiptsForThread(state, routeThreadRef)),
  );
  const activeActionRunObserverKey = useActionRunStore((state) =>
    (activeProjectRef ? selectActionRunsForProject(state, activeProjectRef) : [])
      .filter((run) => run.status === "starting" || run.status === "running")
      .map((run) => `${run.id}:${run.tmuxProjectId}:${run.cwd}`)
      .join("|"),
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const threadPlanCatalog = useThreadPlanCatalog(
    useMemo(() => {
      const threadIds: ThreadId[] = [];
      if (activeThread?.id) {
        threadIds.push(activeThread.id);
      }
      const sourceThreadId = activeLatestTurn?.sourceProposedPlan?.threadId;
      if (sourceThreadId && sourceThreadId !== activeThread?.id) {
        threadIds.push(sourceThreadId);
      }
      return threadIds;
    }, [activeLatestTurn?.sourceProposedPlan?.threadId, activeThread?.id]),
  );
  useEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalState.terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeThreadKey, existingOpenTerminalThreadKeys, terminalState.terminalOpen]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );

  // Compute the list of environments this logical project spans, used to
  // drive the environment picker in BranchToolbar.
  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const logicalKey = deriveLogicalProjectKey(activeProject);
    const memberProjects = allProjects.filter((p) => deriveLogicalProjectKey(p) === logicalKey);
    const seen = new Set<string>();
    const envs: Array<{
      environmentId: EnvironmentId;
      projectId: ProjectId;
      label: string;
      isPrimary: boolean;
    }> = [];
    for (const p of memberProjects) {
      if (seen.has(p.environmentId)) continue;
      seen.add(p.environmentId);
      const isPrimary = p.environmentId === primaryEnvironmentId;
      const savedRecord = savedEnvironmentRegistry[p.environmentId];
      const runtimeState = savedEnvironmentRuntimeById[p.environmentId];
      const label = resolveEnvironmentOptionLabel({
        isPrimary,
        environmentId: p.environmentId,
        runtimeLabel: runtimeState?.descriptor?.label ?? null,
        savedLabel: savedRecord?.label ?? null,
      });
      envs.push({
        environmentId: p.environmentId,
        projectId: p.id,
        label,
        isPrimary,
      });
    }
    // Sort: primary first, then alphabetical
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [
    activeProject,
    allProjects,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKey(activeProject);
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftThreadContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            threadId: storedDraftSession.threadId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.threadId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerThread &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftThreadContext(draftId, input);
        setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
          threadId: activeDraftSession.threadId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          ...input,
        });
        return activeDraftSession.threadId;
      }

      const nextDraftId = newDraftId();
      const nextThreadId = newThreadId();
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
        threadId: nextThreadId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(nextDraftId),
      });
      return nextThreadId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerThread,
      navigate,
      routeKind,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  useEffect(() => {
    if (!serverThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)));
  }, [
    activeLatestTurn?.completedAt,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    markThreadVisited,
    serverThread?.environmentId,
    serverThread?.id,
  ]);

  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.provider ?? activeProject?.defaultModelSelection?.provider ?? null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
  });
  const primaryServerConfig = useServerConfig();
  const activeEnvRuntimeState = useSavedEnvironmentRuntimeStore((s) =>
    activeThread?.environmentId ? s.byId[activeThread.environmentId] : null,
  );
  // Use the server config for the thread's environment.  For the primary
  // environment fall back to the global atom; for remote environments use
  // the runtime state stored by the environment manager.
  const serverConfig =
    primaryEnvironmentId && activeThread?.environmentId === primaryEnvironmentId
      ? primaryServerConfig
      : (activeEnvRuntimeState?.serverConfig ?? primaryServerConfig);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? "codex",
  );
  const selectedProvider: ProviderSelectionKind = lockedProvider ?? unlockedSelectedProvider;
  const selectedProviderStatus = getProviderSnapshot(providerStatuses, selectedProvider) ?? null;
  const selectableMcpServers = useMemo(() => getSelectableMcpServers(settings), [settings]);
  const selectableMcpServerIds = useMemo(
    () => new Set(selectableMcpServers.map((server) => server.id)),
    [selectableMcpServers],
  );
  const selectedMcpServerIds = useMemo(() => {
    const sourceIds =
      composerMcpServerIds ??
      (isServerThread ? (activeThread?.mcpServerIds ?? []) : settings.defaultMcpServerIds);
    return sourceIds.filter((serverId) => selectableMcpServerIds.has(serverId));
  }, [
    activeThread?.mcpServerIds,
    composerMcpServerIds,
    isServerThread,
    selectableMcpServerIds,
    settings.defaultMcpServerIds,
  ]);
  const mcpCompatibilityMessage = useMemo(
    () =>
      getProviderMcpCompatibility({
        provider: selectedProvider,
        capabilities: selectedProviderStatus?.mcpCapabilities,
        servers: selectableMcpServers,
        selectedIds: selectedMcpServerIds,
      }),
    [selectableMcpServers, selectedMcpServerIds, selectedProvider, selectedProviderStatus],
  );
  const phase = derivePhase(activeThread?.session ?? null);
  const mcpChangeNotice =
    isServerThread && phase === "running" && composerMcpServerIds !== null
      ? "Changes apply on the next turn; the provider session may restart."
      : null;
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeLatestTurn ?? undefined),
    [activeLatestTurn, threadActivities],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog],
  );
  const derivedActivePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const activePlan = useMemo(
    () => deriveDisplayActivePlanState(derivedActivePlan, activeLatestTurn),
    [activeLatestTurn, derivedActivePlan],
  );
  const planSidebarLabel = sidebarProposedPlan || interactionMode === "plan" ? "Plan" : "Tasks";
  const sidePanelControlLabel = resolveSidePanelControlLabel({
    activeTab: rightPanel.activeTab,
    planLabel: planSidebarLabel,
  });
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  const serverMessages = activeThread?.messages;
  useEffect(() => {
    if (typeof Image === "undefined" || !serverMessages || serverMessages.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = serverMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image" && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [attachmentPreviewHandoffByMessageId, clearAttachmentPreviewHandoff, serverMessages]);
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeThread?.proposedPlans ?? [], workLogEntries),
    [activeThread?.proposedPlans, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!completionSummary) return null;
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn);
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const keybindings = useServerKeybindings();
  const activeProviderSkills = selectedProviderStatus?.skills ?? EMPTY_PROVIDER_SKILLS;
  const activeProviderStatus = useMemo(
    () => providerStatuses.find((status) => status.provider === selectedProvider) ?? null,
    [selectedProvider, providerStatuses],
  );
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalLaunchContext?.threadId === activeThreadId
      ? terminalLaunchContext
      : (storeServerTerminalLaunchContext ?? null);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const gitDiffAvailable = isServerThread && isGitRepo;
  const { activeChatTab, handleChatTabSelect, lastNonTerminalChatTabRef, setActiveChatTab } =
    useChatViewTabs({
      desktopBridgeAvailable,
      draftId,
      editorAvailable,
      gitDiffAvailable,
      rawSearch,
      routeKind,
      routeThreadRef,
    });
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const clearDiffRouteState = useCallback(() => {
    if (!isServerThread || !diffOpen) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId,
        threadId,
      },
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [diffOpen, environmentId, isServerThread, navigate, threadId]);
  const closeRightPanel = useCallback(() => {
    rightPanel.close();
    clearDiffRouteState();
  }, [clearDiffRouteState, rightPanel]);
  const onToggleDiff = useCallback(() => {
    if (!isServerThread) {
      return;
    }
    if (rightPanel.activeTab === "diff") {
      closeRightPanel();
      return;
    }
    onDiffPanelOpen?.();
    rightPanel.openTab("diff");
  }, [closeRightPanel, isServerThread, onDiffPanelOpen, rightPanel]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );

  // Handle environment change for draft threads.  When the user picks a
  // different environment we update the draft context to point at the physical
  // project in that environment while keeping the same logical project.
  const onEnvironmentChange = useCallback(
    (nextEnvironmentId: EnvironmentId) => {
      if (envLocked || !draftId) return;
      const target = logicalProjectEnvironments.find(
        (env) => env.environmentId === nextEnvironmentId,
      );
      if (!target) return;
      setDraftThreadContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [draftId, envLocked, logicalProjectEnvironments, setDraftThreadContext],
  );

  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      const nextError = sanitizeThreadErrorMessage(error);
      const isCurrentServerThread = shouldWriteThreadErrorToCurrentServerThread({
        serverThread,
        routeThreadRef,
        targetThreadId,
      });
      if (isCurrentServerThread) {
        setStoreThreadError(targetThreadId, nextError);
        return;
      }
      const localDraftErrorKey = draftId ?? targetThreadId;
      setLocalDraftErrorsByDraftId((existing) => {
        if ((existing[localDraftErrorKey] ?? null) === nextError) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextError,
        };
      });
    },
    [draftId, routeThreadRef, serverThread, setStoreThreadError],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, []);
  const requestEditorFocus = useCallback(() => {
    setEditorFocusRequestId((value) => value + 1);
  }, []);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback((selection: TerminalContextSelection) => {
    composerRef.current?.addTerminalContext(selection);
  }, []);
  const resolveTerminalFallbackChatTab = useCallback(() => {
    const previousTab = lastNonTerminalChatTabRef.current;
    if (previousTab === "gitdiff" && gitDiffAvailable) {
      return "gitdiff" as const;
    }
    if (previousTab === "editor" && editorAvailable) {
      return "editor" as const;
    }
    return "thread" as const;
  }, [editorAvailable, gitDiffAvailable, lastNonTerminalChatTabRef]);
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadRef) return;
      storeSetTerminalOpen(activeThreadRef, open);
    },
    [activeThreadRef, storeSetTerminalOpen],
  );
  const activateTerminalTab = useCallback(
    (options?: { ensureOpen?: boolean; focus?: boolean }) => {
      if (!activeThreadRef) {
        return;
      }
      if (options?.ensureOpen ?? true) {
        setTerminalOpen(true);
      }
      if (useEditorStore.getState().activeChatTab !== "terminal") {
        setActiveChatTab("terminal");
      }
      if (options?.focus ?? true) {
        setTerminalFocusRequestId((value) => value + 1);
      }
    },
    [activeThreadRef, setActiveChatTab, setTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadRef) return;
    if (terminalState.terminalOpen) {
      if (activeChatTab === "terminal") {
        setActiveChatTab(resolveTerminalFallbackChatTab());
      }
      setTerminalOpen(false);
      return;
    }
    activateTerminalTab({ ensureOpen: true, focus: true });
  }, [
    activateTerminalTab,
    activeChatTab,
    activeThreadRef,
    resolveTerminalFallbackChatTab,
    setActiveChatTab,
    setTerminalOpen,
    terminalState.terminalOpen,
  ]);
  const handleChatViewSelect = useCallback(
    (tab: ChatViewTab) => {
      if (tab === "terminal") {
        activateTerminalTab({ ensureOpen: true, focus: true });
        return;
      }
      if (tab === "gitdiff" && !gitDiffAvailable) {
        return;
      }
      handleChatTabSelect(tab);
    },
    [activateTerminalTab, gitDiffAvailable, handleChatTabSelect],
  );
  const toggleGitDiffTab = useCallback(() => {
    if (activeChatTab === "gitdiff") {
      setActiveChatTab("thread");
      return;
    }
    if (!gitDiffAvailable) {
      return;
    }
    setActiveChatTab("gitdiff");
  }, [activeChatTab, gitDiffAvailable, setActiveChatTab]);
  const splitTerminal = useCallback(() => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, hasReachedSplitLimit, storeSplitTerminal]);
  const createNewTerminal = useCallback(() => {
    if (!activeThreadRef) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadRef, storeNewTerminal]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!activeThreadId || !api) return;

      closeTerminalWithFallback({
        terminalApi: api.terminal,
        threadId: activeThreadId,
        terminalId,
        isFinalTerminal: terminalState.terminalIds.length <= 1,
      });

      if (activeThreadRef) {
        storeCloseTerminal(activeThreadRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeThreadId,
      activeThreadRef,
      environmentId,
      storeCloseTerminal,
      terminalState.terminalIds.length,
    ],
  );
  const {
    deleteGlobalScript,
    deleteProjectScript,
    placeholderDialog,
    runGlobalScript,
    runProjectScript,
    saveGlobalScript,
    saveProjectScript,
    updateGlobalScript,
    updateProjectScript,
  } = useChatViewScripts({
    activeProject,
    activeThread,
    activeThreadId,
    activeThreadRef,
    environmentId,
    gitCwd,
    setLastInvokedScriptByProjectId,
    setThreadError,
  });

  const handleToggleActionCenter = useCallback(() => {
    setActionCenterOpen((open) => !open);
  }, []);

  const handleOpenActionRun = useCallback((_run: ActionRun) => {
    setActionCenterOpen(true);
  }, []);

  const handleRetryActionRun = useCallback(
    (run: ActionRun) => {
      void runProjectScript(
        {
          id: run.scriptId,
          name: run.scriptName,
          command: run.command,
          icon: "play",
          runOnWorktreeCreate: false,
        },
        {
          cwd: run.cwd,
          rememberAsLastInvoked: false,
          source: run.source,
        },
      );
      setActionCenterOpen(true);
    },
    [runProjectScript],
  );

  useEffect(() => {
    if (actionCenterOpen || activeActionRunObserverKey.length === 0) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }

    const activeRuns = activeProjectRef
      ? selectActionRunsForProject(useActionRunStore.getState(), activeProjectRef).filter(
          (run) => run.status === "starting" || run.status === "running",
        )
      : [];

    for (const run of activeRuns) {
      void api.terminal
        .attachTmux({
          projectId: run.tmuxProjectId,
          cwd: run.cwd,
          cols: ACTION_RUN_OBSERVER_COLS,
          rows: ACTION_RUN_OBSERVER_ROWS,
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Could not reconnect action tmux session.";
          useActionRunStore.getState().failActionRun(run.id, message);
        });
    }
  }, [actionCenterOpen, activeActionRunObserverKey, activeProjectRef, environmentId]);

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const closePlanSidebar = useCallback(() => {
    closeRightPanel();
    planSidebarDismissedForTurnRef.current =
      activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
  }, [activePlan?.turnId, closeRightPanel, sidebarProposedPlan?.turnId]);
  const toggleSidePanel = useCallback(() => {
    if (rightPanel.activeTab !== null) {
      closeRightPanel();
      planSidebarDismissedForTurnRef.current =
        activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
      return;
    }
    planSidebarDismissedForTurnRef.current = null;
    rightPanel.openTab("plan");
  }, [activePlan?.turnId, closeRightPanel, rightPanel, sidebarProposedPlan?.turnId]);

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
      mcpServerIds?: ReadonlyArray<McpServerId>;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.provider !== serverThread.modelSelection.provider ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }

      if (
        input.mcpServerIds !== undefined &&
        !Equal.equals(input.mcpServerIds, serverThread.mcpServerIds ?? [])
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.mcp-servers.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          mcpServerIds: [...input.mcpServerIds],
          createdAt: input.createdAt,
        });
      }
    },
    [environmentId, serverThread],
  );

  const handleMcpServerIdsChange = useCallback(
    (ids: McpServerId[]) => {
      const nextIds = ids.filter((serverId) => selectableMcpServerIds.has(serverId));
      setComposerDraftMcpServerIds(composerDraftTarget, nextIds);

      if (!isServerThread || !activeThread) {
        return;
      }
      if (Equal.equals(nextIds, activeThread.mcpServerIds ?? [])) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }
      void api.orchestration
        .dispatchCommand({
          type: "thread.mcp-servers.set",
          commandId: newCommandId(),
          threadId: activeThread.id,
          mcpServerIds: nextIds,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not update MCP servers",
            description:
              err instanceof Error ? err.message : "The thread MCP selection was not saved.",
          });
        });
    },
    [
      activeThread,
      composerDraftTarget,
      environmentId,
      isServerThread,
      selectableMcpServerIds,
      setComposerDraftMcpServerIds,
    ],
  );

  // Scroll helpers — LegendList handles auto-scroll via maintainScrollAtEnd.
  const scrollToEnd = useCallback((animated = false) => {
    legendListRef.current?.scrollToEnd?.({ animated });
  }, []);

  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      showScrollDebouncer.current.maybeExecute();
    }
  }, []);

  useEffect(() => {
    setPullRequestDialogState(null);
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      rightPanel.openTab("plan");
    } else {
      rightPanel.close();
    }
    planSidebarDismissedForTurnRef.current = null;
    // rightPanel intentionally omitted: store is stable and we only want
    // this effect to fire on thread change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id]);

  // Auto-open the plan sidebar when plan/todo steps arrive for the current turn.
  // Don't auto-open for plans carried over from a previous turn (the user can open manually).
  // Only fires when the right panel is fully closed. If the user has switched
  // to another tab, respect that choice instead of bouncing back to plan.
  useEffect(() => {
    if (!activePlan) return;
    if (rightPanel.activeTab !== null) return;
    if (activeLatestTurn && !isActivePlanScopedToLatestTurn(activePlan, activeLatestTurn)) return;
    const turnKey = activePlan.turnId ?? sidebarProposedPlan?.turnId ?? "__dismissed__";
    if (planSidebarDismissedForTurnRef.current === turnKey) return;
    rightPanel.openTab("plan");
    // rightPanel intentionally omitted from deps: store is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan, activeLatestTurn, rightPanel.activeTab, sidebarProposedPlan?.turnId]);

  // Open the shared right panel on the Diff tab when the route explicitly
  // targets a diff. Do not auto-close or bounce the user back to Diff once
  // they switch tabs manually.
  useEffect(() => {
    if (!diffOpen) return;
    if (rightPanel.activeTab === "diff") return;
    rightPanel.openTab("diff");
    // rightPanel intentionally omitted: stable store reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, diffOpen]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

  // Focus composer whenever the thread tab becomes active so cmd+e hands
  // keystrokes back to chat without a click — mirrors the editor canvas
  // autofocus on the editor tab.
  useEffect(() => {
    if (activeChatTab !== "thread") return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeChatTab, focusComposer]);

  useEffect(() => {
    if (activeChatTab !== "terminal") return;
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeChatTab]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, threadId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeThread.messages.length === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranch !== undefined
      ? pendingServerThreadBranch
      : (activeThread?.branch ?? null);

  useEffect(() => {
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [activeThread?.id]);

  useEffect(() => {
    if (canOverrideServerThreadEnvMode) {
      return;
    }
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [canOverrideServerThreadEnvMode]);

  useEffect(() => {
    if (!activeThreadId) {
      setTerminalLaunchContext(null);
      storeClearTerminalLaunchContext(routeThreadRef);
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  }, [activeThreadId, routeThreadRef, storeClearTerminalLaunchContext]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeThreadWorktreePath ?? null) === current.worktreePath
      ) {
        if (activeThreadRef) {
          storeClearTerminalLaunchContext(activeThreadRef);
        }
        return null;
      }
      return current;
    });
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeThreadWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      (activeThreadWorktreePath ?? null) === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeThreadRef) {
        storeClearTerminalLaunchContext(activeThreadRef);
      }
    }
  }, [
    activeProjectCwd,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    storeClearTerminalLaunchContext,
    storeServerTerminalLaunchContext,
  ]);

  useEffect(() => {
    if (terminalState.terminalOpen) {
      return;
    }
    if (activeThreadRef) {
      storeClearTerminalLaunchContext(activeThreadRef);
    }
    setTerminalLaunchContext((current) => (current?.threadId === activeThreadId ? null : current));
  }, [
    activeThreadId,
    activeThreadRef,
    storeClearTerminalLaunchContext,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (activeChatTab !== "terminal") {
      return;
    }
    if (terminalState.terminalOpen && activeProject) {
      return;
    }
    setActiveChatTab(resolveTerminalFallbackChatTab());
  }, [
    activeChatTab,
    activeProject,
    resolveTerminalFallbackChatTab,
    setActiveChatTab,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        const fallbackTab = resolveTerminalFallbackChatTab();
        if (activeChatTab === "terminal") {
          setActiveChatTab(fallbackTab);
        }
        const focusTarget = resolveTerminalCloseFocusTarget({
          activeChatTab: fallbackTab,
          editorAvailable,
        });
        if (focusTarget === "editor") {
          requestEditorFocus();
          return;
        }
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadKey] = current;
  }, [
    activeChatTab,
    activeThreadKey,
    editorAvailable,
    focusComposer,
    requestEditorFocus,
    resolveTerminalFallbackChatTab,
    setActiveChatTab,
    terminalState.terminalOpen,
  ]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || event.defaultPrevented) return;
      if (commandPaletteOpen) return;
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          activateTerminalTab({ ensureOpen: true, focus: false });
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          activateTerminalTab({ ensureOpen: true, focus: false });
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleSidePanel();
        return;
      }

      if (command === "gitDiff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleGitDiffTab();
        return;
      }

      if (command === "editor.toggleChatTab") {
        if (!editorAvailable) return;
        event.preventDefault();
        event.stopPropagation();
        useEditorStore.getState().toggleChatTab();
        return;
      }

      if (command === "editor.sendSelection") {
        if (activeChatTab !== "editor") return;
        if (activeEmbeddedEditor !== "neovim") return;
        event.preventDefault();
        event.stopPropagation();
        void window.desktopBridge?.editor.invokeBridge("send_selection");
        return;
      }

      // Project scripts checked first (project wins on conflict)
      const scriptId = projectScriptIdFromCommand(command);
      if (scriptId && activeProject) {
        const script = activeProject.scripts.find((entry) => entry.id === scriptId);
        if (script) {
          event.preventDefault();
          event.stopPropagation();
          void runProjectScript(script);
          return;
        }
      }

      // Global scripts checked second
      const globalId = globalScriptIdFromCommand(command);
      if (globalId) {
        const globalScript = serverConfig?.globalActions?.find((s) => s.id === globalId);
        if (globalScript) {
          event.preventDefault();
          event.stopPropagation();
          void runGlobalScript(globalScript, false);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeProject,
    serverConfig,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeChatTab,
    activeThreadId,
    commandPaletteOpen,
    closeTerminal,
    createNewTerminal,
    activateTerminalTab,
    runProjectScript,
    runGlobalScript,
    splitTerminal,
    keybindings,
    toggleGitDiffTab,
    toggleSidePanel,
    toggleTerminalVisibility,
    editorAvailable,
    activeEmbeddedEditor,
  ]);

  useEffect(() => {
    const subscribe = window.desktopBridge?.vscodeOnShortcutCommand;
    if (!subscribe || activeEmbeddedEditor !== "vscode") return;

    return subscribe((command) => {
      if (!activeThreadId || commandPaletteOpen) return;

      if (command === "terminal.toggle") {
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        if (!terminalState.terminalOpen) {
          activateTerminalTab({ ensureOpen: true, focus: false });
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        if (!terminalState.terminalOpen) {
          activateTerminalTab({ ensureOpen: true, focus: false });
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        toggleSidePanel();
        return;
      }

      if (command === "gitDiff.toggle") {
        toggleGitDiffTab();
        return;
      }

      if (command === "editor.toggleChatTab" && editorAvailable) {
        const editorStore = useEditorStore.getState();
        if (editorStore.activeChatTab === "editor") {
          editorStore.setActiveChatTab("thread");
          const hideEmbeddedVSCode = window.desktopBridge?.vscodeHide?.();
          if (hideEmbeddedVSCode) {
            void hideEmbeddedVSCode
              .catch(() => undefined)
              .then(() => {
                scheduleComposerFocus();
              });
            return;
          }
          scheduleComposerFocus();
          return;
        }

        editorStore.toggleChatTab();
      }
    });
  }, [
    activeEmbeddedEditor,
    activeThreadId,
    activateTerminalTab,
    closeTerminal,
    commandPaletteOpen,
    createNewTerminal,
    editorAvailable,
    scheduleComposerFocus,
    splitTerminal,
    terminalState.activeTerminalId,
    terminalState.terminalOpen,
    toggleGitDiffTab,
    toggleSidePanel,
    toggleTerminalVisibility,
  ]);

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readEnvironmentApi(environmentId);
      const localApi = readLocalApi();
      if (!api || !localApi || !activeThread || isRevertingCheckpoint) return;

      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
        return;
      }
      const confirmed = await localApi.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [
      activeThread,
      environmentId,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      setThreadError,
    ],
  );

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) return;
    const {
      images: composerImages,
      terminalContexts: composerTerminalContexts,
      selectedProvider: ctxSelectedProvider,
      selectedProviderInstanceId: ctxSelectedProviderInstanceId,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      selectedMcpServerIds: ctxSelectedMcpServerIds,
    } = sendCtx;
    const ctxMcpCompatibilityMessage = getProviderMcpCompatibility({
      provider: ctxSelectedProvider,
      capabilities: getProviderSnapshot(providerStatuses, ctxSelectedProvider)?.mcpCapabilities,
      servers: selectableMcpServers,
      selectedIds: ctxSelectedMcpServerIds,
    });
    if (ctxMcpCompatibilityMessage) {
      toastManager.add({
        type: "error",
        title: "Selected provider cannot use these MCP servers",
        description: ctxMcpCompatibilityMessage,
      });
      return;
    }
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
    });
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        });
      }
      return;
    }
    if (!activeProject) return;
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });

    const composerImagesSnapshot = [...composerImages];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerEditorContextsSnapshot = [...useEditorStore.getState().pendingContexts];
    const messageTextWithTerminal = appendTerminalContextsToPrompt(
      promptForSend,
      composerTerminalContextsSnapshot,
    );
    const messageTextForSend = appendEditorContextsToPrompt(
      messageTextWithTerminal,
      composerEditorContextsSnapshot,
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const turnAttachmentsPromise = Promise.all(
      composerImagesSnapshot.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
    );
    const optimisticAttachments = composerImagesSnapshot.map((image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    }));
    isAtEndRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    await legendListRef.current?.scrollToEnd?.({ animated: false });

    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);
    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      });
    }
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    useEditorStore.getState().clearPendingContexts();
    composerRef.current?.resetCursorState();

    let turnStartSucceeded = false;
    await (async () => {
      let firstComposerImageName: string | null = null;
      if (composerImagesSnapshot.length > 0) {
        const firstComposerImage = composerImagesSnapshot[0];
        if (firstComposerImage) {
          firstComposerImageName = firstComposerImage.name;
        }
      }
      let titleSeed = trimmed;
      if (!titleSeed) {
        if (firstComposerImageName) {
          titleSeed = `Image: ${firstComposerImageName}`;
        } else if (composerTerminalContextsSnapshot.length > 0) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
        } else if (composerEditorContextsSnapshot.length > 0) {
          titleSeed = formatEditorContextLabel(composerEditorContextsSnapshot[0]!);
        } else {
          titleSeed = "New thread";
        }
      }
      const title = truncate(titleSeed);
      const threadCreateModelSelection: ModelSelection = {
        provider: ctxSelectedProvider,
        model:
          ctxSelectedModel ||
          activeProject.defaultModelSelection?.model ||
          DEFAULT_MODEL_BY_PROVIDER.codex,
        ...(ctxSelectedModelSelection.options
          ? { options: ctxSelectedModelSelection.options }
          : {}),
      };

      // Auto-title from first message
      if (isFirstMessage && isServerThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          title,
        });
      }

      if (isServerThread) {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
          runtimeMode,
          interactionMode,
          mcpServerIds: ctxSelectedMcpServerIds,
        });
      }

      const turnAttachments = await turnAttachmentsPromise;
      const bootstrap =
        isLocalDraftThread || baseBranchForWorktree
          ? {
              ...(isLocalDraftThread
                ? {
                    createThread: {
                      projectId: activeProject.id,
                      title,
                      modelSelection: threadCreateModelSelection,
                      runtimeMode,
                      interactionMode,
                      mcpServerIds: [...ctxSelectedMcpServerIds],
                      branch: activeThreadBranch,
                      worktreePath: activeThread.worktreePath,
                      createdAt: activeThread.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject.cwd,
                      baseBranch: baseBranchForWorktree,
                      branch: buildTemporaryWorktreeBranchName(),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      beginLocalDispatch({ preparingWorktree: false });
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
        },
        modelSelection: ctxSelectedModelSelection,
        providerInstanceId: ctxSelectedProviderInstanceId,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        mcpServerIds: [...ctxSelectedMcpServerIds],
        ...(bootstrap ? { bootstrap } : {}),
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        promptRef.current = promptForSend;
        const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
        composerImagesRef.current = retryComposerImages;
        composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
        setComposerDraftPrompt(composerDraftTarget, promptForSend);
        addComposerDraftImages(composerDraftTarget, retryComposerImages);
        setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
        composerRef.current?.resetCursorState({
          cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
          prompt: promptForSend,
          detectTrigger: true,
        });
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send message.",
      );
    });
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      resetLocalDispatch();
    }
  };

  const onInterrupt = async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !activeThread) return;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    });
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, environmentId, setThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          (activePendingProgress?.activeQuestion?.id === questionId
            ? activePendingProgress.activeQuestion
            : undefined) ??
          activePendingUserInput.questions.find((entry) => entry.id === questionId);
        if (!question) {
          return existing;
        }

        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionLabel,
            ),
          },
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readEnvironmentApi(environmentId);
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx) {
        return;
      }
      const {
        selectedProvider: ctxSelectedProvider,
        selectedProviderInstanceId: ctxSelectedProviderInstanceId,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
        selectedMcpServerIds: ctxSelectedMcpServerIds,
      } = sendCtx;
      const ctxMcpCompatibilityMessage = getProviderMcpCompatibility({
        provider: ctxSelectedProvider,
        capabilities: getProviderSnapshot(providerStatuses, ctxSelectedProvider)?.mcpCapabilities,
        servers: selectableMcpServers,
        selectedIds: ctxSelectedMcpServerIds,
      });
      if (ctxMcpCompatibilityMessage) {
        toastManager.add({
          type: "error",
          title: "Selected provider cannot use these MCP servers",
          description: ctxMcpCompatibilityMessage,
        });
        return;
      }

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setThreadError(threadIdForSend, null);
      isAtEndRef.current = true;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      await legendListRef.current?.scrollToEnd?.({ animated: false });
      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
          mcpServerIds: ctxSelectedMcpServerIds,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(
          scopeThreadRef(activeThread.environmentId, threadIdForSend),
          nextInteractionMode,
        );

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          providerInstanceId: ctxSelectedProviderInstanceId,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          mcpServerIds: [...ctxSelectedMcpServerIds],
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default") {
          planSidebarDismissedForTurnRef.current = null;
          rightPanel.openTab("plan");
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginLocalDispatch,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      rightPanel,
      runtimeMode,
      selectableMcpServers,
      providerStatuses,
      setComposerDraftInteractionMode,
      setThreadError,
      environmentId,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedProviderInstanceId: ctxSelectedProviderInstanceId,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      selectedMcpServerIds: ctxSelectedMcpServerIds,
    } = sendCtx;
    const ctxMcpCompatibilityMessage = getProviderMcpCompatibility({
      provider: ctxSelectedProvider,
      capabilities: getProviderSnapshot(providerStatuses, ctxSelectedProvider)?.mcpCapabilities,
      servers: selectableMcpServers,
      selectedIds: ctxSelectedMcpServerIds,
    });
    if (ctxMcpCompatibilityMessage) {
      toastManager.add({
        type: "error",
        title: "Selected provider cannot use these MCP servers",
        description: ctxMcpCompatibilityMessage,
      });
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        mcpServerIds: [...ctxSelectedMcpServerIds],
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          providerInstanceId: ctxSelectedProviderInstanceId,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          mcpServerIds: [...ctxSelectedMcpServerIds],
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        });
      })
      .then(() => {
        return waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId));
      })
      .then(() => {
        // Signal that the plan sidebar should open on the new thread.
        planSidebarOpenOnNextThreadRef.current = true;
        return navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        });
      })
      .catch(async (err: unknown) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(() => undefined);
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThreadBranch,
    activeThread,
    beginLocalDispatch,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    selectableMcpServers,
    providerStatuses,
    environmentId,
  ]);

  const onProviderModelSelect = useCallback(
    (provider: ProviderSelectionKind, model: string) => {
      if (!activeThread) return;
      if (lockedProvider !== null && provider !== lockedProvider) {
        scheduleComposerFocus();
        return;
      }
      const resolvedProvider = resolveSelectableProvider(providerStatuses, provider);
      const resolvedModel = resolveAppModelSelection(
        resolvedProvider,
        settings,
        providerStatuses,
        model,
      );
      const nextModelSelection: ModelSelection = {
        provider: resolvedProvider,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(
        scopeThreadRef(activeThread.environmentId, activeThread.id),
        nextModelSelection,
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (canOverrideServerThreadEnvMode) {
        setPendingServerThreadEnvMode(mode);
        scheduleComposerFocus();
        return;
      }
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, {
          envMode: mode,
          ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
        });
      }
      scheduleComposerFocus();
    },
    [
      canOverrideServerThreadEnvMode,
      composerDraftTarget,
      draftThread?.worktreePath,
      isLocalDraftThread,
      scheduleComposerFocus,
      setPendingServerThreadEnvMode,
      setDraftThreadContext,
    ],
  );

  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (!isServerThread) {
        return;
      }
      onDiffPanelOpen?.();
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId,
          threadId,
        },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [environmentId, isServerThread, navigate, onDiffPanelOpen, threadId],
  );
  const onRevertUserMessage = useCallback(
    (messageId: MessageId) => {
      const targetTurnCount = revertTurnCountByUserMessageId.get(messageId);
      if (typeof targetTurnCount !== "number") {
        return;
      }
      void onRevertToTurnCount(targetTurnCount);
    },
    [onRevertToTurnCount, revertTurnCountByUserMessageId],
  );

  // Empty state: no active thread
  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      {/* Top bar */}
      <header
        className={cn(
          "border-b border-border",
          reserveLeadingTitlebarInset
            ? cn("pr-3 sm:pr-5", DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME)
            : "px-3 sm:px-5",
          isElectron
            ? cn(
                "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]",
                reserveTitleBarControlInset && DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME,
              )
            : "py-2 sm:py-3",
        )}
      >
        <ChatHeader
          activeThreadEnvironmentId={activeThread.environmentId}
          activeThreadId={activeThread.id}
          {...(routeKind === "draft" && draftId ? { draftId } : {})}
          activeThreadTitle={activeThread.title}
          activeProjectId={activeProject?.id}
          activeProjectName={activeProject?.name}
          activeChatTab={activeChatTab}
          editorAvailable={editorAvailable}
          gitDiffAvailable={gitDiffAvailable}
          isGitRepo={isGitRepo}
          activeProjectScripts={activeProject?.scripts}
          preferredScriptId={
            activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
          }
          keybindings={keybindings}
          gitCwd={gitCwd}
          diffOpen={diffPanelOpen}
          globalScripts={[...(serverConfig?.globalActions ?? [])]}
          globalScriptDefaults={activeProject?.globalScriptDefaults ?? []}
          onRunProjectScript={runProjectScript}
          onRunGlobalScript={runGlobalScript}
          onAddProjectScript={saveProjectScript}
          onUpdateProjectScript={updateProjectScript}
          onDeleteProjectScript={deleteProjectScript}
          onAddGlobalScript={saveGlobalScript}
          onUpdateGlobalScript={updateGlobalScript}
          onDeleteGlobalScript={deleteGlobalScript}
          onChatTabSelect={handleChatViewSelect}
          actionCenterOpen={actionCenterOpen}
          onToggleActionCenter={handleToggleActionCenter}
          onToggleDiff={onToggleDiff}
        />
      </header>

      {/* Error banner */}
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Thread tab — composer hides "for free" when this branch is
              hidden via display:none. EditorPane mounts unconditionally
              alongside so its canvas/GL state stays warm across toggles. */}
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            style={{ display: activeChatTab === "thread" ? "flex" : "none" }}
          >
            {/* Messages Wrapper */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <MessagesTimeline
                key={activeThread.id}
                isWorking={isWorking}
                activeTurnInProgress={isWorking || !latestTurnSettled}
                activeTurnId={activeLatestTurn?.turnId ?? null}
                activeTurnStartedAt={activeWorkStartedAt}
                listRef={legendListRef}
                timelineEntries={timelineEntries}
                completionDividerBeforeEntryId={completionDividerBeforeEntryId}
                completionSummary={completionSummary}
                turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                activeThreadEnvironmentId={activeThread.environmentId}
                routeThreadKey={routeThreadKey}
                onOpenTurnDiff={onOpenTurnDiff}
                revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                onRevertUserMessage={onRevertUserMessage}
                isRevertingCheckpoint={isRevertingCheckpoint}
                onImageExpand={onExpandTimelineImage}
                markdownCwd={gitCwd ?? undefined}
                resolvedTheme={resolvedTheme}
                timestampFormat={timestampFormat}
                workspaceRoot={activeWorkspaceRoot}
                skills={activeProviderSkills}
                actionRuns={actionRunReceipts}
                onOpenActionRun={handleOpenActionRun}
                onRetryActionRun={handleRetryActionRun}
                onIsAtEndChange={onIsAtEndChange}
              />

              {/* scroll to bottom pill — shown when user has scrolled away from the bottom */}
              {showScrollToBottom && (
                <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                  <button
                    type="button"
                    onClick={() => scrollToEnd(true)}
                    className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
                  >
                    <ChevronDownIcon className="size-3.5" />
                    Scroll to bottom
                  </button>
                </div>
              )}
            </div>

            {/* Managed process status bar */}
            {activeProject && (
              <ManagedProcessStatusBar
                projectId={activeProject.id}
                environmentId={environmentId}
                currentWorktreePath={activeThreadWorktreePath}
              />
            )}

            {/* Input bar */}
            <div className={cn("px-3 pt-1.5 sm:px-5 sm:pt-2", isGitRepo ? "pb-1" : "pb-3 sm:pb-4")}>
              <ChatComposer
                ref={setComposerHandle}
                composerDraftTarget={composerDraftTarget}
                environmentId={environmentId}
                routeKind={routeKind}
                routeThreadRef={routeThreadRef}
                draftId={draftId}
                activeThreadId={activeThreadId}
                activeThreadEnvironmentId={activeThread?.environmentId}
                activeThread={activeThread}
                isServerThread={isServerThread}
                isLocalDraftThread={isLocalDraftThread}
                phase={phase}
                isConnecting={isConnecting}
                isSendBusy={isSendBusy}
                isPreparingWorktree={isPreparingWorktree}
                activePendingApproval={activePendingApproval}
                pendingApprovals={pendingApprovals}
                pendingUserInputs={pendingUserInputs}
                activePendingProgress={activePendingProgress}
                activePendingResolvedAnswers={activePendingResolvedAnswers}
                activePendingIsResponding={activePendingIsResponding}
                activePendingDraftAnswers={activePendingDraftAnswers}
                activePendingQuestionIndex={activePendingQuestionIndex}
                respondingRequestIds={respondingRequestIds}
                showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                activeProposedPlan={activeProposedPlan}
                runtimeMode={runtimeMode}
                interactionMode={interactionMode}
                lockedProvider={lockedProvider}
                providerStatuses={providerStatuses as ServerProvider[]}
                activeProjectDefaultModelSelection={activeProject?.defaultModelSelection}
                activeThreadModelSelection={activeThread?.modelSelection}
                mcpServers={selectableMcpServers}
                selectedMcpServerIds={selectedMcpServerIds}
                mcpCompatibilityMessage={mcpCompatibilityMessage}
                mcpChangeNotice={mcpChangeNotice}
                onMcpServerIdsChange={handleMcpServerIdsChange}
                activeThreadActivities={activeThread?.activities}
                resolvedTheme={resolvedTheme}
                settings={settings}
                gitCwd={gitCwd}
                promptRef={promptRef}
                composerImagesRef={composerImagesRef}
                composerTerminalContextsRef={composerTerminalContextsRef}
                shouldAutoScrollRef={isAtEndRef}
                scheduleStickToBottom={scrollToEnd}
                onSend={onSend}
                onInterrupt={onInterrupt}
                onImplementPlanInNewThread={onImplementPlanInNewThread}
                onRespondToApproval={onRespondToApproval}
                onSelectActivePendingUserInputOption={onSelectActivePendingUserInputOption}
                onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
                onPreviousActivePendingUserInputQuestion={onPreviousActivePendingUserInputQuestion}
                onChangeActivePendingUserInputCustomAnswer={
                  onChangeActivePendingUserInputCustomAnswer
                }
                onProviderModelSelect={onProviderModelSelect}
                toggleInteractionMode={toggleInteractionMode}
                handleRuntimeModeChange={handleRuntimeModeChange}
                handleInteractionModeChange={handleInteractionModeChange}
                sidePanelOpen={rightPanel.activeTab !== null}
                sidePanelLabel={sidePanelControlLabel}
                toggleSidePanel={toggleSidePanel}
                focusComposer={focusComposer}
                scheduleComposerFocus={scheduleComposerFocus}
                setThreadError={setThreadError}
                onExpandImage={onExpandTimelineImage}
              />
            </div>

            {isGitRepo && (
              <BranchToolbar
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                {...(routeKind === "draft" && draftId ? { draftId } : {})}
                onEnvModeChange={onEnvModeChange}
                envLocked={envLocked}
                {...(canOverrideServerThreadEnvMode ? { effectiveEnvModeOverride: envMode } : {})}
                {...(canOverrideServerThreadEnvMode
                  ? {
                      activeThreadBranchOverride: activeThreadBranch,
                      onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
                    }
                  : {})}
                onComposerFocusRequest={scheduleComposerFocus}
                {...(canCheckoutPullRequestIntoThread
                  ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                  : {})}
                {...(hasMultipleEnvironments
                  ? {
                      availableEnvironments: logicalProjectEnvironments,
                      onEnvironmentChange,
                    }
                  : {})}
              />
            )}
            {pullRequestDialogState ? (
              <PullRequestThreadDialog
                key={pullRequestDialogState.key}
                open
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                cwd={activeProject?.cwd ?? null}
                initialReference={pullRequestDialogState.initialReference}
                onOpenChange={(open) => {
                  if (!open) {
                    closePullRequestDialog();
                  }
                }}
                onPrepared={handlePreparedPullRequestThread}
              />
            ) : null}
          </div>
          {activeChatTab === "gitdiff" && gitDiffAvailable ? (
            <div className="flex min-h-0 min-w-0 w-full flex-1">
              <Suspense
                fallback={
                  <div className="flex min-h-0 min-w-0 w-full flex-1 items-center justify-center text-sm text-muted-foreground">
                    Loading Git Diff...
                  </div>
                }
              >
                <LazyGitDiffWorkbench embedded threadRef={routeThreadRef} />
              </Suspense>
            </div>
          ) : null}
          {activeThreadKey ? (
            <PersistentThreadTerminalDrawer
              threadRef={routeThreadRef}
              threadId={threadId}
              visible={activeChatTab === "terminal" && terminalState.terminalOpen}
              layoutMode="tab"
              launchContext={activeTerminalLaunchContext ?? null}
              focusRequestId={activeChatTab === "terminal" ? terminalFocusRequestId : 0}
              splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
              newShortcutLabel={newTerminalShortcutLabel ?? undefined}
              closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
              keybindings={keybindings}
              onAddTerminalContext={addTerminalContextToDraft}
            />
          ) : null}
          {editorAvailable && (
            <EditorPane
              visible={activeChatTab === "editor"}
              focusRequestId={editorFocusRequestId}
              keybindings={keybindings}
              terminalOpen={Boolean(terminalState.terminalOpen)}
              cwd={gitCwd}
            />
          )}
        </div>
        {/* end chat column */}

        {/* Right panel tabs (Plan / Diff) and Action Center — desktop inline */}
        {actionCenterOpen && activeProjectRef && !shouldUsePlanSidebarSheet ? (
          <ActionRunCenter
            projectRef={activeProjectRef}
            threadRef={routeThreadRef}
            threadId={threadId}
            keybindings={keybindings}
            onClose={() => setActionCenterOpen(false)}
            onRetry={handleRetryActionRun}
          />
        ) : rightPanel.activeTab !== null && !shouldUsePlanSidebarSheet ? (
          <RightPanelTabs
            planProps={{
              activePlan,
              activeProposedPlan: sidebarProposedPlan,
              label: planSidebarLabel,
              environmentId,
              markdownCwd: gitCwd ?? undefined,
              workspaceRoot: activeWorkspaceRoot,
              timestampFormat,
              onClose: closePlanSidebar,
            }}
          />
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {mountedTerminalThreadRefs
        .filter(({ key: mountedThreadKey }) => mountedThreadKey !== activeThreadKey)
        .map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
          <PersistentThreadTerminalDrawer
            key={mountedThreadKey}
            threadRef={mountedThreadRef}
            threadId={mountedThreadRef.threadId}
            visible={false}
            layoutMode="tab"
            launchContext={null}
            focusRequestId={0}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraft}
          />
        ))}
      {/* Right panel tabs / Action Center — mobile sheet */}
      {shouldUsePlanSidebarSheet ? (
        <RightPanelSheet
          open={actionCenterOpen || rightPanel.activeTab !== null}
          onClose={actionCenterOpen ? () => setActionCenterOpen(false) : closePlanSidebar}
        >
          {actionCenterOpen && activeProjectRef ? (
            <ActionRunCenter
              projectRef={activeProjectRef}
              threadRef={routeThreadRef}
              threadId={threadId}
              keybindings={keybindings}
              mode="sheet"
              onClose={() => setActionCenterOpen(false)}
              onRetry={handleRetryActionRun}
            />
          ) : (
            <RightPanelTabs
              planProps={{
                activePlan,
                activeProposedPlan: sidebarProposedPlan,
                label: planSidebarLabel,
                environmentId,
                markdownCwd: gitCwd ?? undefined,
                workspaceRoot: activeWorkspaceRoot,
                timestampFormat,
                onClose: closePlanSidebar,
              }}
              mode="sheet"
            />
          )}
        </RightPanelSheet>
      ) : null}

      {expandedImage && (
        <ExpandedImageDialog preview={expandedImage} onClose={closeExpandedImage} />
      )}

      {placeholderDialog.script && (
        <PlaceholderInputDialog
          open={placeholderDialog.open}
          onOpenChange={placeholderDialog.onOpenChange}
          script={placeholderDialog.script}
          defaults={placeholderDialog.defaults}
          onRun={placeholderDialog.onRun}
        />
      )}
    </div>
  );
}
