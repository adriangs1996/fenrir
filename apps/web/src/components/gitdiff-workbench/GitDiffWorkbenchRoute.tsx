import { parseDiffFromFile, parsePatchFiles } from "@pierre/diffs";
import {
  FileDiff,
  type FileContents,
  type FileDiffMetadata,
  type HunkSeparators,
  Virtualizer,
} from "@pierre/diffs/react";
import {
  buildTerminalFontFamily,
  type DiffTarget,
  type GitDiffFileSummary,
  type GitDiffStackStep,
  type LoadDiffFileResult,
  type ScopedThreadRef,
} from "@fenrir/contracts";
import { LegendList } from "@legendapp/list/react";
import {
  prepareFileTreeInput,
  type FileTreeRowDecorationRenderer,
  type GitStatusEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  Columns2Icon,
  FileTextIcon,
  GitBranchIcon,
  GitCompareIcon,
  HashIcon,
  HighlighterIcon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  SeparatorHorizontalIcon,
  TextWrapIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import {
  gitDiffFileQueryOptions,
  gitDiffFileIndexQueryOptions,
  gitDiffStackedFileIndexQueryOptions,
  invalidateGitDiffQueries,
} from "~/lib/gitDiffReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { cn } from "~/lib/utils";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { resolveThreadRouteRef } from "~/threadRoutes";

const STACK_BASE_REF = "main";
const GIT_DIFF_FILE_TREE_ROW_HEIGHT = 24;
const GIT_DIFF_FILE_TREE_MIN_VISIBLE_ROWS = 4;
const GIT_DIFF_FILE_TREE_MAX_VISIBLE_ROWS = 18;
const GIT_DIFF_SIDEBAR_SECTION_HEADER_HEIGHT = 44;
const GIT_DIFF_SIDEBAR_RESIZE_HANDLE_HEIGHT = 10;
const GIT_DIFF_SIDEBAR_STACK_DEFAULT_HEIGHT = 520;
const GIT_DIFF_SIDEBAR_STACK_MIN_HEIGHT = 144;
const GIT_DIFF_SIDEBAR_FILES_MIN_HEIGHT = 120;

const GIT_DIFF_FILE_TREE_STYLE = {
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--accent)",
  "--trees-border-color-override": "transparent",
  "--trees-border-radius-override": "6px",
  "--trees-fg-override": "var(--muted-foreground)",
  "--trees-fg-muted-override": "color-mix(in srgb, var(--muted-foreground) 64%, transparent)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "12px",
  "--trees-font-weight-regular-override": "500",
  "--trees-icon-width-override": "14px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-padding-x-override": "6px",
  "--trees-item-row-gap-override": "6px",
  "--trees-level-gap-override": "10px",
  "--trees-padding-inline-override": "0px",
  "--trees-scrollbar-gutter-override": "6px",
  "--trees-scrollbar-thumb-override": "color-mix(in srgb, var(--border) 78%, transparent)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  "--trees-status-added-override": "var(--success)",
  "--trees-status-deleted-override": "var(--destructive)",
  "--trees-status-modified-override": "var(--info)",
  "--trees-status-renamed-override": "var(--warning)",
} as CSSProperties;

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";
type DiffLineHighlightMode = "inline" | "none";
type BuiltInHunkSeparators = Exclude<HunkSeparators, "custom">;
type GitDiffFileDiffOptions = NonNullable<ComponentProps<typeof FileDiff>["options"]>;

const HUNK_SEPARATOR_LABELS: Record<BuiltInHunkSeparators, string> = {
  "line-info": "Line info",
  "line-info-basic": "Basic",
  metadata: "Metadata",
  simple: "Simple",
};

type RenderablePatch =
  | {
      readonly kind: "files";
      readonly files: readonly FileDiffMetadata[];
    }
  | {
      readonly kind: "raw";
      readonly text: string;
      readonly reason: string;
    };

function buildGitDiffWorkbenchUnsafeCSS(fontFamily: string, fontSize: number): string {
  return `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 93%, var(--foreground));
  background-color: var(--diffs-bg) !important;
  font-family: ${fontFamily} !important;
  font-size: ${fontSize}px !important;
}

${DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS}

[data-diffs-header],
[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-expand-button] {
  cursor: pointer;
}
`;
}

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "git-diff-workbench",
): RenderablePatch | null {
  const normalizedPatch = patch?.trim() ?? "";
  if (normalizedPatch.length === 0) {
    return null;
  }

  try {
    const files = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    ).flatMap((parsedPatch) => parsedPatch.files);

    return files.length > 0
      ? { kind: "files", files }
      : {
          kind: "raw",
          text: normalizedPatch,
          reason: "Unsupported diff format. Showing raw patch.",
        };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function makeDiffFileContents(input: {
  readonly path: string;
  readonly contents: string;
  readonly cacheScope: string;
}): FileContents {
  return {
    name: input.path,
    contents: input.contents,
    cacheKey: buildPatchCacheKey(`${input.path}\0${input.contents}`, input.cacheScope),
  };
}

function formatError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    return typeof message === "string" && message.trim().length > 0
      ? message
      : "Failed to load Git diff.";
  }
  return "Failed to load Git diff.";
}

