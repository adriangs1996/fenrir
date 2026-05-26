import { useEffect, useState } from "react";
import { cn } from "../../../lib/utils";
import { BodyViewer } from "./BodyViewer";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime/service";
import { parseHeadersJson } from "../httpSerialization";
import type { TrafficLensDetail } from "@fenrir/contracts";

interface TrafficLensInspectorProps {
  trafficId: number;
  onSendToRepeater?: (detail: TrafficLensDetail) => void;
}

type InspectorTab = "request" | "response";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-500",
  POST: "text-blue-500",
  PUT: "text-yellow-500",
  DELETE: "text-red-500",
  PATCH: "text-purple-500",
  OPTIONS: "text-gray-500",
  HEAD: "text-gray-400",
};

function statusColor(code: number | null): string {
  if (!code) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-green-500";
  if (code >= 300 && code < 400) return "text-yellow-500";
  if (code >= 400 && code < 500) return "text-orange-500";
  if (code >= 500) return "text-red-500";
  return "text-muted-foreground";
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "rounded px-2 py-0.5 text-xs",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface HeadersViewProps {
  headers: Record<string, string>;
}

function HeadersView({ headers }: HeadersViewProps) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">(no headers)</div>;
  }
  return (
    <div className="overflow-auto rounded border bg-background">
      <table className="w-full font-mono text-xs">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b last:border-b-0">
              <td className="whitespace-nowrap px-2 py-0.5 align-top text-blue-500">{key}</td>
              <td className="break-all px-2 py-0.5 align-top">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrafficLensInspector({ trafficId, onSendToRepeater }: TrafficLensInspectorProps) {
  const [detail, setDetail] = useState<TrafficLensDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("request");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    (async () => {
      try {
        const client = getPrimaryEnvironmentConnection().client;
        const result = await client.trafficLens.getTrafficDetail({ id: trafficId });
        if (!cancelled) {
          setDetail(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Not found");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trafficId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {error ?? "Not found"}
      </div>
    );
  }

  const requestHeaders = parseHeadersJson(detail.requestHeadersJson);
  const responseHeaders = parseHeadersJson(detail.responseHeadersJson);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <TabButton active={tab === "request"} onClick={() => setTab("request")}>
          Request
        </TabButton>
        <TabButton active={tab === "response"} onClick={() => setTab("response")}>
          Response{detail.statusCode !== null ? ` (${detail.statusCode})` : ""}
        </TabButton>
        <button
          type="button"
          className="ml-auto rounded border px-2 py-0.5 text-xs hover:bg-accent"
          onClick={() => onSendToRepeater?.(detail)}
        >
          Send to Repeater
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-2">
        {tab === "request" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 font-mono text-xs">
              <span className={cn(METHOD_COLORS[detail.method] ?? "text-foreground")}>
                {detail.method}
              </span>
              <span className="break-all">{detail.url}</span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
              <HeadersView headers={requestHeaders} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Body</div>
              {detail.requestBody ? (
                <BodyViewer
                  body={detail.requestBody}
                  contentType={requestHeaders["content-type"] ?? requestHeaders["Content-Type"]}
                />
              ) : (
                <div className="rounded border bg-background px-2 py-1 text-xs text-muted-foreground">
                  (no body)
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 font-mono text-xs">
              <span className={cn("font-bold", statusColor(detail.statusCode))}>
                {detail.statusCode ?? "—"}
              </span>
              <span className="text-muted-foreground">{detail.contentType ?? "-"}</span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
              <HeadersView headers={responseHeaders} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Body</div>
              {detail.responseBody ? (
                <BodyViewer
                  body={detail.responseBody}
                  contentType={detail.contentType ?? undefined}
                />
              ) : (
                <div className="rounded border bg-background px-2 py-1 text-xs text-muted-foreground">
                  (no body)
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
