import type { EnvironmentId, ManagedProcessImportProposal, ProjectId } from "@fenrir/contracts";
import { DownloadIcon, LoaderIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { withEnvironmentClient } from "~/environments/runtime";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Switch } from "../ui/switch";

// ---------------------------------------------------------------------------
// Proposal row in the import dialog
// ---------------------------------------------------------------------------

function ProposalRow({
  proposal,
  checked,
  onToggle,
}: {
  proposal: ManagedProcessImportProposal;
  checked: boolean;
  onToggle: () => void;
}) {
  const hasConflict = proposal.conflictsWithDefId !== null;
  return (
    <label className="flex items-start gap-3 rounded-md border border-border/70 px-3 py-2.5 text-sm cursor-pointer hover:bg-accent/30">
      <Switch checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium truncate">{proposal.suggestedDefinition.name}</p>
        <p className="text-xs text-muted-foreground truncate font-mono">
          {proposal.suggestedDefinition.command}
        </p>
        <p className="text-[10px] text-muted-foreground/70">{proposal.sourceLabel}</p>
        {hasConflict && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Will overwrite existing definition "{proposal.conflictsWithDefId}"
          </p>
        )}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Import button + dialog flow
// ---------------------------------------------------------------------------

export function ImportFromPortlessButton({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<ManagedProcessImportProposal[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [emptyAlertOpen, setEmptyAlertOpen] = useState(false);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withEnvironmentClient(environmentId, (client) =>
        client.managedProcess.proposedImports({ projectId }),
      );
      if (result.length === 0) {
        setEmptyAlertOpen(true);
        return;
      }
      // Default: check all non-conflicting
      const defaultSelected = new Set<number>();
      result.forEach((p, i) => {
        if (p.conflictsWithDefId === null) defaultSelected.add(i);
      });
      setSelected(defaultSelected);
      setProposals([...result]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch import proposals.");
    } finally {
      setLoading(false);
    }
  }, [environmentId, projectId]);

  const toggleProposal = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!proposals) return;
    setImporting(true);
    setError(null);
    try {
      const toImport = proposals.filter((_, i) => selected.has(i));
      for (const proposal of toImport) {
        await withEnvironmentClient(environmentId, (client) =>
          client.managedProcess.upsertDefinition({
            projectId,
            definition: proposal.suggestedDefinition,
          }),
        );
      }
      setProposals(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import.");
    } finally {
      setImporting(false);
    }
  }, [proposals, selected, environmentId, projectId]);

  const closeDialog = useCallback(() => {
    setProposals(null);
    setError(null);
  }, []);

  return (
    <>
      <Button size="xs" variant="outline" onClick={fetchProposals} disabled={loading}>
        {loading ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="size-3.5" />
        )}
        Import
      </Button>

      {/* Empty state alert */}
      <AlertDialog open={emptyAlertOpen} onOpenChange={setEmptyAlertOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>No imports found</AlertDialogTitle>
            <AlertDialogDescription>
              No portless.json, package.json#portless, or common dev scripts were found in the
              workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>OK</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Import proposals dialog */}
      <Dialog open={proposals !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import managed processes</DialogTitle>
            <DialogDescription>Select which process definitions to import.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {proposals?.map((proposal, i) => (
                <ProposalRow
                  key={proposal.suggestedDefinition.id}
                  proposal={proposal}
                  checked={selected.has(i)}
                  onToggle={() => toggleProposal(i)}
                />
              ))}
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing
                ? "Importing..."
                : `Import ${selected.size} process${selected.size === 1 ? "" : "es"}`}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
