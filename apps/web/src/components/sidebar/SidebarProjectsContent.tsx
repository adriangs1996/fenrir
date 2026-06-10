import { ArrowUpDownIcon, FolderPlusIcon, TriangleAlertIcon } from "lucide-react";
import React, { useCallback, memo } from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  type DragStartEvent,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  type SidebarProjectSortOrder,
  type SidebarThreadPreviewCount,
  type SidebarThreadSortOrder,
} from "@fenrir/contracts/settings";
import type { ProjectDrawerView } from "../../uiStateStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";

import { useThreadActions } from "../../hooks/useThreadActions";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarContent, SidebarGroup, SidebarMenu } from "../ui/sidebar";
import { useUpdateSettings } from "~/hooks/useSettings";
import {
  SidebarProjectItem,
  SidebarProjectListRow,
  SortableProjectItem,
  type SidebarProjectSnapshot,
} from "./SidebarProjectItem";

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

function clampSidebarThreadPreviewCount(value: number): SidebarThreadPreviewCount {
  return Math.min(
    MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
    Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, Math.round(value)),
  ) as SidebarThreadPreviewCount;
}

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  threadPreviewCount,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
  onThreadPreviewCountChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  threadPreviewCount: SidebarThreadPreviewCount;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  onThreadPreviewCountChange: (count: SidebarThreadPreviewCount) => void;
}) {
  const updateThreadPreviewCount = useCallback(
    (delta: number) => {
      onThreadPreviewCountChange(clampSidebarThreadPreviewCount(threadPreviewCount + delta));
    },
    [onThreadPreviewCountChange, threadPreviewCount],
  );

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sidebar options</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Visible threads
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Button
              size="xs"
              variant="outline"
              aria-label="Decrease visible thread count"
              disabled={threadPreviewCount <= MIN_SIDEBAR_THREAD_PREVIEW_COUNT}
              onClick={() => updateThreadPreviewCount(-1)}
            >
              -
            </Button>
            <div className="min-w-8 text-center text-xs tabular-nums text-foreground/85">
              {threadPreviewCount}
            </div>
            <Button
              size="xs"
              variant="outline"
              aria-label="Increase visible thread count"
              disabled={threadPreviewCount >= MAX_SIDEBAR_THREAD_PREVIEW_COUNT}
              onClick={() => updateThreadPreviewCount(1)}
            >
              +
            </Button>
          </div>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  handleDesktopUpdateButtonClick: () => void;
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  threadPreviewCount: SidebarThreadPreviewCount;
  updateSettings: ReturnType<typeof useUpdateSettings>["updateSettings"];
  openAddProject: () => void;
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  sortedProjects: readonly SidebarProjectSnapshot[];
  expandedThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  activeRouteProjectDrawerView: ProjectDrawerView | null;
  routeThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectsLength: number;
}

