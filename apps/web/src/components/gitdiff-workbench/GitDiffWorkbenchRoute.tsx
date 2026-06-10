import {
  parseDiffFromFile,
  parsePatchFiles,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  FileDiff,
  type FileContents,
  type FileDiffMetadata,
  type HunkSeparators,
  Virtualizer,
} from "@pierre/diffs/react";
import {
  buildTerminalFontFamily,
  type ChangeRequest,
  type ChangeRequestCheck,
  type ChangeRequestReviewThread,
  type DiffTarget,
  type EnvironmentId,
  type GitBranch,
  type GitDiffFileSummary,
  type GitDiffIgnoreList,
  type GitDiffRepository,
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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Columns2Icon,
  GitCommitHorizontalIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitMergeIcon,
  HashIcon,
  HighlighterIcon,
  MessageSquareIcon,
  PilcrowIcon,
  PlusIcon,
  RefreshCwIcon,
  Rows3Icon,
  SeparatorHorizontalIcon,
  Trash2Icon,
  TextWrapIcon,
  Undo2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { readEnvironmentApi } from "~/environmentApi";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { openInEmbeddedEditor, openInEmbeddedVSCode } from "~/editorPreferences";
import {
  DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import {
  gitDiffActiveChangeRequestStackedFileIndexQueryOptions,
  gitDiffChangeRequestChecksQueryOptions,
  gitDiffChangeRequestReviewThreadsQueryOptions,
  gitDiffCloseChangeRequestMutationOptions,
  gitDiffCommentChangeRequestLinesMutationOptions,
  gitDiffCreateIgnoreListMutationOptions,
  gitDiffDeleteIgnoreListMutationOptions,
  gitDiffFileQueryOptions,
  gitDiffFileIndexQueryOptions,
  gitDiffIgnoreListsQueryOptions,
  gitDiffMergeChangeRequestMutationOptions,
  gitDiffRepositoriesQueryOptions,
  gitDiffRevertChangeRequestLinesMutationOptions,
  gitDiffStageWorktreeChangesMutationOptions,
  gitDiffUpdateIgnoreListMutationOptions,
  invalidateGitDiffQueries,
} from "~/lib/gitDiffReactQuery";
import {
  gitQueryKeys,
  gitRunStackedActionMutationOptions,
  vcsRefSearchInfiniteQueryOptions,
} from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { runLocalRpc } from "~/hooks/useRpc";
import { resolveActiveEmbeddedEditor } from "~/modules/neovim-editor";
import { cn, randomUUID } from "~/lib/utils";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { toastManager } from "~/components/ui/toast";
import { formatRelativeTimeLabel } from "~/lib/formatting";
import { resolveThreadRouteRef } from "~/threadRoutes";

const GIT_DIFF_FILE_TREE_ROW_HEIGHT = 24;
const GIT_DIFF_FILE_TREE_MIN_VISIBLE_ROWS = 4;
const GIT_DIFF_FILE_TREE_MAX_VISIBLE_ROWS = 18;
const GIT_DIFF_SIDEBAR_SECTION_HEADER_HEIGHT = 44;
const GIT_DIFF_SIDEBAR_RESIZE_HANDLE_HEIGHT = 10;
const GIT_DIFF_SIDEBAR_DEFAULT_WIDTH = 352;
const GIT_DIFF_SIDEBAR_MIN_WIDTH = 280;
const GIT_DIFF_SIDEBAR_MAX_WIDTH = 720;
const GIT_DIFF_SIDEBAR_STACK_DEFAULT_HEIGHT = 520;
const GIT_DIFF_SIDEBAR_STACK_MIN_HEIGHT = 144;
const GIT_DIFF_SIDEBAR_FILES_MIN_HEIGHT = 120;
const GIT_DIFF_IGNORE_LIST_DRAG_TYPE = "application/x-fenrir-git-diff-file-path";
const GIT_DIFF_WORKBENCH_STATE_STORAGE_PREFIX = "fenrir:git-diff-workbench-state:v1";
const EMPTY_GIT_DIFF_IGNORE_LISTS: readonly GitDiffIgnoreList[] = [];

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
type GitDiffViewMode = "stack" | "worktree";
type GitDiffReviewThreadAnnotation = {
  readonly threads: readonly ChangeRequestReviewThread[];
};
type PersistedGitDiffRepositoryState = {
  readonly mode: GitDiffViewMode;
  readonly selectedPath: string | null;
  readonly selectedStackIndex: number | null;
};
type PersistedGitDiffWorkbenchState = PersistedGitDiffRepositoryState & {
  readonly selectedRepositoryCwd: string | null;
  readonly repositoryStates: Record<string, PersistedGitDiffRepositoryState>;
};
type BuiltInHunkSeparators = Exclude<HunkSeparators, "custom">;
type GitDiffFileDiffOptions = NonNullable<
  ComponentProps<typeof FileDiff<GitDiffReviewThreadAnnotation>>["options"]
>;
type GitDiffLineSelection = {
  readonly side: "additions" | "deletions";
  readonly start: number;
  readonly end: number;
};
type GitDiffCommentDialogState = {
  readonly selection: GitDiffLineSelection;
  readonly body: string;
};

const HUNK_SEPARATOR_LABELS: Record<BuiltInHunkSeparators, string> = {
  "line-info": "Line info",
  "line-info-basic": "Basic",
  metadata: "Metadata",
  simple: "Simple",
};

function gitDiffWorkbenchStateStorageKey(input: {
  readonly environmentId: string | null;
  readonly projectId: string | null;
}): string | null {
  if (!input.environmentId || !input.projectId) return null;
  return `${GIT_DIFF_WORKBENCH_STATE_STORAGE_PREFIX}:${input.environmentId}:${input.projectId}`;
}

function isPersistedGitDiffRepositoryState(
  value: unknown,
): value is PersistedGitDiffRepositoryState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.mode === "stack" || record.mode === "worktree") &&
    (typeof record.selectedPath === "string" || record.selectedPath === null) &&
    (typeof record.selectedStackIndex === "number" ||
      record.selectedStackIndex === null ||
      record.selectedStackIndex === undefined)
  );
}

function isPersistedGitDiffWorkbenchState(value: unknown): value is PersistedGitDiffWorkbenchState {
  if (!isPersistedGitDiffRepositoryState(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (typeof record.selectedRepositoryCwd === "string" ||
      record.selectedRepositoryCwd === null ||
      record.selectedRepositoryCwd === undefined) &&
    (record.repositoryStates === undefined ||
      (typeof record.repositoryStates === "object" && record.repositoryStates !== null))
  );
}

function readPersistedGitDiffWorkbenchState(
  storageKey: string | null,
): PersistedGitDiffWorkbenchState | null {
  if (!storageKey || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedGitDiffWorkbenchState(parsed)) return null;
    const rawRepositoryStates =
      parsed.repositoryStates && typeof parsed.repositoryStates === "object"
        ? parsed.repositoryStates
        : {};
    const repositoryStates = Object.fromEntries(
      Object.entries(rawRepositoryStates).filter(
        (entry): entry is [string, PersistedGitDiffRepositoryState] =>
          isPersistedGitDiffRepositoryState(entry[1]),
      ),
    );
    return {
      mode: parsed.mode,
      selectedPath: parsed.selectedPath,
      selectedStackIndex:
        typeof parsed.selectedStackIndex === "number" ? parsed.selectedStackIndex : null,
      selectedRepositoryCwd:
        typeof parsed.selectedRepositoryCwd === "string" ? parsed.selectedRepositoryCwd : null,
      repositoryStates,
    };
  } catch {
    return null;
  }
}

function writePersistedGitDiffWorkbenchState(
  storageKey: string | null,
  state: PersistedGitDiffWorkbenchState,
): void {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage failure should not block the diff UI.
  }
}

function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function basenameFromPath(path: string): string {
  const normalized = normalizeFilesystemPath(path);
  return normalized.split("/").findLast((part) => part.length > 0) ?? normalized;
}

function makeWorkspaceRootRepository(workspaceCwd: string): GitDiffRepository {
  return {
    cwd: workspaceCwd,
    relativePath: "",
    name: basenameFromPath(workspaceCwd),
    isWorkspaceRoot: true,
  };
}

function repositoryContainsPath(repositoryCwd: string, targetPath: string): boolean {
  const repository = normalizeFilesystemPath(repositoryCwd);
  const target = normalizeFilesystemPath(targetPath);
  return target === repository || target.startsWith(`${repository}/`);
}

