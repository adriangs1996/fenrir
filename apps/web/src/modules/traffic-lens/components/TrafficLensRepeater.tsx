import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "../../../lib/utils";
import { BodyViewer } from "./BodyViewer";
import { getPrimaryEnvironmentConnection } from "../../../environments/runtime/service";
import type { TrafficLensDetail, TrafficLensReplayResponse } from "@fenrir/contracts";

interface TrafficLensRepeaterProps {
  initialDetail?: TrafficLensDetail;
  onClose?: () => void;
}

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];

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

function decodeBase64ToText(b64: string): string {
  if (!b64) return "";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function encodeTextToBase64(text: string): string {
  if (!text) return "";
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function parseHeadersJson(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        out[k] = typeof v === "string" ? v : String(v);
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function normalizeMethod(method: string): Method {
  const upper = method.toUpperCase();
  return (METHODS as readonly string[]).includes(upper) ? (upper as Method) : "GET";
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

export function TrafficLensRepeater({ initialDetail, onClose }: TrafficLensRepeaterProps) {
  const initial = useMemo(() => {
    if (!initialDetail) {
      return {
        method: "GET" as Method,
        url: "",
        headersText: "",
        bodyText: "",
      };
    }
    const parsedHeaders = parseHeadersJson(initialDetail.requestHeadersJson);
    return {
      method: normalizeMethod(initialDetail.method),
      url: initialDetail.url,
      headersText: headersToText(parsedHeaders),
      bodyText: initialDetail.requestBody ? decodeBase64ToText(initialDetail.requestBody) : "",
    };
  }, [initialDetail]);

  const [method, setMethod] = useState<Method>(initial.method);
  const [url, setUrl] = useState<string>(initial.url);
  const [headersText, setHeadersText] = useState<string>(initial.headersText);
  const [bodyText, setBodyText] = useState<string>(initial.bodyText);
  const [sending, setSending] = useState<boolean>(false);
  const [response, setResponse] = useState<TrafficLensReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const client = getPrimaryEnvironmentConnection().client;
      const headers = parseHeadersText(headersText);
      const body = bodyText.length > 0 ? encodeTextToBase64(bodyText) : null;
      const result = await client.trafficLens.replayRequest({
        trafficId: initialDetail?.id,
        method,
        url,
        headers,
        body,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setResponse(null);
    } finally {
      setSending(false);
    }
  };

  const responseContentType = response
    ? (response.headers["content-type"] ?? response.headers["Content-Type"] ?? undefined)
    : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="font-medium">Repeater</span>
        {onClose ? (
          <button
            type="button"
            className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </div>

      {/* Split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Request editor */}
        <div className="flex w-1/2 flex-col gap-2 overflow-auto border-r p-2">
          <div className="flex items-center gap-2">
            <select
              className={cn(
                "rounded border bg-background px-2 py-1 font-mono text-xs",
                METHOD_COLORS[method] ?? "",
              )}
              value={method}
              onChange={(e) => setMethod(normalizeMethod(e.target.value))}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Input
              nativeInput
              className="flex-1"
              placeholder="https://target/path"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <Button size="sm" onClick={handleSend} disabled={sending || !url}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Headers (key: value per line)
            </label>
            <textarea
              className="min-h-24 rounded border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <textarea
              className="min-h-32 rounded border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
          </div>
        </div>

        {/* Response viewer */}
        <div className="flex w-1/2 flex-col gap-2 overflow-auto p-2">
          {error ? (
            <div className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-red-500">
              {error}
            </div>
          ) : null}
          {!error && !response ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Send a request to see the response
            </div>
          ) : null}
          {response ? (
            <>
              <div className="flex items-baseline gap-2 font-mono text-xs">
                <span className={cn("font-bold", statusColor(response.statusCode))}>
                  {response.statusCode}
                </span>
                <span className="text-muted-foreground">{response.statusText}</span>
                <span className="ml-auto text-muted-foreground">{response.timing} ms</span>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Headers</div>
                <HeadersView headers={response.headers} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Body</div>
                {response.body ? (
                  <BodyViewer body={response.body} contentType={responseContentType} />
                ) : (
                  <div className="rounded border bg-background px-2 py-1 text-xs text-muted-foreground">
                    (no body)
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
