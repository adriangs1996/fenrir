interface Props {
  errorDetail: string | null;
  onRetry: () => void;
}

/**
 * Static informational card shown when the embedded nvim binary is missing.
 * Surfaces a platform-aware install hint plus a manual retry button.
 */
export function NvimMissingCard({ errorDetail, onRetry }: Props) {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toUpperCase() : "";
  const installHint = platform.includes("MAC")
    ? "brew install neovim"
    : platform.includes("WIN")
      ? "winget install Neovim.Neovim"
      : "Install neovim via your package manager (apt, dnf, pacman, etc.)";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="font-semibold text-lg">Neovim not found</h2>
      <p className="text-muted-foreground">
        Fenrir's embedded editor requires the <code>nvim</code> binary on your PATH.
      </p>
      <pre className="rounded bg-muted px-3 py-2 text-sm">{installHint}</pre>
      {errorDetail && <p className="text-muted-foreground text-xs">Probe error: {errorDetail}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
      >
        Retry probe
      </button>
    </div>
  );
}
