import { isToolLifecycleItemType } from "@fenrir/contracts";

export interface ProviderToolCommandPreview {
  command: string | null;
  rawCommand: string | null;
}

export interface ProviderActivityLogDisplay {
  title: string;
  bodyText: string | null;
  copyText: string;
}

type PayloadRecord = Record<string, unknown>;

const ACTIVITY_REQUEST_KIND_MAP = {
  command_execution_approval: "command",
  exec_command_approval: "command",
  dynamic_tool_call: "command",
  file_read_approval: "file-read",
  file_change_approval: "file-change",
  apply_patch_approval: "file-change",
} as const;

const ITEM_TYPE_LABELS: Record<string, string> = {
  command_execution: "Command",
  file_change: "File change",
  mcp_tool_call: "MCP tool",
  dynamic_tool_call: "Tool call",
  collab_agent_tool_call: "Sub-agent",
  web_search: "Web search",
  image_view: "Image view",
};

function asRecord(value: unknown): PayloadRecord | null {
  return value && typeof value === "object" ? (value as PayloadRecord) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function humanizeRequestKind(requestKind: string): string {
  switch (requestKind) {
    case "command":
      return "Command approval";
    case "file-read":
      return "File read approval";
    case "file-change":
      return "File change approval";
    default:
      return "Approval";
  }
}

function humanizeItemType(itemType: string | null): string {
  if (!itemType) {
    return "Activity";
  }
  return ITEM_TYPE_LABELS[itemType] ?? itemType.replaceAll("_", " ");
}

function summarizeChangedFiles(changedFiles: readonly string[]): string | null {
  if (changedFiles.length === 0) {
    return null;
  }
  if (changedFiles.length === 1) {
    return changedFiles[0] ?? null;
  }
  const first = changedFiles[0];
  return first ? `${first} (+${changedFiles.length - 1} more)` : `${changedFiles.length} files`;
}

function truncateTitle(value: string, max = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function maybePushLine(lines: string[], label: string, value: string | null) {
  if (!value) {
    return;
  }
  lines.push(`${label}: ${value}`);
}

function safeJsonStringify(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

export function extractProviderActivityTitle(payload: unknown): string | null {
  return asTrimmedString(asRecord(payload)?.title);
}

export function extractProviderActivityItemType(payload: unknown): string | null {
  const itemType = asTrimmedString(asRecord(payload)?.itemType);
  return itemType && isToolLifecycleItemType(itemType) ? itemType : itemType;
}

export function extractProviderActivityRequestKind(payload: unknown): string | null {
  const record = asRecord(payload);
  const requestKind = asTrimmedString(record?.requestKind);
  if (requestKind === "command" || requestKind === "file-read" || requestKind === "file-change") {
    return requestKind;
  }
  const requestType = asTrimmedString(record?.requestType);
  return requestType
    ? (ACTIVITY_REQUEST_KIND_MAP[requestType as keyof typeof ACTIVITY_REQUEST_KIND_MAP] ?? null)
    : null;
}

export function extractProviderToolCommand(payload: unknown): ProviderToolCommandPreview {
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(record?.itemType);
  const detail = asTrimmedString(record?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

export function extractProviderChangedFiles(payload: unknown): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(asRecord(payload)?.data), changedFiles, seen, 0);
  return changedFiles;
}

export function formatProviderActivityLogDisplay(input: {
  kind: string;
  summary: string;
  payload: unknown;
}): ProviderActivityLogDisplay {
  const summary = input.summary.trim();
  const payload = asRecord(input.payload);
  const payloadSummary = asTrimmedString(payload?.summary);
  const payloadTitle = extractProviderActivityTitle(payload);
  const detail = asTrimmedString(payload?.detail);
  const strippedDetail = detail ? stripTrailingExitCode(detail).output : null;
  const requestKind = extractProviderActivityRequestKind(payload);
  const itemType = extractProviderActivityItemType(payload);
  const commandPreview = extractProviderToolCommand(payload);
  const changedFiles = extractProviderChangedFiles(payload);
  const lines: string[] = [];

  if (itemType && (input.kind.startsWith("tool.") || isToolLifecycleItemType(itemType))) {
    const headlineSource =
      commandPreview.command ??
      summarizeChangedFiles(changedFiles) ??
      payloadTitle ??
      payloadSummary ??
      strippedDetail ??
      summary;
    const title = truncateTitle(headlineSource || humanizeItemType(itemType));

    maybePushLine(lines, "Type", humanizeItemType(itemType));
    maybePushLine(lines, "Command", commandPreview.command);
    maybePushLine(lines, "Raw command", commandPreview.rawCommand);
    if (changedFiles.length > 0) {
      lines.push(`Files: ${changedFiles.join(", ")}`);
    }
    if (
      strippedDetail &&
      strippedDetail !== headlineSource &&
      strippedDetail !== commandPreview.command
    ) {
      lines.push("");
      lines.push(strippedDetail);
    }

    const bodyText = lines.join("\n").trim() || null;
    const copyText = [title, bodyText].filter(Boolean).join("\n\n");
    return { title, bodyText, copyText };
  }

  if (requestKind && input.kind.startsWith("approval.")) {
    const title = truncateTitle(payloadSummary ?? payloadTitle ?? humanizeRequestKind(requestKind));
    maybePushLine(lines, "Request", humanizeRequestKind(requestKind));
    if (strippedDetail && strippedDetail !== title) {
      lines.push("");
      lines.push(strippedDetail);
    }
    const bodyText = lines.join("\n").trim() || null;
    const copyText = [title, bodyText].filter(Boolean).join("\n\n");
    return { title, bodyText, copyText };
  }

  if (input.kind === "task.progress" || input.kind === "task.completed") {
    const title = truncateTitle(payloadSummary ?? strippedDetail ?? payloadTitle ?? summary);
    if (strippedDetail && strippedDetail !== title) {
      lines.push(strippedDetail);
    }
    const bodyText = lines.join("\n").trim() || null;
    const copyText = [title, bodyText].filter(Boolean).join("\n\n");
    return { title, bodyText, copyText };
  }

  const title = truncateTitle(
    payloadSummary ?? payloadTitle ?? strippedDetail ?? summary ?? "Activity",
  );
  const structuredPayload = safeJsonStringify(payload);
  if (strippedDetail && strippedDetail !== title) {
    lines.push(strippedDetail);
  } else if (structuredPayload && structuredPayload !== "{}") {
    lines.push(structuredPayload);
  }
  const bodyText = lines.join("\n").trim() || null;
  const copyText = [title, bodyText].filter(Boolean).join("\n\n");
  return { title, bodyText, copyText };
}
