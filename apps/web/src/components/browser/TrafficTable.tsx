import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBrowserStore } from "../../browserStore";
import { cn } from "../../lib/utils";
import type { BrowserTrafficEntry } from "@fenrir/contracts";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-500",
  POST: "text-blue-500",
  PUT: "text-yellow-500",
  DELETE: "text-red-500",
  PATCH: "text-purple-500",
  OPTIONS: "text-gray-500",
  HEAD: "text-gray-400",
};

const STATUS_COLORS = (code: number | null): string => {
  if (!code) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-green-500";
  if (code >= 300 && code < 400) return "text-yellow-500";
  if (code >= 400 && code < 500) return "text-orange-500";
  if (code >= 500) return "text-red-500";
  return "text-muted-foreground";
};

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function formatTime(started: string, completed: string | null): string {
  if (!completed) return "-";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TrafficTableProps {
  onSelectEntry?: (entry: BrowserTrafficEntry) => void;
  selectedId?: number | null;
}

export function TrafficTable({ onSelectEntry, selectedId }: TrafficTableProps) {
  const entries = useBrowserStore((s) => s.trafficEntries);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex border-b bg-muted/30 px-2 py-1 text-xs font-medium text-muted-foreground">
        <div className="w-16">Method</div>
        <div className="flex-1">URL</div>
        <div className="w-14">Status</div>
        <div className="w-24">Type</div>
        <div className="w-16 text-right">Size</div>
        <div className="w-16 text-right">Time</div>
      </div>

      {/* Virtual rows */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = entries[virtualItem.index];
            if (!entry) return null;

            return (
              <div
                key={entry.requestId}
                className={cn(
                  "absolute left-0 right-0 flex cursor-pointer items-center px-2 text-xs hover:bg-muted/50",
                  selectedId === entry.id && "bg-accent",
                )}
                style={{
                  top: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                  height: `${virtualItem.size}px`,
                }}
                onClick={() => onSelectEntry?.(entry)}
              >
                <div className={cn("w-16 font-mono", METHOD_COLORS[entry.method])}>
                  {entry.method}
                </div>
                <div className="flex-1 truncate font-mono">{entry.url}</div>
                <div className={cn("w-14 font-mono", STATUS_COLORS(entry.statusCode))}>
                  {entry.statusCode ?? "..."}
                </div>
                <div className="w-24 truncate text-muted-foreground">
                  {entry.contentType?.split(";")[0] ?? "-"}
                </div>
                <div className="w-16 text-right text-muted-foreground">
                  {formatSize(entry.contentLength)}
                </div>
                <div className="w-16 text-right text-muted-foreground">
                  {formatTime(entry.timingStartedAt, entry.timingCompletedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer status */}
      <div className="flex items-center justify-between border-t px-2 py-0.5 text-xs text-muted-foreground">
        <span>{entries.length} requests</span>
        <button
          className="hover:text-foreground"
          onClick={() => {
            useBrowserStore.getState().clearTraffic();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
