import type { ResolvedKeybindingsConfig } from "@fenrir/contracts";
import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  PauseCircleIcon,
  PlayIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { RenderSurface } from "~/components/RenderSurface";
import { Button } from "~/components/ui/button";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";
import { useSettings } from "~/hooks/useSettings";
import { resolveActiveEmbeddedEditor } from "../embeddedEditor";
import { NvimMissingCard } from "./NvimMissingCard";
import { VSCodePane } from "./VSCodePane";
import { cn } from "~/lib/utils";

export interface EditorWorkerItem {
  id: string;
  title: string;
  status: "queued" | "running" | "waiting" | "completed" | "error";
  detail: string | null;
  canInterrupt: boolean;
}

const EMPTY_EDITOR_WORKERS: readonly EditorWorkerItem[] = [];
const EMPTY_PROMPT_CONTEXT_LABELS: readonly string[] = [];

interface Props {
  /**
   * When true, pane is visible. When false, pane is hidden via display:none
   * but stays mounted so canvas state, GL renderer and frame stream stay warm.
   */
  visible: boolean;
  focusRequestId?: number;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen?: boolean;
  cwd: string | null;
  promptOpen?: boolean;
  promptDraft?: string;
  promptContextLabels?: readonly string[];
  workers?: readonly EditorWorkerItem[];
  onPromptDraftChange?: ((value: string) => void) | undefined;
  onPromptCancel?: (() => void) | undefined;
  onPromptSubmit?: (() => void) | undefined;
  onWorkerInterrupt?: ((workerId: string) => void) | undefined;
  onWorkerDismiss?: ((workerId: string) => void) | undefined;
}

/**
 * Renderer-side container around `RenderSurface` for the chat tab. Owns
 * availability gating (bridge present, main window, nvim binary) and the
 * mount-and-hide visibility lifecycle.
 *
 * cwd push is handled at the app shell via `useEditorCwdSync` — this pane
 * only renders the surface.
 */
export function EditorPane({
  visible,
  focusRequestId = 0,
  keybindings,
  terminalOpen = false,
  cwd,
  promptOpen = false,
  promptDraft = "",
  promptContextLabels = EMPTY_PROMPT_CONTEXT_LABELS,
  workers = EMPTY_EDITOR_WORKERS,
  onPromptDraftChange,
  onPromptCancel,
  onPromptSubmit,
  onWorkerInterrupt,
  onWorkerDismiss,
}: Props) {
  const bridge = useDesktopBridgeAvailable();
  const main = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const preferredEmbeddedEditor = useSettings((state) => state.embeddedEditor);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!bridge) return;
    const probe = window.desktopBridge?.nvimProbeDetail;
    if (!probe) return;
    let cancelled = false;
    void probe().then((d) => {
      if (cancelled) return;
      setProbeError(d.available ? null : d.error);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, retryToken]);

  if (!bridge || !main) {
    // Defensive null — the titlebar workspace switch gates editor visibility on
    // these conditions, so this branch should be unreachable in practice.
    return null;
  }

  if (!nvimReady && !vscodeReady) {
    return (
      <div
        className="min-h-0 flex-1"
        style={{ display: visible ? "flex" : "none" }}
        data-testid="editor-pane-missing"
      >
        <NvimMissingCard errorDetail={probeError} onRetry={() => setRetryToken((n) => n + 1)} />
      </div>
    );
  }

  const selectedEditor = resolveActiveEmbeddedEditor({
    preferredEditor: preferredEmbeddedEditor,
    nvimReady,
    vscodeReady,
  });

  return (
    <div
      className="relative min-h-0 flex-1 flex-col"
      style={{ display: visible ? "flex" : "none" }}
      data-testid="editor-pane"
    >
      {selectedEditor === "neovim" ? (
        <div className="min-h-0 flex-1">
          <RenderSurface
            fps={60}
            keybindings={keybindings}
            terminalOpen={terminalOpen}
            visible={visible}
            focusRequestId={focusRequestId}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      ) : (
        <VSCodePane
          cwd={cwd}
          focusRequestId={focusRequestId}
          keybindings={keybindings}
          terminalOpen={terminalOpen}
          visible={visible}
        />
      )}
      <EditorPromptWorkersOverlay
        promptOpen={promptOpen}
        promptDraft={promptDraft}
        promptContextLabels={promptContextLabels}
        workers={workers}
        onPromptDraftChange={onPromptDraftChange}
        onPromptCancel={onPromptCancel}
        onPromptSubmit={onPromptSubmit}
        onWorkerInterrupt={onWorkerInterrupt}
        onWorkerDismiss={onWorkerDismiss}
      />
    </div>
  );
}