function sortGitDiffRepositories(
  repositories: readonly GitDiffRepository[],
): readonly GitDiffRepository[] {
  return [...repositories].toSorted((left, right) => {
    if (left.isWorkspaceRoot !== right.isWorkspaceRoot) {
      return left.isWorkspaceRoot ? -1 : 1;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function mergeGitDiffRepositories(input: {
  readonly workspaceCwd: string | null;
  readonly repositories: readonly GitDiffRepository[];
}): readonly GitDiffRepository[] {
  const byCwd = new Map<string, GitDiffRepository>();
  if (input.workspaceCwd && input.repositories.length === 0) {
    const root = makeWorkspaceRootRepository(input.workspaceCwd);
    byCwd.set(normalizeFilesystemPath(root.cwd), root);
  }
  for (const repository of input.repositories) {
    byCwd.set(normalizeFilesystemPath(repository.cwd), repository);
  }
  return sortGitDiffRepositories([...byCwd.values()]);
}

function findBestRepositoryCwd(input: {
  readonly repositories: readonly GitDiffRepository[];
  readonly repositoriesResolved: boolean;
  readonly selectedRepositoryCwd: string | null;
  readonly preferredCwd: string | null;
  readonly workspaceCwd: string | null;
}): string | null {
  if (input.selectedRepositoryCwd && !input.repositoriesResolved) {
    return input.selectedRepositoryCwd;
  }

  if (input.repositories.length === 0) {
    return input.workspaceCwd;
  }

  if (
    input.selectedRepositoryCwd &&
    input.repositories.some((repository) => repository.cwd === input.selectedRepositoryCwd)
  ) {
    return input.selectedRepositoryCwd;
  }

  if (input.preferredCwd) {
    const preferredCwd = input.preferredCwd;
    const preferredRepository = input.repositories
      .toSorted((left, right) => right.cwd.length - left.cwd.length)
      .find((repository) => repositoryContainsPath(repository.cwd, preferredCwd));
    if (preferredRepository) {
      return preferredRepository.cwd;
    }
  }

  return input.repositories[0]?.cwd ?? input.workspaceCwd;
}

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

function clampSidebarWidth(width: number, viewportWidth: number): number {
  const maxWidth = Math.min(
    GIT_DIFF_SIDEBAR_MAX_WIDTH,
    Math.max(GIT_DIFF_SIDEBAR_MIN_WIDTH, viewportWidth - 420),
  );
  return clampNumber(width, GIT_DIFF_SIDEBAR_MIN_WIDTH, maxWidth);
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function resolveChangedFileEditorPath(cwd: string, filePath: string): string {
  if (isAbsoluteFilePath(filePath)) return filePath;

  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const normalizedCwd = cwd.replace(/[\\/]+$/g, "");
  const normalizedFilePath = filePath.replace(/^[\\/]+/g, "");
  return `${normalizedCwd}${separator}${normalizedFilePath}`;
}

function totalInsertions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.insertions, 0);
}

function totalDeletions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.deletions, 0);
}

function ignoredFilePathSet(ignoreLists: readonly GitDiffIgnoreList[]): ReadonlySet<string> {
  return new Set(ignoreLists.flatMap((list) => list.filePaths));
}

function uniqueFilePaths(files: readonly GitDiffFileSummary[]): readonly string[] {
  return [...new Set(files.map((file) => file.path))].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeDiffLineSelection(
  selection: SelectedLineRange | null,
): GitDiffLineSelection | null {
  if (!selection?.side) {
    return null;
  }
  const endSide = selection.endSide ?? selection.side;
  if (selection.side !== endSide) {
    return null;
  }
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
    return null;
  }
  return { side: selection.side, start, end };
}

function formatSelectionLabel(selection: GitDiffLineSelection): string {
  return selection.start === selection.end
    ? `${selection.side}:${selection.start}`
    : `${selection.side}:${selection.start}-${selection.end}`;
}

function formatChangeRequestDirectionLabel(input: {
  readonly baseRef: string | null | undefined;
  readonly headRef: string | null | undefined;
}): string {
  return `${input.headRef ?? "HEAD"} -> ${input.baseRef ?? "Base"}`;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function changeRequestReference(changeRequest: ChangeRequest | null): string | null {
  return changeRequest ? String(changeRequest.number) : null;
}

function checkStatusTone(status: ChangeRequestCheck["status"]): string {
  switch (status) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400";
    case "failure":
    case "cancelled":
      return "text-rose-600 dark:text-rose-400";
    case "skipped":
      return "text-muted-foreground";
    case "pending":
      return "text-amber-600 dark:text-amber-400";
    case "unknown":
      return "text-muted-foreground";
  }
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

function normalizeReviewThreadPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

function reviewThreadMatchesFile(
  thread: ChangeRequestReviewThread,
  file: Pick<GitDiffFileSummary, "path" | "previousPath">,
): boolean {
  const threadPath = normalizeReviewThreadPath(thread.path);
  if (threadPath === null) return false;
  return threadPath === file.path || threadPath === file.previousPath;
}

function sortReviewThreads(
  threads: readonly ChangeRequestReviewThread[],
): readonly ChangeRequestReviewThread[] {
  return threads.toSorted((left, right) => {
    const leftStart = left.startLine ?? left.line;
    const rightStart = right.startLine ?? right.line;
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (left.line !== right.line) return left.line - right.line;
    if (left.side !== right.side) return left.side.localeCompare(right.side);
    return left.id.localeCompare(right.id);
  });
}

function buildReviewThreadAnnotations(input: {
  readonly threads: readonly ChangeRequestReviewThread[];
  readonly file: Pick<GitDiffFileSummary, "path" | "previousPath">;
}): DiffLineAnnotation<GitDiffReviewThreadAnnotation>[] {
  if (input.threads.length === 0) return [];

  const groupedThreads = new Map<string, ChangeRequestReviewThread[]>();
  for (const thread of input.threads) {
    if (!reviewThreadMatchesFile(thread, input.file)) continue;

    const key = `${thread.side}:${thread.line}`;
    const group = groupedThreads.get(key) ?? [];
    group.push(thread);
    groupedThreads.set(key, group);
  }

  return [...groupedThreads.entries()]
    .map(([key, threads]) => {
      const separatorIndex = key.indexOf(":");
      const side = key.slice(0, separatorIndex) as "additions" | "deletions";
      const lineNumber = Number(key.slice(separatorIndex + 1));
      return {
        side,
        lineNumber,
        metadata: { threads: sortReviewThreads(threads) },
      };
    })
    .toSorted((left, right) => {
      if (left.lineNumber !== right.lineNumber) return left.lineNumber - right.lineNumber;
      return left.side.localeCompare(right.side);
    });
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

type GitDiffSidebarWidthResizeState = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  pendingWidth: number;
  width: number;
  rafId: number | null;
};

function gitDiffBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to switch branch.";
}

function gitDiffBranchBadge(branch: GitBranch, cwd: string): string | null {
  if (branch.current) return "current";
  if (
    branch.worktreePath &&
    normalizeFilesystemPath(branch.worktreePath) !== normalizeFilesystemPath(cwd)
  ) {
    return "worktree";
  }
  if (branch.isRemote) return "remote";
  if (branch.isDefault) return "default";
  return null;
}

function GitDiffRepositoryBranchSelector(props: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string;
  readonly currentBranch: string | null;
}) {
  const { currentBranch, cwd, environmentId } = props;
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const deferredBranchQuery = useDeferredValue(branchQuery);
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
  const trimmedDeferredBranchQuery = deferredBranchQuery.trim();
  const {
    data: branchesSearchData,
    isPending: isBranchesPending,
    isFetchingNextPage,
    hasNextPage,
  } = useInfiniteQuery(
    vcsRefSearchInfiniteQueryOptions({
      environmentId,
      cwd,
      query: trimmedDeferredBranchQuery,
      enabled: isOpen || trimmedDeferredBranchQuery.length > 0,
    }),
  );
  const branches = useMemo(
    () => branchesSearchData?.pages.flatMap((page) => page.refs) ?? [],
    [branchesSearchData?.pages],
  );
  const branchNames = useMemo(() => branches.map((branch) => branch.name), [branches]);
  const branchByName = useMemo(
    () => new Map(branches.map((branch) => [branch.name, branch] as const)),
    [branches],
  );
  const resolvedCurrentBranch =
    currentBranch ?? branches.find((branch) => branch.current)?.name ?? null;
  const totalBranchCount = branchesSearchData?.pages[0]?.totalCount ?? 0;
  const branchStatusText = isBranchesPending
    ? "Loading branches..."
    : isFetchingNextPage
      ? "Loading more branches..."
      : hasNextPage
        ? `Showing ${branches.length} of ${totalBranchCount} branches`
        : null;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen) {
        setBranchQuery("");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: gitQueryKeys.refs(environmentId, cwd) });
    },
    [cwd, environmentId, queryClient],
  );

  const selectBranch = useCallback(
    (branchName: string) => {
      if (!environmentId || isBranchActionPending) {
        return;
      }

      const branch = branchByName.get(branchName);
      const api = readEnvironmentApi(environmentId);
      if (!branch || !api) {
        return;
      }

      setIsOpen(false);
      setBranchQuery("");
      startBranchActionTransition(async () => {
        try {
          await api.vcs.switchRef({ cwd, refName: branch.name });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: gitQueryKeys.refs(environmentId, cwd) }),
            invalidateGitDiffQueries(queryClient, { environmentId, cwd }),
          ]);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to switch branch.",
            description: gitDiffBranchActionErrorMessage(error),
          });
        }
      });
    },
    [branchByName, cwd, environmentId, isBranchActionPending, queryClient],
  );

  return (
    <Combobox
      items={branchNames}
      filteredItems={branchNames}
      autoHighlight
      open={isOpen}
      value={resolvedCurrentBranch}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className="max-w-[20rem] text-muted-foreground hover:text-foreground"
        disabled={!environmentId || isBranchActionPending}
      >
        <GitBranchIcon className="size-3" />
        <span className="truncate font-mono">{resolvedCurrentBranch ?? "Select branch"}</span>
        <ChevronDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-80">
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search branches..."
            showTrigger={false}
            size="sm"
            value={branchQuery}
            onChange={(event) => setBranchQuery(event.target.value)}
          />
        </div>
        <ComboboxEmpty>No branches found.</ComboboxEmpty>
        <ComboboxList className="max-h-56">
          {branches.map((branch, index) => {
            const badge = gitDiffBranchBadge(branch, cwd);
            return (
              <ComboboxItem
                hideIndicator
                key={branch.name}
                index={index}
                value={branch.name}
                onClick={() => selectBranch(branch.name)}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{branch.name}</span>
                  {badge ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>
                  ) : null}
                </div>
              </ComboboxItem>
            );
          })}
        </ComboboxList>
        {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
      </ComboboxPopup>
    </Combobox>
  );
}

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
  const workspaceCwd = project?.cwd ?? thread?.worktreePath ?? null;
  const preferredRepositoryCwd = thread?.worktreePath ?? project?.cwd ?? null;
  const gitDiffStateStorageKey = useMemo(
    () =>
      gitDiffWorkbenchStateStorageKey({
        environmentId,
        projectId: project?.id ?? null,
      }),
    [environmentId, project?.id],
  );
  const [selectedRepositoryCwd, setSelectedRepositoryCwd] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStackIndex, setSelectedStackIndex] = useState<number | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>("worktree");
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("split");
  const [diffWordWrap, setDiffWordWrap] = useState(false);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(false);
  const [diffLineNumbers, setDiffLineNumbers] = useState(true);
  const [diffLineHighlightMode, setDiffLineHighlightMode] =
    useState<DiffLineHighlightMode>("inline");
  const [diffHunkSeparators, setDiffHunkSeparators] = useState<BuiltInHunkSeparators>("line-info");
  const [stackSectionOpen, setStackSectionOpen] = useState(true);
  const [filesSectionOpen, setFilesSectionOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(GIT_DIFF_SIDEBAR_DEFAULT_WIDTH);
  const [stackSectionHeight, setStackSectionHeight] = useState(
    GIT_DIFF_SIDEBAR_STACK_DEFAULT_HEIGHT,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [isIgnoreListDialogOpen, setIsIgnoreListDialogOpen] = useState(false);
  const [ignoreListName, setIgnoreListName] = useState("Ignored changes");
  const [commentDialogState, setCommentDialogState] = useState<GitDiffCommentDialogState | null>(
    null,
  );
  const sidebarRef = useRef<HTMLElement | null>(null);
  const stackSectionRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStateRef = useRef<GitDiffSidebarResizeState | null>(null);
  const sidebarWidthResizeStateRef = useRef<GitDiffSidebarWidthResizeState | null>(null);
  const allowAutoSelectFirstFileRef = useRef(true);
  const gitDiffStateRestoredRef = useRef(false);
  const skipNextGitDiffStatePersistRef = useRef(false);
  const persistedRepositoryStatesRef = useRef<Record<string, PersistedGitDiffRepositoryState>>({});
  const lastAppliedRepositoryCwdRef = useRef<string | null>(null);
  const repositoriesQuery = useQuery(
    gitDiffRepositoriesQueryOptions({ environmentId, workspaceCwd }),
  );
  const repositoriesResolved = repositoriesQuery.isFetched || repositoriesQuery.isError;
  const repositoryOptions = useMemo(
    () =>
      mergeGitDiffRepositories({
        workspaceCwd,
        repositories: repositoriesQuery.data ?? [],
      }),
    [repositoriesQuery.data, workspaceCwd],
  );
  const cwd = useMemo(
    () =>
      findBestRepositoryCwd({
        repositories: repositoryOptions,
        repositoriesResolved,
        selectedRepositoryCwd,
        preferredCwd: preferredRepositoryCwd,
        workspaceCwd,
      }),
    [
      preferredRepositoryCwd,
      repositoriesResolved,
      repositoryOptions,
      selectedRepositoryCwd,
      workspaceCwd,
    ],
  );
  const selectedRepository = useMemo(
    () => repositoryOptions.find((repository) => repository.cwd === cwd) ?? null,
    [cwd, repositoryOptions],
  );
  const selectedRepositoryLabel = selectedRepository?.cwd ?? cwd ?? "Repository";
  const gitStatus = useGitStatus({ environmentId, cwd });
  const { resolvedTheme, syntaxTheme } = useTheme();
  const settings = useSettings();
  const desktopBridgeAvailable = useDesktopBridgeAvailable();
  const isMainWindow = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const headRef = gitStatus.data?.branch ?? thread?.branch ?? null;
  const diffFontFamily = useMemo(
    () => buildTerminalFontFamily(settings.editorFontFamily),
    [settings.editorFontFamily],
  );
  const diffUnsafeCSS = useMemo(
    () => buildGitDiffWorkbenchUnsafeCSS(diffFontFamily, settings.editorFontSize),
    [diffFontFamily, settings.editorFontSize],
  );
  const rawDiffFontStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: diffFontFamily,
      fontSize: `${settings.editorFontSize}px`,
    }),
    [diffFontFamily, settings.editorFontSize],
  );

  const worktreeQuery = useQuery(
    gitDiffFileIndexQueryOptions({ environmentId, cwd, targetKind: "worktree" }),
  );
  const stagedQuery = useQuery(
    gitDiffFileIndexQueryOptions({ environmentId, cwd, targetKind: "staged" }),
  );
  const stackQuery = useQuery(
    gitDiffActiveChangeRequestStackedFileIndexQueryOptions({
      environmentId,
      cwd,
    }),
  );
  const ignoreListsQuery = useQuery(gitDiffIgnoreListsQueryOptions({ environmentId, cwd }));
  const createIgnoreListMutation = useMutation(
    gitDiffCreateIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const updateIgnoreListMutation = useMutation(
    gitDiffUpdateIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const deleteIgnoreListMutation = useMutation(
    gitDiffDeleteIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const stageWorktreeChangesMutation = useMutation(
    gitDiffStageWorktreeChangesMutationOptions({ environmentId, cwd, queryClient }),
  );
  const closeChangeRequestMutation = useMutation(
    gitDiffCloseChangeRequestMutationOptions({ environmentId, cwd, queryClient }),
  );
  const mergeChangeRequestMutation = useMutation(
    gitDiffMergeChangeRequestMutationOptions({ environmentId, cwd, queryClient }),
  );
  const commentChangeRequestLinesMutation = useMutation(
    gitDiffCommentChangeRequestLinesMutationOptions({ environmentId, cwd, queryClient }),
  );
  const revertChangeRequestLinesMutation = useMutation(
    gitDiffRevertChangeRequestLinesMutationOptions({ environmentId, cwd, queryClient }),
  );
  const runStackedActionMutation = useMutation(
    gitRunStackedActionMutationOptions({ environmentId, cwd, queryClient }),
  );
  const worktreeFiles = useMemo(() => sortFiles(worktreeQuery.data ?? []), [worktreeQuery.data]);
  const stagedFiles = useMemo(() => sortFiles(stagedQuery.data ?? []), [stagedQuery.data]);
  const ignoreLists = ignoreListsQuery.data ?? EMPTY_GIT_DIFF_IGNORE_LISTS;
  const ignoredPaths = useMemo(() => ignoredFilePathSet(ignoreLists), [ignoreLists]);
  const ignoredFilePaths = useMemo(
    () => [...ignoredPaths].toSorted((left, right) => left.localeCompare(right)),
    [ignoredPaths],
  );
  const committableStagedFiles = useMemo(
    () => stagedFiles.filter((file) => !ignoredPaths.has(file.path)),
    [ignoredPaths, stagedFiles],
  );
  const committableStagedFilePaths = useMemo(
    () => uniqueFilePaths(committableStagedFiles),
    [committableStagedFiles],
  );
  const worktreeDisplayTargetKind =
    worktreeFiles.length === 0 && stagedFiles.length > 0 ? "staged" : "worktree";
  const worktreeDisplayFiles = worktreeDisplayTargetKind === "staged" ? stagedFiles : worktreeFiles;
  const activeChangeRequest = stackQuery.data?.activeChangeRequest ?? null;
  const stackSteps = useMemo(() => sortStackSteps(stackQuery.data?.steps ?? []), [stackQuery.data]);
  const isStackView =
    diffViewMode === "stack" && activeChangeRequest !== null && stackSteps.length > 0;
  const selectedStackStep = isStackView
    ? (stackSteps.find((step) => step.index === selectedStackIndex) ?? stackSteps.at(-1) ?? null)
    : null;
  const selectedChangeRequest = selectedStackStep?.changeRequest ?? activeChangeRequest;
  const selectedChangeRequestReference = changeRequestReference(selectedChangeRequest);
  const checksQuery = useQuery(
    gitDiffChangeRequestChecksQueryOptions({
      environmentId,
      cwd,
      reference: selectedChangeRequestReference,
      enabled: isStackView && selectedChangeRequestReference !== null,
    }),
  );
  const reviewThreadsQuery = useQuery(
    gitDiffChangeRequestReviewThreadsQueryOptions({
      environmentId,
      cwd,
      reference: selectedChangeRequestReference,
      enabled: isStackView && selectedChangeRequestReference !== null,
    }),
  );
  const activeFiles = useMemo(
    () => sortFiles(isStackView ? (selectedStackStep?.files ?? []) : worktreeDisplayFiles),
    [isStackView, selectedStackStep, worktreeDisplayFiles],
  );
  const selectedFile =
    activeFiles.find((file) => file.path === selectedPath) ?? activeFiles[0] ?? null;
  const activeDiffTarget = useMemo<DiffTarget | null>(() => {
    if (!isStackView) {
      return { kind: worktreeDisplayTargetKind };
    }
    if (!selectedStackStep) {
      return null;
    }
    return {
      kind: "range",
      baseRef: selectedStackStep.baseRef,
      headRef: selectedStackStep.headRef,
    };
  }, [isStackView, selectedStackStep, worktreeDisplayTargetKind]);
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
  const isDiffFetching =
    (isStackView ? stackQuery.isFetching : worktreeQuery.isFetching) ||
    (!isStackView && stagedQuery.isFetching) ||
    selectedFileQuery.isFetching;
  const activeFileIndexError = isStackView ? stackQuery.error : worktreeQuery.error;
  const baseRef = stackQuery.data?.baseRef ?? activeChangeRequest?.baseRefName ?? null;
  const stackSidebarItems = useMemo<readonly GitDiffStackSidebarItem[]>(() => {
    if (stackSteps.length === 0 || baseRef === null) return [];

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
                      {item.step.changeRequest
                        ? `PR #${item.step.changeRequest.number}`
                        : stackStepLabel(item.step, stackSteps.length)}
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

  const stopSidebarWidthResize = useCallback(() => {
    const resizeState = sidebarWidthResizeStateRef.current;
    if (!resizeState) return;

    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId);
    }

    setSidebarWidth(resizeState.width);
    sidebarWidthResizeStateRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    return () => {
      const resizeState = sidebarResizeStateRef.current;
      if (resizeState?.rafId != null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      const widthResizeState = sidebarWidthResizeStateRef.current;
      if (widthResizeState?.rafId != null) {
        window.cancelAnimationFrame(widthResizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth, window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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

  const handleSidebarWidthResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      const sidebar = sidebarRef.current;
      const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
      const initialWidth = clampSidebarWidth(
        sidebar?.getBoundingClientRect().width || sidebarWidth,
        viewportWidth,
      );

      event.preventDefault();
      event.stopPropagation();
      sidebarWidthResizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: initialWidth,
        pendingWidth: initialWidth,
        width: initialWidth,
        rafId: null,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  const handleSidebarWidthResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = sidebarWidthResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
      resizeState.pendingWidth = clampSidebarWidth(
        resizeState.startWidth + event.clientX - resizeState.startX,
        viewportWidth,
      );

      if (resizeState.rafId !== null) return;
      resizeState.rafId = window.requestAnimationFrame(() => {
        const activeResizeState = sidebarWidthResizeStateRef.current;
        if (!activeResizeState) return;

        activeResizeState.rafId = null;
        activeResizeState.width = activeResizeState.pendingWidth;
        setSidebarWidth(activeResizeState.width);
      });
    },
    [],
  );

  const handleSidebarWidthResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = sidebarWidthResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopSidebarWidthResize();
    },
    [stopSidebarWidthResize],
  );

  const stackViewSelectable = activeChangeRequest !== null && stackSteps.length > 0;
  const worktreeActionDisabled =
    isStackView || worktreeFiles.length === 0 || stageWorktreeChangesMutation.isPending;
  const commitDisabled =
    isStackView || committableStagedFilePaths.length === 0 || runStackedActionMutation.isPending;
  const prActionDisabled =
    !isStackView ||
    selectedChangeRequestReference === null ||
    mergeChangeRequestMutation.isPending ||
    closeChangeRequestMutation.isPending;
  const activeFileIndexLoading = isStackView
    ? stackSteps.length === 0 && stackQuery.isLoading
    : worktreeQuery.isLoading || stagedQuery.isLoading;
  const filesEmptyMessage = isStackView
    ? "No files changed in this stack step."
    : "No tracked working tree changes.";

  useEffect(() => {
    gitDiffStateRestoredRef.current = false;
    skipNextGitDiffStatePersistRef.current = true;
    lastAppliedRepositoryCwdRef.current = null;

    const persistedState = readPersistedGitDiffWorkbenchState(gitDiffStateStorageKey);
    if (persistedState) {
      persistedRepositoryStatesRef.current = persistedState.repositoryStates;
      setSelectedRepositoryCwd(persistedState.selectedRepositoryCwd);
      const repositoryState = persistedState.selectedRepositoryCwd
        ? persistedState.repositoryStates[persistedState.selectedRepositoryCwd]
        : null;
      const initialState = repositoryState ?? persistedState;
      allowAutoSelectFirstFileRef.current = initialState.selectedPath !== null;
      setDiffViewMode(initialState.mode);
      setSelectedPath(initialState.selectedPath);
      setSelectedStackIndex(initialState.selectedStackIndex);
    } else {
      persistedRepositoryStatesRef.current = {};
      setSelectedRepositoryCwd(null);
      allowAutoSelectFirstFileRef.current = true;
      setDiffViewMode("worktree");
      setSelectedPath(null);
      setSelectedStackIndex(null);
    }

    gitDiffStateRestoredRef.current = true;
  }, [gitDiffStateStorageKey]);

  useEffect(() => {
    if (!gitDiffStateRestoredRef.current || !cwd || lastAppliedRepositoryCwdRef.current === cwd) {
      return;
    }

    lastAppliedRepositoryCwdRef.current = cwd;
    setSelectedRepositoryCwd(cwd);
    const repositoryState = persistedRepositoryStatesRef.current[cwd];
    if (repositoryState) {
      allowAutoSelectFirstFileRef.current = repositoryState.selectedPath !== null;
      setDiffViewMode(repositoryState.mode);
      setSelectedPath(repositoryState.selectedPath);
      setSelectedStackIndex(repositoryState.selectedStackIndex);
      return;
    }

    allowAutoSelectFirstFileRef.current = true;
    setDiffViewMode("worktree");
    setSelectedPath(null);
    setSelectedStackIndex(null);
  }, [cwd]);

  useEffect(() => {
    if (!gitDiffStateStorageKey || !gitDiffStateRestoredRef.current) return;
    if (!cwd) return;
    if (skipNextGitDiffStatePersistRef.current) {
      skipNextGitDiffStatePersistRef.current = false;
      return;
    }

    const repositoryState = {
      mode: diffViewMode,
      selectedPath,
      selectedStackIndex,
    };
    const repositoryStates = {
      ...persistedRepositoryStatesRef.current,
      [cwd]: repositoryState,
    };
    persistedRepositoryStatesRef.current = repositoryStates;
    writePersistedGitDiffWorkbenchState(gitDiffStateStorageKey, {
      ...repositoryState,
      selectedRepositoryCwd: cwd,
      repositoryStates,
    });
  }, [cwd, diffViewMode, gitDiffStateStorageKey, selectedPath, selectedStackIndex]);

  useEffect(() => {
    if (
      diffViewMode !== "stack" ||
      !cwd ||
      !stackQuery.isFetched ||
      stackQuery.isError ||
      stackQuery.isLoading ||
      stackQuery.isFetching ||
      stackViewSelectable
    ) {
      return;
    }

    allowAutoSelectFirstFileRef.current = false;
    setDiffViewMode("worktree");
    setSelectedPath(null);
    setSelectedStackIndex(null);
    const repositoryStates = {
      ...persistedRepositoryStatesRef.current,
      [cwd]: {
        mode: "worktree" as const,
        selectedPath: null,
        selectedStackIndex: null,
      },
    };
    persistedRepositoryStatesRef.current = repositoryStates;
    writePersistedGitDiffWorkbenchState(gitDiffStateStorageKey, {
      mode: "worktree",
      selectedPath: null,
      selectedStackIndex: null,
      selectedRepositoryCwd: cwd,
      repositoryStates,
    });
  }, [
    cwd,
    diffViewMode,
    gitDiffStateStorageKey,
    stackQuery.isError,
    stackQuery.isFetched,
    stackQuery.isFetching,
    stackQuery.isLoading,
    stackViewSelectable,
  ]);

  useEffect(() => {
    if (!isStackView) {
      return;
    }
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
  }, [isStackView, selectedStackIndex, stackSteps]);

  useEffect(() => {
    if (
      diffViewMode === "stack" &&
      !isStackView &&
      (!stackQuery.isFetched || stackQuery.isFetching || stackQuery.isLoading || stackQuery.isError)
    ) {
      return;
    }
    if (activeFiles.length === 0) {
      if (activeFileIndexLoading) {
        return;
      }
      setSelectedPath(null);
      return;
    }
    if (!selectedPath && !allowAutoSelectFirstFileRef.current) {
      return;
    }
    if (selectedPath && activeFiles.some((file) => file.path === selectedPath)) {
      return;
    }
    if (allowAutoSelectFirstFileRef.current) {
      setSelectedPath(activeFiles[0]?.path ?? null);
    }
  }, [
    activeFiles,
    diffViewMode,
    isStackView,
    selectedPath,
    stackQuery.isError,
    stackQuery.isFetched,
    stackQuery.isFetching,
    stackQuery.isLoading,
    activeFileIndexLoading,
  ]);

  const refresh = () => {
    void repositoriesQuery.refetch();
    void invalidateGitDiffQueries(queryClient, { environmentId, cwd });
  };

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await action();
        await invalidateGitDiffQueries(queryClient, { environmentId, cwd });
        return true;
      } catch (error) {
        setActionError(formatError(error));
        return false;
      }
    },
    [cwd, environmentId, queryClient],
  );

  const handleStageWorktreeChanges = useCallback(() => {
    void runAction(() =>
      stageWorktreeChangesMutation.mutateAsync({
        filePaths: uniqueFilePaths(worktreeFiles),
        ignoredFilePaths,
      }),
    );
  }, [ignoredFilePaths, runAction, stageWorktreeChangesMutation, worktreeFiles]);

  const handleCommitWorktreeChanges = useCallback(() => {
    if (committableStagedFilePaths.length === 0) return;
    void runAction(() =>
      runStackedActionMutation.mutateAsync({
        actionId: randomUUID(),
        action: "commit",
        filePaths: [...committableStagedFilePaths],
        ...(commitMessage.trim() ? { commitMessage: commitMessage.trim() } : {}),
      }),
    ).then((ok) => {
      if (ok) {
        setIsCommitDialogOpen(false);
        setCommitMessage("");
      }
    });
  }, [commitMessage, committableStagedFilePaths, runAction, runStackedActionMutation]);

  const handlePushWorktreeChanges = useCallback(() => {
    void runAction(() =>
      runStackedActionMutation.mutateAsync({
        actionId: randomUUID(),
        action: "push",
      }),
    );
  }, [runAction, runStackedActionMutation]);

  const handleCreateIgnoreList = useCallback(() => {
    const name = ignoreListName.trim();
    if (!name) return;
    void runAction(() => createIgnoreListMutation.mutateAsync({ name })).then((ok) => {
      if (ok) {
        setIsIgnoreListDialogOpen(false);
        setIgnoreListName("Ignored changes");
      }
    });
  }, [createIgnoreListMutation, ignoreListName, runAction]);

  const updateIgnoreListFiles = useCallback(
    (list: GitDiffIgnoreList, filePaths: readonly string[]) =>
      runAction(() =>
        updateIgnoreListMutation.mutateAsync({
          id: list.id,
          filePaths: [...new Set(filePaths)].toSorted((left, right) => left.localeCompare(right)),
        }),
      ),
    [runAction, updateIgnoreListMutation],
  );

  const handleAddFileToIgnoreList = useCallback(
    (list: GitDiffIgnoreList, filePath: string) => {
      void updateIgnoreListFiles(list, [...list.filePaths, filePath]);
    },
    [updateIgnoreListFiles],
  );

  const handleDeleteIgnoreList = useCallback(
    (id: string) => {
      void runAction(() => deleteIgnoreListMutation.mutateAsync(id));
    },
    [deleteIgnoreListMutation, runAction],
  );

  const handleMergeSelectedChangeRequest = useCallback(() => {
    if (!selectedChangeRequestReference) return;
    void runAction(() =>
      mergeChangeRequestMutation.mutateAsync({
        method: "squash",
        reference: selectedChangeRequestReference,
      }),
    );
  }, [mergeChangeRequestMutation, runAction, selectedChangeRequestReference]);

  const handleCloseSelectedChangeRequest = useCallback(() => {
    if (!selectedChangeRequestReference) return;
    void runAction(() => closeChangeRequestMutation.mutateAsync(selectedChangeRequestReference));
  }, [closeChangeRequestMutation, runAction, selectedChangeRequestReference]);

  const handleCommentSelectedLines = useCallback((selection: GitDiffLineSelection) => {
    setCommentDialogState({ selection, body: "" });
  }, []);

  const handleSubmitLineComment = useCallback(() => {
    if (
      !selectedFile ||
      !selectedChangeRequestReference ||
      commentDialogState === null ||
      !commentDialogState.body.trim()
    ) {
      return;
    }
    void runAction(() =>
      commentChangeRequestLinesMutation.mutateAsync({
        reference: selectedChangeRequestReference,
        path: selectedFile.path,
        body: commentDialogState.body.trim(),
        side: commentDialogState.selection.side,
        line: commentDialogState.selection.end,
        ...(commentDialogState.selection.start !== commentDialogState.selection.end
          ? { startLine: commentDialogState.selection.start }
          : {}),
      }),
    ).then((ok) => {
      if (ok) {
        setCommentDialogState(null);
      }
    });
  }, [
    commentChangeRequestLinesMutation,
    commentDialogState,
    runAction,
    selectedChangeRequestReference,
    selectedFile,
  ]);

  const handleRevertSelectedLines = useCallback(
    (selection: GitDiffLineSelection) => {
      if (!selectedFile || !selectedStackStep || !selectedChangeRequestReference) return;
      void runAction(() =>
        revertChangeRequestLinesMutation.mutateAsync({
          reference: selectedChangeRequestReference,
          baseRef: selectedStackStep.baseRef,
          headRef: selectedStackStep.headRef,
          path: selectedFile.path,
          previousPath: selectedFile.previousPath,
          selection,
        }),
      );
    },
    [
      revertChangeRequestLinesMutation,
      runAction,
      selectedChangeRequestReference,
      selectedFile,
      selectedStackStep,
    ],
  );

  const handleOpenSelectedFile = useCallback(async () => {
    if (!cwd || !selectedFile) return;

    if (!desktopBridgeAvailable || !isMainWindow || (!nvimReady && !vscodeReady)) {
      setActionError("Embedded editor unavailable.");
      return;
    }

    setActionError(null);
    try {
      const nextSelectedStackIndex = selectedStackStep?.index ?? selectedStackIndex;
      allowAutoSelectFirstFileRef.current = true;
      setSelectedPath(selectedFile.path);
      setSelectedStackIndex(nextSelectedStackIndex);
      const repositoryState = {
        mode: diffViewMode,
        selectedPath: selectedFile.path,
        selectedStackIndex: nextSelectedStackIndex,
      };
      const repositoryStates = cwd
        ? {
            ...persistedRepositoryStatesRef.current,
            [cwd]: repositoryState,
          }
        : persistedRepositoryStatesRef.current;
      persistedRepositoryStatesRef.current = repositoryStates;
      writePersistedGitDiffWorkbenchState(gitDiffStateStorageKey, {
        ...repositoryState,
        selectedRepositoryCwd: cwd,
        repositoryStates,
      });

      const editor = resolveActiveEmbeddedEditor({
        preferredEditor: settings.embeddedEditor,
        nvimReady,
        vscodeReady,
      });
      const targetPath = resolveChangedFileEditorPath(cwd, selectedFile.path);
      if (editor === "neovim") {
        await openInEmbeddedEditor(targetPath);
      } else {
        await openInEmbeddedVSCode(targetPath);
      }
    } catch (error) {
      setActionError(formatError(error));
    }
  }, [
    cwd,
    desktopBridgeAvailable,
    diffViewMode,
    gitDiffStateStorageKey,
    isMainWindow,
    nvimReady,
    selectedFile,
    selectedStackIndex,
    selectedStackStep,
    settings.embeddedEditor,
    vscodeReady,
  ]);

  const handleSelectedPathChange = useCallback((path: string | null) => {
    allowAutoSelectFirstFileRef.current = true;
    setSelectedPath(path);
  }, []);

  const handleDiffViewModeChange = useCallback((mode: GitDiffViewMode) => {
    allowAutoSelectFirstFileRef.current = true;
    setDiffViewMode(mode);
  }, []);

  const handleRepositoryCwdChange = useCallback(
    (nextRepositoryCwd: string) => {
      if (!repositoryOptions.some((repository) => repository.cwd === nextRepositoryCwd)) {
        return;
      }
      if (cwd) {
        persistedRepositoryStatesRef.current = {
          ...persistedRepositoryStatesRef.current,
          [cwd]: {
            mode: diffViewMode,
            selectedPath,
            selectedStackIndex,
          },
        };
      }
      allowAutoSelectFirstFileRef.current = true;
      setActionError(null);
      setSelectedRepositoryCwd(nextRepositoryCwd);
    },
    [cwd, diffViewMode, repositoryOptions, selectedPath, selectedStackIndex],
  );

  const filesSectionContent = activeFileIndexLoading ? (
    <div className="px-3 py-4 text-sm text-muted-foreground">Loading changes...</div>
  ) : activeFiles.length > 0 ? (
    <div className="min-h-0 flex-1 px-3 pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="min-h-0 flex-1">
          <ChangedFilesTree
            files={activeFiles}
            selectedPath={selectedPath}
            fillAvailableHeight
            onSelectedPathChange={handleSelectedPathChange}
          />
        </div>
        {!isStackView ? (
          <GitDiffIgnoreListsPanel
            ignoreLists={ignoreLists}
            isBusy={
              createIgnoreListMutation.isPending ||
              updateIgnoreListMutation.isPending ||
              deleteIgnoreListMutation.isPending
            }
            selectedFilePath={selectedFile?.path ?? null}
            onAddFile={handleAddFileToIgnoreList}
            onCreate={() => setIsIgnoreListDialogOpen(true)}
            onDelete={handleDeleteIgnoreList}
            onUpdateFiles={updateIgnoreListFiles}
          />
        ) : null}
      </div>
    </div>
  ) : (
    <div className="px-3 py-4 text-sm text-muted-foreground">{filesEmptyMessage}</div>
  );

  const openActiveChangeRequest = useCallback(() => {
    if (!activeChangeRequest) return;

    void runLocalRpc((api) => api.shell.openExternal(activeChangeRequest.url)).catch(
      (error: unknown) => {
        console.warn("Failed to open active pull request.", error);
      },
    );
  }, [activeChangeRequest]);

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
              <div className="flex min-w-0 items-center gap-2">
                {repositoryOptions.length > 1 ? (
                  <Select
                    value={cwd}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        handleRepositoryCwdChange(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label="Git repository"
                      className="h-7 w-[52rem] max-w-[62vw] min-w-0 font-mono"
                      size="xs"
                      title={selectedRepositoryLabel}
                      variant="ghost"
                    >
                      <GitBranchIcon className="size-3" />
                      <SelectValue className="min-w-0" />
                    </SelectTrigger>
                    <SelectPopup className="min-w-[min(52rem,calc(100vw-2rem))]">
                      {repositoryOptions.map((repository) => (
                        <SelectItem key={repository.cwd} value={repository.cwd}>
                          <span className="block min-w-0 truncate font-mono" title={repository.cwd}>
                            {repository.cwd}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : (
                  <Badge
                    className="max-w-[62vw] truncate font-mono"
                    size="sm"
                    title={selectedRepositoryLabel}
                    variant="secondary"
                  >
                    {selectedRepositoryLabel}
                  </Badge>
                )}
                <GitDiffRepositoryBranchSelector
                  environmentId={environmentId}
                  cwd={cwd}
                  currentBranch={gitStatus.data?.branch ?? null}
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeChangeRequest ? (
              <Button
                aria-label={`Open active pull request #${activeChangeRequest.number}`}
                className="max-w-[18rem] px-2 text-muted-foreground hover:text-foreground"
                size="xs"
                title={`Open #${activeChangeRequest.number}: ${activeChangeRequest.title}`}
                variant="ghost"
                onClick={openActiveChangeRequest}
              >
                <ExternalLinkIcon className="size-3" />
                <span className="shrink-0 tabular-nums">#{activeChangeRequest.number}</span>
                <span className="hidden min-w-0 truncate md:inline">
                  {activeChangeRequest.title}
                </span>
              </Button>
            ) : null}
            {!isStackView ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label="Stage worktree changes"
                  disabled={worktreeActionDisabled}
                  size="icon-xs"
                  title="Stage changes"
                  variant="ghost"
                  onClick={handleStageWorktreeChanges}
                >
                  <CheckCircle2Icon />
                </Button>
                <Button
                  aria-label="Commit staged changes"
                  disabled={commitDisabled}
                  size="icon-xs"
                  title="Commit staged changes"
                  variant="ghost"
                  onClick={() => setIsCommitDialogOpen(true)}
                >
                  <GitCommitHorizontalIcon />
                </Button>
                <Button
                  aria-label="Push current branch"
                  disabled={runStackedActionMutation.isPending}
                  size="icon-xs"
                  title="Push"
                  variant="ghost"
                  onClick={handlePushWorktreeChanges}
                >
                  <UploadIcon />
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label="Squash and merge selected pull request"
                  disabled={prActionDisabled}
                  size="icon-xs"
                  title="Squash and merge pull request"
                  variant="ghost"
                  onClick={handleMergeSelectedChangeRequest}
                >
                  <GitMergeIcon />
                </Button>
                <Button
                  aria-label="Close selected pull request"
                  disabled={prActionDisabled}
                  size="icon-xs"
                  title="Close pull request"
                  variant="ghost"
                  onClick={handleCloseSelectedChangeRequest}
                >
                  <XCircleIcon />
                </Button>
              </div>
            )}
            <ToggleGroup
              aria-label="Git diff view mode"
              className="shrink-0 rounded-md border border-border/70 bg-muted/30 p-0.5"
              variant="default"
              size="xs"
              value={[isStackView ? "stack" : "worktree"]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "stack" && stackViewSelectable) {
                  handleDiffViewModeChange("stack");
                } else if (next === "worktree") {
                  handleDiffViewModeChange("worktree");
                }
              }}
            >
              <Toggle
                aria-label="Show stacked branch diff"
                className="size-6 min-w-6 rounded-[5px] px-0 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs"
                disabled={!stackViewSelectable}
                title={
                  stackViewSelectable
                    ? "Pull request stack"
                    : stackQuery.isLoading
                      ? "Loading active pull request"
                      : stackQuery.error
                        ? "Failed to load active pull request"
                        : "No active pull request"
                }
                value="stack"
              >
                <GitBranchIcon className="size-3" />
              </Toggle>
              <Toggle
                aria-label="Show normal working tree diff"
                className="size-6 min-w-6 rounded-[5px] px-0 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs"
                title="Normal view"
                value="worktree"
              >
                <GitCompareIcon className="size-3" />
              </Toggle>
            </ToggleGroup>
            <span className="min-w-[4.5rem] text-right text-xs tabular-nums text-muted-foreground">
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

        {activeFileIndexError ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {formatError(activeFileIndexError)}
          </div>
        ) : null}
        {actionError ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {actionError}
          </div>
        ) : null}
        {isStackView && selectedChangeRequest ? (
          <GitDiffChangeRequestChecksStrip
            checks={checksQuery.data ?? []}
            isFetching={checksQuery.isFetching}
            pullRequest={selectedChangeRequest}
          />
        ) : null}

        <div className="flex min-h-0 min-w-0 w-full flex-1">
          <aside
            ref={sidebarRef}
            className="relative flex min-h-0 shrink-0 flex-col border-r border-border bg-background"
            style={{ width: sidebarWidth }}
          >
            {stackSteps.length > 0 && isStackView && baseRef !== null ? (
              <>
                <GitDiffSidebarSectionHeader
                  open={stackSectionOpen}
                  title={`${baseRef} at top, newest at bottom`}
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
              className={
                stackSteps.length > 0 && isStackView && baseRef !== null ? "border-t-0" : undefined
              }
              open={filesSectionOpen}
              title={`${activeFiles.length} changed ${activeFiles.length === 1 ? "file" : "files"}`}
              onToggle={() => setFilesSectionOpen((open) => !open)}
            />
            {filesSectionOpen ? (
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {filesSectionContent}
              </section>
            ) : null}
            <button
              aria-label="Resize git diff sidebar"
              className="group absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize items-stretch justify-center"
              tabIndex={-1}
              title="Drag to resize sidebar"
              type="button"
              onPointerCancel={handleSidebarWidthResizePointerEnd}
              onPointerDown={handleSidebarWidthResizePointerDown}
              onPointerMove={handleSidebarWidthResizePointerMove}
              onPointerUp={handleSidebarWidthResizePointerEnd}
            >
              <span className="h-full w-px bg-transparent transition-colors group-hover:bg-ring/80" />
            </button>
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
            enableFileDrag={!isStackView}
            enableLineActions={isStackView && selectedChangeRequestReference !== null}
            error={selectedFileQuery.error}
            isLineActionPending={
              commentChangeRequestLinesMutation.isPending ||
              revertChangeRequestLinesMutation.isPending
            }
            isLoading={selectedFileQuery.isLoading}
            onCommentSelectedLines={handleCommentSelectedLines}
            onDiffHunkSeparatorsChange={setDiffHunkSeparators}
            onDiffIgnoreWhitespaceChange={setDiffIgnoreWhitespace}
            onDiffLineHighlightModeChange={setDiffLineHighlightMode}
            onDiffLineNumbersChange={setDiffLineNumbers}
            onDiffRenderModeChange={setDiffRenderMode}
            onDiffWordWrapChange={setDiffWordWrap}
            onOpenSelectedFile={handleOpenSelectedFile}
            onRevertSelectedLines={handleRevertSelectedLines}
            rawDiffFontStyle={rawDiffFontStyle}
            resolvedTheme={resolvedTheme as DiffThemeType}
            reviewThreads={isStackView ? (reviewThreadsQuery.data ?? []) : []}
            selectedFile={selectedFile}
            syntaxTheme={syntaxTheme}
            title={
              isStackView
                ? selectedStackStep
                  ? formatChangeRequestDirectionLabel({
                      baseRef: selectedStackStep.baseRef,
                      headRef: selectedStackStep.headRef,
                    })
                  : formatChangeRequestDirectionLabel({
                      baseRef: activeChangeRequest?.baseRefName,
                      headRef: activeChangeRequest?.headRefName ?? headRef,
                    })
                : worktreeDisplayTargetKind === "staged"
                  ? "Staged changes"
                  : "Working tree"
            }
          />
        </div>
      </div>
      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          setIsCommitDialogOpen(open);
          if (!open) {
            setCommitMessage("");
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Commit staged changes</DialogTitle>
            <DialogDescription>
              {committableStagedFilePaths.length} files, {ignoredFilePaths.length} ignored.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Textarea
              autoFocus
              placeholder="Leave empty to auto-generate"
              size="sm"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsCommitDialogOpen(false);
                setCommitMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={commitDisabled || runStackedActionMutation.isPending}
              size="sm"
              onClick={handleCommitWorktreeChanges}
            >
              Commit
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={isIgnoreListDialogOpen}
        onOpenChange={(open) => {
          setIsIgnoreListDialogOpen(open);
          if (!open) {
            setIgnoreListName("Ignored changes");
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Create ignore list</DialogTitle>
            <DialogDescription>Stored in local git metadata, not in .gitignore.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              size="sm"
              value={ignoreListName}
              onChange={(event) => setIgnoreListName(event.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsIgnoreListDialogOpen(false);
                setIgnoreListName("Ignored changes");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!ignoreListName.trim() || createIgnoreListMutation.isPending}
              size="sm"
              onClick={handleCreateIgnoreList}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={commentDialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCommentDialogState(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Comment selected lines</DialogTitle>
            <DialogDescription>
              {commentDialogState ? formatSelectionLabel(commentDialogState.selection) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Textarea
              autoFocus
              placeholder="Comment"
              size="sm"
              value={commentDialogState?.body ?? ""}
              onChange={(event) =>
                setCommentDialogState((current) =>
                  current ? { ...current, body: event.target.value } : current,
                )
              }
            />
          </DialogPanel>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setCommentDialogState(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                commentDialogState === null ||
                !commentDialogState.body.trim() ||
                commentChangeRequestLinesMutation.isPending
              }
              size="sm"
              onClick={handleSubmitLineComment}
            >
              Comment
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
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

function GitDiffChangeRequestChecksStrip(props: {
  readonly pullRequest: ChangeRequest;
  readonly checks: readonly ChangeRequestCheck[];
  readonly isFetching: boolean;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-background px-3 text-xs">
      <span className="shrink-0 font-medium tabular-nums">PR #{props.pullRequest.number}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {props.checks.length === 0 ? (
          <span className="truncate text-muted-foreground">
            {props.isFetching ? "Loading checks..." : "No checks"}
          </span>
        ) : (
          props.checks.slice(0, 8).map((check) => (
            <span
              key={`${check.name}:${check.status}`}
              className="inline-flex min-w-0 max-w-48 items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5"
              title={check.description ?? check.name}
            >
              <span className={cn("shrink-0", checkStatusTone(check.status))}>
                {check.status === "success" ? (
                  <CheckCircle2Icon className="size-3" />
                ) : check.status === "failure" || check.status === "cancelled" ? (
                  <XCircleIcon className="size-3" />
                ) : check.status === "skipped" ? (
                  <BanIcon className="size-3" />
                ) : (
                  <RefreshCwIcon className={cn("size-3", props.isFetching && "animate-spin")} />
                )}
              </span>
              <span className="truncate">{check.name}</span>
            </span>
          ))
        )}
      </div>
      {props.checks.length > 8 ? (
        <span className="shrink-0 text-muted-foreground">+{props.checks.length - 8}</span>
      ) : null}
    </div>
  );
}

function GitDiffIgnoreListsPanel(props: {
  readonly ignoreLists: readonly GitDiffIgnoreList[];
  readonly selectedFilePath: string | null;
  readonly isBusy: boolean;
  readonly onCreate: () => void;
  readonly onDelete: (id: string) => void;
  readonly onAddFile: (list: GitDiffIgnoreList, filePath: string) => void;
  readonly onUpdateFiles: (
    list: GitDiffIgnoreList,
    filePaths: readonly string[],
  ) => Promise<boolean>;
}) {
  const { onAddFile } = props;
  const handleDrop = useCallback(
    (list: GitDiffIgnoreList, event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const filePath =
        event.dataTransfer.getData(GIT_DIFF_IGNORE_LIST_DRAG_TYPE) ||
        event.dataTransfer.getData("text/plain");
      const normalizedPath = filePath.trim();
      if (normalizedPath.length === 0) return;
      onAddFile(list, normalizedPath);
    },
    [onAddFile],
  );

  return (
    <section className="shrink-0 rounded-md border border-border/70 bg-muted/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Ignore lists</span>
        <Button
          aria-label="Create ignore list"
          disabled={props.isBusy}
          size="icon-xs"
          title="Create ignore list"
          variant="ghost"
          onClick={props.onCreate}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="max-h-44 space-y-2 overflow-auto pr-1">
        {props.ignoreLists.length === 0 ? (
          <button
            className="flex h-12 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:bg-muted/50"
            type="button"
            onClick={props.onCreate}
          >
            Create list
          </button>
        ) : (
          props.ignoreLists.map((list) => (
            <div
              key={list.id}
              className="rounded-md border border-border/70 bg-background/70 p-2"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => handleDrop(list, event)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium">{list.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {props.selectedFilePath && !list.filePaths.includes(props.selectedFilePath) ? (
                    <Button
                      aria-label={`Add ${props.selectedFilePath} to ${list.name}`}
                      disabled={props.isBusy}
                      size="icon-xs"
                      title="Add selected file"
                      variant="ghost"
                      onClick={() => {
                        if (props.selectedFilePath) {
                          props.onAddFile(list, props.selectedFilePath);
                        }
                      }}
                    >
                      <BanIcon />
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`Delete ${list.name}`}
                    disabled={props.isBusy}
                    size="icon-xs"
                    title="Delete ignore list"
                    variant="ghost"
                    onClick={() => props.onDelete(list.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
              {list.filePaths.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {list.filePaths.slice(0, 5).map((filePath) => (
                    <div
                      key={filePath}
                      className="flex items-center justify-between gap-2 rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      <span className="min-w-0 truncate">{filePath}</span>
                      <button
                        aria-label={`Remove ${filePath}`}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        disabled={props.isBusy}
                        type="button"
                        onClick={() => {
                          void props.onUpdateFiles(
                            list,
                            list.filePaths.filter((path) => path !== filePath),
                          );
                        }}
                      >
                        <XCircleIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                  {list.filePaths.length > 5 ? (
                    <div className="px-1.5 text-[11px] text-muted-foreground">
                      +{list.filePaths.length - 5}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 rounded border border-dashed border-border px-2 py-2 text-center text-[11px] text-muted-foreground">
                  Drop files
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
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
  readonly rawDiffFontStyle: CSSProperties;
  readonly enableLineActions: boolean;
  readonly isLineActionPending: boolean;
  readonly onCommentSelectedLines: (selection: GitDiffLineSelection) => void;
  readonly onRevertSelectedLines: (selection: GitDiffLineSelection) => void;
  readonly onOpenSelectedFile: () => void;
  readonly enableFileDrag: boolean;
  readonly reviewThreads: readonly ChangeRequestReviewThread[];
}) {
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const errorMessage = props.error ? formatError(props.error) : null;
  const normalizedSelectedLines = useMemo(
    () => normalizeDiffLineSelection(selectedLines),
    [selectedLines],
  );

  useEffect(() => {
    setSelectedLines(null);
  }, [props.selectedFile?.path, props.diff?.path, props.diff?.previousPath]);

  useEffect(() => {
    if (!props.enableLineActions || selectedLines === null || typeof window === "undefined") {
      return;
    }

    const handleEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      setSelectedLines(null);
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleEscapeKeyDown);
    return () => window.removeEventListener("keydown", handleEscapeKeyDown);
  }, [props.enableLineActions, selectedLines]);

  const handleSelectedFileDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!props.enableFileDrag || !props.selectedFile) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(GIT_DIFF_IGNORE_LIST_DRAG_TYPE, props.selectedFile.path);
      event.dataTransfer.setData("text/plain", props.selectedFile.path);
    },
    [props.enableFileDrag, props.selectedFile],
  );

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
  const selectedFileReviewAnnotations = useMemo(
    () =>
      props.selectedFile
        ? buildReviewThreadAnnotations({
            threads: props.reviewThreads,
            file: props.selectedFile,
          })
        : [],
    [props.reviewThreads, props.selectedFile],
  );
  const parsedFileReviewAnnotations = useMemo(() => {
    const annotations = new Map<string, DiffLineAnnotation<GitDiffReviewThreadAnnotation>[]>();
    if (renderablePatch?.kind !== "files") {
      return annotations;
    }

    for (const fileDiff of renderablePatch.files) {
      const path = resolveParsedFileDiffPath(fileDiff);
      annotations.set(
        buildParsedFileDiffRenderKey(fileDiff),
        buildReviewThreadAnnotations({
          threads: props.reviewThreads,
          file: {
            path,
            previousPath: normalizeReviewThreadPath(fileDiff.prevName),
          },
        }),
      );
    }

    return annotations;
  }, [props.reviewThreads, renderablePatch]);
  const renderReviewThreadAnnotation = useCallback(
    (annotation: DiffLineAnnotation<GitDiffReviewThreadAnnotation>) => (
      <GitDiffReviewThreadAnnotationCard threads={annotation.metadata.threads} />
    ),
    [],
  );
  const handleDiffLineClick = useCallback<NonNullable<GitDiffFileDiffOptions["onLineClick"]>>(
    (line) => {
      if (
        !props.enableLineActions ||
        (line.lineType !== "change-addition" && line.lineType !== "change-deletion")
      ) {
        return;
      }

      setSelectedLines({
        end: line.lineNumber,
        side: line.annotationSide,
        start: line.lineNumber,
      });
    },
    [props.enableLineActions],
  );
  const diffOptions = useMemo<GitDiffFileDiffOptions>(
    () => ({
      collapsedContextThreshold: 12,
      controlledSelection: props.enableLineActions,
      diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
      disableLineNumbers: !props.diffLineNumbers,
      enableLineSelection: props.enableLineActions,
      expansionLineCount: 80,
      hunkSeparators: props.diffHunkSeparators,
      lineDiffType: props.diffLineHighlightMode === "inline" ? "word-alt" : "none",
      onLineClick: handleDiffLineClick,
      onLineSelected: setSelectedLines,
      onLineSelectionChange: setSelectedLines,
      onLineSelectionEnd: setSelectedLines,
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
      props.enableLineActions,
      handleDiffLineClick,
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
          {props.enableLineActions ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Comment selected lines"
                disabled={!normalizedSelectedLines || props.isLineActionPending}
                size="icon-xs"
                title={
                  normalizedSelectedLines
                    ? `Comment ${formatSelectionLabel(normalizedSelectedLines)}`
                    : "Select changed lines"
                }
                variant="ghost"
                onClick={() => {
                  if (normalizedSelectedLines) {
                    props.onCommentSelectedLines(normalizedSelectedLines);
                  }
                }}
              >
                <MessageSquareIcon />
              </Button>
              <Button
                aria-label="Revert selected lines"
                disabled={!normalizedSelectedLines || props.isLineActionPending}
                size="icon-xs"
                title={
                  normalizedSelectedLines
                    ? `Revert ${formatSelectionLabel(normalizedSelectedLines)}`
                    : "Select changed lines"
                }
                variant="ghost"
                onClick={() => {
                  if (normalizedSelectedLines) {
                    props.onRevertSelectedLines(normalizedSelectedLines);
                  }
                }}
              >
                <Undo2Icon />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
        <div className="h-full min-w-0 w-full overflow-hidden rounded-md border border-border bg-background">
          <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <button
                aria-label={
                  props.selectedFile ? `Open ${props.selectedFile.path} in editor` : undefined
                }
                className={cn(
                  "min-w-0 cursor-pointer truncate rounded-sm text-left font-mono text-sm outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  !props.selectedFile && "cursor-default text-muted-foreground",
                )}
                draggable={props.enableFileDrag && props.selectedFile !== null}
                title={
                  props.selectedFile
                    ? props.enableFileDrag
                      ? "Open in editor or drag into an ignore list"
                      : "Open in editor"
                    : undefined
                }
                type="button"
                onDragStart={handleSelectedFileDragStart}
                onClick={() => {
                  if (props.selectedFile) {
                    props.onOpenSelectedFile();
                  }
                }}
              >
                {props.selectedFile?.path ?? "Select a changed file"}
              </button>
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
                <FileDiff<GitDiffReviewThreadAnnotation>
                  fileDiff={fullFileDiff}
                  lineAnnotations={selectedFileReviewAnnotations}
                  options={diffOptions}
                  renderAnnotation={renderReviewThreadAnnotation}
                  selectedLines={selectedLines}
                />
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
                  <FileDiff<GitDiffReviewThreadAnnotation>
                    fileDiff={fileDiff}
                    lineAnnotations={
                      parsedFileReviewAnnotations.get(buildParsedFileDiffRenderKey(fileDiff)) ?? []
                    }
                    options={diffOptions}
                    renderAnnotation={renderReviewThreadAnnotation}
                    selectedLines={selectedLines}
                  />
                </div>
              ))}
            </Virtualizer>
          ) : renderablePatch?.kind === "raw" ? (
            <div className="h-[calc(100%-2.75rem)] overflow-auto p-3">
              <p className="mb-2 text-xs text-muted-foreground">{renderablePatch.reason}</p>
              <pre
                className={cn(
                  "rounded-md border border-border/70 bg-background/70 p-3 leading-relaxed text-muted-foreground/90",
                  props.diffWordWrap
                    ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                    : "overflow-auto",
                )}
                style={props.rawDiffFontStyle}
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

function GitDiffReviewThreadAnnotationCard(props: {
  readonly threads: readonly ChangeRequestReviewThread[];
}) {
  if (props.threads.length === 0) return null;

  return (
    <div className="mx-8 my-3 max-w-3xl overflow-hidden rounded-md border border-border bg-background shadow-sm">
      {props.threads.map((thread, threadIndex) => {
        const firstCommentUrl = thread.comments.find((comment) => comment.url)?.url;
        return (
          <section
            key={thread.id}
            className={cn(
              "px-4 py-3",
              threadIndex > 0 && "border-t border-border/80",
              thread.isResolved && "opacity-70",
            )}
          >
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge size="sm" variant={thread.side === "additions" ? "success" : "destructive"}>
                  {formatReviewThreadLineLabel(thread)}
                </Badge>
                {thread.isResolved ? (
                  <Badge size="sm" variant="secondary">
                    Resolved
                  </Badge>
                ) : null}
                {thread.isOutdated ? (
                  <Badge size="sm" variant="secondary">
                    Outdated
                  </Badge>
                ) : null}
              </div>
              {firstCommentUrl ? (
                <a
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  href={firstCommentUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : null}
            </div>
            <div className="space-y-3">
              {thread.comments.map((comment) => (
                <article key={comment.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
                  <ReviewCommentAvatar
                    avatarUrl={comment.author.avatarUrl}
                    login={comment.author.login}
                  />
                  <div className="min-w-0">
                    <div className="mb-1 flex min-w-0 items-baseline gap-2 text-xs">
                      <span className="truncate font-semibold text-foreground">
                        {comment.author.login}
                      </span>
                      {formatReviewCommentTimestamp(comment.createdAt) ? (
                        <span className="shrink-0 text-muted-foreground">
                          {formatReviewCommentTimestamp(comment.createdAt)}
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground">
                      {comment.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReviewCommentAvatar(props: {
  readonly avatarUrl: string | undefined;
  readonly login: string;
}) {
  if (props.avatarUrl) {
    return (
      <img
        alt=""
        className="size-7 rounded-full border border-border bg-muted object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={props.avatarUrl}
      />
    );
  }

  return (
    <span className="flex size-7 items-center justify-center rounded-full border border-border bg-muted text-[0.65rem] font-semibold uppercase text-muted-foreground">
      {props.login.slice(0, 2)}
    </span>
  );
}

function formatReviewThreadLineLabel(thread: ChangeRequestReviewThread): string {
  const prefix = thread.side === "additions" ? "+" : "-";
  const startLine = thread.startLine ?? thread.line;
  return startLine === thread.line
    ? `${prefix}${thread.line}`
    : `${prefix}${startLine}-${thread.line}`;
}

function formatReviewCommentTimestamp(createdAt: string | undefined): string | null {
  if (!createdAt || !Number.isFinite(new Date(createdAt).getTime())) {
    return null;
  }
  return formatRelativeTimeLabel(createdAt);
}

function GitDiffWorkbenchEmptyState(props: { readonly label: string }) {
  return (
    <div className="flex h-[calc(100%-2.75rem)] items-center justify-center px-4 text-sm text-muted-foreground">
      {props.label}
    </div>
  );
}
