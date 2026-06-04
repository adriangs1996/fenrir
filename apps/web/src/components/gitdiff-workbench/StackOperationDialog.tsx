import type { SourceControlStackMutationResult } from "@fenrir/contracts";

interface StackOperationDialogProps {
  readonly result: SourceControlStackMutationResult | null;
}

export function StackOperationDialog({ result }: StackOperationDialogProps) {
  if (!result || result.status === "completed") return null;

  return (
    <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm">
      <span className="font-medium capitalize">{result.status}</span>
      <span className="ml-2 text-muted-foreground">{result.message}</span>
    </div>
  );
}