export const SidebarProjectsContent = memo(function SidebarProjectsContent(
  props: SidebarProjectsContentProps,
) {
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    handleDesktopUpdateButtonClick,
    projectSortOrder,
    threadSortOrder,
    threadPreviewCount,
    updateSettings,
    openAddProject,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    sortedProjects,
    expandedThreadListsByProject,
    activeRouteProjectKey,
    activeRouteProjectDrawerView,
    routeThreadKey,
    newThreadShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
    projectsLength,
  } = props;

  const handleProjectSortOrderChange = useCallback(
    (sortOrder: SidebarProjectSortOrder) => {
      updateSettings({ sidebarProjectSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleThreadSortOrderChange = useCallback(
    (sortOrder: SidebarThreadSortOrder) => {
      updateSettings({ sidebarThreadSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleThreadPreviewCountChange = useCallback(
    (count: SidebarThreadPreviewCount) => {
      updateSettings({ sidebarThreadPreviewCount: count });
    },
    [updateSettings],
  );

  return (
    <SidebarContent className="gap-0">
      {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
        <SidebarGroup className="px-2 pt-2 pb-0">
          <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
            <TriangleAlertIcon />
            <AlertTitle>Intel build on Apple Silicon</AlertTitle>
            <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
            {desktopUpdateButtonAction !== "none" ? (
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={desktopUpdateButtonDisabled}
                  onClick={handleDesktopUpdateButtonClick}
                >
                  {desktopUpdateButtonAction === "download"
                    ? "Download ARM build"
                    : "Install ARM build"}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </SidebarGroup>
      ) : null}
      <SidebarGroup className="px-2 py-2">
        <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <ProjectSortMenu
              projectSortOrder={projectSortOrder}
              threadSortOrder={threadSortOrder}
              threadPreviewCount={threadPreviewCount}
              onProjectSortOrderChange={handleProjectSortOrderChange}
              onThreadSortOrderChange={handleThreadSortOrderChange}
              onThreadPreviewCountChange={handleThreadPreviewCountChange}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add project"
                    data-testid="sidebar-add-project-trigger"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={openAddProject}
                  />
                }
              >
                <FolderPlusIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">Add project</TooltipPopup>
            </Tooltip>
          </div>
        </div>

        {isManualProjectSorting ? (
          <DndContext
            sensors={projectDnDSensors}
            collisionDetection={projectCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <SidebarMenu>
              <SortableContext
                items={sortedProjects.map((project) => project.projectKey)}
                strategy={verticalListSortingStrategy}
              >
                {sortedProjects.map((project) => (
                  <SortableProjectItem
                    key={project.projectKey}
                    projectId={project.projectKey}
                    isActive={activeRouteProjectKey === project.projectKey}
                  >
                    {(dragHandleProps) => (
                      <SidebarProjectItem
                        project={project}
                        isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                        activeRouteThreadKey={
                          activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                        }
                        activeRouteProjectDrawerView={
                          activeRouteProjectKey === project.projectKey
                            ? activeRouteProjectDrawerView
                            : null
                        }
                        isActiveProject={activeRouteProjectKey === project.projectKey}
                        newThreadShortcutLabel={newThreadShortcutLabel}
                        handleNewThread={handleNewThread}
                        archiveThread={archiveThread}
                        deleteThread={deleteThread}
                        threadJumpLabelByKey={threadJumpLabelByKey}
                        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                        expandThreadListForProject={expandThreadListForProject}
                        collapseThreadListForProject={collapseThreadListForProject}
                        dragInProgressRef={dragInProgressRef}
                        suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                        suppressProjectClickForContextMenuRef={
                          suppressProjectClickForContextMenuRef
                        }
                        isManualProjectSorting={isManualProjectSorting}
                        dragHandleProps={dragHandleProps}
                      />
                    )}
                  </SortableProjectItem>
                ))}
              </SortableContext>
            </SidebarMenu>
          </DndContext>
        ) : (
          <SidebarMenu ref={attachProjectListAutoAnimateRef}>
            {sortedProjects.map((project) => (
              <SidebarProjectListRow
                key={project.projectKey}
                project={project}
                isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                activeRouteThreadKey={
                  activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                }
                activeRouteProjectDrawerView={
                  activeRouteProjectKey === project.projectKey ? activeRouteProjectDrawerView : null
                }
                isActiveProject={activeRouteProjectKey === project.projectKey}
                newThreadShortcutLabel={newThreadShortcutLabel}
                handleNewThread={handleNewThread}
                archiveThread={archiveThread}
                deleteThread={deleteThread}
                threadJumpLabelByKey={threadJumpLabelByKey}
                attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                expandThreadListForProject={expandThreadListForProject}
                collapseThreadListForProject={collapseThreadListForProject}
                dragInProgressRef={dragInProgressRef}
                suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                isManualProjectSorting={isManualProjectSorting}
                dragHandleProps={null}
              />
            ))}
          </SidebarMenu>
        )}

        {projectsLength === 0 && (
          <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
            No projects yet
          </div>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
});
