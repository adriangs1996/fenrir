interface Props {
  errorDetail?: string | null;
  onRetry?: () => void;
}

export function VSCodeMissingCard({ errorDetail, onRetry }: Props) {
  const installHint =
    typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")
      ? "brew install code-server"
      : "Install code-server or openvscode-server and make sure the command is on PATH.";

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-md border border-border bg-card p-4 shadow-sm">
        <h2 className="font-semibold text-card-foreground text-sm">Embedded VS Code unavailable</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Fenrir's embedded VS Code mode requires <code>code-server</code> or{" "}
          <code>openvscode-server</code> on your PATH.
        </p>
        <p className="mt-3 rounded-sm bg-muted px-2 py-1.5 font-mono text-muted-foreground text-xs">
          {installHint}
        </p>
        {errorDetail ? (
          <p className="mt-3 break-words text-destructive text-xs">{errorDetail}</p>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-sm border border-border px-2.5 py-1 text-xs hover:bg-accent"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
