import { useMemo } from "react";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime/service";
import { cn } from "../../../lib/utils";
import type { TrafficLensEntry } from "@fenrir/contracts";
import { Input } from "../../../components/ui/input";
import { TRAFFIC_LENS_FILTER_OPTIONS, matchesTrafficEntryFilter } from "../trafficFilters";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";

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

interface TrafficLensTableProps {
  onSelectEntry?: (entry: TrafficLensEntry) => void;
  selectedId?: number | null;
}

export function TrafficLensTable({ onSelectEntry, selectedId }: TrafficLensTableProps) {
  const entries = useTrafficLensStore((s) => s.trafficEntries);
  const trafficFilterQuery = useTrafficLensStore((s) => s.trafficFilterQuery);
  const trafficFilterMode = useTrafficLensStore((s) => s.trafficFilterMode);
  const setTrafficFilterQuery = useTrafficLensStore((s) => s.setTrafficFilterQuery);
  const setTrafficFilterMode = useTrafficLensStore((s) => s.setTrafficFilterMode);
  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) =>
        matchesTrafficEntryFilter(entry, {
          mode: trafficFilterMode,
          query: trafficFilterQuery,
        }),
      ),
    [entries, trafficFilterMode, trafficFilterQuery],
  );
  const hiddenCount = entries.length - filteredEntries.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/70 bg-background/80 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={trafficFilterQuery}
            onChange={(event) => setTrafficFilterQuery(event.target.value)}
            placeholder="Filter host, path, type, method, status..."
            className="h-8 min-w-[16rem] max-w-sm bg-background/80 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            {TRAFFIC_LENS_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  trafficFilterMode === option.id
                    ? "border-emerald-400/50 bg-emerald-400/12 text-emerald-100"
                    : "border-border/70 text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTrafficFilterMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {hiddenCount > 0
            ? `Showing ${filteredEntries.length} of ${entries.length} requests. ${hiddenCount} hidden as noise.`
            : `${filteredEntries.length} requests visible.`}
        </div>
      </div>

      <div className="flex border-b bg-muted/30 px-2 py-1 text-xs font-medium text-muted-foreground">
        <div className="w-16">Method</div>
        <div className="flex-1">URL</div>
        <div className="w-14">Status</div>
        <div className="w-24">Type</div>
        <div className="w-16 text-right">Size</div>
        <div className="w-16 text-right">Time</div>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredEntries.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "flex h-7 cursor-pointer items-center px-2 text-xs hover:bg-muted/50",
              selectedId === entry.id && "bg-accent",
            )}
            onClick={() => onSelectEntry?.(entry)}
          >
            <div className={cn("w-16 font-mono", METHOD_COLORS[entry.method])}>{entry.method}</div>
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
        ))}
      </div>

      {/* Footer status */}
      <div className="flex items-center justify-between border-t px-2 py-0.5 text-xs text-muted-foreground">
        <span>
          {filteredEntries.length}
          {filteredEntries.length !== entries.length ? ` / ${entries.length}` : ""} requests
        </span>
        <div className="flex items-center gap-3">
          {(trafficFilterQuery || trafficFilterMode !== "focus") && (
            <button
              className="hover:text-foreground"
              onClick={() => {
                setTrafficFilterQuery("");
                setTrafficFilterMode("focus");
              }}
            >
              Reset Filters
            </button>
          )}
          <button
            className="hover:text-foreground"
            onClick={() => {
              const activeTabId = useTrafficLensStore.getState().activeTabId ?? undefined;
              try {
                void getPrimaryEnvironmentConnection()
                  .client.trafficLens.clearTraffic({ tabId: activeTabId })
                  .finally(() => {
                    useTrafficLensStore.getState().clearTraffic();
                  });
              } catch {
                useTrafficLensStore.getState().clearTraffic();
              }
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
