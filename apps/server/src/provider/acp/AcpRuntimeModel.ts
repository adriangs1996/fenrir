import type * as EffectAcpSchema from "effect-acp/schema";
import { deriveToolActivityPresentation } from "@fenrir/shared/toolActivity";
import type { ToolLifecycleItemType } from "@fenrir/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AcpSessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface AcpSessionModeState {
  readonly currentModeId: string;
  readonly availableModes: ReadonlyArray<AcpSessionMode>;
}

export interface AcpToolCallState {
  readonly toolCallId: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: "pending" | "inProgress" | "completed" | "failed";
  readonly command?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
}

export interface AcpPlanUpdate {
  readonly explanation?: string | null;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
}

export interface AcpPermissionRequest {
  readonly kind: string | "unknown";
  readonly detail?: string;
  readonly toolCall?: AcpToolCallState;
}

export type AcpParsedSessionEvent =
  | {
      readonly _tag: "ModeChanged";
      readonly modeId: string;
    }
  | {
      readonly _tag: "AssistantItemStarted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "AssistantItemCompleted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "PlanUpdated";
      readonly payload: AcpPlanUpdate;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ToolCallUpdated";
      readonly toolCall: AcpToolCallState;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ContentDelta";
      readonly itemId?: string;
      readonly text: string;
      readonly rawPayload: unknown;
    };

type AcpSessionSetupResponse =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

export function extractModelConfigId(sessionResponse: AcpSessionSetupResponse): string | undefined {
  const configOptions = sessionResponse.configOptions;
  if (!configOptions) return undefined;
  for (const opt of configOptions) {
    if (opt.category === "model" && opt.id.trim().length > 0) {
      return opt.id.trim();
    }
  }
  return undefined;
}

export function findSessionConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  configId: string,
): EffectAcpSchema.SessionConfigOption | undefined {
  if (!configOptions) {
    return undefined;
  }
  const normalizedConfigId = configId.trim();
  if (!normalizedConfigId) {
    return undefined;
  }
  return configOptions.find((option) => option.id.trim() === normalizedConfigId);
}

export function collectSessionConfigOptionValues(
  configOption: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<string> {
  if (configOption.type !== "select") {
    return [];
  }
  return (configOption.options ?? []).flatMap((entry) => {
    if (typeof entry.value === "string") {
      return [entry.value];
    }
    const entryRecord = entry as Record<string, unknown>;
    if (!Array.isArray(entryRecord.options)) {
      return [];
    }
    return entryRecord.options.flatMap((option) =>
      isRecord(option) && typeof option.value === "string" ? [option.value] : [],
    );
  });
}

export function parseSessionModeState(
  sessionResponse: AcpSessionSetupResponse,
): AcpSessionModeState | undefined {
  const modes = sessionResponse.modes;
  if (!modes) return undefined;
  const currentModeId = typeof modes.currentModeId === "string" ? modes.currentModeId.trim() : "";
  if (!currentModeId) {
    return undefined;
  }
  const availableModes = (modes.availableModes ?? [])
    .map((mode) => {
      const id = mode.id.trim();
      const name = mode.name.trim();
      if (!id || !name) {
        return undefined;
      }
      const description = mode.description?.trim() || undefined;
      return description !== undefined
        ? ({ id, name, description } satisfies AcpSessionMode)
        : ({ id, name } satisfies AcpSessionMode);
    })
    .filter((mode): mode is AcpSessionMode => mode !== undefined);
  if (availableModes.length === 0) {
    return undefined;
  }
  return {
    currentModeId,
    availableModes,
  };
}

function normalizePlanStepStatus(raw: unknown): "pending" | "inProgress" | "completed" {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    default:
      return "pending";
  }
}

