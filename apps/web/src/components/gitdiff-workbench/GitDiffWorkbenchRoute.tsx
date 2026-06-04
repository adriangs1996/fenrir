import type { GitDiffFileSummary } from "@fenrir/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { FileTextIcon, GitCompareIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { gitDiffFileIndexQueryOptions, invalidateGitDiffQueries } from "~/lib/gitDiffReactQuery";
import { selectProjectByRef, selectThreadByRef, useStore } from "~/store";
import { resolveThreadRouteRef } from "~/threadRoutes";

const MOCK_DIFF_HUNKS = [
  {
    id: "imports",
    header: "@@ -1,5 +1,7 @@",
    rows: [
      { left: "1", right: "1", kind: "ctx", text: 'import { useMemo, useState } from "react";' },
      { left: "", right: "2", kind: "add", text: 'import { useOptimistic } from "react";' },
      { left: "2", right: "3", kind: "ctx", text: 'import { Button } from "../ui/button";' },
      { left: "3", right: "4", kind: "ctx", text: 'import { Textarea } from "../ui/textarea";' },
    ],
  },
  {
    id: "state",
    header: "@@ -18,10 +20,17 @@",
    rows: [
      {
        left: "18",
        right: "20",
        kind: "ctx",
        text: "export function MessageComposer({ threadId }: Props) {",
      },
      { left: "19", right: "21", kind: "del", text: '  const [draft, setDraft] = useState("");' },
      { left: "", right: "21", kind: "add", text: '  const [draft, setDraft] = useState("");' },
      {
        left: "",
        right: "22",
        kind: "add",
        text: "  const [optimisticMessages, addOptimisticMessage] = useOptimistic(",
      },
      { left: "", right: "23", kind: "add", text: "    messages," },
      { left: "", right: "24", kind: "add", text: "    (state, message) => [...state, message]," },
      { left: "", right: "25", kind: "add", text: "  );" },
      { left: "20", right: "26", kind: "ctx", text: "" },
      { left: "21", right: "27", kind: "ctx", text: "  const submit = async () => {" },
      { left: "22", right: "28", kind: "del", text: "    if (!draft.trim()) return;" },
      { left: "", right: "29", kind: "add", text: "    const body = draft.trim();" },
      { left: "", right: "30", kind: "add", text: "    if (!body) return;" },
      {
        left: "",
        right: "31",
        kind: "add",
        text: "    addOptimisticMessage({ id: crypto.randomUUID(), body });",
      },
    ],
  },
] as const;

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

function totalInsertions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.insertions, 0);
}

function totalDeletions(files: readonly GitDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.deletions, 0);
}

function statusText(file: GitDiffFileSummary): string {
  if (file.binary) return "Binary";
  if (file.previousPath) return "Renamed";
  if (file.insertions > 0 && file.deletions > 0) return "Modified";
  if (file.insertions > 0) return "Added";
  if (file.deletions > 0) return "Removed";
  return "Changed";
}

