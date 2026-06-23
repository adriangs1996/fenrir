import { ArchiveIcon, ArchiveX, FolderArchiveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectId, ScopedThreadRef } from "@fenrir/contracts";
import { scopeThreadRef } from "@fenrir/client-runtime";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { runLocalRpc } from "../../hooks/useRpc";
import { useShallow } from "zustand/react/shallow";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { formatRelativeTimeLabel } from "../../lib/formatting";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  useInternalPlanRunnerThreadIds,
  usePlanRunnerStore,
  type ArchivedFeatureSummary,
} from "~/modules/plan-runner";
import { useInternalWorkflowThreadIds } from "~/modules/workflows";
import { isUserBrowsableThread } from "~/threadVisibility";

export function ArchivedThreadsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  // Internal plan-runner threads are persisted but never user-browsable —
  // hide them from the archive panel even if archivedAt is non-null.
  const internalPlanRunnerThreadIds = useInternalPlanRunnerThreadIds();
  const internalWorkflowThreadIds = useInternalWorkflowThreadIds();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archivedThreadsError,
    isLoading: archivedThreadsLoading,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);
  const archivedGroups = useMemo(() => {
    const projectByKey = new Map<string, (typeof projects)[number]>(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
    );
    const threadsByProjectKey = new Map<
      string,
      Array<
        (typeof archivedSnapshots)[number]["snapshot"]["threads"][number] & {
          readonly environmentId: (typeof archivedSnapshots)[number]["environmentId"];
        }
      >
    >();

    for (const entry of archivedSnapshots) {
      for (const project of entry.snapshot.projects) {
        const key = `${entry.environmentId}:${project.id}`;
        if (projectByKey.has(key)) {
          continue;
        }
        projectByKey.set(key, {
          id: project.id,
          environmentId: entry.environmentId,
          name: project.title,
          cwd: project.workspaceRoot,
          repositoryIdentity: project.repositoryIdentity ?? null,
          defaultModelSelection: project.defaultModelSelection,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          scripts: [...project.scripts],
          managedProcesses: [...(project.managedProcesses ?? [])],
          globalScriptDefaults: [...(project.globalScriptDefaults ?? [])],
        });
      }

      for (const thread of entry.snapshot.threads) {
        if (
          !isUserBrowsableThread(thread) ||
          internalPlanRunnerThreadIds.has(thread.id) ||
          internalWorkflowThreadIds.has(thread.id)
        ) {
          continue;
        }
        const key = `${entry.environmentId}:${thread.projectId}`;
        const projectThreads = threadsByProjectKey.get(key) ?? [];
        projectThreads.push({
          ...thread,
          environmentId: entry.environmentId,
        });
        threadsByProjectKey.set(key, projectThreads);
      }
    }

    return [...projectByKey.entries()]
      .map(([key, project]) => ({
        project,
        threads: [...(threadsByProjectKey.get(key) ?? [])].toSorted((left, right) => {
          const leftKey = left.archivedAt ?? left.createdAt;
          const rightKey = right.archivedAt ?? right.createdAt;
          return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
        }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [archivedSnapshots, internalPlanRunnerThreadIds, internalWorkflowThreadIds, projects]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const clicked = await runLocalRpc((api) =>
        api.contextMenu.show(
          [
            { id: "unarchive", label: "Unarchive" },
            { id: "delete", label: "Delete", destructive: true },
          ],
          position,
        ),
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadRef);
      }
    },
    [confirmAndDeleteThread, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedThreadsError ? (
        <SettingsSection title="Archived threads">
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
            <p className="text-sm text-destructive">{archivedThreadsError}</p>
            <Button type="button" size="sm" variant="outline" onClick={refreshArchivedThreads}>
              Retry
            </Button>
          </div>
        </SettingsSection>
      ) : null}
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <ArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived threads</EmptyTitle>
              <EmptyDescription>
                {archivedThreadsLoading
                  ? "Loading archived threads..."
                  : "Archived threads will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(
                    scopeThreadRef(thread.environmentId, thread.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" · Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                  onClick={() =>
                    void unarchiveThread(scopeThreadRef(thread.environmentId, thread.id)).catch(
                      (error) => {
                        toastManager.add({
                          type: "error",
                          title: "Failed to unarchive thread",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        });
                      },
                    )
                  }
                >
                  <ArchiveX className="size-3.5" />
                  <span>Unarchive</span>
                </Button>
              </div>
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}

// ── Archived Plans Panel ──────────────────────────────────────────────────

function ArchivedFeatureRow({
  feature,
  onUnarchive,
}: {
  feature: ArchivedFeatureSummary;
  onUnarchive: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useRelativeTimeTick();

  const handleUnarchive = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnarchive();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unarchive failed.";
      if (/already exists/i.test(msg)) {
        setError(
          `A feature named "${feature.featureName}" already exists. Rename or delete the existing .plans/${feature.featureName}/ folder, then retry.`,
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{feature.featureName}</h3>
          <p className="text-xs text-muted-foreground">
            {feature.planCount} {feature.planCount === 1 ? "plan" : "plans"}
            {" · Archived "}
            {formatRelativeTimeLabel(feature.archivedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
          disabled={busy}
          onClick={() => void handleUnarchive()}
        >
          <ArchiveX className="size-3.5" />
          <span>Unarchive</span>
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ArchivedPlansPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const archivedByProject = usePlanRunnerStore((s) => s.archivedFeaturesByProjectId);

  useEffect(() => {
    void usePlanRunnerStore.getState().fetchArchivedFeatures();
  }, []);

  const archivedGroups = useMemo(() => {
    return projects
      .map((project) => {
        const features = archivedByProject[project.id] ?? [];
        return {
          project,
          features: features.toSorted((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
        };
      })
      .filter((group) => group.features.length > 0);
  }, [projects, archivedByProject]);

  const handleUnarchive = useCallback(async (projectId: ProjectId, archivedDirName: string) => {
    await usePlanRunnerStore.getState().unarchiveFeature(projectId, archivedDirName);
  }, []);

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived plans">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <FolderArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived plans</EmptyTitle>
              <EmptyDescription>Archived plans will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, features }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {features.map((feature) => (
              <ArchivedFeatureRow
                key={feature.archivedDirName}
                feature={feature}
                onUnarchive={() => handleUnarchive(project.id, feature.archivedDirName)}
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
