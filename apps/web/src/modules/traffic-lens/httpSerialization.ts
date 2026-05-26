export function decodeBase64ToText(base64: string): string {
  if (!base64) {
    return "";
  }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index) & 0xff;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

export function encodeTextToBase64(text: string): string {
  if (!text) {
    return "";
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

export function parseHeadersJson(json: string | null): Record<string, string> {
  if (!json) {
    return {};
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      headers[key] = typeof value === "string" ? value : String(value);
    }
    return headers;
  } catch {
    return {};
  }
}

export function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

export function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}