function sortFiles(files: readonly GitDiffFileSummary[]): readonly GitDiffFileSummary[] {
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampStackSectionHeight(height: number, sidebarHeight: number): number {
  const maxHeight = Math.max(
    GIT_DIFF_SIDEBAR_STACK_MIN_HEIGHT,
    sidebarHeight -
      GIT_DIFF_SIDEBAR_SECTION_HEADER_HEIGHT * 2 -
      GIT_DIFF_SIDEBAR_RESIZE_HANDLE_HEIGHT -
      GIT_DIFF_SIDEBAR_FILES_MIN_HEIGHT,
  );

  return clampNumber(height, GIT_DIFF_SIDEBAR_STACK_MIN_HEIGHT, maxHeight);
}

function totalInsertions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.insertions, 0);
}

function totalDeletions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.deletions, 0);
}

function changedFileStatusText(file: GitDiffFileSummary): string {
  if (file.binary) return "Binary";
  if (file.previousPath) return "Renamed";
  if (file.insertions > 0 && file.deletions > 0) return "Modified";
  if (file.insertions > 0) return "Added";
  if (file.deletions > 0) return "Removed";
  return "Changed";
}

function changedFileGitStatus(file: GitDiffFileSummary): GitStatusEntry["status"] {
  if (file.previousPath) return "renamed";
  if (file.insertions > 0 && file.deletions === 0) return "added";
  if (file.deletions > 0 && file.insertions === 0) return "deleted";
  return "modified";
}

function changedFileDecoration(file: GitDiffFileSummary): string {
  return file.binary ? "binary" : `+${file.insertions} -${file.deletions}`;
}

function changedFileTitle(file: GitDiffFileSummary): string {
  if (file.previousPath) {
    return `${file.previousPath} -> ${file.path}`;
  }
  return changedFileStatusText(file);
}

function collectParentDirectoryPaths(path: string, directories: Set<string>): void {
  const segments = path.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments.slice(0, -1)) {
    currentPath = currentPath.length === 0 ? segment : `${currentPath}/${segment}`;
    directories.add(`${currentPath}/`);
  }
}

function buildChangedFilesTreeData(files: readonly GitDiffFileSummary[]) {
  const directories = new Set<string>();
  const filePathSet = new Set<string>();
  const gitStatus: GitStatusEntry[] = [];
  const decorationByPath = new Map<string, { text: string; title: string }>();

  for (const file of files) {
    collectParentDirectoryPaths(file.path, directories);
    filePathSet.add(file.path);
    gitStatus.push({ path: file.path, status: changedFileGitStatus(file) });
    decorationByPath.set(file.path, {
      text: changedFileDecoration(file),
      title: changedFileTitle(file),
    });
  }

  const paths = [...directories, ...filePathSet].toSorted((left, right) =>
    left.localeCompare(right),
  );

  return {
    decorationByPath,
    directoryPaths: [...directories],
    filePathSet,
    gitStatus,
    paths,
    preparedInput: prepareFileTreeInput(paths, { flattenEmptyDirectories: true }),
    visibleRowCount: paths.length,
  };
}

function sortStackSteps(steps: readonly GitDiffStackStep[]): readonly GitDiffStackStep[] {
  return steps.toSorted((left, right) => left.index - right.index);
}