function normalizeToolCallStatus(
  raw: unknown,
  fallback?: "pending" | "inProgress" | "completed" | "failed",
): "pending" | "inProgress" | "completed" | "failed" | undefined {
  switch (raw) {
    case "pending":
      return "pending";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return fallback;
  }
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => (typeof entry === "string" && entry.trim().length > 0 ? entry.trim() : null))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const match = /`([^`]+)`/.exec(title);
  return match?.[1]?.trim() || undefined;
}

function extractToolCallCommand(rawInput: unknown, title: string | undefined): string | undefined {
  if (isRecord(rawInput)) {
    const directCommand = normalizeCommandValue(rawInput.command);
    if (directCommand) {
      return directCommand;
    }
    const executable = typeof rawInput.executable === "string" ? rawInput.executable.trim() : "";
    const args = normalizeCommandValue(rawInput.args);
    if (executable && args) {
      return `${executable} ${args}`;
    }
    if (executable) {
      return executable;
    }
  }
  return extractCommandFromTitle(title);
}

function extractTextContentFromToolCallContent(
  content: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined,
): string | undefined {
  if (!content) return undefined;
  const chunks = content
    .map((entry) => {
      if (entry.type !== "content") {
        return undefined;
      }
      const nestedContent = entry.content;
      if (!isRecord(nestedContent) || nestedContent.type !== "text") {
        return undefined;
      }
      return typeof nestedContent.text === "string" && nestedContent.text.trim().length > 0
        ? nestedContent.text.trim()
        : undefined;
    })
    .filter((entry): entry is string => entry !== undefined);
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function normalizeToolCallLocations(
  locations: unknown,
): ReadonlyArray<EffectAcpSchema.ToolCallLocation> | undefined {
  return Array.isArray(locations)
    ? (locations as ReadonlyArray<EffectAcpSchema.ToolCallLocation>)
    : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeToolCallContent(
  content: unknown,
): ReadonlyArray<EffectAcpSchema.ToolCallContent> | undefined {
  return Array.isArray(content)
    ? (content as ReadonlyArray<EffectAcpSchema.ToolCallContent>)
    : undefined;
}

function normalizeToolKind(kind: unknown): string | undefined {
  return typeof kind === "string" && kind.trim().length > 0 ? kind.trim() : undefined;
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "search":
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function makeToolCallState(
  input: {
    readonly toolCallId: string;
    readonly title?: string | null | undefined;
    readonly kind?: EffectAcpSchema.ToolKind | null | undefined;
    readonly status?: EffectAcpSchema.ToolCallStatus | null | undefined;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined;
    readonly locations?: ReadonlyArray<EffectAcpSchema.ToolCallLocation> | null | undefined;
  },
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  const toolCallId = input.toolCallId.trim();
  if (!toolCallId) {
    return undefined;
  }
  const title = input.title?.trim() || undefined;
  const command = extractToolCallCommand(input.rawInput, title);
  const textContent = extractTextContentFromToolCallContent(input.content);
  const normalizedTitle =
    title && title.toLowerCase() !== "terminal" && title.toLowerCase() !== "tool call"
      ? title
      : undefined;
  const data: Record<string, unknown> = { toolCallId };
  const kind = normalizeToolKind(input.kind);
  if (kind) {
    data.kind = kind;
  }
  if (command) {
    data.command = command;
  }
  if (input.rawInput !== undefined) {
    data.rawInput = input.rawInput;
  }
  if (input.rawOutput !== undefined) {
    data.rawOutput = input.rawOutput;
  }
  if (input.content !== undefined) {
    data.content = input.content;
  }
  if (input.locations !== undefined) {
    data.locations = input.locations;
  }
  const fallbackDetail = command ?? normalizedTitle ?? textContent;
  const hasPresentationSeed =
    title !== undefined ||
    kind !== undefined ||
    command !== undefined ||
    normalizedTitle !== undefined ||
    textContent !== undefined;
  const presentation = hasPresentationSeed
    ? deriveToolActivityPresentation({
        itemType: canonicalItemTypeFromAcpToolKind(kind),
        title,
        detail: fallbackDetail,
        data,
        fallbackSummary: title ?? "Tool",
      })
    : undefined;
  const status = normalizeToolCallStatus(input.status, options?.fallbackStatus);
  return {
    toolCallId,
    ...(kind ? { kind } : {}),
    ...(presentation?.summary ? { title: presentation.summary } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(presentation?.detail ? { detail: presentation.detail } : {}),
    data,
  };
}

function parseTypedToolCallState(
  event: EffectAcpSchema.SessionNotification["update"],
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  if (
    (event.sessionUpdate !== "tool_call" && event.sessionUpdate !== "tool_call_update") ||
    typeof event.toolCallId !== "string"
  ) {
    return undefined;
  }
  return makeToolCallState(
    {
      toolCallId: event.toolCallId,
      title: normalizeOptionalString(event.title),
      kind: normalizeOptionalString(event.kind),
      status: normalizeOptionalString(event.status),
      rawInput: "rawInput" in event ? event.rawInput : undefined,
      rawOutput: "rawOutput" in event ? event.rawOutput : undefined,
      content: normalizeToolCallContent(event.content),
      locations: normalizeToolCallLocations(event.locations),
    },
    options,
  );
}

export function mergeToolCallState(
  previous: AcpToolCallState | undefined,
  next: AcpToolCallState,
): AcpToolCallState {
  const nextKind = typeof next.data.kind === "string" ? next.data.kind : undefined;
  const kind = nextKind ?? previous?.kind;
  const title = next.title ?? previous?.title;
  const status = next.status ?? previous?.status;
  const command = next.command ?? previous?.command;
  const detail = next.detail ?? previous?.detail;
  return {
    toolCallId: next.toolCallId,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(detail ? { detail } : {}),
    data: {
      ...previous?.data,
      ...next.data,
    },
  };
}

export function parsePermissionRequest(
  params: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionRequest {
  const requestToolCall = params.toolCall;
  if (!requestToolCall) {
    const detail =
      typeof params.sessionId === "string" && params.sessionId.trim().length > 0
        ? `Session ${params.sessionId}`
        : undefined;
    return {
      kind: "unknown",
      ...(detail ? { detail } : {}),
    };
  }
  const toolCall = makeToolCallState(
    {
      toolCallId: typeof requestToolCall.toolCallId === "string" ? requestToolCall.toolCallId : "",
      title: normalizeOptionalString(requestToolCall.title),
      kind: normalizeOptionalString(requestToolCall.kind),
      status: normalizeOptionalString(requestToolCall.status),
      rawInput: requestToolCall.rawInput,
      rawOutput: requestToolCall.rawOutput,
      content: normalizeToolCallContent(requestToolCall.content),
      locations: normalizeToolCallLocations(requestToolCall.locations),
    },
    { fallbackStatus: "pending" },
  );
  const kind = normalizeToolKind(requestToolCall.kind) ?? "unknown";
  const detail =
    toolCall?.command ??
    toolCall?.title ??
    toolCall?.detail ??
    (typeof params.sessionId === "string" ? `Session ${params.sessionId}` : undefined);
  return {
    kind,
    ...(detail ? { detail } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}

export function parseSessionUpdateEvent(params: EffectAcpSchema.SessionNotification): {
  readonly modeId?: string;
  readonly events: ReadonlyArray<AcpParsedSessionEvent>;
} {
  const upd = params.update;
  const events: Array<AcpParsedSessionEvent> = [];
  let modeId: string | undefined;

  switch (upd.sessionUpdate) {
    case "current_mode_update": {
      modeId = typeof upd.currentModeId === "string" ? upd.currentModeId.trim() : "";
      if (modeId) {
        events.push({
          _tag: "ModeChanged",
          modeId,
        });
      }
      break;
    }
    case "plan": {
      const plan = (Array.isArray(upd.entries) ? upd.entries : []).map((entry, index) => ({
        step:
          isRecord(entry) && typeof entry.content === "string" && entry.content.trim().length > 0
            ? entry.content.trim()
            : `Step ${index + 1}`,
        status: normalizePlanStepStatus(isRecord(entry) ? entry.status : undefined),
      }));
      if (plan.length > 0) {
        events.push({
          _tag: "PlanUpdated",
          payload: {
            plan,
          },
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call": {
      const toolCall = parseTypedToolCallState(upd, {
        fallbackStatus: "pending",
      });
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call_update": {
      const toolCall = parseTypedToolCallState(upd);
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "agent_message_chunk": {
      if (
        isRecord(upd.content) &&
        upd.content.type === "text" &&
        typeof upd.content.text === "string" &&
        upd.content.text.length > 0
      ) {
        events.push({
          _tag: "ContentDelta",
          text: upd.content.text,
          rawPayload: params,
        });
      }
      break;
    }
    default:
      break;
  }

  return { ...(modeId !== undefined ? { modeId } : {}), events };
}
