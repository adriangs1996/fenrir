import type { EnvironmentId, ProjectEntry, ProjectReadFileResult } from "@fenrir/contracts";
import { useParams } from "@tanstack/react-router";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";
import {
  FileTree as PierreFileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import {
  ClipboardPasteIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  ScissorsIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  memo,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
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
import { Label } from "~/components/ui/label";
import { SidebarMenuSub, SidebarMenuSubItem } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { toastManager } from "~/components/ui/toast";
import { openInEmbeddedEditor, openInEmbeddedVSCode } from "~/editorPreferences";
import { readEnvironmentApi } from "~/environmentApi";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { cn, randomUUID } from "~/lib/utils";
import { resolveActiveEmbeddedEditor } from "~/modules/neovim-editor/embeddedEditor";
import { useEditorStore } from "~/modules/neovim-editor";
import type { EditorContextDraft } from "~/modules/neovim-editor";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import {
  PROJECT_FILE_PREVIEW_MAX_BYTES,
  ProjectFilePreviewDialog,
  type ProjectFilePreviewRequest,
} from "./ProjectFilePreviewDialog";

const DIRECTORY_ENTRY_LIMIT = 300;
const PROJECT_FILE_TREE_ROW_HEIGHT = 24;
const PROJECT_FILE_TREE_MAX_VISIBLE_ROWS = 24;
const PROJECT_FILE_TREE_MIN_VISIBLE_ROWS = 2;
const PROJECT_FILE_TREE_CONTEXT_MENU_MIN_WIDTH = 160;
const PROJECT_FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN = 8;
const EMPTY_PROJECT_ENTRIES: readonly ProjectEntry[] = [];

type DirectoryLoadStatus = "idle" | "loading" | "ready" | "error";
type ProjectFileClipboard =
  | { mode: "copy"; entry: ProjectEntry }
  | { mode: "cut"; entry: ProjectEntry };

interface ProjectFileNameDialogRequest {
  id: number;
  title: string;
  description: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  invalidMessage: string;
  normalize: (input: string) => string | null;
}

type ProjectFileNameDialogInput = Omit<ProjectFileNameDialogRequest, "id">;

type DirectoryLoadState =
  | { status: "idle" }
  | { status: "loading"; entries: readonly ProjectEntry[]; truncated: boolean }
  | { status: "ready"; entries: readonly ProjectEntry[]; truncated: boolean }
  | {
      status: "error";
      message: string;
      entries: readonly ProjectEntry[];
      truncated: boolean;
    };

const IDLE_DIRECTORY_STATE: DirectoryLoadState = { status: "idle" };

const PROJECT_FILE_TREE_STYLE = {
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--accent)",
  "--trees-border-color-override": "transparent",
  "--trees-border-radius-override": "6px",
  "--trees-fg-override": "var(--muted-foreground)",
  "--trees-fg-muted-override": "color-mix(in srgb, var(--muted-foreground) 64%, transparent)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "10px",
  "--trees-font-weight-regular-override": "500",
  "--trees-icon-width-override": "13px",
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
} as CSSProperties;

interface ProjectFileExplorerProps {
  className?: string;
  environmentId: EnvironmentId;
  projectName: string;
  workspaceRoot: string;
}

export const ProjectFileExplorer = memo(function ProjectFileExplorer({
  className,
  environmentId,
  projectName,
  workspaceRoot,
}: ProjectFileExplorerProps) {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const mainWindow = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const preferredEmbeddedEditor = useSettings((state) => state.embeddedEditor);
  const currentEditorFile = useEditorStore((state) => state.currentFile);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const composerTargetId =
    routeTarget?.kind === "server"
      ? routeTarget.threadRef.threadId
      : (routeTarget?.draftId ?? null);
  const [includeIgnoredEntries, setIncludeIgnoredEntries] = useState(false);
  const [fileClipboard, setFileClipboard] = useState<ProjectFileClipboard | null>(null);
  const [fileNameDialogRequest, setFileNameDialogRequest] =
    useState<ProjectFileNameDialogRequest | null>(null);
  const [previewRequest, setPreviewRequest] = useState<ProjectFilePreviewRequest | null>(null);
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<ProjectEntry>({
    onCopy: (entry) => {
      toastManager.add({
        type: "success",
        title: "Relative path copied",
        description: entry.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy relative path",
        description: error.message,
      });
    },
  });
  const { model: treeModel } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    icons: "complete",
    initialExpansion: "closed",
    itemHeight: PROJECT_FILE_TREE_ROW_HEIGHT,
    paths: [],
    search: true,
    searchBlurBehavior: "retain",
    stickyFolders: true,
  });
  const treeSearch = useFileTreeSearch(treeModel);
  const selectedTreePaths = useFileTreeSelection(treeModel);
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [directoryStateByPath, setDirectoryStateByPath] = useState<
    Record<string, DirectoryLoadState>
  >({});
  const directoryLoadStatusRef = useRef(new Map<string, DirectoryLoadStatus>());
  const directoryPathsRef = useRef(new Set<string>());
  const entryByTreePathRef = useRef(new Map<string, ProjectEntry>());
  const fileNameDialogRequestIdRef = useRef(0);
  const fileNameDialogResolverRef = useRef<((value: string | null) => void) | null>(null);
  const knownTreePathsRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const previewRequestIdRef = useRef(0);

  const replaceTreeEntries = useCallback(
    (entries: readonly ProjectEntry[]) => {
      const nextEntriesByTreePath = new Map<string, ProjectEntry>();
      const nextDirectoryPaths = new Set<string>();
      const nextTreePaths = new Set<string>();

      for (const entry of entries) {
        const treePath = toTreePath(entry);
        nextTreePaths.add(treePath);
        nextEntriesByTreePath.set(treePath, entry);
        if (entry.kind === "directory") {
          nextDirectoryPaths.add(entry.path);
        }
      }

      entryByTreePathRef.current = nextEntriesByTreePath;
      directoryPathsRef.current = nextDirectoryPaths;
      knownTreePathsRef.current = nextTreePaths;
      setExpandedDirectories(new Set());
      treeModel.resetPaths([...nextTreePaths]);
    },
    [treeModel],
  );

  const addTreeEntries = useCallback(
    (entries: readonly ProjectEntry[]) => {
      const operations: Array<{ type: "add"; path: string }> = [];

      for (const entry of entries) {
        const treePath = toTreePath(entry);
        entryByTreePathRef.current.set(treePath, entry);
        if (entry.kind === "directory") {
          directoryPathsRef.current.add(entry.path);
        }
        if (knownTreePathsRef.current.has(treePath)) {
          continue;
        }
        knownTreePathsRef.current.add(treePath);
        operations.push({ type: "add", path: treePath });
      }

      if (operations.length > 0) {
        treeModel.batch(operations);
      }
    },
    [treeModel],
  );

  const loadDirectory = useCallback(
    async (relativePath: string, generation = generationRef.current) => {
      directoryLoadStatusRef.current.set(relativePath, "loading");
      setDirectoryStateByPath((current) => {
        const previous = current[relativePath];
        const previousEntries =
          previous && previous.status !== "idle"
            ? previous.entries
            : ([] as readonly ProjectEntry[]);
        const previousTruncated =
          previous && previous.status !== "idle" ? previous.truncated : false;
        return {
          ...current,
          [relativePath]: {
            status: "loading",
            entries: previousEntries,
            truncated: previousTruncated,
          },
        };
      });

      try {
        const api = readEnvironmentApi(environmentId);
        if (!api) {
          throw new Error("Project API unavailable.");
        }
        const result = await api.projects.listEntries({
          cwd: workspaceRoot,
          ...(includeIgnoredEntries ? { includeIgnored: true } : {}),
          ...(relativePath ? { relativePath } : {}),
          limit: DIRECTORY_ENTRY_LIMIT,
        });
        if (generationRef.current !== generation) return;
        directoryLoadStatusRef.current.set(relativePath, "ready");
        if (relativePath === "") {
          replaceTreeEntries(result.entries);
        } else {
          addTreeEntries(result.entries);
        }
        setDirectoryStateByPath((current) => ({
          ...current,
          [relativePath]: {
            status: "ready",
            entries: result.entries,
            truncated: result.truncated,
          },
        }));
      } catch (error) {
        if (generationRef.current !== generation) return;
        directoryLoadStatusRef.current.set(relativePath, "error");
        setDirectoryStateByPath((current) => {
          const previous = current[relativePath];
          const previousEntries =
            previous && previous.status !== "idle"
              ? previous.entries
              : ([] as readonly ProjectEntry[]);
          const previousTruncated =
            previous && previous.status !== "idle" ? previous.truncated : false;
          return {
            ...current,
            [relativePath]: {
              status: "error",
              message: error instanceof Error ? error.message : "Unable to load files.",
              entries: previousEntries,
              truncated: previousTruncated,
            },
          };
        });
      }
    },
    [addTreeEntries, environmentId, includeIgnoredEntries, replaceTreeEntries, workspaceRoot],
  );

  const toggleIgnoredEntries = useCallback(() => {
    setIncludeIgnoredEntries((current) => !current);
  }, []);

  const reloadRoot = useCallback(() => {
    generationRef.current += 1;
    directoryLoadStatusRef.current = new Map();
    directoryPathsRef.current = new Set();
    entryByTreePathRef.current = new Map();
    knownTreePathsRef.current = new Set();
    setExpandedDirectories(new Set());
    setDirectoryStateByPath({});
    treeModel.resetPaths([]);
    void loadDirectory("", generationRef.current);
  }, [loadDirectory, treeModel]);

  useEffect(() => {
    reloadRoot();
  }, [reloadRoot]);

  useEffect(() => {
    const syncExpandedDirectories = () => {
      const nextExpandedDirectories = collectExpandedDirectories(
        treeModel,
        directoryPathsRef.current,
      );
      setExpandedDirectories((current) =>
        areStringSetsEqual(current, nextExpandedDirectories) ? current : nextExpandedDirectories,
      );

      for (const relativePath of nextExpandedDirectories) {
        const status = directoryLoadStatusRef.current.get(relativePath) ?? "idle";
        if (status === "idle" || status === "error") {
          void loadDirectory(relativePath);
        }
      }
    };

    return treeModel.subscribe(syncExpandedDirectories);
  }, [loadDirectory, treeModel]);

  const selectedEntry = useMemo(() => {
    const selectedTreePath = selectedTreePaths.at(-1);
    if (!selectedTreePath) {
      return null;
    }
    return entryByTreePathRef.current.get(selectedTreePath) ?? null;
  }, [selectedTreePaths]);
  const selectedFileEntry = selectedEntry?.kind === "file" ? selectedEntry : null;
  const activeFileRelativePath = useMemo(
    () => toWorkspaceRelativePath(currentEditorFile, workspaceRoot),
    [currentEditorFile, workspaceRoot],
  );

  const readProjectApi = useCallback(() => {
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      throw new Error("Project API unavailable.");
    }
    return api;
  }, [environmentId]);

  const closeFileNameDialog = useCallback((value: string | null) => {
    const resolve = fileNameDialogResolverRef.current;
    fileNameDialogResolverRef.current = null;
    setFileNameDialogRequest(null);
    resolve?.(value);
  }, []);

  const openFileNameDialog = useCallback((input: ProjectFileNameDialogInput) => {
    fileNameDialogResolverRef.current?.(null);
    return new Promise<string | null>((resolve) => {
      fileNameDialogResolverRef.current = resolve;
      fileNameDialogRequestIdRef.current += 1;
      setFileNameDialogRequest({
        ...input,
        id: fileNameDialogRequestIdRef.current,
      });
    });
  }, []);

  useEffect(
    () => () => {
      fileNameDialogResolverRef.current?.(null);
      fileNameDialogResolverRef.current = null;
    },
    [],
  );

  const createEntry = useCallback(
    async (kind: ProjectEntry["kind"], parentPath = directoryPathForEntry(selectedEntry)) => {
      const defaultName = kind === "file" ? "untitled.txt" : "new-folder";
      const kindLabel = kind === "file" ? "file" : "folder";
      const parentLabel = parentPath ? parentPath : "project root";
      const entryPath = await openFileNameDialog({
        title: `New ${kindLabel}`,
        description: `Create in ${parentLabel}`,
        label: "Name",
        initialValue: defaultName,
        submitLabel: "Create",
        invalidMessage:
          kind === "file"
            ? "Use a file name or relative path inside the selected folder."
            : "Use a folder name or relative path inside the selected folder.",
        normalize: normalizePromptRelativePath,
      });
      if (!entryPath) {
        return;
      }
      const relativePath = joinRelativePath(parentPath, entryPath);

      try {
        const api = readProjectApi();
        if (kind === "file") {
          await api.projects.createFile({ cwd: workspaceRoot, relativePath });
        } else {
          await api.projects.createDirectory({
            cwd: workspaceRoot,
            relativePath,
          });
        }
        toastManager.add({
          type: "success",
          title: kind === "file" ? "File created" : "Folder created",
          description: relativePath,
        });
        reloadRoot();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: kind === "file" ? "Failed to create file" : "Failed to create folder",
          description: errorMessage(error),
        });
      }
    },
    [openFileNameDialog, readProjectApi, reloadRoot, selectedEntry, workspaceRoot],
  );

  const renameEntry = useCallback(
    async (entry: ProjectEntry) => {
      const kindLabel = entry.kind === "file" ? "file" : "folder";
      const nextName = await openFileNameDialog({
        title: `Rename ${kindLabel}`,
        description: entry.path,
        label: "Name",
        initialValue: basenameFromPath(entry.path),
        submitLabel: "Rename",
        invalidMessage: "Use a name without path separators.",
        normalize: normalizePromptEntryName,
      });
      if (!nextName) {
        return;
      }

      const destinationRelativePath = joinRelativePath(parentPathForEntry(entry), nextName);
      if (destinationRelativePath === entry.path) {
        return;
      }

      try {
        await readProjectApi().projects.moveEntry({
          cwd: workspaceRoot,
          sourceRelativePath: entry.path,
          destinationRelativePath,
        });
        setFileClipboard((current) =>
          current?.entry.path === entry.path
            ? { ...current, entry: { ...entry, path: destinationRelativePath } }
            : current,
        );
        toastManager.add({
          type: "success",
          title: "Renamed",
          description: destinationRelativePath,
        });
        reloadRoot();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename",
          description: errorMessage(error),
        });
      }
    },
    [openFileNameDialog, readProjectApi, reloadRoot, workspaceRoot],
  );

  const cutEntry = useCallback((entry: ProjectEntry) => {
    setFileClipboard({ mode: "cut", entry });
    toastManager.add({
      type: "success",
      title: "Ready to move",
      description: entry.path,
    });
  }, []);

  const copyEntry = useCallback((entry: ProjectEntry) => {
    setFileClipboard({ mode: "copy", entry });
    toastManager.add({
      type: "success",
      title: "Ready to copy",
      description: entry.path,
    });
  }, []);

  const pasteEntry = useCallback(
    async (targetEntry: ProjectEntry) => {
      if (!fileClipboard) {
        return;
      }

      const targetDirectoryPath = directoryPathForEntry(targetEntry);
      const destinationRelativePath = joinRelativePath(
        targetDirectoryPath,
        basenameFromPath(fileClipboard.entry.path),
      );
      if (destinationRelativePath === fileClipboard.entry.path) {
        toastManager.add({
          type: "warning",
          title: "Paste target already contains this entry",
          description: destinationRelativePath,
        });
        return;
      }

      try {
        const api = readProjectApi();
        if (fileClipboard.mode === "cut") {
          await api.projects.moveEntry({
            cwd: workspaceRoot,
            sourceRelativePath: fileClipboard.entry.path,
            destinationRelativePath,
          });
          setFileClipboard(null);
        } else {
          await api.projects.copyEntry({
            cwd: workspaceRoot,
            sourceRelativePath: fileClipboard.entry.path,
            destinationRelativePath,
          });
        }
        toastManager.add({
          type: "success",
          title: fileClipboard.mode === "cut" ? "Moved" : "Copied",
          description: destinationRelativePath,
        });
        reloadRoot();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: fileClipboard.mode === "cut" ? "Failed to move" : "Failed to copy",
          description: errorMessage(error),
        });
      }
    },
    [fileClipboard, readProjectApi, reloadRoot, workspaceRoot],
  );

  const deleteEntry = useCallback(
    async (entry: ProjectEntry) => {
      const localApi = readLocalApi();
      const confirmed = localApi
        ? await localApi.dialogs.confirm(`Delete ${entry.kind} "${entry.path}"?`)
        : window.confirm(`Delete ${entry.kind} "${entry.path}"?`);
      if (!confirmed) {
        return;
      }

      try {
        await readProjectApi().projects.removeEntry({
          cwd: workspaceRoot,
          relativePath: entry.path,
        });
        setFileClipboard((current) =>
          current && isSameOrNestedEntryPath(entry.path, current.entry.path) ? null : current,
        );
        toastManager.add({
          type: "success",
          title: "Deleted",
          description: entry.path,
        });
        reloadRoot();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to delete",
          description: errorMessage(error),
        });
      }
    },
    [readProjectApi, reloadRoot, workspaceRoot],
  );

  const openFile = useCallback(
    async (entry: ProjectEntry) => {
      if (!bridgeAvailable || !mainWindow || (!nvimReady && !vscodeReady)) {
        toastManager.add({
          type: "error",
          title: "Embedded editor unavailable",
        });
        return;
      }

      const target = joinWorkspacePath(workspaceRoot, entry.path);
      try {
        const editor = resolveActiveEmbeddedEditor({
          preferredEditor: preferredEmbeddedEditor,
          nvimReady,
          vscodeReady,
        });
        if (editor === "neovim") {
          await openInEmbeddedEditor(target);
        } else {
          await openInEmbeddedVSCode(target);
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [bridgeAvailable, mainWindow, nvimReady, preferredEmbeddedEditor, vscodeReady, workspaceRoot],
  );

  const previewFile = useCallback((entry: ProjectEntry) => {
    if (entry.kind !== "file") {
      return;
    }
    previewRequestIdRef.current += 1;
    setPreviewRequest({
      id: previewRequestIdRef.current,
      entry,
    });
  }, []);

  const copyRelativePath = useCallback(
    (entry: ProjectEntry) => {
      copyPathToClipboard(entry.path, entry);
    },
    [copyPathToClipboard],
  );

  const addFileResultToComposer = useCallback(
    (entry: ProjectEntry, result: ProjectReadFileResult) => {
      if (!composerTargetId) {
        toastManager.add({
          type: "error",
          title: "Composer unavailable",
          description: "Open a thread or draft before adding file context.",
        });
        return;
      }

      const text = result.contents;
      if (text.trim().length === 0) {
        toastManager.add({
          type: "warning",
          title: "File is empty",
          description: entry.path,
        });
        return;
      }

      const lineCount = Math.max(1, text.split("\n").length);
      useEditorStore.getState().addPendingContext({
        id: randomUUID(),
        threadId: composerTargetId as EditorContextDraft["threadId"],
        createdAt: new Date().toISOString(),
        file: joinWorkspacePath(workspaceRoot, entry.path),
        lineStart: 1,
        lineEnd: lineCount,
        text,
      });
      useEditorStore.getState().setActiveChatTab("thread");
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("[data-composer-textarea]")?.focus();
      });

      toastManager.add({
        type: result.truncated ? "warning" : "success",
        title: result.truncated ? "Truncated file added to composer" : "File added to composer",
        description: entry.path,
      });
    },
    [composerTargetId, workspaceRoot],
  );

  const addFileToComposer = useCallback(
    async (entry: ProjectEntry) => {
      if (entry.kind !== "file") {
        return;
      }

      try {
        const result = await readProjectApi().projects.readFile({
          cwd: workspaceRoot,
          relativePath: entry.path,
          maxBytes: PROJECT_FILE_PREVIEW_MAX_BYTES,
        });
        addFileResultToComposer(entry, result);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to add file to composer",
          description: errorMessage(error),
        });
      }
    },
    [addFileResultToComposer, readProjectApi, workspaceRoot],
  );

  const revealRelativeFilePath = useCallback(
    async (relativePath: string) => {
      const normalizedPath = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
      if (!normalizedPath) {
        return;
      }

      const parentDirectories = parentDirectoryChain(normalizedPath);
      for (const parentDirectory of parentDirectories) {
        const directoryItem = treeModel.getItem(toDirectoryTreePath(parentDirectory));
        if (!directoryItem || !("expand" in directoryItem)) {
          await loadDirectory(parentDirectory);
        } else {
          directoryItem.expand();
        }
        const status = directoryLoadStatusRef.current.get(parentDirectory) ?? "idle";
        if (status === "idle" || status === "error") {
          await loadDirectory(parentDirectory);
        }
      }

      const treePath = normalizedPath;
      const item = treeModel.getItem(treePath);
      if (!item) {
        toastManager.add({
          type: "warning",
          title: "File not found in tree",
          description: normalizedPath,
        });
        return;
      }
      for (const selectedPath of treeModel.getSelectedPaths()) {
        treeModel.getItem(selectedPath)?.deselect();
      }
      item.select();
      treeModel.scrollToPath(treePath, { focus: true, offset: "center" });
    },
    [loadDirectory, treeModel],
  );

  const revealActiveFile = useCallback(() => {
    if (!activeFileRelativePath) {
      toastManager.add({
        type: "warning",
        title: "No active project file",
      });
      return;
    }
    void revealRelativeFilePath(activeFileRelativePath);
  }, [activeFileRelativePath, revealRelativeFilePath]);

  const handleTreeClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const itemElement = event.nativeEvent.composedPath().find(isTreeItemElement);
      if (!itemElement || itemElement.dataset.itemType !== "file") {
        return;
      }
      const treePath = itemElement.dataset.itemPath;
      if (!treePath) {
        return;
      }
      const entry = entryByTreePathRef.current.get(treePath);
      if (!entry || entry.kind !== "file") {
        return;
      }
      previewFile(entry);
    },
    [previewFile],
  );

  const renderTreeContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
      const entry = entryByTreePathRef.current.get(item.path);
      if (!entry) {
        return null;
      }
      return (
        <ProjectFileTreeContextMenu
          clipboard={fileClipboard}
          context={context}
          entry={entry}
          onCopy={copyEntry}
          onCopyRelativePath={copyRelativePath}
          onCut={cutEntry}
          onAddToComposer={addFileToComposer}
          onDelete={deleteEntry}
          onPaste={pasteEntry}
          onPreview={previewFile}
          onRename={renameEntry}
        />
      );
    },
    [
      addFileToComposer,
      copyEntry,
      copyRelativePath,
      cutEntry,
      deleteEntry,
      fileClipboard,
      pasteEntry,
      previewFile,
      renameEntry,
    ],
  );

  const rootState = directoryStateByPath[""] ?? IDLE_DIRECTORY_STATE;
  const rootEntries = rootState.status === "idle" ? EMPTY_PROJECT_ENTRIES : rootState.entries;
  const rootError = rootState.status === "error" ? rootState.message : null;
  const workspaceLabel = useMemo(
    () => basenameFromPath(workspaceRoot) || projectName,
    [projectName, workspaceRoot],
  );
  const ignoredToggleLabel = includeIgnoredEntries ? "Hide ignored files" : "Show ignored files";
  const visibleRowCount = useMemo(
    () => countVisibleEntries(rootEntries, directoryStateByPath, expandedDirectories),
    [directoryStateByPath, expandedDirectories, rootEntries],
  );
  const treeHeight = useMemo(() => {
    if (visibleRowCount === 0) {
      return PROJECT_FILE_TREE_ROW_HEIGHT * PROJECT_FILE_TREE_MIN_VISIBLE_ROWS;
    }
    return (
      Math.min(
        Math.max(visibleRowCount, PROJECT_FILE_TREE_MIN_VISIBLE_ROWS),
        PROJECT_FILE_TREE_MAX_VISIBLE_ROWS,
      ) * PROJECT_FILE_TREE_ROW_HEIGHT
    );
  }, [visibleRowCount]);
  const treeStyle = useMemo<CSSProperties>(
    () => ({
      ...PROJECT_FILE_TREE_STYLE,
      height: treeHeight,
    }),
    [treeHeight],
  );
  const expandedDirectoryError = useMemo(() => {
    for (const relativePath of expandedDirectories) {
      const state = directoryStateByPath[relativePath];
      if (state?.status === "error") {
        return { relativePath, message: state.message };
      }
    }
    return null;
  }, [directoryStateByPath, expandedDirectories]);
  const expandedDirectoryTruncated = useMemo(() => {
    for (const relativePath of expandedDirectories) {
      const state = directoryStateByPath[relativePath];
      if (state && state.status !== "idle" && state.truncated) {
        return relativePath;
      }
    }
    return null;
  }, [directoryStateByPath, expandedDirectories]);

  return (
    <>
      <SidebarMenuSub
        className={cn("mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0", className)}
      >
        <SidebarMenuSubItem className="w-full">
          <div className="mb-1 flex h-7 min-w-0 items-center gap-1.5 px-2 text-[10px] text-muted-foreground/70">
            <FolderOpenIcon className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={workspaceRoot}>
              {workspaceLabel}
            </span>
            <ProjectFileExplorerToolbarButton
              active={treeSearch.isOpen}
              label="Search files"
              onClick={() => treeSearch.open()}
            >
              <SearchIcon className="size-3" />
            </ProjectFileExplorerToolbarButton>
            <ProjectFileExplorerToolbarButton
              disabled={!selectedFileEntry}
              label="Preview selected file"
              onClick={() => selectedFileEntry && previewFile(selectedFileEntry)}
            >
              <EyeIcon className="size-3" />
            </ProjectFileExplorerToolbarButton>
            <ProjectFileExplorerToolbarButton
              disabled={!activeFileRelativePath}
              label="Reveal active file"
              onClick={revealActiveFile}
            >
              <FolderOpenIcon className="size-3" />
            </ProjectFileExplorerToolbarButton>
            <ProjectFileExplorerToolbarButton
              label="New file"
              onClick={() => void createEntry("file")}
            >
              <FilePlusIcon className="size-3" />
            </ProjectFileExplorerToolbarButton>
            <ProjectFileExplorerToolbarButton
              label="New folder"
              onClick={() => void createEntry("directory")}
            >
              <FolderPlusIcon className="size-3" />
            </ProjectFileExplorerToolbarButton>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={ignoredToggleLabel}
                    aria-pressed={includeIgnoredEntries}
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                      includeIgnoredEntries && "text-foreground",
                    )}
                    onClick={toggleIgnoredEntries}
                  />
                }
              >
                {includeIgnoredEntries ? (
                  <EyeOffIcon className="size-3" />
                ) : (
                  <EyeIcon className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">{ignoredToggleLabel}</TooltipPopup>
            </Tooltip>
            <button
              type="button"
              aria-label="Refresh files"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={reloadRoot}
            >
              <RefreshCwIcon
                className={cn("size-3", rootState.status === "loading" && "animate-spin")}
              />
            </button>
          </div>
        </SidebarMenuSubItem>

        {rootState.status === "loading" && rootEntries.length === 0 ? (
          <ProjectFileExplorerMessage icon={<Spinner className="size-3" />} label="Loading files" />
        ) : null}

        {rootError && rootEntries.length === 0 ? (
          <ProjectFileExplorerMessage
            icon={<TriangleAlertIcon className="size-3" />}
            label="Files unavailable"
            title={rootError}
          />
        ) : null}

        {rootState.status === "ready" && rootEntries.length === 0 ? (
          <ProjectFileExplorerMessage icon={<FolderIcon className="size-3" />} label="No files" />
        ) : null}

        {rootEntries.length > 0 ? (
          <SidebarMenuSubItem className="w-full">
            <PierreFileTree
              aria-label={`${workspaceLabel} files`}
              className="block w-full min-w-0"
              model={treeModel}
              renderContextMenu={renderTreeContextMenu}
              style={treeStyle}
              onClickCapture={handleTreeClickCapture}
            />
          </SidebarMenuSubItem>
        ) : null}

        {rootState.status !== "idle" && rootState.truncated ? (
          <ProjectFileExplorerMessage label={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`} />
        ) : null}

        {expandedDirectoryError ? (
          <ProjectFileExplorerMessage
            icon={<TriangleAlertIcon className="size-3" />}
            label={`Unable to load ${basenameFromPath(expandedDirectoryError.relativePath)}`}
            title={expandedDirectoryError.message}
          />
        ) : null}

        {expandedDirectoryTruncated ? (
          <ProjectFileExplorerMessage
            label={`${basenameFromPath(expandedDirectoryTruncated)} is truncated`}
            title={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`}
          />
        ) : null}
      </SidebarMenuSub>
      <ProjectFileNameDialog
        request={fileNameDialogRequest}
        onCancel={() => closeFileNameDialog(null)}
        onSubmit={closeFileNameDialog}
      />
      <ProjectFilePreviewDialog
        environmentId={environmentId}
        request={previewRequest}
        workspaceRoot={workspaceRoot}
        onAddToComposer={addFileResultToComposer}
        onClose={() => setPreviewRequest(null)}
        onOpenFile={openFile}
      />
    </>
  );
});

function ProjectFileExplorerToolbarButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active || undefined}
            disabled={disabled}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              active && "bg-accent text-foreground",
            )}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ProjectFileNameDialog({
  onCancel,
  onSubmit,
  request,
}: {
  onCancel: () => void;
  onSubmit: (value: string) => void;
  request: ProjectFileNameDialogRequest | null;
}) {
  const formId = useId();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    setValue(request.initialValue);
    setError(null);
  }, [request]);

  if (!request) {
    return null;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedValue = request.normalize(value);
    if (!normalizedValue) {
      setError(request.invalidMessage);
      return;
    }
    onSubmit(normalizedValue);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id={formId} className="space-y-2" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor={inputId}>{request.label}</Label>
              <Input
                id={inputId}
                autoFocus
                aria-invalid={error ? true : undefined}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              />
            </div>
            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button form={formId} type="submit">
            {request.submitLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ProjectFileTreeContextMenu({
  clipboard,
  context,
  entry,
  onAddToComposer,
  onCopy,
  onCopyRelativePath,
  onCut,
  onDelete,
  onPaste,
  onPreview,
  onRename,
}: {
  clipboard: ProjectFileClipboard | null;
  context: ContextMenuOpenContext;
  entry: ProjectEntry;
  onAddToComposer: (entry: ProjectEntry) => Promise<void>;
  onCopy: (entry: ProjectEntry) => void;
  onCopyRelativePath: (entry: ProjectEntry) => void;
  onCut: (entry: ProjectEntry) => void;
  onDelete: (entry: ProjectEntry) => Promise<void>;
  onPaste: (entry: ProjectEntry) => Promise<void>;
  onPreview: (entry: ProjectEntry) => void;
  onRename: (entry: ProjectEntry) => Promise<void>;
}) {
  const pasteLabel = clipboard ? `Paste ${basenameFromPath(clipboard.entry.path)}` : "Paste";

  const runAction = (action: () => void | Promise<void>) => {
    context.close({ restoreFocus: false });
    void action();
  };

  return (
    <div
      data-file-tree-context-menu-root="true"
      role="menu"
      aria-label={`${basenameFromPath(entry.path)} actions`}
      className="min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg/5"
      style={getProjectFileTreeContextMenuStyle(context.anchorRect)}
    >
      <ProjectFileTreeContextMenuButton
        disabled={entry.kind !== "file"}
        icon={<EyeIcon />}
        label="Preview"
        onClick={() => runAction(() => onPreview(entry))}
      />
      <ProjectFileTreeContextMenuButton
        disabled={entry.kind !== "file"}
        icon={<MessageSquarePlusIcon />}
        label="Add to composer"
        onClick={() => runAction(() => onAddToComposer(entry))}
      />
      <ProjectFileTreeContextMenuButton
        icon={<CopyIcon />}
        label="Copy relative path"
        onClick={() => runAction(() => onCopyRelativePath(entry))}
      />
      <div className="mx-1 my-1 h-px bg-border" />
      <ProjectFileTreeContextMenuButton
        icon={<PencilIcon />}
        label="Rename"
        onClick={() => runAction(() => onRename(entry))}
      />
      <ProjectFileTreeContextMenuButton
        icon={<ScissorsIcon />}
        label="Cut"
        onClick={() => runAction(() => onCut(entry))}
      />
      <ProjectFileTreeContextMenuButton
        icon={<CopyIcon />}
        label="Copy"
        onClick={() => runAction(() => onCopy(entry))}
      />
      <ProjectFileTreeContextMenuButton
        disabled={!clipboard}
        icon={<ClipboardPasteIcon />}
        label={pasteLabel}
        onClick={() => runAction(() => onPaste(entry))}
      />
      <div className="mx-1 my-1 h-px bg-border" />
      <ProjectFileTreeContextMenuButton
        destructive
        icon={<Trash2Icon />}
        label="Delete"
        onClick={() => runAction(() => onDelete(entry))}
      />
    </div>
  );
}

function ProjectFileTreeContextMenuButton({
  destructive = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        destructive && "text-destructive-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function ProjectFileExplorerMessage({
  icon,
  label,
  title,
}: {
  icon?: ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <SidebarMenuSubItem className="w-full">
      <div
        className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-[10px] text-muted-foreground/60"
        title={title}
      >
        {icon ? (
          <span className="inline-flex size-3 shrink-0 items-center justify-center">{icon}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
    </SidebarMenuSubItem>
  );
}

function collectExpandedDirectories(
  treeModel: ReturnType<typeof useFileTree>["model"],
  directoryPaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const expandedDirectories = new Set<string>();
  for (const relativePath of directoryPaths) {
    const item = treeModel.getItem(toDirectoryTreePath(relativePath));
    if (item && "isExpanded" in item && item.isExpanded()) {
      expandedDirectories.add(relativePath);
    }
  }
  return expandedDirectories;
}

function countVisibleEntries(
  entries: readonly ProjectEntry[],
  directoryStateByPath: Record<string, DirectoryLoadState>,
  expandedDirectories: ReadonlySet<string>,
): number {
  let visibleCount = 0;
  for (const entry of entries) {
    visibleCount += 1;
    if (entry.kind !== "directory" || !expandedDirectories.has(entry.path)) {
      continue;
    }
    const state = directoryStateByPath[entry.path] ?? IDLE_DIRECTORY_STATE;
    const children = state.status === "idle" ? [] : state.entries;
    visibleCount += countVisibleEntries(children, directoryStateByPath, expandedDirectories);
  }
  return visibleCount;
}

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function isTreeItemElement(value: EventTarget): value is HTMLElement {
  return value instanceof HTMLElement && value.dataset.type === "item";
}

function toTreePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? toDirectoryTreePath(entry.path) : entry.path;
}

function toDirectoryTreePath(relativePath: string): string {
  return relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
}

function getProjectFileTreeContextMenuStyle(
  anchorRect: ContextMenuOpenContext["anchorRect"],
): CSSProperties {
  const viewportWidth =
    typeof window === "undefined" ? null : (window.visualViewport?.width ?? window.innerWidth);
  const viewportHeight =
    typeof window === "undefined" ? null : (window.visualViewport?.height ?? window.innerHeight);
  const rawLeft = Math.round(anchorRect.left);
  const rawTop = Math.round(anchorRect.top);
  const horizontalOffset =
    viewportWidth === null
      ? 0
      : Math.min(
          Math.max(
            0,
            rawLeft +
              PROJECT_FILE_TREE_CONTEXT_MENU_MIN_WIDTH +
              PROJECT_FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN -
              viewportWidth,
          ),
          Math.max(0, rawLeft - PROJECT_FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN),
        );
  const maxHeightAnchorTop =
    viewportHeight === null
      ? rawTop
      : Math.max(PROJECT_FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN, rawTop);

  return {
    left: 0,
    maxHeight: `calc(100vh - ${maxHeightAnchorTop + PROJECT_FILE_TREE_CONTEXT_MENU_VIEWPORT_MARGIN}px)`,
    overflowY: "auto",
    position: "absolute",
    top: 0,
    transform: horizontalOffset > 0 ? `translateX(-${horizontalOffset}px)` : undefined,
    zIndex: 60,
  };
}

function normalizePromptRelativePath(input: string): string | null {
  const normalizedPath = input.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  const trimmedPath = normalizedPath.replace(/^\/+|\/+$/g, "");
  if (
    trimmedPath.length === 0 ||
    trimmedPath === "." ||
    trimmedPath === ".." ||
    trimmedPath.startsWith("../") ||
    trimmedPath.includes("/../") ||
    trimmedPath.endsWith("/..") ||
    /^[A-Za-z]:\//.test(trimmedPath)
  ) {
    return null;
  }
  return trimmedPath;
}

function normalizePromptEntryName(input: string): string | null {
  const normalizedName = input.trim();
  if (
    normalizedName.length === 0 ||
    normalizedName === "." ||
    normalizedName === ".." ||
    normalizedName.includes("/") ||
    normalizedName.includes("\\")
  ) {
    return null;
  }
  return normalizedName;
}

function directoryPathForEntry(entry: ProjectEntry | null): string {
  if (!entry) {
    return "";
  }
  return entry.kind === "directory" ? entry.path : parentPathForEntry(entry);
}

function parentPathForEntry(entry: ProjectEntry): string {
  return entry.parentPath ?? parentPathFromRelativePath(entry.path);
}

function parentPathFromRelativePath(relativePath: string): string {
  const normalizedPath = relativePath.replaceAll("\\", "/").replace(/\/+$/g, "");
  const separatorIndex = normalizedPath.lastIndexOf("/");
  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : "";
}

function parentDirectoryChain(relativePath: string): string[] {
  const normalizedPath = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  const directories: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    directories.push(segments.slice(0, index + 1).join("/"));
  }
  return directories;
}

function joinRelativePath(parentPath: string, childPath: string): string {
  const normalizedParent = parentPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const normalizedChild = childPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return normalizedParent ? `${normalizedParent}/${normalizedChild}` : normalizedChild;
}

function isSameOrNestedEntryPath(parentPath: string, childPath: string): boolean {
  const normalizedParent = parentPath.replaceAll("\\", "/").replace(/\/+$/g, "");
  const normalizedChild = childPath.replaceAll("\\", "/").replace(/\/+$/g, "");
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

function basenameFromPath(input: string): string {
  const trimmed = input.replace(/[\\/]+$/g, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const separator = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/g, "");
  return `${normalizedRoot}${separator}${relativePath.replaceAll("/", separator)}`;
}

function toWorkspaceRelativePath(filePath: string | null, workspaceRoot: string): string | null {
  if (!filePath) {
    return null;
  }
  const normalizedRoot = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/g, "");
  const normalizedFile = filePath.replaceAll("\\", "/");
  if (normalizedFile === normalizedRoot) {
    return null;
  }
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  const relativePath = normalizedFile.slice(normalizedRoot.length + 1).replace(/^\/+|\/+$/g, "");
  return relativePath.length > 0 ? relativePath : null;
}