function branchTitle(branchName: string): string {
  const withoutRef = branchName.replace(/^refs\/heads\//, "");
  const withoutNamespace = withoutRef.replace(
    /^(feature|feat|fix|bugfix|chore|refactor|test)\//,
    "",
  );
  const words = withoutNamespace.split(/[./_-]+/).filter(Boolean);
  const specialWords = new Map([
    ["api", "API"],
    ["cli", "CLI"],
    ["ui", "UI"],
  ]);

  if (words.length === 0) {
    return withoutRef;
  }

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      const special = specialWords.get(lower);
      if (special) return special;
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function stackStepLabel(step: GitDiffStackStep, totalSteps: number): string {
  return step.index === totalSteps ? "Current" : "Stacked";
}

type GitDiffStackSidebarItem =
  | { readonly kind: "base-branch"; readonly baseRef: string }
  | { readonly kind: "stack-step"; readonly step: GitDiffStackStep };

function gitDiffStackSidebarItemKey(item: GitDiffStackSidebarItem): string {
  switch (item.kind) {
    case "base-branch":
      return `base:${item.baseRef}`;
    case "stack-step":
      return `stack-step:${item.step.index}:${item.step.branchName}:${item.step.headRef}`;
  }
}

type GitDiffSidebarResizeState = {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  pendingHeight: number;
  height: number;
  rafId: number | null;
};

export function GitDiffWorkbenchRoute() {
  const params = useParams({ from: "/_chat/$environmentId/$threadId/gitdiff" });
  const threadRef = useMemo(() => resolveThreadRouteRef(params), [params]);

  return <GitDiffWorkbench threadRef={threadRef} />;
}

export function GitDiffWorkbench(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly embedded?: boolean;
}) {
  const { embedded = false, threadRef } = props;
  const thread = useStore((state) => selectThreadByRef(state, threadRef));
  const project = useStore((state) =>
    selectProjectByRef(
      state,
      thread
        ? {
            environmentId: thread.environmentId,
            projectId: thread.projectId,
          }
        : null,
    ),
  );
  const queryClient = useQueryClient();
  const environmentId = threadRef?.environmentId ?? null;
  const cwd = thread?.worktreePath ?? project?.cwd ?? null;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStackIndex, setSelectedStackIndex] = useState<number | null>(null);
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("split");
  const [diffWordWrap, setDiffWordWrap] = useState(false);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(false);
  const [diffLineNumbers, setDiffLineNumbers] = useState(true);
  const [diffLineHighlightMode, setDiffLineHighlightMode] =
    useState<DiffLineHighlightMode>("inline");
  const [diffHunkSeparators, setDiffHunkSeparators] = useState<BuiltInHunkSeparators>("line-info");
  const [stackSectionOpen, setStackSectionOpen] = useState(true);
  const [filesSectionOpen, setFilesSectionOpen] = useState(true);
  const [stackSectionHeight, setStackSectionHeight] = useState(
    GIT_DIFF_SIDEBAR_STACK_DEFAULT_HEIGHT,
  );
  const sidebarRef = useRef<HTMLElement | null>(null);
  const stackSectionRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStateRef = useRef<GitDiffSidebarResizeState | null>(null);
  const gitStatus = useGitStatus({ environmentId, cwd });
  const { resolvedTheme, syntaxTheme } = useTheme();
  const settings = useSettings();
  const headRef = gitStatus.data?.branch ?? thread?.branch ?? null;
  const diffUnsafeCSS = useMemo(
    () =>
      buildGitDiffWorkbenchUnsafeCSS(
        buildTerminalFontFamily(settings.terminalFontFamily),
        settings.terminalFontSize,
      ),
    [settings.terminalFontFamily, settings.terminalFontSize],
  );

  const worktreeQuery = useQuery(
    gitDiffFileIndexQueryOptions({ environmentId, cwd, targetKind: "worktree" }),
  );
  const stackQuery = useQuery(
    gitDiffStackedFileIndexQueryOptions({
      environmentId,
      cwd,
      baseRef: STACK_BASE_REF,
      headRef,
    }),
  );
  const worktreeFiles = useMemo(() => sortFiles(worktreeQuery.data ?? []), [worktreeQuery.data]);
  const stackSteps = useMemo(() => sortStackSteps(stackQuery.data?.steps ?? []), [stackQuery.data]);
  const selectedStackStep =
    stackSteps.find((step) => step.index === selectedStackIndex) ?? stackSteps.at(-1) ?? null;
  const activeFiles = useMemo(
    () => sortFiles(selectedStackStep?.files ?? worktreeFiles),
    [selectedStackStep, worktreeFiles],
  );
  const selectedFile =
    activeFiles.find((file) => file.path === selectedPath) ?? activeFiles[0] ?? null;
  const activeDiffTarget = useMemo<DiffTarget | null>(
    () =>
      selectedStackStep
        ? {
            kind: "range",
            baseRef: selectedStackStep.baseRef,
            headRef: selectedStackStep.headRef,
          }
        : { kind: "worktree" },
    [selectedStackStep],
  );
  const selectedFileQuery = useQuery(
    gitDiffFileQueryOptions({
      environmentId,
      cwd,
      target: activeDiffTarget,
      path: selectedFile?.path ?? null,
      previousPath: selectedFile?.previousPath ?? null,
      enabled: selectedFile !== null && !selectedFile.binary,
    }),
  );
  const insertionCount = totalInsertions(activeFiles);
  const deletionCount = totalDeletions(activeFiles);
  const isStackView = selectedStackStep !== null;
  const isDiffFetching =
    worktreeQuery.isFetching || stackQuery.isFetching || selectedFileQuery.isFetching;
  const baseRef = stackQuery.data?.baseRef ?? STACK_BASE_REF;
  const stackSidebarItems = useMemo<readonly GitDiffStackSidebarItem[]>(() => {
    if (stackSteps.length === 0) return [];

    return [
      { kind: "base-branch", baseRef },
      ...stackSteps.map((step) => ({ kind: "stack-step" as const, step })),
    ];
  }, [baseRef, stackSteps]);

  const renderStackSidebarItem = useCallback(
    ({ item }: { readonly item: GitDiffStackSidebarItem }) => {
      switch (item.kind) {
        case "base-branch":
          return (
            <div className="relative px-3 py-2">
              <div className="absolute bottom-0 left-7 top-10 w-px bg-border" />
              <div className="relative flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                  <GitBranchIcon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.baseRef}</span>
                  <span className="block truncate text-xs text-muted-foreground">base branch</span>
                </span>
              </div>
            </div>
          );

        case "stack-step": {
          const selected = selectedStackStep?.index === item.step.index;
          const stepInsertions = totalInsertions(item.step.files);
          const stepDeletions = totalDeletions(item.step.files);

          return (
            <div className="relative px-3 py-1">
              <div className="absolute bottom-0 left-7 top-0 w-px bg-border" />
              <button
                key={`${item.step.index}:${item.step.branchName}:${item.step.headRef}`}
                aria-pressed={selected}
                className={[
                  "relative flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                  selected ? "bg-accent text-foreground" : "hover:bg-accent/50",
                ].join(" ")}
                type="button"
                onClick={() => setSelectedStackIndex(item.step.index)}
              >
                <span
                  className={[
                    "flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-semibold tabular-nums",
                    selected
                      ? "border-primary/70 text-primary"
                      : "border-border text-muted-foreground",
                  ].join(" ")}
                >
                  {item.step.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {branchTitle(item.step.branchName)}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                    <span className="truncate text-muted-foreground">
                      {stackStepLabel(item.step, stackSteps.length)}
                    </span>
                    <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{stepInsertions}
                    </span>
                    <span className="shrink-0 tabular-nums text-rose-600 dark:text-rose-400">
                      -{stepDeletions}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          );
        }
      }
    },
    [selectedStackStep, stackSteps.length],
  );

  const stopSidebarResize = useCallback(() => {
    const resizeState = sidebarResizeStateRef.current;
    if (!resizeState) return;

    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId);
    }

    setStackSectionHeight(resizeState.height);
    sidebarResizeStateRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    return () => {
      const resizeState = sidebarResizeStateRef.current;
      if (resizeState?.rafId != null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      setStackSectionHeight((currentHeight) =>
        clampStackSectionHeight(currentHeight, sidebar.clientHeight),
      );
    });
    resizeObserver.observe(sidebar);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!stackSectionOpen || !filesSectionOpen || event.button !== 0) return;

      const sidebar = sidebarRef.current;
      const stackSection = stackSectionRef.current;
      if (!sidebar || !stackSection) return;

      const initialHeight = clampStackSectionHeight(
        stackSection.getBoundingClientRect().height || stackSectionHeight,
        sidebar.clientHeight,
      );

      event.preventDefault();
      event.stopPropagation();
      sidebarResizeStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: initialHeight,
        pendingHeight: initialHeight,
        height: initialHeight,
        rafId: null,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [filesSectionOpen, stackSectionHeight, stackSectionOpen],
  );

  const handleSidebarResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = sidebarResizeStateRef.current;
      const sidebar = sidebarRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId || !sidebar) return;

      event.preventDefault();
      resizeState.pendingHeight = clampStackSectionHeight(
        resizeState.startHeight + event.clientY - resizeState.startY,
        sidebar.clientHeight,
      );

      if (resizeState.rafId !== null) return;
      resizeState.rafId = window.requestAnimationFrame(() => {
        const activeResizeState = sidebarResizeStateRef.current;
        if (!activeResizeState) return;

        activeResizeState.rafId = null;
        activeResizeState.height = activeResizeState.pendingHeight;
        setStackSectionHeight(activeResizeState.height);
      });
    },
    [],
  );

  const handleSidebarResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopSidebarResize();
    },
    [stopSidebarResize],
  );

  const filesEmptyMessage =
    stackSteps.length > 0 ? "No files changed in this step." : "No tracked working tree changes.";
  const filesSectionContent =
    worktreeQuery.isLoading && stackSteps.length === 0 ? (
      <div className="px-3 py-4 text-sm text-muted-foreground">Loading changes...</div>
    ) : activeFiles.length > 0 ? (
      <div className="min-h-0 flex-1 px-3 pb-3">
        <ChangedFilesTree
          files={activeFiles}
          selectedPath={selectedPath}
          fillAvailableHeight
          onSelectedPathChange={setSelectedPath}
        />
      </div>
    ) : (
      <div className="px-3 py-4 text-sm text-muted-foreground">{filesEmptyMessage}</div>
    );

  useEffect(() => {
    if (stackSteps.length === 0) {
      setSelectedStackIndex(null);
      return;
    }
    if (
      selectedStackIndex === null ||
      !stackSteps.some((step) => step.index === selectedStackIndex)
    ) {
      setSelectedStackIndex(stackSteps.at(-1)?.index ?? null);
    }
  }, [selectedStackIndex, stackSteps]);

  useEffect(() => {
    if (activeFiles.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !activeFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(activeFiles[0]?.path ?? null);
    }
  }, [activeFiles, selectedPath]);

  const refresh = () => {
    void invalidateGitDiffQueries(queryClient, { environmentId, cwd });
  };

  if (!thread || !project || !cwd) {
    return (
      <GitDiffWorkbenchShell embedded={embedded}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Git Diff needs an active thread.
        </div>
      </GitDiffWorkbenchShell>
    );
  }

  return (
    <GitDiffWorkbenchShell embedded={embedded}>
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitCompareIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {selectedStackStep
                  ? `${stackQuery.data?.baseRef ?? STACK_BASE_REF} -> ${
                      selectedStackStep.branchName
                    }`
                  : "Working tree"}
              </div>
              <div className="truncate text-xs text-muted-foreground">{cwd}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {activeFiles.length} {activeFiles.length === 1 ? "file" : "files"}
            </span>
            <Button
              aria-label="Refresh diff"
              disabled={isDiffFetching}
              size="icon-xs"
              variant="ghost"
              onClick={refresh}
            >
              <RefreshCwIcon className={isDiffFetching ? "animate-spin" : undefined} />
            </Button>
          </div>
        </header>

        {worktreeQuery.error || (stackQuery.error && !isStackView) ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {formatError(worktreeQuery.error ?? stackQuery.error)}
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 w-full flex-1">
          <aside
            ref={sidebarRef}
            className="flex min-h-0 w-[22rem] shrink-0 flex-col border-r border-border bg-background"
          >
            {stackSteps.length > 0 ? (
              <>
                <GitDiffSidebarSectionHeader
                  open={stackSectionOpen}
                  title={`${baseRef} at top -> newest at bottom`}
                  onToggle={() => setStackSectionOpen((open) => !open)}
                />
                {stackSectionOpen ? (
                  <section
                    ref={stackSectionRef}
                    className={cn(
                      "min-h-0 overflow-hidden",
                      filesSectionOpen ? "shrink-0" : "flex-1",
                    )}
                    style={filesSectionOpen ? { height: stackSectionHeight } : undefined}
                  >
                    <LegendList<GitDiffStackSidebarItem>
                      data={stackSidebarItems}
                      keyExtractor={gitDiffStackSidebarItemKey}
                      renderItem={renderStackSidebarItem}
                      estimatedItemSize={72}
                      drawDistance={900}
                      className="h-full min-h-0 overflow-y-auto overscroll-contain"
                    />
                  </section>
                ) : null}
                {stackSectionOpen && filesSectionOpen ? (
                  <button
                    aria-label="Resize stack and changed files sections"
                    className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center border-y border-border/60 bg-background hover:bg-muted/40"
                    tabIndex={-1}
                    title="Drag to resize sections"
                    type="button"
                    onPointerCancel={handleSidebarResizePointerEnd}
                    onPointerDown={handleSidebarResizePointerDown}
                    onPointerMove={handleSidebarResizePointerMove}
                    onPointerUp={handleSidebarResizePointerEnd}
                  >
                    <span className="h-px w-12 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/70" />
                  </button>
                ) : null}
              </>
            ) : null}

            <GitDiffSidebarSectionHeader
              badge={`+${insertionCount} -${deletionCount}`}
              className={stackSteps.length > 0 ? "border-t-0" : undefined}
              open={filesSectionOpen}
              title={`${activeFiles.length} changed ${activeFiles.length === 1 ? "file" : "files"}`}
              onToggle={() => setFilesSectionOpen((open) => !open)}
            />
            {filesSectionOpen ? (
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {filesSectionContent}
              </section>
            ) : null}
          </aside>

          <GitDiffFileWorkbench
            diff={selectedFileQuery.data}
            diffHunkSeparators={diffHunkSeparators}
            diffIgnoreWhitespace={diffIgnoreWhitespace}
            diffLineHighlightMode={diffLineHighlightMode}
            diffLineNumbers={diffLineNumbers}
            diffRenderMode={diffRenderMode}
            diffUnsafeCSS={diffUnsafeCSS}
            diffWordWrap={diffWordWrap}
            error={selectedFileQuery.error}
            isLoading={selectedFileQuery.isLoading}
            onDiffHunkSeparatorsChange={setDiffHunkSeparators}
            onDiffIgnoreWhitespaceChange={setDiffIgnoreWhitespace}
            onDiffLineHighlightModeChange={setDiffLineHighlightMode}
            onDiffLineNumbersChange={setDiffLineNumbers}
            onDiffRenderModeChange={setDiffRenderMode}
            onDiffWordWrapChange={setDiffWordWrap}
            resolvedTheme={resolvedTheme as DiffThemeType}
            selectedFile={selectedFile}
            syntaxTheme={syntaxTheme}
            title={
              selectedStackStep
                ? `${selectedStackStep.baseRef} -> ${selectedStackStep.headRef}`
                : "Working tree"
            }
          />
        </div>
      </div>
    </GitDiffWorkbenchShell>
  );
}

