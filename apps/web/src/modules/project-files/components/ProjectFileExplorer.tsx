import type { EnvironmentId, ProjectEntry } from "@fenrir/contracts";
import {
  ChevronRightIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SidebarMenuSub, SidebarMenuSubItem } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { readEnvironmentApi } from "~/environmentApi";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { useSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { openInEmbeddedEditor, openInEmbeddedVSCode } from "~/editorPreferences";
import { resolveActiveEmbeddedEditor } from "~/modules/neovim-editor/embeddedEditor";
import { toastManager } from "~/components/ui/toast";

const DIRECTORY_ENTRY_LIMIT = 300;

type DirectoryLoadState =
  | { status: "idle" }
  | { status: "loading"; entries: readonly ProjectEntry[]; truncated: boolean }
  | { status: "ready"; entries: readonly ProjectEntry[]; truncated: boolean }
  | { status: "error"; message: string; entries: readonly ProjectEntry[]; truncated: boolean };

const IDLE_DIRECTORY_STATE: DirectoryLoadState = { status: "idle" };

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
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set([""]),
  );
  const [directoryStateByPath, setDirectoryStateByPath] = useState<
    Record<string, DirectoryLoadState>
  >({});
  const generationRef = useRef(0);

  const loadDirectory = useCallback(
    async (relativePath: string, generation = generationRef.current) => {
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
          ...(relativePath ? { relativePath } : {}),
          limit: DIRECTORY_ENTRY_LIMIT,
        });
        if (generationRef.current !== generation) return;
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
    [environmentId, workspaceRoot],
  );

  const reloadRoot = useCallback(() => {
    generationRef.current += 1;
    setExpandedDirectories(new Set([""]));
    setDirectoryStateByPath({});
    void loadDirectory("", generationRef.current);
  }, [loadDirectory]);

  useEffect(() => {
    reloadRoot();
  }, [reloadRoot]);

  const toggleDirectory = useCallback(
    (relativePath: string) => {
      const nextExpanded = !expandedDirectories.has(relativePath);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        if (nextExpanded) {
          next.add(relativePath);
        } else {
          next.delete(relativePath);
        }
        return next;
      });

      if (!nextExpanded) return;
      const state = directoryStateByPath[relativePath] ?? IDLE_DIRECTORY_STATE;
      if (state.status === "idle" || state.status === "error") {
        void loadDirectory(relativePath);
      }
    },
    [directoryStateByPath, expandedDirectories, loadDirectory],
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

  const rootState = directoryStateByPath[""] ?? IDLE_DIRECTORY_STATE;
  const rootEntries = rootState.status === "idle" ? [] : rootState.entries;
  const rootError = rootState.status === "error" ? rootState.message : null;
  const workspaceLabel = useMemo(
    () => basenameFromPath(workspaceRoot) || projectName,
    [projectName, workspaceRoot],
  );

  return (
    <SidebarMenuSub
      className={cn("mx-0 w-full translate-x-0 gap-0.5 border-0 px-0 py-0", className)}
    >
      <SidebarMenuSubItem className="w-full">
        <div className="mb-1 flex h-7 min-w-0 items-center gap-1.5 px-2 text-[10px] text-muted-foreground/70">
          <FolderOpenIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={workspaceRoot}>
            {workspaceLabel}
          </span>
          <button
            type="button"
            aria-label="Refresh files"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={reloadRoot}
          >
            <RefreshCwIcon className="size-3" />
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

      {rootEntries.map((entry) => (
        <ProjectFileExplorerRow
          key={entry.path}
          depth={0}
          entry={entry}
          directoryStateByPath={directoryStateByPath}
          expandedDirectories={expandedDirectories}
          onOpenFile={openFile}
          onToggleDirectory={toggleDirectory}
        />
      ))}

      {rootState.status !== "idle" && rootState.truncated ? (
        <ProjectFileExplorerMessage label={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`} />
      ) : null}
    </SidebarMenuSub>
  );
});

interface ProjectFileExplorerRowProps {
  depth: number;
  entry: ProjectEntry;
  directoryStateByPath: Record<string, DirectoryLoadState>;
  expandedDirectories: ReadonlySet<string>;
  onOpenFile: (entry: ProjectEntry) => void;
  onToggleDirectory: (relativePath: string) => void;
}

const ProjectFileExplorerRow = memo(function ProjectFileExplorerRow({
  depth,
  entry,
  directoryStateByPath,
  expandedDirectories,
  onOpenFile,
  onToggleDirectory,
}: ProjectFileExplorerRowProps) {
  const paddingLeft = 8 + depth * 12;

  if (entry.kind === "file") {
    return (
      <SidebarMenuSubItem className="w-full">
        <button
          type="button"
          className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pr-1.5 text-left text-[10px] text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          style={{ paddingLeft }}
          title={entry.path}
          onClick={() => onOpenFile(entry)}
        >
          {isCodeFile(entry.path) ? (
            <FileCode2Icon className="size-3 shrink-0" />
          ) : (
            <FileTextIcon className="size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{basenameFromPath(entry.path)}</span>
        </button>
      </SidebarMenuSubItem>
    );
  }

  const expanded = expandedDirectories.has(entry.path);
  const state = directoryStateByPath[entry.path] ?? IDLE_DIRECTORY_STATE;
  const children = state.status === "idle" ? [] : state.entries;

  return (
    <>
      <SidebarMenuSubItem className="w-full">
        <button
          type="button"
          className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pr-1.5 text-left text-[10px] text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          style={{ paddingLeft }}
          title={entry.path}
          onClick={() => onToggleDirectory(entry.path)}
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
          {expanded ? (
            <FolderOpenIcon className="size-3 shrink-0" />
          ) : (
            <FolderIcon className="size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{basenameFromPath(entry.path)}</span>
          {state.status === "loading" ? <Spinner className="size-3 shrink-0" /> : null}
        </button>
      </SidebarMenuSubItem>

      {expanded && state.status === "error" ? (
        <ProjectFileExplorerMessage
          depth={depth + 1}
          icon={<TriangleAlertIcon className="size-3" />}
          label="Unable to load"
          title={state.message}
        />
      ) : null}

      {expanded
        ? children.map((child) => (
            <ProjectFileExplorerRow
              key={child.path}
              depth={depth + 1}
              entry={child}
              directoryStateByPath={directoryStateByPath}
              expandedDirectories={expandedDirectories}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))
        : null}

      {expanded && state.status !== "idle" && state.truncated ? (
        <ProjectFileExplorerMessage
          depth={depth + 1}
          label={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`}
        />
      ) : null}
    </>
  );
});

function ProjectFileExplorerMessage({
  depth = 0,
  icon,
  label,
  title,
}: {
  depth?: number;
  icon?: ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <SidebarMenuSubItem className="w-full">
      <div
        className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-[10px] text-muted-foreground/60"
        style={{ paddingLeft: 8 + depth * 12 }}
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

function isCodeFile(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|css|html|json|mdx?|py|rs|go|java|kt|swift|rb|php|sh|bash|zsh|fish|sql|ya?ml|toml|tsx?|vue|svelte)$/i.test(
    path,
  );
}
