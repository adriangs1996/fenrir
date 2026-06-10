import {
  type McpServerDefinition,
  type McpServerTransport,
  type McpValueRef,
  ServerSettings,
  type ProviderOptionSelection,
  type ProviderOptionSelections,
  type ServerSettingsPatch,
} from "@fenrir/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct";
import { fromLenientJson } from "./schemaJson";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownSync(ServerSettingsJson);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = decodeServerSettingsJson(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(
    patch &&
    (patch.provider !== undefined || patch.instanceId !== undefined || patch.model !== undefined),
  );
}

function optionSelectionsToEntries(
  options: ProviderOptionSelections | undefined,
): ReadonlyArray<ProviderOptionSelection> {
  if (!options) return [];
  if (Array.isArray(options)) return options;
  return Object.entries(options).flatMap(([id, value]) =>
    typeof value === "string" || typeof value === "boolean" ? [{ id, value }] : [],
  );
}

function mergeProviderOptionSelections(
  current: ProviderOptionSelections | undefined,
  patch: ProviderOptionSelections | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const merged = new Map<string, string | boolean>();
  for (const selection of optionSelectionsToEntries(current)) {
    merged.set(selection.id, selection.value);
  }
  for (const selection of optionSelectionsToEntries(patch)) {
    merged.set(selection.id, selection.value);
  }
  const selections = Array.from(merged, ([id, value]) => ({ id, value }));
  return selections.length > 0 ? selections : undefined;
}

function trimOptionalString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

function normalizeCodexProviderPatch(
  patch: NonNullable<ServerSettingsPatch["providers"]>["codex"] | undefined,
) {
  if (!patch) {
    return undefined;
  }

  return {
    ...patch,
    ...(patch.binaryPath !== undefined ? { binaryPath: patch.binaryPath.trim() } : {}),
    ...(patch.homePath !== undefined ? { homePath: patch.homePath.trim() } : {}),
  };
}

function normalizeClaudeProviderPatch(
  patch: NonNullable<ServerSettingsPatch["providers"]>["claudeAgent"] | undefined,
) {
  if (!patch) {
    return undefined;
  }

  return {
    ...patch,
    ...(patch.binaryPath !== undefined ? { binaryPath: patch.binaryPath.trim() } : {}),
  };
}

function normalizeMcpValueRef(value: McpValueRef): McpValueRef {
  switch (value.type) {
    case "literal":
      return value;
    case "env":
      return { ...value, name: value.name.trim() };
    case "secret":
      return { ...value, secretId: value.secretId.trim() };
  }
}

function normalizeMcpValueMap(values: Record<string, McpValueRef>): Record<string, McpValueRef> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.trim(), normalizeMcpValueRef(value)]),
  );
}

function normalizeMcpTransport(transport: McpServerTransport): McpServerTransport {
  switch (transport.type) {
    case "stdio":
      return {
        ...transport,
        command: transport.command.trim(),
        args: transport.args.map((arg) => arg.trim()),
        env: normalizeMcpValueMap(transport.env),
        ...(transport.cwd !== undefined ? { cwd: transport.cwd.trim() } : {}),
      };
    case "http":
    case "sse":
      return {
        ...transport,
        url: transport.url.trim(),
        headers: normalizeMcpValueMap(transport.headers),
      };
  }
}

function normalizeMcpServersPatch(
  servers: Record<string, McpServerDefinition> | undefined,
): Record<string, McpServerDefinition> | undefined {
  if (!servers) return undefined;
  return Object.fromEntries(
    Object.entries(servers).map(([key, server]) => [
      key.trim(),
      {
        ...server,
        id: server.id.trim() as McpServerDefinition["id"],
        name: server.name.trim(),
        ...(server.description !== undefined ? { description: server.description.trim() } : {}),
        transport: normalizeMcpTransport(server.transport),
      },
    ]),
  );
}

function normalizeServerSettingsPatch(patch: ServerSettingsPatch): ServerSettingsPatch {
  const providersPatch = patch.providers;
  const observabilityPatch = patch.observability;
  const normalizedObservability = observabilityPatch
    ? {
        ...(observabilityPatch.otlpTracesUrl !== undefined
          ? { otlpTracesUrl: trimOptionalString(observabilityPatch.otlpTracesUrl) ?? "" }
          : {}),
        ...(observabilityPatch.otlpMetricsUrl !== undefined
          ? { otlpMetricsUrl: trimOptionalString(observabilityPatch.otlpMetricsUrl) ?? "" }
          : {}),
      }
    : undefined;
  const normalizedProviders = providersPatch
    ? {
        ...(providersPatch.codex
          ? { codex: normalizeCodexProviderPatch(providersPatch.codex)! }
          : {}),
        ...(providersPatch.claudeAgent
          ? { claudeAgent: normalizeClaudeProviderPatch(providersPatch.claudeAgent)! }
          : {}),
      }
    : undefined;
  const normalizedMcpServers =
    patch.mcpServers !== undefined ? normalizeMcpServersPatch(patch.mcpServers) : undefined;

  return {
    ...patch,
    ...(patch.addProjectBaseDirectory !== undefined
      ? { addProjectBaseDirectory: patch.addProjectBaseDirectory.trim() }
      : {}),
    ...(normalizedObservability ? { observability: normalizedObservability } : {}),
    ...(normalizedProviders ? { providers: normalizedProviders } : {}),
    ...(normalizedMcpServers !== undefined ? { mcpServers: normalizedMcpServers } : {}),
  };
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const normalizedPatch = normalizeServerSettingsPatch(patch);
  const {
    automaticGitFetchInterval,
    defaultMcpServerIds,
    disabledBuiltInMcpServerIds,
    mcpServers,
    providerInstances,
    ...restPatch
  } = normalizedPatch;
  const next = {
    ...deepMerge(current, restPatch),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
    ...(defaultMcpServerIds !== undefined ? { defaultMcpServerIds } : {}),
    ...(disabledBuiltInMcpServerIds !== undefined ? { disabledBuiltInMcpServerIds } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(providerInstances !== undefined ? { providerInstances } : {}),
  };
  const selectionPatch = normalizedPatch.textGenerationModelSelection;
  if (!selectionPatch) {
    return next;
  }
  if (!shouldReplaceTextGenerationModelSelection(selectionPatch)) {
    const options = mergeProviderOptionSelections(
      current.textGenerationModelSelection.options,
      selectionPatch.options,
    );
    return {
      ...next,
      textGenerationModelSelection: {
        ...next.textGenerationModelSelection,
        ...(options ? { options } : {}),
      },
    };
  }

  return {
    ...next,
    textGenerationModelSelection: {
      provider: selectionPatch.provider ?? current.textGenerationModelSelection.provider,
      ...(selectionPatch.instanceId !== undefined ? { instanceId: selectionPatch.instanceId } : {}),
      model: selectionPatch.model ?? current.textGenerationModelSelection.model,
      ...(selectionPatch.options ? { options: selectionPatch.options } : {}),
    },
  };
}
