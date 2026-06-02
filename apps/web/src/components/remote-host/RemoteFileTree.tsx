import type { EnvironmentId, RemoteConnectionId, RemoteDirectoryEntry } from "@fenrir/contracts";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";
import { basenameFromRemotePath, sortRemoteDirectoryEntries } from "./RemoteFileTree.logic";

const DIRECTORY_ENTRY_LIMIT = 200;
const ROOT_PATH = ".";

type DirectoryLoadState =
  | { status: "idle" }
  | { status: "loading"; entries: readonly RemoteDirectoryEntry[]; truncated: boolean }
  | {
      status: "ready";
      entries: readonly RemoteDirectoryEntry[];
      truncated: boolean;
      parseError?: string;
    }
  | {
      status: "error";
      message: string;
      entries: readonly RemoteDirectoryEntry[];
      truncated: boolean;
    };

const IDLE_DIRECTORY_STATE: DirectoryLoadState = { status: "idle" };

interface RemoteFileTreeProps {
  readonly environmentId: EnvironmentId | null;
  readonly connectionId: RemoteConnectionId | null;
  readonly currentPath: string;
}

export function RemoteFileTree({ environmentId, connectionId, currentPath }: RemoteFileTreeProps) {
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set([ROOT_PATH]),
  );
  const [directoryStateByPath, setDirectoryStateByPath] = useState<
    Record<string, DirectoryLoadState>
  >({});
  const generationRef = useRef(0);

  const loadDirectory = useCallback(
    async (path: string, generation = generationRef.current) => {
      if (!environmentId || !connectionId) return;

      setDirectoryStateByPath((current) => {
        const previous = current[path];
        const entries = previous && previous.status !== "idle" ? previous.entries : [];
        const truncated = previous && previous.status !== "idle" ? previous.truncated : false;
        return {
          ...current,
          [path]: { status: "loading", entries, truncated },
        };
      });

      try {
        const api = readEnvironmentApi(environmentId);
        if (!api) throw new Error("Remote controller API unavailable.");
        const result = await api.remoteController.listDirectory({
          connectionId,
          path,
          limit: DIRECTORY_ENTRY_LIMIT,
        });
        if (generationRef.current !== generation) return;
        setDirectoryStateByPath((current) => ({
          ...current,
          [path]: {
            status: "ready",
            entries: sortRemoteDirectoryEntries(result.entries),
            truncated: result.truncated,
            ...(result.parseError === undefined ? {} : { parseError: result.parseError }),
          },
        }));
      } catch (error) {
        if (generationRef.current !== generation) return;
        setDirectoryStateByPath((current) => {
          const previous = current[path];
          const entries = previous && previous.status !== "idle" ? previous.entries : [];
          const truncated = previous && previous.status !== "idle" ? previous.truncated : false;
          return {
            ...current,
            [path]: {
              status: "error",
              message: error instanceof Error ? error.message : "Unable to load directory.",
              entries,
              truncated,
            },
          };
        });
      }
    },
    [connectionId, environmentId],
  );

  const reloadRoot = useCallback(() => {
    generationRef.current += 1;
    setExpandedDirectories(new Set([ROOT_PATH]));
    setDirectoryStateByPath({});
    void loadDirectory(ROOT_PATH, generationRef.current);
  }, [loadDirectory]);

  useEffect(() => {
    if (!connectionId) {
      generationRef.current += 1;
      setExpandedDirectories(new Set([ROOT_PATH]));
      setDirectoryStateByPath({});
      return;
    }
    reloadRoot();
  }, [connectionId, currentPath, reloadRoot]);

  const setPath = useCallback(
    async (path: string) => {
      if (!environmentId || !connectionId) return;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      await api.remoteController.setConnectionPath({ connectionId, path });
    },
    [connectionId, environmentId],
  );

  const toggleDirectory = useCallback(
    (path: string) => {
      const nextExpanded = !expandedDirectories.has(path);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        if (nextExpanded) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });

      if (!nextExpanded) return;
      const state = directoryStateByPath[path] ?? IDLE_DIRECTORY_STATE;
      if (state.status === "idle" || state.status === "error") {
        void loadDirectory(path);
      }
    },
    [directoryStateByPath, expandedDirectories, loadDirectory],
  );

  const rootState = directoryStateByPath[ROOT_PATH] ?? IDLE_DIRECTORY_STATE;
  const rootEntries = rootState.status === "idle" ? [] : rootState.entries;

  return (
    <section className="mt-4 min-h-0">
      <div className="mb-1 flex h-6 items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        <FolderOpen className="size-3.5" />
        <span className="min-w-0 flex-1 truncate" title={currentPath}>
          Files · {currentPath}
        </span>
        <button
          type="button"
          aria-label="Refresh files"
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          disabled={!connectionId}
          onClick={reloadRoot}
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      {!connectionId ? (
        <RemoteFileTreeMessage icon={<Folder className="size-3" />} label="Start host to browse" />
      ) : null}

      {connectionId && rootState.status === "loading" && rootEntries.length === 0 ? (
        <RemoteFileTreeMessage icon={<Spinner className="size-3" />} label="Loading files" />
      ) : null}

      {connectionId && rootState.status === "error" && rootEntries.length === 0 ? (
        <RemoteFileTreeMessage
          icon={<TriangleAlert className="size-3" />}
          label="Files unavailable"
          title={rootState.message}
        />
      ) : null}

      {connectionId && rootState.status === "ready" && rootEntries.length === 0 ? (
        <RemoteFileTreeMessage icon={<Folder className="size-3" />} label="No files" />
      ) : null}

      <div className="space-y-0.5">
        {rootEntries.map((entry) => (
          <RemoteFileTreeRow
            key={entry.path}
            depth={0}
            entry={entry}
            directoryStateByPath={directoryStateByPath}
            expandedDirectories={expandedDirectories}
            onSetDirectoryPath={setPath}
            onToggleDirectory={toggleDirectory}
          />
        ))}
      </div>

      {rootState.status === "ready" && rootState.parseError ? (
        <RemoteFileTreeMessage
          icon={<TriangleAlert className="size-3" />}
          label="Partial listing"
          title={rootState.parseError}
        />
      ) : null}

      {rootState.status !== "idle" && rootState.truncated ? (
        <RemoteFileTreeMessage label={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`} />
      ) : null}
    </section>
  );
}

interface RemoteFileTreeRowProps {
  readonly depth: number;
  readonly entry: RemoteDirectoryEntry;
  readonly directoryStateByPath: Record<string, DirectoryLoadState>;
  readonly expandedDirectories: ReadonlySet<string>;
  readonly onSetDirectoryPath: (path: string) => void;
  readonly onToggleDirectory: (path: string) => void;
}

const RemoteFileTreeRow = memo(function RemoteFileTreeRow({
  depth,
  entry,
  directoryStateByPath,
  expandedDirectories,
  onSetDirectoryPath,
  onToggleDirectory,
}: RemoteFileTreeRowProps) {
  const paddingLeft = 8 + depth * 12;

  if (entry.kind !== "directory") {
    return (
      <button
        type="button"
        className="group flex h-6 w-full min-w-0 items-center gap-1.5 rounded pr-1.5 text-left text-xs text-muted-foreground/80 hover:bg-muted hover:text-foreground"
        style={{ paddingLeft }}
        title={entry.path}
      >
        <RemoteFileIcon kind={entry.kind} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
    );
  }

  const expanded = expandedDirectories.has(entry.path);
  const state = directoryStateByPath[entry.path] ?? IDLE_DIRECTORY_STATE;
  const children = state.status === "idle" ? [] : state.entries;

  return (
    <>
      <button
        type="button"
        className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded pr-1.5 text-left text-xs text-muted-foreground/80 hover:bg-muted hover:text-foreground"
        style={{ paddingLeft }}
        title={entry.path}
        onClick={() => onToggleDirectory(entry.path)}
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        {expanded ? (
          <FolderOpen className="size-3 shrink-0" />
        ) : (
          <Folder className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{basenameFromRemotePath(entry.path)}</span>
        {state.status === "loading" ? <Spinner className="size-3 shrink-0" /> : null}
        <span
          role="button"
          tabIndex={0}
          aria-label={`Set path to ${entry.path}`}
          className="hidden h-5 shrink-0 items-center rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline-flex"
          onClick={(event) => {
            event.stopPropagation();
            void onSetDirectoryPath(entry.path);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            void onSetDirectoryPath(entry.path);
          }}
        >
          cd
        </span>
      </button>

      {expanded && state.status === "error" ? (
        <RemoteFileTreeMessage
          depth={depth + 1}
          icon={<TriangleAlert className="size-3" />}
          label="Unable to load"
          title={state.message}
        />
      ) : null}

      {expanded
        ? children.map((child) => (
            <RemoteFileTreeRow
              key={child.path}
              depth={depth + 1}
              entry={child}
              directoryStateByPath={directoryStateByPath}
              expandedDirectories={expandedDirectories}
              onSetDirectoryPath={onSetDirectoryPath}
              onToggleDirectory={onToggleDirectory}
            />
          ))
        : null}

      {expanded && state.status !== "idle" && state.truncated ? (
        <RemoteFileTreeMessage
          depth={depth + 1}
          label={`Showing first ${DIRECTORY_ENTRY_LIMIT} entries`}
        />
      ) : null}
    </>
  );
});

function RemoteFileIcon({ kind }: { readonly kind: RemoteDirectoryEntry["kind"] }) {
  switch (kind) {
    case "symlink":
      return <Link2 className="size-3 shrink-0" />;
    case "file":
      return <FileText className="size-3 shrink-0" />;
    case "other":
      return <FileText className="size-3 shrink-0 opacity-60" />;
    case "directory":
      return <Folder className="size-3 shrink-0" />;
  }
}

function RemoteFileTreeMessage({
  depth = 0,
  icon,
  label,
  title,
}: {
  readonly depth?: number;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly title?: string;
}) {
  return (
    <div
      className="flex h-6 min-w-0 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground/60"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={title}
    >
      {icon ? (
        <span className="inline-flex size-3 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}
