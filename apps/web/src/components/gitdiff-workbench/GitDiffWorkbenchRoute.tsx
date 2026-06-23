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
  type GitDiffCommit,
  type GitDiffFileSummary,
  type GitDiffHunkSummary,
  type GitDiffIgnoreList,
  type GitDiffRepository,
  type GitDiffRepositoryOperation,
  type GitDiffReviewSessionSnapshot,
  type GitDiffReviewNote,
  type GitDiffStackStep,
  type GitDiffStash,
  type LoadDiffFileResult,
  type ScopedThreadRef,
  type ThreadId,
} from "@fenrir/contracts";
import { truncate } from "@fenrir/shared/String";
import { LegendList } from "@legendapp/list/react";
import {
  prepareFileTreeInput,
  type FileTreeRowDecorationRenderer,
  type GitStatusEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  BanIcon,
  ArchiveIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Columns2Icon,
  DownloadIcon,
  GitCommitHorizontalIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitMergeIcon,
  HistoryIcon,
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
  type SetStateAction,
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
import { ensureEnvironmentApi, readEnvironmentApi } from "~/environmentApi";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { openInEmbeddedEditor, openInEmbeddedVSCode } from "~/editorPreferences";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import {
  DIFF_CHANGE_HIGHLIGHT_UNSAFE_CSS,
  buildDiffFontUnsafeCSSDeclarations,
  buildPatchCacheKey,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import {
  gitDiffActiveChangeRequestStackedFileIndexQueryOptions,
  gitDiffAbortOperationMutationOptions,
  gitDiffAmendStagedChangesMutationOptions,
  gitDiffChangeRequestChecksQueryOptions,
  gitDiffChangeRequestReviewThreadsQueryOptions,
  gitDiffChangeSignatureQueryOptions,
  gitDiffCherryPickCommitMutationOptions,
  gitDiffContinueOperationMutationOptions,
  gitDiffCloseChangeRequestMutationOptions,
  gitDiffCommentChangeRequestLinesMutationOptions,
  gitDiffCreateIgnoreListMutationOptions,
  gitDiffCreateReviewNoteMutationOptions,
  gitDiffCreateStashMutationOptions,
  gitDiffDeleteIgnoreListMutationOptions,
  gitDiffDeleteReviewNoteMutationOptions,
  gitDiffDiscardWorktreeHunkMutationOptions,
  gitDiffDiscardWorktreeChangesMutationOptions,
  gitDiffDropStashMutationOptions,
  gitDiffFileQueryOptions,
  gitDiffFileIndexQueryOptions,
  gitDiffHistoryQueryOptions,
  gitDiffIgnoreListsQueryOptions,
  gitDiffMergeChangeRequestMutationOptions,
  gitDiffOperationQueryOptions,
  gitDiffApplyStashMutationOptions,
  gitDiffPopStashMutationOptions,
  gitDiffRepositoriesQueryOptions,
  gitDiffReviewNotesQueryOptions,
  gitDiffRevertChangeRequestLinesMutationOptions,
  gitDiffRevertCommitMutationOptions,
  gitDiffStageWorktreeChangesMutationOptions,
  gitDiffStashesQueryOptions,
  gitDiffTargetFileIndexQueryOptions,
  gitDiffUnstageStagedChangesMutationOptions,
  gitDiffUpdateIgnoreListMutationOptions,
  invalidateGitDiffQueries,
} from "~/lib/gitDiffReactQuery";
import {
  gitQueryKeys,
  gitRunStackedActionMutationOptions,
  vcsRefSearchInfiniteQueryOptions,
  vcsPullMutationOptions,
} from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { runLocalRpc } from "~/hooks/useRpc";
import { EditorPromptWorkersOverlay, resolveActiveEmbeddedEditor } from "~/modules/neovim-editor";
import { cn, newCommandId, newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import {
  selectProjectByRef,
  selectThreadByRef,
  selectThreadsAcrossEnvironments,
  type AppState,
  useStore,
} from "~/store";
import { toastManager } from "~/components/ui/toast";
import { formatRelativeTimeLabel } from "~/lib/formatting";
import { resolveThreadRouteRef } from "~/threadRoutes";
import { useServerKeybindings } from "~/rpc/serverState";
import { toEditorWorkerItem } from "~/editorPromptWorkers";
import { isEditorTransientThread } from "~/threadVisibility";
import type { Thread } from "~/types";
import {
  gitDiffWorkbenchScopeKey,
  selectGitDiffWorkbenchScopeState,
  useGitDiffWorkbenchStore,
  type GitDiffWorkbenchHunkSeparators,
  type GitDiffWorkbenchLineHighlightMode,
  type GitDiffWorkbenchRenderMode,
  type GitDiffWorkbenchTargetKind,
  type GitDiffWorkbenchViewMode,
} from "./gitDiffWorkbenchStore";
import {
  appendGitDiffReviewContextToPrompt,
  extractGitDiffReviewSelectionText,
  formatGitDiffReviewContextLabels,
  formatGitDiffReviewContextTitle,
  formatDiffTargetLabel,
  resolveGitDiffReviewSelectionHunkIndex,
  type GitDiffReviewLineSelection,
  type GitDiffReviewPromptContext,
} from "./gitDiffReviewPromptContext";

const GIT_DIFF_FILE_TREE_ROW_HEIGHT = 24;
const GIT_DIFF_FILE_TREE_MIN_VISIBLE_ROWS = 4;
const GIT_DIFF_FILE_TREE_MAX_VISIBLE_ROWS = 18;
const GIT_DIFF_SIDEBAR_SECTION_HEADER_HEIGHT = 44;
const GIT_DIFF_SIDEBAR_RESIZE_HANDLE_HEIGHT = 10;
const GIT_DIFF_SIDEBAR_MIN_WIDTH = 280;
const GIT_DIFF_SIDEBAR_MAX_WIDTH = 720;
const GIT_DIFF_SIDEBAR_STACK_MIN_HEIGHT = 144;
const GIT_DIFF_SIDEBAR_FILES_MIN_HEIGHT = 120;
const GIT_DIFF_IGNORE_LIST_DRAG_TYPE = "application/x-fenrir-git-diff-file-path";
const EMPTY_GIT_DIFF_IGNORE_LISTS: readonly GitDiffIgnoreList[] = [];
const EMPTY_GIT_DIFF_HISTORY: readonly GitDiffCommit[] = [];
const EMPTY_GIT_DIFF_STASHES: readonly GitDiffStash[] = [];
const EMPTY_GIT_DIFF_REVIEW_NOTES: readonly GitDiffReviewNote[] = [];
const GIT_DIFF_HEADER_ACTION_BUTTON_CLASS =
  "text-foreground/85 hover:text-primary disabled:text-muted-foreground/35 disabled:opacity-100 [&_svg]:opacity-100";
const GIT_DIFF_HEADER_VIEW_TOGGLE_CLASS =
  "size-6 min-w-6 rounded-[5px] px-0 text-muted-foreground/70 hover:text-foreground disabled:text-muted-foreground/25 disabled:opacity-100 data-pressed:bg-background data-pressed:text-primary data-pressed:shadow-xs data-pressed:ring-1 data-pressed:ring-primary/35 [&_svg]:opacity-100";
const GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS =
  "size-7 min-w-7 rounded-lg border-border/70 bg-muted/20 px-0 text-muted-foreground/75 hover:border-border hover:bg-accent/45 hover:text-foreground disabled:text-muted-foreground/30 disabled:opacity-100 data-pressed:border-primary/45 data-pressed:bg-primary/10 data-pressed:text-primary data-pressed:shadow-none data-pressed:ring-1 data-pressed:ring-primary/25 [&_svg]:opacity-100";
const GIT_DIFF_VIEWER_CONTROL_SELECT_TRIGGER_CLASS =
  "h-7 w-[8.75rem] rounded-lg border border-border/70 bg-muted/20 px-2 text-muted-foreground/80 shadow-none hover:border-border hover:bg-accent/45 hover:text-foreground data-pressed:border-primary/45 data-pressed:bg-primary/10 data-pressed:text-primary data-pressed:ring-1 data-pressed:ring-primary/25 [&_svg]:opacity-100";

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

type DiffRenderMode = GitDiffWorkbenchRenderMode;
type DiffThemeType = "light" | "dark";
type DiffLineHighlightMode = GitDiffWorkbenchLineHighlightMode;
type GitDiffViewMode = GitDiffWorkbenchViewMode;
type GitDiffReviewAnnotation =
  | { readonly kind: "provider-thread"; readonly threads: readonly ChangeRequestReviewThread[] }
  | { readonly kind: "local-note"; readonly notes: readonly GitDiffReviewNote[] };
type BuiltInHunkSeparators = GitDiffWorkbenchHunkSeparators;
type GitDiffFileDiffOptions = NonNullable<
  ComponentProps<typeof FileDiff<GitDiffReviewAnnotation>>["options"]
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
type GitDiffCommitDialogState =
  | {
      readonly kind: "commit";
      readonly scope: "all_staged" | "selected_file";
      readonly filePaths: readonly string[];
    }
  | {
      readonly kind: "amend";
      readonly filePaths: readonly string[];
    };

const HUNK_SEPARATOR_LABELS: Record<BuiltInHunkSeparators, string> = {
  "line-info": "Line info",
  "line-info-basic": "Basic",
  metadata: "Metadata",
  simple: "Simple",
};

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
:host,
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
${buildDiffFontUnsafeCSSDeclarations(fontFamily, fontSize)}
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
  if (file.isTooLarge) return "Too large";
  if (file.isUntracked) return "Untracked";
  if (file.binary) return "Binary";
  if (file.previousPath) return "Renamed";
  if (file.insertions > 0 && file.deletions > 0) return "Modified";
  if (file.insertions > 0) return "Added";
  if (file.deletions > 0) return "Removed";
  return "Changed";
}

function changedFileGitStatus(file: GitDiffFileSummary): GitStatusEntry["status"] {
  if (file.isUntracked) return "added";
  if (file.previousPath) return "renamed";
  if (file.insertions > 0 && file.deletions === 0) return "added";
  if (file.deletions > 0 && file.insertions === 0) return "deleted";
  return "modified";
}

function changedFileDecoration(file: GitDiffFileSummary): string {
  if (file.binary) return "binary";
  const suffix = file.statsTruncated ? "+" : "";
  if (file.hunkCount > 0) {
    return `${file.hunkCount}h +${file.insertions}${suffix} -${file.deletions}`;
  }
  return `+${file.insertions}${suffix} -${file.deletions}`;
}

function changedFileTitle(file: GitDiffFileSummary): string {
  if (file.isUntracked) return "Untracked file";
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
}): DiffLineAnnotation<GitDiffReviewAnnotation>[] {
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
        metadata: { kind: "provider-thread", threads: sortReviewThreads(threads) },
      } satisfies DiffLineAnnotation<GitDiffReviewAnnotation>;
    })
    .toSorted((left, right) => {
      if (left.lineNumber !== right.lineNumber) return left.lineNumber - right.lineNumber;
      return left.side.localeCompare(right.side);
    });
}

function reviewNoteMatchesFile(
  note: GitDiffReviewNote,
  file: Pick<GitDiffFileSummary, "path" | "previousPath">,
): boolean {
  return note.path === file.path || note.path === file.previousPath;
}

function sortReviewNotes(notes: readonly GitDiffReviewNote[]): readonly GitDiffReviewNote[] {
  return notes.toSorted((left, right) => {
    const leftStart = left.startLine ?? left.line;
    const rightStart = right.startLine ?? right.line;
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (left.line !== right.line) return left.line - right.line;
    return left.id.localeCompare(right.id);
  });
}

