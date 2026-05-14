import type { EnvironmentId, ManagedProcess, ProjectId } from "@fenrir/contracts";
import {
  BugIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import type { ProjectScriptIcon } from "@fenrir/contracts";
import { useShallow } from "zustand/react/shallow";
import { selectManagedProcessDefinitions, useStore } from "~/store";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ImportFromPortlessButton } from "./ImportFromPortlessButton";
import { ManagedProcessForm } from "./ManagedProcessForm";

// ---------------------------------------------------------------------------
// Icon helper (mirrors ProjectScriptsControl)
// ---------------------------------------------------------------------------

function ProcessIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

// ---------------------------------------------------------------------------
// Row for a single definition
// ---------------------------------------------------------------------------

function DefinitionRow({ definition, onEdit }: { definition: ManagedProcess; onEdit: () => void }) {
  return (
    <div className="group flex items-center gap-3 border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5">
      <ProcessIcon icon={definition.icon} className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground truncate">{definition.name}</p>
        <p className="text-xs text-muted-foreground truncate font-mono">{definition.command}</p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
        {definition.scope === "project" && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wider">
            project
          </span>
        )}
        {definition.proxy && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wider">
            portless
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Edit ${definition.name}`}
        onClick={onEdit}
      >
        <PencilIcon className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function ManagedProcessSettingsEditor({
  projectId,
  environmentId,
  hideHeading = false,
}: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  hideHeading?: boolean;
}) {
  const definitions = useStore(
    useShallow((s) => selectManagedProcessDefinitions(s, environmentId, projectId)),
  );

  const [editing, setEditing] = useState<ManagedProcess | null>(null);
  const [creating, setCreating] = useState(false);

  const existingIds = useCallback(() => definitions.map((d) => d.id), [definitions]);

  return (
    <section className="space-y-2.5">
      <div
        className={cn("flex items-center px-1", hideHeading ? "justify-end" : "justify-between")}
      >
        {!hideHeading && (
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/50">
            <span className="inline-block h-px w-3 bg-border" aria-hidden />
            Managed Processes
          </h2>
        )}
        <div className="flex items-center gap-2">
          <ImportFromPortlessButton environmentId={environmentId} projectId={projectId} />
          <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm/4 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:shadow-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {definitions.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No managed processes defined. Add one or import from portless / package.json.
          </div>
        ) : (
          definitions.map((def) => (
            <DefinitionRow key={def.id} definition={def} onEdit={() => setEditing(def)} />
          ))
        )}
      </div>

      {creating && (
        <ManagedProcessForm
          environmentId={environmentId}
          projectId={projectId}
          mode="create"
          existingIds={existingIds()}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <ManagedProcessForm
          environmentId={environmentId}
          projectId={projectId}
          mode="edit"
          initial={editing}
          existingIds={existingIds()}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
