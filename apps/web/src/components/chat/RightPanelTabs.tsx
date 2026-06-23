import { DiffIcon, ListTodoIcon, WorkflowIcon } from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { EnvironmentId, ProjectId, ThreadId, WorkflowRunId } from "@fenrir/contracts";
import type { TimestampFormat } from "@fenrir/contracts/settings";
import { Schema } from "effect";
import { cn } from "~/lib/utils";
import {
  selectRightPanelActiveTab,
  useRightPanelStore,
  type RightPanelTab,
} from "../../rightPanelStore";
import { Button } from "../ui/button";
import PlanSidebar from "../PlanSidebar";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../DiffPanelShell";
import type { ActivePlanState, LatestProposedPlanState } from "../../session-logic";
import {
  RIGHT_PANEL_WIDTH_STORAGE_KEY,
  clampRightPanelWidth,
  resolveDefaultRightPanelWidth,
} from "../../rightPanelLayout";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { WorkflowPanel } from "~/modules/workflows";

const DiffPanel = lazy(() => import("../DiffPanel"));

function DiffLoadingFallback(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

export interface RightPanelTabsPlanProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  label: string;
  environmentId: EnvironmentId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  onClose: () => void;
}

export interface RightPanelTabsWorkflowProps {
  projectId: ProjectId | null;
  originThreadId: ThreadId | null;
  initialRunId?: WorkflowRunId | undefined;
  onClose: () => void;
}

interface TabButtonProps {
  tab: RightPanelTab;
  icon: ElementType;
  label: string;
  onActiveClose?: () => void;
  threadKey: string;
}

const TabButton = memo(function TabButton({
  tab,
  icon: Icon,
  label,
  onActiveClose,
  threadKey,
}: TabButtonProps) {
  const activeTab = useRightPanelStore((state) => selectRightPanelActiveTab(state, threadKey));
  const toggleTab = useRightPanelStore((state) => state.toggleTab);
  const isActive = activeTab === tab;
  const handleClick = useCallback(() => {
    if (isActive && onActiveClose) {
      onActiveClose();
      return;
    }
    toggleTab(threadKey, tab);
  }, [isActive, onActiveClose, tab, threadKey, toggleTab]);

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={handleClick}
      className={cn(
        "shrink-0 gap-1.5 rounded-none border-b-2 px-2 sm:px-3",
        isActive
          ? "border-blue-400 text-blue-400 hover:text-blue-300"
          : "border-transparent text-muted-foreground/70 hover:text-foreground/80",
      )}
      aria-selected={isActive}
      role="tab"
    >
      <Icon className="size-3.5" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  );
});

interface RightPanelTabsProps {
  planProps: RightPanelTabsPlanProps;
  workflowProps: RightPanelTabsWorkflowProps;
  threadKey: string;
  /**
   * "sidebar" = desktop inline panel with resizable width.
   * "sheet" = mobile sheet overlay (full width).
   */
  mode?: "sidebar" | "sheet";
}

