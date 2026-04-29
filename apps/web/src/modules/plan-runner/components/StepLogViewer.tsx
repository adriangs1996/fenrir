import {
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  ActivityIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { type PlanRunnerLogEntry, type PlanRunnerLogEntryKind } from "@fenrir/contracts";
import { type TimestampFormat } from "@fenrir/contracts/settings";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { formatTimestamp } from "~/timestampFormat";
import { cn } from "~/lib/utils";

// ─── Kind presentation ───────────────────────────────────────────────────────

interface KindCfg {
  label: string;
  icon: React.ElementType;
  badgeVariant: "info" | "warning" | "success" | "destructive" | "outline" | "secondary";
  /** Tailwind classes layered on top of the badge for a lighter, log-flavored look. */
  badgeClass?: string;
}

const KIND_CFG: Record<PlanRunnerLogEntryKind, KindCfg> = {
  "runner.status": {
    label: "status",
    icon: ActivityIcon,
    badgeVariant: "outline",
  },
  "runner.retry": {
    label: "retry",
    icon: RefreshCwIcon,
    badgeVariant: "warning",
  },
  "runner.recovery": {
    label: "recovery",
    icon: AlertTriangleIcon,
    badgeVariant: "warning",
  },
  prompt: {
    label: "prompt",
    icon: ScrollTextIcon,
    badgeVariant: "secondary",
  },
  assistant: {
    label: "assistant",
    icon: MessageSquareIcon,
    badgeVariant: "info",
  },
  activity: {
    label: "activity",
    icon: WrenchIcon,
    badgeVariant: "outline",
  },
};

function kindCfg(kind: PlanRunnerLogEntryKind): KindCfg {
  return KIND_CFG[kind] ?? KIND_CFG["runner.status"];
}

// ─── Activity payload pretty-printer ─────────────────────────────────────────

/**
 * Best-effort structured renderer for `activity` payloads. We don't know the
 * full shape of every activity the server can produce, so we pretty-print as
 * canonical JSON. If the payload is unusable (cyclic, undefined, etc.) we
 * fall back to a string coercion.
 */
function formatActivityPayload(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

// ─── Copy text ───────────────────────────────────────────────────────────────

/**
 * Build a self-contained, machine-friendly copy block for a single entry.
 *
 * Embeds the metadata (timestamp, kind, role, title, sequence) above the
 * server's pre-rendered `copyText` so a copied snippet is useful when pasted
 * into an issue or chat.
 */
function buildEntryCopyBlock(entry: PlanRunnerLogEntry): string {
  const lines: string[] = [];
  lines.push(`[${entry.createdAt}] ${entry.kind} #${entry.sequence}`);
  if (entry.threadRole) lines.push(`role: ${entry.threadRole}`);
  if (entry.title) lines.push(`title: ${entry.title}`);
  lines.push("");
  lines.push(entry.copyText);
  return lines.join("\n");
}

function buildAllCopyBlock(entries: readonly PlanRunnerLogEntry[]): string {
  return entries.map(buildEntryCopyBlock).join("\n\n---\n\n");
}

// ─── Per-entry row ───────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: PlanRunnerLogEntry;
  timestampFormat: TimestampFormat;
  cwd: string | undefined;
  isPromptDefaultCollapsed: boolean;
}

const EntryRow = memo(function EntryRow({
  entry,
  timestampFormat,
  cwd,
  isPromptDefaultCollapsed,
}: EntryRowProps) {
  const cfg = kindCfg(entry.kind);
  const Icon = cfg.icon;

  // Generated runner prompts (`kind === "prompt"`) are collapsed by default
  // behind a disclosure. Other kinds are always visible.
  const collapsible = entry.kind === "prompt";
  const [expanded, setExpanded] = useState(!isPromptDefaultCollapsed || !collapsible);

  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const handleCopy = useCallback(() => {
    copyToClipboard(buildEntryCopyBlock(entry));
  }, [copyToClipboard, entry]);

  const ts = useMemo(
    () => formatTimestamp(entry.createdAt, timestampFormat),
    [entry.createdAt, timestampFormat],
  );

  // Body resolution. Order of preference:
  //   1. Markdown for assistant kind (rendered through ChatMarkdown)
  //   2. Pre-rendered plain text (`bodyText`)
  //   3. Pre-rendered markdown (used as plain pre block when not assistant)
  //   4. Structured payload pretty-print
  const renderBody = (): React.ReactNode => {
    if (entry.kind === "assistant" && entry.bodyMarkdown) {
      return (
        <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2 text-xs">
          <ChatMarkdown text={entry.bodyMarkdown} cwd={cwd} />
        </div>
      );
    }
    if (entry.kind === "activity") {
      const formatted =
        entry.bodyText ?? entry.bodyMarkdown ?? formatActivityPayload(entry.payload);
      if (!formatted) return null;
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">
          {formatted}
        </pre>
      );
    }
    const text = entry.bodyText ?? entry.bodyMarkdown;
    if (!text) return null;
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">
        {text}
      </pre>
    );
  };

  const body = renderBody();

  return (
    <div className="border-b border-border/40 px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {ts}
        </span>
        <Badge
          variant={cfg.badgeVariant}
          size="sm"
          className={cn("gap-1 px-1.5 font-normal lowercase", cfg.badgeClass)}
        >
          <Icon className="size-2.5" />
          {cfg.label}
        </Badge>
        {entry.threadRole && (
          <Badge variant="outline" size="sm" className="px-1.5 font-normal lowercase">
            {entry.threadRole}
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate text-foreground/90">{entry.title}</span>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? "Collapse prompt" : "Expand prompt"}
            onClick={() => setExpanded((e) => !e)}
          >
            <ChevronRightIcon
              className={cn("size-3 transition-transform", expanded ? "rotate-90" : "rotate-0")}
            />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Copy entry" onClick={handleCopy}>
          {isCopied ? (
            <CheckIcon className="size-3 text-success-foreground" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </Button>
      </div>
      {expanded && body && <div className="mt-1.5 ps-1">{body}</div>}
    </div>
  );
});

// ─── Header (copy-all + summary) ─────────────────────────────────────────────

const ViewerHeader = memo(function ViewerHeader({
  entries,
  loading,
  emptyHint,
}: {
  entries: readonly PlanRunnerLogEntry[];
  loading: boolean;
  emptyHint: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const handleCopyAll = useCallback(() => {
    if (entries.length === 0) return;
    copyToClipboard(buildAllCopyBlock(entries));
  }, [copyToClipboard, entries]);

  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium">
        {entries.length} {entries.length === 1 ? "entry" : "entries"}
      </span>
      {loading && <Loader2Icon className="size-3 animate-spin text-muted-foreground" />}
      {entries.length === 0 && !loading && (
        <span className="text-muted-foreground/70">{emptyHint}</span>
      )}
      <span className="ml-auto" />
      <Button variant="outline" size="xs" disabled={entries.length === 0} onClick={handleCopyAll}>
        {isCopied ? (
          <>
            <CheckIcon className="size-3 text-success-foreground" />
            Copied
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />
            Copy all
          </>
        )}
      </Button>
    </div>
  );
});

// ─── Main viewer ─────────────────────────────────────────────────────────────

interface StepLogViewerProps {
  entries: readonly PlanRunnerLogEntry[];
  timestampFormat: TimestampFormat;
  cwd: string | undefined;
  /** Outer label shown above the entry list (e.g. step name + state). */
  title?: React.ReactNode;
  /** Hint shown when there are no entries (and no fetch in flight). */
  emptyHint?: string;
  /** Mark the viewer as backfilling. Surfaces a spinner in the header. */
  loading?: boolean;
  className?: string;
}

export const StepLogViewer = memo(function StepLogViewer({
  entries,
  timestampFormat,
  cwd,
  title,
  emptyHint = "No entries yet",
  loading = false,
  className,
}: StepLogViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    measureElement: measureVirtualElement,
    overscan: 6,
    getItemKey: (index) => entries[index]?.entryId ?? String(index),
  });

  // Auto-scroll-to-bottom on new entries when the user is already near the
  // bottom. This keeps live tailing feeling natural without yanking the
  // viewport when the user has scrolled up to inspect history.
  const lastCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      lastCountRef.current = entries.length;
      return;
    }
    const grew = entries.length > lastCountRef.current;
    lastCountRef.current = entries.length;
    if (!grew) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      // Defer one frame so the new row's measurement is committed.
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [entries.length]);

  const items = rowVirtualizer.getVirtualItems();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-card/40",
        className,
      )}
    >
      {title !== undefined && (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
          {title}
        </div>
      )}
      <ViewerHeader entries={entries} loading={loading} emptyHint={emptyHint} />
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="step-log-viewer-scroll"
      >
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-6 text-xs text-muted-foreground">
            {loading ? "Loading…" : emptyHint}
          </div>
        ) : (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}
          >
            {items.map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (!entry) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <EntryRow
                    entry={entry}
                    timestampFormat={timestampFormat}
                    cwd={cwd}
                    isPromptDefaultCollapsed
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
