import type { EnvironmentId, ProjectEntry, ProjectReadFileResult } from "@fenrir/contracts";
import { Code2Icon, EyeIcon, FileTextIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { readEnvironmentApi } from "~/environmentApi";
import { cn } from "~/lib/utils";

export const PROJECT_FILE_PREVIEW_MAX_BYTES = 1024 * 1024;

export interface ProjectFilePreviewRequest {
  readonly id: number;
  readonly entry: ProjectEntry;
}

type ProjectFilePreviewKind = "html" | "markdown" | "source";
type ProjectFilePreviewMode = "preview" | "source";

type ProjectFilePreviewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly result: ProjectReadFileResult }
  | { readonly status: "error"; readonly message: string };

const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdown", "mdx", "mkd"]);
const HTML_EXTENSIONS = new Set(["htm", "html"]);

export function ProjectFilePreviewDialog({
  environmentId,
  onAddToComposer,
  onClose,
  onOpenFile,
  request,
  workspaceRoot,
}: {
  readonly environmentId: EnvironmentId;
  readonly onAddToComposer: (
    entry: ProjectEntry,
    result: ProjectReadFileResult,
  ) => void | Promise<void>;
  readonly onClose: () => void;
  readonly onOpenFile: (entry: ProjectEntry) => void | Promise<void>;
  readonly request: ProjectFilePreviewRequest | null;
  readonly workspaceRoot: string;
}) {
  const [previewState, setPreviewState] = useState<ProjectFilePreviewState>({
    status: "loading",
  });
  const [mode, setMode] = useState<ProjectFilePreviewMode>("source");
  const previewKind = useMemo(
    () => getProjectFilePreviewKind(request?.entry.path ?? ""),
    [request?.entry.path],
  );
  const canRenderPreview = previewKind === "html" || previewKind === "markdown";

  useEffect(() => {
    if (!request) {
      return;
    }

    let cancelled = false;
    const nextMode: ProjectFilePreviewMode =
      getProjectFilePreviewKind(request.entry.path) === "source" ? "source" : "preview";
    setMode(nextMode);
    setPreviewState({ status: "loading" });

    const loadPreview = async () => {
      try {
        const api = readEnvironmentApi(environmentId);
        if (!api) {
          throw new Error("Project API unavailable.");
        }
        const result = await api.projects.readFile({
          cwd: workspaceRoot,
          relativePath: request.entry.path,
          maxBytes: PROJECT_FILE_PREVIEW_MAX_BYTES,
        });
        if (!cancelled) {
          setPreviewState({ status: "ready", result });
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to preview file.",
          });
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [environmentId, request, workspaceRoot]);

  if (!request) {
    return null;
  }

  const readyResult = previewState.status === "ready" ? previewState.result : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-h-[min(86vh,820px)] max-w-[min(94vw,980px)]">
        <DialogHeader className="gap-1.5 pr-12">
          <DialogTitle className="text-base">Preview</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {request.entry.path}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {canRenderPreview ? (
            <ProjectFilePreviewModeSwitch mode={mode} onModeChange={setMode} />
          ) : null}

          {readyResult?.truncated ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                Showing first {formatBytes(PROJECT_FILE_PREVIEW_MAX_BYTES)} of{" "}
                {formatBytes(readyResult.byteLength)}.
              </span>
            </div>
          ) : null}

          {previewState.status === "loading" ? (
            <ProjectFilePreviewMessage icon={<Spinner className="size-4" />} label="Loading file" />
          ) : null}

          {previewState.status === "error" ? (
            <ProjectFilePreviewMessage
              icon={<TriangleAlertIcon className="size-4" />}
              label="Preview unavailable"
              detail={previewState.message}
            />
          ) : null}

          {readyResult ? (
            <ProjectFilePreviewContent
              contents={readyResult.contents}
              kind={previewKind}
              mode={mode}
              path={request.entry.path}
              workspaceRoot={workspaceRoot}
            />
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="outline" onClick={() => void onOpenFile(request.entry)}>
            Open
          </Button>
          <Button
            type="button"
            disabled={!readyResult}
            onClick={() => readyResult && void onAddToComposer(request.entry, readyResult)}
          >
            Add to composer
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ProjectFilePreviewModeSwitch({
  mode,
  onModeChange,
}: {
  readonly mode: ProjectFilePreviewMode;
  readonly onModeChange: (mode: ProjectFilePreviewMode) => void;
}) {
  return (
    <div className="inline-flex h-8 w-fit items-center rounded-md border bg-muted/40 p-0.5">
      <ProjectFilePreviewModeButton
        active={mode === "preview"}
        icon={<EyeIcon />}
        label="Preview"
        onClick={() => onModeChange("preview")}
      />
      <ProjectFilePreviewModeButton
        active={mode === "source"}
        icon={<Code2Icon />}
        label="Source"
        onClick={() => onModeChange("source")}
      />
    </div>
  );
}

function ProjectFilePreviewModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
        active && "bg-background text-foreground shadow-sm",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ProjectFilePreviewContent({
  contents,
  kind,
  mode,
  path,
  workspaceRoot,
}: {
  readonly contents: string;
  readonly kind: ProjectFilePreviewKind;
  readonly mode: ProjectFilePreviewMode;
  readonly path: string;
  readonly workspaceRoot: string;
}) {
  if (mode === "preview" && kind === "markdown") {
    return (
      <div className="min-h-80 rounded-md border bg-background px-4 py-3">
        <ChatMarkdown text={contents} cwd={workspaceRoot} />
      </div>
    );
  }

  if (mode === "preview" && kind === "html") {
    return (
      <iframe
        title={`${path} preview`}
        sandbox=""
        srcDoc={contents}
        className="h-[min(58vh,560px)] min-h-80 w-full rounded-md border bg-background"
      />
    );
  }

  return <ProjectFileSourcePreview contents={contents} />;
}

function ProjectFileSourcePreview({ contents }: { readonly contents: string }) {
  if (contents.length === 0) {
    return (
      <ProjectFilePreviewMessage icon={<FileTextIcon className="size-4" />} label="Empty file" />
    );
  }

  return (
    <pre className="h-[min(58vh,560px)] min-h-80 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground">
      <code>{contents}</code>
    </pre>
  );
}

function ProjectFilePreviewMessage({
  detail,
  icon,
  label,
}: {
  readonly detail?: string;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
      <div className="flex max-w-md flex-col items-center gap-2">
        {icon}
        <span className="font-medium text-foreground">{label}</span>
        {detail ? <span className="text-xs">{detail}</span> : null}
      </div>
    </div>
  );
}

function getProjectFilePreviewKind(path: string): ProjectFilePreviewKind {
  const extension = path.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return "html";
  }
  return "source";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}
