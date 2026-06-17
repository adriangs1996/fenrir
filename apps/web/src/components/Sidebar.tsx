import { autoAnimate } from "@formkit/auto-animate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { type DesktopUpdateState, ProjectId, type ScopedThreadRef } from "@fenrir/contracts";
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@fenrir/client-runtime";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { isElectron } from "../env";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import {
  isTerminalFocused,
  selectThreadTerminalState,
  useTerminalStateStore,
} from "~/modules/terminal";
import { type ProjectDrawerView, useUiStateStore } from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";

import { useThreadActions } from "../hooks/useThreadActions";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { toastManager } from "./ui/toast";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { SidebarSeparator } from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import {
  resolveAdjacentThreadId,
  resolveActiveProjectThreadKeys,
  orderItemsByPreferredIds,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  useThreadJumpHintVisibility,
} from "./Sidebar.logic";
import { SidebarRouteNavFooter } from "./sidebar/SidebarRouteNavFooter";
import { SidebarChromeHeader } from "./sidebar/SidebarChromeHeader";
import { SidebarProjectsContent } from "./sidebar/SidebarProjectsContent";
import type { SidebarProjectSnapshot } from "./sidebar/SidebarProjectItem";
import {
  EMPTY_THREAD_JUMP_LABELS,
  buildThreadJumpLabelMap,
  threadJumpLabelMapsEqual,
} from "./sidebar/threadJumpLabels";
import { useInternalPlanRunnerThreadIds, usePlanRunnerStore } from "~/modules/plan-runner";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "../rpc/serverState";
import { deriveLogicalProjectKey } from "../logicalProject";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  getPrimaryEnvironmentConnection,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { subscribeToLocalServers } from "../localServersStore";
import type { Project, SidebarThreadSummary } from "../types";
import { isUserBrowsableThread } from "../threadVisibility";

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