function buildReviewNoteAnnotations(input: {
  readonly notes: readonly GitDiffReviewNote[];
  readonly file: Pick<GitDiffFileSummary, "path" | "previousPath">;
}): DiffLineAnnotation<GitDiffReviewAnnotation>[] {
  if (input.notes.length === 0) return [];

  const groupedNotes = new Map<string, GitDiffReviewNote[]>();
  for (const note of input.notes) {
    if (!reviewNoteMatchesFile(note, input.file)) continue;

    const key = `${note.side}:${note.line}`;
    const group = groupedNotes.get(key) ?? [];
    group.push(note);
    groupedNotes.set(key, group);
  }

  return [...groupedNotes.entries()]
    .map(([key, notes]) => {
      const separatorIndex = key.indexOf(":");
      const side = key.slice(0, separatorIndex) as "additions" | "deletions";
      const lineNumber = Number(key.slice(separatorIndex + 1));
      return {
        side,
        lineNumber,
        metadata: { kind: "local-note", notes: sortReviewNotes(notes) },
      } satisfies DiffLineAnnotation<GitDiffReviewAnnotation>;
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
    preparedInput: prepareFileTreeInput(paths, {
      flattenEmptyDirectories: true,
    }),
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

function gitDiffCreateBranchItemValue(branchName: string): string {
  return `__create_git_diff_branch__:${branchName}`;
}

function isGitDiffCreateBranchItemValue(value: string): boolean {
  return value.startsWith("__create_git_diff_branch__:");
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

function repositorySearchText(repository: GitDiffRepository): string {
  return `${repository.name}\n${repository.relativePath}\n${repository.cwd}`.toLowerCase();
}

function GitDiffRepositorySelector(props: {
  readonly repositories: readonly GitDiffRepository[];
  readonly selectedCwd: string;
  readonly selectedRepositoryLabel: string;
  readonly onRepositoryCwdChange: (cwd: string) => void;
}) {
  const { onRepositoryCwdChange, repositories, selectedCwd, selectedRepositoryLabel } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const trimmedRepositoryQuery = repositoryQuery.trim().toLowerCase();
  const repositoryItems = useMemo(
    () => repositories.map((repository) => repository.cwd),
    [repositories],
  );
  const repositoryByCwd = useMemo(
    () => new Map(repositories.map((repository) => [repository.cwd, repository] as const)),
    [repositories],
  );
  const selectedRepository = repositoryByCwd.get(selectedCwd) ?? null;
  const filteredRepositoryItems = useMemo(() => {
    if (trimmedRepositoryQuery.length === 0) return repositoryItems;
    return repositoryItems.filter((repositoryCwd) => {
      const repository = repositoryByCwd.get(repositoryCwd);
      return repository ? repositorySearchText(repository).includes(trimmedRepositoryQuery) : false;
    });
  }, [repositoryByCwd, repositoryItems, trimmedRepositoryQuery]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) setRepositoryQuery("");
  }, []);

  const handleRepositorySelect = useCallback(
    (repositoryCwd: string) => {
      setIsOpen(false);
      setRepositoryQuery("");
      onRepositoryCwdChange(repositoryCwd);
    },
    [onRepositoryCwdChange],
  );

  return (
    <Combobox
      items={repositoryItems}
      filteredItems={filteredRepositoryItems}
      autoHighlight
      open={isOpen}
      value={selectedCwd}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger
        aria-label="Git repository"
        className={cn(
          "h-7 min-w-0 max-w-[min(50rem,60vw)] rounded-lg border border-border/70 bg-muted/20 px-2.5 font-mono text-[13px] text-muted-foreground/85 shadow-none transition-[background-color,border-color,color,box-shadow]",
          "hover:border-border hover:bg-accent/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/45",
          isOpen && "border-primary/60 bg-accent/50 text-primary ring-2 ring-primary/35",
        )}
        disabled={repositories.length === 0}
        render={<Button size="xs" variant="ghost" />}
        title={selectedRepositoryLabel}
      >
        <GitBranchIcon className="size-3.5 shrink-0 text-primary/80" />
        <span className="min-w-0 truncate">
          {selectedRepository?.cwd ?? selectedRepositoryLabel}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60" />
      </ComboboxTrigger>
      <ComboboxPopup
        align="start"
        className="w-[min(44rem,calc(100vw-2rem))] border-primary/20 shadow-xl/10"
        side="bottom"
      >
        <div className="border-b border-border/70 p-1.5">
          <ComboboxInput
            className="[&_input]:font-mono rounded-md"
            inputClassName="bg-muted/20 ring-0"
            placeholder="Search repositories..."
            showTrigger={false}
            size="sm"
            value={repositoryQuery}
            onChange={(event) => setRepositoryQuery(event.target.value)}
          />
        </div>
        <ComboboxEmpty className="py-5">No repositories found.</ComboboxEmpty>
        <ComboboxList className="max-h-72">
          {filteredRepositoryItems.map((repositoryCwd, index) => {
            const repository = repositoryByCwd.get(repositoryCwd);
            if (!repository) return null;
            return (
              <ComboboxItem
                key={repository.cwd}
                className="min-h-11 rounded-md"
                index={index}
                value={repository.cwd}
                onClick={() => handleRepositorySelect(repository.cwd)}
              >
                <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-foreground">{repository.name}</span>
                    {repository.isWorkspaceRoot ? (
                      <span className="shrink-0 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        root
                      </span>
                    ) : null}
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                    {repository.cwd}
                  </span>
                </div>
              </ComboboxItem>
            );
          })}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
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
  const canCreateBranch =
    trimmedDeferredBranchQuery.length > 0 && !branchByName.has(trimmedDeferredBranchQuery);
  const createBranchItemValue = canCreateBranch
    ? gitDiffCreateBranchItemValue(trimmedDeferredBranchQuery)
    : null;
  const branchPickerItems = useMemo(
    () => (createBranchItemValue ? [...branchNames, createBranchItemValue] : branchNames),
    [branchNames, createBranchItemValue],
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
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.refs(environmentId, cwd),
      });
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
            queryClient.invalidateQueries({
              queryKey: gitQueryKeys.refs(environmentId, cwd),
            }),
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

  const createAndCheckoutBranch = useCallback(
    (branchName: string) => {
      const name = branchName.trim();
      if (!environmentId || !name || isBranchActionPending) {
        return;
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }

      setIsOpen(false);
      setBranchQuery("");
      startBranchActionTransition(async () => {
        try {
          const result = await api.vcs.createRef({ cwd, refName: name, switchRef: true });
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: gitQueryKeys.refs(environmentId, cwd),
            }),
            invalidateGitDiffQueries(queryClient, { environmentId, cwd }),
          ]);
          toastManager.add({
            type: "success",
            title: "Branch created.",
            description: `Checked out ${result.refName}.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to create branch.",
            description: gitDiffBranchActionErrorMessage(error),
          });
        }
      });
    },
    [cwd, environmentId, isBranchActionPending, queryClient],
  );

  return (
    <Combobox
      items={branchPickerItems}
      filteredItems={branchPickerItems}
      autoHighlight
      open={isOpen}
      value={resolvedCurrentBranch}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className={cn(
          "h-7 max-w-[18rem] rounded-lg border border-transparent px-2 font-mono text-[13px] text-muted-foreground/80 transition-[background-color,border-color,color]",
          "hover:border-border/70 hover:bg-accent/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35",
          isOpen && "border-primary/45 bg-accent/45 text-primary",
        )}
        disabled={!environmentId || isBranchActionPending}
      >
        <GitBranchIcon className="size-3" />
        <span className="truncate font-mono">{resolvedCurrentBranch ?? "Select branch"}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground/60" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-80 border-primary/20 shadow-xl/10">
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
        <ComboboxEmpty>
          {canCreateBranch ? "No matching branches." : "No branches found."}
        </ComboboxEmpty>
        <ComboboxList className="max-h-56">
          {branchPickerItems.map((itemValue, index) => {
            if (isGitDiffCreateBranchItemValue(itemValue)) {
              return (
                <ComboboxItem
                  hideIndicator
                  key={itemValue}
                  index={index}
                  value={itemValue}
                  onClick={() => createAndCheckoutBranch(trimmedDeferredBranchQuery)}
                >
                  <span className="truncate">
                    Create branch &quot;{trimmedDeferredBranchQuery}&quot;
                  </span>
                </ComboboxItem>
              );
            }

            const branch = branchByName.get(itemValue);
            if (!branch) return null;
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
  const gitDiffScopeKey = useMemo(
    () =>
      gitDiffWorkbenchScopeKey({
        environmentId,
        projectId: project?.id ?? null,
      }),
    [environmentId, project?.id],
  );
  const {
    diffHunkSeparators,
    diffIgnoreWhitespace,
    diffLineHighlightMode,
    diffLineNumbers,
    diffRenderMode,
    diffViewMode,
    diffWordWrap,
    filesSectionOpen,
    selectedPath,
    selectedRepositoryCwd,
    selectedStashRef,
    selectedTargetKind,
    selectedStackIndex,
    sidebarWidth,
    stackSectionHeight,
    stackSectionOpen,
  } = useGitDiffWorkbenchStore(
    useShallow((state) => {
      const scopeState = selectGitDiffWorkbenchScopeState(state, gitDiffScopeKey);
      return {
        diffHunkSeparators: scopeState.preferences.diffHunkSeparators,
        diffIgnoreWhitespace: scopeState.preferences.diffIgnoreWhitespace,
        diffLineHighlightMode: scopeState.preferences.diffLineHighlightMode,
        diffLineNumbers: scopeState.preferences.diffLineNumbers,
        diffRenderMode: scopeState.preferences.diffRenderMode,
        diffViewMode: scopeState.mode,
        diffWordWrap: scopeState.preferences.diffWordWrap,
        filesSectionOpen: scopeState.preferences.filesSectionOpen,
        selectedPath: scopeState.selectedPath,
        selectedRepositoryCwd: scopeState.selectedRepositoryCwd,
        selectedStashRef: scopeState.selectedStashRef,
        selectedTargetKind: scopeState.selectedTargetKind,
        selectedStackIndex: scopeState.selectedStackIndex,
        sidebarWidth: scopeState.preferences.sidebarWidth,
        stackSectionHeight: scopeState.preferences.stackSectionHeight,
        stackSectionOpen: scopeState.preferences.stackSectionOpen,
      };
    }),
  );
  const selectGitDiffRepository = useGitDiffWorkbenchStore((state) => state.selectRepository);
  const updateGitDiffRepositoryState = useGitDiffWorkbenchStore(
    (state) => state.updateRepositoryState,
  );
  const updateGitDiffPreferences = useGitDiffWorkbenchStore((state) => state.updatePreferences);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commitDialogState, setCommitDialogState] = useState<GitDiffCommitDialogState | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedHistoryCommitSha, setSelectedHistoryCommitSha] = useState<string | null>(null);
  const [isIgnoreListDialogOpen, setIsIgnoreListDialogOpen] = useState(false);
  const [ignoreListName, setIgnoreListName] = useState("Ignored changes");
  const [commentDialogState, setCommentDialogState] = useState<GitDiffCommentDialogState | null>(
    null,
  );
  const [selectedDiffLineSelection, setSelectedDiffLineSelection] =
    useState<GitDiffReviewLineSelection | null>(null);
  const [gitDiffPromptOpen, setGitDiffPromptOpen] = useState(false);
  const [gitDiffPromptDraft, setGitDiffPromptDraft] = useState("");
  const [gitDiffPromptContext, setGitDiffPromptContext] =
    useState<GitDiffReviewPromptContext | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const stackSectionRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStateRef = useRef<GitDiffSidebarResizeState | null>(null);
  const sidebarWidthResizeStateRef = useRef<GitDiffSidebarWidthResizeState | null>(null);
  const allowAutoSelectFirstFileRef = useRef(true);
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
  const setCurrentRepositoryState = useCallback(
    (patch: {
      readonly mode?: GitDiffViewMode;
      readonly selectedPath?: string | null;
      readonly selectedStashRef?: string | null;
      readonly selectedTargetKind?: GitDiffWorkbenchTargetKind;
      readonly selectedStackIndex?: number | null;
    }) => updateGitDiffRepositoryState(gitDiffScopeKey, cwd, patch),
    [cwd, gitDiffScopeKey, updateGitDiffRepositoryState],
  );
  const setSelectedPath = useCallback(
    (path: string | null, targetKind?: GitDiffWorkbenchTargetKind) =>
      setCurrentRepositoryState({
        selectedPath: path,
        ...(targetKind ? { selectedTargetKind: targetKind } : {}),
      }),
    [setCurrentRepositoryState],
  );
  const setSelectedStackIndex = useCallback(
    (index: number | null) => setCurrentRepositoryState({ selectedStackIndex: index }),
    [setCurrentRepositoryState],
  );
  const setDiffViewMode = useCallback(
    (mode: GitDiffViewMode) => setCurrentRepositoryState({ mode }),
    [setCurrentRepositoryState],
  );
  const setDiffRenderMode = useCallback(
    (diffRenderMode: DiffRenderMode) =>
      updateGitDiffPreferences(gitDiffScopeKey, { diffRenderMode }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setDiffWordWrap = useCallback(
    (diffWordWrap: boolean) => updateGitDiffPreferences(gitDiffScopeKey, { diffWordWrap }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setDiffIgnoreWhitespace = useCallback(
    (diffIgnoreWhitespace: boolean) =>
      updateGitDiffPreferences(gitDiffScopeKey, { diffIgnoreWhitespace }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setDiffLineNumbers = useCallback(
    (diffLineNumbers: boolean) => updateGitDiffPreferences(gitDiffScopeKey, { diffLineNumbers }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setDiffLineHighlightMode = useCallback(
    (diffLineHighlightMode: DiffLineHighlightMode) =>
      updateGitDiffPreferences(gitDiffScopeKey, { diffLineHighlightMode }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setDiffHunkSeparators = useCallback(
    (diffHunkSeparators: BuiltInHunkSeparators) =>
      updateGitDiffPreferences(gitDiffScopeKey, { diffHunkSeparators }),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setStackSectionOpen = useCallback(
    (action: SetStateAction<boolean>) =>
      updateGitDiffPreferences(gitDiffScopeKey, (preferences) => ({
        stackSectionOpen:
          typeof action === "function" ? action(preferences.stackSectionOpen) : action,
      })),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setFilesSectionOpen = useCallback(
    (action: SetStateAction<boolean>) =>
      updateGitDiffPreferences(gitDiffScopeKey, (preferences) => ({
        filesSectionOpen:
          typeof action === "function" ? action(preferences.filesSectionOpen) : action,
      })),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setSidebarWidth = useCallback(
    (action: SetStateAction<number>) =>
      updateGitDiffPreferences(gitDiffScopeKey, (preferences) => ({
        sidebarWidth: typeof action === "function" ? action(preferences.sidebarWidth) : action,
      })),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const setStackSectionHeight = useCallback(
    (action: SetStateAction<number>) =>
      updateGitDiffPreferences(gitDiffScopeKey, (preferences) => ({
        stackSectionHeight:
          typeof action === "function" ? action(preferences.stackSectionHeight) : action,
      })),
    [gitDiffScopeKey, updateGitDiffPreferences],
  );
  const gitStatus = useGitStatus({ environmentId, cwd });
  const { resolvedTheme, syntaxTheme } = useTheme();
  const settings = useSettings();
  const desktopBridgeAvailable = useDesktopBridgeAvailable();
  const isMainWindow = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const keybindings = useServerKeybindings();
  const headRef = gitStatus.data?.branch ?? thread?.branch ?? null;
  const activeThreadId = thread?.id ?? null;
  const editorWorkerThreads = useStore(
    useShallow(
      useMemo(
        () => (state: AppState) => {
          if (!activeThreadId) return [] as Thread[];
          return selectThreadsAcrossEnvironments(state).filter(
            (workerThread) =>
              workerThread.environmentId === environmentId &&
              isEditorTransientThread(workerThread) &&
              workerThread.owner?.kind === "editorPrompt" &&
              workerThread.owner.parentThreadId === activeThreadId,
          );
        },
        [activeThreadId, environmentId],
      ),
    ),
  );
  const editorWorkers = useMemo(
    () => editorWorkerThreads.map(toEditorWorkerItem),
    [editorWorkerThreads],
  );
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
    gitDiffFileIndexQueryOptions({
      environmentId,
      cwd,
      targetKind: "worktree",
    }),
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
  const historyQuery = useQuery(gitDiffHistoryQueryOptions({ environmentId, cwd, limit: 75 }));
  const operationQuery = useQuery(gitDiffOperationQueryOptions({ environmentId, cwd }));
  const ignoreListsQuery = useQuery(gitDiffIgnoreListsQueryOptions({ environmentId, cwd }));
  const stashesQuery = useQuery(gitDiffStashesQueryOptions({ environmentId, cwd }));
  const createIgnoreListMutation = useMutation(
    gitDiffCreateIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const updateIgnoreListMutation = useMutation(
    gitDiffUpdateIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const deleteIgnoreListMutation = useMutation(
    gitDiffDeleteIgnoreListMutationOptions({ environmentId, cwd, queryClient }),
  );
  const createReviewNoteMutation = useMutation(
    gitDiffCreateReviewNoteMutationOptions({ environmentId, cwd, queryClient }),
  );
  const deleteReviewNoteMutation = useMutation(
    gitDiffDeleteReviewNoteMutationOptions({ environmentId, cwd, queryClient }),
  );
  const stageWorktreeChangesMutation = useMutation(
    gitDiffStageWorktreeChangesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const unstageStagedChangesMutation = useMutation(
    gitDiffUnstageStagedChangesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const discardWorktreeChangesMutation = useMutation(
    gitDiffDiscardWorktreeChangesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const discardWorktreeHunkMutation = useMutation(
    gitDiffDiscardWorktreeHunkMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const amendStagedChangesMutation = useMutation(
    gitDiffAmendStagedChangesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const revertCommitMutation = useMutation(
    gitDiffRevertCommitMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const cherryPickCommitMutation = useMutation(
    gitDiffCherryPickCommitMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const continueOperationMutation = useMutation(
    gitDiffContinueOperationMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const abortOperationMutation = useMutation(
    gitDiffAbortOperationMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const createStashMutation = useMutation(
    gitDiffCreateStashMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const applyStashMutation = useMutation(
    gitDiffApplyStashMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const popStashMutation = useMutation(
    gitDiffPopStashMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const dropStashMutation = useMutation(
    gitDiffDropStashMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const closeChangeRequestMutation = useMutation(
    gitDiffCloseChangeRequestMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const mergeChangeRequestMutation = useMutation(
    gitDiffMergeChangeRequestMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const commentChangeRequestLinesMutation = useMutation(
    gitDiffCommentChangeRequestLinesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const revertChangeRequestLinesMutation = useMutation(
    gitDiffRevertChangeRequestLinesMutationOptions({
      environmentId,
      cwd,
      queryClient,
    }),
  );
  const runStackedActionMutation = useMutation(
    gitRunStackedActionMutationOptions({ environmentId, cwd, queryClient }),
  );
  const pullMutation = useMutation(vcsPullMutationOptions({ environmentId, cwd, queryClient }));
  const worktreeFiles = useMemo(() => sortFiles(worktreeQuery.data ?? []), [worktreeQuery.data]);
  const stagedFiles = useMemo(() => sortFiles(stagedQuery.data ?? []), [stagedQuery.data]);
  const ignoreLists = ignoreListsQuery.data ?? EMPTY_GIT_DIFF_IGNORE_LISTS;
  const stashes = stashesQuery.data ?? EMPTY_GIT_DIFF_STASHES;
  const activeOperation = operationQuery.data?.operation ?? null;
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
  const activeChangeRequest = stackQuery.data?.activeChangeRequest ?? null;
  const stackSteps = useMemo(() => sortStackSteps(stackQuery.data?.steps ?? []), [stackQuery.data]);
  const historyCommits = historyQuery.data ?? EMPTY_GIT_DIFF_HISTORY;
  const selectedHistoryCommit =
    historyCommits.find((commit) => commit.sha === selectedHistoryCommitSha) ??
    historyCommits[0] ??
    null;
  const isHistoryView = diffViewMode === "history";
  const isStackView =
    diffViewMode === "stack" && activeChangeRequest !== null && stackSteps.length > 0;
  const isStashView = diffViewMode === "stashes";
  const selectedStash =
    stashes.find((stash) => stash.ref === selectedStashRef) ?? stashes[0] ?? null;
  const stashDiffTarget = useMemo<DiffTarget | null>(
    () => (selectedStash ? ({ kind: "stash", ref: selectedStash.ref } satisfies DiffTarget) : null),
    [selectedStash],
  );
  const historyDiffTarget = useMemo<DiffTarget | null>(
    () =>
      selectedHistoryCommit
        ? {
            kind: "commit",
            commitRef: selectedHistoryCommit.sha,
            parentRef: selectedHistoryCommit.parentSha,
          }
        : null,
    [selectedHistoryCommit],
  );
  const historyFilesQuery = useQuery(
    gitDiffTargetFileIndexQueryOptions({
      environmentId,
      cwd,
      target: historyDiffTarget,
      enabled: isHistoryView && selectedHistoryCommit !== null,
    }),
  );
  const stashFilesQuery = useQuery(
    gitDiffTargetFileIndexQueryOptions({
      environmentId,
      cwd,
      target: stashDiffTarget,
      enabled: isStashView && selectedStash !== null,
    }),
  );
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
  const selectedNormalTargetKind = useMemo<GitDiffWorkbenchTargetKind>(() => {
    const preferredFiles = selectedTargetKind === "staged" ? stagedFiles : worktreeFiles;
    if (selectedPath && preferredFiles.some((file) => file.path === selectedPath)) {
      return selectedTargetKind;
    }
    if (selectedPath && worktreeFiles.some((file) => file.path === selectedPath)) {
      return "worktree";
    }
    if (selectedPath && stagedFiles.some((file) => file.path === selectedPath)) {
      return "staged";
    }
    return worktreeFiles.length > 0 ? "worktree" : "staged";
  }, [selectedPath, selectedTargetKind, stagedFiles, worktreeFiles]);
  const selectedNormalFiles = selectedNormalTargetKind === "staged" ? stagedFiles : worktreeFiles;
  const activeFiles = useMemo(
    () =>
      sortFiles(
        isHistoryView
          ? (historyFilesQuery.data ?? [])
          : isStackView
            ? (selectedStackStep?.files ?? [])
            : isStashView
              ? (stashFilesQuery.data ?? [])
              : selectedNormalFiles,
      ),
    [
      historyFilesQuery.data,
      isHistoryView,
      isStackView,
      isStashView,
      selectedNormalFiles,
      selectedStackStep,
      stashFilesQuery.data,
    ],
  );
  const selectedFile =
    activeFiles.find((file) => file.path === selectedPath) ?? activeFiles[0] ?? null;
  const selectedStagedFileIsCommittable =
    !isStackView &&
    !isHistoryView &&
    !isStashView &&
    selectedNormalTargetKind === "staged" &&
    selectedFile !== null &&
    committableStagedFilePaths.includes(selectedFile.path);
  const activeDiffTarget = useMemo<DiffTarget | null>(() => {
    if (isHistoryView) {
      return historyDiffTarget;
    }
    if (isStashView) {
      return stashDiffTarget;
    }
    if (!isStackView) {
      return { kind: selectedNormalTargetKind };
    }
    if (!selectedStackStep) {
      return null;
    }
    return {
      kind: "range",
      baseRef: selectedStackStep.baseRef,
      headRef: selectedStackStep.headRef,
    };
  }, [
    historyDiffTarget,
    isHistoryView,
    isStackView,
    isStashView,
    selectedNormalTargetKind,
    selectedStackStep,
    stashDiffTarget,
  ]);
  const signatureQuery = useQuery(
    gitDiffChangeSignatureQueryOptions({
      environmentId,
      cwd,
      target: activeDiffTarget,
      enabled: activeDiffTarget !== null,
    }),
  );
  const previousSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = signatureQuery.data?.signature ?? null;
    if (!signature) return;
    if (previousSignatureRef.current === null) {
      previousSignatureRef.current = signature;
      return;
    }
    if (previousSignatureRef.current === signature) return;
    previousSignatureRef.current = signature;
    void invalidateGitDiffQueries(queryClient, { environmentId, cwd });
  }, [cwd, environmentId, queryClient, signatureQuery.data?.signature]);
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
  const reviewNotesQuery = useQuery(
    gitDiffReviewNotesQueryOptions({
      environmentId,
      cwd,
      target: activeDiffTarget,
      enabled: activeDiffTarget !== null,
    }),
  );
  const selectedFilePath = selectedFile?.path ?? null;
  const selectedFilePreviousPath = selectedFile?.previousPath ?? null;
  const selectedFileReviewThreads = useMemo(() => {
    if (!selectedFilePath) {
      return [];
    }

    return sortReviewThreads(
      (reviewThreadsQuery.data ?? []).filter((thread) =>
        reviewThreadMatchesFile(thread, {
          path: selectedFilePath,
          previousPath: selectedFilePreviousPath,
        }),
      ),
    );
  }, [reviewThreadsQuery.data, selectedFilePath, selectedFilePreviousPath]);
  const createGitDiffReviewPromptContext = useCallback((): GitDiffReviewPromptContext | null => {
    if (!cwd || !project || !selectedFile) {
      return null;
    }

    return {
      filePath: selectedFile.path,
      previousPath: selectedFile.previousPath,
      repositoryCwd: cwd,
      projectCwd: project.cwd,
      threadWorktreePath: thread?.worktreePath ?? null,
      branch: headRef,
      target: activeDiffTarget,
      selection: selectedDiffLineSelection,
      reviewThreads: selectedFileReviewThreads,
    };
  }, [
    activeDiffTarget,
    cwd,
    headRef,
    project,
    selectedDiffLineSelection,
    selectedFileReviewThreads,
    selectedFile,
    thread?.worktreePath,
  ]);
  const gitDiffPromptContextLabels = useMemo(
    () => (gitDiffPromptContext ? formatGitDiffReviewContextLabels(gitDiffPromptContext) : []),
    [gitDiffPromptContext],
  );
  const runPromptShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.runPrompt"),
    [keybindings],
  );
  const insertionCount = totalInsertions(activeFiles);
  const deletionCount = totalDeletions(activeFiles);
  const normalViewFileCount = useMemo(
    () =>
      new Set([...worktreeFiles.map((file) => file.path), ...stagedFiles.map((file) => file.path)])
        .size,
    [stagedFiles, worktreeFiles],
  );
  const normalViewHasChanges = worktreeFiles.length > 0 || stagedFiles.length > 0;
  const headerFileCount =
    isHistoryView || isStackView || isStashView ? activeFiles.length : normalViewFileCount;
  const filesSectionBadge = isHistoryView
    ? `${historyCommits.length} commits`
    : isStackView
      ? `+${insertionCount} -${deletionCount}`
      : isStashView
        ? `${stashes.length} stashes`
        : `W ${worktreeFiles.length} S ${stagedFiles.length}`;
  const filesSectionTitle = isHistoryView
    ? (selectedHistoryCommit?.shortSha ?? "History")
    : isStackView
      ? `${activeFiles.length} changed ${activeFiles.length === 1 ? "file" : "files"}`
      : isStashView
        ? (selectedStash?.ref ?? "Stashes")
        : "Changes";
  const selectedWorktreeHunk = useMemo<GitDiffHunkSummary | null>(() => {
    if (
      activeDiffTarget?.kind !== "worktree" ||
      diffIgnoreWhitespace ||
      !selectedFile ||
      selectedFile.isUntracked ||
      !selectedDiffLineSelection
    ) {
      return null;
    }

    const selectedHunkIndex = resolveGitDiffReviewSelectionHunkIndex(
      selectedFile.hunks,
      selectedDiffLineSelection,
    );
    return selectedHunkIndex === null ? null : (selectedFile.hunks[selectedHunkIndex] ?? null);
  }, [activeDiffTarget, diffIgnoreWhitespace, selectedDiffLineSelection, selectedFile]);
  const reviewSessionSnapshot = useMemo<GitDiffReviewSessionSnapshot | null>(() => {
    if (!cwd || !activeDiffTarget) return null;

    const selectedHunkIndex =
      selectedFile && selectedDiffLineSelection
        ? resolveGitDiffReviewSelectionHunkIndex(selectedFile.hunks, selectedDiffLineSelection)
        : null;

    return {
      cwd,
      target: activeDiffTarget,
      targetKey: formatDiffTargetLabel(activeDiffTarget),
      title: filesSectionTitle,
      selectedPath: selectedFile?.path ?? null,
      selectedHunkIndex,
      selectedLines:
        selectedFile && selectedDiffLineSelection
          ? {
              path: selectedFile.path,
              previousPath: selectedFile.previousPath,
              hunkIndex: selectedHunkIndex,
              side: selectedDiffLineSelection.side,
              line: selectedDiffLineSelection.end,
              startLine: selectedDiffLineSelection.start,
            }
          : null,
      files: activeFiles.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        insertions: file.insertions,
        deletions: file.deletions,
        binary: file.binary,
        isUntracked: file.isUntracked,
        hunkCount: file.hunkCount,
        hunks: file.hunks,
      })),
      updatedAt: new Date().toISOString(),
    };
  }, [
    activeDiffTarget,
    activeFiles,
    cwd,
    filesSectionTitle,
    selectedDiffLineSelection,
    selectedFile,
  ]);
  const isDiffFetching =
    (isHistoryView
      ? historyQuery.isFetching || historyFilesQuery.isFetching
      : isStackView
        ? stackQuery.isFetching
        : isStashView
          ? stashesQuery.isFetching || stashFilesQuery.isFetching
          : worktreeQuery.isFetching) ||
    (!isStackView && !isHistoryView && !isStashView && stagedQuery.isFetching) ||
    selectedFileQuery.isFetching;
  const activeFileIndexError = isHistoryView
    ? (historyQuery.error ?? historyFilesQuery.error)
    : isStackView
      ? stackQuery.error
      : isStashView
        ? (stashesQuery.error ?? stashFilesQuery.error)
        : (worktreeQuery.error ?? stagedQuery.error);
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
                    <span className="shrink-0 tabular-nums text-success">+{stepInsertions}</span>
                    <span className="shrink-0 tabular-nums text-destructive">-{stepDeletions}</span>
                  </span>
                </span>
              </button>
            </div>
          );
        }
      }
    },
    [selectedStackStep, setSelectedStackIndex, stackSteps.length],
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
  }, [setStackSectionHeight]);

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
  }, [setSidebarWidth]);

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
  }, [setSidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth, window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarWidth]);

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
  }, [setStackSectionHeight]);

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
    [setStackSectionHeight],
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
    [setSidebarWidth],
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
  const commitActionPending =
    runStackedActionMutation.isPending || amendStagedChangesMutation.isPending;
  const historyActionPending = revertCommitMutation.isPending || cherryPickCommitMutation.isPending;
  const operationActionPending =
    continueOperationMutation.isPending || abortOperationMutation.isPending;
  const gitActionPending =
    commitActionPending || historyActionPending || operationActionPending || pullMutation.isPending;
  const fileActionPending =
    stageWorktreeChangesMutation.isPending ||
    unstageStagedChangesMutation.isPending ||
    discardWorktreeChangesMutation.isPending ||
    discardWorktreeHunkMutation.isPending ||
    amendStagedChangesMutation.isPending ||
    historyActionPending ||
    operationActionPending ||
    createStashMutation.isPending ||
    applyStashMutation.isPending ||
    popStashMutation.isPending ||
    dropStashMutation.isPending ||
    pullMutation.isPending;
  const worktreeActionDisabled =
    isStackView || isStashView || worktreeFiles.length === 0 || fileActionPending;
  const unstageActionDisabled =
    isStackView || isStashView || stagedFiles.length === 0 || fileActionPending;
  const stashActionDisabled =
    isStackView || isStashView || !normalViewHasChanges || fileActionPending;
  const commitDisabled =
    isStackView ||
    isStashView ||
    committableStagedFilePaths.length === 0 ||
    fileActionPending ||
    gitActionPending;
  const amendDisabled = commitDisabled;
  const pullDisabled =
    isStackView ||
    isStashView ||
    gitStatus.data?.branch === null ||
    gitStatus.data?.hasUpstream !== true ||
    gitActionPending;
  const pullTitle =
    gitStatus.data?.branch === null
      ? "Cannot pull from detached HEAD"
      : gitStatus.data?.hasUpstream === false
        ? "No upstream branch configured"
        : gitStatus.data?.behindCount
          ? `Pull ${gitStatus.data.behindCount} upstream ${gitStatus.data.behindCount === 1 ? "commit" : "commits"}`
          : "Pull from upstream";
  const syncBadges = useMemo(() => {
    const status = gitStatus.data;
    if (!status || status.branch === null) return [];
    return [
      ...(status.behindCount > 0
        ? [{ key: "behind", label: `↓${status.behindCount}`, title: "Behind upstream" }]
        : []),
      ...(status.aheadCount > 0
        ? [{ key: "ahead", label: `↑${status.aheadCount}`, title: "Ahead of upstream" }]
        : []),
    ];
  }, [gitStatus.data]);
  const commitDialogFileCount = commitDialogState?.filePaths.length ?? 0;
  const commitDialogTitle =
    commitDialogState === null
      ? "Commit staged changes"
      : commitDialogState.kind === "amend"
        ? "Amend last commit"
        : commitDialogState.scope === "selected_file"
          ? "Commit selected file"
          : "Commit staged changes";
  const commitDialogDescription =
    commitDialogState === null
      ? ""
      : commitDialogState.kind === "amend"
        ? `${commitDialogFileCount} staged ${commitDialogFileCount === 1 ? "file" : "files"} will amend HEAD.`
        : commitDialogState.scope === "selected_file"
          ? `${commitDialogState.filePaths[0] ?? "Selected file"} will be committed.`
          : `${commitDialogFileCount} files, ${ignoredFilePaths.length} ignored.`;
  const commitDialogPlaceholder =
    commitDialogState?.kind === "amend"
      ? "Leave empty to keep previous message"
      : "Leave empty to auto-generate";
  const commitDialogSubmitLabel = commitDialogState?.kind === "amend" ? "Amend" : "Commit";
  const prActionDisabled =
    !isStackView ||
    selectedChangeRequestReference === null ||
    mergeChangeRequestMutation.isPending ||
    closeChangeRequestMutation.isPending;
  const activeFileIndexLoading = isStackView
    ? stackSteps.length === 0 && stackQuery.isLoading
    : isHistoryView
      ? historyQuery.isLoading || historyFilesQuery.isLoading
      : isStashView
        ? stashesQuery.isLoading || stashFilesQuery.isLoading
        : worktreeQuery.isLoading || stagedQuery.isLoading;
  const filesEmptyMessage = isHistoryView
    ? selectedHistoryCommit
      ? "No files changed in this commit."
      : "No commits found."
    : isStackView
      ? "No files changed in this stack step."
      : isStashView
        ? selectedStash
          ? "No files changed in this stash."
          : "No stashes found."
        : "No tracked working tree changes.";

  useEffect(() => {
    if (!cwd) {
      return;
    }

    const appliedRepositoryKey = `${gitDiffScopeKey ?? "none"}\0${cwd}`;
    if (lastAppliedRepositoryCwdRef.current === appliedRepositoryKey) {
      return;
    }

    lastAppliedRepositoryCwdRef.current = appliedRepositoryKey;
    const scopeState = selectGitDiffWorkbenchScopeState(
      useGitDiffWorkbenchStore.getState(),
      gitDiffScopeKey,
    );
    const repositoryState = scopeState.repositoryStates[cwd];
    allowAutoSelectFirstFileRef.current = repositoryState
      ? repositoryState.selectedPath !== null
      : true;
    selectGitDiffRepository(gitDiffScopeKey, cwd);
  }, [cwd, gitDiffScopeKey, selectGitDiffRepository]);

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
    setCurrentRepositoryState({
      mode: "worktree",
      selectedPath: null,
      selectedStackIndex: null,
    });
  }, [
    cwd,
    diffViewMode,
    setCurrentRepositoryState,
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
  }, [isStackView, selectedStackIndex, setSelectedStackIndex, stackSteps]);

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
      if (
        !isStackView &&
        !isHistoryView &&
        !isStashView &&
        selectedTargetKind !== selectedNormalTargetKind
      ) {
        setSelectedPath(selectedPath, selectedNormalTargetKind);
      }
      return;
    }
    if (allowAutoSelectFirstFileRef.current) {
      setSelectedPath(
        activeFiles[0]?.path ?? null,
        isStackView || isHistoryView || isStashView ? undefined : selectedNormalTargetKind,
      );
    }
  }, [
    activeFiles,
    diffViewMode,
    isHistoryView,
    isStackView,
    isStashView,
    selectedNormalTargetKind,
    selectedPath,
    selectedTargetKind,
    setSelectedPath,
    stackQuery.isError,
    stackQuery.isFetched,
    stackQuery.isFetching,
    stackQuery.isLoading,
    activeFileIndexLoading,
  ]);

  useEffect(() => {
    setSelectedDiffLineSelection(null);
  }, [activeDiffTarget, selectedFile?.path, selectedFile?.previousPath]);

  useEffect(() => {
    if (!environmentId || !reviewSessionSnapshot) return;
    const timeout = window.setTimeout(() => {
      void ensureEnvironmentApi(environmentId).gitDiff.updateReviewSession(reviewSessionSnapshot);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [environmentId, reviewSessionSnapshot]);

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

  const handleStageSelectedFile = useCallback(() => {
    if (!selectedFile || isStackView || isStashView) return;
    void runAction(() =>
      stageWorktreeChangesMutation.mutateAsync({
        filePaths: [selectedFile.path],
        ignoredFilePaths: [],
      }),
    );
  }, [isStackView, isStashView, runAction, selectedFile, stageWorktreeChangesMutation]);

  const handleUnstageStagedChanges = useCallback(() => {
    void runAction(() =>
      unstageStagedChangesMutation.mutateAsync({
        filePaths: uniqueFilePaths(stagedFiles),
      }),
    );
  }, [runAction, stagedFiles, unstageStagedChangesMutation]);

  const handleUnstageSelectedFile = useCallback(() => {
    if (!selectedFile || isStackView || isStashView) return;
    void runAction(() =>
      unstageStagedChangesMutation.mutateAsync({
        filePaths: [selectedFile.path],
      }),
    );
  }, [isStackView, isStashView, runAction, selectedFile, unstageStagedChangesMutation]);

  const handleDiscardSelectedFile = useCallback(() => {
    if (!selectedFile || isStackView || isStashView) return;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        `Discard working tree changes in ${selectedFile.path}? This cannot be undone.`,
      );
    if (!confirmed) return;

    void runAction(() =>
      discardWorktreeChangesMutation.mutateAsync({
        filePaths: [selectedFile.path],
      }),
    );
  }, [discardWorktreeChangesMutation, isStackView, isStashView, runAction, selectedFile]);

  const handleDiscardWorktreeHunk = useCallback(
    (hunk: GitDiffHunkSummary) => {
      if (!selectedFile || activeDiffTarget?.kind !== "worktree" || selectedFile.isUntracked) {
        return;
      }
      const confirmed =
        typeof window === "undefined" ||
        window.confirm(`Discard selected hunk in ${selectedFile.path}? This cannot be undone.`);
      if (!confirmed) return;

      void runAction(() =>
        discardWorktreeHunkMutation.mutateAsync({
          path: selectedFile.path,
          hunk,
        }),
      );
    },
    [activeDiffTarget, discardWorktreeHunkMutation, runAction, selectedFile],
  );

  const handleCreateStash = useCallback(
    (filePaths?: readonly string[]) => {
      if (isStackView || isStashView) return;
      const normalizedFilePaths = filePaths
        ? [...new Set(filePaths)].toSorted((left, right) => left.localeCompare(right))
        : [];
      const message =
        normalizedFilePaths.length === 1
          ? `Fenrir stash: ${normalizedFilePaths[0]}`
          : "Fenrir stash";

      void runAction(() =>
        createStashMutation.mutateAsync({
          message,
          ...(normalizedFilePaths.length > 0 ? { filePaths: normalizedFilePaths } : {}),
        }),
      );
    },
    [createStashMutation, isStackView, isStashView, runAction],
  );

  const handleCreateSelectedFileStash = useCallback(() => {
    if (!selectedFile || isStackView || isStashView) return;
    handleCreateStash([selectedFile.path]);
  }, [handleCreateStash, isStackView, isStashView, selectedFile]);

  const handleApplyStash = useCallback(
    (stashRef: string) => {
      void runAction(() => applyStashMutation.mutateAsync({ ref: stashRef }));
    },
    [applyStashMutation, runAction],
  );

  const handlePopStash = useCallback(
    (stashRef: string) => {
      const confirmed =
        typeof window === "undefined" ||
        window.confirm(`Pop ${stashRef}? This applies the stash and removes it if successful.`);
      if (!confirmed) return;
      void runAction(() => popStashMutation.mutateAsync({ ref: stashRef }));
    },
    [popStashMutation, runAction],
  );

  const handleDropStash = useCallback(
    (stashRef: string) => {
      const confirmed =
        typeof window === "undefined" || window.confirm(`Drop ${stashRef}? This cannot be undone.`);
      if (!confirmed) return;
      void runAction(() => dropStashMutation.mutateAsync({ ref: stashRef }));
    },
    [dropStashMutation, runAction],
  );

  const handleRevertSelectedHistoryCommit = useCallback(() => {
    if (!selectedHistoryCommit) return;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`Revert ${selectedHistoryCommit.shortSha}? This creates a new revert commit.`);
    if (!confirmed) return;
    void runAction(() =>
      revertCommitMutation.mutateAsync({ commitRef: selectedHistoryCommit.sha }),
    );
  }, [revertCommitMutation, runAction, selectedHistoryCommit]);

  const handleCherryPickSelectedHistoryCommit = useCallback(() => {
    if (!selectedHistoryCommit) return;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`Cherry-pick ${selectedHistoryCommit.shortSha} onto the current branch?`);
    if (!confirmed) return;
    void runAction(() =>
      cherryPickCommitMutation.mutateAsync({ commitRef: selectedHistoryCommit.sha }),
    );
  }, [cherryPickCommitMutation, runAction, selectedHistoryCommit]);

  const handleContinueOperation = useCallback(() => {
    if (!activeOperation) return;
    void runAction(() => continueOperationMutation.mutateAsync({}));
  }, [activeOperation, continueOperationMutation, runAction]);

  const handleAbortOperation = useCallback(() => {
    if (!activeOperation) return;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`Abort ${activeOperation.label.toLowerCase()}?`);
    if (!confirmed) return;
    void runAction(() => abortOperationMutation.mutateAsync({}));
  }, [abortOperationMutation, activeOperation, runAction]);

  const openCommitDialog = useCallback((state: GitDiffCommitDialogState) => {
    setActionError(null);
    setCommitMessage("");
    setCommitDialogState(state);
  }, []);

  const handleOpenCommitStagedChanges = useCallback(() => {
    if (committableStagedFilePaths.length === 0) return;
    openCommitDialog({
      kind: "commit",
      scope: "all_staged",
      filePaths: committableStagedFilePaths,
    });
  }, [committableStagedFilePaths, openCommitDialog]);

  const handleOpenAmendStagedChanges = useCallback(() => {
    if (committableStagedFilePaths.length === 0) return;
    openCommitDialog({
      kind: "amend",
      filePaths: committableStagedFilePaths,
    });
  }, [committableStagedFilePaths, openCommitDialog]);

  const handleCommitSelectedFile = useCallback(() => {
    if (!selectedFile || !selectedStagedFileIsCommittable) return;
    openCommitDialog({
      kind: "commit",
      scope: "selected_file",
      filePaths: [selectedFile.path],
    });
  }, [openCommitDialog, selectedFile, selectedStagedFileIsCommittable]);

  const handleSubmitCommitDialog = useCallback(() => {
    const state = commitDialogState;
    if (!state || state.filePaths.length === 0) return;
    const trimmedCommitMessage = commitMessage.trim();
    const filePaths = [...state.filePaths];
    const action =
      state.kind === "amend"
        ? () =>
            amendStagedChangesMutation.mutateAsync({
              filePaths,
              ...(trimmedCommitMessage ? { commitMessage: trimmedCommitMessage } : {}),
            })
        : () =>
            runStackedActionMutation.mutateAsync({
              actionId: randomUUID(),
              action: "commit",
              filePaths,
              ...(trimmedCommitMessage ? { commitMessage: trimmedCommitMessage } : {}),
            });

    void runAction(action).then((ok) => {
      if (ok) {
        setCommitDialogState(null);
        setCommitMessage("");
      }
    });
  }, [
    amendStagedChangesMutation,
    commitDialogState,
    commitMessage,
    runAction,
    runStackedActionMutation,
  ]);

  const handlePushWorktreeChanges = useCallback(() => {
    void runAction(() =>
      runStackedActionMutation.mutateAsync({
        actionId: randomUUID(),
        action: "push",
      }),
    );
  }, [runAction, runStackedActionMutation]);

  const handlePullWorktreeChanges = useCallback(() => {
    const promise = pullMutation.mutateAsync();
    toastManager.promise(promise, {
      loading: { title: "Pulling..." },
      success: (result) => ({
        title: result.status === "pulled" ? "Pulled" : "Already up to date",
        description:
          result.status === "pulled"
            ? `Updated ${result.refName} from ${result.upstreamRef ?? "upstream"}.`
            : `${result.refName} is already synchronized.`,
      }),
      error: (error) => ({
        title: "Pull failed",
        description: formatError(error),
      }),
    });
    void runAction(async () => {
      await promise;
    });
  }, [pullMutation, runAction]);

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
    if (!selectedFile || commentDialogState === null || !commentDialogState.body.trim()) {
      return;
    }
    const body = commentDialogState.body.trim();
    const selectedRange =
      commentDialogState.selection.start !== commentDialogState.selection.end
        ? { startLine: commentDialogState.selection.start }
        : {};
    const action =
      selectedChangeRequestReference !== null
        ? () =>
            commentChangeRequestLinesMutation.mutateAsync({
              reference: selectedChangeRequestReference,
              path: selectedFile.path,
              body,
              side: commentDialogState.selection.side,
              line: commentDialogState.selection.end,
              ...selectedRange,
            })
        : activeDiffTarget !== null
          ? () =>
              createReviewNoteMutation.mutateAsync({
                target: activeDiffTarget,
                path: selectedFile.path,
                previousPath: selectedFile.previousPath,
                body,
                source: "user",
                side: commentDialogState.selection.side,
                line: commentDialogState.selection.end,
                ...selectedRange,
              })
          : null;
    if (action === null) {
      return;
    }

    void runAction(action).then((ok) => {
      if (ok) {
        setCommentDialogState(null);
      }
    });
  }, [
    activeDiffTarget,
    commentChangeRequestLinesMutation,
    commentDialogState,
    createReviewNoteMutation,
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
    isMainWindow,
    nvimReady,
    selectedFile,
    selectedStackIndex,
    selectedStackStep,
    setSelectedPath,
    setSelectedStackIndex,
    settings.embeddedEditor,
    vscodeReady,
  ]);

  const openGitDiffReviewPrompt = useCallback(() => {
    const context = createGitDiffReviewPromptContext();
    if (!context) {
      toastManager.add({
        type: "error",
        title: "Could not open review prompt",
        description: "Select a changed file before starting a review prompt.",
      });
      return;
    }

    setGitDiffPromptContext(context);
    setGitDiffPromptOpen(true);
  }, [createGitDiffReviewPromptContext]);

  const closeGitDiffReviewPrompt = useCallback(() => {
    setGitDiffPromptOpen(false);
    setGitDiffPromptContext(null);
  }, []);

  const submitGitDiffReviewPrompt = useCallback(async () => {
    const promptText = gitDiffPromptDraft.trim();
    const context = gitDiffPromptContext ?? createGitDiffReviewPromptContext();
    if (promptText.length === 0 || !environmentId || !thread || !project || !context) {
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const modelSelection = thread.modelSelection;
    const mcpServerIds = [...(thread.mcpServerIds ?? [])];
    const promptWithReviewContext = appendGitDiffReviewContextToPrompt(promptText, context);
    const title = truncate(`${formatGitDiffReviewContextTitle(context)}: ${promptText}`);

    setGitDiffPromptOpen(false);
    setGitDiffPromptDraft("");
    setGitDiffPromptContext(null);

    await api.orchestration
      .dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: nextThreadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: promptWithReviewContext,
          attachments: [],
        },
        modelSelection,
        providerInstanceId: modelSelection.instanceId,
        titleSeed: title,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        mcpServerIds,
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            mcpServerIds,
            branch: headRef,
            worktreePath: thread.worktreePath,
            visibility: "editorTransient",
            owner: { kind: "editorPrompt", parentThreadId: thread.id },
            deleteOnSettled: true,
            createdAt,
          },
        },
        createdAt,
      })
      .catch((error: unknown) => {
        setGitDiffPromptDraft(promptText);
        setGitDiffPromptContext(context);
        setGitDiffPromptOpen(true);
        toastManager.add({
          type: "error",
          title: "Could not start review prompt",
          description:
            error instanceof Error ? error.message : "An error occurred while creating the worker.",
        });
      });
  }, [
    createGitDiffReviewPromptContext,
    environmentId,
    gitDiffPromptContext,
    gitDiffPromptDraft,
    headRef,
    project,
    thread,
  ]);

  const interruptEditorWorker = useCallback(
    (workerId: string) => {
      if (!environmentId) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }
      void api.orchestration
        .dispatchCommand({
          type: "thread.turn.interrupt",
          commandId: newCommandId(),
          threadId: workerId as ThreadId,
          createdAt: new Date().toISOString(),
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not interrupt worker",
            description:
              error instanceof Error ? error.message : "The worker interruption was not sent.",
          });
        });
    },
    [environmentId],
  );

  const dismissEditorWorker = useCallback(
    (workerId: string) => {
      if (!environmentId) {
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }
      void api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: workerId as ThreadId,
        })
        .catch(() => undefined);
    },
    [environmentId],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePromptShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings);
      if (command !== "editor.runPrompt") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (gitDiffPromptOpen) {
        void submitGitDiffReviewPrompt();
        return;
      }
      openGitDiffReviewPrompt();
    };

    window.addEventListener("keydown", handlePromptShortcut, true);
    return () => window.removeEventListener("keydown", handlePromptShortcut, true);
  }, [gitDiffPromptOpen, keybindings, openGitDiffReviewPrompt, submitGitDiffReviewPrompt]);

  const handleSelectedPathChange = useCallback(
    (path: string | null, targetKind?: GitDiffWorkbenchTargetKind) => {
      allowAutoSelectFirstFileRef.current = true;
      setSelectedPath(path, targetKind);
    },
    [setSelectedPath],
  );
  const handleSelectedStashChange = useCallback(
    (stashRef: string) => {
      allowAutoSelectFirstFileRef.current = true;
      setCurrentRepositoryState({
        mode: "stashes",
        selectedStashRef: stashRef,
        selectedPath: null,
      });
    },
    [setCurrentRepositoryState],
  );

  const handleDiffViewModeChange = useCallback(
    (mode: GitDiffViewMode) => {
      allowAutoSelectFirstFileRef.current = true;
      setDiffViewMode(mode);
    },
    [setDiffViewMode],
  );

  const handleRepositoryCwdChange = useCallback(
    (nextRepositoryCwd: string) => {
      if (!repositoryOptions.some((repository) => repository.cwd === nextRepositoryCwd)) {
        return;
      }
      allowAutoSelectFirstFileRef.current = true;
      setActionError(null);
      selectGitDiffRepository(gitDiffScopeKey, nextRepositoryCwd);
    },
    [gitDiffScopeKey, repositoryOptions, selectGitDiffRepository],
  );

  const handleSelectOperationFile = useCallback(
    (filePath: string) => {
      allowAutoSelectFirstFileRef.current = true;
      setCurrentRepositoryState({
        mode: "worktree",
        selectedTargetKind: "worktree",
      });
      setSelectedPath(filePath, "worktree");
    },
    [setCurrentRepositoryState, setSelectedPath],
  );

  const operationPanel = activeOperation ? (
    <GitDiffOperationPanel
      isBusy={operationActionPending}
      operation={activeOperation}
      onAbort={handleAbortOperation}
      onContinue={handleContinueOperation}
      onSelectFile={handleSelectOperationFile}
    />
  ) : null;

  const filesSectionContent = isHistoryView ? (
    <div className="min-h-0 flex-1 px-3 pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3">
        {operationPanel}
        <GitDiffHistoryPanel
          commits={historyCommits}
          isBusy={historyActionPending}
          isLoading={historyQuery.isLoading}
          selectedCommitSha={selectedHistoryCommit?.sha ?? null}
          onCherryPickCommit={handleCherryPickSelectedHistoryCommit}
          onRevertCommit={handleRevertSelectedHistoryCommit}
          onSelectCommit={(commitSha) => {
            allowAutoSelectFirstFileRef.current = true;
            setSelectedHistoryCommitSha(commitSha);
          }}
        />
        <GitDiffFileGroup
          emptyLabel={filesEmptyMessage}
          files={activeFiles}
          isLoading={historyFilesQuery.isLoading}
          selectedPath={selectedPath}
          title="Commit Files"
          onSelectedPathChange={(path) => handleSelectedPathChange(path)}
        />
      </div>
    </div>
  ) : isStackView ? (
    <div className="min-h-0 flex-1 px-3 pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3">
        {operationPanel}
        {activeFileIndexLoading ? (
          <div className="px-1 py-3 text-sm text-muted-foreground">Loading changes...</div>
        ) : activeFiles.length > 0 ? (
          <ChangedFilesTree
            files={activeFiles}
            selectedPath={selectedPath}
            fillAvailableHeight
            onSelectedPathChange={(path) => handleSelectedPathChange(path)}
          />
        ) : (
          <div className="px-1 py-3 text-sm text-muted-foreground">{filesEmptyMessage}</div>
        )}
      </div>
    </div>
  ) : isStashView ? (
    <div className="min-h-0 flex-1 px-3 pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3">
        {operationPanel}
        <GitDiffStashesPanel
          isBusy={fileActionPending}
          isLoading={stashesQuery.isLoading}
          selectedStashRef={selectedStash?.ref ?? null}
          stashes={stashes}
          onApply={handleApplyStash}
          onDrop={handleDropStash}
          onPop={handlePopStash}
          onSelect={handleSelectedStashChange}
        />
        <GitDiffFileGroup
          emptyLabel={filesEmptyMessage}
          files={activeFiles}
          isLoading={stashFilesQuery.isLoading}
          selectedPath={selectedPath}
          title="Stash Files"
          onSelectedPathChange={(path) => handleSelectedPathChange(path)}
        />
      </div>
    </div>
  ) : (
    <div className="min-h-0 flex-1 px-3 pb-3">
      <div className="flex h-full min-h-0 flex-col gap-3">
        {operationPanel}
        <GitDiffFileGroup
          action={
            <Button
              aria-label="Stage all working tree changes"
              disabled={worktreeActionDisabled}
              size="icon-xs"
              title="Stage all"
              variant="ghost"
              onClick={handleStageWorktreeChanges}
            >
              <CheckCircle2Icon />
            </Button>
          }
          emptyLabel="No unstaged changes."
          files={worktreeFiles}
          isLoading={worktreeQuery.isLoading}
          selectedPath={selectedNormalTargetKind === "worktree" ? selectedPath : null}
          title="Working Tree"
          onSelectedPathChange={(path) => handleSelectedPathChange(path, "worktree")}
        />
        <GitDiffFileGroup
          action={
            <Button
              aria-label="Unstage all staged changes"
              disabled={unstageActionDisabled}
              size="icon-xs"
              title="Unstage all"
              variant="ghost"
              onClick={handleUnstageStagedChanges}
            >
              <Undo2Icon />
            </Button>
          }
          emptyLabel="No staged changes."
          files={stagedFiles}
          isLoading={stagedQuery.isLoading}
          selectedPath={selectedNormalTargetKind === "staged" ? selectedPath : null}
          title="Staged"
          onSelectedPathChange={(path) => handleSelectedPathChange(path, "staged")}
        />
        <GitDiffIgnoreListsPanel
          ignoreLists={ignoreLists}
          isBusy={
            createIgnoreListMutation.isPending ||
            updateIgnoreListMutation.isPending ||
            deleteIgnoreListMutation.isPending
          }
          selectedFilePath={
            selectedNormalTargetKind === "worktree" ? (selectedFile?.path ?? null) : null
          }
          onAddFile={handleAddFileToIgnoreList}
          onCreate={() => setIsIgnoreListDialogOpen(true)}
          onDelete={handleDeleteIgnoreList}
          onUpdateFiles={updateIgnoreListFiles}
        />
        <GitDiffStashesPanel
          isBusy={fileActionPending}
          isLoading={stashesQuery.isLoading}
          selectedStashRef={selectedStash?.ref ?? null}
          stashes={stashes}
          onApply={handleApplyStash}
          onDrop={handleDropStash}
          onPop={handlePopStash}
          onSelect={handleSelectedStashChange}
        />
      </div>
    </div>
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
      <div className="relative flex h-full min-h-0 min-w-0 w-full flex-col bg-background">
        <EditorPromptWorkersOverlay
          promptOpen={gitDiffPromptOpen}
          promptDraft={gitDiffPromptDraft}
          promptContextLabels={gitDiffPromptContextLabels}
          workers={editorWorkers}
          onPromptDraftChange={setGitDiffPromptDraft}
          onPromptCancel={closeGitDiffReviewPrompt}
          onPromptSubmit={submitGitDiffReviewPrompt}
          onWorkerInterrupt={interruptEditorWorker}
          onWorkerDismiss={dismissEditorWorker}
        />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitCompareIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {repositoryOptions.length > 1 ? (
                  <GitDiffRepositorySelector
                    repositories={repositoryOptions}
                    selectedCwd={cwd}
                    selectedRepositoryLabel={selectedRepositoryLabel}
                    onRepositoryCwdChange={handleRepositoryCwdChange}
                  />
                ) : (
                  <Badge
                    className="max-w-[60vw] truncate rounded-lg border-border/70 bg-muted/20 font-mono text-muted-foreground/85"
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
                {syncBadges.map((badge) => (
                  <Badge key={badge.key} size="sm" title={badge.title} variant="secondary">
                    {badge.label}
                  </Badge>
                ))}
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
                  aria-label="Stash current changes"
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
                  disabled={stashActionDisabled}
                  size="icon-xs"
                  title="Stash changes"
                  variant="ghost"
                  onClick={() => handleCreateStash()}
                >
                  <ArchiveIcon />
                </Button>
                <Button
                  aria-label="Stage worktree changes"
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
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
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
                  disabled={commitDisabled}
                  size="icon-xs"
                  title="Commit staged changes"
                  variant="ghost"
                  onClick={handleOpenCommitStagedChanges}
                >
                  <GitCommitHorizontalIcon />
                </Button>
                <Button
                  aria-label="Amend last commit"
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
                  disabled={amendDisabled}
                  size="icon-xs"
                  title="Amend last commit with staged changes"
                  variant="ghost"
                  onClick={handleOpenAmendStagedChanges}
                >
                  <Undo2Icon />
                </Button>
                <Button
                  aria-label="Pull current branch"
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
                  disabled={pullDisabled}
                  size="icon-xs"
                  title={pullTitle}
                  variant="ghost"
                  onClick={handlePullWorktreeChanges}
                >
                  <DownloadIcon />
                </Button>
                <Button
                  aria-label="Push current branch"
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
                  disabled={gitActionPending}
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
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
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
                  className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
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
              value={[
                isHistoryView
                  ? "history"
                  : isStackView
                    ? "stack"
                    : isStashView
                      ? "stashes"
                      : "worktree",
              ]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "stack" && stackViewSelectable) {
                  handleDiffViewModeChange("stack");
                } else if (next === "history") {
                  handleDiffViewModeChange("history");
                } else if (next === "stashes") {
                  handleDiffViewModeChange("stashes");
                } else if (next === "worktree") {
                  handleDiffViewModeChange("worktree");
                }
              }}
            >
              <Toggle
                aria-label="Show stacked branch diff"
                className={GIT_DIFF_HEADER_VIEW_TOGGLE_CLASS}
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
                aria-label="Show commit history"
                className={GIT_DIFF_HEADER_VIEW_TOGGLE_CLASS}
                title="History"
                value="history"
              >
                <HistoryIcon className="size-3" />
              </Toggle>
              <Toggle
                aria-label="Show stashes"
                className={GIT_DIFF_HEADER_VIEW_TOGGLE_CLASS}
                title={stashesQuery.isLoading ? "Loading stashes" : "Stashes"}
                value="stashes"
              >
                <ArchiveIcon className="size-3" />
              </Toggle>
              <Toggle
                aria-label="Show normal working tree diff"
                className={GIT_DIFF_HEADER_VIEW_TOGGLE_CLASS}
                title="Normal view"
                value="worktree"
              >
                <GitCompareIcon className="size-3" />
              </Toggle>
            </ToggleGroup>
            <span className="min-w-[4.5rem] text-right text-xs tabular-nums text-muted-foreground">
              {headerFileCount} {headerFileCount === 1 ? "file" : "files"}
            </span>
            <Button
              aria-label="Refresh diff"
              className={GIT_DIFF_HEADER_ACTION_BUTTON_CLASS}
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
              badge={filesSectionBadge}
              className={
                stackSteps.length > 0 && isStackView && baseRef !== null ? "border-t-0" : undefined
              }
              open={filesSectionOpen}
              title={filesSectionTitle}
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
            enableFileDrag={!isStackView && !isStashView}
            enableHunkDiscardAction={activeDiffTarget?.kind === "worktree"}
            enableLineActions={activeDiffTarget !== null}
            enableLineRevertAction={isStackView && selectedChangeRequestReference !== null}
            error={selectedFileQuery.error}
            isHunkActionPending={discardWorktreeHunkMutation.isPending}
            isLineActionPending={
              commentChangeRequestLinesMutation.isPending ||
              createReviewNoteMutation.isPending ||
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
            enableLineSelection
            canCommitSelectedFile={selectedStagedFileIsCommittable}
            onCommitSelectedFile={handleCommitSelectedFile}
            onDiscardHunk={handleDiscardWorktreeHunk}
            onDiscardSelectedFile={handleDiscardSelectedFile}
            onOpenSelectedFile={handleOpenSelectedFile}
            onPromptOpen={openGitDiffReviewPrompt}
            onRevertSelectedLines={handleRevertSelectedLines}
            onSelectedLineSelectionChange={setSelectedDiffLineSelection}
            onStageSelectedFile={handleStageSelectedFile}
            onStashSelectedFile={handleCreateSelectedFileStash}
            onUnstageSelectedFile={handleUnstageSelectedFile}
            promptShortcutLabel={runPromptShortcutLabel}
            rawDiffFontStyle={rawDiffFontStyle}
            resolvedTheme={resolvedTheme as DiffThemeType}
            reviewNotes={reviewNotesQuery.data ?? EMPTY_GIT_DIFF_REVIEW_NOTES}
            reviewThreads={isStackView ? (reviewThreadsQuery.data ?? []) : []}
            onDeleteReviewNote={(id) => {
              void runAction(() => deleteReviewNoteMutation.mutateAsync(id));
            }}
            selectedFile={selectedFile}
            selectedWorktreeHunk={selectedWorktreeHunk}
            selectedTargetKind={
              isStackView || isHistoryView || isStashView ? null : selectedNormalTargetKind
            }
            syntaxTheme={syntaxTheme}
            title={
              isHistoryView
                ? selectedHistoryCommit
                  ? `${selectedHistoryCommit.shortSha} ${selectedHistoryCommit.subject}`
                  : "History"
                : isStackView
                  ? selectedStackStep
                    ? formatChangeRequestDirectionLabel({
                        baseRef: selectedStackStep.baseRef,
                        headRef: selectedStackStep.headRef,
                      })
                    : formatChangeRequestDirectionLabel({
                        baseRef: activeChangeRequest?.baseRefName,
                        headRef: activeChangeRequest?.headRefName ?? headRef,
                      })
                  : isStashView
                    ? (selectedStash?.message ?? "Stash")
                    : selectedNormalTargetKind === "staged"
                      ? "Staged changes"
                      : "Working tree"
            }
            isFileActionPending={fileActionPending}
          />
        </div>
      </div>
      <Dialog
        open={commitDialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCommitDialogState(null);
            setCommitMessage("");
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{commitDialogTitle}</DialogTitle>
            <DialogDescription>{commitDialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Textarea
              autoFocus
              placeholder={commitDialogPlaceholder}
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
                setCommitDialogState(null);
                setCommitMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                commitDialogState === null || commitDialogFileCount === 0 || commitActionPending
              }
              size="sm"
              onClick={handleSubmitCommitDialog}
            >
              {commitDialogSubmitLabel}
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
                commentChangeRequestLinesMutation.isPending ||
                createReviewNoteMutation.isPending
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

function GitDiffHistoryPanel(props: {
  readonly commits: readonly GitDiffCommit[];
  readonly selectedCommitSha: string | null;
  readonly isBusy: boolean;
  readonly isLoading: boolean;
  readonly onCherryPickCommit: () => void;
  readonly onRevertCommit: () => void;
  readonly onSelectCommit: (commitSha: string) => void;
}) {
  const actionDisabled = props.selectedCommitSha === null || props.isBusy;
  return (
    <section className="min-h-0 shrink-0 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-9 items-center justify-between border-b border-border px-2">
        <div className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent Commits
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Cherry-pick selected commit"
            disabled={actionDisabled}
            size="icon-xs"
            title="Cherry-pick commit"
            variant="ghost"
            onClick={props.onCherryPickCommit}
          >
            <PlusIcon />
          </Button>
          <Button
            aria-label="Revert selected commit"
            disabled={actionDisabled}
            size="icon-xs"
            title="Revert commit"
            variant="ghost"
            onClick={props.onRevertCommit}
          >
            <Undo2Icon />
          </Button>
          <Badge size="sm" variant="secondary">
            {props.commits.length}
          </Badge>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {props.isLoading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Loading commits...</div>
        ) : props.commits.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No commits found.</div>
        ) : (
          props.commits.map((commit) => {
            const selected = commit.sha === props.selectedCommitSha;
            return (
              <button
                key={commit.sha}
                className={cn(
                  "flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-muted/60",
                  selected && "bg-muted text-foreground",
                )}
                title={`${commit.shortSha} ${commit.subject}`}
                type="button"
                onClick={() => props.onSelectCommit(commit.sha)}
              >
                <span className="flex min-w-0 w-full items-center gap-2">
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {commit.shortSha}
                  </span>
                  <span className="min-w-0 truncate font-medium">{commit.subject}</span>
                </span>
                <span className="flex min-w-0 w-full items-center gap-2 text-muted-foreground">
                  <span className="min-w-0 truncate">{commit.authorName}</span>
                  <span className="shrink-0">{formatRelativeTimeLabel(commit.authoredAt)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function GitDiffOperationPanel(props: {
  readonly operation: GitDiffRepositoryOperation;
  readonly isBusy: boolean;
  readonly onContinue: () => void;
  readonly onAbort: () => void;
  readonly onSelectFile: (filePath: string) => void;
}) {
  const conflictedFilePaths = props.operation.conflictedFilePaths;
  const visibleFilePaths = conflictedFilePaths.slice(0, 8);
  return (
    <section className="shrink-0 overflow-hidden rounded-md border border-warning/40 bg-warning/8">
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-warning/20 px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-wide text-warning-foreground">
            {props.operation.label}
          </div>
          {props.operation.headRef ? (
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {props.operation.headRef.slice(0, 12)}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge size="sm" variant={conflictedFilePaths.length > 0 ? "warning" : "secondary"}>
            {conflictedFilePaths.length}
          </Badge>
          <Button
            aria-label="Continue Git operation"
            disabled={props.isBusy}
            size="xs"
            title="Continue"
            variant="ghost"
            onClick={props.onContinue}
          >
            <CheckCircle2Icon className="size-3" />
            Continue
          </Button>
          <Button
            aria-label="Abort Git operation"
            disabled={props.isBusy}
            size="xs"
            title="Abort"
            variant="ghost"
            onClick={props.onAbort}
          >
            <XCircleIcon className="size-3" />
            Abort
          </Button>
        </div>
      </div>
      {visibleFilePaths.length > 0 ? (
        <div className="max-h-44 overflow-y-auto p-1">
          {visibleFilePaths.map((filePath) => (
            <button
              key={filePath}
              className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-warning/12"
              title={filePath}
              type="button"
              onClick={() => props.onSelectFile(filePath)}
            >
              <FileTextIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-mono">{filePath}</span>
            </button>
          ))}
          {conflictedFilePaths.length > visibleFilePaths.length ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              +{conflictedFilePaths.length - visibleFilePaths.length}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-2 py-2 text-xs text-muted-foreground">No unresolved conflicts.</div>
      )}
    </section>
  );
}

function GitDiffStashesPanel(props: {
  readonly stashes: readonly GitDiffStash[];
  readonly selectedStashRef: string | null;
  readonly isLoading: boolean;
  readonly isBusy: boolean;
  readonly onApply: (stashRef: string) => void;
  readonly onPop: (stashRef: string) => void;
  readonly onDrop: (stashRef: string) => void;
  readonly onSelect: (stashRef: string) => void;
}) {
  return (
    <section className="shrink-0 rounded-md border border-border/70 bg-muted/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Stashes</span>
        <Badge className="shrink-0" size="sm" variant="outline">
          {props.stashes.length}
        </Badge>
      </div>
      {props.isLoading ? (
        <div className="flex h-10 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : props.stashes.length === 0 ? (
        <div className="flex h-10 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">
          No stashes.
        </div>
      ) : (
        <div className="max-h-52 space-y-2 overflow-auto pr-1">
          {props.stashes.slice(0, 6).map((stash) => {
            const selected = props.selectedStashRef === stash.ref;
            return (
              <div
                key={`${stash.ref}:${stash.sha}`}
                className={cn(
                  "rounded-md border p-2 transition-colors",
                  selected
                    ? "border-primary/60 bg-accent text-foreground"
                    : "border-border/70 bg-background/70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    aria-pressed={selected}
                    className="min-w-0 flex-1 text-left"
                    type="button"
                    onClick={() => props.onSelect(stash.ref)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {stash.ref}
                      </span>
                      {stash.branchName ? (
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                          {stash.branchName}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-xs font-medium" title={stash.message}>
                      {stash.message}
                    </div>
                    <div
                      className="mt-1 truncate text-[11px] text-muted-foreground"
                      title={stash.createdAt}
                    >
                      {stash.createdAt}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label={`Apply ${stash.ref}`}
                      disabled={props.isBusy}
                      size="icon-xs"
                      title="Apply stash"
                      variant="ghost"
                      onClick={() => props.onApply(stash.ref)}
                    >
                      <DownloadIcon />
                    </Button>
                    <Button
                      aria-label={`Pop ${stash.ref}`}
                      disabled={props.isBusy}
                      size="icon-xs"
                      title="Pop stash"
                      variant="ghost"
                      onClick={() => props.onPop(stash.ref)}
                    >
                      <RefreshCwIcon />
                    </Button>
                    <Button
                      aria-label={`Drop ${stash.ref}`}
                      disabled={props.isBusy}
                      size="icon-xs"
                      title="Drop stash"
                      variant="ghost"
                      onClick={() => props.onDrop(stash.ref)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {props.stashes.length > 6 ? (
            <div className="px-1.5 text-[11px] text-muted-foreground">
              +{props.stashes.length - 6}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function GitDiffFileGroup(props: {
  readonly title: string;
  readonly files: readonly GitDiffFileSummary[];
  readonly selectedPath: string | null;
  readonly isLoading: boolean;
  readonly emptyLabel: string;
  readonly action?: ReactNode;
  readonly onSelectedPathChange: (path: string) => void;
}) {
  const insertions = totalInsertions(props.files);
  const deletions = totalDeletions(props.files);
  const hasFiles = props.files.length > 0;

  return (
    <section className={cn("flex min-h-0 flex-col", hasFiles ? "flex-1" : "shrink-0")}>
      <div className="flex h-7 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {props.title}
          </span>
          <Badge className="shrink-0" size="sm" variant="outline">
            {props.files.length}
          </Badge>
          {hasFiles ? (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              +{insertions} -{deletions}
            </span>
          ) : null}
        </div>
        {props.action ? (
          <div className="flex shrink-0 items-center gap-1">{props.action}</div>
        ) : null}
      </div>
      {props.isLoading ? (
        <div className="flex h-16 shrink-0 items-center px-1 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : hasFiles ? (
        <div className="min-h-0 flex-1">
          <ChangedFilesTree
            files={props.files}
            selectedPath={props.selectedPath}
            fillAvailableHeight
            onSelectedPathChange={props.onSelectedPathChange}
          />
        </div>
      ) : (
        <div className="flex h-10 shrink-0 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">
          {props.emptyLabel}
        </div>
      )}
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
      model.scrollToPath(props.selectedPath, {
        focus: false,
        offset: "nearest",
      });
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

function formatHunkSeparatorLineCount(lines: number): string {
  return `${lines} unmodified ${lines === 1 ? "line" : "lines"}`;
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
  readonly enableLineRevertAction: boolean;
  readonly enableHunkDiscardAction: boolean;
  readonly enableLineSelection: boolean;
  readonly isLineActionPending: boolean;
  readonly isHunkActionPending: boolean;
  readonly selectedTargetKind: GitDiffWorkbenchTargetKind | null;
  readonly selectedWorktreeHunk: GitDiffHunkSummary | null;
  readonly isFileActionPending: boolean;
  readonly onCommentSelectedLines: (selection: GitDiffLineSelection) => void;
  readonly onRevertSelectedLines: (selection: GitDiffLineSelection) => void;
  readonly onDiscardHunk: (hunk: GitDiffHunkSummary) => void;
  readonly onSelectedLineSelectionChange: (selection: GitDiffReviewLineSelection | null) => void;
  readonly canCommitSelectedFile: boolean;
  readonly onCommitSelectedFile: () => void;
  readonly onStageSelectedFile: () => void;
  readonly onStashSelectedFile: () => void;
  readonly onUnstageSelectedFile: () => void;
  readonly onDiscardSelectedFile: () => void;
  readonly onOpenSelectedFile: () => void;
  readonly onPromptOpen: () => void;
  readonly promptShortcutLabel: string | null;
  readonly enableFileDrag: boolean;
  readonly reviewNotes: readonly GitDiffReviewNote[];
  readonly reviewThreads: readonly ChangeRequestReviewThread[];
  readonly onDeleteReviewNote: (id: string) => void;
}) {
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const { onSelectedLineSelectionChange } = props;
  const errorMessage = props.error ? formatError(props.error) : null;
  const normalizedSelectedLines = useMemo(
    () => normalizeDiffLineSelection(selectedLines),
    [selectedLines],
  );
  const selectedReviewLineSelection = useMemo<GitDiffReviewLineSelection | null>(() => {
    if (!normalizedSelectedLines) {
      return null;
    }
    return {
      ...normalizedSelectedLines,
      text: extractGitDiffReviewSelectionText(props.diff, normalizedSelectedLines),
    };
  }, [normalizedSelectedLines, props.diff]);

  useEffect(() => {
    setSelectedLines(null);
  }, [props.selectedFile?.path, props.diff?.path, props.diff?.previousPath]);

  useEffect(() => {
    onSelectedLineSelectionChange(selectedReviewLineSelection);
  }, [onSelectedLineSelectionChange, selectedReviewLineSelection]);

  useEffect(() => {
    if (!props.enableLineSelection || selectedLines === null || typeof window === "undefined") {
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
  }, [props.enableLineSelection, selectedLines]);

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
  const selectedFileLineAnnotations = useMemo(() => {
    if (!props.selectedFile) {
      return [];
    }

    return [
      ...buildReviewThreadAnnotations({
        threads: props.reviewThreads,
        file: props.selectedFile,
      }),
      ...buildReviewNoteAnnotations({
        notes: props.reviewNotes,
        file: props.selectedFile,
      }),
    ];
  }, [props.reviewNotes, props.reviewThreads, props.selectedFile]);
  const parsedFileLineAnnotations = useMemo(() => {
    const annotations = new Map<string, DiffLineAnnotation<GitDiffReviewAnnotation>[]>();
    if (renderablePatch?.kind !== "files") {
      return annotations;
    }

    for (const fileDiff of renderablePatch.files) {
      const path = resolveParsedFileDiffPath(fileDiff);
      const file = {
        path,
        previousPath: normalizeReviewThreadPath(fileDiff.prevName),
      };
      annotations.set(buildParsedFileDiffRenderKey(fileDiff), [
        ...buildReviewThreadAnnotations({
          threads: props.reviewThreads,
          file,
        }),
        ...buildReviewNoteAnnotations({
          notes: props.reviewNotes,
          file,
        }),
      ]);
    }

    return annotations;
  }, [props.reviewNotes, props.reviewThreads, renderablePatch]);
  const renderDiffAnnotation = useCallback(
    (annotation: DiffLineAnnotation<GitDiffReviewAnnotation>) => {
      switch (annotation.metadata.kind) {
        case "provider-thread":
          return <GitDiffReviewThreadAnnotationCard threads={annotation.metadata.threads} />;
        case "local-note":
          return (
            <GitDiffLocalReviewNoteCard
              notes={annotation.metadata.notes}
              onDelete={props.onDeleteReviewNote}
            />
          );
      }
    },
    [props.onDeleteReviewNote],
  );
  const handleDiffLineClick = useCallback<NonNullable<GitDiffFileDiffOptions["onLineClick"]>>(
    (line) => {
      if (
        !props.enableLineSelection ||
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
    [props.enableLineSelection],
  );
  const selectedFileForHunkActions = props.selectedFile;
  const onDiscardHunk = props.onDiscardHunk;
  const showWorktreeHunkActions =
    props.enableHunkDiscardAction &&
    !props.diffIgnoreWhitespace &&
    selectedFileForHunkActions !== null &&
    !selectedFileForHunkActions.isUntracked;
  const hunkActionDisabled = props.isHunkActionPending || props.isFileActionPending;
  const hunkSeparators = useMemo<GitDiffFileDiffOptions["hunkSeparators"]>(() => {
    if (!showWorktreeHunkActions || !selectedFileForHunkActions) {
      return props.diffHunkSeparators;
    }

    const selectedFile = selectedFileForHunkActions;
    return (hunk, instance) => {
      const root = document.createElement("div");
      root.style.alignItems = "center";
      root.style.background = "var(--diffs-bg-separator)";
      root.style.color = "var(--diffs-fg-number)";
      root.style.display = "flex";
      root.style.font = "inherit";
      root.style.gap = "8px";
      root.style.height = "32px";
      root.style.justifyContent = "space-between";
      root.style.minWidth = "0";
      root.style.padding = "0 10px";
      root.style.userSelect = "none";

      const left = document.createElement("div");
      left.style.alignItems = "center";
      left.style.display = "flex";
      left.style.gap = "8px";
      left.style.minWidth = "0";

      if (hunk.expandable) {
        const expandButton = document.createElement("button");
        expandButton.type = "button";
        expandButton.ariaLabel = "Expand hunk context";
        expandButton.title = "Expand context";
        expandButton.textContent = "Expand";
        expandButton.style.appearance = "none";
        expandButton.style.background = "transparent";
        expandButton.style.border = "0";
        expandButton.style.color = "inherit";
        expandButton.style.cursor = "pointer";
        expandButton.style.font = "inherit";
        expandButton.style.padding = "0";
        expandButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          instance.expandHunk(hunk.hunkIndex, "both");
        });
        left.appendChild(expandButton);
      }

      const label = document.createElement("span");
      label.textContent = formatHunkSeparatorLineCount(hunk.lines);
      label.style.minWidth = "0";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.whiteSpace = "nowrap";
      left.appendChild(label);

      const hunkSummary = selectedFile.hunks[hunk.hunkIndex] ?? null;
      const discardButton = document.createElement("button");
      discardButton.type = "button";
      discardButton.ariaLabel =
        hunkSummary === null ? "Discard hunk" : `Discard hunk ${hunkSummary.index + 1}`;
      discardButton.title =
        hunkSummary === null ? "Hunk is unavailable" : `Discard hunk ${hunkSummary.index + 1}`;
      discardButton.textContent =
        hunkSummary === null ? "Discard hunk" : `Discard hunk ${hunkSummary.index + 1}`;
      discardButton.disabled = hunkSummary === null || hunkActionDisabled;
      discardButton.style.appearance = "none";
      discardButton.style.background = "var(--background)";
      discardButton.style.border = "1px solid var(--border)";
      discardButton.style.borderRadius = "6px";
      discardButton.style.color = discardButton.disabled
        ? "color-mix(in srgb, var(--muted-foreground) 55%, transparent)"
        : "var(--foreground)";
      discardButton.style.cursor = discardButton.disabled ? "not-allowed" : "pointer";
      discardButton.style.flexShrink = "0";
      discardButton.style.font = "inherit";
      discardButton.style.padding = "2px 8px";
      discardButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (hunkSummary !== null && !discardButton.disabled) {
          onDiscardHunk(hunkSummary);
        }
      });

      root.append(left, discardButton);
      return root;
    };
  }, [
    hunkActionDisabled,
    props.diffHunkSeparators,
    onDiscardHunk,
    selectedFileForHunkActions,
    showWorktreeHunkActions,
  ]);
  const diffOptions = useMemo<GitDiffFileDiffOptions>(
    () => ({
      collapsedContextThreshold: 12,
      controlledSelection: props.enableLineSelection,
      diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
      disableLineNumbers: !props.diffLineNumbers,
      enableLineSelection: props.enableLineSelection,
      expansionLineCount: 80,
      ...(hunkSeparators !== undefined ? { hunkSeparators } : {}),
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
      hunkSeparators,
      props.diffLineHighlightMode,
      props.diffLineNumbers,
      props.diffRenderMode,
      props.diffUnsafeCSS,
      props.diffWordWrap,
      props.enableLineSelection,
      handleDiffLineClick,
      props.resolvedTheme,
      props.syntaxTheme,
    ],
  );
  const diffUnavailableLabel = props.diff?.patchTruncated
    ? "Patch output exceeded the maximum supported size."
    : props.diff?.oldFileTooLarge || props.diff?.newFileTooLarge
      ? "File contents exceed the maximum supported diff size."
      : props.selectedFile?.isTooLarge
        ? "This file is too large to render."
        : null;

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
            className="shrink-0 rounded-lg border border-border/70 bg-muted/20 p-0.5"
            variant="default"
            size="xs"
            value={[props.diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                props.onDiffRenderModeChange(next);
              }
            }}
          >
            <Toggle
              aria-label="Stacked diff view"
              className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
              title="Stacked"
              value="stacked"
            >
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle
              aria-label="Split diff view"
              className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
              title="Split"
              value="split"
            >
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Toggle
            aria-label="Toggle line wrapping"
            className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
            title="Wrap"
            variant="default"
            size="xs"
            pressed={props.diffWordWrap}
            onPressedChange={(pressed) => props.onDiffWordWrapChange(Boolean(pressed))}
          >
            <TextWrapIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle ignored whitespace"
            className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
            title="Whitespace"
            variant="default"
            size="xs"
            pressed={props.diffIgnoreWhitespace}
            onPressedChange={(pressed) => props.onDiffIgnoreWhitespaceChange(Boolean(pressed))}
          >
            <PilcrowIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle line numbers"
            className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
            title="Line numbers"
            variant="default"
            size="xs"
            pressed={props.diffLineNumbers}
            onPressedChange={(pressed) => props.onDiffLineNumbersChange(Boolean(pressed))}
          >
            <HashIcon className="size-3" />
          </Toggle>
          <Toggle
            aria-label="Toggle inline highlights"
            className={GIT_DIFF_VIEWER_CONTROL_TOGGLE_CLASS}
            title="Inline highlights"
            variant="default"
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
              className={GIT_DIFF_VIEWER_CONTROL_SELECT_TRIGGER_CLASS}
              size="xs"
              variant="ghost"
            >
              <SeparatorHorizontalIcon className="size-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectPopup className="border-primary/20 shadow-xl/10">
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
              {props.selectedFile.hunkCount ? (
                <span className="tabular-nums text-muted-foreground">
                  {props.selectedFile.hunkCount} hunks
                </span>
              ) : null}
            </>
          ) : null}
          <Button
            aria-label="Run agent prompt with review context"
            disabled={!props.selectedFile}
            size="icon-xs"
            title={
              props.selectedFile
                ? `Run prompt with review context${
                    props.promptShortcutLabel ? ` (${props.promptShortcutLabel})` : ""
                  }`
                : "Select a changed file"
            }
            variant="ghost"
            onClick={props.onPromptOpen}
          >
            <BotIcon />
          </Button>
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
              {props.enableLineRevertAction ? (
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
              ) : null}
              {props.enableHunkDiscardAction ? (
                <Button
                  aria-label="Discard selected hunk"
                  disabled={
                    !props.selectedWorktreeHunk ||
                    props.isHunkActionPending ||
                    props.isFileActionPending
                  }
                  size="icon-xs"
                  title={
                    props.selectedWorktreeHunk
                      ? `Discard hunk ${props.selectedWorktreeHunk.index + 1}`
                      : "Select changed lines in a worktree hunk"
                  }
                  variant="ghost"
                  onClick={() => {
                    if (props.selectedWorktreeHunk) {
                      props.onDiscardHunk(props.selectedWorktreeHunk);
                    }
                  }}
                >
                  <Undo2Icon />
                </Button>
              ) : null}
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
            {props.selectedFile && props.selectedTargetKind ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label="Stash selected file"
                  disabled={props.isFileActionPending}
                  size="icon-xs"
                  title="Stash file"
                  variant="ghost"
                  onClick={props.onStashSelectedFile}
                >
                  <ArchiveIcon />
                </Button>
                {props.selectedTargetKind === "worktree" ? (
                  <>
                    <Button
                      aria-label="Stage selected file"
                      disabled={props.isFileActionPending}
                      size="icon-xs"
                      title="Stage file"
                      variant="ghost"
                      onClick={props.onStageSelectedFile}
                    >
                      <CheckCircle2Icon />
                    </Button>
                    <Button
                      aria-label="Discard selected file changes"
                      disabled={props.isFileActionPending}
                      size="icon-xs"
                      title="Discard changes"
                      variant="ghost"
                      onClick={props.onDiscardSelectedFile}
                    >
                      <Trash2Icon />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      aria-label="Commit selected file"
                      disabled={props.isFileActionPending || !props.canCommitSelectedFile}
                      size="icon-xs"
                      title={props.canCommitSelectedFile ? "Commit file" : "File is ignored"}
                      variant="ghost"
                      onClick={props.onCommitSelectedFile}
                    >
                      <GitCommitHorizontalIcon />
                    </Button>
                    <Button
                      aria-label="Unstage selected file"
                      disabled={props.isFileActionPending}
                      size="icon-xs"
                      title="Unstage file"
                      variant="ghost"
                      onClick={props.onUnstageSelectedFile}
                    >
                      <Undo2Icon />
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {!props.selectedFile ? (
            <GitDiffWorkbenchEmptyState label="Select a file to inspect." />
          ) : props.selectedFile.binary ? (
            <GitDiffWorkbenchEmptyState label="Binary file diffs are not rendered." />
          ) : errorMessage ? (
            <GitDiffWorkbenchEmptyState label={errorMessage} />
          ) : props.isLoading ? (
            <GitDiffWorkbenchEmptyState label="Loading file diff..." />
          ) : diffUnavailableLabel ? (
            <GitDiffWorkbenchEmptyState label={diffUnavailableLabel} />
          ) : fullFileDiff ? (
            <Virtualizer
              className="h-[calc(100%-2.75rem)] min-h-0 w-full overflow-auto px-2 pb-2"
              config={{
                intersectionObserverMargin: 1200,
                overscrollSize: 600,
              }}
            >
              {showWorktreeHunkActions && props.selectedFile ? (
                <GitDiffHunkActionsBar
                  disabled={hunkActionDisabled}
                  hunks={props.selectedFile.hunks}
                  onDiscardHunk={props.onDiscardHunk}
                />
              ) : null}
              <div
                key={`${fullFileDiff.cacheKey}:${props.diffRenderMode}:${props.diffHunkSeparators}`}
                className="mt-2"
              >
                <FileDiff<GitDiffReviewAnnotation>
                  fileDiff={fullFileDiff}
                  lineAnnotations={selectedFileLineAnnotations}
                  options={diffOptions}
                  renderAnnotation={renderDiffAnnotation}
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
              {showWorktreeHunkActions && props.selectedFile ? (
                <GitDiffHunkActionsBar
                  disabled={hunkActionDisabled}
                  hunks={props.selectedFile.hunks}
                  onDiscardHunk={props.onDiscardHunk}
                />
              ) : null}
              {renderablePatch.files.map((fileDiff) => (
                <div
                  key={`${buildParsedFileDiffRenderKey(fileDiff)}:${props.diffRenderMode}:${props.diffHunkSeparators}`}
                  data-diff-file-path={resolveParsedFileDiffPath(fileDiff)}
                  className="mt-2"
                >
                  <FileDiff<GitDiffReviewAnnotation>
                    fileDiff={fileDiff}
                    lineAnnotations={
                      parsedFileLineAnnotations.get(buildParsedFileDiffRenderKey(fileDiff)) ?? []
                    }
                    options={diffOptions}
                    renderAnnotation={renderDiffAnnotation}
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

function GitDiffHunkActionsBar(props: {
  readonly hunks: readonly GitDiffHunkSummary[];
  readonly disabled: boolean;
  readonly onDiscardHunk: (hunk: GitDiffHunkSummary) => void;
}) {
  if (props.hunks.length === 0) return null;

  return (
    <div className="sticky top-0 z-10 -mx-2 flex gap-1 overflow-x-auto border-b border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      {props.hunks.map((hunk) => (
        <Button
          key={hunk.index}
          aria-label={`Discard hunk ${hunk.index + 1}`}
          className="gap-1.5"
          disabled={props.disabled}
          size="xs"
          title={`Discard hunk ${hunk.index + 1}`}
          variant="outline"
          onClick={() => props.onDiscardHunk(hunk)}
        >
          <Undo2Icon className="size-3.5" />
          Discard hunk {hunk.index + 1}
        </Button>
      ))}
    </div>
  );
}

function GitDiffLocalReviewNoteCard(props: {
  readonly notes: readonly GitDiffReviewNote[];
  readonly onDelete: (id: string) => void;
}) {
  if (props.notes.length === 0) return null;

  return (
    <div className="mx-8 my-3 max-w-3xl space-y-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
      {props.notes.map((note) => (
        <div key={note.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>
              {note.source}
              {note.author ? ` by ${note.author}` : ""}
            </span>
            <Button
              aria-label="Delete review note"
              size="icon-xs"
              variant="ghost"
              onClick={() => props.onDelete(note.id)}
            >
              <Trash2Icon />
            </Button>
          </div>
          <div className="whitespace-pre-wrap text-foreground">{note.body}</div>
        </div>
      ))}
    </div>
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
