import {
  ChevronRightIcon,
  CloudIcon,
  FolderTreeIcon,
  FolderIcon,
  MessagesSquareIcon,
  SquarePenIcon,
  WorkflowIcon,
} from "lucide-react";
import { ProjectFavicon } from "../ProjectFavicon";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadEnvMode,
  ThreadId,
} from "@fenrir/contracts";
import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@fenrir/client-runtime";
import { useRouter } from "@tanstack/react-router";
import {
  type SidebarThreadPreviewCount,
  type SidebarThreadSortOrder,
} from "@fenrir/contracts/settings";
import { cn, isMacPlatform, newCommandId } from "../../lib/utils";
import {
  selectSidebarThreadsForProjectRef,
  selectSidebarThreadsForProjectRefs,
  selectThreadByRef,
  useStore,
} from "../../store";
import { type ProjectDrawerView, useUiStateStore } from "../../uiStateStore";
import { runLocalRpc } from "../../hooks/useRpc";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";

import { useThreadActions } from "../../hooks/useThreadActions";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import {
  isContextMenuPointerDown,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  resolveThreadStatusPill,
  resolveProjectDrawerPresentation,
  sortThreadsForSidebar,
} from "../Sidebar.logic";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { PlanRunnerProjectSection, useInternalPlanRunnerThreadIds } from "~/modules/plan-runner";
import { ProjectFileExplorer } from "~/modules/project-files";
import { readEnvironmentApi } from "../../environmentApi";
import { useSettings } from "~/hooks/useSettings";
import type { Project, SidebarThreadSummary } from "../../types";
import { SidebarProjectThreadList } from "./SidebarProjectThreadList";
import { isUserBrowsableThread } from "../../threadVisibility";

export type EnvironmentPresence = "local-only" | "remote-only" | "mixed";

export type SidebarProjectSnapshot = Project & {
  projectKey: string;
  environmentPresence: EnvironmentPresence;
  memberProjectRefs: readonly ScopedProjectRef[];
  /** Labels for remote environments this project lives in. */
  remoteEnvironmentLabels: readonly string[];
};

interface ProjectDrawerRailButtonProps {
  view: ProjectDrawerView;
  activeView: ProjectDrawerView;
  label: string;
  shortcutLabel: string;
  children: React.ReactNode;
  onSelect: (view: ProjectDrawerView) => void;
}

const ProjectDrawerRailButton = memo(function ProjectDrawerRailButton({
  view,
  activeView,
  label,
  shortcutLabel,
  children,
  onSelect,
}: ProjectDrawerRailButtonProps) {
  const selected = activeView === view;
  const handleClick = useCallback(() => {
    onSelect(view);
  }, [onSelect, view]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={selected}
            data-thread-selection-safe
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-[10px] font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "text-white"
                : "text-muted-foreground/60 hover:bg-accent/70 hover:text-foreground/85",
            )}
            onClick={handleClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">
        {label} <span className="text-muted-foreground/70">({shortcutLabel})</span>
      </TooltipPopup>
    </Tooltip>
  );
});

export interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  activeRouteProjectDrawerView: ProjectDrawerView | null;
  isActiveProject: boolean;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
}