export default function Sidebar() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const allSidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  // Internal plan-runner threads (executor/reviewer/analyzer/integration) are
  // persisted for log reconstruction but must not be browsable. Strip them
  // from every sidebar surface (project grouping, counts, previews, sorts).
  // See `useInternalPlanRunnerThreadIds` for derivation policy.
  const internalPlanRunnerThreadIds = useInternalPlanRunnerThreadIds();
  const sidebarThreads = useMemo(
    () =>
      allSidebarThreads.filter(
        (thread) => isUserBrowsableThread(thread) && !internalPlanRunnerThreadIds.has(thread.id),
      ),
    [allSidebarThreads, internalPlanRunnerThreadIds],
  );
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const projectDrawerViewByCwd = useUiStateStore((store) => store.projectDrawerViewByCwd);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const sidebarThreadSortOrder = useSettings((s) => s.sidebarThreadSortOrder);
  const sidebarThreadPreviewCount = useSettings((s) => s.sidebarThreadPreviewCount);
  const sidebarProjectSortOrder = useSettings((s) => s.sidebarProjectSortOrder);
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useNewThreadHandler();
  const { archiveThread, deleteThread } = useThreadActions();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  // Plan-runner routes (`/plan-runner/$featureName/...`,
  // `/plan-runner/$runId`) carry no thread, so the existing thread-derived
  // active-project resolution returns null. Pull featureName/runId from the
  // route directly; the projectId fallback below maps them back to the owning
  // project so its sidebar shell stays highlighted while the user is viewing
  // a plan, configure screen, or run view.
  const planRunnerRouteParams = useParams({
    strict: false,
    select: (params: { featureName?: string; runId?: string }) => ({
      featureName: params.featureName ?? null,
      runId: params.runId ?? null,
    }),
  });
  const planRunnerProjectIdFromFeature = usePlanRunnerStore((s): string | null => {
    const featureName = planRunnerRouteParams.featureName;
    if (!featureName) return null;
    for (const key of Object.keys(s.plansByFeatureKey)) {
      if (key.endsWith(`:${featureName}`)) {
        const pid = key.split(":")[0] ?? null;
        if (pid) return pid;
      }
    }
    for (const [pid, features] of Object.entries(s.featuresByProjectId)) {
      if (features.some((f) => f.featureName === featureName)) return pid;
    }
    return null;
  });
  const planRunnerProjectIdFromRun = usePlanRunnerStore((s): string | null => {
    const runId = planRunnerRouteParams.runId;
    if (!runId) return null;
    return s.runById[runId]?.projectId ?? null;
  });
  // Draft routes (`/draft/$draftId`) carry no thread or project params, so the
  // existing thread-derived active-project resolution returns null. Pull the
  // draftId from the route, look up the draft session, and surface its
  // `logicalProjectKey` so the owning project's sidebar shell stays
  // highlighted while drafting a new thread.
  const routeDraftId = useParams({
    strict: false,
    select: (params: { draftId?: string }) => params.draftId ?? null,
  });
  const draftRouteLogicalProjectKey = useComposerDraftStore((store) => {
    if (!routeDraftId) return null;
    const session = store.getDraftSession(DraftId.make(routeDraftId));
    return session?.logicalProjectKey ?? null;
  });
  const keybindings = useServerKeybindings();
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const openAddProjectCommandPalette = useCommandPaletteStore((state) => state.openAddProject);
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironmentConnection = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection();
    } catch {
      return null;
    }
  }, []);
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const project of orderedProjects) {
      const physicalKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
      mapping.set(physicalKey, deriveLogicalProjectKey(project));
    }
    return mapping;
  }, [orderedProjects]);

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    // Group projects by logical key while preserving insertion order from
    // orderedProjects.
    const groupedMembers = new Map<string, Project[]>();
    for (const project of orderedProjects) {
      const logicalKey = deriveLogicalProjectKey(project);
      const existing = groupedMembers.get(logicalKey);
      if (existing) {
        existing.push(project);
      } else {
        groupedMembers.set(logicalKey, [project]);
      }
    }

    const result: SidebarProjectSnapshot[] = [];
    const seen = new Set<string>();
    for (const project of orderedProjects) {
      const logicalKey = deriveLogicalProjectKey(project);
      if (seen.has(logicalKey)) continue;
      seen.add(logicalKey);

      const members = groupedMembers.get(logicalKey)!;
      // Prefer the primary environment's project as the representative.
      const representative: Project | undefined =
        (primaryEnvironmentId
          ? members.find((p) => p.environmentId === primaryEnvironmentId)
          : undefined) ?? members[0];
      if (!representative) continue;
      const hasLocal =
        primaryEnvironmentId !== null &&
        members.some((p) => p.environmentId === primaryEnvironmentId);
      const hasRemote =
        primaryEnvironmentId !== null
          ? members.some((p) => p.environmentId !== primaryEnvironmentId)
          : false;

      const refs = members.map((p) => scopeProjectRef(p.environmentId, p.id));
      const remoteLabels = members
        .filter((p) => primaryEnvironmentId !== null && p.environmentId !== primaryEnvironmentId)
        .map((p) => {
          const rt = savedEnvironmentRuntimeById[p.environmentId];
          const saved = savedEnvironmentRegistry[p.environmentId];
          return rt?.descriptor?.label ?? saved?.label ?? p.environmentId;
        });
      const snapshot: SidebarProjectSnapshot = {
        id: representative.id,
        environmentId: representative.environmentId,
        name: representative.name,
        cwd: representative.cwd,
        repositoryIdentity: representative.repositoryIdentity ?? null,
        defaultModelSelection: representative.defaultModelSelection,
        createdAt: representative.createdAt,
        updatedAt: representative.updatedAt,
        scripts: representative.scripts,
        managedProcesses: representative.managedProcesses,
        globalScriptDefaults: representative.globalScriptDefaults,
        projectKey: logicalKey,
        environmentPresence:
          hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
        memberProjectRefs: refs,
        remoteEnvironmentLabels: remoteLabels,
      };
      result.push(snapshot);
    }
    return result;
  }, [
    orderedProjects,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  //
  // Resolution order (first match wins):
  //   1. Thread route → owning project of the active thread.
  //   2. Plan-runner run route (`$runId`) → projectId from the run snapshot.
  //   3. Plan-runner feature route (`$featureName`) → projectId from the
  //      plan-runner feature/plan caches via `useFeatureProjectId` semantics.
  // For (2) and (3) we have a projectId but not an environmentId, so we
  // resolve to a logical key by scanning the already-grouped sidebarProjects
  // list for any member whose `id` matches.
  const activeRouteProjectKey = useMemo(() => {
    if (routeThreadKey) {
      const activeThread = sidebarThreadByKey.get(routeThreadKey);
      if (activeThread) {
        const physicalKey = scopedProjectKey(
          scopeProjectRef(activeThread.environmentId, activeThread.projectId),
        );
        return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      }
    }
    const planRunnerProjectId = planRunnerProjectIdFromRun ?? planRunnerProjectIdFromFeature;
    if (planRunnerProjectId) {
      for (const project of sidebarProjects) {
        if (project.memberProjectRefs.some((ref) => ref.projectId === planRunnerProjectId)) {
          return project.projectKey;
        }
      }
    }
    if (draftRouteLogicalProjectKey && sidebarProjectByKey.has(draftRouteLogicalProjectKey)) {
      return draftRouteLogicalProjectKey;
    }
    return null;
  }, [
    routeThreadKey,
    sidebarThreadByKey,
    physicalToLogicalKey,
    planRunnerProjectIdFromRun,
    planRunnerProjectIdFromFeature,
    sidebarProjects,
    draftRouteLogicalProjectKey,
    sidebarProjectByKey,
  ]);
  const activeRouteProjectDrawerView: ProjectDrawerView | null =
    planRunnerProjectIdFromRun || planRunnerProjectIdFromFeature
      ? "plans"
      : routeThreadKey || routeDraftId
        ? "threads"
        : null;

  // Group threads by logical project key so all threads from grouped projects
  // are displayed together.
  const threadsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarThreadSummary[]>();
    for (const thread of sidebarThreads) {
      const physicalKey = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(thread);
      } else {
        next.set(logicalKey, [thread]);
      }
    }
    return next;
  }, [sidebarThreads, physicalToLogicalKey]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeThreadRef
        ? selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadKey,
            routeThreadRef,
          ).terminalOpen
        : false,
    }),
    [routeThreadRef],
  );
  const newThreadShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", newThreadShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", newThreadShortcutLabelOptions);
  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, navigate, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.projectKey === active.id);
      const overProject = sidebarProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      // Use physical scoped keys (what projectOrder stores), not logical keys.
      // For grouped projects, move all member physical keys together.
      // Target only needs one physical key to anchor the insertion position;
      // the representative's key is always present in projectOrder.
      const draggedPhysicalKeys = activeProject.memberProjectRefs.map(scopedProjectKey);
      const targetPhysicalKey = scopedProjectKey(
        scopeProjectRef(overProject.environmentId, overProject.id),
      );
      reorderProjects(draggedPhysicalKeys, targetPhysicalKey);
    },
    [sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.map((thread) => {
      const physicalKey = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      return {
        ...thread,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    sidebarProjectByKey,
    sidebarProjects,
    visibleThreads,
  ]);
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const visibleSidebarThreadKeys = useMemo(
    () =>
      sortedProjects.flatMap((project) => {
        const projectThreads = sortThreadsForSidebar(
          (threadsByProjectKey.get(project.projectKey) ?? []).filter(
            (thread) => thread.archivedAt === null,
          ),
          sidebarThreadSortOrder,
        );
        const projectExpanded = projectExpandedById[project.cwd] ?? false;
        const activeThreadKey = routeThreadKey ?? undefined;
        const pinnedCollapsedThread =
          !projectExpanded && activeThreadKey
            ? (projectThreads.find(
                (thread) =>
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                  activeThreadKey,
              ) ?? null)
            : null;
        const shouldShowThreadPanel = projectExpanded || pinnedCollapsedThread !== null;
        if (!shouldShowThreadPanel) {
          return [];
        }
        const projectDrawerView =
          pinnedCollapsedThread !== null
            ? "threads"
            : activeRouteProjectKey === project.projectKey && routeThreadKey !== null
              ? (projectDrawerViewByCwd[project.cwd] ?? "threads")
              : "threads";
        if (projectDrawerView !== "threads") {
          return [];
        }
        const isThreadListExpanded = expandedThreadListsByProject.has(project.projectKey);
        const hasOverflowingThreads = projectThreads.length > sidebarThreadPreviewCount;
        const previewThreads =
          isThreadListExpanded || !hasOverflowingThreads
            ? projectThreads
            : projectThreads.slice(0, sidebarThreadPreviewCount);
        const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : previewThreads;
        return renderedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        );
      }),
    [
      sidebarThreadPreviewCount,
      sidebarThreadSortOrder,
      expandedThreadListsByProject,
      activeRouteProjectKey,
      projectExpandedById,
      projectDrawerViewByCwd,
      routeThreadKey,
      sortedProjects,
      threadsByProjectKey,
    ],
  );
  const activeProjectThreadKeys = useMemo(
    () =>
      resolveActiveProjectThreadKeys({
        activeProjectKey: activeRouteProjectKey,
        threadsByProjectKey,
        sortOrder: sidebarThreadSortOrder,
        getThreadKey: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      }),
    [activeRouteProjectKey, sidebarThreadSortOrder, threadsByProjectKey],
  );
  const threadJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadKey] of visibleSidebarThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadKeys]);
  const threadJumpThreadKeys = useMemo(
    () => [...threadJumpCommandByKey.keys()],
    [threadJumpCommandByKey],
  );
  const [threadJumpLabelByKey, setThreadJumpLabelByKey] =
    useState<ReadonlyMap<string, string>>(EMPTY_THREAD_JUMP_LABELS);
  const threadJumpLabelsRef = useRef<ReadonlyMap<string, string>>(EMPTY_THREAD_JUMP_LABELS);
  threadJumpLabelsRef.current = threadJumpLabelByKey;
  const showThreadJumpHintsRef = useRef(showThreadJumpHints);
  showThreadJumpHintsRef.current = showThreadJumpHints;
  const visibleThreadJumpLabelByKey = showThreadJumpHints
    ? threadJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;

  useEffect(() => {
    const clearThreadJumpHints = () => {
      setThreadJumpLabelByKey((current) =>
        current === EMPTY_THREAD_JUMP_LABELS ? current : EMPTY_THREAD_JUMP_LABELS,
      );
      updateThreadJumpHintsVisibility(false);
    };
    const shouldIgnoreThreadJumpHintUpdate = (event: globalThis.KeyboardEvent) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key !== "Meta" &&
      event.key !== "Control" &&
      event.key !== "Alt" &&
      event.key !== "Shift" &&
      !showThreadJumpHintsRef.current &&
      threadJumpLabelsRef.current === EMPTY_THREAD_JUMP_LABELS;

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (shouldIgnoreThreadJumpHintUpdate(event)) {
        return;
      }
      const shortcutContext = getCurrentSidebarShortcutContext();
      const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      if (!shouldShowHints) {
        if (
          showThreadJumpHintsRef.current ||
          threadJumpLabelsRef.current !== EMPTY_THREAD_JUMP_LABELS
        ) {
          clearThreadJumpHints();
        }
      } else {
        setThreadJumpLabelByKey((current) => {
          const nextLabelMap = buildThreadJumpLabelMap({
            keybindings,
            platform,
            terminalOpen: shortcutContext.terminalOpen,
            threadJumpCommandByKey,
          });
          return threadJumpLabelMapsEqual(current, nextLabelMap) ? current : nextLabelMap;
        });
        updateThreadJumpHintsVisibility(true);
      }

      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (commandPaletteOpen) {
        clearThreadJumpHints();
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadKey = resolveAdjacentThreadId({
          threadIds: activeProjectThreadKeys,
          currentThreadId: routeThreadKey,
          direction: traversalDirection,
        });
        if (!targetThreadKey) {
          return;
        }
        const targetThread = sidebarThreadByKey.get(targetThreadKey);
        if (!targetThread) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadKey = threadJumpThreadKeys[jumpIndex];
      if (!targetThreadKey) {
        return;
      }
      const targetThread = sidebarThreadByKey.get(targetThreadKey);
      if (!targetThread) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
    };

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (shouldIgnoreThreadJumpHintUpdate(event)) {
        return;
      }
      const shortcutContext = getCurrentSidebarShortcutContext();
      const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      if (!shouldShowHints) {
        clearThreadJumpHints();
        return;
      }
      setThreadJumpLabelByKey((current) => {
        const nextLabelMap = buildThreadJumpLabelMap({
          keybindings,
          platform,
          terminalOpen: shortcutContext.terminalOpen,
          threadJumpCommandByKey,
        });
        return threadJumpLabelMapsEqual(current, nextLabelMap) ? current : nextLabelMap;
      });
      updateThreadJumpHintsVisibility(true);
    };

    const onWindowBlur = () => {
      clearThreadJumpHints();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    getCurrentSidebarShortcutContext,
    keybindings,
    navigateToThread,
    activeProjectThreadKeys,
    platform,
    routeThreadKey,
    sidebarThreadByKey,
    threadJumpCommandByKey,
    threadJumpThreadKeys,
    updateThreadJumpHintsVisibility,
    commandPaletteOpen,
  ]);

  useEffect(() => {
    if (!isElectron || !primaryEnvironmentConnection) {
      return;
    }

    return subscribeToLocalServers({
      client: primaryEnvironmentConnection.client,
      environmentId: primaryEnvironmentConnection.environmentId,
    });
  }, [primaryEnvironmentConnection]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!useThreadSelectionStore.getState().hasSelection()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarProjectsContent
            showArm64IntelBuildWarning={showArm64IntelBuildWarning}
            arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
            desktopUpdateButtonAction={desktopUpdateButtonAction}
            desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
            handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
            projectSortOrder={sidebarProjectSortOrder}
            threadSortOrder={sidebarThreadSortOrder}
            threadPreviewCount={sidebarThreadPreviewCount}
            updateSettings={updateSettings}
            openAddProject={openAddProjectCommandPalette}
            isManualProjectSorting={isManualProjectSorting}
            projectDnDSensors={projectDnDSensors}
            projectCollisionDetection={projectCollisionDetection}
            handleProjectDragStart={handleProjectDragStart}
            handleProjectDragEnd={handleProjectDragEnd}
            handleProjectDragCancel={handleProjectDragCancel}
            handleNewThread={handleNewThread}
            archiveThread={archiveThread}
            deleteThread={deleteThread}
            sortedProjects={sortedProjects}
            expandedThreadListsByProject={expandedThreadListsByProject}
            activeRouteProjectKey={activeRouteProjectKey}
            activeRouteProjectDrawerView={activeRouteProjectDrawerView}
            routeThreadKey={routeThreadKey}
            newThreadShortcutLabel={newThreadShortcutLabel}
            threadJumpLabelByKey={visibleThreadJumpLabelByKey}
            attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
            expandThreadListForProject={expandThreadListForProject}
            collapseThreadListForProject={collapseThreadListForProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
            projectsLength={projects.length}
          />

          <SidebarSeparator />
          <SidebarRouteNavFooter />
        </>
      )}
    </>
  );
}
