import type { EnvironmentId, ProjectId } from "@fenrir/contracts";
import { PlayIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ManagedProcessSettingsEditor } from "./ManagedProcessSettingsEditor";

interface ManagedProcessProjectControlProps {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  projectName: string;
  definitionCount: number;
}

export function ManagedProcessProjectControl({
  projectId,
  environmentId,
  projectName,
  definitionCount,
}: ManagedProcessProjectControlProps) {
  const [open, setOpen] = useState(false);
  const summaryLabel =
    definitionCount === 1 ? "1 managed process" : `${definitionCount} managed processes`;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button size="xs" variant="outline" aria-label={`Manage processes for ${projectName}`} />
        }
      >
        <PlayIcon className="size-3.5" />
        <span>Processes</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {definitionCount}
        </span>
      </DialogTrigger>

      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Managed Processes</DialogTitle>
          <DialogDescription>
            Configure long-running project services for {projectName}. {summaryLabel}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ManagedProcessSettingsEditor
            environmentId={environmentId}
            projectId={projectId}
            hideHeading
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
