import type {
  EnvironmentId,
  ManagedProcess,
  ManagedProcessInstance,
  ProjectId,
  ScopedProjectRef,
} from "@fenrir/contracts";
import { useMemo } from "react";

import { useStore } from "~/store";
import {
  createManagedProcessDefinitionsSelector,
  createManagedProcessInstancesSelector,
} from "~/storeSelectors";
import { ManagedProcessChip } from "./ManagedProcessChip";

// ---------- Instance lookup ----------

function findInstance(
  instances: readonly ManagedProcessInstance[],
  def: ManagedProcess,
  currentWorktreePath: string | null,
): ManagedProcessInstance | null {
  if (def.scope === "project") {
    return instances.find((i) => i.processDefId === def.id && i.worktreePath === null) ?? null;
  }
  return (
    instances.find(
      (i) => i.processDefId === def.id && (i.worktreePath ?? null) === currentWorktreePath,
    ) ?? null
  );
}

// ---------- Status bar ----------

export interface ManagedProcessStatusBarProps {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  currentWorktreePath: string | null;
}

export function ManagedProcessStatusBar({
  projectId,
  environmentId,
  currentWorktreePath,
}: ManagedProcessStatusBarProps) {
  const projectRef: ScopedProjectRef = useMemo(
    () => ({ environmentId, projectId }),
    [environmentId, projectId],
  );

  const definitions = useStore(
    useMemo(() => createManagedProcessDefinitionsSelector(projectRef), [projectRef]),
  );
  const instances = useStore(
    useMemo(() => createManagedProcessInstancesSelector(projectRef), [projectRef]),
  );

  if (definitions.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Managed processes"
      className="flex h-9 max-h-9 shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-t border-border/50 px-3 scrollbar-none sm:px-5 @container"
    >
      {definitions.map((def) => {
        const instance = findInstance(instances, def, currentWorktreePath);
        return (
          <ManagedProcessChip
            key={def.id}
            definition={def}
            instance={instance}
            projectId={projectId}
            environmentId={environmentId}
            currentWorktreePath={currentWorktreePath}
            onOpenLogs={() => {
              // Drawer integration (plan 10) — no-op until the log drawer exists.
            }}
          />
        );
      })}
    </div>
  );
}