export const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const {
    project,
    isThreadListExpanded,
    activeRouteThreadKey,
    activeRouteProjectDrawerView,
    isActiveProject,
    newThreadShortcutLabel,
    handleNewThread,
    archiveThread,
    deleteThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
  } = props;
  const threadSortOrder = useSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const sidebarThreadPreviewCount = useSettings<SidebarThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const appSettingsConfirmThreadDelete = useSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const appSettingsConfirmThreadArchive = useSettings<boolean>(
    (settings) => settings.confirmThreadArchive,
  );
  const defaultThreadEnvMode = useSettings<ThreadEnvMode>(
    (settings) => settings.defaultThreadEnvMode,
  );
  const router = useRouter();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const toggleProject = useUiStateStore((state) => state.toggleProject);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const clearComposerDraftForThread = useComposerDraftStore((state) => state.clearDraftThread);
  const getDraftThreadByProjectRef = useComposerDraftStore(
    (state) => state.getDraftThreadByProjectRef,
  );
  const clearProjectDraftThreadId = useComposerDraftStore(
    (state) => state.clearProjectDraftThreadId,
  );
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    void runLocalRpc((api) => api.shell.openExternal(prUrl), {
      unavailableToast: { title: "Link opening is unavailable." },
      errorToast: { title: "Unable to open PR link" },
    });
  }, []);
  const sidebarThreads = useStore(
    useShallow(
      useMemo(
        () => (state: import("../../store").AppState) =>
          selectSidebarThreadsForProjectRef(
            state,
            scopeProjectRef(project.environmentId, project.id),
          ),
        [project.environmentId, project.id],
      ),
    ),
  );
  // For grouped projects that span multiple environments, also fetch
  // threads from the other member project refs.
  const otherMemberRefs = useMemo(
    () =>
      project.memberProjectRefs.filter(
        (ref) => ref.environmentId !== project.environmentId || ref.projectId !== project.id,
      ),
    [project.memberProjectRefs, project.environmentId, project.id],
  );
  const otherMemberThreads = useStore(
    useShallow(
      useMemo(
        () =>
          otherMemberRefs.length === 0
            ? () => [] as SidebarThreadSummary[]
            : (state: import("../../store").AppState) =>
                selectSidebarThreadsForProjectRefs(state, otherMemberRefs),
        [otherMemberRefs],
      ),
    ),
  );
  const internalPlanRunnerThreadIds = useInternalPlanRunnerThreadIds();
  const projectThreadsIncludingHidden = useMemo(
    () =>
      otherMemberThreads.length === 0 ? sidebarThreads : [...sidebarThreads, ...otherMemberThreads],
    [sidebarThreads, otherMemberThreads],
  );
  const allSidebarThreads = useMemo(() => {
    return projectThreadsIncludingHidden.filter(
      (thread) => isUserBrowsableThread(thread) && !internalPlanRunnerThreadIds.has(thread.id),
    );
  }, [projectThreadsIncludingHidden, internalPlanRunnerThreadIds]);
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        allSidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [allSidebarThreads],
  );
  // All threads from the representative + other member environments are
  // already fetched into allSidebarThreads, so we can use them directly.
  const projectThreads = allSidebarThreads;
  const hiddenProjectThreadCount = projectThreadsIncludingHidden.length - projectThreads.length;
  const projectExpanded = useUiStateStore(
    (state) => state.projectExpandedById[project.cwd] ?? false,
  );
  const projectDrawerView = useUiStateStore(
    (state) => state.projectDrawerViewByCwd[project.cwd] ?? "threads",
  );
  const setProjectDrawerView = useUiStateStore((state) => state.setProjectDrawerView);
  const handleProjectDrawerViewSelect = useCallback(
    (view: ProjectDrawerView) => {
      setProjectDrawerView(project.cwd, view);
    },
    [project.cwd, setProjectDrawerView],
  );
  const threadLastVisitedAts = useUiStateStore(
    useShallow((state) =>
      projectThreads.map(
        (thread) =>
          state.threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ] ?? null,
      ),
    ),
  );
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const { projectStatus, visibleProjectThreads, orderedProjectThreadKeys } = useMemo(() => {
    const lastVisitedAtByThreadKey = new Map(
      projectThreads.map((thread, index) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        threadLastVisitedAts[index] ?? null,
      ]),
    );
    const resolveProjectThreadStatus = (thread: SidebarThreadSummary) => {
      const lastVisitedAt = lastVisitedAtByThreadKey.get(
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      return resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const visibleProjectThreads = sortThreadsForSidebar(
      projectThreads.filter((thread) => thread.archivedAt === null),
      threadSortOrder,
    );
    const projectStatus = resolveProjectStatusIndicator(
      visibleProjectThreads.map((thread) => resolveProjectThreadStatus(thread)),
    );
    return {
      orderedProjectThreadKeys: visibleProjectThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
      projectStatus,
      visibleProjectThreads,
    };
  }, [projectThreads, threadLastVisitedAts, threadSortOrder]);

  const pinnedCollapsedThread = useMemo(() => {
    const activeThreadKey = activeRouteThreadKey ?? undefined;
    if (!activeThreadKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);
  useEffect(() => {
    if (!isActiveProject || activeRouteProjectDrawerView === null) {
      return;
    }
    setProjectDrawerView(project.cwd, activeRouteProjectDrawerView);
  }, [activeRouteProjectDrawerView, isActiveProject, project.cwd, setProjectDrawerView]);
  const {
    effectiveProjectDrawerView,
    renderedProjectDrawerView,
    shouldShowProjectDrawerPanel,
    shouldShowProjectDrawerRail,
  } = resolveProjectDrawerPresentation({
    activeRouteProjectDrawerView,
    hasActiveThreadRoute: activeRouteThreadKey !== null,
    hasPinnedCollapsedThread: pinnedCollapsedThread !== null,
    projectDrawerView,
    projectExpanded,
  });
  const activeRouteThreadForProject = useMemo(() => {
    if (!activeRouteThreadKey) {
      return null;
    }
    const activeThread = sidebarThreadByKey.get(activeRouteThreadKey);
    if (!activeThread) {
      return null;
    }
    return projectThreads.some(
      (projectThread) =>
        projectThread.environmentId === activeThread.environmentId &&
        projectThread.id === activeThread.id,
    )
      ? activeThread
      : null;
  }, [activeRouteThreadKey, projectThreads, sidebarThreadByKey]);
  const fileExplorerEnvironmentId =
    activeRouteThreadForProject?.environmentId ?? project.environmentId;
  const fileExplorerWorkspaceRoot = activeRouteThreadForProject?.worktreePath ?? project.cwd;

  const {
    hasOverflowingThreads,
    hiddenThreadStatus,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
  } = useMemo(() => {
    const lastVisitedAtByThreadKey = new Map(
      projectThreads.map((thread, index) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        threadLastVisitedAts[index] ?? null,
      ]),
    );
    const resolveProjectThreadStatus = (thread: SidebarThreadSummary) => {
      const lastVisitedAt = lastVisitedAtByThreadKey.get(
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      return resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const hasOverflowingThreads = visibleProjectThreads.length > sidebarThreadPreviewCount;
    const previewThreads =
      isThreadListExpanded || !hasOverflowingThreads
        ? visibleProjectThreads
        : visibleProjectThreads.slice(0, sidebarThreadPreviewCount);
    const visibleThreadKeys = new Set(
      [...previewThreads, ...(pinnedCollapsedThread ? [pinnedCollapsedThread] : [])].map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    const renderedThreads = pinnedCollapsedThread
      ? [pinnedCollapsedThread]
      : visibleProjectThreads.filter((thread) =>
          visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
        );
    const hiddenThreads = visibleProjectThreads.filter(
      (thread) =>
        !visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    return {
      hasOverflowingThreads,
      hiddenThreadStatus: resolveProjectStatusIndicator(
        hiddenThreads.map((thread) => resolveProjectThreadStatus(thread)),
      ),
      renderedThreads,
      showEmptyThreadState: projectExpanded && visibleProjectThreads.length === 0,
      shouldShowThreadPanel: shouldShowProjectDrawerPanel,
    };
  }, [
    isThreadListExpanded,
    pinnedCollapsedThread,
    projectExpanded,
    shouldShowProjectDrawerPanel,
    projectThreads,
    sidebarThreadPreviewCount,
    threadLastVisitedAts,
    visibleProjectThreads,
  ]);

  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (useThreadSelectionStore.getState().hasSelection()) {
        clearSelection();
      }
      toggleProject(project.cwd);
    },
    [
      clearSelection,
      dragInProgressRef,
      project.cwd,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
      toggleProject,
    ],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      toggleProject(project.cwd);
    },
    [dragInProgressRef, project.cwd, toggleProject],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const removeProject = useCallback(
    async (options: { readonly force?: boolean } = {}) => {
      const projectRefs =
        project.memberProjectRefs.length > 0
          ? project.memberProjectRefs
          : [scopeProjectRef(project.environmentId, project.id)];

      for (const projectRef of projectRefs) {
        const projectDraftThread = getDraftThreadByProjectRef(projectRef);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.draftId);
        }
        clearProjectDraftThreadId(projectRef);
        const projectApi = readEnvironmentApi(projectRef.environmentId);
        if (!projectApi) {
          throw new Error("Project API unavailable.");
        }
        await projectApi.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId: projectRef.projectId,
          ...(options.force === true ? { force: true } : {}),
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadId,
      getDraftThreadByProjectRef,
      project.environmentId,
      project.id,
      project.memberProjectRefs,
    ],
  );

  const showProjectDeleteError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error removing project.";
      console.error("Failed to remove project", {
        projectId: project.id,
        error,
      });
      toastManager.add({
        type: "error",
        title: `Failed to remove "${project.name}"`,
        description: message,
      });
    },
    [project.id, project.name],
  );

  const showNonEmptyProjectToast = useCallback(
    (description: string) => {
      toastManager.add({
        type: "warning",
        title: "Project is not empty",
        description,
        actionProps: {
          children: "Delete anyway",
          onClick: () => {
            void removeProject({ force: true }).catch(showProjectDeleteError);
          },
        },
        data: {
          actionLayout: "stacked-end",
          actionVariant: "destructive-outline",
        },
      });
    },
    [removeProject, showProjectDeleteError],
  );

  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      void (async () => {
        const clicked = await runLocalRpc((api) =>
          api.contextMenu.show(
            [
              { id: "copy-path", label: "Copy Project Path" },
              { id: "delete", label: "Remove project", destructive: true },
            ],
            {
              x: event.clientX,
              y: event.clientY,
            },
          ),
        );
        if (clicked === "copy-path") {
          copyPathToClipboard(project.cwd, { path: project.cwd });
          return;
        }
        if (clicked !== "delete") return;

        if (projectThreads.length > 0) {
          const threadLabel = projectThreads.length === 1 ? "thread" : "threads";
          showNonEmptyProjectToast(
            `Delete anyway will permanently delete ${projectThreads.length} ${threadLabel} in this project.`,
          );
          return;
        }

        const confirmMessage =
          hiddenProjectThreadCount > 0
            ? [
                `Remove project "${project.name}"?`,
                `${
                  hiddenProjectThreadCount === 1
                    ? "1 background thread"
                    : `${hiddenProjectThreadCount} background threads`
                } will be deleted too.`,
              ].join("\n")
            : `Remove project "${project.name}"?`;
        const confirmed = await runLocalRpc((api) => api.dialogs.confirm(confirmMessage));
        if (!confirmed) return;

        const shouldForceProjectDelete =
          hiddenProjectThreadCount > 0 || project.memberProjectRefs.length > 1;
        try {
          await removeProject({ force: shouldForceProjectDelete });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("cannot be deleted without force=true")
          ) {
            showNonEmptyProjectToast(
              "Delete anyway will permanently delete the threads still attached to this project.",
            );
            return;
          }
          showProjectDeleteError(error);
        }
      })();
    },
    [
      copyPathToClipboard,
      hiddenProjectThreadCount,
      project.cwd,
      project.memberProjectRefs.length,
      project.name,
      projectThreads.length,
      removeProject,
      showNonEmptyProjectToast,
      showProjectDeleteError,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, router, setSelectionAnchor],
  );

  const handleThreadClick = useCallback(
    (
      event: React.MouseEvent,
      threadRef: ScopedThreadRef,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, rangeSelectTo, router, setSelectionAnchor, toggleThreadSelection],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;

      const clicked = await runLocalRpc((api) =>
        api.contextMenu.show(
          [
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );

      if (clicked === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = sidebarThreadByKey.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmThreadDelete) {
        const confirmed = await runLocalRpc((api) =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
          ),
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      for (const threadKey of threadKeys) {
        const thread = sidebarThreadByKey.get(threadKey);
        if (!thread) continue;
        await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
          deletedThreadKeys,
        });
      }
      removeFromSelection(threadKeys);
    },
    [
      appSettingsConfirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      sidebarThreadByKey,
    ],
  );

  const handleCreateProjectDraftClick = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      options?: {
        initialPrompt?: string;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const currentRouteParams =
        router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRouteTarget = resolveThreadRouteTarget(currentRouteParams);
      const currentActiveThread =
        currentRouteTarget?.kind === "server"
          ? (selectThreadByRef(useStore.getState(), currentRouteTarget.threadRef) ?? null)
          : null;
      const draftStore = useComposerDraftStore.getState();
      const currentActiveDraftThread =
        currentRouteTarget?.kind === "server"
          ? (draftStore.getDraftThread(currentRouteTarget.threadRef) ?? null)
          : currentRouteTarget?.kind === "draft"
            ? (draftStore.getDraftSession(currentRouteTarget.draftId) ?? null)
            : null;
      const seedContext = resolveSidebarNewThreadSeedContext({
        projectId: project.id,
        defaultEnvMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode: defaultThreadEnvMode,
        }),
        activeThread:
          currentActiveThread && currentActiveThread.projectId === project.id
            ? {
                projectId: currentActiveThread.projectId,
                branch: currentActiveThread.branch,
                worktreePath: currentActiveThread.worktreePath,
              }
            : null,
        activeDraftThread:
          currentActiveDraftThread && currentActiveDraftThread.projectId === project.id
            ? {
                projectId: currentActiveDraftThread.projectId,
                branch: currentActiveDraftThread.branch,
                worktreePath: currentActiveDraftThread.worktreePath,
                envMode: currentActiveDraftThread.envMode,
              }
            : null,
      });
      void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
        ...(seedContext.worktreePath !== undefined
          ? { worktreePath: seedContext.worktreePath }
          : {}),
        envMode: seedContext.envMode,
        ...(options?.initialPrompt !== undefined ? { initialPrompt: options.initialPrompt } : {}),
      });
    },
    [defaultThreadEnvMode, handleNewThread, project.environmentId, project.id, router],
  );

  const handleCreateThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handleCreateProjectDraftClick(event);
    },
    [handleCreateProjectDraftClick],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      try {
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to archive thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [archiveThread],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const threadKey = scopedThreadKey(threadRef);
      const thread =
        projectThreads.find(
          (projectThread) =>
            projectThread.environmentId === threadRef.environmentId &&
            projectThread.id === threadRef.threadId,
        ) ?? null;
      if (!thread) return;
      const threadWorkspacePath = thread.worktreePath ?? project.cwd ?? null;
      const clicked = await runLocalRpc((api) =>
        api.contextMenu.show(
          [
            { id: "rename", label: "Rename thread" },
            { id: "mark-unread", label: "Mark unread" },
            { id: "copy-path", label: "Copy Path" },
            { id: "copy-thread-id", label: "Copy Thread ID" },
            { id: "delete", label: "Delete", destructive: true },
          ],
          position,
        ),
      );

      if (clicked === "rename") {
        setRenamingThreadKey(threadKey);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettingsConfirmThreadDelete) {
        const confirmed = await runLocalRpc((api) =>
          api.dialogs.confirm(
            [
              `Delete thread "${thread.title}"?`,
              "This permanently clears conversation history for this thread.",
            ].join("\n"),
          ),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadRef);
    },
    [
      appSettingsConfirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      project.cwd,
      projectThreads,
    ],
  );

  return (
    <>
      <div className="group/project-header relative">
        <SidebarMenuButton
          ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
          size="sm"
          className={`gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${
            isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
          }`}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
          onPointerDownCapture={handleProjectButtonPointerDownCapture}
          onClick={handleProjectButtonClick}
          onKeyDown={handleProjectButtonKeyDown}
          onContextMenu={handleProjectButtonContextMenu}
        >
          {!projectExpanded && projectStatus ? (
            <span
              aria-hidden="true"
              title={projectStatus.label}
              className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
            >
              <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                <span
                  className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                    projectStatus.pulse ? "animate-pulse" : ""
                  }`}
                />
              </span>
              <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
            </span>
          ) : (
            <ChevronRightIcon
              className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                projectExpanded ? "rotate-90" : ""
              }`}
            />
          )}
          {isActiveProject ? (
            <FolderIcon className="size-3.5 shrink-0 text-primary" />
          ) : (
            <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
          )}
          <span
            className={cn(
              "flex-1 truncate transition-[color,font-size,font-weight] duration-150",
              isActiveProject
                ? "text-sm font-bold text-primary"
                : "text-xs font-medium text-foreground/90",
            )}
          >
            {project.name}
          </span>
        </SidebarMenuButton>
        {/* Environment badge – visible by default, crossfades with the
            "new thread" button on hover using the same pointer-events +
            opacity pattern as the thread row archive/timestamp swap. */}
        {project.environmentPresence === "remote-only" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={
                    project.environmentPresence === "remote-only"
                      ? "Remote project"
                      : "Available in multiple environments"
                  }
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/50 transition-opacity duration-150 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0"
                />
              }
            >
              <CloudIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Remote environment: {project.remoteEnvironmentLabels.join(", ")}
            </TooltipPopup>
          </Tooltip>
        )}
        <div className="pointer-events-none absolute top-1 right-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Create new thread in ${project.name}`}
                  data-testid="new-thread-button"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={handleCreateThreadClick}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">
              {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {shouldShowThreadPanel && (
        <div
          data-thread-selection-safe
          className={cn(
            "ml-3 my-0 grid min-w-0 overflow-hidden rounded-md bg-sidebar",
            shouldShowProjectDrawerRail ? "grid-cols-[2rem_minmax(0,1fr)]" : "grid-cols-1",
          )}
        >
          {shouldShowProjectDrawerRail ? (
            <div
              aria-label={`${project.name} project drawer`}
              aria-orientation="vertical"
              role="toolbar"
              className="flex flex-col items-center gap-1 border-r border-l border-border/20 p-1"
            >
              <ProjectDrawerRailButton
                view="threads"
                activeView={effectiveProjectDrawerView}
                label={`Show ${project.name} threads`}
                shortcutLabel="T"
                onSelect={handleProjectDrawerViewSelect}
              >
                <MessagesSquareIcon className="size-3.5" />
              </ProjectDrawerRailButton>
              <ProjectDrawerRailButton
                view="plans"
                activeView={effectiveProjectDrawerView}
                label={`Show ${project.name} action plans`}
                shortcutLabel="P"
                onSelect={handleProjectDrawerViewSelect}
              >
                <WorkflowIcon className="size-3.5" />
              </ProjectDrawerRailButton>
              <ProjectDrawerRailButton
                view="files"
                activeView={effectiveProjectDrawerView}
                label={`Show ${project.name} files`}
                shortcutLabel="F"
                onSelect={handleProjectDrawerViewSelect}
              >
                <FolderTreeIcon className="size-3.5" />
              </ProjectDrawerRailButton>
            </div>
          ) : null}

          <div className="min-w-0 py-1 pr-1">
            {renderedProjectDrawerView === "threads" ? (
              <SidebarProjectThreadList
                className="mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0"
                projectKey={project.projectKey}
                projectExpanded={projectExpanded}
                hasOverflowingThreads={hasOverflowingThreads}
                hiddenThreadStatus={hiddenThreadStatus}
                orderedProjectThreadKeys={orderedProjectThreadKeys}
                renderedThreads={renderedThreads}
                showEmptyThreadState={showEmptyThreadState}
                shouldShowThreadPanel={shouldShowThreadPanel}
                isThreadListExpanded={isThreadListExpanded}
                projectCwd={project.cwd}
                activeRouteThreadKey={activeRouteThreadKey}
                threadJumpLabelByKey={threadJumpLabelByKey}
                appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
                renamingThreadKey={renamingThreadKey}
                renamingTitle={renamingTitle}
                setRenamingTitle={setRenamingTitle}
                renamingInputRef={renamingInputRef}
                renamingCommittedRef={renamingCommittedRef}
                confirmingArchiveThreadKey={confirmingArchiveThreadKey}
                setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
                confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                handleThreadClick={handleThreadClick}
                navigateToThread={navigateToThread}
                handleMultiSelectContextMenu={handleMultiSelectContextMenu}
                handleThreadContextMenu={handleThreadContextMenu}
                clearSelection={clearSelection}
                commitRename={commitRename}
                cancelRename={cancelRename}
                attemptArchiveThread={attemptArchiveThread}
                openPrLink={openPrLink}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
              />
            ) : renderedProjectDrawerView === "plans" ? (
              <PlanRunnerProjectSection
                className="mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0"
                layout="drawer"
                projectId={project.id}
                projectCwd={project.cwd}
              />
            ) : (
              <ProjectFileExplorer
                className="mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0"
                environmentId={fileExplorerEnvironmentId}
                projectName={project.name}
                workspaceRoot={fileExplorerWorkspaceRoot}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
});

// Active-project highlight is now expressed inline on the project header
// (icon + name colored with `--primary`, name bumped to `text-sm font-bold`)
// instead of boxing the whole shell. The wrapper class helper is kept as a
// no-op so existing call sites and the `data-active-project` hook continue to
// work without churn at the call sites.
function projectShellClass(_isActive: boolean, extra?: string): string {
  return cn(extra);
}

export const SidebarProjectListRow = memo(function SidebarProjectListRow(
  props: SidebarProjectItemProps,
) {
  return (
    <SidebarMenuItem
      className={projectShellClass(props.isActiveProject)}
      data-active-project={props.isActiveProject ? "true" : undefined}
    >
      <SidebarProjectItem {...props} />
    </SidebarMenuItem>
  );
});

export type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

export function SortableProjectItem({
  projectId,
  disabled = false,
  isActive = false,
  children,
}: {
  projectId: string;
  disabled?: boolean;
  isActive?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/menu-item relative",
        projectShellClass(isActive),
        isDragging && "z-20 opacity-80",
        isOver && !isDragging && "ring-1 ring-primary/40",
      )}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      data-active-project={isActive ? "true" : undefined}
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}
