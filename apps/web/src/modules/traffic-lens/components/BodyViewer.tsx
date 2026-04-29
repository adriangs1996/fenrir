import { useMemo, useState } from "react";
import { cn } from "../../../lib/utils";

interface BodyViewerProps {
  body: string; // base64-encoded
  contentType?: string | undefined;
}

type ViewMode = "auto" | "text" | "json" | "hex" | "image";

const MODES: ViewMode[] = ["auto", "text", "json", "hex", "image"];

function decodeBase64(body: string): string {
  if (!body) return "";
  try {
    return atob(body);
  } catch {
    return "";
  }
}

function decodeBase64Bytes(body: string): Uint8Array {
  const decoded = decodeBase64(body);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function detectAutoMode(decoded: string, contentType?: string): ViewMode {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.includes("json")) return "json";
  const trimmed = decoded.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

function prettyJson(decoded: string): string {
  try {
    return JSON.stringify(JSON.parse(decoded), null, 2);
  } catch {
    return decoded;
  }
}

function buildHexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, Math.min(offset + 16, bytes.length));
    const hexParts: string[] = [];
    let ascii = "";
    for (let i = 0; i < 16; i++) {
      if (i < slice.length) {
        const byte = slice[i]!;
        hexParts.push(byte.toString(16).padStart(2, "0"));
        ascii += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";
      } else {
        hexParts.push("  ");
        ascii += " ";
      }
    }
    const offsetStr = offset.toString(16).padStart(8, "0");
    const left = hexParts.slice(0, 8).join(" ");
    const right = hexParts.slice(8, 16).join(" ");
    lines.push(`${offsetStr}  ${left}  ${right}  |${ascii}|`);
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function BodyViewer({ body, contentType }: BodyViewerProps) {
  const [mode, setMode] = useState<ViewMode>("auto");

  const decoded = useMemo(() => decodeBase64(body), [body]);
  const bytes = useMemo(() => decodeBase64Bytes(body), [body]);
  const autoMode = useMemo(() => detectAutoMode(decoded, contentType), [decoded, contentType]);
  const effectiveMode: ViewMode = mode === "auto" ? autoMode : mode;

  const content = useMemo(() => {
    if (effectiveMode === "image") {
      const ct = contentType ?? "image/png";
      return (
        <div className="flex items-center justify-center p-2">
          <img
            alt="response body"
            className="max-h-80 max-w-full object-contain"
            src={`data:${ct};base64,${body}`}
          />
        </div>
      );
    }
    if (effectiveMode === "hex") {
      return (
        <pre className="whitespace-pre p-2 font-mono text-xs leading-relaxed">
          {buildHexDump(bytes)}
        </pre>
      );
    }
    if (effectiveMode === "json") {
      return (
        <pre className="whitespace-pre-wrap break-all p-2 font-mono text-xs">
          {prettyJson(decoded)}
        </pre>
      );
    }
    return <pre className="whitespace-pre-wrap break-all p-2 font-mono text-xs">{decoded}</pre>;
  }, [effectiveMode, decoded, bytes, body, contentType]);

  return (
    <div className="flex flex-col rounded border bg-background">
      <div className="flex items-center gap-1 border-b px-2 py-1 text-xs">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "rounded px-2 py-0.5 font-mono",
              mode === m
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {effectiveMode === "auto" ? autoMode : effectiveMode}
        </span>
      </div>
      <div className="max-h-96 overflow-auto">{content}</div>
      <div className="border-t px-2 py-0.5 text-xs text-muted-foreground">
        {formatBytes(bytes.length)} decoded
      </div>
    </div>
  );
}
