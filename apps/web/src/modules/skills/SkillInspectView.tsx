import type {
  ResolveSkillConflictInput,
  ServerProviderSkill,
  ServerSkillDetails,
  SkillProviderSync,
} from "@fenrir/contracts";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderIcon,
  RefreshCwIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "~/editorPreferences";
import { toastManager } from "~/components/ui/toast";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { useSkills, useSkillActions } from "~/hooks/useSkills";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { SkillActionsMenu } from "./SkillActionsMenu";
import { openCanonicalSkillFileInEditor } from "./skillFiles";
import { providerLabel, SkillSyncBadge } from "./SkillSyncBadge";
import {
  buildSkillFileTree,
  toSkillTreeScopeKey,
  type SkillFileTreeFileNode,
  type SkillFileTreeNode,
  type SkillTreeScopeRollup,
} from "./skillInspectTree";
import { useSkillPanelStore } from "./stores/skillPanelStore";

interface SkillInspectViewProps {
  skillName: string;
  onInsert: (skillName: string) => void;
}

const IDLE_DETAIL_STATE = { status: "idle" as const };

export function SkillInspectView({ skillName, onInsert }: SkillInspectViewProps) {
  const skills = useSkills();
  const {
    detailStateBySkillName,
    goBack,
    markDetailLoading,
    setView,
    setSkillDetails,
    setSkillDetailError,
    invalidateSkillDetails,
  } = useSkillPanelStore();
  const { getDetails, resolveConflict, update, delete: deleteSkill } = useSkillActions();
  const { close } = useRightPanelStore();

  const detailState = detailStateBySkillName[skillName] ?? IDLE_DETAIL_STATE;
  const listSkill = skills.find((skill) => skill.name === skillName) ?? null;
  const detailSkill = detailState.status === "loaded" ? detailState.details.skill : null;
  const skill = listSkill ?? detailSkill;
  const loadedDetails = detailState.status === "loaded" ? detailState.details : null;

  const loadDetails = useCallback(
    async (force = false): Promise<ServerSkillDetails | undefined> => {
      if (!force && loadedDetails) {
        return loadedDetails;
      }
      if (!force && detailState.status === "loading") {
        return undefined;
      }

      markDetailLoading(skillName);
      try {
        const details = await getDetails(skillName);
        setSkillDetails(skillName, details);
        return details;
      } catch (error) {
        setSkillDetailError(
          skillName,
          error instanceof Error ? error.message : "Unable to load skill details.",
        );
        return undefined;
      }
    },
    [
      detailState.status,
      getDetails,
      loadedDetails,
      markDetailLoading,
      setSkillDetailError,
      setSkillDetails,
      skillName,
    ],
  );

  useEffect(() => {
    if (detailState.status === "idle") {
      void loadDetails();
    }
  }, [detailState.status, loadDetails]);

  const handleRefresh = useCallback(() => {
    invalidateSkillDetails(skillName);
    void loadDetails(true);
  }, [invalidateSkillDetails, loadDetails, skillName]);

  const [pendingProvider, setPendingProvider] = useState<SkillProviderSync["provider"] | null>(
    null,
  );

  const handleResolveConflict = useCallback(
    async (
      provider: SkillProviderSync["provider"],
      resolution: ResolveSkillConflictInput["resolution"],
    ) => {
      setPendingProvider(provider);
      try {
        await resolveConflict({ name: skillName, provider, resolution });
        invalidateSkillDetails(skillName);
        await loadDetails(true);
        toastManager.add({
          type: "success",
          title:
            resolution === "keep-fenrir"
              ? `${providerLabel(provider)} synced from Fenrir`
              : `${providerLabel(provider)} version accepted`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to resolve provider sync",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        setPendingProvider(null);
      }
    },
    [invalidateSkillDetails, loadDetails, resolveConflict, skillName],
  );

  const handleOpenFile = useCallback((targetPath: string) => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    void openInPreferredEditor(api, targetPath).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open file",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleOpenCanonicalFile = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    try {
      const details = loadedDetails ?? (await loadDetails(true));
      if (!details) {
        throw new Error("Unable to resolve canonical skill.md.");
      }
      await openCanonicalSkillFileInEditor(api, details);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to open skill.md",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [loadDetails, loadedDetails]);

  const handleToggleEnabled = useCallback(async () => {
    if (!skill) return;

    try {
      await update({ name: skill.name, enabled: !skill.enabled });
      toastManager.add({
        type: "success",
        title: skill.enabled ? `/${skill.name} disabled` : `/${skill.name} enabled`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to update skill",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [skill, update]);

  const handleDelete = useCallback(async () => {
    if (!skill) return;

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Delete is unavailable right now",
      });
      return;
    }

    const confirmed = await api.dialogs.confirm(`Delete /${skill.name}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteSkill(skill.name);
      goBack();
      toastManager.add({
        type: "success",
        title: `/${skill.name} deleted`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to delete skill",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [deleteSkill, goBack, skill]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={goBack}
          className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="flex-1 truncate text-sm font-medium text-foreground">/{skillName}</span>
        <Button variant="outline" size="xs" onClick={() => onInsert(skillName)} className="gap-1">
          Insert
        </Button>
        {skill ? (
          <SkillActionsMenu
            skill={skill}
            onEditMetadata={() => setView({ kind: "edit", skillName })}
            onOpenCanonicalFile={handleOpenCanonicalFile}
            onToggleEnabled={handleToggleEnabled}
            onDelete={handleDelete}
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={detailState.status === "loading"}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Refresh skill details"
        >
          <RefreshCwIcon
            className={cn("size-3.5", detailState.status === "loading" && "animate-spin")}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-3 p-3">
            {skill ? (
              <>
                <SkillMetadataCard
                  skill={skill}
                  fileCount={
                    detailState.status === "loaded" ? detailState.details.files.length : null
                  }
                />
                <SkillSyncStatusCard syncStatus={skill.syncStatus} />
                <SkillConflictActions
                  syncStatus={skill.syncStatus}
                  pendingProvider={pendingProvider}
                  onResolve={handleResolveConflict}
                />
              </>
            ) : (
              <Alert variant="error">
                <AlertCircleIcon />
                <AlertTitle>Skill not found</AlertTitle>
                <AlertDescription>The selected skill is no longer available.</AlertDescription>
              </Alert>
            )}

            {detailState.status === "loading" && (
              <Card>
                <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Loading file tree…
                </CardContent>
              </Card>
            )}

            {detailState.status === "error" && (
              <Alert variant="error">
                <AlertCircleIcon />
                <AlertTitle>Unable to load skill details</AlertTitle>
                <AlertDescription>{detailState.message}</AlertDescription>
              </Alert>
            )}

            {detailState.status === "loaded" && (
              <SkillFileTree details={detailState.details} onOpenFile={handleOpenFile} />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export function SkillMetadataCard({
  skill,
  fileCount,
}: {
  skill: ServerProviderSkill;
  fileCount: number | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="truncate">{skill.displayName}</span>
          <Badge variant={skill.enabled ? "success" : "outline"} size="sm">
            {skill.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardTitle>
        <CardDescription>{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" size="sm">
            /{skill.name}
          </Badge>
          {typeof fileCount === "number" && (
            <Badge variant="outline" size="sm">
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </Badge>
          )}
        </div>
        {skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skill.tags.map((tag) => (
              <Badge key={tag} variant="secondary" size="sm" className="gap-1">
                <TagIcon className="size-3" />
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <div className="font-medium text-foreground">Created</div>
            <div>{formatIsoTimestamp(skill.createdAt)}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">Updated</div>
            <div>{formatIsoTimestamp(skill.updatedAt)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SkillSyncStatusCard({ syncStatus }: { syncStatus: readonly SkillProviderSync[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Sync</CardTitle>
        <CardDescription>
          Fenrir remains canonical. Provider status is shown per mirror.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {syncStatus.length === 0 ? (
          <p className="text-sm text-muted-foreground">No provider mirrors are configured.</p>
        ) : (
          syncStatus.map((sync) => (
            <div
              key={sync.provider}
              className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {providerLabel(sync.provider)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {sync.lastSyncedAt
                    ? `Last synced ${formatIsoTimestamp(sync.lastSyncedAt)}`
                    : "No successful sync recorded"}
                </div>
              </div>
              <SkillSyncBadge syncStatus={[sync]} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SkillConflictActions({
  syncStatus,
  pendingProvider,
  onResolve,
}: {
  syncStatus: readonly SkillProviderSync[];
  pendingProvider: SkillProviderSync["provider"] | null;
  onResolve: (
    provider: SkillProviderSync["provider"],
    resolution: ResolveSkillConflictInput["resolution"],
  ) => void | Promise<void>;
}) {
  const actionable = syncStatus.filter(
    (sync) => sync.state === "conflict" || sync.state === "pending",
  );

  if (actionable.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conflict Actions</CardTitle>
        <CardDescription>
          Resolve provider-specific drift without changing the canonical tree shown below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionable.map((sync) => {
          const isPending = pendingProvider === sync.provider;
          return (
            <div key={sync.provider} className="rounded-xl border border-border/60 px-3 py-3">
              <div className="mb-3">
                <div className="text-sm font-medium text-foreground">
                  {providerLabel(sync.provider)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {sync.state === "conflict"
                    ? "Fenrir and provider contents diverged."
                    : "Fenrir is ahead of the provider mirror."}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isPending}
                  onClick={() => onResolve(sync.provider, "keep-fenrir")}
                >
                  Keep Fenrir
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isPending}
                  onClick={() => onResolve(sync.provider, "accept-external")}
                >
                  Accept External
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function SkillFileTree({
  details,
  onOpenFile,
}: {
  details: ServerSkillDetails;
  onOpenFile: (targetPath: string) => void;
}) {
  const tree = useMemo(() => buildSkillFileTree(details.files), [details.files]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <CardDescription>
          Read-only canonical tree. Open any file in your preferred editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No indexed files were found for this skill.
          </p>
        ) : (
          <div className="space-y-1">
            {tree.map((node) => (
              <SkillFileTreeRow key={node.key} node={node} depth={0} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SkillFileTreeRow({
  node,
  depth,
  onOpenFile,
}: {
  node: SkillFileTreeNode;
  depth: number;
  onOpenFile: (targetPath: string) => void;
}) {
  const paddingLeft = 10 + depth * 16;

  if (node.type === "folder") {
    return (
      <div>
        <div
          className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-foreground"
          style={{ paddingLeft }}
        >
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{node.name}</span>
          <ScopeBadge scope={node.scopeRollup} />
        </div>
        <div className="space-y-1">
          {node.children.map((child) => (
            <SkillFileTreeRow
              key={child.key}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </div>
    );
  }

  return <SkillFileTreeFileRow node={node} depth={depth} onOpenFile={onOpenFile} />;
}

function SkillFileTreeFileRow({
  node,
  depth,
  onOpenFile,
}: {
  node: SkillFileTreeFileNode;
  depth: number;
  onOpenFile: (targetPath: string) => void;
}) {
  const paddingLeft = 10 + depth * 16;

  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.absolutePath)}
      className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      style={{ paddingLeft }}
      title={`Open ${node.relativePath}`}
    >
      {node.executable ? (
        <FileCode2Icon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{node.name}</span>
      <ScopeBadge scope={toSkillTreeScopeKey(node.scope)} />
      <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ScopeBadge({ scope }: { scope: SkillTreeScopeRollup }) {
  if (scope === null) return null;

  const copy =
    scope === "general"
      ? { label: "General", className: "text-muted-foreground" }
      : scope === "codex"
        ? { label: "Codex", className: "text-emerald-600 dark:text-emerald-400" }
        : scope === "claude"
          ? { label: "Claude", className: "text-sky-600 dark:text-sky-400" }
          : { label: "Mixed", className: "text-amber-600 dark:text-amber-400" };

  return (
    <Badge variant="outline" size="sm" className={copy.className}>
      {copy.label}
    </Badge>
  );
}

function formatIsoTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