export function GitDiffWorkbenchRoute() {
  const params = useParams({ from: "/_chat/$environmentId/$threadId/gitdiff" });
  const threadRef = useMemo(() => resolveThreadRouteRef(params), [params]);
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

  const worktreeQuery = useQuery(
    gitDiffFileIndexQueryOptions({ environmentId, cwd, targetKind: "worktree" }),
  );
  const worktreeFiles = useMemo(() => sortFiles(worktreeQuery.data ?? []), [worktreeQuery.data]);
  const selectedFile = worktreeFiles.find((file) => file.path === selectedPath) ?? null;
  const insertionCount = totalInsertions(worktreeFiles);
  const deletionCount = totalDeletions(worktreeFiles);

  useEffect(() => {
    if (worktreeFiles.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !worktreeFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(worktreeFiles[0]?.path ?? null);
    }
  }, [selectedPath, worktreeFiles]);

  const refresh = () => {
    void invalidateGitDiffQueries(queryClient, { environmentId, cwd });
  };

  if (!thread || !project || !cwd) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Git Diff needs an active thread.
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitCompareIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Working tree</div>
              <div className="truncate text-xs text-muted-foreground">{cwd}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {worktreeFiles.length} {worktreeFiles.length === 1 ? "file" : "files"}
            </span>
            <Button
              aria-label="Refresh diff"
              disabled={worktreeQuery.isFetching}
              size="icon-xs"
              variant="ghost"
              onClick={refresh}
            >
              <RefreshCwIcon className={worktreeQuery.isFetching ? "animate-spin" : undefined} />
            </Button>
          </div>
        </header>

        {worktreeQuery.error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {formatError(worktreeQuery.error)}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <aside className="flex min-h-0 w-[22rem] shrink-0 flex-col border-r border-border bg-background">
            <div className="shrink-0 border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold uppercase text-muted-foreground">
                    Current working tree
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">
                    {worktreeFiles.length} changed {worktreeFiles.length === 1 ? "file" : "files"}
                  </div>
                </div>
                <Badge size="sm" variant="outline">
                  +{insertionCount} -{deletionCount}
                </Badge>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {worktreeQuery.isLoading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading changes...</div>
              ) : worktreeFiles.length > 0 ? (
                <div className="divide-y divide-border">
                  {worktreeFiles.map((file) => {
                    const selected = selectedFile?.path === file.path;
                    return (
                      <button
                        key={`${file.previousPath ?? ""}:${file.path}`}
                        aria-pressed={selected}
                        className={[
                          "flex h-16 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors",
                          selected ? "bg-accent text-foreground" : "hover:bg-accent/50",
                        ].join(" ")}
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{file.path}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {file.previousPath ?? statusText(file)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                          +{file.insertions} -{file.deletions}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  No tracked working tree changes.
                </div>
              )}
            </div>
          </aside>

          <MockDiffWorkbench />
        </div>
      </div>
    </SidebarInset>
  );
}

function MockDiffWorkbench() {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-muted/10">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompareIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              Working tree - feat/local-diff - stage hunks into this diff
            </div>
            <div className="truncate text-xs text-muted-foreground">
              src/components/chat/MessageComposer.tsx
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+7</span>
          <span className="tabular-nums text-rose-600 dark:text-rose-400">-2</span>
          <Button size="sm" variant="outline">
            Stage file
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="min-w-[54rem] overflow-hidden rounded-md border border-border bg-background">
          <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-sm">
                src/components/chat/MessageComposer.tsx
              </span>
              <Badge size="sm" variant="secondary">
                modified
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+7</span>
              <span className="tabular-nums text-rose-600 dark:text-rose-400">-2</span>
              <Button size="sm" variant="ghost">
                Stage hunk
              </Button>
              <Button size="sm" variant="ghost">
                Discard
              </Button>
            </div>
          </div>

          {MOCK_DIFF_HUNKS.map((hunk) => (
            <section key={hunk.id} className="border-b border-border last:border-b-0">
              <div className="flex h-9 items-center gap-3 bg-muted/30 px-3 font-mono text-xs text-muted-foreground">
                <span>Expand</span>
                <span>{hunk.header}</span>
              </div>
              <div className="font-mono text-xs">
                {hunk.rows.map((row) => (
                  <DiffRow
                    key={`${hunk.id}:${row.left}:${row.right}:${row.kind}:${row.text}`}
                    row={row}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function DiffRow(props: {
  readonly row: {
    readonly left: string;
    readonly right: string;
    readonly kind: "add" | "del" | "ctx";
    readonly text: string;
  };
}) {
  const rowClass =
    props.row.kind === "add"
      ? "bg-emerald-500/10"
      : props.row.kind === "del"
        ? "bg-rose-500/10"
        : "bg-background";
  const marker = props.row.kind === "add" ? "+" : props.row.kind === "del" ? "-" : " ";

  return (
    <div className={`grid min-h-7 grid-cols-[4rem_4rem_2rem_minmax(0,1fr)] ${rowClass}`}>
      <div className="border-r border-border px-2 py-1 text-right tabular-nums text-muted-foreground">
        {props.row.left}
      </div>
      <div className="border-r border-border px-2 py-1 text-right tabular-nums text-muted-foreground">
        {props.row.right}
      </div>
      <div className="px-2 py-1 text-muted-foreground">{marker}</div>
      <pre className="min-w-0 overflow-hidden text-ellipsis whitespace-pre px-2 py-1 text-foreground">
        {props.row.text || " "}
      </pre>
    </div>
  );
}