export function EditorPromptWorkersOverlay({
  promptOpen,
  promptDraft,
  promptContextLabels,
  workers,
  onPromptDraftChange,
  onPromptCancel,
  onPromptSubmit,
  onWorkerInterrupt,
  onWorkerDismiss,
}: {
  promptOpen: boolean;
  promptDraft: string;
  promptContextLabels: readonly string[];
  workers: readonly EditorWorkerItem[];
  onPromptDraftChange?: ((value: string) => void) | undefined;
  onPromptCancel?: (() => void) | undefined;
  onPromptSubmit?: (() => void) | undefined;
  onWorkerInterrupt?: ((workerId: string) => void) | undefined;
  onWorkerDismiss?: ((workerId: string) => void) | undefined;
}) {
  if (!promptOpen && workers.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-end gap-3">
      <div className="pointer-events-auto flex w-full max-w-[420px] flex-col gap-2">
        {promptOpen ? (
          <form
            className="rounded-md border border-border/80 bg-background/95 p-2 shadow-xl backdrop-blur"
            onSubmit={(event) => {
              event.preventDefault();
              onPromptSubmit?.();
            }}
          >
            {promptContextLabels.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {promptContextLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border bg-muted/50 px-2 py-1 text-muted-foreground text-xs"
                  >
                    <FileTextIcon className="size-3 shrink-0" />
                    <span className="truncate">{label}</span>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              autoFocus
              value={promptDraft}
              onChange={(event) => onPromptDraftChange?.(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onPromptCancel?.();
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  onPromptSubmit?.();
                }
              }}
              placeholder="Run prompt"
              className="max-h-44 min-h-24 w-full resize-y rounded border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onPromptCancel}>
                <XIcon className="size-3.5" />
                <span>Cancel</span>
              </Button>
              <Button type="submit" size="sm" disabled={promptDraft.trim().length === 0}>
                <PlayIcon className="size-3.5" />
                <span>Run</span>
              </Button>
            </div>
          </form>
        ) : null}

        {workers.length > 0 ? (
          <div className="rounded-md border border-border/80 bg-background/95 p-1.5 shadow-xl backdrop-blur">
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {workers.map((worker) => (
                <EditorWorkerRow
                  key={worker.id}
                  worker={worker}
                  onInterrupt={onWorkerInterrupt}
                  onDismiss={onWorkerDismiss}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditorWorkerRow({
  worker,
  onInterrupt,
  onDismiss,
}: {
  worker: EditorWorkerItem;
  onInterrupt?: ((workerId: string) => void) | undefined;
  onDismiss?: ((workerId: string) => void) | undefined;
}) {
  const StatusIcon =
    worker.status === "completed"
      ? CheckCircle2Icon
      : worker.status === "waiting"
        ? PauseCircleIcon
        : worker.status === "error"
          ? XIcon
          : Loader2Icon;

  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/60">
      <StatusIcon
        className={cn(
          "size-3.5 shrink-0",
          worker.status === "running" || worker.status === "queued" ? "animate-spin" : "",
          worker.status === "error" ? "text-destructive" : "text-muted-foreground",
          worker.status === "completed" ? "text-primary" : "",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{worker.title}</div>
        {worker.detail ? (
          <div className="truncate text-[11px] text-muted-foreground">{worker.detail}</div>
        ) : null}
      </div>
      {worker.canInterrupt ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title="Interrupt"
          onClick={() => onInterrupt?.(worker.id)}
        >
          <SquareIcon className="size-3.5" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title="Dismiss"
          onClick={() => onDismiss?.(worker.id)}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