function GitDiffWorkbenchShell(props: {
  readonly embedded: boolean;
  readonly children: ReactNode;
}) {
  if (props.embedded) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-background text-foreground">
        {props.children}
      </div>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {props.children}
    </SidebarInset>
  );
}

function GitDiffSidebarSectionHeader(props: {
  readonly title: string;
  readonly badge?: string;
  readonly open: boolean;
  readonly className?: string | undefined;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={props.open}
      className={cn(
        "flex h-11 w-full shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40",
        props.className,
      )}
      type="button"
      onClick={props.onToggle}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 transition-transform", !props.open && "-rotate-90")}
        />
        <span className="truncate font-semibold">{props.title}</span>
      </span>
      {props.badge ? (
        <Badge className="shrink-0" size="sm" variant="outline">
          {props.badge}
        </Badge>
      ) : null}
    </button>
  );
}

function ChangedFilesTree(props: {
  readonly files: readonly GitDiffFileSummary[];
  readonly selectedPath: string | null;
  readonly fillAvailableHeight?: boolean;
  readonly onSelectedPathChange: (path: string) => void;
}) {
  const treeData = useMemo(() => buildChangedFilesTreeData(props.files), [props.files]);
  const decorationByPathRef = useRef(treeData.decorationByPath);
  const filePathSetRef = useRef(treeData.filePathSet);
  const onSelectedPathChangeRef = useRef(props.onSelectedPathChange);
  decorationByPathRef.current = treeData.decorationByPath;
  filePathSetRef.current = treeData.filePathSet;
  onSelectedPathChangeRef.current = props.onSelectedPathChange;

  const handleSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    const nextPath = selectedPaths.findLast((path) => filePathSetRef.current.has(path));
    if (nextPath) {
      onSelectedPathChangeRef.current(nextPath);
    }
  }, []);

  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>((context) => {
    const decoration = decorationByPathRef.current.get(context.item.path);
    return decoration ?? null;
  }, []);

  const { model } = useFileTree({
    density: "compact",
    gitStatus: treeData.gitStatus,
    icons: "complete",
    initialExpansion: "open",
    initialExpandedPaths: treeData.directoryPaths,
    initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
    itemHeight: GIT_DIFF_FILE_TREE_ROW_HEIGHT,
    onSelectionChange: handleSelectionChange,
    paths: treeData.paths,
    preparedInput: treeData.preparedInput,
    renderRowDecoration,
    stickyFolders: true,
  });

  useEffect(() => {
    model.resetPaths(treeData.paths, {
      initialExpandedPaths: treeData.directoryPaths,
      preparedInput: treeData.preparedInput,
    });
    model.setGitStatus(treeData.gitStatus);
    model.setIcons("complete");
  }, [model, treeData]);

  useEffect(() => {
    for (const selected of model.getSelectedPaths()) {
      if (selected !== props.selectedPath) {
        model.getItem(selected)?.deselect();
      }
    }

    if (props.selectedPath && treeData.filePathSet.has(props.selectedPath)) {
      model.getItem(props.selectedPath)?.select();
      model.scrollToPath(props.selectedPath, { focus: false, offset: "nearest" });
    }
  }, [model, props.selectedPath, treeData.filePathSet]);

  const visibleRows = Math.min(
    Math.max(treeData.visibleRowCount, GIT_DIFF_FILE_TREE_MIN_VISIBLE_ROWS),
    GIT_DIFF_FILE_TREE_MAX_VISIBLE_ROWS,
  );
  const treeStyle = useMemo<CSSProperties>(
    () => ({
      ...GIT_DIFF_FILE_TREE_STYLE,
      height: props.fillAvailableHeight ? "100%" : visibleRows * GIT_DIFF_FILE_TREE_ROW_HEIGHT,
    }),
    [props.fillAvailableHeight, visibleRows],
  );

  return (
    <PierreFileTree
      aria-label="Changed files"
      className={cn("block w-full min-w-0", props.fillAvailableHeight && "h-full min-h-0")}
      model={model}
      style={treeStyle}
    />
  );
}