export const RightPanelTabs = memo(function RightPanelTabs({
  planProps,
  workflowProps,
  threadKey,
  mode = "sidebar",
}: RightPanelTabsProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    moved: boolean;
    pendingWidth: number;
    pointerId: number;
    rafId: number | null;
    startWidth: number;
    startX: number;
    width: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const activeTab = useRightPanelStore((state) => selectRightPanelActiveTab(state, threadKey));
  const diffPanelMode: DiffPanelMode = mode === "sheet" ? "sheet" : "sidebar";

  // Keep DiffPanel mounted once it's first opened so scroll position and
  // virtualizer state are preserved when switching between tabs.
  const [diffEverOpened, setDiffEverOpened] = useState(false);
  useEffect(() => {
    if (activeTab === "diff") {
      setDiffEverOpened(true);
    }
  }, [activeTab]);

  const applySidebarWidth = useCallback((nextWidth: number | null) => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    if (nextWidth === null) {
      panel.style.removeProperty("width");
      return;
    }
    panel.style.width = `${nextWidth}px`;
  }, []);

  useEffect(() => {
    if (mode !== "sidebar") {
      setSidebarWidth(null);
      return;
    }

    const panel = panelRef.current;
    const wrapper = panel?.parentElement;
    if (!panel || !wrapper) {
      return;
    }

    const storedWidth = getLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, Schema.Finite);
    const initialWidth = clampRightPanelWidth(
      storedWidth ?? resolveDefaultRightPanelWidth(wrapper.clientWidth),
      wrapper.clientWidth,
    );
    applySidebarWidth(initialWidth);
    setSidebarWidth(initialWidth);
  }, [applySidebarWidth, mode]);

  useEffect(() => {
    if (mode !== "sidebar") {
      return;
    }

    const panel = panelRef.current;
    const wrapper = panel?.parentElement;
    if (!panel || !wrapper) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = clampRightPanelWidth(
        sidebarWidth ?? resolveDefaultRightPanelWidth(wrapper.clientWidth),
        wrapper.clientWidth,
      );
      applySidebarWidth(nextWidth);
      setSidebarWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    });
    resizeObserver.observe(wrapper);

    return () => {
      resizeObserver.disconnect();
    };
  }, [applySidebarWidth, mode, sidebarWidth]);

  const stopResize = useCallback(() => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }
    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId);
    }
    resizeStateRef.current = null;
    setSidebarWidth(resizeState.width);
    setLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, resizeState.width, Schema.Finite);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.rafId != null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (mode !== "sidebar" || event.button !== 0) {
        return;
      }

      const panel = panelRef.current;
      const wrapper = panel?.parentElement;
      if (!panel || !wrapper) {
        return;
      }

      const initialWidth = clampRightPanelWidth(
        panel.getBoundingClientRect().width,
        wrapper.clientWidth,
      );
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        moved: false,
        pendingWidth: initialWidth,
        pointerId: event.pointerId,
        rafId: null,
        startWidth: initialWidth,
        startX: event.clientX,
        width: initialWidth,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [mode],
  );

  const handleResizePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    const panel = panelRef.current;
    const wrapper = panel?.parentElement;
    if (!resizeState || resizeState.pointerId !== event.pointerId || !panel || !wrapper) {
      return;
    }

    event.preventDefault();
    const delta = resizeState.startX - event.clientX;
    if (Math.abs(delta) > 2) {
      resizeState.moved = true;
    }
    resizeState.pendingWidth = clampRightPanelWidth(
      resizeState.startWidth + delta,
      wrapper.clientWidth,
    );
    if (resizeState.rafId !== null) {
      return;
    }

    resizeState.rafId = window.requestAnimationFrame(() => {
      const activeResizeState = resizeStateRef.current;
      const activePanel = panelRef.current;
      if (!activeResizeState || !activePanel) {
        return;
      }

      activeResizeState.rafId = null;
      activeResizeState.width = activeResizeState.pendingWidth;
      activePanel.style.width = `${activeResizeState.width}px`;
    });
  }, []);

  const endResizeInteraction = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      suppressClickRef.current = resizeState.moved;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopResize();
    },
    [stopResize],
  );

  const handleResizeClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!suppressClickRef.current) {
      return;
    }
    suppressClickRef.current = false;
    event.preventDefault();
  }, []);

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex h-full flex-col bg-card/50",
        mode === "sidebar"
          ? "w-[min(42vw,44rem)] min-w-0 shrink-0 border-l border-border/70"
          : "min-w-0 flex-1",
      )}
      style={
        mode === "sidebar" && sidebarWidth !== null ? { width: `${sidebarWidth}px` } : undefined
      }
    >
      {mode === "sidebar" ? (
        <button
          aria-label="Resize right panel"
          className="absolute inset-y-0 left-0 z-20 hidden w-4 -translate-x-1/2 cursor-e-resize md:flex after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-border/0 after:transition-colors hover:after:bg-border/80"
          onClick={handleResizeClick}
          onPointerCancel={endResizeInteraction}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeInteraction}
          tabIndex={-1}
          title="Drag to resize panel"
          type="button"
        />
      ) : null}

      {/* Tab bar */}
      <div role="tablist" className="flex h-10 shrink-0 items-end border-b border-border/60 px-1">
        <TabButton
          tab="plan"
          icon={ListTodoIcon}
          label="Plan"
          onActiveClose={planProps.onClose}
          threadKey={threadKey}
        />
        <TabButton tab="workflows" icon={WorkflowIcon} label="Workflows" threadKey={threadKey} />
        <TabButton tab="diff" icon={DiffIcon} label="Diff" threadKey={threadKey} />
      </div>

      {/* Tab content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Plan tab */}
        <div className={cn("h-full", activeTab !== "plan" && "hidden")}>
          <PlanSidebar
            activePlan={planProps.activePlan}
            activeProposedPlan={planProps.activeProposedPlan}
            label={planProps.label}
            environmentId={planProps.environmentId}
            markdownCwd={planProps.markdownCwd}
            workspaceRoot={planProps.workspaceRoot}
            timestampFormat={planProps.timestampFormat}
            onClose={planProps.onClose}
          />
        </div>

        {/* Workflows tab */}
        <div className={cn("h-full", activeTab !== "workflows" && "hidden")}>
          <WorkflowPanel
            projectId={workflowProps.projectId}
            originThreadId={workflowProps.originThreadId}
            initialRunId={workflowProps.initialRunId}
            onClose={workflowProps.onClose}
          />
        </div>

        {/* Diff tab */}
        <div className={cn("h-full", activeTab !== "diff" && "hidden")}>
          {diffEverOpened ? (
            <DiffWorkerPoolProvider>
              <Suspense fallback={<DiffLoadingFallback mode={diffPanelMode} />}>
                <DiffPanel mode={diffPanelMode} />
              </Suspense>
            </DiffWorkerPoolProvider>
          ) : null}
        </div>
      </div>
    </div>
  );
});