function isBuiltInHunkSeparator(value: string): value is BuiltInHunkSeparators {
  return (
    value === "line-info" ||
    value === "line-info-basic" ||
    value === "metadata" ||
    value === "simple"
  );
}

function resolveParsedFileDiffPath(fileDiff: FileDiffMetadata): string {
  const rawPath = fileDiff.name ?? fileDiff.prevName ?? "";
  if (rawPath.startsWith("a/") || rawPath.startsWith("b/")) {
    return rawPath.slice(2);
  }
  return rawPath;
}

function buildParsedFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function GitDiffFileWorkbench(props: {
  readonly selectedFile: GitDiffFileSummary | null;
  readonly diff: LoadDiffFileResult | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly title: string;
  readonly syntaxTheme: Parameters<typeof resolveDiffThemeName>[0];
  readonly resolvedTheme: DiffThemeType;
  readonly diffUnsafeCSS: string;
  readonly diffRenderMode: DiffRenderMode;
  readonly onDiffRenderModeChange: (mode: DiffRenderMode) => void;
  readonly diffWordWrap: boolean;
  readonly onDiffWordWrapChange: (enabled: boolean) => void;
  readonly diffIgnoreWhitespace: boolean;
  readonly onDiffIgnoreWhitespaceChange: (enabled: boolean) => void;
  readonly diffLineNumbers: boolean;
  readonly onDiffLineNumbersChange: (enabled: boolean) => void;
  readonly diffLineHighlightMode: DiffLineHighlightMode;
  readonly onDiffLineHighlightModeChange: (mode: DiffLineHighlightMode) => void;
  readonly diffHunkSeparators: BuiltInHunkSeparators;
  readonly onDiffHunkSeparatorsChange: (separator: BuiltInHunkSeparators) => void;
}) {
  const errorMessage = props.error ? formatError(props.error) : null;
  const fullFileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (!props.diff || (!props.diff.oldFile && !props.diff.newFile)) {
      return null;
    }

    const oldPath = props.diff.oldFile?.path ?? props.diff.previousPath ?? props.diff.path;
    const newPath = props.diff.newFile?.path ?? props.diff.path;

    const oldFile = makeDiffFileContents({
      path: oldPath,
      contents: props.diff.oldFile?.contents ?? "",
      cacheScope: `git-diff:${props.resolvedTheme}:old`,
    });
    const newFile = makeDiffFileContents({
      path: newPath,
      contents: props.diff.newFile?.contents ?? "",
      cacheScope: `git-diff:${props.resolvedTheme}:new`,
    });

    try {
      const fileDiff = parseDiffFromFile(oldFile, newFile, {
        ignoreWhitespace: props.diffIgnoreWhitespace,
      });
      return {
        ...fileDiff,
        cacheKey: buildPatchCacheKey(
          `${oldFile.cacheKey ?? oldPath}\0${newFile.cacheKey ?? newPath}`,
          `git-diff:${props.resolvedTheme}:full`,
        ),
      };
    } catch {
      return null;
    }
  }, [props.diff, props.diffIgnoreWhitespace, props.resolvedTheme]);
  const renderablePatch = useMemo(
    () =>
      !fullFileDiff
        ? getRenderablePatch(props.diff?.patch, `git-diff-workbench:${props.resolvedTheme}`)
        : null,
    [fullFileDiff, props.diff?.patch, props.resolvedTheme],
  );
  const diffOptions = useMemo<GitDiffFileDiffOptions>(
    () => ({
      collapsedContextThreshold: 12,
      diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
      disableLineNumbers: !props.diffLineNumbers,
      expansionLineCount: 80,
      hunkSeparators: props.diffHunkSeparators,
      lineDiffType: props.diffLineHighlightMode === "inline" ? "word-alt" : "none",
      overflow: props.diffWordWrap ? "wrap" : "scroll",
      theme: resolveDiffThemeName(props.syntaxTheme),
      themeType: props.resolvedTheme,
      unsafeCSS: props.diffUnsafeCSS,
    }),
    [
      props.diffHunkSeparators,
      props.diffLineHighlightMode,
      props.diffLineNumbers,
      props.diffRenderMode,
      props.diffUnsafeCSS,
      props.diffWordWrap,
      props.resolvedTheme,
      props.syntaxTheme,
    ],
  );

  return (
    <main className="flex min-w-0 w-full flex-1 flex-col bg-muted/10">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{props.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {props.selectedFile?.path ?? "No file selected"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <ToggleGroup
            className="shrink-0"
            variant="outline"
            size="xs"
            value={[props.diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                props.onDiffRenderModeChange(next);
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" title="Stacked" value="stacked">
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle aria-label="Split diff view" title="Split" value="split">
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Toggle
            aria-label="Toggle line wrapping"
            title="Wrap"
            variant="outline"
            size="xs"
            pressed={props.diffWordWrap}
            onPressedChange={(pressed) => props.onDiffWordWrapChange(Boolean(pressed))}
          >
            <TextWrapIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle ignored whitespace"
            title="Whitespace"
            variant="outline"
            size="xs"
            pressed={props.diffIgnoreWhitespace}
            onPressedChange={(pressed) => props.onDiffIgnoreWhitespaceChange(Boolean(pressed))}
          >
            <PilcrowIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle line numbers"
            title="Line numbers"
            variant="outline"
            size="xs"
            pressed={props.diffLineNumbers}
            onPressedChange={(pressed) => props.onDiffLineNumbersChange(Boolean(pressed))}
          >
            <HashIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle inline highlights"
            title="Inline highlights"
            variant="outline"
            size="xs"
            pressed={props.diffLineHighlightMode === "inline"}
            onPressedChange={(pressed) =>
              props.onDiffLineHighlightModeChange(pressed ? "inline" : "none")
            }
          >
            <HighlighterIcon className="size-3" />
          </Toggle>
          <Select
            value={props.diffHunkSeparators}
            onValueChange={(value) => {
              if (typeof value === "string" && isBuiltInHunkSeparator(value)) {
                props.onDiffHunkSeparatorsChange(value);
              }
            }}
          >
            <SelectTrigger
              aria-label="Hunk separators"
              className="w-[8.5rem]"
              size="xs"
              variant="ghost"
            >
              <SeparatorHorizontalIcon className="size-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {Object.entries(HUNK_SEPARATOR_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {props.selectedFile ? (
            <>
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                +{props.selectedFile.insertions}
              </span>
              <span className="tabular-nums text-rose-600 dark:text-rose-400">
                -{props.selectedFile.deletions}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
        <div className="h-full min-w-0 w-full overflow-hidden rounded-md border border-border bg-background">
          <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-sm">
                {props.selectedFile?.path ?? "Select a changed file"}
              </span>
              {props.selectedFile ? (
                <Badge size="sm" variant="secondary">
                  {changedFileStatusText(props.selectedFile)}
                </Badge>
              ) : null}
            </div>
          </div>

          {!props.selectedFile ? (
            <GitDiffWorkbenchEmptyState label="Select a file to inspect." />
          ) : props.selectedFile.binary ? (
            <GitDiffWorkbenchEmptyState label="Binary file diffs are not rendered." />
          ) : errorMessage ? (
            <GitDiffWorkbenchEmptyState label={errorMessage} />
          ) : props.isLoading ? (
            <GitDiffWorkbenchEmptyState label="Loading file diff..." />
          ) : fullFileDiff ? (
            <Virtualizer
              className="h-[calc(100%-2.75rem)] min-h-0 w-full overflow-auto px-2 pb-2"
              config={{
                intersectionObserverMargin: 1200,
                overscrollSize: 600,
              }}
            >
              <div
                key={`${fullFileDiff.cacheKey}:${props.diffRenderMode}:${props.diffHunkSeparators}`}
                className="mt-2"
              >
                <FileDiff fileDiff={fullFileDiff} options={diffOptions} />
              </div>
            </Virtualizer>
          ) : renderablePatch?.kind === "files" ? (
            <Virtualizer
              className="h-[calc(100%-2.75rem)] min-h-0 w-full overflow-auto px-2 pb-2"
              config={{
                intersectionObserverMargin: 1200,
                overscrollSize: 600,
              }}
            >
              {renderablePatch.files.map((fileDiff) => (
                <div
                  key={`${buildParsedFileDiffRenderKey(fileDiff)}:${props.diffRenderMode}:${props.diffHunkSeparators}`}
                  data-diff-file-path={resolveParsedFileDiffPath(fileDiff)}
                  className="mt-2"
                >
                  <FileDiff fileDiff={fileDiff} options={diffOptions} />
                </div>
              ))}
            </Virtualizer>
          ) : renderablePatch?.kind === "raw" ? (
            <div className="h-[calc(100%-2.75rem)] overflow-auto p-3">
              <p className="mb-2 text-xs text-muted-foreground">{renderablePatch.reason}</p>
              <pre
                className={cn(
                  "rounded-md border border-border/70 bg-background/70 p-3 font-mono text-xs leading-relaxed text-muted-foreground/90",
                  props.diffWordWrap
                    ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                    : "overflow-auto",
                )}
              >
                {renderablePatch.text}
              </pre>
            </div>
          ) : (
            <GitDiffWorkbenchEmptyState label="No line changes in this selection." />
          )}
        </div>
      </div>
    </main>
  );
}

function GitDiffWorkbenchEmptyState(props: { readonly label: string }) {
  return (
    <div className="flex h-[calc(100%-2.75rem)] items-center justify-center px-4 text-sm text-muted-foreground">
      {props.label}
    </div>
  );
}
